---
layout: default
title: About
permalink: /about/
---

# About Daily Digest

A reading habit, automated.

## What is this?

Every morning at 8 AM UTC, this site pulls posts from across the open social web — **Bluesky**, **Mastodon**, **Hacker News**, **Reddit**, and a curated list of RSS feeds — filters them by engagement and recency, deduplicates cross-platform stories, and feeds the survivors to **Claude Haiku** for a 5-minute synthesis.

The goal: catch the day's signal without spending an hour scrolling.

## How it works

1. **Ingest** — Pull 100-200 posts from ~5 sources via official APIs
2. **Filter** — Keep only posts with real engagement (likes, replies, upvotes) AND from the last 24 hours
3. **Cluster** — Group posts that link to the same story across platforms
4. **Rank** — Score by engagement velocity, novelty vs prior digests, and cross-platform reach
5. **Summarize** — Top 15 posts → Claude Haiku → narrative summary with citations
6. **Fact-check** — Regex pass strips fabricated numbers
7. **Publish** — Markdown digest → this site + RSS feed + (optionally) email

## What sources?

<p>
  <span class="source-pill bluesky">🦋 Bluesky</span>
  <span class="source-pill mastodon">🐘 Mastodon</span>
  <span class="source-pill hn">🟠 Hacker News</span>
  <span class="source-pill reddit">👽 Reddit</span>
  <span class="source-pill rss">📰 Blogs</span>
</p>

**Bluesky** & **Mastodon**: Curated lists of journalists, technologists, and analysts.
**Hacker News**: Top stories with 100+ points from the last 24h.
**Reddit**: Curated subs — `r/LocalLLaMA`, `r/MachineLearning`, `r/programming`, `r/dataengineering`, `r/ExperiencedDevs`, `r/devops`, `r/rust`, `r/selfhosted`.
**Blogs**: Stratechery (free), Latent Space, One Useful Thing, Interconnects, Simon Willison's blog.

## How much does it cost?

About **$0.40/year** to run — that's all-in cloud cost for the LLM + zero infrastructure cost (GitHub Actions free tier + GitHub Pages free hosting).

## Open source

[Source code on GitHub](https://github.com/sanzgiri/bluesky-daily-digest). MIT licensed. Steal it, fork it, run your own.

## Subscribe

- [RSS feed]({{ '/feed.xml' | relative_url }}) — works with any reader
- [Newer posts on the archive →]({{ '/' | relative_url }})
