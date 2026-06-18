/**
 * GitHubTrendingClient \u2014 scrapes github.com/trending HTML.
 *
 * GitHub doesn't expose trending repos via API. The HTML page is stable and
 * well-structured, so a light scraper works. We extract:
 *   - repo full name (owner/repo)
 *   - description
 *   - language
 *   - total stars
 *   - "stars today/this week" delta
 *   - URL
 *
 * Output is shaped like other source clients so it flows through the same
 * filter \u2192 cluster \u2192 score \u2192 LLM pipeline without special-casing.
 */
export class GitHubTrendingClient {
  constructor({ userAgent = 'bluesky-daily-digest/2.0' } = {}) {
    this.userAgent = userAgent;
  }

  async _fetch(url) {
    const res = await fetch(url, { headers: { 'User-Agent': this.userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  // Cheap HTML parser \u2014 grabs <article class="Box-row"> blocks then pulls
  // structured bits with regex. The trending page layout has been stable
  // for years; if GH ever changes it, this is the only place to update.
  _parse(html) {
    const repos = [];
    const articleRx = /<article class="Box-row"[\s\S]*?<\/article>/g;

    for (const block of html.match(articleRx) || []) {
      // Repo name: <h2><a href="/owner/repo">owner / repo</a></h2>
      const nameMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"]+)"/);
      if (!nameMatch) continue;
      const fullName = nameMatch[1].trim();
      if (fullName.includes('/') === false) continue;

      // Description: <p class="col-9 ...">desc</p>
      const descMatch = block.match(/<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
      const description = descMatch ? this._cleanText(descMatch[1]) : '';

      // Language: <span itemprop="programmingLanguage">JavaScript</span>
      const langMatch = block.match(/<span itemprop="programmingLanguage">([^<]+)<\/span>/);
      const language = langMatch ? langMatch[1].trim() : null;

      // Total stars: <a href="/owner/repo/stargazers" ...>12,345</a>
      const totalStarsMatch = block.match(/href="\/[^"]+\/stargazers"[\s\S]*?>\s*([\d,]+)\s*</);
      const totalStars = totalStarsMatch ? parseInt(totalStarsMatch[1].replace(/,/g, ''), 10) : 0;

      // Stars in period (today / this week / this month). GH wraps this in
      // <span ... class="d-inline-block float-sm-right">N,NNN stars today</span>.
      // The class attribute can appear in any order with other attrs, so we
      // match the class substring loosely, then pull the trailing "N stars X".
      const periodStarsMatch = block.match(/class="[^"]*d-inline-block float-sm-right[^"]*"[^>]*>([\s\S]*?)<\/span>/);
      const periodStarsText = periodStarsMatch ? this._cleanText(periodStarsMatch[1]) : '';
      const periodStars = parseInt((periodStarsText.match(/([\d,]+)\s*stars?/) || [0, '0'])[1].replace(/,/g, ''), 10);

      repos.push({
        fullName,
        description,
        language,
        totalStars,
        periodStars,
        periodStarsText,
        url: `https://github.com/${fullName}`
      });
    }
    return repos;
  }

  _cleanText(s) {
    return s
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Map GH repo \u2192 our standard post shape. We don't have a "post" per se,
  // so we synthesize one: text = "{name}: {desc} \u2014 {stars} stars today".
  _hydrate(repo, period) {
    // Use periodStars as our "engagement" signal \u2014 it's the velocity
    // metric for trending. A repo with 500 stars today is hot regardless
    // of its total stargazer count.
    const engagement = repo.periodStars;
    // Synthesize a created-at date \u2014 trending is by definition recent.
    const createdAt = new Date(Date.now() - 12 * 36e5).toISOString();
    const langTag = repo.language ? ` [${repo.language}]` : '';
    const text = `${repo.fullName}${langTag}: ${repo.description}\n\n\ud83d\udcc8 ${repo.periodStarsText || repo.periodStars + ' stars'} \u2022 \u2b50 ${repo.totalStars.toLocaleString()} total`;

    return {
      source: 'github',
      uri: `github://${repo.fullName}`,
      url: repo.url,
      author: repo.fullName.split('/')[0],
      authorDisplayName: repo.fullName,
      text,
      createdAt,
      ageHours: 12,
      likes: engagement,     // periodStars maps to "likes" for the scorer
      replies: 0,
      reposts: 0,
      quotes: 0,
      engagement,
      velocity: engagement / 12  // stars per hour over the trending period
    };
  }

  /**
   * Fetch trending repos.
   * @param {Object} opts
   * @param {string} [opts.since='daily']  'daily' | 'weekly' | 'monthly'
   * @param {string} [opts.language='']    e.g. 'python', 'rust', 'typescript'
   * @param {number} [opts.limit=10]       Max repos to return
   */
  async getTrending({ since = 'daily', language = '', limit = 10 } = {}) {
    const langPath = language ? `/${encodeURIComponent(language)}` : '';
    const url = `https://github.com/trending${langPath}?since=${since}`;
    try {
      console.log(`  [github] trending${language ? ` (${language})` : ''} \u00b7 ${since}...`);
      const html = await this._fetch(url);
      const repos = this._parse(html)
        .slice(0, limit)
        .map(r => this._hydrate(r, since));
      return repos;
    } catch (err) {
      console.error(`  \u2717 [github] getTrending: ${err.message}`);
      return [];
    }
  }

  // Convenience: pull trending across multiple language slices for diversity.
  async getMultiLanguageTrending({ languages = [''], since = 'daily', perLanguage = 5 } = {}) {
    const all = [];
    for (const lang of languages) {
      const repos = await this.getTrending({ since, language: lang, limit: perLanguage });
      all.push(...repos);
    }
    // De-dupe (same repo can appear in 'all languages' AND 'python', etc.)
    const seen = new Set();
    return all.filter(r => seen.has(r.uri) ? false : (seen.add(r.uri), true));
  }
}
