import type { ResolvedReadingMode } from './reading-mode';
import type {
  LongTermMemoryCategory,
  LongTermMemoryScope,
  LongTermMemorySourceType,
} from './memory';

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
  maxOutputTokens: number;
}

export type VisionAiMode = 'disabled' | 'separate';

export interface VisionAiConfig {
  mode: VisionAiMode;
  providerId: 'openai-compatible';
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AiImageAttachment {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
  width?: number;
  height?: number;
}

export interface AiConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: AiImageAttachment[];
}

export interface AiDocumentContext {
  documentName?: string;
  pageNumber?: number;
  totalPages?: number;
  selectedText?: string;
  pageText?: string;
  documentText?: string;
  imageAnalysis?: string;
  conversationSummary?: string;
  longTermMemory?: string;
  memoryOperationResult?: string;
  completedTools?: Array<{
    name: string;
    arguments?: Record<string, unknown>;
  }>;
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

export interface AiCompressConversationRequest {
  type: 'pdf-helper:ai-compress-conversation';
  previousSummary?: string;
  messages: AiConversationMessage[];
}

export interface AiMemoryCandidate {
  key: string;
  category: LongTermMemoryCategory;
  content: string;
  scope: LongTermMemoryScope;
  sourceType: LongTermMemorySourceType;
  confidence: number;
  importance: number;
}

export interface AiExtractLongTermMemoryRequest {
  type: 'pdf-helper:ai-extract-long-term-memory';
  userMessage: string;
  assistantMessage: string;
  confirmedMemoryProposal?: string;
  documentId?: string;
  documentName?: string;
  existingMemories?: Array<{ key: string; content: string; scope: LongTermMemoryScope; scopeId?: string }>;
}

export interface AiPlanLongTermMemoryToolsRequest {
  type: 'pdf-helper:ai-plan-long-term-memory-tools';
  userMessage: string;
  assistantMessage: string;
  confirmedMemoryProposal?: string;
  documentId?: string;
  documentName?: string;
  existingMemories?: Array<{ key: string; content: string; scope: LongTermMemoryScope; scopeId?: string }>;
}

export interface AiNativeToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
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
  availableTools: Array<{
    name: string;
    description: string;
    parameters: string;
  }>;
  completedTools: Array<{
    name: string;
    arguments?: Record<string, unknown>;
  }>;
}

export interface AiStreamCompletionInfo {
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  contentLength: number;
  reasoningLength: number;
  receivedDoneMarker: boolean;
  eventCount: number;
  httpStatus?: number;
  providerRequestId?: string;
}

export interface AiStreamErrorInfo {
  name?: string;
  httpStatus?: number;
  responseBody?: string;
  model?: string;
  baseUrl?: string;
  finishReason?: string;
  contentLength?: number;
  reasoningLength?: number;
  receivedDoneMarker?: boolean;
  eventCount?: number;
  providerRequestId?: string;
}

export type AiStreamServerMessage =
  | { type: 'started'; requestId: string; model: string; debug?: AiStreamDebugInfo }
  | { type: 'delta'; requestId: string; content: string }
  | { type: 'reasoning-delta'; requestId: string; content: string }
  | {
      type: 'done';
      requestId: string;
      model: string;
      debug?: AiStreamDebugInfo;
      completion?: AiStreamCompletionInfo;
    }
  | { type: 'error'; requestId: string; error: string; details?: AiStreamErrorInfo };

export type AiRuntimeRequest =
  | AiChatRequest
  | AiTestRequest
  | AiDetectReadingModeRequest
  | AiGeneratePaperOverviewRequest
  | AiCompressConversationRequest
  | AiPlanLongTermMemoryToolsRequest
  | AiExtractLongTermMemoryRequest
  | AiVisionRequest
  | AiVisionTestRequest;

export interface AiRuntimeResponse {
  ok: boolean;
  content?: string;
  models?: string[];
  model?: string;
  readingMode?: ResolvedReadingMode;
  rationale?: string;
  memoryCandidates?: AiMemoryCandidate[];
  toolCalls?: AiNativeToolCall[];
  error?: string;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  providerId: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  reasoning: 'disabled',
  maxOutputTokens: 8192,
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
    || type === 'pdf-helper:ai-compress-conversation'
    || type === 'pdf-helper:ai-plan-long-term-memory-tools'
    || type === 'pdf-helper:ai-extract-long-term-memory'
    || type === 'pdf-helper:ai-vision'
    || type === 'pdf-helper:ai-vision-test';
}

export function normalizeAiMaxOutputTokens(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AI_CONFIG.maxOutputTokens;
  return Math.min(65536, Math.max(256, Math.trunc(parsed)));
}
