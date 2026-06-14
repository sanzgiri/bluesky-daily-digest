/**
 * FactChecker — post-processes AI-generated digests to catch:
 *   1. Hallucinated statistics ("2,000 comments" when actual was 296)
 *   2. Fabricated cross-platform claims ("HN erupted while Bluesky shrugged"
 *      when there was no Bluesky coverage at all)
 *   3. Numbers/percentages that appear in the summary but not the input data
 *
 * This is a regex+heuristics pass, not a full LLM verification — it's cheap
 * ($0) and catches the common failure modes without being a separate API call.
 *
 * Approach: extract all numeric claims from the summary, check whether they
 * appear in (or can be derived from) the input post data, and either
 * REWRITE them to safer language ("hundreds of comments") or REMOVE them.
 */

// Numbers we will check: integers ≥ 10, with optional commas/+ /percent.
// IMPORTANT: anchor on word boundaries AND ensure the match captures the FULL
// number including comma groups. Naive \d{2,} can match "000" inside "2,000".
const NUMERIC_CLAIM_RX = /\b\d{1,3}(?:,\d{3})+\+?(?:\.\d+)?%?|\b\d{2,}\+?(?:\.\d+)?%?\b/g;

// Years and very common counts that aren't claims (e.g. "2024", "12 months")
const NUMERIC_WHITELIST_RX = /\b(19|20)\d{2}\b/; // any 4-digit year

function extractClaims(summary) {
  const claims = new Set();
  for (const m of summary.matchAll(NUMERIC_CLAIM_RX)) {
    const num = m[0];
    if (NUMERIC_WHITELIST_RX.test(num)) continue;
    claims.add(num);
  }
  return [...claims];
}

function gatherKnownNumbers(posts) {
  const known = new Set();
  for (const p of posts) {
    [p.likes, p.replies, p.reposts, p.quotes].forEach(n => {
      if (n != null && n >= 10) {
        known.add(String(n));
        known.add(n.toLocaleString()); // "2,000" form
      }
    });
    // Also include any explicit numbers in the post text — the AI is allowed
    // to quote those.
    for (const m of (p.text || '').matchAll(NUMERIC_CLAIM_RX)) {
      known.add(m[0]);
    }
  }
  return known;
}

/**
 * Returns { cleanSummary, warnings, replacements }.
 * - cleanSummary: the summary with hallucinated numbers softened to vague language
 * - warnings: human-readable issues for logging
 * - replacements: list of {original, replaced, context} for transparency
 */
export function factCheck(summary, posts) {
  const known = gatherKnownNumbers(posts);
  const claims = extractClaims(summary);

  const warnings = [];
  const replacements = [];
  let cleanSummary = summary;

  for (const claim of claims) {
    // Strip commas/+ to compare numerically
    const normalized = claim.replace(/[,+]/g, '').replace(/%$/, '');
    const isPercent = claim.endsWith('%');

    // Direct match?
    if (known.has(claim) || known.has(normalized)) continue;

    // Near-match within 10%? (AI sometimes rounds)
    let nearMatch = false;
    if (!isPercent) {
      const n = parseFloat(normalized);
      if (!isNaN(n)) {
        for (const k of known) {
          const kn = parseFloat(k.replace(/[,+]/g, ''));
          if (!isNaN(kn) && Math.abs(kn - n) / Math.max(kn, n) < 0.1) {
            nearMatch = true;
            break;
          }
        }
      }
    }
    if (nearMatch) continue;

    // Unverifiable. Replace with vague language to keep the sentence flowing.
    const replacement = isPercent
      ? 'a notable share'
      : (parseFloat(normalized) >= 1000 ? 'thousands' :
         parseFloat(normalized) >= 100 ? 'hundreds' : 'dozens');

    // Find surrounding context for the log
    const idx = cleanSummary.indexOf(claim);
    const context = idx >= 0
      ? cleanSummary.slice(Math.max(0, idx - 40), Math.min(cleanSummary.length, idx + claim.length + 40))
      : '';

    cleanSummary = cleanSummary.replaceAll(claim, replacement);
    warnings.push(`Replaced unverified "${claim}" → "${replacement}"`);
    replacements.push({ original: claim, replaced: replacement, context });
  }

  // Also catch hallucinated cross-platform claims when the platform wasn't actually present.
  const sourcesPresent = new Set(posts.map(p => p.source));
  const PLATFORM_CLAIMS = [
    { rx: /\b(?:on|across)\s+hacker\s*news\b/gi, source: 'hackernews', name: 'Hacker News' },
    { rx: /\bover on bluesky\b|\bbluesky\s+(?:users|community|crowd)\b/gi, source: 'bluesky', name: 'Bluesky' },
    { rx: /\bmastodon\s+(?:users|community|crowd|shrugged|reacted)\b/gi, source: 'mastodon', name: 'Mastodon' }
  ];
  for (const { rx, source, name } of PLATFORM_CLAIMS) {
    if (!sourcesPresent.has(source) && rx.test(cleanSummary)) {
      warnings.push(`Mentioned "${name}" but no posts from that platform were in the input — leaving as-is, but flag this.`);
    }
  }

  return { cleanSummary, warnings, replacements };
}
