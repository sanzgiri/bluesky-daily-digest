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
 *   - It's from an over-represented TOPIC category (variety matters)
 *   - Its text is too short to extract a meaningful quote from
 */

const SOURCE_BASE = {
  bluesky: 1.0,
  mastodon: 1.0,
  hackernews: 1.2,   // HN comments tend to be substantive
  reddit: 1.1,       // Reddit threads have rich top comments
  rss: 1.4,          // blog posts are full articles, high signal density
  github: 1.15,      // GitHub trending = real shipped projects, but no discussion
  arxiv: 1.3         // arXiv = primary source for the AI discourse, deserves boost
};

/**
 * Topic categorization — lightweight keyword-based bucketing.
 * Used to enforce variety: if 10 of 15 posts are 'ai', cap at 6.
 */
const CATEGORY_KEYWORDS = {
  ai: ['ai', 'llm', 'gpt', 'claude', 'gemini', 'openai', 'anthropic', 'chatgpt',
       'neural', 'model', 'training', 'machine learning', 'artificial intelligence',
       'transformer', 'embedding', 'inference', 'prompt', 'agent', 'agentic',
       'mistral', 'llama', 'qwen', 'deepseek', 'hallucinat', 'rag', 'genai'],
  politics: ['trump', 'biden', 'congress', 'senate', 'election', 'gop', 'democrat',
             'republican', 'vote', 'voter', 'campaign', 'rally', 'protest',
             'president', 'governor', 'mayor', 'legislation', 'bill ',
             'no kings', 'maga', 'antifa', 'supreme court', 'scotus'],
  policy: ['regulation', 'fcc', 'ftc', 'doj', 'eu ', 'european', 'antitrust',
           'gdpr', 'privacy', 'census', 'bureau', 'agency', 'compliance',
           'lawsuit', 'sued', 'court', 'ruling', 'judge', 'subpoena', 'evidence'],
  immigration: ['ice ', 'dhs', 'border', 'immigrant', 'deportation', 'asylum',
                'refugee', 'visa', 'citizenship'],
  business: ['ipo', 'acquisition', 'merger', 'funding', 'raised', 'startup',
             'valuation', 'revenue', 'profit', 'layoff', 'earnings', 'stock',
             'shares', 'market cap', 'investor', 'venture'],
  crypto: ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'blockchain', 'defi',
           'nft', 'web3', 'token'],
  science: ['research', 'study', 'discovered', 'breakthrough', 'physics',
            'biology', 'chemistry', 'medicine', 'cancer', 'drug', 'climate',
            'arxiv', 'paper', 'experiment'],
  dev: ['rust', 'python', 'javascript', 'typescript', 'golang', 'kubernetes',
        'docker', 'aws', 'azure', 'devops', 'kernel', 'linux', 'github',
        'open source', 'foss', 'compiler', 'database', 'sql', 'postgres'],
  culture: ['film', 'movie', 'tv', 'show', 'book', 'novel', 'music', 'album',
            'artist', 'museum', 'celebrity', 'hollywood', 'director']
};

function categorize(post) {
  const text = (post.text || '').toLowerCase();
  const scores = {};
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    let matches = 0;
    for (const kw of kws) if (text.includes(kw)) matches++;
    if (matches > 0) scores[cat] = matches;
  }
  if (Object.keys(scores).length === 0) return 'other';
  return Object.entries(scores).sort(([,a], [,b]) => b - a)[0][0];
}

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

function authorDiversityPenalty(post, alreadyPicked) {
  // Diminishing returns for additional posts from same author
  const sameAuthor = alreadyPicked.filter(p => p.author === post.author).length;
  return Math.pow(0.5, sameAuthor); // 1st: 1.0, 2nd: 0.5, 3rd: 0.25
}

function categoryDiversityPenalty(post, alreadyPicked, maxPerCategoryRatio = 0.4) {
  // Once a category fills its quota (e.g. 40% of k), additional posts in
  // that category get heavily penalized to force variety.
  const cat = post._category || categorize(post);
  const sameCat = alreadyPicked.filter(p => (p._category || categorize(p)) === cat).length;
  // Soft penalty as we approach quota, hard cliff after
  const targetMax = Math.ceil((alreadyPicked.length + 1) * maxPerCategoryRatio) + 1;
  if (sameCat < targetMax) return 1.0;
  // Steep penalty for going over quota — not zero so we don't break ties wrong
  return Math.pow(0.25, sameCat - targetMax + 1);
}

/**
 * Score a single post on an UNBOUNDED scale (no longer capped at 100).
 * Removing the cap is critical: when scores saturate at 100, the diversity
 * penalty can't differentiate posts, and the LLM gets a homogeneous batch.
 */
export function scorePost(post, { recentTopicTitles = [] } = {}) {
  const sourceWeight = SOURCE_BASE[post.source] || 1.0;
  const velocityScore = Math.log1p(post.velocity || 0) * 8;
  const engagementScore = Math.log1p(post.engagement || 0) * 5;
  const novelty = noveltyScore(post, recentTopicTitles);
  const context = contextScore(post);

  return (velocityScore + engagementScore) * sourceWeight * novelty * context;
}

/**
 * Greedy selector with both author AND category diversity.
 * Pre-categorizes all posts so we don't re-run the keyword pass repeatedly.
 */
export function selectTopK(posts, k, { recentTopicTitles = [], maxPerCategoryRatio = 0.4 } = {}) {
  const scored = posts.map(p => {
    const _category = categorize(p);
    return {
      post: { ...p, _category },
      baseScore: scorePost(p, { recentTopicTitles })
    };
  });

  const picked = [];
  const remaining = [...scored];

  while (picked.length < k && remaining.length > 0) {
    remaining.forEach(r => {
      const aPen = authorDiversityPenalty(r.post, picked.map(p => p.post));
      const cPen = categoryDiversityPenalty(r.post, picked.map(p => p.post), maxPerCategoryRatio);
      r.adjustedScore = r.baseScore * aPen * cPen;
    });
    remaining.sort((a, b) => b.adjustedScore - a.adjustedScore);
    const winner = remaining.shift();
    picked.push(winner);
  }

  // Log category distribution so it's visible in workflow logs
  const catCounts = {};
  picked.forEach(p => { catCounts[p.post._category] = (catCounts[p.post._category] || 0) + 1; });
  console.log('  category mix:', Object.entries(catCounts).map(([c, n]) => `${c}:${n}`).join(' '));

  return picked.map(p => ({ ...p.post, _digestScore: p.adjustedScore }));
}
