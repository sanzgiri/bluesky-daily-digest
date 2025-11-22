#!/bin/bash

# Bluesky Daily Digest - GitHub Setup Script
# This script will help you push the project to GitHub

echo "🦋 Bluesky Daily Digest - GitHub Setup"
echo "======================================"
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Please install Git first:"
    echo "   https://git-scm.com/downloads"
    exit 1
fi

echo "✓ Git is installed"
echo ""

# Initialize git repository
echo "📦 Initializing Git repository..."
git init
git branch -M main

# Add all files
echo "📝 Adding files to Git..."
git add .

# Create initial commit
echo "💾 Creating initial commit..."
git commit -m "Initial commit: Bluesky Daily Digest automation"

echo ""
echo "✅ Local repository is ready!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "NEXT STEPS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Create a new repository on GitHub:"
echo "   https://github.com/new"
echo ""
echo "2. Copy the repository URL (it will look like):"
echo "   https://github.com/yourusername/bluesky-daily-digest.git"
echo ""
echo "3. Run these commands (replace YOUR_REPO_URL):"
echo "   git remote add origin YOUR_REPO_URL"
echo "   git push -u origin main"
echo ""
echo "4. Set up GitHub Secrets:"
echo "   Go to: Settings → Secrets and variables → Actions"
echo "   Add these secrets:"
echo "   • BLUESKY_HANDLE"
echo "   • BLUESKY_PASSWORD"
echo "   • OPENAI_API_KEY"
echo "   • SENDGRID_API_KEY"
echo "   • SENDER_EMAIL"
echo ""
echo "5. Update config.json with your preferences"
echo ""
echo "6. Test the workflow:"
echo "   Go to: Actions → Bluesky Daily Digest → Run workflow"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
