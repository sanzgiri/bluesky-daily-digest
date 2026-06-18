/**
 * MastodonClient — fetches recent posts from any fediverse account
 * using the fully-public Mastodon API. No auth required.
 *
 * Handle format: "user@instance.tld" (e.g. "simon@simonwillison.net").
 * We always issue the lookup against a single "home" instance
 * (default mastodon.social) which can resolve remote accounts via WebFinger.
 */
export class MastodonClient {
  constructor({ homeInstance = 'https://mastodon.social', userAgent = 'bluesky-daily-digest/2.0' } = {}) {
    this.home = homeInstance.replace(/\/$/, '');
    this.userAgent = userAgent;
  }

  async _json(url) {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': this.userAgent }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }

  // Strip HTML tags + decode a few common entities. Mastodon returns content
  // as HTML; we want plain text for the summarizer.
  _stripHtml(html) {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  async lookupAccount(acct) {
    // Normalize: "user" -> "user", "@user@host" -> "user@host"
    const normalized = acct.replace(/^@/, '');
    return this._json(`${this.home}/api/v1/accounts/lookup?acct=${encodeURIComponent(normalized)}`);
  }

  _hydrateStatus(status, sourceHandle) {
    const likes = status.favourites_count || 0;
    const reposts = status.reblogs_count || 0;
    const replies = status.replies_count || 0;
    const createdAt = status.created_at;
    const ageHours = Math.max((Date.now() - new Date(createdAt).getTime()) / 36e5, 0.25);
    const engagement = likes + replies * 2 + reposts * 1.5;

    return {
      source: 'mastodon',
      uri: status.uri,
      url: status.url || status.uri,
      author: sourceHandle,
      authorDisplayName: status.account?.display_name || sourceHandle,
      text: this._stripHtml(status.content),
      createdAt,
      ageHours,
      likes,
      replies,
      reposts,
      quotes: 0,
      engagement,
      velocity: engagement / ageHours
    };
  }

  async getPostsFromAccounts(accounts, config) {
    const all = [];
    const maxAgeHours = config.maxAgeHours ?? 24;
    const perAccountLimit = config.maxPostsPerAccount || 5;
    const fetchLimit = Math.max(perAccountLimit * 4, 20);

    for (const acct of accounts) {
      try {
        console.log(`  [mastodon] ${acct}...`);
        const account = await this.lookupAccount(acct);
        if (!account?.id) continue;

        // Account's home instance is in account.url (e.g. https://fedi.simonwillison.net/@simon).
        // Statuses MUST be fetched from the account's own instance to get full content.
        const homeOfAccount = new URL(account.url).origin;

        // Statuses can be fetched from the account's own instance (best) OR
        // from our home instance's federated cache (more reliable but may lag).
        // We try the home cache *first* because the account id we have is the
        // home-instance id — the remote instance uses a different id scheme.
        const statuses = await this._json(
          `${this.home}/api/v1/accounts/${account.id}/statuses` +
          `?limit=${fetchLimit}&exclude_replies=true&exclude_reblogs=true`
        );

        const recent = statuses
          .map(s => this._hydrateStatus(s, acct))
          .filter(p => p.text && p.ageHours <= maxAgeHours)
          .slice(0, perAccountLimit);

        all.push(...recent);
      } catch (err) {
        console.error(`  ✗ [mastodon] ${acct}: ${err.message}`);
      }
    }
    return all;
  }

  // Hashtag timeline — also fully public.
  async searchHashtag(tag, config) {
    const maxAgeHours = config.maxAgeHours ?? 24;
    const perHashtagLimit = config.maxPostsPerHashtag ?? 8;
    try {
      const statuses = await this._json(
        `${this.home}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=30`
      );
      return statuses
        .map(s => this._hydrateStatus(s, s.account?.acct || 'unknown'))
        .filter(p => p.text && p.ageHours <= maxAgeHours)
        .slice(0, perHashtagLimit);
    } catch (err) {
      console.error(`  ✗ [mastodon] #${tag}: ${err.message}`);
      return [];
    }
  }
}
