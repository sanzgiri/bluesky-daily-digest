import fs from 'fs/promises';
import path from 'path';

/**
 * Tracks which post URIs have already been featured in previous digests,
 * so the same posts don't get recycled day after day (the main "stale
 * content" bug in v1).
 *
 * Persists to a small JSON file under the digests directory. Keeps a
 * rolling window (default 14 days) so the file doesn't grow forever and
 * so genuinely evergreen posts can eventually resurface.
 */
export class SeenTracker {
  constructor({ filePath = 'digests/.seen-posts.json', windowDays = 14 } = {}) {
    this.filePath = filePath;
    this.windowDays = windowDays;
    this.entries = []; // [{ uri, seenAt }]
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      const cutoff = Date.now() - this.windowDays * 24 * 36e5;
      this.entries = (data.entries || []).filter(e => new Date(e.seenAt).getTime() >= cutoff);
      console.log(`✓ Loaded ${this.entries.length} previously-seen post(s)`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`  Could not load seen-posts file: ${err.message}`);
      }
      this.entries = [];
    }
    return this;
  }

  getSeenUris() {
    return new Set(this.entries.map(e => e.uri));
  }

  async record(uris) {
    const now = new Date().toISOString();
    const existing = new Set(this.entries.map(e => e.uri));
    for (const uri of uris) {
      if (!existing.has(uri)) {
        this.entries.push({ uri, seenAt: now });
      }
    }
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      JSON.stringify({ entries: this.entries }, null, 2),
      'utf-8'
    );
  }
}
