import type { AIProvider } from '@hero-cloud/core';
import {
  createAnthropicProvider,
  createBedrockProvider,
  createOllamaProvider,
  createOpenAiCompatibleProvider,
  createOpenAiProvider,
} from './adapters.js';
import type { Fetch } from './http.js';

/** Which model the person brought. Keys are passed in by the caller, never read from the machine here. */
export type AiConfig =
  | {
      readonly kind: 'anthropic';
      readonly model: string;
      readonly apiKey: string;
      readonly baseUrl?: string;
    }
  | {
      readonly kind: 'openai';
      readonly model: string;
      readonly apiKey: string;
      readonly baseUrl?: string;
    }
  | {
      readonly kind: 'openai-compatible';
      readonly model: string;
      readonly baseUrl: string;
      readonly apiKey?: string;
    }
  | { readonly kind: 'ollama'; readonly model: string; readonly baseUrl?: string }
  | {
      readonly kind: 'bedrock';
      readonly model: string;
      readonly region: string;
      readonly profile?: string;
    };

export const aiKinds = ['anthropic', 'openai', 'openai-compatible', 'ollama', 'bedrock'] as const;

const LOCAL_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/** Whether everything stays on this computer, so no consent to share anything is needed. */
export function isLocalAi(config: AiConfig): boolean {
  if (config.kind !== 'ollama' && config.kind !== 'openai-compatible') return false;
  const base = config.baseUrl ?? 'http://127.0.0.1:11434';
  try {
    return LOCAL_HOST.test(new URL(base).hostname);
  } catch {
    return false;
  }
}

/** Where the data goes, in words a person can recognize, for the consent screen. */
export function aiDestination(config: AiConfig): string {
  switch (config.kind) {
    case 'anthropic':
      return 'Anthropic (api.anthropic.com)';
    case 'openai':
      return 'OpenAI (api.openai.com)';
    case 'bedrock':
      return `Amazon Bedrock in your AWS account (${config.region})`;
    case 'ollama':
    case 'openai-compatible':
      try {
        return new URL(config.baseUrl ?? 'http://127.0.0.1:11434').host;
      } catch {
        return 'the address you gave';
      }
  }
}

export function createAiProvider(config: AiConfig, options: { fetch?: Fetch } = {}): AIProvider {
  const common = {
    model: config.model,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };
  switch (config.kind) {
    case 'anthropic':
      return createAnthropicProvider({
        ...common,
        apiKey: config.apiKey,
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
      });
    case 'openai':
      return createOpenAiProvider({
        ...common,
        apiKey: config.apiKey,
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
      });
    case 'openai-compatible':
      return createOpenAiCompatibleProvider({
        ...common,
        baseUrl: config.baseUrl,
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
      });
    case 'ollama':
      return createOllamaProvider({
        ...common,
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
      });
    case 'bedrock':
      return createBedrockProvider({
        ...common,
        region: config.region,
        ...(config.profile === undefined ? {} : { profile: config.profile }),
      });
  }
}
