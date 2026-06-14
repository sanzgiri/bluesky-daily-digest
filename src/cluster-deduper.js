/**
 * ClusterDeduper — groups posts that are clearly about the same thing across
 * different sources into a single "story" with multiple citations.
 *
 * Example: a Hacker News submission of an Anthropic blog post + a Bluesky
 * thread quoting the same blog + the original RSS post itself = ONE story
 * with three citations, not three competing topics.
 *
 * Strategy:
 *   1. Extract canonical "link signatures" from each post — the outbound URLs
 *      (HN submissions link to the article; Bluesky/Mastodon often quote a URL;
 *      RSS items ARE the article).
 *   2. Cluster posts sharing any signature URL.
 *   3. Within a cluster, pick a "primary" post (the one with the longest text
 *      / most engagement) and attach the others as `relatedSources`.
 *
 * The downstream summarizer treats `relatedSources` as bonus citations and
 * gets a clear "this story is on N platforms" signal — exactly the
 * cross-platform tension we want.
 */

// Domains that are noise — sharing a link to youtube.com or github.com doesn't
// mean two posts are about the same THING, just that they both happened to
// mention that domain. We cluster on the full URL path, but ignore bare domains.
const NOISE_HOSTS = new Set([
  'twitter.com', 'x.com', 'bsky.app', 'mastodon.social',
  'youtube.com', 'youtu.be', 'github.com', 'reddit.com',
  'news.ycombinator.com', 't.co', 'bit.ly', 'tinyurl.com'
]);

function extractCanonicalUrls(text, post) {
  const urls = new Set();

  // 1. The post's own outbound URL (HN, RSS — these ARE article URLs)
  if (post.source === 'hackernews' && post.url && !post.url.includes('news.ycombinator.com')) {
    urls.add(normalizeUrl(post.url));
  }
  if (post.source === 'rss' && post.url) {
    urls.add(normalizeUrl(post.url));
  }

  // 2. URLs embedded in post text (Bluesky/Mastodon quoting articles)
  const urlRegex = /https?:\/\/[^\s<>"')]+/gi;
  const matches = text.match(urlRegex) || [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:!?)\]'"]+$/, ''); // trailing punctuation
    const normalized = normalizeUrl(cleaned);
    if (normalized) urls.add(normalized);
  }
  return urls;
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Strip tracking params
    const tracking = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
                      'utm_content', 'ref', 'ref_src', 'share', 'fbclid', 'gclid', 'mc_cid'];
    for (const p of tracking) u.searchParams.delete(p);
    // Lowercase host, strip trailing slash from path
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (NOISE_HOSTS.has(host)) return null; // don't cluster on noise hosts
    const path = u.pathname.replace(/\/$/, '') || '/';
    const search = u.searchParams.toString();
    return `${host}${path}${search ? '?' + search : ''}`;
  } catch {
    return null;
  }
}

export function clusterPosts(posts) {
  // Build URL → [postIndex] index
  const urlToPosts = new Map();
  const postUrls = posts.map(p => extractCanonicalUrls(p.text || '', p));

  postUrls.forEach((urls, idx) => {
    for (const url of urls) {
      if (!urlToPosts.has(url)) urlToPosts.set(url, []);
      urlToPosts.get(url).push(idx);
    }
  });

  // Union-find to merge transitive clusters
  // (if A↔B share url1 and B↔C share url2, A↔C are in the same cluster)
  const parent = posts.map((_, i) => i);
  const find = (i) => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const union = (a, b) => { parent[find(a)] = find(b); };

  for (const indices of urlToPosts.values()) {
    if (indices.length < 2) continue;
    for (let i = 1; i < indices.length; i++) union(indices[0], indices[i]);
  }

  // Group by root
  const groups = new Map();
  posts.forEach((_, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  });

  // Build clustered output
  const clustered = [];
  for (const indices of groups.values()) {
    if (indices.length === 1) {
      clustered.push(posts[indices[0]]);
      continue;
    }
    // Multi-post cluster — pick primary by (text length × source weight)
    const SOURCE_WEIGHT = { rss: 1.5, hackernews: 1.3, bluesky: 1.0, mastodon: 1.0 };
    const ranked = indices
      .map(i => ({ post: posts[i], score: (posts[i].text?.length || 0) * (SOURCE_WEIGHT[posts[i].source] || 1) }))
      .sort((a, b) => b.score - a.score);
    const primary = ranked[0].post;
    const related = ranked.slice(1).map(r => ({
      source: r.post.source,
      author: r.post.author,
      authorDisplayName: r.post.authorDisplayName,
      url: r.post.url || r.post.uri,
      excerpt: (r.post.text || '').slice(0, 150),
      likes: r.post.likes,
      replies: r.post.replies
    }));
    clustered.push({
      ...primary,
      relatedSources: related,
      // Boost engagement score: cross-platform = real signal
      engagement: primary.engagement + related.length * 10,
      velocity: primary.velocity + related.length * 2
    });
  }

  return clustered;
}
