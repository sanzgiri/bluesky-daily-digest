/**
 * HackerNewsClient — pulls recent high-signal stories using the
 * Algolia HN API. Completely public, no key.
 * Docs: https://hn.algolia.com/api
 */
export class HackerNewsClient {
  constructor({ userAgent = 'bluesky-daily-digest/2.0' } = {}) {
    this.base = 'https://hn.algolia.com/api/v1';
    this.userAgent = userAgent;
  }

  async _json(url) {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': this.userAgent }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }

  _hydrateHit(hit) {
    const createdAt = new Date(hit.created_at_i * 1000).toISOString();
    const ageHours = Math.max((Date.now() - hit.created_at_i * 1000) / 36e5, 0.25);
    const points = hit.points || 0;
    const comments = hit.num_comments || 0;
    // HN: 1 upvote ≈ 1 like, 1 comment ≈ 2 reply-equivalents.
    const engagement = points + comments * 2;

    const text = hit.title +
      (hit.story_text ? `\n\n${hit.story_text.slice(0, 400)}` : '');
    const url = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;

    return {
      source: 'hackernews',
      uri: `hn://${hit.objectID}`,
      url,
      hnDiscussionUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      author: hit.author || 'anonymous',
      authorDisplayName: `${hit.author} on HN`,
      text,
      createdAt,
      ageHours,
      likes: points,
      replies: comments,
      reposts: 0,
      quotes: 0,
      engagement,
      velocity: engagement / ageHours
    };
  }

  /**
   * Get front-page-quality stories from the last `hours` hours.
   * Uses search_by_date + numericFilters to set a minimum points threshold,
   * which is a good proxy for "this would have hit the front page".
   */
  async getTopStories({ hours = 24, minPoints = 50, limit = 30 } = {}) {
    const since = Math.floor((Date.now() - hours * 36e5) / 1000);
    const url =
      `${this.base}/search_by_date?tags=story` +
      `&numericFilters=created_at_i>${since},points>${minPoints}` +
      `&hitsPerPage=${limit}`;
    try {
      const data = await this._json(url);
      return (data.hits || []).map(h => this._hydrateHit(h));
    } catch (err) {
      console.error(`  ✗ [hn] getTopStories: ${err.message}`);
      return [];
    }
  }

  /** Search for stories matching a keyword in the last `hours` hours. */
  async search(query, { hours = 24, minPoints = 20, limit = 15 } = {}) {
    const since = Math.floor((Date.now() - hours * 36e5) / 1000);
    const url =
      `${this.base}/search?query=${encodeURIComponent(query)}&tags=story` +
      `&numericFilters=created_at_i>${since},points>${minPoints}` +
      `&hitsPerPage=${limit}`;
    try {
      const data = await this._json(url);
      return (data.hits || []).map(h => this._hydrateHit(h));
    } catch (err) {
      console.error(`  ✗ [hn] search "${query}": ${err.message}`);
      return [];
    }
  }

  /**
   * Get Show HN stories (developers showcasing their projects).
   * High signal-to-noise — these are real built things, not just news.
   * Algolia tag: 'show_hn'
   */
  async getShowHN({ hours = 48, minPoints = 30, limit = 15 } = {}) {
    const since = Math.floor((Date.now() - hours * 36e5) / 1000);
    const url =
      `${this.base}/search_by_date?tags=show_hn` +
      `&numericFilters=created_at_i>${since},points>${minPoints}` +
      `&hitsPerPage=${limit}`;
    try {
      console.log(`  [hn] Show HN (last ${hours}h, ≥${minPoints} pts)...`);
      const data = await this._json(url);
      return (data.hits || []).map(h => this._hydrateHit(h));
    } catch (err) {
      console.error(`  ✗ [hn] getShowHN: ${err.message}`);
      return [];
    }
  }

  /**
   * Get Ask HN posts (community discussion threads).
   * Lower volume, higher conversation depth than top stories.
   */
  async getAskHN({ hours = 48, minPoints = 30, limit = 10 } = {}) {
    const since = Math.floor((Date.now() - hours * 36e5) / 1000);
    const url =
      `${this.base}/search_by_date?tags=ask_hn` +
      `&numericFilters=created_at_i>${since},points>${minPoints}` +
      `&hitsPerPage=${limit}`;
    try {
      console.log(`  [hn] Ask HN (last ${hours}h, ≥${minPoints} pts)...`);
      const data = await this._json(url);
      return (data.hits || []).map(h => this._hydrateHit(h));
    } catch (err) {
      console.error(`  ✗ [hn] getAskHN: ${err.message}`);
      return [];
    }
  }
}
