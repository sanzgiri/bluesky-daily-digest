/**
 * FactChecker — three-layer hallucination defense for AI-generated digests.
 *
 * Each layer is independent and can be enabled/disabled:
 *
 *   Layer 1 (regex):       cheap, deterministic, catches bare numeric fabrications
 *   Layer 2 (URL validator): cheap, deterministic, catches fabricated citations
 *   Layer 3 (LLM judge):    expensive, only fires on flagged claims, uses a
 *                           DIFFERENT model than the writer to avoid self-confirmation
 *
 * The flow is:
 *   1. Strip URLs and code blocks from consideration before running Layer 1
 *      regex — these are the source of nearly all false positives.
 *   2. Layer 2 validates every URL Claude cited actually came from an input post.
 *   3. Layer 3 (optional) gets a second opinion from a different LLM on
 *      suspicious numeric claims before we replace them.
 *
 * Design principle: deterministic-first. The regex and URL passes catch ~95%
 * of issues for free. The LLM judge is a safety net for edge cases, called
 * sparingly to keep cost negligible.
 */

import OpenAI from 'openai';

// =============================================================================
// LAYER 0: Tokenize / strip the parts we should NEVER scan
// =============================================================================

/**
 * Replace risky regions with placeholders, run regex, then restore.
 * Risky regions:
 *   - URLs (raw and inside markdown links)
 *   - Inline code: `foo`
 *   - Code blocks: ```...```
 *   - Markdown links: [text](url) — we scan `text` but never `url`
 */
function maskUnscannableRegions(summary) {
  const placeholders = new Map();
  let counter = 0;
  let masked = summary;

  const mask = (regex, kind) => {
    masked = masked.replace(regex, (match) => {
      const key = `\u0000${kind}_${counter++}\u0000`;
      placeholders.set(key, match);
      return key;
    });
  };

  // Order matters: longest-pattern-first to avoid nesting issues.
  mask(/```[\s\S]*?```/g, 'CODEBLOCK');             // fenced code
  mask(/`[^`\n]+`/g, 'INLINECODE');                  // inline code
  // Markdown link URL portion: keep visible text scannable, hide URL only.
  mask(/\]\(([^)]+)\)/g, 'LINKURL');                 // (url) part of [text](url)
  mask(/https?:\/\/[^\s)>\]]+/g, 'BAREURL');         // bare URLs not in markdown

  return { masked, placeholders };
}

function unmask(text, placeholders) {
  let restored = text;
  for (const [key, original] of placeholders) {
    restored = restored.replaceAll(key, original);
  }
  return restored;
}

// =============================================================================
// LAYER 1: Smart regex for numeric claims
// =============================================================================

// Match real numeric claims in prose:
//   - 4+ digit numbers (1,234 / 1234 / 1.2K)
//   - Percentages (47%)
//   - Comma-grouped (1,000,000)
// EXCLUDES years, ordinals (1st), and bare 1-3 digit numbers.
const NUMERIC_CLAIM_RX = /(?<![\/\-\d])\b\d{1,3}(?:,\d{3})+\+?(?:\.\d+)?%?\b|(?<![\/\-\d])\b\d{4,}\+?(?:\.\d+)?%?\b|(?<![\/\-\d])\b\d{1,3}\.\d+%\b/g;

// Things that look numeric but aren't claims:
//   - 4-digit years (1900-2099)
//   - "v1.2.3" version numbers (have a leading v or follow "version")
const YEAR_RX = /^(19|20)\d{2}$/;

function isYear(s) { return YEAR_RX.test(s.replace(/[,+%]/g, '')); }

function gatherKnownNumbers(posts) {
  const known = new Set();
  for (const p of posts) {
    [p.likes, p.replies, p.reposts, p.quotes, p.points, p.score].forEach(n => {
      if (n != null && n >= 10) {
        known.add(String(n));
        known.add(n.toLocaleString());
      }
    });
    // Numbers explicitly in post text are quotable
    for (const m of (p.text || '').matchAll(NUMERIC_CLAIM_RX)) {
      known.add(m[0]);
    }
    // Top reply scores too
    (p.topReplies || []).forEach(r => {
      if (r.likes >= 10) {
        known.add(String(r.likes));
        known.add(r.likes.toLocaleString());
      }
    });
  }
  return known;
}

function findSuspiciousNumbers(maskedSummary, knownNumbers) {
  const suspicious = [];
  const seen = new Set();

  for (const m of maskedSummary.matchAll(NUMERIC_CLAIM_RX)) {
    const claim = m[0];
    if (seen.has(claim)) continue;
    seen.add(claim);
    if (isYear(claim)) continue;

    const normalized = claim.replace(/[,+]/g, '').replace(/%$/, '');
    const isPercent = claim.endsWith('%');

    // Direct match
    if (knownNumbers.has(claim) || knownNumbers.has(normalized)) continue;

    // Near match (±10%) for non-percentages
    if (!isPercent) {
      const n = parseFloat(normalized);
      if (!isNaN(n)) {
        let near = false;
        for (const k of knownNumbers) {
          const kn = parseFloat(k.replace(/[,+]/g, ''));
          if (!isNaN(kn) && Math.abs(kn - n) / Math.max(kn, n) < 0.1) {
            near = true;
            break;
          }
        }
        if (near) continue;
      }
    }

    // Build context window from the masked text
    const idx = maskedSummary.indexOf(claim);
    const start = Math.max(0, idx - 80);
    const end = Math.min(maskedSummary.length, idx + claim.length + 80);
    const context = maskedSummary.slice(start, end);

    suspicious.push({ claim, normalized, isPercent, context });
  }
  return suspicious;
}

function vagueReplacement(claim, isPercent) {
  if (isPercent) return 'a notable share';
  const n = parseFloat(claim.replace(/[,+]/g, ''));
  if (n >= 1_000_000) return 'millions';
  if (n >= 1_000) return 'thousands';
  if (n >= 100) return 'hundreds';
  return 'dozens';
}

// =============================================================================
// LAYER 2: URL validator
// =============================================================================

/**
 * Extract all URLs cited in the summary's markdown links: [text](url).
 * We do NOT touch bare URLs because Claude rarely invents those outside of
 * links — and stripping them would break a lot of intentional references.
 */
function extractCitedUrls(summary) {
  const urls = new Set();
  for (const m of summary.matchAll(/\]\(([^)]+)\)/g)) {
    urls.add(m[1].trim());
  }
  return [...urls];
}

/**
 * Build a set of URLs that came from the input posts. Includes:
 *   - The post's own URL
 *   - URLs embedded in the post text
 *   - URLs from related (cross-platform) sources
 *   - Synthesized canonical URLs for source-specific formats
 */
function gatherKnownUrls(posts) {
  const known = new Set();
  const URL_RX = /https?:\/\/[^\s)>\]"]+/g;
  for (const p of posts) {
    if (p.url) known.add(p.url);
    if (p.discussionUrl) known.add(p.discussionUrl);
    if (p.hnDiscussionUrl) known.add(p.hnDiscussionUrl);  // ← fix: HN client uses this field
    // Bluesky-style synthesized URL
    if (p.source === 'bluesky' && p.uri) {
      const rkey = p.uri.split('/').pop();
      known.add(`https://bsky.app/profile/${p.author}/post/${rkey}`);
    }
    for (const m of (p.text || '').matchAll(URL_RX)) known.add(m[0]);
    for (const rs of p.relatedSources || []) {
      if (rs.url) known.add(rs.url);
    }
  }
  return known;
}

/**
 * A URL is "valid" if it appears in the known set OR has the same origin+path
 * as a known URL (we forgive tracking-param differences).
 */
function normalizeUrl(u) {
  try {
    const url = new URL(u);
    // Strip common tracking params
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
     'ref', 'ref_src', 'fbclid', 'gclid'].forEach(p => url.searchParams.delete(p));
    return `${url.origin}${url.pathname}${url.search}`.toLowerCase().replace(/\/$/, '');
  } catch {
    return u.toLowerCase();
  }
}

function findInvalidUrls(citedUrls, knownUrls) {
  const knownNormalized = new Set([...knownUrls].map(normalizeUrl));
  return citedUrls.filter(u => !knownNormalized.has(normalizeUrl(u)));
}

/**
 * Path similarity: ratio of shared path segments. Used to gate whether
 * a same-domain URL substitution is safe.
 *   /foo/bar/baz   vs  /foo/bar/qux  → 2/3 = 0.67 (likely same intent)
 *   /foo/bar/baz   vs  /completely/different/path → 0 (NOT safe)
 */
function pathSimilarity(a, b) {
  const segsA = a.split('/').filter(Boolean);
  const segsB = b.split('/').filter(Boolean);
  if (segsA.length === 0 || segsB.length === 0) return 0;
  const setB = new Set(segsB);
  const shared = segsA.filter(s => setB.has(s)).length;
  return shared / Math.max(segsA.length, segsB.length);
}

// =============================================================================
// LAYER 3: LLM second-opinion judge (optional)
// =============================================================================

/**
 * Ask a DIFFERENT LLM than the writer whether a specific numeric claim is
 * supported by the source posts. We keep the prompt minimal and structured
 * so the judge can't drift into elaboration.
 *
 * Returns: 'supported' | 'not_supported' | 'uncertain' | 'error'
 */
async function judgeClaim({ openaiKey, model = 'gpt-4o-mini' }, claim, contextSentence, sourcePosts) {
  if (!openaiKey) return 'error';

  // Build a compact source-post summary — just the texts + their numbers.
  const sourceSummary = sourcePosts.slice(0, 15).map((p, i) =>
    `[${i + 1}] @${p.author} (${p.source}, ${p.likes || 0}↑ ${p.replies || 0}💬): "${(p.text || '').slice(0, 240).replace(/\n/g, ' ')}"`
  ).join('\n');

  const system = 'You verify whether numeric claims in a written summary are supported by source posts. You answer with ONE WORD ONLY: "supported", "not_supported", or "uncertain". You must never explain.';
  const user = `SOURCE POSTS:
${sourceSummary}

CLAIM TO VERIFY (the number "${claim}" appears in this sentence):
"${contextSentence}"

Question: Is the specific number "${claim}" supported by — or directly derivable from — the source posts above? Or could it be a paraphrase of a number that IS in the sources (e.g. rounding)?

Answer with one word: supported / not_supported / uncertain`;

  try {
    const client = new OpenAI({ apiKey: openaiKey });
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0,
      max_tokens: 5
    });
    const verdict = (resp.choices[0].message.content || '').trim().toLowerCase().replace(/[^a-z_]/g, '');
    if (['supported', 'not_supported', 'uncertain'].includes(verdict)) return verdict;
    return 'uncertain';
  } catch (err) {
    console.error(`  [judge] error: ${err.message}`);
    return 'error';
  }
}

// =============================================================================
// MAIN: factCheck pipeline
// =============================================================================

/**
 * @param {string} summary       The LLM's raw output
 * @param {Array}  posts         The input posts that fed the LLM
 * @param {Object} opts
 * @param {string} [opts.openaiKey]      Enables Layer 3 if provided
 * @param {string} [opts.judgeModel]     Default 'gpt-4o-mini'
 * @param {boolean}[opts.useJudge]       Default true if openaiKey is present
 * @param {boolean}[opts.validateUrls]   Default true
 * @param {number} [opts.maxJudgeCalls]  Cap on Layer 3 calls (default 8)
 *
 * @returns {Object} {
 *   cleanSummary: string,           // post-cleanup text
 *   warnings: string[],             // human-readable issues
 *   replacements: Array<{...}>,     // what got changed
 *   stats: {                        // for logging
 *     suspiciousNumbers,
 *     invalidUrls,
 *     judgeCalls,
 *     judgeCost,
 *     numbersReplaced,
 *     urlsStripped
 *   }
 * }
 */
export async function factCheck(summary, posts, opts = {}) {
  const {
    openaiKey,
    judgeModel = 'gpt-4o-mini',
    useJudge = !!openaiKey,
    validateUrls = true,
    maxJudgeCalls = 8
  } = opts;

  const warnings = [];
  const replacements = [];
  const stats = {
    suspiciousNumbers: 0,
    invalidUrls: 0,
    judgeCalls: 0,
    judgeCost: 0,
    numbersReplaced: 0,
    urlsStripped: 0
  };
  let cleanSummary = summary;

  // ---------------------------------------------------------------------------
  // LAYER 1: Smart regex for numeric claims
  // ---------------------------------------------------------------------------
  const { masked, placeholders } = maskUnscannableRegions(cleanSummary);
  const knownNumbers = gatherKnownNumbers(posts);
  const suspicious = findSuspiciousNumbers(masked, knownNumbers);
  stats.suspiciousNumbers = suspicious.length;

  for (const sus of suspicious) {
    // First, check if we should call the judge (Layer 3)
    let verdict = 'not_supported'; // default: regex says it's bogus

    if (useJudge && stats.judgeCalls < maxJudgeCalls) {
      // Restore context (un-mask) so the judge sees the real sentence
      const contextSentence = unmask(sus.context, placeholders);
      verdict = await judgeClaim(
        { openaiKey, model: judgeModel },
        sus.claim,
        contextSentence,
        posts
      );
      stats.judgeCalls++;
      // gpt-4o-mini: $0.00015/1K in, $0.0006/1K out. Each judge call is ~1500 in + 5 out ≈ $0.00023
      stats.judgeCost += 0.00023;
    }

    if (verdict === 'supported') {
      // Judge says it's fine — leave it alone, log for transparency
      warnings.push(`Judge cleared "${sus.claim}" (regex flagged, LLM verified)`);
      continue;
    }

    if (verdict === 'uncertain') {
      // Judge isn't sure — leave it but flag prominently
      warnings.push(`UNCERTAIN: "${sus.claim}" couldn't be verified — left unchanged. Manual review suggested.`);
      continue;
    }

    // not_supported (or judge unavailable / errored)
    const replacement = vagueReplacement(sus.claim, sus.isPercent);

    // Replace only the FIRST occurrence in the unmasked summary to avoid
    // breaking later occurrences that might be inside URLs (placeholder
    // unmasking happens at the end, but we want to be safe).
    cleanSummary = cleanSummary.replace(sus.claim, replacement);
    stats.numbersReplaced++;

    const ctxClean = unmask(sus.context, placeholders).replace(/\s+/g, ' ').trim();
    const verdictLabel = useJudge ? `${verdict} via judge` : 'unverified (regex only)';
    warnings.push(`Replaced "${sus.claim}" → "${replacement}" [${verdictLabel}]`);
    replacements.push({ original: sus.claim, replaced: replacement, context: ctxClean, verdict });
  }

  // ---------------------------------------------------------------------------
  // LAYER 2: URL validator
  // ---------------------------------------------------------------------------
  if (validateUrls) {
    const cited = extractCitedUrls(cleanSummary);
    const knownUrls = gatherKnownUrls(posts);
    const invalid = findInvalidUrls(cited, knownUrls);
    stats.invalidUrls = invalid.length;

    for (const badUrl of invalid) {
      // SAFE substitution rule: only substitute if there's an INPUT POST URL
      // with the SAME HOSTNAME AND a path segment overlap of ≥0.6, which
      // strongly suggests Claude paraphrased a real URL. We NEVER swap
      // across authors (e.g. tice.me → swantower would be wrong attribution).
      //
      // For Bluesky URLs specifically, the author appears IN the URL path
      // (/profile/{author}/post/{rkey}) — we extract and require it to match.
      let replaced = false;
      const badNorm = normalizeUrl(badUrl);

      // Same-author safety check for Bluesky URLs
      const isBlueskyUrl = badNorm.includes('bsky.app/profile/');
      const badBlueskyAuthor = isBlueskyUrl
        ? (badNorm.match(/bsky\.app\/profile\/([^\/]+)/)?.[1] || null)
        : null;

      for (const knownUrl of knownUrls) {
        const knNorm = normalizeUrl(knownUrl);
        try {
          if (new URL(badNorm).hostname !== new URL(knNorm).hostname) continue;

          // For Bluesky: require the author segment to match. If Claude wrote
          // bsky.app/profile/tice.me/... and the known URL is for a different
          // profile, this is NOT a safe substitution.
          if (isBlueskyUrl && badBlueskyAuthor) {
            const knownBlueskyAuthor = knNorm.match(/bsky\.app\/profile\/([^\/]+)/)?.[1];
            if (knownBlueskyAuthor !== badBlueskyAuthor) continue;
          }

          // Path similarity check: too dissimilar = probably not the intended URL
          const badPath = new URL(badNorm).pathname;
          const knPath = new URL(knNorm).pathname;
          const pathSim = pathSimilarity(badPath, knPath);
          if (pathSim < 0.6) continue;

          cleanSummary = cleanSummary.replaceAll(`](${badUrl})`, `](${knownUrl})`);
          warnings.push(`Substituted "${badUrl}" → "${knownUrl}" (same host+author, path sim=${pathSim.toFixed(2)})`);
          replaced = true;
          break;
        } catch { /* invalid URL, skip */ }
      }
      if (!replaced) {
        // Strip the entire markdown link, keep the visible text in brackets.
        // [— @handle](badUrl)  →  — @handle
        const stripRx = new RegExp(`\\[([^\\]]*)\\]\\(${badUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
        cleanSummary = cleanSummary.replace(stripRx, '$1');
        warnings.push(`Stripped fabricated URL "${badUrl}" (no safe match in inputs)`);
        stats.urlsStripped++;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-platform attribution check (kept from original)
  // ---------------------------------------------------------------------------
  const sourcesPresent = new Set(posts.map(p => p.source));
  const PLATFORM_CLAIMS = [
    { rx: /\b(?:on|across)\s+hacker\s*news\b/gi, source: 'hackernews', name: 'Hacker News' },
    { rx: /\bover on bluesky\b|\bbluesky\s+(?:users|community|crowd)\b/gi, source: 'bluesky', name: 'Bluesky' },
    { rx: /\bmastodon\s+(?:users|community|crowd|shrugged|reacted)\b/gi, source: 'mastodon', name: 'Mastodon' },
    { rx: /\breddit\s+(?:users|community|crowd|thread)\b/gi, source: 'reddit', name: 'Reddit' }
  ];
  for (const { rx, source, name } of PLATFORM_CLAIMS) {
    if (!sourcesPresent.has(source) && rx.test(cleanSummary)) {
      warnings.push(`Claims about "${name}" but no posts from that platform were in the input.`);
    }
  }

  return { cleanSummary, warnings, replacements, stats };
}
