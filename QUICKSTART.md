# 🚀 Quick Start Guide

Get your Bluesky Daily Digest up and running in 10 minutes!

## Step 1: Copy the Project

The project is ready at `/home/claude/bluesky-daily-digest`

Copy it to your desired location:

```bash
# Option A: Copy to your home directory
cp -r /home/claude/bluesky-daily-digest ~/bluesky-daily-digest
cd ~/bluesky-daily-digest

# Option B: Copy to a custom location
cp -r /home/claude/bluesky-daily-digest /path/to/your/location
cd /path/to/your/location
```

## Step 2: Create GitHub Repository

1. Go to https://github.com/new
2. Name it: `bluesky-daily-digest`
3. Make it **Public** (for free GitHub Actions)
4. **Do NOT** initialize with README (we already have one)
5. Click "Create repository"

## Step 3: Push to GitHub

Run the setup script:

```bash
./setup.sh
```

Then add your GitHub repository:

```bash
# Replace YOUR_USERNAME with your GitHub username
git remote add origin https://github.com/YOUR_USERNAME/bluesky-daily-digest.git
git push -u origin main
```

## Step 4: Get API Keys

### 🦋 Bluesky App Password
1. Go to https://bsky.app/settings
2. Click "App Passwords"
3. Click "Add App Password"
4. Name it "Daily Digest"
5. Copy the password (save it!)

### 🤖 OpenAI API Key
1. Go to https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Name it "Bluesky Digest"
4. Copy the key (save it!)
5. Add at least $5 credits to your account

### 📧 SendGrid API Key
1. Sign up at https://sendgrid.com/
2. Verify your email address
3. Go to Settings → API Keys
4. Create API Key with "Mail Send" permissions
5. Copy the key (save it!)

## Step 5: Add GitHub Secrets

1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** for each:

| Secret Name | Value |
|------------|-------|
| `BLUESKY_HANDLE` | Your Bluesky username (e.g., yourusername.bsky.social) |
| `BLUESKY_PASSWORD` | Your Bluesky app password |
| `OPENAI_API_KEY` | Your OpenAI API key |
| `SENDGRID_API_KEY` | Your SendGrid API key |
| `SENDER_EMAIL` | Your verified SendGrid email |

## Step 6: Configure Settings

Edit `config.json` in your repository:

```json
{
  "accounts": [
    "bsky.app",
    "paul.bsky.social"
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
    "machine learning"
  ],
  "maxPostsPerAccount": 10,
  "summaryStyle": "concise"
}
```

Commit and push the changes:

```bash
git add config.json
git commit -m "Update configuration"
git push
```

## Step 7: Test It!

1. Go to your repository on GitHub
2. Click the **Actions** tab
3. Click **Bluesky Daily Digest**
4. Click **Run workflow** → **Run workflow**
5. Wait 1-2 minutes
6. Check your email! 📬

## Troubleshooting

### ❌ "No posts met the filter criteria"
- Lower `minLikes`, `minReplies`, and `minReposts` in config.json
- Add more accounts or search keywords

### ❌ Email not received
- Check SendGrid verification
- Check spam folder
- Verify `SENDER_EMAIL` secret matches SendGrid

### ❌ "Missing required environment variable"
- Double-check all 5 GitHub secrets are added
- Secret names must match exactly (case-sensitive)

### ❌ Authentication failed
- Verify Bluesky credentials
- Make sure you're using an **app password**, not your main password

## Next Steps

✅ **Schedule it**: The workflow runs daily at 9 AM UTC by default

✅ **Customize**: Adjust the cron schedule in `.github/workflows/daily-digest.yml`

✅ **Monitor costs**: Check cost reports in Actions → Workflow run → Artifacts

✅ **Share**: Invite friends to use it too!

## Cost Estimate

- 📱 Bluesky API: **FREE**
- 📧 SendGrid: **FREE** (up to 100 emails/day)
- ⚡ GitHub Actions: **FREE** (public repos)
- 🤖 OpenAI: **$0.01-0.10 per digest**

**Total: $0.30-3.00/month** 💰

---

**Need help?** Open an issue on GitHub!
