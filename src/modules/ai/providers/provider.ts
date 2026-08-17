import type { AiConfig, AiNativeToolCall, AiStreamCompletionInfo } from '../contracts';

export type ProviderMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    index?: number;
    function: { name: string; arguments: string };
  }>;
};

export interface ProviderChatResult {
  content: string;
  model: string;
  reasoningContent?: string;
  toolCalls?: AiNativeToolCall[];
  completion?: AiStreamCompletionInfo;
}

export interface ProviderStreamDelta {
  content?: string;
  reasoningContent?: string;
}

export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
  modelDiscovery: boolean;
}

export interface AiProviderDescriptor {
  id: string;
  label: string;
  capabilities: ProviderCapabilities;
}

export interface AiProviderAdapter {
  readonly descriptor: AiProviderDescriptor;
  readonly id: string;
  test(config: AiConfig): Promise<string[]>;
  chat(
    config: AiConfig,
    messages: ProviderMessage[],
    maxOutputTokens: number,
  ): Promise<ProviderChatResult>;
  stream(
    config: AiConfig,
    messages: ProviderMessage[],
    maxOutputTokens: number,
    signal: AbortSignal,
    onDelta: (delta: ProviderStreamDelta) => void,
    options?: {
      toolChoice?: 'auto' | 'none' | 'required';
      tools?: Array<Record<string, unknown>>;
    },
  ): Promise<ProviderChatResult>;
}
