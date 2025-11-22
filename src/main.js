import fs from 'fs/promises';
import { BlueskySkyClient } from './bluesky-client.js';
import { Summarizer } from './summarizer.js';
import { EmailSender } from './email-sender.js';
import { DigestSaver } from './digest-saver.js';

// Load environment variables from .env file for local testing
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
  } catch (error) {
    // .env file doesn't exist, assume running in GitHub Actions
    console.log('ℹ️  No .env file found (using environment variables)');
  }
}

async function main() {
  console.log('🦋 Starting Bluesky Daily Digest...\n');

  // Load .env if it exists (for local testing)
  await loadEnv();

  // Load configuration
  const config = JSON.parse(await fs.readFile('config.json', 'utf-8'));

  // Validate environment variables
  const requiredEnvVars = [
    'BLUESKY_HANDLE',
    'BLUESKY_PASSWORD',
    'OPENAI_API_KEY',
    'SENDGRID_API_KEY',
    'SENDER_EMAIL'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  // Initialize clients
  const bluesky = new BlueskySkyClient(
    process.env.BLUESKY_HANDLE,
    process.env.BLUESKY_PASSWORD
  );
  
  const summarizer = new Summarizer(process.env.OPENAI_API_KEY);
  const emailSender = new EmailSender(
    process.env.SENDGRID_API_KEY,
    process.env.SENDER_EMAIL
  );
  const digestSaver = new DigestSaver(config);

  try {
    // Authenticate with Bluesky
    await bluesky.login();

    // Fetch posts from configured accounts
    console.log(`\nFetching posts from ${config.accounts.length} account(s)...`);
    let allPosts = await bluesky.getPostsFromAccounts(config.accounts, config);

    // Search for posts with specific keywords
    if (config.searchKeywords && config.searchKeywords.length > 0) {
      console.log(`\nSearching for keyword-based posts...`);
      for (const keyword of config.searchKeywords) {
        const searchResults = await bluesky.searchPosts(keyword, config);
        allPosts.push(...searchResults);
      }
    }

    // Remove duplicates
    const uniquePosts = Array.from(
      new Map(allPosts.map(post => [post.uri, post])).values()
    );

    console.log(`\nTotal unique posts found: ${uniquePosts.length}`);

    // Filter posts based on engagement criteria
    const filteredPosts = bluesky.filterPosts(uniquePosts, config.filterCriteria);
    console.log(`Posts after filtering: ${filteredPosts.length}`);

    if (filteredPosts.length === 0) {
      console.log('⚠️  No posts met the filter criteria. Skipping digest.');
      return;
    }

    // Get top replies for most engaging posts
    console.log(`\nFetching replies for top posts...`);
    const postsWithReplies = await bluesky.getTopReplies(filteredPosts.slice(0, 20));

    // Generate summary with OpenAI
    const { summary, metadata } = await summarizer.generateSummary(
      postsWithReplies.length > 0 ? postsWithReplies : filteredPosts.slice(0, 20),
      config
    );

    // Check budget
    const costReport = summarizer.getCostReport();
    console.log(`\n💰 Total cost: $${costReport.totalCost.toFixed(4)}`);
    
    if (!summarizer.checkBudget(config.dailyCostBudget)) {
      console.error('⚠️  Daily cost budget exceeded!');
      // Continue anyway, but log warning
    }

    // Send email
    const subject = `🦋 Your Bluesky Digest - ${new Date().toLocaleDateString()}`;
    await emailSender.send(
      config.emailRecipients,
      subject,
      summary,
      summary, // Plain text version
      costReport
    );

    // Save digest locally
    await digestSaver.saveDigest(summary, metadata, costReport, filteredPosts.length);

    // Save cost report
    const reportData = {
      date: new Date().toISOString(),
      postsAnalyzed: filteredPosts.length,
      ...costReport,
      ...metadata,
      budgetRemaining: config.dailyCostBudget - costReport.totalCost
    };

    await fs.writeFile('cost-report.json', JSON.stringify(reportData, null, 2));
    console.log('\n✓ Cost report saved');

    console.log('\n✅ Digest completed successfully!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    throw error;
  }
}

// Run the main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
