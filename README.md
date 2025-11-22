# 🦋 Bluesky Daily Digest

Automated daily digest of Bluesky posts with AI-powered summarization, delivered straight to your inbox.

## Features

- 📬 **Automated Daily Emails**: Get summaries delivered on schedule
- 🎯 **Smart Filtering**: Focus on high-engagement posts and replies
- 🤖 **AI Summarization**: OpenAI-powered insights and trend analysis
- 💰 **Cost Tracking**: Monitor OpenAI API usage against your budget
- ⚙️ **Fully Configurable**: Customize accounts, keywords, and filters
- 🔐 **Secure**: All credentials stored as GitHub Secrets

## Setup Instructions

### 1. Prerequisites

- GitHub account
- Bluesky account (with app password)
- OpenAI API key
- SendGrid account (free tier works)

### 2. Create Accounts

#### Bluesky App Password
1. Go to [Bluesky Settings](https://bsky.app/settings)
2. Navigate to "App Passwords"
3. Create a new app password
4. Save it securely

#### OpenAI API Key
1. Visit [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Create a new API key
3. Add credits to your account (minimum $5 recommended)

#### SendGrid Setup
1. Sign up at [SendGrid](https://sendgrid.com/)
2. Verify your sender email address
3. Create an API key with "Mail Send" permissions

### 3. Repository Setup

1. **Fork or clone this repository**

2. **Add GitHub Secrets**
   - Go to Repository Settings → Secrets and variables → Actions
   - Add the following secrets:
     - `BLUESKY_HANDLE`: Your Bluesky handle (e.g., yourusername.bsky.social)
     - `BLUESKY_PASSWORD`: Your Bluesky app password
     - `OPENAI_API_KEY`: Your OpenAI API key
     - `SENDGRID_API_KEY`: Your SendGrid API key
     - `SENDER_EMAIL`: Verified email address for sending

3. **Configure `config.json`**
   ```json
   {
     "accounts": [
       "account1.bsky.social",
       "account2.bsky.social"
     ],
     "emailRecipients": [
       "your-email@example.com"
     ],
     "dailyCostBudget": 0.50,
     "filterCriteria": {
       "minLikes": 5,
       "minReplies": 2,
       "minReposts": 1,
       "sortBy": "engagement"
     },
     "searchKeywords": [
       "AI",
       "technology"
     ],
     "maxPostsPerAccount": 10,
     "summaryStyle": "concise"
   }
   ```

4. **Customize the Schedule** (optional)
   - Edit `.github/workflows/daily-digest.yml`
   - Modify the cron expression: `'0 9 * * *'`
   - Example: `'0 17 * * *'` for 5 PM UTC daily

### 4. Testing

Run manually to test:
1. Go to Actions tab in GitHub
2. Select "Bluesky Daily Digest"
3. Click "Run workflow"

## Configuration Options

### Filter Criteria

- **minLikes**: Minimum likes to include a post
- **minReplies**: Minimum replies to include a post
- **minReposts**: Minimum reposts to include a post
- **sortBy**: `engagement` or `recent`

### Summary Styles

- `concise`: Brief highlights (default)
- `detailed`: Comprehensive analysis
- `bullet-points`: Quick scannable format

### Cost Management

- **dailyCostBudget**: Maximum daily OpenAI spend (e.g., 0.50 for $0.50)
- Uses GPT-4o-mini (most cost-effective)
- Typical cost: $0.01-0.10 per digest

## Pricing

- **Bluesky API**: FREE ✅
- **OpenAI API**: ~$0.01-0.10 per digest (GPT-4o-mini)
- **SendGrid**: FREE for up to 100 emails/day ✅
- **GitHub Actions**: FREE for public repos ✅

**Estimated monthly cost**: $0.30 - $3.00 (mostly OpenAI)

## Troubleshooting

### Email not received
- Check SendGrid sender verification
- Verify `SENDER_EMAIL` secret matches verified address
- Check spam folder

### Rate limit errors
- Bluesky API limit: 5,000 requests/hour (should be plenty)
- Reduce `maxPostsPerAccount` if needed

### High OpenAI costs
- Lower `dailyCostBudget`
- Use more restrictive `filterCriteria`
- Reduce `maxPostsPerAccount`

## Cost Reports

Cost reports are saved as GitHub Actions artifacts:
- View in Actions → Workflow run → Artifacts
- Shows token usage, costs, and budget remaining

## Advanced Configuration

### Custom Schedule Examples

```yaml
# Every 6 hours
- cron: '0 */6 * * *'

# Weekdays only at 8 AM
- cron: '0 8 * * 1-5'

# Weekly on Monday at 9 AM
- cron: '0 9 * * 1'
```

## Project Structure

```
bluesky-daily-digest/
├── .github/
│   └── workflows/
│       └── daily-digest.yml    # GitHub Actions workflow
├── src/
│   ├── bluesky-client.js       # Bluesky API interactions
│   ├── summarizer.js           # OpenAI summarization
│   ├── email-sender.js         # SendGrid email delivery
│   └── main.js                 # Main orchestration
├── config.json                 # User configuration
├── package.json                # Node.js dependencies
├── .gitignore                  # Git ignore rules
└── README.md                   # This file
```

## Contributing

Feel free to open issues or submit pull requests!

## License

MIT License

## Support

If you find this project helpful, consider:
- ⭐ Starring the repository
- 🐛 Reporting bugs
- 💡 Suggesting features
- 📖 Improving documentation

---

Made with ❤️ for the Bluesky community
