import fs from 'fs/promises';
import path from 'path';
import { LLMClient } from './llm-client.js';
import { factCheck } from './fact-checker.js';

export class Summarizer {
  constructor({ anthropicKey, openaiKey, localBaseUrl, localModel, preferredProvider } = {}) {
    this.llm = new LLMClient({ anthropicKey, openaiKey, localBaseUrl, localModel, preferredProvider });
    // Save these so we can pass openaiKey to the fact-checker as the SECOND-OPINION
    // judge — critical that the judge model is different from the writer model.
    this.anthropicKey = anthropicKey;
    this.openaiKey = openaiKey;
    this.preferredProvider = preferredProvider;
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
        maxTokens: 3500  // more room for ~10-12 sections vs old 5-7
      });

      console.log(`✓ Summary generated via ${result.provider}/${result.model}. Cost: $${result.cost.toFixed(4)}`);

      // ---- Fact-check pass ----
      // Layer 3 (LLM judge) only runs if we have an OpenAI key AND the writer
      // was Anthropic (so judge ≠ writer). If writer was OpenAI, we still run
      // L1+L2 but skip L3 to avoid self-confirmation bias.
      const writerWasOpenAI = result.provider === 'openai';
      const judgeAvailable = !!this.openaiKey && !writerWasOpenAI;
      const fc = await factCheck(result.text, posts, {
        openaiKey: judgeAvailable ? this.openaiKey : null,
        useJudge: judgeAvailable,
        validateUrls: true,
        maxJudgeCalls: 8
      });
      this.lastFactCheckReport = fc;

      const s = fc.stats;
      if (fc.warnings.length > 0 || s.invalidUrls > 0) {
        console.log(`⚠️  Fact-check: ${s.numbersReplaced} number(s) replaced, ${s.urlsStripped} URL(s) stripped, ${s.judgeCalls} judge call(s) ($${s.judgeCost.toFixed(4)})`);
        fc.warnings.forEach(w => console.log(`     - ${w}`));
      } else {
        console.log(`✓ Fact-check pass: clean (${s.suspiciousNumbers} number(s) checked, ${s.judgeCalls} judge call(s))`);
      }

      this.totalCost += result.cost + (fc.stats.judgeCost || 0);
      this.requestCount++;

      return {
        summary: fc.cleanSummary,
        metadata: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          cost: result.cost,
          judgeCost: fc.stats.judgeCost || 0,
          totalCost: result.cost + (fc.stats.judgeCost || 0),
          model: result.model,
          provider: result.provider,
          factCheckStats: fc.stats,
          factCheckReplacements: fc.replacements.length,
          factCheckUrlsStripped: fc.stats.urlsStripped,
          factCheckJudgeCalls: fc.stats.judgeCalls,
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
      `  - You MUST cover EVERY post in the input. Each post gets either its own section OR is genuinely the same story as another post (only then merge).`,
      `  - NEVER drop politics, news, or culture posts just because most posts are about AI. Variety is the point.`,
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
      reddit: '👽 Reddit',
      github: '🐙 GitHub',
      arxiv: '📄 arXiv'
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
        if (post.hnDiscussionUrl) {
          block += `💬 HN discussion: ${post.hnDiscussionUrl}\n`;
        }
      } else if (post.source === 'reddit') {
        block += `📊 ${post.likes} upvotes · ${post.replies} comments · r/${post.subreddit}\n`;
      } else if (post.source === 'rss') {
        block += `📊 (blog post — no engagement metrics)\n`;
      } else if (post.source === 'github') {
        block += `📊 ${post.likes} stars in trending period · trending now\n`;
      } else if (post.source === 'arxiv') {
        block += `📊 (arXiv preprint — no community metrics yet)\n`;
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

    return `${fewShotBlock}Write today's multi-platform tech-and-culture digest. Posts come from Bluesky, Mastodon, Hacker News, Reddit, and tech blogs — all from the last 24 hours.
${sourcesLine}

YOUR JOB:
1. Open with 2–3 punchy sentences naming the most interesting thing in today's batch. No "today's digest covers..." — just dive in.
2. **Cover EVERY post.** The default is one section per post. You may merge 2–3 posts into a single section ONLY when they are unambiguously the same story (same news event, same person, same product launch). When merging, you must still cite EACH post.
3. Expect 8–12 sections total when given ~15 posts. Do not over-consolidate into 4–6 thematic essays — readers want variety, not a thesis.
4. **Mix categories deliberately.** If half the posts are AI-related, write only ~half the sections about AI — don't let one theme dominate. Politics, business, culture, science, dev-tools all deserve their own space when present.
5. For each section, write 2–4 sentences of actual analysis: insight, tension, why it matters, second-order implication.
6. Where a post is marked "🌐 ALSO COVERED ON" — this is a cross-platform story. Lead with it and cite ALL platforms (the primary + related sources).
7. End with one sharp closing line — observation, question, or prediction. NOT a recap, NOT "in a world where".

CITATIONS (mandatory):
- Every post you reference needs an inline citation: [— @handle](url).
- URLs are after 🔗 (primary post), 💬 (HN discussion), or → (related sources). Use them exactly.
- NEVER invent URLs. If you don't have a URL for a claim, just don't cite it.
- For HN: use the 🔗 URL for the article OR the 💬 URL for the discussion thread. NEVER fabricate a news.ycombinator.com/item?id= URL.
- Quote sparingly — punchiest line only.
- NEVER fabricate vote counts, comment numbers, or "X said Y" claims.

PRIORITIZATION:
- Lead with cross-platform stories (multiple 🌐 sources = real signal).
- Then posts with high velocity (heating up right now).
- Long blog posts often have the deepest insight — don't skip them just because they lack "likes".
- NO "miscellaneous" sections. Each section has a specific subject.

VOICE:
- Active voice. Specific nouns. Concrete details.
- Wry, skeptical, or enthusiastic — just be a person.
- Name contradictions between posts. Treat hot takes as hot takes.

FORMAT (markdown):
### **[Specific, headline-style topic title]**
[2–4 sentences of analysis with inline citations like [— @handle](url) woven into the prose. Cite ALL related sources for cross-platform stories.]

*   "Punchiest pull-quote" [— @handle](url)

VERIFY BEFORE YOU FINISH: Count your section headers. If you have ${posts.length} input posts and fewer than ${Math.max(Math.floor(posts.length * 0.6), 6)} sections, you have OVER-consolidated. Split merged sections back out.
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
