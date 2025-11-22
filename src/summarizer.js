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
            content: `You are a helpful assistant that creates ${style} daily digests of social media posts. Focus on key insights, trends, and notable discussions.`
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
      let summary = `${idx + 1}. @${post.author} (${post.authorDisplayName}):\n"${post.text}"\n`;
      summary += `   📊 ${post.likes} likes, ${post.replies} replies, ${post.reposts} reposts\n`;
      
      if (post.topReplies && post.topReplies.length > 0) {
        summary += `   💬 Top replies:\n`;
        post.topReplies.forEach((reply, i) => {
          summary += `      ${i + 1}. @${reply.author}: "${reply.text.substring(0, 100)}${reply.text.length > 100 ? '...' : ''}" (${reply.likes} likes)\n`;
        });
      }
      
      return summary;
    }).join('\n');

    return `Please create a ${style} daily digest of these Bluesky posts from the last 24 hours. 

Include:
- Overall themes and trends
- Most engaging discussions
- Key insights from top replies
- Notable quotes or perspectives

Posts:
${postSummaries}

Format the summary in a readable, engaging way suitable for an email.`;
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
