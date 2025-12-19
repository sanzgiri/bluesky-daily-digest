import OpenAI from 'openai';

export class Summarizer {
  constructor(apiKey) {
    this.openai = new OpenAI({ apiKey });
    this.totalCost = 0;
    this.requestCount = 0;
  }

  async generateSummary(posts, config) {
    const style = config.summaryStyle || 'concise';
    const prompt = this.buildPrompt(posts, style);

    try {
      console.log(`Generating summary with OpenAI (${style} style)...`);
      
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini', // Cost-effective model
        messages: [
          {
            role: 'system',
            content: `You are a sharp, insightful writer who creates engaging daily digests. Your ${style} style is readable, witty, and draws out the interesting connections and implications that aren't immediately obvious. You write like a thoughtful human, not a summarization bot.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1500
      });

      // Calculate cost (GPT-4o-mini pricing as of Oct 2024)
      const inputTokens = response.usage.prompt_tokens;
      const outputTokens = response.usage.completion_tokens;
      const cost = (inputTokens * 0.00015 / 1000) + (outputTokens * 0.0006 / 1000);
      
      this.totalCost += cost;
      this.requestCount++;

      console.log(`✓ Summary generated. Cost: $${cost.toFixed(4)}`);

      return {
        summary: response.choices[0].message.content,
        metadata: {
          inputTokens,
          outputTokens,
          cost,
          model: 'gpt-4o-mini'
        }
      };
    } catch (error) {
      console.error('✗ OpenAI summarization failed:', error.message);
      throw error;
    }
  }

  buildPrompt(posts, style) {
    const postSummaries = posts.map((post, idx) => {
      // Construct URL: https://bsky.app/profile/{handle}/post/{rkey}
      const rkey = post.uri.split('/').pop();
      const url = `https://bsky.app/profile/${post.author}/post/${rkey}`;
      
      let summary = `[${idx + 1}] @${post.author} (${post.authorDisplayName}):\n"${post.text}"\n`;
      summary += `   🔗 ${url}\n`;
      summary += `   📊 ${post.likes} likes, ${post.replies} replies, ${post.reposts} reposts\n`;
      
      if (post.topReplies && post.topReplies.length > 0) {
        summary += `   💬 Top replies:\n`;
        post.topReplies.forEach((reply, i) => {
          summary += `      - @${reply.author}: "${reply.text.substring(0, 100)}${reply.text.length > 100 ? '...' : ''}"\n`;
        });
      }
      
      return summary;
    }).join('\n');

    return `You're creating a daily digest that people actually want to read - not a boring report.
Think of yourself as a witty, insightful friend who keeps people in the loop on what matters.

INSTRUCTIONS:
1. Start with a brief (2-3 sentences) opening that captures the overall vibe or most interesting theme of the day
2. Group related posts into 3-5 compelling topics with intriguing titles (not generic labels like "Technology News")
3. For each topic, write an engaging narrative that:
   - Leads with the most interesting insight or hook
   - Connects ideas and shows why they matter
   - Uses conversational, lively language (avoid "users express" or "this topic explores")
   - Includes specific quotes and details that illustrate the points
   - Adds context or observations that aren't obvious from just reading the posts

FORMAT:
### **[Compelling Topic Title]**
[Engaging 2-4 sentence narrative that draws connections and insights]

*   "Key quote" [— @author](url)
*   "Another quote" [— @author](url)

STYLE GUIDE:
- Write like a human, not a corporate newsletter
- Lead with "why this matters" not "what happened"
- Make topic titles punchy and specific (e.g., "The AI Hype Cycle Hits a Wall" not "AI Discussion")
- Draw connections between posts and to bigger trends
- Use active voice and vivid language
- If there's a hot debate or controversy, lean into it
- You can be opinionated and have personality
- End with the most thought-provoking or important insight

REQUIREMENTS:
- You MUST include a citation for every post referenced: [— @handle](url)
- URLs are marked with 🔗 in the input data
- Stay grounded in what the posts actually say - don't make things up
- Skip the "Miscellaneous" dump - if something doesn't fit a theme, either make a micro-section or let it go

INPUT POSTS:
${postSummaries}`;
  }

  getCostReport() {
    return {
      totalCost: this.totalCost,
      requestCount: this.requestCount,
      averageCostPerRequest: this.requestCount > 0 ? this.totalCost / this.requestCount : 0
    };
  }

  checkBudget(budget) {
    if (this.totalCost > budget) {
      console.warn(`⚠️  Budget exceeded! Current: $${this.totalCost.toFixed(4)}, Budget: $${budget.toFixed(2)}`);
      return false;
    }
    return true;
  }
}
