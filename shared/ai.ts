import type { ResolvedReadingMode } from './reading-mode';

export const AI_CONFIG_STORAGE_KEY = 'pdf-helper-ai-config-v1';
export const VISION_AI_CONFIG_STORAGE_KEY = 'pdf-helper-vision-ai-config-v1';
export const LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY = 'pdf-helper-deepseek-config-v1';
export const AI_STREAM_PORT_NAME = 'pdf-helper:ai-stream-v1';

export type AiProviderId = 'deepseek' | 'openai-compatible' | 'anthropic' | 'gemini';
export type AiReasoningMode = 'disabled' | 'enabled';

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  defaultBaseUrl: string;
  available: boolean;
}

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    available: true,
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI 兼容接口（即将支持）',
    defaultBaseUrl: '',
    available: false,
  },
  {
    id: 'anthropic',
    label: 'Anthropic（即将支持）',
    defaultBaseUrl: '',
    available: false,
  },
  {
    id: 'gemini',
    label: 'Gemini（即将支持）',
    defaultBaseUrl: '',
    available: false,
  },
];

export const DEEPSEEK_MODELS = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
] as const;

export interface AiConfig {
  providerId: AiProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoning: AiReasoningMode;
}

export type VisionAiMode = 'disabled' | 'separate';

export interface VisionAiConfig {
  mode: VisionAiMode;
  providerId: 'openai-compatible';
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AiConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiDocumentContext {
  documentName?: string;
  pageNumber?: number;
  totalPages?: number;
  selectedText?: string;
  pageText?: string;
  documentText?: string;
  readingMode?: ResolvedReadingMode;
}

export interface AiChatRequest {
  type: 'pdf-helper:ai-chat';
  messages: AiConversationMessage[];
  context?: AiDocumentContext;
}

export interface AiTestRequest {
  type: 'pdf-helper:ai-test';
}

export interface AiDetectReadingModeRequest {
  type: 'pdf-helper:ai-detect-reading-mode';
  documentName: string;
  sampleText: string;
  outlineTitles?: string[];
}

export interface AiGeneratePaperOverviewRequest {
  type: 'pdf-helper:ai-generate-paper-overview';
  documentName: string;
  pageCount: number;
  text: string;
}

export interface AiVisionRequest {
  type: 'pdf-helper:ai-vision';
  prompt: string;
  imageDataUrl: string;
  context?: AiDocumentContext;
}

export interface AiVisionTestRequest {
  type: 'pdf-helper:ai-vision-test';
  imageDataUrl?: string;
}

export interface AiStreamStartMessage {
  type: 'start';
  requestId: string;
  messages: AiConversationMessage[];
  context?: AiDocumentContext;
}

export interface AiStreamDebugInfo {
  providerId: AiProviderId;
  model: string;
  baseUrl: string;
  reasoning: AiReasoningMode;
  maxOutputTokens: number;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  tools: Array<{
    name: string;
    arguments?: Record<string, unknown>;
  }>;
}

export type AiStreamServerMessage =
  | { type: 'started'; requestId: string; model: string; debug?: AiStreamDebugInfo }
  | { type: 'delta'; requestId: string; content: string }
  | { type: 'reasoning-delta'; requestId: string; content: string }
  | { type: 'done'; requestId: string; model: string; debug?: AiStreamDebugInfo }
  | { type: 'error'; requestId: string; error: string };

export type AiRuntimeRequest =
  | AiChatRequest
  | AiTestRequest
  | AiDetectReadingModeRequest
  | AiGeneratePaperOverviewRequest
  | AiVisionRequest
  | AiVisionTestRequest;

export interface AiRuntimeResponse {
  ok: boolean;
  content?: string;
  models?: string[];
  model?: string;
  readingMode?: ResolvedReadingMode;
  rationale?: string;
  error?: string;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  providerId: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  reasoning: 'disabled',
};

export const DEFAULT_VISION_AI_CONFIG: VisionAiConfig = {
  mode: 'disabled',
  providerId: 'openai-compatible',
  apiKey: '',
  baseUrl: '',
  model: '',
};

export function isVisionAiConfigured(config: VisionAiConfig): boolean {
  return config.mode === 'separate'
    && Boolean(config.apiKey.trim() && config.baseUrl.trim() && config.model.trim());
}

export function normalizeAiBaseUrl(value: string, providerId: AiProviderId): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (normalized) return normalized;
  return AI_PROVIDERS.find((provider) => provider.id === providerId)?.defaultBaseUrl || '';
}

export function isAiRuntimeRequest(value: unknown): value is AiRuntimeRequest {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return type === 'pdf-helper:ai-chat'
    || type === 'pdf-helper:ai-test'
    || type === 'pdf-helper:ai-detect-reading-mode'
    || type === 'pdf-helper:ai-generate-paper-overview'
    || type === 'pdf-helper:ai-vision'
    || type === 'pdf-helper:ai-vision-test';
}
