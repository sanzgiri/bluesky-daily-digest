# ✅ Setup Checklist

Use this checklist to ensure everything is configured correctly.

## Pre-Setup

- [ ] I have a GitHub account
- [ ] I have a Bluesky account
- [ ] I have Git installed on my computer
- [ ] I have Node.js 20+ installed (optional, for local testing)

## Account Creation

- [ ] Created Bluesky app password at https://bsky.app/settings
- [ ] Created OpenAI API key at https://platform.openai.com/api-keys
- [ ] Added $5+ credits to OpenAI account
- [ ] Signed up for SendGrid at https://sendgrid.com/
- [ ] Verified sender email in SendGrid
- [ ] Created SendGrid API key with "Mail Send" permissions

## GitHub Repository

- [ ] Created new repository on GitHub (public)
- [ ] Named it `bluesky-daily-digest`
- [ ] Did NOT initialize with README
- [ ] Copied the repository to my local machine
- [ ] Ran `./setup.sh` in the project directory
- [ ] Added GitHub remote with `git remote add origin ...`
- [ ] Pushed code with `git push -u origin main`

## GitHub Secrets

Go to: **Repository Settings → Secrets and variables → Actions**

- [ ] Added `BLUESKY_HANDLE` secret
- [ ] Added `BLUESKY_PASSWORD` secret (app password)
- [ ] Added `OPENAI_API_KEY` secret
- [ ] Added `SENDGRID_API_KEY` secret
- [ ] Added `SENDER_EMAIL` secret

## Configuration

- [ ] Updated `config.json` with my email in `emailRecipients`
- [ ] Updated `config.json` with accounts I want to follow
- [ ] Updated `config.json` with my search keywords (optional)
- [ ] Adjusted filter criteria if needed
- [ ] Set daily cost budget
- [ ] Committed and pushed changes

## Testing

- [ ] Went to Actions tab on GitHub
- [ ] Clicked "Bluesky Daily Digest"
- [ ] Clicked "Run workflow"
- [ ] Waited 1-2 minutes for completion
- [ ] Checked my email (and spam folder)
- [ ] Received the digest email successfully! 🎉

## Optional Customization

- [ ] Adjusted cron schedule in `.github/workflows/daily-digest.yml`
- [ ] Tested with different filter criteria
- [ ] Added more accounts to follow
- [ ] Reviewed cost report in Actions artifacts

## Verification

Answer these questions:

1. Did you receive the test email? **Yes / No**
2. Was the summary helpful? **Yes / No**
3. Is the cost within budget? **Yes / No**
4. Do you want to add more accounts? **Yes / No**

## Troubleshooting

If something didn't work, check:

- [ ] All 5 GitHub secrets are spelled correctly
- [ ] SendGrid sender email is verified
- [ ] OpenAI account has credits
- [ ] Bluesky app password (not regular password) is used
- [ ] `config.json` has valid JSON syntax

## Next Steps

Once everything works:

- [ ] Share the repository with friends
- [ ] Star the project on GitHub
- [ ] Customize the email template
- [ ] Set up monitoring for costs
- [ ] Enjoy your daily Bluesky digest!

---

**All done?** Congratulations! 🎉 You now have an automated Bluesky digest running daily!
