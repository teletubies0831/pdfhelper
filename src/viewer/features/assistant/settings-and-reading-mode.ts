import { type PDFDocumentProxy } from "pdfjs-dist";





import { browser } from "wxt/browser";
import { AI_CONFIG_STORAGE_KEY, DEFAULT_AI_CONFIG, DEFAULT_VISION_AI_CONFIG, LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY, VISION_AI_CONFIG_STORAGE_KEY, isVisionAiConfigured, normalizeAiBaseUrl, normalizeAiMaxOutputTokens, type AiConfig, type AiReasoningMode, type AiRuntimeResponse, type VisionAiConfig, type VisionAiMode } from "../../../../shared/ai";
import { READING_MODE_STORAGE_KEY, getReadingModeLabel, isReadingModePreference, type ReadingModePreference, type ReadingModeState } from "../../../../shared/reading-mode";


import { CONVERSATION_MEMORY_CONFIG_STORAGE_KEY, normalizeConversationMemoryConfig, type ConversationMemoryConfig } from "../../../../shared/memory";





import { aiConfig, aiConfigLoaded, conversationMemoryConfig, readingModeDetectionPending, readingModeDocumentKey, readingModeError, readingModePreference, readingModeRationale, resolvedReadingMode, setDeepSeekSettingsOpen, updateControls, visionAiConfig } from "../../core/pdf-reader/public";

import { aiProviderSelect, citationReturnButton, citationReturnPosition, deepSeekApiKeyInput, deepSeekBaseUrlInput, deepSeekMaxOutputTokensInput, deepSeekModelSelect, deepSeekSettingsStatus, deepSeekThinkingSelect, detectReadingModeButton, readingModeSelect, readingModeStatus, testDeepSeekButton, testVisionAiButton, translationModelSelect, viewerContainer, visionAiFields, visionAiModeSelect, visionApiKeyInput, visionBaseUrlInput, visionModelInput, visionSettingsStatus } from "../../app/viewer-elements";
import { getPdfFingerprint } from "../annotations/public";
import { getCurrentReadingPosition, scheduleReadingPositionSave } from "../recent-files/public";
import { internalNavigationHistory, isOpeningDocument, isRestoringReadingPosition, isReturningFromInternalNavigation, linkService, pdfDocument, pdfViewer, sourceName, suppressInternalNavigationCapture } from "../../app/viewer-state";


import { getDisplayFileName } from "../../core/pdf-reader/public";
import { extractPageText } from "../translation/public";

import { populateConversationMemoryConfigForm, readConversationMemoryConfigFromForm, readDeepSeekConfigFromForm, updateDeepSeekProviderStatus } from './memory-controller';
import { updateModeNavigation } from './library-tools';




export function updateVisionAiFieldsVisibility(): void {
  const enabled = visionAiModeSelect.value === "separate";
  visionAiFields.hidden = !enabled;
  testVisionAiButton.disabled = !enabled;
  if (!enabled) {
    visionSettingsStatus.classList.remove("error");
    visionSettingsStatus.textContent = "";
  }
}



export function readVisionAiConfigFromForm(): VisionAiConfig {
  return {
    mode: visionAiModeSelect.value as VisionAiMode,
    providerId: "openai-compatible",
    apiKey: visionApiKeyInput.value.trim(),
    baseUrl: visionBaseUrlInput.value.trim().replace(/\/+$/, ""),
    model: visionModelInput.value.trim(),
  };
}



export function populateVisionAiConfigForm(config: VisionAiConfig): void {
  visionAiModeSelect.value = config.mode;
  visionApiKeyInput.value = config.apiKey;
  visionModelInput.value = config.model;
  visionBaseUrlInput.value = config.baseUrl;
  updateVisionAiFieldsVisibility();
}



export function validateVisionAiConfig(config: VisionAiConfig): boolean {
  if (config.mode === "disabled") return true;
  if (isVisionAiConfigured(config)) return true;
  visionSettingsStatus.classList.add("error");
  visionSettingsStatus.textContent =
    "启用视觉模型后，请填写 API Key、模型和 API 地址。";
  return false;
}



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
    pdfViewer.currentScale = Math.max(0.1, Math.min(10, entry.scale));
  }
  pdfViewer.currentPageNumber = pageNumber;

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
  aiProviderSelect.value = config.providerId;
  deepSeekApiKeyInput.value = config.apiKey;
  deepSeekModelSelect.value = config.model;
  translationModelSelect.value = config.translationModel || config.model;
  deepSeekMaxOutputTokensInput.value = String(config.maxOutputTokens);
  deepSeekThinkingSelect.value = config.reasoning;
  deepSeekBaseUrlInput.value = config.baseUrl;
}



export async function loadDeepSeekConfig(): Promise<void> {
  const stored = await browser.storage.local.get([
    AI_CONFIG_STORAGE_KEY,
    LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY,
    VISION_AI_CONFIG_STORAGE_KEY,
    CONVERSATION_MEMORY_CONFIG_STORAGE_KEY,
  ]);
  const current = stored[AI_CONFIG_STORAGE_KEY] as
    | Partial<AiConfig>
    | undefined;
  const legacy = stored[LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY] as
    | (Partial<AiConfig> & {
        thinking?: AiReasoningMode;
      })
    | undefined;
  const value = current || legacy;
  const providerId = value?.providerId ?? DEFAULT_AI_CONFIG.providerId;
  aiConfig.value = {
    ...DEFAULT_AI_CONFIG,
    ...value,
    providerId,
    apiKey: value?.apiKey?.trim() ?? "",
    baseUrl: normalizeAiBaseUrl(
      value?.baseUrl ?? DEFAULT_AI_CONFIG.baseUrl,
      providerId,
    ),
    reasoning:
      value?.reasoning ?? legacy?.thinking ?? DEFAULT_AI_CONFIG.reasoning,
    translationModel:
      value?.translationModel?.trim()
      || value?.model?.trim()
      || DEFAULT_AI_CONFIG.translationModel,
    maxOutputTokens: normalizeAiMaxOutputTokens(value?.maxOutputTokens),
  };
  if (!current && legacy)
    await browser.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: aiConfig.value });
  const storedVision = stored[VISION_AI_CONFIG_STORAGE_KEY] as
    | Partial<VisionAiConfig>
    | undefined;
  visionAiConfig.value = {
    ...DEFAULT_VISION_AI_CONFIG,
    ...storedVision,
    mode: storedVision?.mode === "separate" ? "separate" : "disabled",
    providerId: "openai-compatible",
    apiKey: storedVision?.apiKey?.trim() ?? "",
    baseUrl: storedVision?.baseUrl?.trim().replace(/\/+$/, "") ?? "",
    model: storedVision?.model?.trim() ?? "",
  };
  conversationMemoryConfig.value = normalizeConversationMemoryConfig(
    stored[CONVERSATION_MEMORY_CONFIG_STORAGE_KEY] as
      | Partial<ConversationMemoryConfig>
      | undefined,
  );
  aiConfigLoaded.value = true;
  populateDeepSeekConfigForm(aiConfig.value);
  populateVisionAiConfigForm(visionAiConfig.value);
  populateConversationMemoryConfigForm(conversationMemoryConfig.value);
  updateDeepSeekProviderStatus();
}



export async function saveDeepSeekConfig(showSuccess = true): Promise<boolean> {
  const nextConfig = readDeepSeekConfigFromForm();
  const nextVisionConfig = readVisionAiConfigFromForm();
  const nextConversationMemoryConfig = readConversationMemoryConfigFromForm();

  if (!nextConfig.apiKey) {
    deepSeekSettingsStatus.textContent = "请输入 DeepSeek API Key。";
    deepSeekSettingsStatus.classList.add("error");
    return false;
  }
  if (!validateVisionAiConfig(nextVisionConfig)) return false;

  aiConfig.value = nextConfig;
  visionAiConfig.value = nextVisionConfig;
  conversationMemoryConfig.value = nextConversationMemoryConfig;
  aiConfigLoaded.value = true;
  await browser.storage.local.set({
    [AI_CONFIG_STORAGE_KEY]: nextConfig,
    [VISION_AI_CONFIG_STORAGE_KEY]: nextVisionConfig,
    [CONVERSATION_MEMORY_CONFIG_STORAGE_KEY]: nextConversationMemoryConfig,
  });
  populateDeepSeekConfigForm(nextConfig);
  populateVisionAiConfigForm(nextVisionConfig);
  populateConversationMemoryConfigForm(nextConversationMemoryConfig);
  updateDeepSeekProviderStatus();
  deepSeekSettingsStatus.classList.remove("error");
  deepSeekSettingsStatus.textContent = showSuccess
    ? "设置已保存到当前浏览器。"
    : "";
  visionSettingsStatus.classList.remove("error");
  if (showSuccess) {
    visionSettingsStatus.textContent =
      nextVisionConfig.mode === "separate"
        ? `视觉模型已保存：${nextVisionConfig.model}`
        : "";
  }
  return true;
}



export async function testDeepSeekConnection(): Promise<void> {
  if (!(await saveDeepSeekConfig(false))) return;

  testDeepSeekButton.disabled = true;
  deepSeekSettingsStatus.classList.remove("error");
  deepSeekSettingsStatus.textContent = "正在连接 DeepSeek…";

  try {
    const response = (await browser.runtime.sendMessage({
      type: "pdf-helper:ai-test",
    })) as AiRuntimeResponse;

    if (!response?.ok) throw new Error(response?.error || "连接测试失败。");
    const modelCount = response.models?.length ?? 0;
    deepSeekSettingsStatus.textContent = modelCount
      ? `连接成功，可用模型 ${modelCount} 个。`
      : "连接成功。";
  } catch (error) {
    deepSeekSettingsStatus.classList.add("error");
    deepSeekSettingsStatus.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    testDeepSeekButton.disabled = false;
  }
}



export function createVisionTestImage(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 32, 32);
  context.fillStyle = "#1f67e8";
  context.fillRect(8, 8, 16, 16);
  return canvas.toDataURL("image/png");
}



export async function testVisionAiConnection(): Promise<void> {
  const nextConfig = readVisionAiConfigFromForm();
  if (!validateVisionAiConfig(nextConfig)) return;
  visionAiConfig.value = nextConfig;
  await browser.storage.local.set({
    [VISION_AI_CONFIG_STORAGE_KEY]: nextConfig,
  });

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
    visionSettingsStatus.textContent = `视觉连接成功：${response.model || nextConfig.model}`;
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
    deepSeekSettingsStatus.classList.add("error");
    deepSeekSettingsStatus.textContent =
      "“AI 自动识别阅读模式”需要 API Key；也可以先手动选择阅读模式。";
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
