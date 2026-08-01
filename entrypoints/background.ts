import { browser } from 'wxt/browser';

import {
  ACTION_LABELS,
  SELECTION_STORAGE_KEY,
  isSelectionAction,
  type SelectionAction,
  type SelectionRequest,
} from '../shared/selection';
import { extractPdfSource } from '../shared/pdf-source';
import {
  AI_CONFIG_STORAGE_KEY,
  AI_STREAM_PORT_NAME,
  DEFAULT_AI_CONFIG,
  DEFAULT_VISION_AI_CONFIG,
  LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY,
  VISION_AI_CONFIG_STORAGE_KEY,
  isAiRuntimeRequest,
  normalizeAiBaseUrl,
  normalizeAiMaxOutputTokens,
  type AiConfig,
  type AiConversationMessage,
  type AiDocumentContext,
  type AiRuntimeRequest,
  type AiRuntimeResponse,
  type AiStreamServerMessage,
  type AiStreamStartMessage,
  type VisionAiConfig,
} from '../shared/ai';
import {
  getReadingModeStrategy,
  isResolvedReadingMode,
  type ResolvedReadingMode,
} from '../shared/reading-mode';

const MENU_ROOT_ID = 'pdf-helper-selection';
const MENU_PREFIX = 'pdf-helper-action-';

async function registerContextMenus() {
  await browser.contextMenus.removeAll();

  browser.contextMenus.create({
    id: MENU_ROOT_ID,
    title: '发送给 PDF Helper',
    contexts: ['selection'],
  });

  for (const [action, label] of Object.entries(ACTION_LABELS)) {
    browser.contextMenus.create({
      id: `${MENU_PREFIX}${action}`,
      parentId: MENU_ROOT_ID,
      title: label,
      contexts: ['selection'],
    });
  }
}

async function saveSelection(
  action: SelectionAction,
  text: string,
  tab?: { title?: string; url?: string },
) {
  const request: SelectionRequest = {
    id: crypto.randomUUID(),
    action,
    text: text.trim(),
    pageTitle: tab?.title,
    pageUrl: tab?.url,
    createdAt: Date.now(),
  };

  await browser.storage.local.set({ [SELECTION_STORAGE_KEY]: request });
}

async function openEnhancedViewer() {
  const viewerUrl = browser.runtime.getURL('/viewer.html');
  const tabs = await browser.tabs.query({});
  const existingTab = tabs.find((tab) => tab.url?.startsWith(viewerUrl));

  if (existingTab?.id !== undefined) {
    await browser.tabs.update(existingTab.id, { active: true });
    if (existingTab.windowId !== undefined) {
      await browser.windows.update(existingTab.windowId, { focused: true });
    }
    return;
  }

  await browser.tabs.create({ url: viewerUrl });
}

async function openHelperPanelPage() {
  await browser.tabs.create({ url: browser.runtime.getURL('/helper-panel.html') });
}

type LegacyDeepSeekConfig = Partial<AiConfig> & { thinking?: AiConfig['reasoning'] };

async function getAiConfig(): Promise<AiConfig> {
  const stored = await browser.storage.local.get([
    AI_CONFIG_STORAGE_KEY,
    LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY,
  ]);
  const current = stored[AI_CONFIG_STORAGE_KEY] as Partial<AiConfig> | undefined;
  const legacy = stored[LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY] as LegacyDeepSeekConfig | undefined;
  const source = current || legacy;
  const providerId = source?.providerId ?? DEFAULT_AI_CONFIG.providerId;
  const config: AiConfig = {
    ...DEFAULT_AI_CONFIG,
    ...source,
    providerId,
    apiKey: source?.apiKey?.trim() ?? '',
    baseUrl: normalizeAiBaseUrl(source?.baseUrl ?? '', providerId),
    reasoning: source?.reasoning ?? legacy?.thinking ?? DEFAULT_AI_CONFIG.reasoning,
    model: source?.model || DEFAULT_AI_CONFIG.model,
    maxOutputTokens: normalizeAiMaxOutputTokens(source?.maxOutputTokens),
  };

  if (!current && legacy) {
    await browser.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: config });
  }
  return config;
}

async function getVisionAiConfig(): Promise<VisionAiConfig> {
  const stored = await browser.storage.local.get(VISION_AI_CONFIG_STORAGE_KEY);
  const value = stored[VISION_AI_CONFIG_STORAGE_KEY] as Partial<VisionAiConfig> | undefined;
  return {
    ...DEFAULT_VISION_AI_CONFIG,
    ...value,
    mode: value?.mode === 'separate' ? 'separate' : 'disabled',
    providerId: 'openai-compatible',
    apiKey: value?.apiKey?.trim() ?? '',
    baseUrl: value?.baseUrl?.trim().replace(/\/+$/, '') ?? '',
    model: value?.model?.trim() ?? '',
  };
}

function getProviderError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}

type ProviderMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

interface ProviderChatResult {
  content: string;
  model: string;
  reasoningContent?: string;
}

interface ProviderStreamDelta {
  content?: string;
  reasoningContent?: string;
}

function getVisionContent(payload: unknown): string {
  const content = (payload as {
    choices?: Array<{ message?: { content?: unknown } }>;
  })?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => item && typeof item === 'object' && 'text' in item
      ? String((item as { text?: unknown }).text ?? '')
      : '')
    .join('\n')
    .trim();
}

async function requestVisionCompletion(
  config: VisionAiConfig,
  prompt: string,
  imageDataUrl: string,
  context?: AiDocumentContext,
): Promise<ProviderChatResult> {
  if (config.mode !== 'separate' || !config.apiKey || !config.baseUrl || !config.model) {
    throw new Error('请先在“设置”中完成视觉模型配置。');
  }
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: [
            '你是 PDF Helper 的视觉阅读工具，只分析图片中实际可见的内容。',
            '优先识别图表、公式、表格、流程图、页面结构以及文字抽取遗漏的信息。',
            '不确定时明确说明，不要补写图片中不存在的内容。',
            context?.documentName ? `文档：${context.documentName}` : '',
            context?.pageNumber ? `页码：第 ${context.pageNumber} 页` : '',
          ].filter(Boolean).join('\n'),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
          ],
        },
      ],
      stream: false,
      max_tokens: 1600,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getProviderError(payload, `视觉模型请求失败：HTTP ${response.status}`));
  }
  const content = getVisionContent(payload);
  if (!content) throw new Error('视觉模型没有返回有效内容。');
  return { content, model: config.model };
}

interface AiProviderAdapter {
  readonly id: AiConfig['providerId'];
  test(config: AiConfig): Promise<string[]>;
  chat(config: AiConfig, messages: ProviderMessage[], maxOutputTokens: number): Promise<ProviderChatResult>;
  stream(
    config: AiConfig,
    messages: ProviderMessage[],
    maxOutputTokens: number,
    signal: AbortSignal,
    onDelta: (delta: ProviderStreamDelta) => void,
  ): Promise<ProviderChatResult>;
}

async function fetchProviderJson(
  path: string,
  config: AiConfig,
  init?: RequestInit,
): Promise<unknown> {
  if (!config.apiKey) {
    throw new Error('请先在 PDF Helper 的“设置”中配置 API Key。');
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getProviderError(payload, `AI 请求失败：HTTP ${response.status}`));
  }

  return payload;
}

class DeepSeekProviderAdapter implements AiProviderAdapter {
  readonly id = 'deepseek' as const;

  async test(config: AiConfig): Promise<string[]> {
    const payload = await fetchProviderJson('/models', config);
    if (!Array.isArray((payload as { data?: unknown })?.data)) return [];
    return (payload as { data: Array<{ id?: unknown }> }).data
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string');
  }

  async chat(
    config: AiConfig,
    messages: ProviderMessage[],
    maxOutputTokens: number,
  ): Promise<ProviderChatResult> {
    const payload = await fetchProviderJson('/chat/completions', config, {
      method: 'POST',
      body: JSON.stringify({
        model: config.model,
        messages,
        thinking: { type: config.reasoning },
        stream: false,
        max_tokens: maxOutputTokens,
      }),
    }) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      model?: unknown;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('AI 模型没有返回有效回答。');
    }
    return {
      content: content.trim(),
      model: typeof payload.model === 'string' ? payload.model : config.model,
    };
  }

  async stream(
    config: AiConfig,
    messages: ProviderMessage[],
    maxOutputTokens: number,
    signal: AbortSignal,
    onDelta: (delta: ProviderStreamDelta) => void,
  ): Promise<ProviderChatResult> {
    if (!config.apiKey) throw new Error('请先在 PDF Helper 的“设置”中配置 API Key。');
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        thinking: { type: config.reasoning },
        stream: true,
        max_tokens: maxOutputTokens,
      }),
      signal,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(getProviderError(payload, `AI 请求失败：HTTP ${response.status}`));
    }
    if (!response.body) throw new Error('当前浏览器没有提供可读取的 AI 流式响应。');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completeContent = '';
    let completeReasoningContent = '';
    let finished = false;

    const processEvent = (event: string): boolean => {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
        .trim();
      if (!data) return false;
      if (data === '[DONE]') return true;
      const payload = JSON.parse(data) as {
        choices?: Array<{
          delta?: {
            content?: unknown;
            reasoning_content?: unknown;
          };
        }>;
      };
      const delta = payload.choices?.[0]?.delta;
      const reasoningContent = delta?.reasoning_content;
      if (typeof reasoningContent === 'string' && reasoningContent) {
        completeReasoningContent += reasoningContent;
        onDelta({ reasoningContent });
      }
      const content = delta?.content;
      if (typeof content === 'string' && content) {
        completeContent += content;
        onDelta({ content });
      }
      return false;
    };

    while (!finished) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const event of events) {
        if (processEvent(event)) {
          finished = true;
          break;
        }
      }
      if (done) {
        if (buffer.trim()) processEvent(buffer);
        break;
      }
    }

    return {
      content: completeContent,
      model: config.model,
      reasoningContent: completeReasoningContent || undefined,
    };
  }
}

const providerAdapters: Partial<Record<AiConfig['providerId'], AiProviderAdapter>> = {
  deepseek: new DeepSeekProviderAdapter(),
};

function getProviderAdapter(config: AiConfig): AiProviderAdapter {
  const adapter = providerAdapters[config.providerId];
  if (!adapter) throw new Error('当前模型供应商尚未接入，请在设置中选择已支持的供应商。');
  return adapter;
}

function buildSystemContent(context?: AiDocumentContext): string {
  const readingMode = context?.readingMode ?? 'general';
  const strategy = getReadingModeStrategy(readingMode);
  const contextParts: string[] = [
    strategy.systemInstruction,
    strategy.contextInstruction(context?.pageNumber ?? 1, context?.totalPages),
  ];
  if (context?.documentName) contextParts.push(`当前文档：${context.documentName}`);
  if (context?.pageNumber) contextParts.push(`当前页码：第 ${context.pageNumber} 页`);
  if (context?.selectedText?.trim()) {
    contextParts.push(`用户当前选中的 PDF 原文（回答时最高优先级）：\n${context.selectedText.trim().slice(0, 12000)}`);
  }
  if (context?.pageText?.trim()) {
    contextParts.push(`当前页完整正文（用于定位当前阅读位置）：\n${context.pageText.trim()}`);
  }
  if (context?.documentText?.trim()) {
    const documentInstructions = context?.imageAnalysis?.trim()
      ? [
        '下面提供整篇论文的全部可提取正文，已按 PDF 页码分隔。',
        '本轮必须先回答截图中实际展示的内容；论文全文仅用于补充截图的背景、术语、方法位置和上下文。',
        '不得跳过截图分析并直接输出当前页概述或整篇论文总结。',
      ]
      : [
        '下面提供的是整篇论文的全部可提取正文，已按 PDF 页码分隔。',
        '回答前必须先综合全文判断研究问题、方法、实验、证据、结论和局限，不能只依据当前页。',
        '当前页和用户选区用于确定提问重点，但全文内容是回答的完整依据。',
      ];
    contextParts.push([
      ...documentInstructions,
      `论文全文：\n${context.documentText.trim()}`,
    ].join('\n'));
  }
  if (context?.imageAnalysis?.trim()) {
    contextParts.push([
      '【本轮用户截图——最高优先级】',
      '用户问题中的“这部分”“这里”“这个”“图里”等指代，默认且必须指向用户上传的截图。',
      '请直接解释截图中实际出现的内容，不要把问题改写成“当前 PDF 页面讲了什么”或“整篇论文讲了什么”。',
      '回答顺序必须是：先分析截图，再结合已提供的论文全文补充；论文内容不能覆盖截图主旨。',
      `视觉工具分析结果：\n${context.imageAnalysis.trim().slice(0, 24000)}`,
    ].join('\n'));
  }

  const hasPdfEvidence = Boolean(
    context?.documentText?.trim()
    || context?.pageText?.trim()
    || context?.selectedText?.trim(),
  );
  const primaryInstruction = context?.imageAnalysis?.trim()
    ? '你是 PDF Helper 的视觉问答助手。本轮首要对象是用户上传的截图，请依据视觉工具分析结果直接回答截图问题。'
    : '你是 PDF Helper 的论文阅读助手。请阅读所提供的整篇论文全文，并用清晰、准确、可核验的中文回答。';

  return [
    primaryInstruction,
    '如果上下文不足，请明确说明，不要编造文档中不存在的内容。涉及翻译时忠实保留术语，涉及解释时优先给出直观含义。',
    '请使用简洁的 Markdown 组织回答；不要给整个回答套一层 Markdown 代码围栏。数学变量和公式必须使用 LaTeX：行内公式用 $...$，独立公式用 $$...$$。',
    ...contextParts,
    hasPdfEvidence ? [
      '【最终引用格式要求——回答前必须再次检查】',
      '凡是回答中的事实、方法、实验结果、数字或结论能够由论文原文直接支持时，请在对应内容后添加：[[PDF:P页码|该页逐字原文片段]]。',
      '正确示例：[[PDF:P8|the matching rates are divided into three bins]]。',
      '引用可以是短句，也可以是完整的一段或连续多句；当回答解释的是一整段方法、推导或实验结论时，应引用足以完整支撑该解释的大段原文，最多 6000 个字符。',
      '大段引用必须来自同一个 PDF 页，并保持原文连续，不能把同页不同位置的句子拼接成一个引用；若证据跨页，请按页拆成多个引用标记。',
      '引用标记内部必须直接复制所提供 PDF 全文中的纯文本，不要在原文中重新添加 Markdown、LaTeX 定界符或改写数学符号。',
      '回答完成后检查：只要关键论断在论文中有直接依据，就应给出可校验引用；引用长度以能够完整支撑对应解释为准，不要为了缩短而丢失必要上下文。',
      '禁止输出 [[PDF:8]]、[[PDF:P8]]、[PDF:8] 等不含逐字原文的简写；这些格式无法校验，也不会显示为可点击引用。',
      '页码必须使用所提供全文中的 PDF 页码；原文短句必须逐字摘自该页。',
      '只有确实存在对应原文时才能添加标记。无法找到逐字原文时不要添加引用，严禁编造页码、改写原句后冒充原文或给推测性内容添加引用。',
      '引用标记只用于事实依据，不要单独列出参考文献清单。',
    ].join('\n') : '',
  ].filter(Boolean).join('\n\n');
}

function buildConversation(
  messages: AiConversationMessage[],
  context?: AiDocumentContext,
): ProviderMessage[] {
  const conversation: ProviderMessage[] = messages
    .filter((item) => item.content.trim())
    .slice(-16)
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 16000) }));
  return [{ role: 'system', content: buildSystemContent(context) }, ...conversation];
}

type RuntimePort = ReturnType<typeof browser.runtime.connect>;

function isAiStreamStartMessage(value: unknown): value is AiStreamStartMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AiStreamStartMessage>;
  return candidate.type === 'start'
    && typeof candidate.requestId === 'string'
    && Array.isArray(candidate.messages);
}

function postAiStreamMessage(
  port: RuntimePort,
  message: AiStreamServerMessage,
): void {
  try {
    port.postMessage(message);
  } catch {
    // The viewer may have closed while a network chunk was in flight.
  }
}

async function streamAiResponse(
  request: AiStreamStartMessage,
  port: RuntimePort,
  signal: AbortSignal,
): Promise<void> {
  const config = await getAiConfig();
  const adapter = getProviderAdapter(config);
  const maxOutputTokens = config.maxOutputTokens;
  const conversation = buildConversation(request.messages, request.context);
  const debug = {
    providerId: config.providerId,
    model: config.model,
    baseUrl: config.baseUrl,
    reasoning: config.reasoning,
    maxOutputTokens,
    messages: conversation,
    tools: [],
  };
  postAiStreamMessage(port, {
    type: 'started',
    requestId: request.requestId,
    model: config.model,
    debug,
  });
  const result = await adapter.stream(
    config,
    conversation,
    maxOutputTokens,
    signal,
    (delta) => {
      if (delta.reasoningContent) {
        postAiStreamMessage(port, {
          type: 'reasoning-delta',
          requestId: request.requestId,
          content: delta.reasoningContent,
        });
      }
      if (delta.content) {
        postAiStreamMessage(port, {
          type: 'delta',
          requestId: request.requestId,
          content: delta.content,
        });
      }
    },
  );
  postAiStreamMessage(port, {
    type: 'done',
    requestId: request.requestId,
    model: result.model,
    debug,
  });
}

function parseReadingModeDetection(content: string): {
  readingMode: ResolvedReadingMode;
  rationale: string;
} {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const payload = JSON.parse(cleaned) as { mode?: unknown; rationale?: unknown };
    if (isResolvedReadingMode(payload.mode)) {
      return {
        readingMode: payload.mode,
        rationale: typeof payload.rationale === 'string' ? payload.rationale.trim() : '',
      };
    }
  } catch {
    // Fall back to a strict word match for providers that wrap the JSON in prose.
  }
  const match = cleaned.match(/\b(paper|novel|general)\b/i)?.[1]?.toLowerCase();
  if (!isResolvedReadingMode(match)) throw new Error('AI 没有返回可识别的阅读模式。');
  return { readingMode: match, rationale: cleaned.slice(0, 180) };
}

async function handleAiRequest(message: AiRuntimeRequest): Promise<AiRuntimeResponse> {
  try {
    if (message.type === 'pdf-helper:ai-vision' || message.type === 'pdf-helper:ai-vision-test') {
      const visionConfig = await getVisionAiConfig();
      const result = await requestVisionCompletion(
        visionConfig,
        message.type === 'pdf-helper:ai-vision-test'
          ? '这是连接测试图，请只回答“视觉连接成功”。'
          : message.prompt,
        message.type === 'pdf-helper:ai-vision-test'
          ? message.imageDataUrl
            || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZsgAAAABJRU5ErkJggg=='
          : message.imageDataUrl,
        message.type === 'pdf-helper:ai-vision' ? message.context : undefined,
      );
      return { ok: true, content: result.content, model: result.model };
    }

    const config = await getAiConfig();
    const adapter = getProviderAdapter(config);

    if (message.type === 'pdf-helper:ai-test') {
      const models = await adapter.test(config);
      return { ok: true, models };
    }

    if (message.type === 'pdf-helper:ai-detect-reading-mode') {
      const outline = message.outlineTitles?.filter(Boolean).slice(0, 80).join(' / ') || '未提供';
      const result = await adapter.chat(config, [{
        role: 'system',
        content: [
          '你是 PDF 文档类型识别器。只判断最适合的阅读策略，不要总结文档。',
          'paper：学术论文、研究报告、包含研究问题/方法/实验/结论的文档。',
          'novel：小说、故事、戏剧或以人物和情节推进的叙事作品。',
          'general：教材、说明书、传记、普通非虚构或无法明确归类的材料。',
          '只返回 JSON：{"mode":"paper|novel|general","rationale":"不超过40字的理由"}',
        ].join('\n'),
      }, {
        role: 'user',
        content: [
          `文件名：${message.documentName}`,
          `目录：${outline}`,
          '文档样本：',
          message.sampleText.slice(0, 24000),
        ].join('\n\n'),
      }], 300);
      const detection = parseReadingModeDetection(result.content);
      return { ok: true, model: result.model, ...detection };
    }

    if (message.type === 'pdf-helper:ai-generate-paper-overview') {
      const sourceText = message.text.trim().slice(0, 55_000);
      if (!sourceText) throw new Error('论文原文不能为空。');

      const result = await adapter.chat(config, [{
        role: 'system',
        content: [
          '你是一名严谨的中文论文阅读助手，服务对象是研究生论文阅读。请根据用户提供的整篇论文或论文采样文本，生成一张更适合研究生使用的结构化论文卡片。',
          '事实类信息必须忠于原文，不能编造作者、数据集、指标、实验结果、局限性、会议等级等；原文没有明确说明的字段必须填写“原文未明确出现”。',
          '标题和作者尽量从论文首页识别；年份、会议或期刊只有明确出现时才填写。keywords、topic_tags 可以根据原文标题、摘要与正文关键词概括。',
          'reading_status 固定填写“略读完成”。recommend_deep_reading 只能填写“建议精读”“建议按需精读”或“暂不建议精读”。reading_difficulty 只能填写“较易”“中等”或“较难”。reading_value_score 填 0 到 10 的数字，可以带 1 位小数，它是基于论文内容做出的阅读辅助判断，不属于论文原始事实。',
          'worth_reading、reading_advice、suitable_stages、prerequisites、research_connection、followup_questions、weekly_plan 属于“研究生阅读辅助建议”，允许你基于论文内容做合理判断，但要简洁、具体、可执行。',
          'method_steps 尽量写成 1/2/3/4 结构；citation_points 应概括最值得在后续写作中引用的 1 到 3 个观点，并说明其用途。',
          '只返回一个 JSON 对象，不要使用 Markdown，不要添加解释。JSON 字段必须是：',
          '{"title":"","authors":"","venue_year":"","research_area":"","keywords":"","one_sentence_summary":"","research_problem":"","core_innovation":"","worth_reading":"","problem_setup":"","research_gap":"","why_important":"","topic_tags":"","method_overview":"","method_intuition":"","method_steps":"","key_assumptions":"","notation_guide":"","datasets":"","experiment_setup":"","metrics":"","main_findings":"","strongest_evidence":"","comparison_with_prior_work":"","limitations":"","reading_status":"略读完成","recommend_deep_reading":"建议按需精读","reading_difficulty":"中等","reading_value_score":"8.0","reading_advice":"","suitable_stages":"","prerequisites":"","citation_points":"","research_connection":"","followup_questions":"","weekly_plan":""}',
        ].join('\n'),
      }, {
        role: 'user',
        content: [
          `文件名：${message.documentName || '未提供'}`,
          `PDF 页数：${Math.max(1, Math.trunc(message.pageCount || 1))}`,
          '论文原文：',
          sourceText,
        ].join('\n\n'),
      }], 4096);

      return {
        ok: true,
        content: result.content,
        model: result.model,
      };
    }

    const result = await adapter.chat(
      config,
      buildConversation(message.messages, message.context),
      config.maxOutputTokens,
    );
    return {
      ok: true,
      content: result.content,
      model: result.model,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default defineBackground(() => {
  void registerContextMenus();

  browser.action.onClicked.addListener(() => {
    void openEnhancedViewer();
  });

  browser.runtime.onMessage.addListener((message) => {
    if (!isAiRuntimeRequest(message)) return undefined;
    return handleAiRequest(message);
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== AI_STREAM_PORT_NAME) return;

    let activeRequest: AbortController | undefined;
    port.onMessage.addListener((message) => {
      if (!isAiStreamStartMessage(message)) return;

      activeRequest?.abort();
      activeRequest = new AbortController();
      const { signal } = activeRequest;
      void streamAiResponse(message, port, signal).catch((error) => {
        if (signal.aborted) return;
        postAiStreamMessage(port, {
          type: 'error',
          requestId: message.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
    port.onDisconnect.addListener(() => {
      activeRequest?.abort();
      activeRequest = undefined;
    });
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (
      typeof info.menuItemId !== 'string' ||
      !info.menuItemId.startsWith(MENU_PREFIX) ||
      !info.selectionText
    ) {
      return;
    }

    const action = info.menuItemId.slice(MENU_PREFIX.length);
    if (!isSelectionAction(action)) return;

    const pdfSource = extractPdfSource(tab?.url);
    if (!pdfSource && !tab?.url?.startsWith(browser.runtime.getURL('/viewer.html'))) {
      return;
    }

    await saveSelection(action, info.selectionText, tab);

    await openHelperPanelPage();
  });
});
