import type { ResolvedReadingMode } from '../reading-mode/public';
import type { LongTermMemoryCategory, LongTermMemoryScope, LongTermMemorySourceType } from '../memory/public';

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
    label: 'OpenAI 兼容接口',
    defaultBaseUrl: '',
    available: true,
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
  /** Dedicated fast model for dictionary-style translation requests. */
  translationModel: string;
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
  task?: string;
  documentName?: string;
  pageNumber?: number;
  totalPages?: number;
  selectedText?: string;
  pageText?: string;
  documentText?: string;
  agentEvidence?: string;
  sourceScope?: 'document' | 'page' | 'selection' | 'image' | 'general';
  sourceLabel?: string;
  sourcePages?: number[];
  contextNote?: string;
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
  routeId?: 'chat' | 'translation';
  /**
   * Per-request settings for specialised flows such as translation.  The API
   * key and provider always remain the user's saved configuration.
   */
  configOverride?: Pick<AiConfig, 'model' | 'reasoning' | 'maxOutputTokens'>;
}

/**
 * A model only passes the vision capability check when it reads this marker
 * from the generated test image. Keep the answer out of the prompt so a
 * text-only endpoint cannot pass merely by following the written instruction.
 */
export const AI_VISION_TEST_MARKER = 'PDF7392';
export const AI_VISION_TEST_PROMPT = '请读取图片中央的验证码，只返回验证码本身，不要解释。';

export interface AiTestRequest {
  type: 'pdf-helper:ai-test';
  mode?: 'discover' | 'validate';
  config?: Pick<AiConfig, 'providerId' | 'apiKey' | 'baseUrl' | 'model'> & {
    capabilities?: Array<'text' | 'vision'>;
  };
  imageDataUrl?: string;
}

export interface AiDetectReadingModeRequest {
  type: 'pdf-helper:ai-detect-reading-mode';
  documentName: string;
  sampleText: string;
  outlineTitles?: string[];
}

export interface AiGeneratePaperOverviewRequest {
  type: 'pdf-helper:ai-generate-paper-overview';
  requestId: string;
  documentName: string;
  pageCount: number;
  text: string;
  knowledgeContext?: string;
}

export interface AiCancelPaperOverviewRequest {
  type: 'pdf-helper:ai-cancel-paper-overview';
  requestId: string;
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

export interface AiPlanKnowledgeToolsRequest {
  type: 'pdf-helper:ai-plan-knowledge-tools';
  userMessage: string;
  documentId?: string;
  documentName?: string;
}

export interface AiNativeToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Exact provider text, retained so a tool-call assistant message can be replayed losslessly. */
  rawArguments?: string;
  /** Stream index used to assemble parallel tool calls. */
  index?: number;
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

export interface AiStreamToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  content: string;
}

export interface AiStreamToolResultsMessage {
  type: 'tool-results';
  requestId: string;
  results: AiStreamToolResult[];
}

export interface AiStreamDebugInfo {
  providerId: AiProviderId;
  model: string;
  baseUrl: string;
  reasoning: AiReasoningMode;
  maxOutputTokens: number;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    toolCalls?: AiNativeToolCall[];
    toolCallId?: string;
    reasoningContent?: string;
  }>;
  availableTools: Array<{
    name: string;
    description: string;
    parameters: string;
  }>;
  /** The exact native OpenAI-compatible tools payload sent separately from messages. */
  nativeTools?: Array<Record<string, unknown>>;
  toolChoice?: 'auto' | 'none' | 'required';
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
      type: 'tool-calls';
      requestId: string;
      calls: AiNativeToolCall[];
      round: number;
    }
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
  | AiCancelPaperOverviewRequest
  | AiCompressConversationRequest
  | AiPlanLongTermMemoryToolsRequest
  | AiPlanKnowledgeToolsRequest
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
  translationModel: 'deepseek-v4-flash',
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
    || type === 'pdf-helper:ai-cancel-paper-overview'
    || type === 'pdf-helper:ai-compress-conversation'
    || type === 'pdf-helper:ai-plan-long-term-memory-tools'
    || type === 'pdf-helper:ai-plan-knowledge-tools'
    || type === 'pdf-helper:ai-extract-long-term-memory'
    || type === 'pdf-helper:ai-vision'
    || type === 'pdf-helper:ai-vision-test';
}

export function normalizeAiMaxOutputTokens(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AI_CONFIG.maxOutputTokens;
  return Math.min(65536, Math.max(256, Math.trunc(parsed)));
}
