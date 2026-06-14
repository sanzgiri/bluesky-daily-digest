/**
 * RSSClient — minimalist RSS/Atom feed reader. Many tech voices that
 * formerly posted on Twitter now blog on Substack, personal sites, or
 * fediverse-bridged accounts. Most expose RSS/Atom. No engagement metrics
 * are typically available, so we treat all RSS items as velocity=0 and
 * let recency carry them.
 */
export class RSSClient {
  constructor({ userAgent = 'bluesky-daily-digest/2.0' } = {}) {
    this.userAgent = userAgent;
  }

  async _fetch(url) {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml', 'User-Agent': this.userAgent }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  // Cheap regex-based parser. Works for well-formed RSS 2.0 and Atom feeds,
  // which covers ~all real blogs. Avoids a heavy XML-parser dependency.
  _parse(xml) {
    const items = [];
    const isAtom = /<feed[\s>]/i.test(xml);
    const itemRegex = isAtom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi;

    const pick = (block, tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      if (!m) return '';
      return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    };
    const pickAttr = (block, tag, attr) => {
      const m = block.match(new RegExp(`<${tag}[^>]*\\b${attr}=["']([^"']+)["']`, 'i'));
      return m ? m[1] : '';
    };
    const stripHtml = s => {
      // CRITICAL ordering: decode entities FIRST, then strip tags.
      // Some feeds (e.g. Simon Willison's Atom) escape HTML as &lt;p&gt;
      // instead of using CDATA — if we strip first, tags survive as text.
      const decoded = s
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&'); // amp last to avoid double-decoding
      return decoded
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
        .trim();
    };

    for (const block of xml.match(itemRegex) || []) {
      const title = stripHtml(pick(block, 'title'));
      const link = isAtom ? (pickAttr(block, 'link', 'href') || pick(block, 'id')) : pick(block, 'link');
      const dateStr = isAtom
        ? (pick(block, 'updated') || pick(block, 'published'))
        : pick(block, 'pubDate');
      // pick() already unwraps CDATA; some feeds (e.g. Atom) put HTML in
      // <summary> or <content>, so we must stripHtml the *result*, not just
      // re-strip the outer XML. CDATA can hide HTML from the outer regex.
      const rawDesc = pick(block, 'description') || pick(block, 'summary') || pick(block, 'content');
      const description = stripHtml(rawDesc);
      const author = stripHtml(pick(block, 'dc:creator') || pick(block, 'author') || pick(block, 'name'));
      const createdAt = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
      items.push({ title, link, description, author, createdAt });
    }
    return items;
  }

  _hydrate(item, feedConfig) {
    const ageHours = Math.max((Date.now() - new Date(item.createdAt).getTime()) / 36e5, 0.25);
    const text = item.title + (item.description ? `\n\n${item.description.slice(0, 500)}` : '');
    return {
      source: 'rss',
      uri: item.link,
      url: item.link,
      author: feedConfig.handle || item.author || feedConfig.name,
      authorDisplayName: feedConfig.name || item.author || feedConfig.handle,
      text,
      createdAt: item.createdAt,
      ageHours,
      likes: 0,
      replies: 0,
      reposts: 0,
      quotes: 0,
      engagement: 0,
      // Give RSS items a small baseline velocity so they don't get filtered out
      // by minVelocity gates. Newer items get more.
      velocity: ageHours <= 6 ? 5 : ageHours <= 24 ? 2 : 0.5
    };
  }

  async getPostsFromFeeds(feeds, config) {
    const all = [];
    const maxAgeHours = config.maxAgeHours ?? 24;
    const perFeedLimit = config.maxPostsPerFeed || 3;

    for (const feed of feeds) {
      try {
        console.log(`  [rss] ${feed.name || feed.url}...`);
        const xml = await this._fetch(feed.url);
        const items = this._parse(xml)
          .map(it => this._hydrate(it, feed))
          .filter(p => p.text && p.ageHours <= maxAgeHours)
          .slice(0, perFeedLimit);
        all.push(...items);
      } catch (err) {
        console.error(`  ✗ [rss] ${feed.name || feed.url}: ${err.message}`);
      }
    }
    return all;
  }
}
