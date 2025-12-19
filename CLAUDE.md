# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bluesky Daily Digest is an automated system that fetches posts from Bluesky accounts, filters them by engagement criteria, generates AI-powered summaries using OpenAI, and delivers them via email (SendGrid) and local markdown files. It runs as a scheduled GitHub Action.

## Commands

### Development
```bash
npm install              # Install dependencies
npm start                # Run the digest generator (requires env vars)
npm test                 # Run Node.js tests
```

### Testing Locally
Create a `.env` file with:
```
BLUESKY_HANDLE=your.handle
BLUESKY_PASSWORD=app_password
OPENAI_API_KEY=sk-...
SENDGRID_API_KEY=SG....
SENDER_EMAIL=verified@email.com
```

### GitHub Actions
- Manual trigger: Actions tab → "Daily Digest" → "Run workflow"
- Scheduled: Runs daily at 8:00 AM UTC (configured in `.github/workflows/daily-digest.yml`)

## Architecture

### Main Flow (`src/main.js`)
Orchestrates the entire digest generation pipeline:
1. Load environment variables (`.env` for local, GitHub Secrets for Actions)
2. Authenticate with Bluesky
3. Fetch posts from configured accounts (via `BlueskySkyClient`)
4. Search for keyword-based posts
5. Deduplicate and filter by engagement criteria
6. Fetch top replies for engaging posts
7. Generate AI summary (via `Summarizer`)
8. Send email (via `EmailSender`) - non-blocking, continues on failure
9. Save digest locally (via `DigestSaver`)
10. Generate cost report

### Core Components

**`src/bluesky-client.js` (BlueskySkyClient)**
- Uses `@atproto/api` BskyAgent
- `login()`: Authenticates with Bluesky
- `getPostsFromAccounts()`: Fetches posts from multiple accounts
- `searchPosts()`: Searches for keyword-based posts (last 24 hours)
- `filterPosts()`: Filters by engagement criteria (minLikes, minReplies, minReposts)
- `getTopReplies()`: Fetches and ranks replies for high-engagement posts
- **Engagement scoring**: `likes + (replies * 2) + (reposts * 1.5) + (quotes * 2)`

**`src/summarizer.js` (Summarizer)**
- Uses OpenAI API with `gpt-4o-mini` model
- `generateSummary()`: Creates topic-grouped summaries with citations
- Tracks token usage and calculates costs
- Prompt design: Groups posts into topics, requires citations in format `[— @handle](url)`
- Cost tracking: Uses GPT-4o-mini pricing (as of Oct 2024): $0.00015/1K input tokens, $0.0006/1K output tokens

**`src/email-sender.js` (EmailSender)**
- Uses SendGrid for email delivery
- Generates HTML emails with gradient header, cost badges, and formatted content
- `send()`: Sends to multiple recipients via `sendMultiple()`

**`src/digest-saver.js` (DigestSaver)**
- Saves digests to local markdown files in `digests/` directory
- Filename format: `bluesky-digest-YYYY-MM-DD-HH-MM-SS.md`
- Includes metadata (tokens, cost, budget) when `config.localSaving.includeMetadata` is true
- Utility methods: `listSavedDigests()`, `getRecentDigests()`

### Configuration (`config.json`)

Key settings:
- `accounts`: Array of Bluesky handles to monitor
- `emailRecipients`: Array of email addresses
- `dailyCostBudget`: Maximum daily OpenAI spend (e.g., 0.50)
- `filterCriteria`: `minLikes`, `minReplies`, `minReposts`, `sortBy` ("engagement" or "recent")
- `searchKeywords`: Additional keywords to search for
- `maxPostsPerAccount`: Limit posts fetched per account
- `summaryStyle`: "concise", "detailed", or "bullet-points"
- `localSaving`: `enabled`, `outputDirectory`, `includeMetadata`

### GitHub Actions Workflow

**`.github/workflows/daily-digest.yml`**
- Runs on schedule (`cron: '0 8 * * *'`) and manual trigger
- Requires secrets: `BLUESKY_HANDLE`, `BLUESKY_PASSWORD`, `OPENAI_API_KEY`, `SENDGRID_API_KEY`, `SENDER_EMAIL`
- Auto-commits generated digests with `[skip ci]` marker (via commit message)
- Uses `contents: write` permission for git push

### Post Data Structure

Posts include:
- `uri`, `cid`: Bluesky identifiers
- `author`, `authorDisplayName`: Account info
- `text`: Post content
- `createdAt`: Timestamp
- `likes`, `replies`, `reposts`, `quotes`: Engagement metrics
- `engagement`: Calculated weighted score
- `topReplies` (optional): Array of top reply objects with text, author, likes

### URL Construction

Bluesky post URLs: `https://bsky.app/profile/{handle}/post/{rkey}`
- Extract `rkey` from `uri`: `post.uri.split('/').pop()`
- Used in summarizer for citation links

## Important Implementation Details

- **Email failures are non-blocking**: If SendGrid fails, the workflow continues and saves the digest locally
- **Budget checking**: After summary generation, checks if `dailyCostBudget` exceeded but continues workflow
- **Deduplication**: Uses `Map` with post URI as key to remove duplicate posts
- **Rate limiting**: Limits to 10 posts when fetching replies to avoid excessive API calls
- **Node.js version**: Requires Node.js >= 20.0.0
- **ES Modules**: Uses `"type": "module"` in package.json

## Modifying the Workflow

To adjust the schedule, edit the cron expression in `.github/workflows/daily-digest.yml`:
- `'0 17 * * *'` = 5 PM UTC daily
- `'0 */6 * * *'` = Every 6 hours
- `'0 8 * * 1-5'` = Weekdays only at 8 AM

To trigger deploy workflow after digest generation, ensure the commit doesn't include `[skip ci]` in the message.
