import { BskyAgent } from '@atproto/api';

export class BlueskySkyClient {
  constructor(handle, password) {
    this.agent = new BskyAgent({ service: 'https://bsky.social' });
    this.handle = handle;
    this.password = password;
  }

  async login() {
    try {
      await this.agent.login({
        identifier: this.handle,
        password: this.password
      });
      console.log('✓ Authenticated with Bluesky');
    } catch (error) {
      console.error('✗ Bluesky authentication failed:', error.message);
      throw error;
    }
  }

  // Hydrate a raw bsky post object into our normalized shape, with derived
  // recency + velocity metrics so we can prefer FRESH posts over stale-but-popular ones.
  _hydratePost(post) {
    const likes = post.likeCount || 0;
    const replies = post.replyCount || 0;
    const reposts = post.repostCount || 0;
    const quotes = post.quoteCount || 0;
    const createdAt = post.record?.createdAt || new Date().toISOString();

    const ageMs = Date.now() - new Date(createdAt).getTime();
    const ageHours = Math.max(ageMs / 36e5, 0.25); // floor at 15min to avoid div-by-zero spikes

    const rawEngagement =
      likes + replies * 2 + reposts * 1.5 + quotes * 2;

    // Velocity = engagement per hour. Rewards fresh posts that are heating up,
    // so a 2h-old post with 5 likes beats a 3-day-old post with 12.
    const velocity = rawEngagement / ageHours;

    return {
      uri: post.uri,
      cid: post.cid,
      author: post.author.handle,
      authorDisplayName: post.author.displayName || post.author.handle,
      text: post.record.text,
      createdAt,
      ageHours,
      likes,
      replies,
      reposts,
      quotes,
      engagement: rawEngagement,
      velocity
    };
  }

  async getPostsFromAccounts(accounts, config) {
    const allPosts = [];
    const maxAgeHours = config.maxAgeHours ?? 24;
    const perAccountLimit = config.maxPostsPerAccount || 10;
    // Fetch more from the feed than we'll keep — we need a wider net before
    // applying the recency cutoff, otherwise low-frequency posters drag in
    // ancient posts as their "last 2".
    const fetchLimit = Math.max(perAccountLimit * 5, 15);

    for (const account of accounts) {
      try {
        console.log(`Fetching posts from ${account}...`);

        const response = await this.agent.app.bsky.feed.getAuthorFeed({
          actor: account,
          limit: fetchLimit,
          filter: 'posts_no_replies' // skip reply noise from author feeds
        });

        const recent = response.data.feed
          .map(item => this._hydratePost(item.post))
          .filter(p => p.ageHours <= maxAgeHours)
          .slice(0, perAccountLimit);

        allPosts.push(...recent);
      } catch (error) {
        console.error(`✗ Failed to fetch posts from ${account}:`, error.message);
      }
    }

    return allPosts;
  }

  async getPostThread(uri) {
    try {
      const response = await this.agent.getPostThread({ uri, depth: 1 });
      return response.data.thread;
    } catch (error) {
      console.error(`✗ Failed to fetch thread for ${uri}:`, error.message);
      return null;
    }
  }

  async searchPosts(query, config) {
    try {
      console.log(`Searching for: ${query}...`);

      const maxAgeHours = config.maxAgeHours ?? 24;
      const since = new Date(Date.now() - maxAgeHours * 36e5);

      const response = await this.agent.app.bsky.feed.searchPosts({
        q: query,
        limit: 25,
        sort: 'top', // 'top' biases toward already-engaging posts; we filter recency below
        since: since.toISOString()
      });

      return response.data.posts
        .map(post => this._hydratePost(post))
        .filter(p => p.ageHours <= maxAgeHours);
    } catch (error) {
      console.error(`✗ Search failed for "${query}":`, error.message);
      return [];
    }
  }

  // Filter + rank with three improvements over the old version:
  //  1. Velocity-aware threshold: a fresh post with proportionally high
  //     engagement passes even if absolute counts are still low.
  //  2. Per-author cap: prevents a single prolific account from dominating
  //     the digest (was a major monotony issue).
  //  3. Source-aware thresholds: a 5-likes Mastodon post is comparable to a
  //     30-likes Bluesky post. Without per-source thresholds, Mastodon/RSS
  //     get filtered out before they reach the LLM.
  //
  //     SOURCE_THRESHOLDS overrides the criteria object for specific sources.
  //     RSS posts have NO engagement signal and pass via velocity only.
  filterPosts(posts, criteria) {
    const DEFAULT = {
      minLikes: criteria.minLikes ?? 0,
      minReplies: criteria.minReplies ?? 0,
      minReposts: criteria.minReposts ?? 0
    };
    // Per-source overrides. Each source has its own engagement "currency":
    //   - Bluesky:   1 like ≈ 1 like (baseline)
    //   - Mastodon:  1 boost ≈ 6 Bluesky likes (much smaller user base)
    //   - HN:        1 point ≈ 5-10 Bluesky likes (front-page = 100+ pts)
    //   - Reddit:    1 upvote ≈ 2 Bluesky likes
    //   - RSS:       no signal — always pass, ride velocity
    //   - GitHub:    stars/forks not directly comparable — always pass
    //   - arXiv:     no signal — always pass
    const SOURCE_THRESHOLDS = {
      bluesky:    { minLikes: DEFAULT.minLikes, minReplies: DEFAULT.minReplies, minReposts: DEFAULT.minReposts },
      mastodon:   { minLikes: 2, minReplies: 0, minReposts: 0 },
      hackernews: { minLikes: 50, minReplies: 0, minReposts: 0 },
      reddit:     { minLikes: 20, minReplies: 2, minReposts: 0 },
      rss:        { minLikes: 0, minReplies: 0, minReposts: 0 },
      github:     { minLikes: 0, minReplies: 0, minReposts: 0 },
      arxiv:      { minLikes: 0, minReplies: 0, minReposts: 0 }
    };

    const minVelocity = criteria.minVelocity ?? 0; // engagement points per hour
    const maxPerAuthor = criteria.maxPostsPerAuthor ?? 2;

    const passes = (p) => {
      const t = SOURCE_THRESHOLDS[p.source] || DEFAULT;
      const absoluteOk =
        p.likes >= t.minLikes &&
        p.replies >= t.minReplies &&
        p.reposts >= t.minReposts;
      // Velocity escape hatch: lets brand-new posts in before they've had
      // time to rack up absolute counts.
      const velocityOk = minVelocity > 0 && p.velocity >= minVelocity;
      return absoluteOk || velocityOk;
    };

    const sorted = posts.filter(passes).sort((a, b) => {
      if (criteria.sortBy === 'recent') {
        return new Date(b.createdAt) - new Date(a.createdAt);
      }
      if (criteria.sortBy === 'velocity') {
        return b.velocity - a.velocity;
      }
      // Default: hybrid score that rewards both raw engagement AND freshness.
      // A 6h-old post with 30 engagement beats a 48h-old post with 30 engagement.
      const scoreA = a.engagement + a.velocity * 3;
      const scoreB = b.engagement + b.velocity * 3;
      return scoreB - scoreA;
    });

    // Enforce per-author diversity.
    const authorCounts = new Map();
    const diverse = [];
    for (const post of sorted) {
      const n = authorCounts.get(post.author) || 0;
      if (n < maxPerAuthor) {
        diverse.push(post);
        authorCounts.set(post.author, n + 1);
      }
    }
    return diverse;
  }

  // Remove posts whose URIs appear in `seenUris` (a Set). Used to prevent
  // the same post from being featured in multiple consecutive digests.
  excludeSeenPosts(posts, seenUris) {
    if (!seenUris || seenUris.size === 0) return posts;
    const before = posts.length;
    const filtered = posts.filter(p => !seenUris.has(p.uri));
    const removed = before - filtered.length;
    if (removed > 0) {
      console.log(`  Excluded ${removed} previously-digested post(s)`);
    }
    return filtered;
  }

  async getTopReplies(posts, limit = 3, maxPostsToProcess = 25) {
    const postsWithReplies = [];

    for (const post of posts.slice(0, maxPostsToProcess)) {
      if (post.replies > 0) {
        try {
          const thread = await this.getPostThread(post.uri);

          if (thread?.replies && thread.replies.length > 0) {
            const topReplies = thread.replies
              .filter(r => r.post)
              .map(r => ({
                text: r.post.record.text,
                author: r.post.author.handle,
                likes: r.post.likeCount || 0,
                engagement: (r.post.likeCount || 0) + (r.post.replyCount || 0) * 2
              }))
              .sort((a, b) => b.engagement - a.engagement)
              .slice(0, limit);

            postsWithReplies.push({ ...post, topReplies });
          } else {
            postsWithReplies.push(post);
          }
        } catch (error) {
          console.error(`✗ Failed to get replies for post:`, error.message);
          postsWithReplies.push(post);
        }
      } else {
        postsWithReplies.push(post);
      }
    }

    return postsWithReplies;
  }
}
