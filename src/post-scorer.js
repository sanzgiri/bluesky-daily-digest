/**
 * PostScorer — second-stage ranking that goes beyond raw engagement.
 *
 * The first-stage filter (in BlueskySkyClient) handles "is this engaging
 * enough to consider?" using likes/replies/reposts/velocity thresholds.
 *
 * This stage answers "of the engaging posts, which 15 will produce the
 * best digest?" — and that's a different question. A post can be very
 * engaging but produce mediocre digest content if:
 *   - It has no thread/context (AI has nothing to riff on)
 *   - It's from an over-represented author (diversity matters)
 *   - It duplicates a topic in recent digests (novelty matters)
 *   - Its text is too short to extract a meaningful quote from
 */

const SOURCE_BASE = {
  bluesky: 1.0,
  mastodon: 1.0,
  hackernews: 1.2,   // HN comments tend to be substantive
  rss: 1.4           // blog posts are full articles, high signal density
};

function tokenize(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);
}

function noveltyScore(post, recentTopicTitles) {
  if (!recentTopicTitles?.length) return 1.0;
  const postWords = new Set(tokenize(post.text).slice(0, 30));
  if (postWords.size === 0) return 1.0;
  let maxOverlap = 0;
  for (const title of recentTopicTitles) {
    const titleWords = new Set(tokenize(title));
    let overlap = 0;
    for (const w of titleWords) if (postWords.has(w)) overlap++;
    const ratio = titleWords.size > 0 ? overlap / titleWords.size : 0;
    if (ratio > maxOverlap) maxOverlap = ratio;
  }
  // Penalize posts heavily overlapping with recent titles
  return 1.0 - Math.min(maxOverlap * 0.6, 0.5);
}

function contextScore(post) {
  // Reward posts that give the AI something to work with
  let score = 1.0;
  if (post.topReplies?.length >= 2) score += 0.3;
  else if (post.topReplies?.length === 1) score += 0.1;
  if (post.relatedSources?.length) score += 0.3 * post.relatedSources.length; // cross-platform
  // Penalize tiny posts — hard to quote, hard to summarize
  if ((post.text?.length || 0) < 50) score -= 0.3;
  if ((post.text?.length || 0) > 200) score += 0.15;
  return Math.max(score, 0.3);
}

function diversityPenalty(post, alreadyPicked) {
  // Diminishing returns for additional posts from same author
  const sameAuthor = alreadyPicked.filter(p => p.author === post.author).length;
  return Math.pow(0.6, sameAuthor); // 1st post: 1.0, 2nd: 0.6, 3rd: 0.36
}

/**
 * Score a single post on a unified 0-100 scale.
 * Used for tie-breaking; the actual top-K selection uses greedy diversity.
 */
export function scorePost(post, { recentTopicTitles = [] } = {}) {
  const sourceWeight = SOURCE_BASE[post.source] || 1.0;
  const velocityScore = Math.log1p(post.velocity || 0) * 8; // log to dampen outliers
  const engagementScore = Math.log1p(post.engagement || 0) * 5;
  const novelty = noveltyScore(post, recentTopicTitles);
  const context = contextScore(post);

  const raw = (velocityScore + engagementScore) * sourceWeight * novelty * context;
  return Math.min(raw, 100);
}

/**
 * Greedy selector: pick the top K posts, applying author-diversity penalties
 * after each pick. This avoids the trap of "top 10 posts all from Karpathy".
 */
export function selectTopK(posts, k, { recentTopicTitles = [] } = {}) {
  const scored = posts.map(p => ({
    post: p,
    baseScore: scorePost(p, { recentTopicTitles })
  }));

  const picked = [];
  const remaining = [...scored];

  while (picked.length < k && remaining.length > 0) {
    // Re-score remaining with diversity penalty applied
    remaining.forEach(r => {
      r.adjustedScore = r.baseScore * diversityPenalty(r.post, picked.map(p => p.post));
    });
    remaining.sort((a, b) => b.adjustedScore - a.adjustedScore);
    const winner = remaining.shift();
    picked.push(winner);
  }

  return picked.map(p => ({ ...p.post, _digestScore: p.adjustedScore }));
}
