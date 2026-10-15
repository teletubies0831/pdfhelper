import { browser } from "wxt/browser";
import { aiConnectionCatalog, normalizeAiMaxOutputTokens, type AiConfig, type AiRuntimeResponse } from "../../../modules/ai/public";


import { CONVERSATION_MEMORY_CONFIG_STORAGE_KEY, normalizeConversationMemoryConfig, type ConversationMemoryConfig } from "../../../modules/memory/public";





import { navigateToPdfPageWhenVisible, updateControls } from "../../core/pdf-reader/public";

import { citationReturnButton, citationReturnPosition, deepSeekMaxOutputTokensInput, deepSeekThinkingSelect, testVisionAiButton, viewerContainer, visionSettingsStatus } from "../../app/viewer-elements";
import { getPdfFingerprint } from "../../app/document-identity";
import { getCurrentReadingPosition, scheduleReadingPositionSave } from "../recent-files/public";
import { internalNavigationHistory, isOpeningDocument, isRestoringReadingPosition, isReturningFromInternalNavigation, linkService, pdfDocument, pdfViewer, sourceName, suppressInternalNavigationCapture } from "../../app/viewer-state";
import { aiConfig, aiConfigLoaded, conversationMemoryConfig, setDeepSeekSettingsOpen, visionAiConfig } from "../../app/public";




import { populateConversationMemoryConfigForm, readConversationMemoryConfigFromForm, updateDeepSeekProviderStatus } from './memory-controller';
import { clearSettingsStatus, loadSettingsConnectionCatalog, saveSettingsRoutes, showSettingsStatus, updateSettingsConnectionSummaries } from './settings-navigation';
import { loadConnectionTestPreferences, readConnectionTestPreferences, saveConnectionTestPreferences } from './connection-test-preferences';
import { createVisionTestImage } from './connection-test-controller';
import { syncChatReasoningControl } from '../../app/chat-reasoning-control';






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
  await loadConnectionTestPreferences();
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
  await saveConnectionTestPreferences();
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



export { discoverDeepSeekModels, testDeepSeekConnection, createVisionTestImage } from './connection-test-controller';



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
      testSettings: readConnectionTestPreferences(),
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



/* Reading-mode selection was removed when the knowledge base became a single
 * explicit PDF corpus. This migration reference is not emitted or executed.
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
*/
