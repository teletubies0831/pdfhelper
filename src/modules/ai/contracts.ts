import type { ResolvedReadingMode } from '../reading-mode/public';

export const AI_CONFIG_STORAGE_KEY = 'pdf-helper-ai-config-v1';
export const VISION_AI_CONFIG_STORAGE_KEY = 'pdf-helper-vision-ai-config-v1';
export const LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY = 'pdf-helper-deepseek-config-v1';
export const AI_STREAM_PORT_NAME = 'pdf-helper:ai-stream-v1';
/**
 * Dedicated stream port for one-line entity explanations.
 *
 * Separate from `AI_STREAM_PORT_NAME` because the chat stream carries a conversation, agent tools and
 * tool rounds; a gloss is one sentence with no tools, and reusing the chat pipeline would send a chat
 * system prompt plus a tool schema just to ask for a few characters of meaning.
 */
export const AI_EXPLANATION_STREAM_PORT_NAME = 'pdf-helper:ai-explain-stream-v1';

/**
 * Dedicated port for the translation card.
 *
 * Two things make it its own port rather than a `sendMessage` round trip. It **streams**, because the sentence has to
 * appear while it is being written — waiting for a finished JSON blob is what made a one-sentence translation feel
 * like seven seconds of nothing. And it carries a **task**, because the card is produced in two independent halves:
 * the translation first, the vocabulary afterwards, so the reader never waits for the words they did not ask for.
 */
export const AI_TRANSLATION_STREAM_PORT_NAME = 'pdf-helper:ai-translate-stream-v1';

/** Which half of a learning card one stream produces. */
export type AiTranslationStreamTask = 'translation' | 'keywords';

export interface AiTranslationStreamStartMessage {
  type: 'start';
  requestId: string;
  task: AiTranslationStreamTask;
  /** The English sentence (or word) to work on, already normalised by the viewer. */
  text: string;
  /** The sentence a word sits in; omitted for the sentence task. */
  sentence?: string;
  /** True when the sentence carries maths, so the keyword pass should also re-emit it as LaTeX. */
  wantsSourceLatex?: boolean;
  /** The user's own learning preferences, passed through verbatim. */
  preferenceBlock?: string;
}

export type AiTranslationStreamServerMessage =
  | { type: 'started'; requestId: string; model: string }
  | { type: 'delta'; requestId: string; content: string }
  /**
   * `finishReason` travels with `done` because `length` means the answer was cut off: on models where thinking cannot
   * be disabled the reasoning shares the output budget, and a truncated sentence must not be presented (or cached) as
   * a complete translation.
   */
  | { type: 'done'; requestId: string; model: string; finishReason?: string }
  | { type: 'error'; requestId: string; error: string };

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

/**
 * Web retrieval through DeepSeek's Search / Fetch tools, used by 「相关论文」 and by the chat's 联网 switch.
 *
 * Not part of a model connection: the tools endpoints are DeepSeek's own service (they take no model name
 * and are authorised by a DeepSeek key), so they get their own settings rather than a field on whichever
 * provider the user happened to add.
 */
export interface AiWebRetrievalConfig {
  /** Tools base URL; `/search` and `/fetch` are appended. */
  baseUrl: string;
  apiKey: string;
  /** Candidates asked for per search. Upstream allows 1–50; billing is per request, not per result. */
  count: number;
  /** Pages that may be fetched for full text when a search result carried none. */
  maxFetches: number;
}

/** DeepSeek's tools base URL. The chat base is `https://api.deepseek.com`; this one ends at `/v1/tools`. */
export const DEEPSEEK_TOOLS_BASE_URL = 'https://api.deepseek.com/v1/tools';

export const WEB_RETRIEVAL_DEFAULT_COUNT = 8;
export const WEB_RETRIEVAL_COUNT_MIN = 3;
export const WEB_RETRIEVAL_COUNT_MAX = 20;
export const WEB_RETRIEVAL_MAX_FETCHES_LIMIT = 3;

/** What one related-papers run cost, in tool calls. Shown to the user; never derived from tokens. */
export interface AiWebRetrievalUsage {
  searchCalls: number;
  fetchCalls: number;
}

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

export interface AiEvidenceSource {
  documentId: string;
  documentName: string;
  pageNumber: number;
  recentEntryId?: string;
}

export interface AiConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: AiImageAttachment[];
  evidenceSources?: AiEvidenceSource[];
}

export interface AiDocumentContext {
  task?: string;
  /** Current user turn, used by local tool handlers for authorization checks. */
  userMessage?: string;
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
  readingMode?: ResolvedReadingMode;
  /**
   * Web pages fetched for this turn, pre-formatted for the prompt.
   *
   * A context field rather than a tool: the model gets one round of search results and cannot page through more,
   * which bounds both latency and cost per question.
   */
  webSearchNotes?: string;
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
  testSettings?: { maxOutputTokens: number; concurrency: number };
  config?: Pick<AiConfig, 'providerId' | 'apiKey' | 'baseUrl' | 'model'> & {
    capabilities?: Array<'text' | 'vision'>;
  };
  imageDataUrl?: string;
}

/**
 * Probes the configured tools endpoint with one search.
 *
 * Deliberately a separate request instead of folding it into `AiTestRequest`: a model test scans models and
 * spends tokens, while this spends a search call and must report the *tools* error taxonomy (401 vs 402 vs
 * 429) — the difference between "wrong key", "no balance" and "slow down".
 */
export interface AiTestWebRetrievalRequest {
  type: 'pdf-helper:ai-test-web-retrieval';
}

/**
 * Builds (or rebuilds) the 「相关论文」 section for one saved overview.
 *
 * On demand rather than during overview generation: it costs a retrieval call and a model call, and the user
 * decides when to spend them.
 */
export interface AiRelatedLiteratureRequest {
  type: 'pdf-helper:ai-related-literature';
  requestId: string;
  documentName: string;
  overviewMarkdown: string;
}

/**
 * One web search for a chat turn, run by the service worker.
 *
 * The page asks; the background resolves the settings and holds the key. That keeps the credential out of the
 * viewer and gives one place that can answer "is web retrieval configured".
 */
export interface AiWebSearchRequest {
  type: 'pdf-helper:ai-web-search';
  requestId: string;
  query: string;
  /** The user's question, so the engine reads the intent rather than a keyword soup. */
  oriQuestion?: string;
}

export interface AiDetectReadingModeRequest {
  type: 'pdf-helper:ai-detect-reading-mode';
  documentName: string;
  sampleText: string;
  outlineTitles?: string[];
}

export interface AiGenerateDocumentOverviewRequest {
  type: 'pdf-helper:ai-generate-document-overview';
  requestId: string;
  documentName: string;
  pageCount: number;
  text: string;
}

export interface AiDocumentOverviewProgress {
  content: string;
  message: string;
  complete: boolean;
}

/** One chunk of a paper, as handed to the entity extractor. */
export interface AiEntityExtractionChunk {
  chunkId: string;
  heading?: string;
  startPage: number;
  endPage: number;
  text: string;
}

/**
 * Knowledge-graph candidate entity extraction for one paper.
 *
 * Sent as a single request carrying every chunk, rather than one request per
 * chunk: the service worker is the caller and it can be torn down between
 * messages, so fewer round trips means fewer orphaned jobs. The response is plain
 * text (there is no provider JSON mode) that the caller parses defensively.
 */
export interface AiExtractEntitiesRequest {
  type: 'pdf-helper:ai-extract-entities';
  requestId: string;
  paperId: string;
  paperTitle: string;
  documentName: string;
  /**
   * The paper's abstract, when one is known.
   *
   * Sent ahead of the chunks because each call only sees three of them: without it the model reads
   * a background paragraph in the Introduction as if it were the paper's own contribution. The
   * abstract is the cheapest available statement of what the paper actually does.
   */
  abstract?: string;
  chunks: AiEntityExtractionChunk[];
  /** Hard cap on candidates kept per response; the main token-cost lever. */
  maxCandidatesPerChunk: number;
  /** Injected for testability; defaults to the built-in extraction prompt. */
  promptOverride?: string;
}

/**
 * One paper, as the relation judge sees it: title plus a verbatim excerpt.
 *
 * The excerpt is sent **once per paper** rather than per pair, because a bridge concept has to be
 * supported by a quote from each side and the quote is verified against exactly this text afterwards.
 * Sending it per pair would multiply the input by the number of pairs for no extra information.
 */
export interface AiRelationPaperExcerpt {
  paperId: string;
  title: string;
  /** Abstract, else the knowledge base overview lead. Empty when neither exists. */
  excerpt: string;
}

/** One paper pair to judge, with the context the model needs. */
export interface AiRelationCandidate {
  /** Deterministic key; echoed back by the model so answers can be matched. */
  pairKey: string;
  leftPaperId: string;
  rightPaperId: string;
  leftTitle: string;
  rightTitle: string;
  sharedEntities: string[];
  recallReasons: string[];
}

/**
 * Knowledge-graph paper-to-paper relationship judgement, plus bridge concepts.
 *
 * The candidate list is already bounded by the caller's selection or recall funnel, so this request is
 * small by construction — the token ceiling was decided before the message was built, not here.
 */
export interface AiJudgeRelationsRequest {
  type: 'pdf-helper:ai-judge-relations';
  requestId: string;
  /** Excerpts for every paper mentioned by `pairs`. */
  papers: AiRelationPaperExcerpt[];
  pairs: AiRelationCandidate[];
  /** Injected for testability; defaults to the built-in judgement prompt. */
  promptOverride?: string;
}

/** One entity the model is asked to explain, with the context it may ground the answer in. */
export interface AiEntityExplainItem {
  name: string;
  type: string;
  aliases?: string[];
  paperTitle: string;
  /** Abstract lead, when one is known: the cheapest statement of what the paper does. */
  abstract?: string;
  /** Verbatim sentences where the entity appears, already stored on the entity as evidence. */
  quotes: string[];
}

/**
 * Short per-entity glosses for entities the user just confirmed into the graph.
 *
 * Sent as one request for the whole confirmation rather than one per entity: the answers are a few
 * dozen characters each, and a round trip per name would cost more than the content.
 */
export interface AiExplainEntitiesRequest {
  type: 'pdf-helper:ai-explain-entities';
  requestId: string;
  items: AiEntityExplainItem[];
  /** Injected for testability; defaults to the built-in explanation prompt. */
  promptOverride?: string;
}

export interface AiCompressConversationRequest {
  type: 'pdf-helper:ai-compress-conversation';
  previousSummary?: string;
  messages: AiConversationMessage[];
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
  testSettings?: { maxOutputTokens: number; concurrency: number };
}

export interface AiStreamStartMessage {
  type: 'start';
  requestId: string;
  messages: AiConversationMessage[];
  context?: AiDocumentContext;
  /** Serializable result of the embedded MCP client's tools/list request. */
  mcpTools?: Array<{
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
  }>;
}

/** Client to background: explain exactly one entity, streaming the sentence back. */
export interface AiExplanationStreamStartMessage {
  type: 'start';
  requestId: string;
  item: AiEntityExplainItem;
}

/**
 * Background to client for the explanation stream.
 *
 * Deliberately the same four shapes as the chat stream (`started`/`delta`/`done`/`error`) so the
 * viewer client reads the same way, minus tool calls, which a gloss never produces.
 */
export type AiExplanationStreamServerMessage =
  | { type: 'started'; requestId: string; model: string }
  | { type: 'delta'; requestId: string; content: string }
  | { type: 'done'; requestId: string; model: string }
  | { type: 'error'; requestId: string; error: string };

export interface AiStreamToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  content: string;
}export interface AiStreamToolResultsMessage {
  type: 'tool-results';
  requestId: string;
  results: AiStreamToolResult[];
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
  | { type: 'started'; requestId: string; model: string }
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
      completion?: AiStreamCompletionInfo;
    }
  | { type: 'error'; requestId: string; error: string; details?: AiStreamErrorInfo };

export type AiRuntimeRequest =
  | AiChatRequest
  | AiTestRequest
  | AiTestWebRetrievalRequest
  | AiRelatedLiteratureRequest
  | AiWebSearchRequest
  | AiDetectReadingModeRequest
  | AiGenerateDocumentOverviewRequest
  | AiExtractEntitiesRequest
  | AiJudgeRelationsRequest
  | AiExplainEntitiesRequest
  | AiCompressConversationRequest
  | AiVisionRequest
  | AiVisionTestRequest;

export interface AiRuntimeResponse {
  ok: boolean;
  content?: string;
  models?: string[];
  model?: string;
  readingMode?: ResolvedReadingMode;
  rationale?: string;
  toolCalls?: AiNativeToolCall[];
  error?: string;
  /**
   * Present on `pdf-helper:ai-extract-entities` responses. Extraction runs in
   * batches, and a partially successful run is useful: the caller parses the
   * concatenated content and records which batches still need a retry.
   */
  entityExtraction?: {
    batchCount: number;
    failedBatches: Array<{ chunkIds: string[]; error: string }>;
    promptVersion: string;
  };
  /**
   * Present on `pdf-helper:ai-judge-relations` responses: how many provider calls
   * ran and which pairs failed, so a partial run is reported as partial.
   */
  relationJudgement?: {
    batchCount: number;
    failedBatches: Array<{ pairKeys: string[]; error: string }>;
  };
  /**
   * Present on `pdf-helper:ai-related-literature` responses: the section itself plus what it cost, so the
   * page can say "1 次检索" instead of pretending the lookup was free.
   */
  relatedLiterature?: {
    markdown: string;
    usage: AiWebRetrievalUsage;
    /** Which candidate sources contributed; `openalex` alone means web retrieval was unavailable. */
    sources: Array<'deepseek' | 'openalex'>;
    degraded?: string;
  };
  /** Present on `pdf-helper:ai-web-search` responses: what the turn's search found and cost. */
  webSearch?: {
    hits: Array<{ title: string; url: string; summary: string }>;
    searchCalls: number;
  };
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
  const candidate = value.trim()
    || AI_PROVIDERS.find((provider) => provider.id === providerId)?.defaultBaseUrl
    || '';
  if (!candidate) return '';

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('请输入有效的 API 地址。');
  }

  const hostname = url.hostname.toLowerCase();
  const isLoopback = hostname === 'localhost'
    || hostname === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('API 地址必须使用 HTTPS；本机 localhost 服务可使用 HTTP。');
  }
  if (url.username || url.password) {
    throw new Error('API 地址不能包含用户名或密码。');
  }
  if (url.search || url.hash) {
    throw new Error('API 地址不能包含查询参数或锚点。');
  }

  return candidate.replace(/\/+$/, '');
}

export function isAiRuntimeRequest(value: unknown): value is AiRuntimeRequest {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return type === 'pdf-helper:ai-chat'
    || type === 'pdf-helper:ai-test'
    || type === 'pdf-helper:ai-test-web-retrieval'
    || type === 'pdf-helper:ai-related-literature'
    || type === 'pdf-helper:ai-web-search'
    || type === 'pdf-helper:ai-detect-reading-mode'
    || type === 'pdf-helper:ai-generate-document-overview'
    || type === 'pdf-helper:ai-extract-entities'
    || type === 'pdf-helper:ai-judge-relations'
    || type === 'pdf-helper:ai-explain-entities'
    || type === 'pdf-helper:ai-compress-conversation'
    || type === 'pdf-helper:ai-vision'
    || type === 'pdf-helper:ai-vision-test';
}

/**
 * Normalizes the tools base URL.
 *
 * A different value from `normalizeAiBaseUrl` in one respect: an **empty** entry means "not configured" and
 * must stay empty rather than fall back to a default, because the whole point of the empty state is that the
 * 检索 button says so instead of silently calling DeepSeek with someone else's endpoint.
 */
export function normalizeAiToolsBaseUrl(value: unknown): string {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate) return '';
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('联网检索地址不是有效的 URL。');
  }
  const hostname = url.hostname.toLowerCase();
  const isLoopback = hostname === 'localhost'
    || hostname === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('联网检索地址必须使用 HTTPS；本机 localhost 服务可使用 HTTP。');
  }
  if (url.search || url.hash) {
    throw new Error('联网检索地址不能包含查询参数或锚点。');
  }
  return candidate.replace(/\/+$/, '');
}

export function normalizeWebRetrievalCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return WEB_RETRIEVAL_DEFAULT_COUNT;
  return Math.min(
    WEB_RETRIEVAL_COUNT_MAX,
    Math.max(WEB_RETRIEVAL_COUNT_MIN, Math.trunc(parsed)),
  );
}

export function normalizeWebRetrievalMaxFetches(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(WEB_RETRIEVAL_MAX_FETCHES_LIMIT, Math.max(0, Math.trunc(parsed)));
}

export function normalizeAiMaxOutputTokens(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AI_CONFIG.maxOutputTokens;
  return Math.min(65536, Math.max(256, Math.trunc(parsed)));
}
