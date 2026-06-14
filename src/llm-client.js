import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Model pricing per 1K tokens, as of 2025-2026.
 * Local models cost $0; cloud models bill on the provider side.
 */
const MODEL_PRICING = {
  'claude-haiku-4-5':             { input: 0.001,   output: 0.005  },
  'claude-haiku-4-5-20251001':   { input: 0.001,   output: 0.005  },
  'claude-3-5-haiku-20241022':   { input: 0.0008,  output: 0.004  },
  'claude-3-5-sonnet-20241022':  { input: 0.003,   output: 0.015  },
  'gpt-4o-mini':                 { input: 0.00015, output: 0.0006 },
  'gpt-4o':                      { input: 0.0025,  output: 0.010  }
  // any model not in this map is treated as $0 (local).
};

/**
 * Provider-agnostic LLM client. Supports three providers:
 *   1. anthropic — Claude via official API (recommended for best voice)
 *   2. openai    — GPT via official API
 *   3. local     — Any OpenAI-compatible local server (Ollama, LM Studio,
 *                  llama.cpp's server, vLLM, text-generation-webui, etc.)
 *
 * Provider selection priority (unless overridden by preferredProvider):
 *   local (if localBaseUrl set) → anthropic → openai
 *
 * Ollama setup:    `ollama serve` → http://localhost:11434/v1, model="qwen3:4b"
 * LM Studio setup: server tab     → http://localhost:1234/v1, model="local-model"
 */
export class LLMClient {
  constructor({
    anthropicKey,
    openaiKey,
    localBaseUrl,      // e.g. "http://localhost:11434/v1"
    localModel,        // e.g. "qwen3:4b" or "llama3.1:8b-instruct"
    localApiKey = 'ollama', // OpenAI client requires SOME key; Ollama ignores it
    preferredProvider  // explicit override: 'local' | 'anthropic' | 'openai'
  } = {}) {
    this.anthropicKey = anthropicKey;
    this.openaiKey = openaiKey;
    this.localBaseUrl = localBaseUrl;
    this.localModel = localModel;
    this.preferredProvider = preferredProvider;

    if (anthropicKey) this.anthropic = new Anthropic({ apiKey: anthropicKey });
    if (openaiKey) this.openai = new OpenAI({ apiKey: openaiKey });
    if (localBaseUrl) {
      this.local = new OpenAI({ apiKey: localApiKey, baseURL: localBaseUrl });
    }
  }

  pickModel() {
    // Explicit override wins
    if (this.preferredProvider === 'local' && this.local) {
      return { provider: 'local', model: this.localModel || 'local-model' };
    }
    if (this.preferredProvider === 'anthropic' && this.anthropic) {
      return { provider: 'anthropic', model: 'claude-haiku-4-5' };
    }
    if (this.preferredProvider === 'openai' && this.openai) {
      return { provider: 'openai', model: 'gpt-4o-mini' };
    }

    // Default priority: local → anthropic → openai
    if (this.local) return { provider: 'local', model: this.localModel || 'local-model' };
    if (this.anthropic) return { provider: 'anthropic', model: 'claude-haiku-4-5' };
    if (this.openai) return { provider: 'openai', model: 'gpt-4o-mini' };

    throw new Error('No LLM provider configured (need LOCAL_LLM_BASE_URL, ANTHROPIC_API_KEY, or OPENAI_API_KEY)');
  }

  _cost(model, inputTokens, outputTokens) {
    const p = MODEL_PRICING[model];
    if (!p) return 0; // local models, unknown models = $0
    return (inputTokens * p.input + outputTokens * p.output) / 1000;
  }

  async complete({ system, user, temperature = 0.8, maxTokens = 2200 }) {
    const { provider, model } = this.pickModel();

    // ----- Anthropic path -----
    if (provider === 'anthropic') {
      const resp = await this.anthropic.messages.create({
        model, max_tokens: maxTokens, temperature, system,
        messages: [{ role: 'user', content: user }]
      });
      const text = resp.content.map(b => b.type === 'text' ? b.text : '').join('');
      return {
        text, provider, model,
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
        cost: this._cost(model, resp.usage.input_tokens, resp.usage.output_tokens)
      };
    }

    // ----- Local (OpenAI-compatible) path -----
    // Local models often choke on penalty parameters or large max_tokens —
    // keep the call minimal and let the model do its thing.
    if (provider === 'local') {
      const resp = await this.local.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature,
        max_tokens: maxTokens
      });
      const inputTokens = resp.usage?.prompt_tokens ?? 0;
      const outputTokens = resp.usage?.completion_tokens ?? 0;
      return {
        text: resp.choices[0].message.content,
        provider, model,
        inputTokens, outputTokens,
        cost: 0 // local always free
      };
    }

    // ----- OpenAI cloud path -----
    const resp = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature,
      max_tokens: maxTokens,
      presence_penalty: 0.3,
      frequency_penalty: 0.3
    });
    return {
      text: resp.choices[0].message.content,
      provider, model,
      inputTokens: resp.usage.prompt_tokens,
      outputTokens: resp.usage.completion_tokens,
      cost: this._cost(model, resp.usage.prompt_tokens, resp.usage.completion_tokens)
    };
  }
}
