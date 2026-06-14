import fs from 'fs/promises';
import path from 'path';
import { LLMClient } from './llm-client.js';
import { factCheck } from './fact-checker.js';

export class Summarizer {
  constructor({ anthropicKey, openaiKey, localBaseUrl, localModel, preferredProvider } = {}) {
    this.llm = new LLMClient({ anthropicKey, openaiKey, localBaseUrl, localModel, preferredProvider });
    this.totalCost = 0;
    this.requestCount = 0;
    this.lastFactCheckReport = null;
  }

  async generateSummary(posts, config) {
    const style = config.summaryStyle || 'concise';
    const fewShot = await this._loadFewShotExamples(config);
    const prompt = this.buildPrompt(posts, style, config, fewShot);

    try {
      console.log(`Generating summary (${style} style)...`);

      const result = await this.llm.complete({
        system: this._buildSystemPrompt(style),
        user: prompt,
        temperature: 0.75,
        maxTokens: 2200
      });

      console.log(`✓ Summary generated via ${result.provider}/${result.model}. Cost: $${result.cost.toFixed(4)}`);

      // ---- Fact-check pass (free) ----
      const fc = factCheck(result.text, posts);
      this.lastFactCheckReport = fc;
      if (fc.warnings.length > 0) {
        console.log(`⚠️  Fact-check pass made ${fc.warnings.length} change(s):`);
        fc.warnings.forEach(w => console.log(`     - ${w}`));
      } else {
        console.log(`✓ Fact-check pass: no issues found`);
      }

      this.totalCost += result.cost;
      this.requestCount++;

      return {
        summary: fc.cleanSummary,
        metadata: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          cost: result.cost,
          model: result.model,
          provider: result.provider,
          factCheckReplacements: fc.replacements.length,
          factCheckWarnings: fc.warnings
        }
      };
    } catch (error) {
      console.error('✗ Summarization failed:', error.message);
      throw error;
    }
  }

  _buildSystemPrompt(style) {
    return [
      `You are a sharp, opinionated tech-and-culture columnist writing a ${style} daily digest of FRESH posts from the last 24 hours.`,
      `You write like a witty human friend — never like a summarization bot, never like a press release.`,
      `You lead with the most surprising, novel, or counterintuitive thing.`,
      `You connect dots across posts and call out tensions or contradictions.`,
      `STRICT RULES:`,
      `  - NEVER invent statistics, comment counts, or vote totals. If you cite a number, it MUST come from the input data.`,
      `  - NEVER claim "users on platform X said Y" unless you can cite a specific post from platform X.`,
      `  - NEVER use phrases like "users express", "this topic explores", "in conclusion", or "in a world where".`,
      `  - NEVER pad with throat-clearing. Every sentence earns its place.`,
      `  - When a story is mentioned with citations from multiple platforms (Bluesky+HN, etc.), highlight that — it's a strong signal.`
    ].join('\n');
  }

  /**
   * Few-shot examples: pull one prior digest the user has marked as "good"
   * (placed in digests/_examples/), OR fall back to the most recent
   * full-pipeline digest in the digests/ folder.
   *
   * Few-shot is gated by config.useFewShot (default true) — costs ~1500 input
   * tokens, which with Anthropic prompt caching is effectively free on rerun.
   */
  async _loadFewShotExamples(config) {
    if (config.useFewShot === false) return null;
    const outputDir = config.localSaving?.outputDirectory || 'digests';
    const examplesDir = path.join(outputDir, '_examples');

    // Try curated examples first
    try {
      const files = await fs.readdir(examplesDir);
      const mdFiles = files.filter(f => f.endsWith('.md'));
      if (mdFiles.length > 0) {
        const picked = mdFiles[0];
        const content = await fs.readFile(path.join(examplesDir, picked), 'utf-8');
        return { source: `curated example: ${picked}`, content: this._trimExample(content) };
      }
    } catch { /* no curated examples dir */ }

    // Fall back to the most recent digest (skip ones with explicit "DRY-RUN" or pre-fix style)
    try {
      const files = await fs.readdir(outputDir);
      const candidates = files
        .filter(f => f.startsWith('bluesky-digest-') && f.endsWith('.md'))
        .sort()
        .reverse();
      for (const f of candidates) {
        const content = await fs.readFile(path.join(outputDir, f), 'utf-8');
        // Heuristic: only use as example if it has the new format (### **Title** blocks)
        const headerCount = (content.match(/^###\s+\*\*/gm) || []).length;
        if (headerCount >= 3) {
          return { source: `most recent good digest: ${f}`, content: this._trimExample(content) };
        }
      }
    } catch { /* no digests yet */ }

    return null;
  }

  _trimExample(content) {
    // Strip metadata footer and generation header so the few-shot is purely
    // the writing we want emulated.
    return content
      .replace(/^# .+\n/, '')                          // top h1
      .replace(/\*\*[A-Z][a-z]+, .+\*\*\n+/, '')       // date line
      .replace(/---\n+##\s+📊[\s\S]*$/, '')           // stats footer
      .replace(/\*Generated by.+\*\n*$/, '')           // generator footer
      .replace(/^-+\n/gm, '')
      .trim()
      .slice(0, 3500);                                 // hard cap
  }

  buildPrompt(posts, style, config = {}, fewShot = null) {
    const recentTopics = (config._recentTopicTitles || []).slice(0, 15);
    const sourceCounts = config._sourceCounts || {};

    const SOURCE_TAG = {
      bluesky: '🦋 Bluesky',
      mastodon: '🐘 Mastodon',
      hackernews: '🟠 HN',
      rss: '📰 Blog',
      reddit: '👽 Reddit'
    };

    const postSummaries = posts.map((post, idx) => {
      let url = post.url;
      if (!url && post.source === 'bluesky') {
        const rkey = post.uri.split('/').pop();
        url = `https://bsky.app/profile/${post.author}/post/${rkey}`;
      }
      url = url || post.uri;

      const ageStr = post.ageHours != null
        ? (post.ageHours < 1
            ? `${Math.round(post.ageHours * 60)}m ago`
            : `${post.ageHours.toFixed(1)}h ago`)
        : 'recent';
      const velocityStr = post.velocity != null ? ` · ${post.velocity.toFixed(1)} eng/hr` : '';
      const sourceTag = SOURCE_TAG[post.source] || post.source || '?';

      let block = `[${idx + 1}] ${sourceTag} · @${post.author} (${post.authorDisplayName}) · ${ageStr}${velocityStr}\n`;
      const text = post.text.length > 600 ? post.text.slice(0, 600) + '…' : post.text;
      block += `"${text}"\n`;
      block += `🔗 ${url}\n`;
      if (post.source === 'hackernews') {
        block += `📊 ${post.likes} points · ${post.replies} comments\n`;
      } else if (post.source === 'reddit') {
        block += `📊 ${post.likes} upvotes · ${post.replies} comments · r/${post.subreddit}\n`;
      } else if (post.source === 'rss') {
        block += `📊 (blog post — no engagement metrics)\n`;
      } else {
        block += `📊 ${post.likes} likes · ${post.replies} replies · ${post.reposts} reposts\n`;
      }

      // Cross-platform: if this post was clustered with related coverage, show it.
      if (post.relatedSources?.length) {
        block += `🌐 ALSO COVERED ON:\n`;
        post.relatedSources.forEach(rs => {
          const tag = SOURCE_TAG[rs.source] || rs.source;
          block += `   - ${tag} @${rs.author}: "${rs.excerpt.replace(/\n/g, ' ')}…" → ${rs.url}\n`;
        });
      }

      if (post.topReplies?.length > 0) {
        block += `💬 Top replies:\n`;
        post.topReplies.forEach(reply => {
          const txt = reply.text.length > 140 ? reply.text.slice(0, 140) + '…' : reply.text;
          block += `   - @${reply.author} (${reply.likes}♥): "${txt}"\n`;
        });
      }
      return block;
    }).join('\n');

    const sourcesLine = Object.entries(sourceCounts).length > 0
      ? `Sources tapped today: ${Object.entries(sourceCounts).map(([s, n]) => `${s}(${n})`).join(', ')}.`
      : '';

    const avoidBlock = recentTopics.length > 0
      ? `\n\nAVOID REPEATING RECENT TOPIC TITLES (from the last few digests):\n${recentTopics.map(t => `  - ${t}`).join('\n')}\nUse fresh framings even if the underlying theme returns.\n`
      : '';

    const fewShotBlock = fewShot
      ? `\nHERE IS AN EXAMPLE of the voice, structure, and depth I want — match this tone, not its content (${fewShot.source}):\n\n=====BEGIN EXAMPLE=====\n${fewShot.content}\n=====END EXAMPLE=====\n\nNow write TODAY'S digest from the posts below — fresh content, same vibe.\n`
      : '';

    return `${fewShotBlock}Write today's multi-platform tech digest. Posts come from Bluesky, Mastodon, Hacker News, and tech blogs — all from the last 24 hours.
${sourcesLine}

YOUR JOB:
1. Open with 2–3 punchy sentences naming the most interesting thing in today's batch. No "today's digest covers..." — just dive in.
2. Group posts into 3–6 topics with SPECIFIC, vivid titles (headline-style, not folder-style).
3. For each topic, write 3–5 sentences of actual analysis: insight, tension, why it matters, second-order implication.
4. Where a post is marked "🌐 ALSO COVERED ON" — this is a cross-platform story. Lead with it and cite ALL platforms (the primary + related sources).
5. End with one sharp closing line — observation, question, or prediction. NOT a recap, NOT "in a world where".

CITATIONS (mandatory):
- Every post you reference needs an inline citation: [— @handle](url).
- URLs are after 🔗 (primary post) or → (related sources). Use them exactly.
- Quote sparingly — punchiest line only.
- NEVER fabricate vote counts, comment numbers, or "X said Y" claims.

PRIORITIZATION:
- Lead with cross-platform stories (multiple 🌐 sources = real signal).
- Then posts with high velocity (heating up right now).
- Long blog posts often have the deepest insight — don't skip them just because they lack "likes".
- NO "miscellaneous" sections. Better 4 sharp topics than 6 mushy ones.

VOICE:
- Active voice. Specific nouns. Concrete details.
- Wry, skeptical, or enthusiastic — just be a person.
- Name contradictions between posts. Treat hot takes as hot takes.

FORMAT (markdown):
### **[Specific, headline-style topic title]**
[3–5 sentences of analysis with inline citations like [— @handle](url) woven into the prose. Cite ALL related sources for cross-platform stories.]

*   "Punchiest pull-quote" [— @handle](url)
*   Optional counterpoint or related-source quote [— @handle](url)
${avoidBlock}
TODAY'S POSTS (${posts.length} total, all from last 24h):

${postSummaries}`;
  }

  getCostReport() {
    return {
      totalCost: this.totalCost,
      requestCount: this.requestCount,
      averageCostPerRequest: this.requestCount > 0 ? this.totalCost / this.requestCount : 0
    };
  }

  checkBudget(budget) {
    if (this.totalCost > budget) {
      console.warn(`⚠️  Budget exceeded! Current: $${this.totalCost.toFixed(4)}, Budget: $${budget.toFixed(2)}`);
      return false;
    }
    return true;
  }
}
