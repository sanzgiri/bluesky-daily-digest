# 🧪 Local Testing Guide

Test the Bluesky Daily Digest on your local machine before deploying to GitHub Actions.

## Prerequisites

- Node.js 20+ ([Download](https://nodejs.org/))
- Bluesky account with app password
- OpenAI API key with credits
- SendGrid account with verified email

## Quick Start

### 1. Install Dependencies

```bash
cd bluesky-daily-digest
npm install
```

### 2. Configure Environment Variables

Copy the example file:
```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:
```bash
nano .env
# or use your preferred text editor
```

```env
BLUESKY_HANDLE=your-username.bsky.social
BLUESKY_PASSWORD=your-app-password
OPENAI_API_KEY=sk-proj-...
SENDGRID_API_KEY=SG...
SENDER_EMAIL=your-email@example.com
```

**Important:** Get your Bluesky **app password** (not your regular password):
1. Go to https://bsky.app/settings
2. Click "App Passwords"
3. Create new app password
4. Copy and use that in `.env`

### 3. Update Configuration

Edit `config.json` with test settings:

```json
{
  "accounts": [
    "bsky.app"
  ],
  "emailRecipients": [
    "your-email@example.com"
  ],
  "dailyCostBudget": 0.50,
  "filterCriteria": {
    "minLikes": 3,
    "minReplies": 1,
    "minReposts": 0,
    "sortBy": "engagement"
  },
  "searchKeywords": [],
  "maxPostsPerAccount": 5,
  "summaryStyle": "concise"
}
```

**Tips for testing:**
- Use fewer accounts (1-2)
- Lower filter criteria (minLikes: 3)
- Reduce maxPostsPerAccount (5-10)
- This keeps costs low (~$0.01-0.05 per test)

### 4. Run the Script

```bash
npm start
```

You should see:
```
🦋 Starting Bluesky Daily Digest...

✓ Loaded .env file
✓ Authenticated with Bluesky

Fetching posts from bsky.app...

Total unique posts found: 10
Posts after filtering: 5

Fetching replies for top posts...

Generating summary with OpenAI (concise style)...
✓ Summary generated. Cost: $0.0234

💰 Total cost: $0.0234

Sending email to 1 recipient(s)...
✓ Email sent successfully

✓ Cost report saved

✅ Digest completed successfully!
```

### 5. Check Your Email

Look for:
- Subject: 🦋 Your Bluesky Digest - [Today's Date]
- From: Your sender email
- Content: AI-generated summary of posts

**Not received?** Check spam folder!

## Troubleshooting

### Error: "Missing required environment variable"
- Make sure `.env` file exists
- Check all 5 variables are set
- No spaces around the `=` sign

### Error: "Bluesky authentication failed"
- Use **app password**, not regular password
- Get from: https://bsky.app/settings → App Passwords
- Double-check handle format: `username.bsky.social`

### Error: "Email sending failed"
- Verify sender email in SendGrid
- Check SendGrid API key has "Mail Send" permissions
- Confirm `SENDER_EMAIL` matches verified address

### Error: "No posts met the filter criteria"
- Lower the filter values in `config.json`
- Change to `minLikes: 0, minReplies: 0, minReposts: 0`
- Or add accounts with more posts

### High OpenAI costs
- Reduce `maxPostsPerAccount` to 5
- Remove search keywords
- Use fewer accounts for testing

## Testing Different Configurations

### Test 1: Single Account, Low Filters
```json
{
  "accounts": ["bsky.app"],
  "filterCriteria": {
    "minLikes": 0,
    "minReplies": 0,
    "minReposts": 0
  },
  "maxPostsPerAccount": 5
}
```
**Expected cost:** ~$0.01-0.02

### Test 2: Multiple Accounts with Keywords
```json
{
  "accounts": ["bsky.app", "paul.bsky.social"],
  "searchKeywords": ["AI"],
  "maxPostsPerAccount": 10
}
```
**Expected cost:** ~$0.03-0.05

### Test 3: High Engagement Only
```json
{
  "filterCriteria": {
    "minLikes": 50,
    "minReplies": 10,
    "minReposts": 5,
    "sortBy": "engagement"
  }
}
```
**Expected cost:** Variable (fewer posts = lower cost)

## Viewing Cost Reports

After each run, check `cost-report.json`:

```bash
cat cost-report.json
```

Example output:
```json
{
  "date": "2025-10-29T01:45:00.000Z",
  "postsAnalyzed": 5,
  "totalCost": 0.0234,
  "requestCount": 1,
  "averageCostPerRequest": 0.0234,
  "inputTokens": 1200,
  "outputTokens": 350,
  "cost": 0.0234,
  "model": "gpt-4o-mini",
  "budgetRemaining": 0.4766
}
```

## Best Practices for Testing

1. **Start small**: Test with 1 account and low filters
2. **Check costs**: Review `cost-report.json` after each run
3. **Verify email**: Make sure you receive the digest
4. **Iterate**: Adjust config and test again
5. **Monitor budget**: Keep `dailyCostBudget` at $0.50 for testing

## Ready for Production?

Once testing works:

1. ✅ Email delivered successfully
2. ✅ Summary quality is good
3. ✅ Costs are within budget
4. ✅ No errors in console

**Next step:** Push to GitHub and set up GitHub Actions!

See `QUICKSTART.md` for deployment instructions.

## Cleanup

To remove test files:

```bash
rm cost-report.json
rm .env  # Don't commit this!
```

## Getting Help

- Check logs for error messages
- Verify all API keys are valid
- Ensure accounts have recent posts
- Review `config.json` syntax (valid JSON)

**Still stuck?** Open an issue on GitHub with:
- Error message
- Console output
- Anonymized `config.json`

---

Happy testing! 🧪
