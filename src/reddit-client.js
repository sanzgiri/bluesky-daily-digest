/**
 * RedditClient — fetches recent high-signal posts from curated subreddits
 * via Reddit's OAuth2 "script" app flow (free, no paid tier).
 *
 * Setup (one-time, 3 min):
 *   1. Visit https://www.reddit.com/prefs/apps
 *   2. Click "create another app..." at the bottom
 *   3. Choose type: "script"
 *   4. Name: anything (e.g. "daily-digest")
 *   5. About URL: blank
 *   6. Redirect URI: http://localhost:8080 (required but unused for script apps)
 *   7. Click "create app"
 *   8. The string under your app name = REDDIT_CLIENT_ID
 *      The "secret" field                = REDDIT_CLIENT_SECRET
 *   9. Add to .env:
 *        REDDIT_CLIENT_ID=...
 *        REDDIT_CLIENT_SECRET=...
 *        REDDIT_USERNAME=your_reddit_username
 *        REDDIT_PASSWORD=your_reddit_password
 *
 * Why script app (vs application-only)?
 *   - Application-only OAuth is rate-limited harder (10 req/min) and can't
 *     read some private/quarantined subs.
 *   - Script flow gives 60 req/min and full read access.
 *   - No actual writes happen — we only read /top.
 *
 * Auth token is cached in memory for ~1 hour (token lifetime).
 */
export class RedditClient {
  constructor({
    clientId,
    clientSecret,
    username,
    password,
    userAgent = 'bluesky-daily-digest/2.0'
  } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.username = username;
    this.password = password;
    this.userAgent = userAgent;

    this.token = null;
    this.tokenExpiresAt = 0;
  }

  isConfigured() {
    return !!(this.clientId && this.clientSecret && this.username && this.password);
  }

  async _getToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'User-Agent': this.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: this.username,
        password: this.password
      }).toString()
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Reddit auth failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data.access_token) throw new Error(`Reddit auth: no access_token in response`);
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    console.log(`✓ Reddit authenticated (token valid ${Math.round((data.expires_in || 3600) / 60)} min)`);
    return this.token;
  }

  async _apiGet(path) {
    const token = await this._getToken();
    const url = `https://oauth.reddit.com${path}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': this.userAgent
      }
    });
    if (!res.ok) {
      throw new Error(`Reddit API ${res.status} for ${path}`);
    }
    return res.json();
  }

  // Strip Reddit's HTML escaping in selftext_html and decode common entities.
  _cleanText(s) {
    if (!s) return '';
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x?[0-9a-fA-F]+;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  _hydratePost(child, subreddit) {
    const d = child.data;
    const createdAt = new Date(d.created_utc * 1000).toISOString();
    const ageHours = Math.max((Date.now() - d.created_utc * 1000) / 36e5, 0.25);
    const score = d.score || 0;
    const comments = d.num_comments || 0;
    const upvoteRatio = d.upvote_ratio ?? 1;

    // Build the body: title is mandatory, selftext optional, link target adds context.
    let text = d.title;
    if (d.selftext) text += `\n\n${this._cleanText(d.selftext).slice(0, 500)}`;

    // For link posts (not self-posts), the actual content URL is what matters.
    // For text posts, the permalink is the discussion.
    const isLink = !d.is_self && d.url && !d.url.includes('reddit.com');
    const url = isLink ? d.url : `https://www.reddit.com${d.permalink}`;
    const discussionUrl = `https://www.reddit.com${d.permalink}`;

    // Engagement: Reddit upvotes are roughly comparable to Bluesky likes;
    // comments on Reddit are typically high-signal so weight them generously.
    const engagement = score + comments * 2.5;

    return {
      source: 'reddit',
      uri: `reddit://${d.id}`,
      url,                          // for citation
      discussionUrl,                // for "see the thread"
      author: d.author || '[deleted]',
      authorDisplayName: `${d.author} in r/${subreddit}`,
      subreddit,
      text,
      createdAt,
      ageHours,
      likes: score,
      replies: comments,
      reposts: 0,
      quotes: 0,
      upvoteRatio,
      isLink,
      engagement,
      velocity: engagement / ageHours
    };
  }

  /**
   * Get top posts of the last `hours` window from a single subreddit.
   * Filters out obvious low-quality content (controversial, no comments,
   * sub-threshold scores).
   */
  async getTopFromSub(subreddit, {
    hours = 24,
    minScore = 50,
    minUpvoteRatio = 0.85,
    limit = 10
  } = {}) {
    // Reddit's "t" param: hour|day|week. For ≤24h we use "day".
    const t = hours <= 24 ? 'day' : hours <= 168 ? 'week' : 'month';
    try {
      const data = await this._apiGet(`/r/${subreddit}/top?t=${t}&limit=${limit}`);
      const children = data?.data?.children || [];

      const maxAgeMs = hours * 36e5;
      return children
        .filter(c => {
          const d = c.data;
          if (!d) return false;
          if (d.stickied) return false;            // mod-pinned, usually meta
          if (d.over_18) return false;             // skip NSFW
          if (d.is_video) return false;            // skip video-only
          if ((Date.now() - d.created_utc * 1000) > maxAgeMs) return false;
          if ((d.score || 0) < minScore) return false;
          if ((d.upvote_ratio ?? 1) < minUpvoteRatio) return false;
          // Discussion-only posts (no link, no body) with few comments are noise.
          if (d.is_self && !d.selftext && (d.num_comments || 0) < 20) return false;
          return true;
        })
        .map(c => this._hydratePost(c, subreddit));
    } catch (err) {
      console.error(`  ✗ [reddit] r/${subreddit}: ${err.message}`);
      return [];
    }
  }

  /**
   * Fetch top 2-3 comments for high-engagement posts.
   * Reddit's value is often in the comments, not the OP.
   */
  async attachTopComments(post, { limit = 2 } = {}) {
    try {
      // Extract post id from uri ("reddit://abc123")
      const postId = post.uri.replace('reddit://', '');
      const data = await this._apiGet(`/comments/${postId}?limit=${limit + 3}&sort=top&depth=1`);
      // Response is [postListing, commentListing]
      const commentChildren = data?.[1]?.data?.children || [];
      const topComments = commentChildren
        .filter(c => c.kind === 't1' && c.data && !c.data.stickied)
        .slice(0, limit)
        .map(c => ({
          author: c.data.author || '[deleted]',
          text: this._cleanText(c.data.body || '').slice(0, 300),
          likes: c.data.score || 0,
          engagement: (c.data.score || 0) + (c.data.replies?.data?.children?.length || 0)
        }))
        .filter(c => c.text.length > 20);
      return { ...post, topReplies: topComments };
    } catch (err) {
      return post;
    }
  }

  /**
   * Pull posts from a list of subreddits with per-sub thresholds.
   * Optionally enriches top posts with their top comments.
   */
  async getPostsFromSubs(subs, config = {}) {
    if (!this.isConfigured()) {
      console.log('  [reddit] not configured (missing REDDIT_* env vars), skipping');
      return [];
    }
    const maxAgeHours = config.maxAgeHours ?? 24;
    const all = [];

    for (const sub of subs) {
      // sub can be a string OR {name, minScore, limit}
      const name = typeof sub === 'string' ? sub : sub.name;
      const minScore = (typeof sub === 'object' && sub.minScore) || config.defaultMinScore || 50;
      const limit = (typeof sub === 'object' && sub.limit) || config.defaultLimit || 10;

      console.log(`  [reddit] r/${name}...`);
      const posts = await this.getTopFromSub(name, {
        hours: maxAgeHours,
        minScore,
        minUpvoteRatio: config.minUpvoteRatio ?? 0.85,
        limit
      });
      all.push(...posts);
    }

    // Attach top comments to the strongest posts only (rate limit budget)
    const enrichCount = Math.min(config.enrichComments ?? 8, all.length);
    if (enrichCount > 0) {
      const sorted = [...all].sort((a, b) => b.engagement - a.engagement);
      const toEnrich = new Set(sorted.slice(0, enrichCount).map(p => p.uri));
      for (let i = 0; i < all.length; i++) {
        if (toEnrich.has(all[i].uri)) {
          all[i] = await this.attachTopComments(all[i], { limit: 2 });
        }
      }
    }

    return all;
  }
}
