import {
  getReadingModeStrategy,
  type ResolvedReadingMode,
} from './reading-mode';

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
  supportsVision: boolean;
}

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    available: true,
    supportsVision: false,
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI 兼容接口（即将支持）',
    defaultBaseUrl: '',
    available: false,
    supportsVision: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic（即将支持）',
    defaultBaseUrl: '',
    available: false,
    supportsVision: true,
  },
  {
    id: 'gemini',
    label: 'Gemini（即将支持）',
    defaultBaseUrl: '',
    available: false,
    supportsVision: true,
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
  readingMode?: ResolvedReadingMode;
  task?: string;
  sourceScope?: 'selection' | 'page' | 'chapter' | 'document';
  sourceLabel?: string;
  sourcePages?: number[];
  contextNote?: string;
  visualFocus?: boolean;
}

export function buildAiSystemContent(context?: AiDocumentContext): string {
  if (context?.task?.startsWith('Agent 证据规划')) {
    return [
      'You are PDF Helper\'s internal evidence-planning controller, not the user-facing answering assistant.',
      'Never answer the user\'s question. Decide only whether the currently supplied evidence is sufficient and which local document tools must run next.',
      'Return exactly one valid JSON object matching the schema in the user message. Do not use Markdown fences, explanations outside JSON, or invented tool names.',
      context.contextNote ? `Planning constraint: ${context.contextNote}` : '',
    ].filter(Boolean).join('\n\n');
  }
  const readingMode = context?.readingMode ?? 'general';
  const strategy = getReadingModeStrategy(readingMode);
  const contextParts: string[] = [
    strategy.systemInstruction,
    strategy.contextInstruction(context?.pageNumber ?? 1, context?.totalPages),
  ];
  if (context?.visualFocus) {
    contextParts.push(
      '本轮附图是首要分析对象。用户说“图”“这个图”或“这部分”时，默认指用户附图；必须先分析附图中可见的对象、标签、流程、结构与关系。PDF 文字只用于补充背景，不得用当前页概述代替图像分析。只有用户明确说 PDF 页内的 Fig、图号或页码时，才把 PDF 页面图像作为首要对象。',
    );
  }
  if (context?.task) contextParts.push(`当前任务：${context.task}`);
  if (context?.documentName) contextParts.push(`当前文档：${context.documentName}`);
  if (context?.pageNumber) contextParts.push(`当前页码：第 ${context.pageNumber} 页`);
  if (context?.sourceLabel) contextParts.push(`本次实际引用范围：${context.sourceLabel}`);
  if (context?.sourcePages?.length) {
    contextParts.push(`本次实际引用页码：${context.sourcePages.map((page) => `第 ${page} 页`).join('、')}`);
  }
  if (context?.contextNote) contextParts.push(`上下文说明：${context.contextNote}`);
  if (context?.selectedText?.trim()) {
    contextParts.push(context.visualFocus
      ? `用户当前选中的 PDF 原文（仅作为附图分析的补充背景）：\n${context.selectedText.trim().slice(0, 12000)}`
      : `用户当前选中的 PDF 原文（若问题明确指向选区则优先，否则把它作为定位线索，并结合 Agent 检索到的跨页证据）：\n${context.selectedText.trim().slice(0, 12000)}`);
  }
  if (context?.pageText?.trim()) {
    contextParts.push(`提供给你的 PDF 上下文：\n${context.pageText.trim().slice(0, 24000)}`);
  }

  return [
    '你是 PDF Helper 的阅读助手。请结合提供的 PDF 上下文，用清晰、准确、可核验的中文回答。',
    '只依据本次明确提供的选区、页面、章节或 Agent 工具检索结果作答；按用户问题需要的范围组织证据，不要无条件把当前页当成回答中心。如果上下文不足，请指出缺少什么，不要编造文档中不存在的内容。',
    '解释时先说直白含义，再说明必要的逻辑、条件或公式；不要把同一个结论拆成很多近义要点。',
    '请使用简洁的 Markdown，不要给整个回答套代码围栏。数学变量和公式必须使用 LaTeX：行内用 $...$，独立公式用 $$...$$；不要把 2^{-\\gamma} 这类表达裸写在数学定界符外。',
    '需要引用 PDF 原文来支持结论时，请在相关句子后输出 [[PDF:P页码|逐字原文]]。例如：[[PDF:P6|The security requirement states that...]]。页码必须来自“本次实际引用页码”，原文必须逐字复制自提供的 PDF 上下文，长度控制在 10—180 个字符；概括、推测或没有原文依据时不要生成该标记。',
    ...contextParts,
  ].join('\n\n');
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

export type AiStreamServerMessage =
  | { type: 'started'; requestId: string; model: string }
  | { type: 'delta'; requestId: string; content: string }
  | { type: 'done'; requestId: string; model: string }
  | { type: 'error'; requestId: string; error: string };

export type AiRuntimeRequest =
  | AiChatRequest
  | AiTestRequest
  | AiDetectReadingModeRequest
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

export function isMainAiVisionCapable(config: AiConfig): boolean {
  return AI_PROVIDERS.find((provider) => provider.id === config.providerId)?.supportsVision ?? false;
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
    || type === 'pdf-helper:ai-vision'
    || type === 'pdf-helper:ai-vision-test';
}
