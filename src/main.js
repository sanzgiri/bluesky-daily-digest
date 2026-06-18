import fs from 'fs/promises';
import { BlueskySkyClient } from './bluesky-client.js';
import { MastodonClient } from './mastodon-client.js';
import { HackerNewsClient } from './hackernews-client.js';
import { RSSClient } from './rss-client.js';
import { RedditClient } from './reddit-client.js';
import { GitHubTrendingClient } from './github-client.js';
import { Summarizer } from './summarizer.js';
import { EmailSender } from './email-sender.js';
import { DigestSaver } from './digest-saver.js';
import { SeenTracker } from './seen-tracker.js';
import { clusterPosts } from './cluster-deduper.js';
import { selectTopK } from './post-scorer.js';

async function loadEnv() {
  try {
    const envContent = await fs.readFile('.env', 'utf-8');
    envContent.split('\n').forEach(line => {
      const [key, ...values] = line.split('=');
      if (key && values.length > 0) {
        process.env[key.trim()] = values.join('=').trim();
      }
    });
    console.log('✓ Loaded .env file');
  } catch {
    console.log('ℹ️  No .env file found (using environment variables)');
  }
}

async function gatherFromAllSources(config) {
  const sources = config.sources || {};
  const allPosts = [];
  const counts = {};

  // -------- Bluesky --------
  if (sources.bluesky?.enabled !== false && process.env.BLUESKY_HANDLE) {
    console.log('\n── Bluesky ──');
    const bluesky = new BlueskySkyClient(
      process.env.BLUESKY_HANDLE,
      process.env.BLUESKY_PASSWORD
    );
    try {
      await bluesky.login();
      const bskyPosts = await bluesky.getPostsFromAccounts(config.accounts || [], config);
      if (config.searchKeywords?.length) {
        for (const kw of config.searchKeywords) {
          const results = await bluesky.searchPosts(kw, config);
          bskyPosts.push(...results);
        }
      }
      const tagged = bskyPosts.map(p => ({ ...p, source: 'bluesky' }));
      counts.bluesky = tagged.length;
      allPosts.push(...tagged);
      // Stash the client so we can fetch replies later for Bluesky posts only.
      gatherFromAllSources._bluesky = bluesky;
    } catch (err) {
      console.error(`✗ Bluesky stage failed: ${err.message}`);
      counts.bluesky = 0;
    }
  }

  // -------- Mastodon --------
  if (sources.mastodon?.enabled) {
    console.log('\n── Mastodon ──');
    const m = new MastodonClient({ homeInstance: sources.mastodon.homeInstance });
    const mastoConfig = {
      maxAgeHours: config.maxAgeHours,
      maxPostsPerAccount: sources.mastodon.maxPostsPerAccount || 3,
      maxPostsPerHashtag: sources.mastodon.maxPostsPerHashtag || 8
    };
    const mastoPosts = await m.getPostsFromAccounts(sources.mastodon.accounts || [], mastoConfig);
    for (const tag of sources.mastodon.hashtags || []) {
      const tagged = await m.searchHashtag(tag, mastoConfig);
      mastoPosts.push(...tagged);
    }
    counts.mastodon = mastoPosts.length;
    allPosts.push(...mastoPosts);
  }

  // -------- Hacker News --------
  if (sources.hackernews?.enabled) {
    console.log('\n── Hacker News ──');
    const hn = new HackerNewsClient();
    const stories = await hn.getTopStories({
      hours: config.maxAgeHours ?? 24,
      minPoints: sources.hackernews.minPoints ?? 100,
      limit: sources.hackernews.limit ?? 20
    });
    for (const kw of sources.hackernews.keywords || []) {
      const matches = await hn.search(kw, {
        hours: config.maxAgeHours ?? 24,
        minPoints: 30,
        limit: 10
      });
      stories.push(...matches);
    }
    // Show HN — developer-built projects, high signal
    if (sources.hackernews.includeShowHN) {
      const show = await hn.getShowHN({
        hours: (config.maxAgeHours ?? 24) * 2,
        minPoints: sources.hackernews.showHNMinPoints ?? 30,
        limit: sources.hackernews.showHNLimit ?? 10
      });
      stories.push(...show);
    }
    // Ask HN — community discussions
    if (sources.hackernews.includeAskHN) {
      const ask = await hn.getAskHN({
        hours: (config.maxAgeHours ?? 24) * 2,
        minPoints: sources.hackernews.askHNMinPoints ?? 30,
        limit: sources.hackernews.askHNLimit ?? 5
      });
      stories.push(...ask);
    }
    counts.hackernews = stories.length;
    allPosts.push(...stories);
  }

  // -------- RSS --------
  if (sources.rss?.enabled) {
    console.log('\n── RSS ──');
    const r = new RSSClient();
    const rssConfig = {
      maxAgeHours: config.maxAgeHours,
      maxPostsPerFeed: sources.rss.maxPostsPerFeed || 2
    };
    const rssPosts = await r.getPostsFromFeeds(sources.rss.feeds || [], rssConfig);
    counts.rss = rssPosts.length;
    allPosts.push(...rssPosts);
  }

  // -------- Reddit --------
  if (sources.reddit?.enabled) {
    console.log('\n── Reddit ──');
    const reddit = new RedditClient({
      clientId: process.env.REDDIT_CLIENT_ID,
      clientSecret: process.env.REDDIT_CLIENT_SECRET,
      username: process.env.REDDIT_USERNAME,
      password: process.env.REDDIT_PASSWORD
    });
    if (reddit.isConfigured()) {
      try {
        const redditPosts = await reddit.getPostsFromSubs(sources.reddit.subs || [], {
          maxAgeHours: config.maxAgeHours,
          defaultMinScore: sources.reddit.defaultMinScore ?? 50,
          defaultLimit: sources.reddit.defaultLimit ?? 8,
          minUpvoteRatio: sources.reddit.minUpvoteRatio ?? 0.85,
          enrichComments: sources.reddit.enrichComments ?? 8
        });
        counts.reddit = redditPosts.length;
        allPosts.push(...redditPosts);
      } catch (err) {
        console.error(`✗ Reddit failed: ${err.message}`);
        counts.reddit = 0;
      }
    } else {
      console.log('  (REDDIT_* env vars not set, skipping)');
      counts.reddit = 0;
    }
  }

  // -------- GitHub Trending --------
  if (sources.github?.enabled) {
    console.log('\n── GitHub Trending ──');
    const gh = new GitHubTrendingClient();
    try {
      const trending = await gh.getMultiLanguageTrending({
        languages: sources.github.languages || [''],
        since: sources.github.since || 'daily',
        perLanguage: sources.github.perLanguage ?? 5
      });
      counts.github = trending.length;
      allPosts.push(...trending);
    } catch (err) {
      console.error(`✗ GitHub Trending failed: ${err.message}`);
      counts.github = 0;
    }
  }

  return { allPosts, counts };
}

async function main() {
  console.log('🦋 Starting Multi-Source Daily Digest...\n');
  await loadEnv();

  const config = JSON.parse(await fs.readFile('config.json', 'utf-8'));

  // We need ONE of {OPENAI, ANTHROPIC, LOCAL} for LLM; email keys are required for delivery.
  const hasLLM = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.LOCAL_LLM_BASE_URL;
  if (!hasLLM) {
    throw new Error('Missing LLM config: set LOCAL_LLM_BASE_URL (free, local) or ANTHROPIC_API_KEY or OPENAI_API_KEY');
  }
  for (const v of ['SENDGRID_API_KEY', 'SENDER_EMAIL']) {
    if (!process.env[v]) throw new Error(`Missing required env var: ${v}`);
  }

  // Provider precedence: explicit config.preferredProvider > local (if available) > anthropic > openai
  const summarizer = new Summarizer({
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
    localBaseUrl: process.env.LOCAL_LLM_BASE_URL,        // e.g. http://localhost:11434/v1
    localModel: process.env.LOCAL_LLM_MODEL,             // e.g. qwen3:4b
    preferredProvider: config.preferredProvider          // optional override in config.json
  });
  const emailSender = new EmailSender(process.env.SENDGRID_API_KEY, process.env.SENDER_EMAIL);
  const digestSaver = new DigestSaver(config);

  const seenTracker = await new SeenTracker({
    filePath: `${config.localSaving?.outputDirectory || 'digests'}/.seen-posts.json`,
    windowDays: config.seenWindowDays ?? 14
  }).load();

  try {
    // 1. Gather from all sources
    const { allPosts, counts } = await gatherFromAllSources(config);
    console.log('\n📥 Ingestion summary:');
    for (const [src, n] of Object.entries(counts)) {
      console.log(`   ${src.padEnd(12)} ${n} post(s)`);
    }
    console.log(`   ${'TOTAL'.padEnd(12)} ${allPosts.length} post(s)`);

    // 2. De-dupe by URI within run (same post might appear twice across queries)
    const unique = Array.from(new Map(allPosts.map(p => [p.uri, p])).values());

    // 3. Exclude posts featured in recent digests
    const unseen = unique.filter(p => !seenTracker.getSeenUris().has(p.uri));
    if (unique.length !== unseen.length) {
      console.log(`Excluded ${unique.length - unseen.length} previously-digested post(s)`);
    }

    // 4. First-stage filter: engagement/velocity thresholds (source-agnostic)
    const bsky = gatherFromAllSources._bluesky || new BlueskySkyClient('', '');
    const filtered = bsky.filterPosts(unseen, config.filterCriteria);
    console.log(`Posts after engagement filter: ${filtered.length}`);

    if (filtered.length === 0) {
      console.log('⚠️  No posts met filter criteria. Skipping digest.');
      return;
    }

    // 5. Cluster cross-source duplicates (one story shared on HN+RSS+Bluesky → one cluster)
    const clustered = clusterPosts(filtered);
    const clusterReduction = filtered.length - clustered.length;
    if (clusterReduction > 0) {
      console.log(`Clustered ${clusterReduction} duplicate(s) across sources → ${clustered.length} distinct stories`);
    }

    // 6. Fetch Bluesky replies (only platform exposing them) — BEFORE final selection,
    //    so the second-stage scorer can reward posts that have real conversation.
    let postsWithContext = clustered;
    if (gatherFromAllSources._bluesky) {
      const bskyCandidates = clustered.filter(p => p.source === 'bluesky').slice(0, 30);
      if (bskyCandidates.length > 0) {
        const withReplies = await gatherFromAllSources._bluesky.getTopReplies(bskyCandidates, 3, 30);
        const replyMap = new Map(withReplies.map(p => [p.uri, p]));
        postsWithContext = clustered.map(p => replyMap.get(p.uri) || p);
      }
    }

    // 7. Second-stage selection: multi-axis scoring + diversity-aware top-K
    const recentTopics = await digestSaver.getRecentTopicTitles(3);
    const topK = config.topK ?? 15;
    const postsForSummary = selectTopK(postsWithContext, topK, { recentTopicTitles: recentTopics });
    console.log(`Selected top ${postsForSummary.length} by multi-axis score (from ${postsWithContext.length} candidates)`);
    console.log('Top 5 selections:');
    postsForSummary.slice(0, 5).forEach((p, i) => {
      const cross = p.relatedSources?.length ? ` 🌐×${p.relatedSources.length}` : '';
      console.log(`  ${i+1}. [${p.source}${cross}] @${p.author} (score=${p._digestScore?.toFixed(1)}) — ${p.text.slice(0, 60).replace(/\n/g,' ')}`);
    });

    // 8. Generate summary (multi-source-aware prompt + few-shot + fact-check)
    const { summary, metadata } = await summarizer.generateSummary(
      postsForSummary,
      {
        ...config,
        _recentTopicTitles: recentTopics,
        _sourceCounts: counts
      }
    );

    const costReport = summarizer.getCostReport();
    console.log(`\n💰 Total cost: $${costReport.totalCost.toFixed(4)}`);
    if (!summarizer.checkBudget(config.dailyCostBudget)) {
      console.error('⚠️  Daily cost budget exceeded!');
    }

    // 7. Email (optional, non-blocking) — only attempts if config.email.enabled is true
    if (config.email?.enabled && config.emailRecipients?.length && process.env.SENDGRID_API_KEY) {
      try {
        const subject = `🦋 Your Daily Digest - ${new Date().toLocaleDateString()}`;
        await emailSender.send(config.emailRecipients, subject, summary, summary, costReport);
        console.log('\n✓ Email sent successfully');
      } catch (err) {
        console.error('\n⚠️  Email sending failed:', err.message);
      }
    } else {
      console.log('\nℹ️  Email disabled (set config.email.enabled=true to send)');
    }

    // 8. Save digest
    await digestSaver.saveDigest(summary, metadata, costReport, filtered.length);

    // 9. Record seen URIs
    await seenTracker.record(postsForSummary.map(p => p.uri));
    console.log(`✓ Recorded ${postsForSummary.length} URI(s) as seen`);

    // 10. Cost report
    await fs.writeFile('cost-report.json', JSON.stringify({
      date: new Date().toISOString(),
      postsAnalyzed: filtered.length,
      sourceCounts: counts,
      ...costReport,
      ...metadata,
      budgetRemaining: config.dailyCostBudget - costReport.totalCost
    }, null, 2));

    console.log('\n✅ Digest completed successfully!');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    throw err;
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
