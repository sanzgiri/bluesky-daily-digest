#!/bin/bash

# Quick test script for Bluesky Daily Digest
# This helps you test locally before deploying to GitHub Actions

echo "🧪 Bluesky Daily Digest - Local Test"
echo "===================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "   Please install from: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "⚠️  Node.js version is $NODE_VERSION (need 20+)"
    echo "   Please update from: https://nodejs.org/"
    exit 1
fi

echo "✓ Node.js $(node --version) detected"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found"
    echo ""
    echo "Create .env file with your credentials:"
    echo "  cp .env.example .env"
    echo "  nano .env  # or use your preferred editor"
    echo ""
    echo "Required variables:"
    echo "  - BLUESKY_HANDLE"
    echo "  - BLUESKY_PASSWORD (app password)"
    echo "  - OPENAI_API_KEY"
    echo "  - SENDGRID_API_KEY"
    echo "  - SENDER_EMAIL"
    echo ""
    exit 1
fi

echo "✓ .env file found"
echo ""

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

echo "✓ Dependencies ready"
echo ""

# Confirm with user
echo "⚠️  This will:"
echo "  1. Fetch posts from Bluesky"
echo "  2. Call OpenAI API (cost: ~$0.01-0.05)"
echo "  3. Send an email via SendGrid"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Test cancelled"
    exit 0
fi

echo ""
echo "🚀 Running digest..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run the main script
npm start

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if cost report was created
if [ -f cost-report.json ]; then
    COST=$(grep -o '"totalCost": [0-9.]*' cost-report.json | cut -d' ' -f2)
    POSTS=$(grep -o '"postsAnalyzed": [0-9]*' cost-report.json | cut -d' ' -f2)
    
    echo "📊 Test Results:"
    echo "  Posts analyzed: $POSTS"
    echo "  Total cost: \$$COST"
    echo ""
    echo "✓ Check your email for the digest!"
    echo ""
    echo "View full report: cat cost-report.json"
else
    echo "⚠️  Cost report not generated"
    echo "   Check console output for errors"
fi

echo ""
echo "Next steps:"
echo "  - Check your email (and spam folder)"
echo "  - Review cost-report.json"
echo "  - Adjust config.json if needed"
echo "  - Run './test.sh' again to test changes"
echo ""
