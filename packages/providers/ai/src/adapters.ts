import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { AIProvider, AIRequest } from '@hero-cloud/core';
import { heroError } from '@hero-cloud/core';
import { dig, parseAnswer, postJson } from './http.js';
import type { HttpOptions } from './http.js';
import { SYSTEM_PROMPT, userMessage } from './prompt.js';

interface Common extends HttpOptions {
  readonly model: string;
  readonly maxOutputTokens?: number;
}

const DEFAULT_OUTPUT = 1500;

function required<T>(value: T | undefined, reason: string): T {
  if (value === undefined) throw heroError('provider.unavailable', { reason });
  return value;
}

/** Anthropic Messages API. The answer is forced through a tool whose input is the schema. */
export function createAnthropicProvider(
  options: Common & { readonly apiKey: string; readonly baseUrl?: string },
): AIProvider {
  return {
    async generate<T>(request: AIRequest): Promise<T> {
      const body = {
        model: options.model,
        max_tokens: options.maxOutputTokens ?? DEFAULT_OUTPUT,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage(request) }],
        tools: [{ name: 'answer', description: 'The answer.', input_schema: request.schema }],
        tool_choice: { type: 'tool', name: 'answer' },
      };
      const response = await postJson(
        `${options.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`,
        { 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01' },
        body,
        options,
      );
      const content = dig(response, 'content');
      const block = Array.isArray(content)
        ? (content as unknown[]).find((item) => dig(item, 'type') === 'tool_use')
        : undefined;
      return required(dig(block, 'input'), 'ai-bad-answer') as T;
    },
  };
}

function chatCompletions(
  options: Common & { readonly baseUrl: string; readonly headers: Record<string, string> },
): AIProvider {
  return {
    async generate<T>(request: AIRequest): Promise<T> {
      const body = {
        model: options.model,
        max_tokens: options.maxOutputTokens ?? DEFAULT_OUTPUT,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage(request) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'answer', schema: request.schema },
        },
      };
      const response = await postJson(
        `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        options.headers,
        body,
        options,
      );
      return parseAnswer(dig(response, 'choices', 0, 'message', 'content')) as T;
    },
  };
}

/** OpenAI Chat Completions with a JSON schema. */
export function createOpenAiProvider(
  options: Common & { readonly apiKey: string; readonly baseUrl?: string },
): AIProvider {
  return chatCompletions({
    ...options,
    baseUrl: options.baseUrl ?? 'https://api.openai.com/v1',
    headers: { authorization: `Bearer ${options.apiKey}` },
  });
}

/** Any server that speaks the OpenAI chat API (vLLM, LM Studio, a gateway). The key is optional. */
export function createOpenAiCompatibleProvider(
  options: Common & { readonly baseUrl: string; readonly apiKey?: string },
): AIProvider {
  return chatCompletions({
    ...options,
    headers: options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` },
  });
}

/** Ollama on this computer (or one the person names). No key, and nothing leaves the machine. */
export function createOllamaProvider(options: Common & { readonly baseUrl?: string }): AIProvider {
  return {
    async generate<T>(request: AIRequest): Promise<T> {
      const body = {
        model: options.model,
        stream: false,
        format: request.schema,
        options: { num_predict: options.maxOutputTokens ?? DEFAULT_OUTPUT, temperature: 0 },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage(request) },
        ],
      };
      const response = await postJson(
        `${(options.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/, '')}/api/chat`,
        {},
        body,
        options,
      );
      return parseAnswer(dig(response, 'message', 'content')) as T;
    },
  };
}

/** The part of the Bedrock client used here, so tests can supply a fake. */
export interface BedrockPort {
  send(command: ConverseCommand): Promise<unknown>;
}

/** Amazon Bedrock Converse API, with the person's own AWS credentials. */
export function createBedrockProvider(
  options: Common & {
    readonly region: string;
    readonly profile?: string;
    readonly client?: BedrockPort;
  },
): AIProvider {
  const client: BedrockPort =
    options.client ??
    new BedrockRuntimeClient({
      region: options.region,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
    });
  return {
    async generate<T>(request: AIRequest): Promise<T> {
      let response: unknown;
      try {
        response = await client.send(
          new ConverseCommand({
            modelId: options.model,
            system: [{ text: SYSTEM_PROMPT }],
            messages: [{ role: 'user', content: [{ text: userMessage(request) }] }],
            inferenceConfig: {
              maxTokens: options.maxOutputTokens ?? DEFAULT_OUTPUT,
              temperature: 0,
            },
            toolConfig: {
              tools: [
                {
                  toolSpec: {
                    name: 'answer',
                    description: 'The answer.',
                    inputSchema: { json: request.schema as never },
                  },
                },
              ],
              toolChoice: { tool: { name: 'answer' } },
            },
          }),
        );
      } catch {
        throw heroError('provider.unavailable', { reason: 'ai-unreachable' });
      }
      const content = dig(response, 'output', 'message', 'content');
      const block = Array.isArray(content)
        ? (content as unknown[]).find((item) => dig(item, 'toolUse') !== undefined)
        : undefined;
      return required(dig(block, 'toolUse', 'input'), 'ai-bad-answer') as T;
    },
  };
}
