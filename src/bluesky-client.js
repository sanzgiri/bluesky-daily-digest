import { BskyAgent } from '@atproto/api';

export class BlueskySkyClient {
  constructor(handle, password) {
    this.agent = new BskyAgent({ service: 'https://bsky.social' });
    this.handle = handle;
    this.password = password;
  }

  async login() {
    try {
      await this.agent.login({
        identifier: this.handle,
        password: this.password
      });
      console.log('✓ Authenticated with Bluesky');
    } catch (error) {
      console.error('✗ Bluesky authentication failed:', error.message);
      throw error;
    }
  }

  async getPostsFromAccounts(accounts, config) {
    const allPosts = [];
    
    for (const account of accounts) {
      try {
        console.log(`Fetching posts from ${account}...`);
        
        const response = await this.agent.app.bsky.feed.getAuthorFeed({
          actor: account,
          limit: config.maxPostsPerAccount || 10
        });

        const postsWithEngagement = response.data.feed.map(item => ({
          uri: item.post.uri,
          cid: item.post.cid,
          author: item.post.author.handle,
          authorDisplayName: item.post.author.displayName || item.post.author.handle,
          text: item.post.record.text,
          createdAt: item.post.record.createdAt,
          likes: item.post.likeCount || 0,
          replies: item.post.replyCount || 0,
          reposts: item.post.repostCount || 0,
          quotes: item.post.quoteCount || 0,
          engagement: (item.post.likeCount || 0) + 
                     (item.post.replyCount || 0) * 2 + 
                     (item.post.repostCount || 0) * 1.5 +
                     (item.post.quoteCount || 0) * 2
        }));

        allPosts.push(...postsWithEngagement);
      } catch (error) {
        console.error(`✗ Failed to fetch posts from ${account}:`, error.message);
      }
    }

    return allPosts;
  }

  async getPostThread(uri) {
    try {
      const response = await this.agent.getPostThread({ uri, depth: 1 });
      return response.data.thread;
    } catch (error) {
      console.error(`✗ Failed to fetch thread for ${uri}:`, error.message);
      return null;
    }
  }

  async searchPosts(query, config) {
    try {
      console.log(`Searching for: ${query}...`);
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const response = await this.agent.app.bsky.feed.searchPosts({
        q: query,
        limit: 25,
        sort: 'latest',
        since: yesterday.toISOString()
      });

      return response.data.posts.map(post => ({
        uri: post.uri,
        cid: post.cid,
        author: post.author.handle,
        authorDisplayName: post.author.displayName || post.author.handle,
        text: post.record.text,
        createdAt: post.record.createdAt,
        likes: post.likeCount || 0,
        replies: post.replyCount || 0,
        reposts: post.repostCount || 0,
        quotes: post.quoteCount || 0,
        engagement: (post.likeCount || 0) + 
                   (post.replyCount || 0) * 2 + 
                   (post.repostCount || 0) * 1.5 +
                   (post.quoteCount || 0) * 2
      }));
    } catch (error) {
      console.error(`✗ Search failed for "${query}":`, error.message);
      return [];
    }
  }

  filterPosts(posts, criteria) {
    return posts.filter(post => 
      post.likes >= (criteria.minLikes || 0) &&
      post.replies >= (criteria.minReplies || 0) &&
      post.reposts >= (criteria.minReposts || 0)
    ).sort((a, b) => {
      if (criteria.sortBy === 'engagement') {
        return b.engagement - a.engagement;
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  async getTopReplies(posts, limit = 3) {
    const postsWithReplies = [];

    for (const post of posts.slice(0, 10)) { // Limit API calls
      if (post.replies > 0) {
        try {
          const thread = await this.getPostThread(post.uri);
          
          if (thread.replies && thread.replies.length > 0) {
            const topReplies = thread.replies
              .filter(r => r.post)
              .map(r => ({
                text: r.post.record.text,
                author: r.post.author.handle,
                likes: r.post.likeCount || 0,
                engagement: (r.post.likeCount || 0) + (r.post.replyCount || 0) * 2
              }))
              .sort((a, b) => b.engagement - a.engagement)
              .slice(0, limit);

            postsWithReplies.push({
              ...post,
              topReplies
            });
          }
        } catch (error) {
          console.error(`✗ Failed to get replies for post:`, error.message);
        }
      }
    }

    return postsWithReplies;
  }
}
