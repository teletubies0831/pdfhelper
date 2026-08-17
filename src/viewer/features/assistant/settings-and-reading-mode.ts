import { type PDFDocumentProxy } from "pdfjs-dist";





import { browser } from "wxt/browser";
import { AI_PROVIDERS, AI_VISION_TEST_MARKER, aiConnectionCatalog, normalizeAiMaxOutputTokens, normalizeConnectionModels, type AiConfig, type AiConnectionCapability, type AiProviderId, type AiRuntimeResponse } from "../../../modules/ai/public";
import { READING_MODE_STORAGE_KEY, getReadingModeLabel, isReadingModePreference, type ReadingModePreference, type ReadingModeState } from "../../../../shared/reading-mode";


import { CONVERSATION_MEMORY_CONFIG_STORAGE_KEY, normalizeConversationMemoryConfig, type ConversationMemoryConfig } from "../../../../shared/memory";





import { aiConfig, aiConfigLoaded, conversationMemoryConfig, navigateToPdfPageWhenVisible, readingModeDetectionPending, readingModeDocumentKey, readingModeError, readingModePreference, readingModeRationale, resolvedReadingMode, setDeepSeekSettingsOpen, updateControls, visionAiConfig } from "../../core/pdf-reader/public";

import { aiProviderSelect, citationReturnButton, citationReturnPosition, deepSeekApiKeyInput, deepSeekBaseUrlInput, deepSeekMaxOutputTokensInput, deepSeekThinkingSelect, detectReadingModeButton, readingModeMenuButtons, readingModeSelect, readingModeStatus, readingModeTriggerLabel, saveDeepSeekSettingsButton, settingsConnectionModelsInput, testDeepSeekButton, testVisionAiButton, viewerContainer, visionSettingsStatus } from "../../app/viewer-elements";
import { getPdfFingerprint } from "../annotations/public";
import { getCurrentReadingPosition, scheduleReadingPositionSave } from "../recent-files/public";
import { internalNavigationHistory, isOpeningDocument, isRestoringReadingPosition, isReturningFromInternalNavigation, linkService, pdfDocument, pdfViewer, sourceName, suppressInternalNavigationCapture } from "../../app/viewer-state";


import { getDisplayFileName } from "../../core/pdf-reader/public";
import { extractPageText } from "../translation/public";

import { populateConversationMemoryConfigForm, readConversationMemoryConfigFromForm, updateDeepSeekProviderStatus } from './memory-controller';
import { clearSettingsStatus, loadSettingsConnectionCatalog, markSettingsConnectionModelsVerified, saveSettingsRoutes, showSettingsStatus, updateSettingsConnectionSummaries, type SettingsConnectionVerifiedModel } from './settings-navigation';
import { updateModeNavigation } from './library-tools';
import { syncChatReasoningControl } from '../../app/chat-reasoning-control';


const MODEL_VALIDATION_CONCURRENCY = 30;




export function getInternalNavigationDocumentKey(): string {
  const fingerprint = getPdfFingerprint();
  return fingerprint ? `fingerprint:${fingerprint}` : `source:${sourceName.value}`;
}



export function updateCitationReturnButton() {
  const entry = internalNavigationHistory.at(-1);
  const isAvailable = Boolean(
    entry && entry.documentKey === getInternalNavigationDocumentKey(),
  );

  citationReturnButton.classList.toggle("visible", isAvailable);
  citationReturnButton.setAttribute("aria-hidden", String(!isAvailable));
  citationReturnButton.tabIndex = isAvailable ? 0 : -1;
  citationReturnPosition.textContent =
    isAvailable && entry ? `第 ${entry.pageNumber} 页` : "";
}



export function clearInternalNavigationHistory() {
  internalNavigationHistory.length = 0;
  updateCitationReturnButton();
}



export function captureInternalNavigationOrigin() {
  if (
    suppressInternalNavigationCapture.value ||
    isReturningFromInternalNavigation.value ||
    isOpeningDocument.value ||
    !pdfDocument.value
  ) {
    return;
  }

  const position = getCurrentReadingPosition();
  if (!position) return;

  const documentKey = getInternalNavigationDocumentKey();
  const previous = internalNavigationHistory.at(-1);
  if (
    previous?.documentKey === documentKey &&
    previous.pageNumber === position.pageNumber &&
    Math.abs(previous.scrollTop - position.scrollTop) < 4 &&
    Math.abs(previous.scrollLeft - position.scrollLeft) < 4
  ) {
    return;
  }

  internalNavigationHistory.push({ ...position, documentKey });
  if (internalNavigationHistory.length > 20) internalNavigationHistory.shift();
  updateCitationReturnButton();
}



export function navigateToDestinationWithoutReturnHistory(destination: unknown) {
  suppressInternalNavigationCapture.value = true;
  try {
    return linkService.goToDestination(destination as any);
  } finally {
    // The navigation-aware wrapper captures synchronously before PDF.js starts
    // resolving an asynchronous named destination.
    suppressInternalNavigationCapture.value = false;
  }
}



export function returnToPreviousInternalNavigationPosition() {
  if (!pdfDocument.value || isReturningFromInternalNavigation.value) return;

  const documentKey = getInternalNavigationDocumentKey();
  let entry = internalNavigationHistory.pop();
  while (entry && entry.documentKey !== documentKey)
    entry = internalNavigationHistory.pop();
  updateCitationReturnButton();
  if (!entry) return;

  isReturningFromInternalNavigation.value = true;
  isRestoringReadingPosition.value = true;

  const pageNumber = Math.min(
    pdfDocument.value.numPages,
    Math.max(1, Math.round(entry.pageNumber)),
  );
  if (Number.isFinite(entry.scale) && entry.scale > 0) {
    const scale = Math.max(0.1, Math.min(10, entry.scale));
    requestAnimationFrame(() => {
      if (viewerContainer.offsetParent) pdfViewer.currentScale = scale;
    });
  }
  updateSettingsConnectionSummaries();
  navigateToPdfPageWhenVisible(pageNumber);

  const exactTop = Math.max(0, entry.scrollTop);
  const exactLeft = Math.max(0, entry.scrollLeft);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      viewerContainer.scrollTo({
        top: exactTop,
        left: exactLeft,
        behavior: "smooth",
      });
      window.setTimeout(() => {
        viewerContainer.scrollTop = exactTop;
        viewerContainer.scrollLeft = exactLeft;
        isReturningFromInternalNavigation.value = false;
        isRestoringReadingPosition.value = false;
        updateControls();
        scheduleReadingPositionSave();
      }, 450);
    });
  });
}



export const goToPdfDestination = linkService.goToDestination.bind(linkService);



export function populateDeepSeekConfigForm(config: AiConfig): void {
  deepSeekMaxOutputTokensInput.value = String(config.maxOutputTokens);
  deepSeekThinkingSelect.value = config.reasoning;
  syncChatReasoningControl();
  updateSettingsConnectionSummaries();
}



export async function syncAiConfigsFromConnectionCatalog(): Promise<void> {
  aiConfig.value = await aiConnectionCatalog.resolveTextConfig('chat');
  visionAiConfig.value = await aiConnectionCatalog.resolveVisionConfig();
  aiConfigLoaded.value = true;
  populateDeepSeekConfigForm(aiConfig.value);
  updateDeepSeekProviderStatus();
}



export async function loadDeepSeekConfig(): Promise<void> {
  await loadSettingsConnectionCatalog();
  await syncAiConfigsFromConnectionCatalog();
  const stored = await browser.storage.local.get(CONVERSATION_MEMORY_CONFIG_STORAGE_KEY);
  conversationMemoryConfig.value = normalizeConversationMemoryConfig(
    stored[CONVERSATION_MEMORY_CONFIG_STORAGE_KEY] as
      | Partial<ConversationMemoryConfig>
      | undefined,
  );
  populateConversationMemoryConfigForm(conversationMemoryConfig.value);
  updateSettingsConnectionSummaries();
}



export async function saveDeepSeekConfig(showSuccess = true): Promise<boolean> {
  const nextConversationMemoryConfig = readConversationMemoryConfigFromForm();
  await saveSettingsRoutes(
    deepSeekThinkingSelect.value === 'enabled' ? 'enabled' : 'disabled',
    normalizeAiMaxOutputTokens(deepSeekMaxOutputTokensInput.value),
  );
  await syncAiConfigsFromConnectionCatalog();
  conversationMemoryConfig.value = nextConversationMemoryConfig;
  await browser.storage.local.set({
    [CONVERSATION_MEMORY_CONFIG_STORAGE_KEY]: nextConversationMemoryConfig,
  });
  populateConversationMemoryConfigForm(nextConversationMemoryConfig);
  updateSettingsConnectionSummaries();
  if (showSuccess) showSettingsStatus("设置已保存到当前浏览器。", 'success');
  else clearSettingsStatus();
  visionSettingsStatus.classList.remove("error");
  visionSettingsStatus.textContent = "";
  return true;
}



export async function testDeepSeekConnection(): Promise<boolean> {
  const providerId = aiProviderSelect.value as AiProviderId;
  const provider = AI_PROVIDERS.find((item) => item.id === providerId && item.available);
  const apiKey = deepSeekApiKeyInput.value.trim();
  const baseUrl = deepSeekBaseUrlInput.value.trim() || provider?.defaultBaseUrl || '';
  const existingModels = normalizeConnectionModels(
    settingsConnectionModelsInput.value.split(/[\n,，]+/),
  );
  if (!provider) {
    showSettingsStatus('请先选择已支持的接口类型。', 'error');
    return false;
  }
  if (!apiKey || !baseUrl) {
    showSettingsStatus('请先填写 API Key 和 API 地址。', 'error');
    return false;
  }
  const testRunId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const isCurrentTest = (): boolean => testDeepSeekButton.dataset.testRunId === testRunId;
  testDeepSeekButton.dataset.testRunId = testRunId;
  testDeepSeekButton.disabled = true;
  saveDeepSeekSettingsButton.disabled = true;
  showSettingsStatus("正在获取模型列表…", 'progress');

  try {
    console.info('[PDFPal AI 连接测试] 页面发起模型发现', {
      providerId,
      baseUrl,
      hasApiKey: Boolean(apiKey),
    });
    let discoveredModels: string[] = [];
    let discoveryError = '';
    try {
      const discoveryResponse = (await browser.runtime.sendMessage({
        type: 'pdf-helper:ai-test',
        mode: 'discover',
        config: {
          providerId,
          apiKey,
          baseUrl,
          model: existingModels[0] ?? '',
        },
      })) as AiRuntimeResponse;
      console.info('[PDFPal AI 连接测试] 页面收到模型列表', discoveryResponse);
      if (!discoveryResponse?.ok) {
        throw new Error(discoveryResponse?.error || '扩展后台没有返回模型列表。');
      }
      discoveredModels = discoveryResponse.models ?? [];
    } catch (error) {
      discoveryError = error instanceof Error ? error.message : String(error);
      console.warn('[PDFPal AI 连接测试] 模型发现失败，将尝试手动 Model ID', {
        providerId,
        baseUrl,
        error: discoveryError,
      });
    }
    if (!isCurrentTest()) return false;

    const candidates = normalizeConnectionModels([
      ...discoveredModels,
      ...existingModels,
    ]);
    if (candidates.length === 0) {
      throw new Error(
        discoveryError
          ? '接口没有提供标准 /models 列表，请在“接口没有提供模型列表？”中手动加入 Model ID 后再测试。'
          : '接口没有返回可验证的模型。',
      );
    }

    const capabilities: AiConnectionCapability[] = ['text', 'vision'];
    const validationTasks = candidates.flatMap((model) => capabilities.map((capability) => ({
      model,
      capability,
    })));
    showSettingsStatus(`正在并发验证 0/${validationTasks.length} 项能力…`, 'progress');
    const imageDataUrl = createVisionTestImage();
    const results: Array<{
      model: string;
      capability: AiConnectionCapability;
      ok: boolean;
      error?: string;
    } | undefined> = new Array(validationTasks.length);
    let nextTaskIndex = 0;
    let completedCount = 0;

    const validateNextCapability = async (): Promise<void> => {
      while (isCurrentTest() && nextTaskIndex < validationTasks.length) {
        const taskIndex = nextTaskIndex;
        nextTaskIndex += 1;
        const task = validationTasks[taskIndex];
        if (!task) return;
        let response: AiRuntimeResponse;
        try {
          response = (await browser.runtime.sendMessage({
            type: 'pdf-helper:ai-test',
            mode: 'validate',
            config: {
              providerId,
              apiKey,
              baseUrl,
              model: task.model,
              capabilities: [task.capability],
            },
            imageDataUrl: task.capability === 'vision' ? imageDataUrl : undefined,
          })) as AiRuntimeResponse;
        } catch (error) {
          response = {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        results[taskIndex] = response?.ok
          ? { ...task, ok: true }
          : {
              ...task,
              ok: false,
              error: response?.error || '扩展后台没有返回测试结果。',
            };
        completedCount += 1;
        if (isCurrentTest()) {
          showSettingsStatus(
            `正在并发验证 ${completedCount}/${validationTasks.length} 项能力…`,
            'progress',
          );
        }
        console.info('[PDFPal AI 连接测试] 页面收到模型能力验证结果', {
          model: task.model,
          capability: task.capability,
          response,
          progress: `${completedCount}/${validationTasks.length}`,
        });
      }
    };

    const workerCount = Math.min(MODEL_VALIDATION_CONCURRENCY, validationTasks.length);
    await Promise.all(Array.from({ length: workerCount }, () => validateNextCapability()));
    if (!isCurrentTest()) return false;

    const completedResults = results.filter(
      (result): result is NonNullable<typeof result> => Boolean(result),
    );
    const verifiedModels: SettingsConnectionVerifiedModel[] = candidates.flatMap((model) => {
      const verifiedCapabilities = capabilities.filter((capability) => completedResults.some(
        (result) => result.model === model && result.capability === capability && result.ok,
      ));
      return verifiedCapabilities.length > 0
        ? [{ model, capabilities: verifiedCapabilities }]
        : [];
    });
    const failures = completedResults.filter((result) => !result.ok);
    if (verifiedModels.length === 0) {
      console.error('[PDFPal AI 连接测试] 所有模型均验证失败', failures);
      throw new Error(`已实测 ${candidates.length} 个模型，但没有可调用的模型。请在 Console 查看每个模型的返回。`);
    }
    markSettingsConnectionModelsVerified(verifiedModels);
    const textModelCount = verifiedModels.filter((item) => item.capabilities.includes('text')).length;
    const visionModelCount = verifiedModels.filter((item) => item.capabilities.includes('vision')).length;
    const unavailableModelCount = candidates.length - verifiedModels.length;
    console.info('[PDFPal AI 连接测试] 并发验证完成', {
      concurrency: workerCount,
      total: candidates.length,
      verifiedModels,
      failures,
    });
    showSettingsStatus([
      discoveryError ? '接口未提供标准模型列表，已验证手动加入的模型。' : '连接成功。',
      `已验证 ${verifiedModels.length} 个可用模型：${textModelCount} 个支持文本，${visionModelCount} 个支持视觉。`,
      unavailableModelCount > 0 ? `${unavailableModelCount} 个不可用模型已排除。` : '',
    ].filter(Boolean).join(' '), 'success');
    return true;
  } catch (error) {
    console.error('[PDFPal AI 连接测试] 页面测试失败', {
      providerId,
      baseUrl,
      models: existingModels,
      error: error instanceof Error ? error.message : String(error),
    });
    if (isCurrentTest()) {
      showSettingsStatus(error instanceof Error ? error.message : String(error), 'error');
    }
    return false;
  } finally {
    if (isCurrentTest()) {
      delete testDeepSeekButton.dataset.testRunId;
      testDeepSeekButton.disabled = false;
      saveDeepSeekSettingsButton.disabled = false;
    }
  }
}



export function createVisionTestImage(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#cbd5e1";
  context.lineWidth = 4;
  context.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
  context.fillStyle = "#0f172a";
  context.font = "700 64px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(AI_VISION_TEST_MARKER, canvas.width / 2, canvas.height / 2);
  return canvas.toDataURL("image/png");
}



export async function testVisionAiConnection(): Promise<void> {
  if (!(await saveDeepSeekConfig(false))) return;
  if (visionAiConfig.value.mode !== 'separate') {
    visionSettingsStatus.classList.add('error');
    visionSettingsStatus.textContent = '请先为页面识别任务选择视觉模型。';
    return;
  }

  testVisionAiButton.disabled = true;
  visionSettingsStatus.classList.remove("error");
  visionSettingsStatus.textContent = "正在测试视觉模型…";
  try {
    const response = (await browser.runtime.sendMessage({
      type: "pdf-helper:ai-vision-test",
      imageDataUrl: createVisionTestImage(),
    })) as AiRuntimeResponse;
    if (!response?.ok)
      throw new Error(response?.error || "视觉模型连接测试失败。");
    visionSettingsStatus.textContent = `视觉连接成功：${response.model || visionAiConfig.value.model}`;
  } catch (error) {
    visionSettingsStatus.classList.add("error");
    visionSettingsStatus.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    testVisionAiButton.disabled = false;
  }
}



export function getReadingModeDocumentKey(
  documentProxy: PDFDocumentProxy | null = pdfDocument.value,
): string {
  const fingerprint = getPdfFingerprint(documentProxy);
  if (fingerprint) return `fingerprint:${fingerprint}`;
  const fileName = sourceName.value ? getDisplayFileName(sourceName.value) : "";
  return fileName && documentProxy
    ? `file:${fileName}:${documentProxy.numPages}`
    : "";
}



export function updateReadingModeUi(): void {
  const autoOption = readingModeSelect.querySelector<HTMLOptionElement>(
    'option[value="auto"]',
  );
  if (autoOption) {
    autoOption.textContent = readingModeDetectionPending.value
      ? "AI 自动识别（识别中…）"
      : `AI 自动识别（${getReadingModeLabel(resolvedReadingMode.value)}）`;
  }
  readingModeSelect.value = readingModePreference.value;
  readingModeTriggerLabel.textContent = readingModePreference.value === "auto"
    ? getReadingModeLabel(resolvedReadingMode.value)
    : getReadingModeLabel(readingModePreference.value);
  for (const modeButton of readingModeMenuButtons) {
    const isActive = modeButton.dataset.readingModeValue
      === readingModePreference.value;
    modeButton.classList.toggle("active", isActive);
    modeButton.setAttribute("aria-checked", String(isActive));
  }
  detectReadingModeButton.disabled =
    !pdfDocument.value || readingModeDetectionPending.value;
  detectReadingModeButton.textContent = readingModeDetectionPending.value
    ? "…"
    : "↻";
  const prefix = readingModePreference.value === "auto" ? "AI自动" : "手动";
  readingModeStatus.textContent = readingModeDetectionPending.value
    ? "正在识别…"
    : readingModeError.value ||
      `${prefix} · ${getReadingModeLabel(resolvedReadingMode.value)}`;
  readingModeStatus.title =
    readingModeError.value ||
    readingModeRationale.value ||
    (readingModePreference.value === "auto"
      ? "由 AI 根据文件名、目录与正文样本识别，可手动切换"
      : "当前文档使用手动指定的阅读模式");
  readingModeStatus.classList.toggle("error", Boolean(readingModeError.value));
  updateModeNavigation();
}



export async function readReadingModeStore(): Promise<
  Record<string, ReadingModeState>
> {
  const stored = await browser.storage.local.get(READING_MODE_STORAGE_KEY);
  const value = stored[READING_MODE_STORAGE_KEY];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, ReadingModeState>)
    : {};
}



export async function persistReadingMode(state: ReadingModeState): Promise<void> {
  if (!readingModeDocumentKey.value) return;
  const modes = await readReadingModeStore();
  modes[readingModeDocumentKey.value] = state;
  await browser.storage.local.set({ [READING_MODE_STORAGE_KEY]: modes });
}



export function collectOutlineTitles(
  items: Array<{ title?: string; items?: unknown[] }> | null,
  target: string[] = [],
): string[] {
  for (const item of items ?? []) {
    const title = item.title?.trim();
    if (title) target.push(title);
    if (Array.isArray(item.items)) {
      collectOutlineTitles(
        item.items as Array<{ title?: string; items?: unknown[] }>,
        target,
      );
    }
  }
  return target;
}



export async function buildReadingModeSample(
  documentProxy: PDFDocumentProxy,
): Promise<{
  sampleText: string;
  outlineTitles: string[];
}> {
  const pages: string[] = [];
  const pageNumbers = Array.from(
    new Set(
      [1, 2, 3, Math.ceil(documentProxy.numPages / 2)].filter(
        (pageNumber) => pageNumber >= 1 && pageNumber <= documentProxy.numPages,
      ),
    ),
  );
  for (const pageNumber of pageNumbers) {
    if (pdfDocument.value !== documentProxy)
      throw new Error("PDF 已切换，请重新识别。");
    const text = await extractPageText(documentProxy, pageNumber).catch(
      () => "",
    );
    if (text) pages.push(`[第 ${pageNumber} 页]\n${text.slice(0, 7000)}`);
  }
  const outline = (await documentProxy
    .getOutline()
    .catch(() => null)) as Array<{ title?: string; items?: unknown[] }> | null;
  return {
    sampleText: pages.join("\n\n").slice(0, 24000),
    outlineTitles: collectOutlineTitles(outline).slice(0, 80),
  };
}



export async function detectReadingMode(force = false): Promise<void> {
  const documentAtStart = pdfDocument.value;
  if (!documentAtStart || readingModeDetectionPending.value) return;
  if (!aiConfigLoaded.value) await loadDeepSeekConfig();
  if (!aiConfig.value.apiKey) {
    setDeepSeekSettingsOpen(true);
    showSettingsStatus(
      "“AI 自动识别阅读模式”需要 API Key；也可以先手动选择阅读模式。",
      'error',
    );
    readingModeError.value = "自动识别需配置 API Key";
    updateReadingModeUi();
    return;
  }
  if (!force && readingModePreference.value !== "auto") return;

  readingModeDetectionPending.value = true;
  readingModeError.value = "";
  updateReadingModeUi();
  try {
    const { sampleText, outlineTitles } =
      await buildReadingModeSample(documentAtStart);
    const response = (await browser.runtime.sendMessage({
      type: "pdf-helper:ai-detect-reading-mode",
      documentName: getDisplayFileName(sourceName.value),
      sampleText,
      outlineTitles,
    })) as AiRuntimeResponse;
    if (pdfDocument.value !== documentAtStart) return;
    if (!response?.ok || !response.readingMode) {
      throw new Error(response?.error || "没有收到有效的阅读模式识别结果。");
    }
    readingModePreference.value = "auto";
    resolvedReadingMode.value = response.readingMode;
    readingModeRationale.value = response.rationale || "";
    await persistReadingMode({
      preference: "auto",
      resolved: response.readingMode,
      source: "ai",
      rationale: response.rationale,
      updatedAt: Date.now(),
    });
  } catch (error) {
    readingModeError.value = `识别失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    readingModeDetectionPending.value = false;
    updateReadingModeUi();
  }
}



export async function loadReadingModeForDocument(
  documentProxy: PDFDocumentProxy,
): Promise<void> {
  readingModeDocumentKey.value = getReadingModeDocumentKey(documentProxy);
  readingModePreference.value = "auto";
  resolvedReadingMode.value = "general";
  readingModeRationale.value = "";
  readingModeError.value = "";
  const modes = await readReadingModeStore();
  if (pdfDocument.value !== documentProxy) return;
  const saved = modes[readingModeDocumentKey.value];
  if (saved && isReadingModePreference(saved.preference)) {
    readingModePreference.value = saved.preference;
    resolvedReadingMode.value = saved.resolved || "general";
    readingModeRationale.value = saved.rationale || "";
    updateReadingModeUi();
    if (saved.preference !== "auto" || saved.source === "ai") return;
  }
  updateReadingModeUi();
  await detectReadingMode(false);
}



export async function setReadingModePreference(
  preference: ReadingModePreference,
): Promise<void> {
  readingModePreference.value = preference;
  readingModeError.value = "";
  readingModeRationale.value = "";
  if (preference === "auto") {
    updateReadingModeUi();
    await detectReadingMode(true);
    return;
  }
  resolvedReadingMode.value = preference;
  await persistReadingMode({
    preference,
    resolved: preference,
    source: "manual",
    updatedAt: Date.now(),
  });
  updateReadingModeUi();
}
