import { eventBus, pdfDocument } from "../../app/viewer-state";
import {
  hasSeenOnboarding,
  markOnboardingSeen,
} from "./onboarding-preference-repository";

const TARGET_GAP = 7;
const CARD_GAP = 16;
const VIEWPORT_MARGIN = 14;

type TourPlacement = "top" | "right" | "bottom" | "left";
type TourAdvance = "click" | "next" | "pdf-ready" | "knowledge-overview";

interface TourStep {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  note?: string;
  target: string | (() => HTMLElement | null);
  fallbackTarget?: string;
  placement?: TourPlacement;
  advance: TourAdvance;
  nextLabel?: string;
  padding?: number;
  prepare?: () => void;
  canUseNext?: (target: HTMLElement) => boolean;
  allowTargetInteraction?: boolean;
}

const steps: TourStep[] = [
  {
    id: "settings",
    eyebrow: "先完成基础配置",
    title: "打开设置",
    description: "点击右上角的设置按钮。引导期间，只有高亮区域和引导卡片可以操作。",
    target: "#ai-settings-button",
    placement: "left",
    advance: "click",
  },
  {
    id: "models",
    eyebrow: "连接你的 AI 服务",
    title: "进入“模型与任务”",
    description: "供应商、API Key、API 地址和不同任务使用的模型都在这里配置。",
    target: '[data-settings-tab="models"]',
    placement: "bottom",
    advance: "click",
  },
  {
    id: "provider-tutorial",
    eyebrow: "不会填写也没关系",
    title: "查看供应商配置教程",
    description: "这里会打开单独的供应商教程窗口，之后可以放国内供应商的申请入口、API Key 获取方法和 API 地址。",
    note: "是否现在添加供应商不会影响后续引导；查看后回到 PDFPal 即可继续。",
    target: "#settings-tutorial-button",
    placement: "left",
    advance: "click",
  },
  {
    id: "agent-tools",
    eyebrow: "了解 AI 可以做什么",
    title: "打开 Agent 工具",
    description: "点击这里查看模型在回答问题时能够按需调用的真实工具。",
    target: '[data-settings-tab="tools"]',
    placement: "bottom",
    advance: "click",
  },
  {
    id: "agent-tools-info",
    eyebrow: "Agent 工具",
    title: "工具能力一目了然",
    description: "这里列出 PDFPal 可以替模型执行的工具，以及保存、读取和删除内容时遵循的规则。",
    target: "#settings-agent-tool-catalog",
    placement: "left",
    advance: "next",
  },
  {
    id: "memory",
    eyebrow: "让回答更贴合你",
    title: "打开记忆",
    description: "点击“记忆”，查看 PDFPal 为你保存的长期偏好、目标和背景信息。",
    target: '[data-settings-tab="memory"]',
    placement: "bottom",
    advance: "click",
  },
  {
    id: "memory-info",
    eyebrow: "长期记忆",
    title: "聊天偏好会集中在这里",
    description: "你可以搜索、编辑或删除记忆。AI 建议新增记忆时会先征求你的确认。",
    target: '[data-settings-panel="memory"]',
    placement: "left",
    advance: "next",
    padding: 4,
  },
  {
    id: "close-settings",
    eyebrow: "开始阅读",
    title: "返回 PDF 阅读页",
    description: "接下来打开一份 PDF，体验阅读、翻译和知识库流程。",
    target: "#close-deepseek-settings",
    placement: "left",
    advance: "click",
  },
  {
    id: "file-menu",
    eyebrow: "导入阅读材料",
    title: "打开“文件”菜单",
    description: "PDFPal 支持打开本地 PDF，也会在这里保留最近打开记录。",
    target: ".toolbar-file-button",
    placement: "bottom",
    advance: "click",
  },
  {
    id: "open-pdf",
    eyebrow: "导入阅读材料",
    title: "选择一份 PDF",
    description: "点击“打开 PDF”并选择文件。文件加载完成后，引导会自动继续。",
    note: "文件选择窗口出现时可以正常操作；如果已经打开 PDF，也可以直接继续。",
    target: "#open-file",
    placement: "right",
    advance: "pdf-ready",
    nextLabel: "使用当前 PDF 继续",
    canUseNext: () => Boolean(pdfDocument.value),
  },
  {
    id: "chat",
    eyebrow: "阅读时随时提问",
    title: "在右侧与当前 PDF 聊天",
    description: "在这里询问内容、总结章节或分析论文。左下角的图片按钮支持上传截图，也可以直接粘贴图片。",
    target: "#chat-form",
    placement: "left",
    advance: "next",
    prepare: prepareChatView,
  },
  {
    id: "translate-tab",
    eyebrow: "翻译与英语学习",
    title: "切换到“翻译/解释”",
    description: "点击这个栏目，选中的英文会在右侧生成翻译和学习卡片。",
    target: '[data-assistant-view="translate"]',
    placement: "left",
    advance: "click",
  },
  {
    id: "select-text",
    eyebrow: "翻译与英语学习",
    title: "在 PDF 中拖选文字",
    description: "可以选择一个单词、一句话或短段。选择完成后，右侧会自动识别并生成对应结果。",
    note: "没有配置供应商时可以先了解位置，配置 API Key 后再实际生成翻译。",
    target: "#viewer-container",
    placement: "right",
    advance: "next",
    allowTargetInteraction: true,
    padding: 2,
    nextLabel: "了解了，继续",
  },
  {
    id: "translation-result",
    eyebrow: "翻译与英语学习",
    title: "学习结果显示在这里",
    description: "右侧会展示语境释义、重点词和例句。生成后还可以把结果保存到单词库。",
    target: "#assistant-tools-runtime",
    placement: "left",
    advance: "next",
    padding: 3,
  },
  {
    id: "toolbar",
    eyebrow: "阅读与批注",
    title: "这是 PDF 工具栏",
    description: "这里可以选择文字、高亮、画笔、批注、擦除、撤销，以及整理复制选中的内容。",
    target: ".annotation-tools",
    placement: "bottom",
    advance: "next",
    padding: 4,
  },
  {
    id: "add-knowledge",
    eyebrow: "建立可检索的资料库",
    title: "把当前 PDF 添加到知识库",
    description: "添加后，模型可以检索这份 PDF 的全文，并在当前及其他聊天中引用相关内容。",
    note: "索引会在后台进行，不会阻塞你继续阅读。",
    target: "#add-current-pdf-to-library",
    placement: "bottom",
    advance: "click",
    nextLabel: "已经添加，继续",
    canUseNext: (target) => (target as HTMLButtonElement).disabled,
  },
  {
    id: "knowledge-entry",
    eyebrow: "管理已添加的 PDF",
    title: "打开知识库",
    description: "点击这里查看所有已加入知识库的 PDF。",
    target: "#knowledge-base-entry",
    placement: "bottom",
    advance: "click",
  },
  {
    id: "knowledge-document",
    eyebrow: "PDF 知识库",
    title: "查看 PDF 概览和原文",
    description: "点击高亮的 PDF 标题可以查看内容概览；概览窗口右上角还可以重新打开原文。关闭概览后，引导会继续。",
    target: () => document.querySelector<HTMLElement>(".knowledge-pdf-title-button[data-introduce-document]"),
    fallbackTarget: "#knowledge-list",
    placement: "right",
    advance: "knowledge-overview",
    nextLabel: "暂不查看，继续",
    canUseNext: () => true,
  },
  {
    id: "vocabulary-entry",
    eyebrow: "积累英语词汇",
    title: "打开单词库",
    description: "翻译结果中点击“保存到单词库”的单词和句子，都会集中保存在这里。",
    target: "#vocabulary-library-entry",
    placement: "bottom",
    advance: "click",
  },
  {
    id: "vocabulary-info",
    eyebrow: "引导完成",
    title: "这里是你的单词库",
    description: "可以搜索、筛选和打开单词卡片，复习释义、原句及学习笔记。之后可在“设置 → 常规 → 使用教程”重新播放本引导。",
    target: ".vocabulary-library-shell",
    placement: "top",
    advance: "next",
    nextLabel: "完成引导",
    padding: 3,
  },
];

let active = false;
let currentStepIndex = 0;
let currentTarget: HTMLElement | null = null;
let layoutFrame: number | null = null;
let targetRetryTimer: number | null = null;
let targetRetryCount = 0;
let targetResizeObserver: ResizeObserver | null = null;
let preparing = false;
let interactionSuspended = false;
let initialized = false;

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id) as T | null;
  if (!value) throw new Error(`Missing onboarding element: ${id}`);
  return value;
}

const root = () => element<HTMLElement>("onboarding-tour");
const highlight = () => element<HTMLElement>("onboarding-tour-highlight");
const targetShield = () => element<HTMLElement>("onboarding-tour-target-shield");
const card = () => element<HTMLElement>("onboarding-tour-card");
const title = () => element<HTMLElement>("onboarding-tour-title");
const description = () => element<HTMLElement>("onboarding-tour-description");
const eyebrow = () => element<HTMLElement>("onboarding-tour-eyebrow");
const note = () => element<HTMLElement>("onboarding-tour-note");
const counter = () => element<HTMLElement>("onboarding-tour-counter");
const progress = () => element<HTMLElement>("onboarding-tour-progress-bar");
const nextButton = () => element<HTMLButtonElement>("onboarding-tour-next");
const skipButton = () => element<HTMLButtonElement>("onboarding-tour-skip");
const announcer = () => element<HTMLElement>("onboarding-tour-announcer");

function getBlocker(name: "top" | "left" | "right" | "bottom"): HTMLElement {
  const blocker = root().querySelector<HTMLElement>(`[data-tour-blocker="${name}"]`);
  if (!blocker) throw new Error(`Missing onboarding blocker: ${name}`);
  return blocker;
}

function prepareChatView(): void {
  const appFrame = document.querySelector<HTMLElement>(".app-frame");
  const assistantToggle = document.getElementById("assistant-panel-toggle") as HTMLButtonElement | null;
  const chatTab = document.getElementById("assistant-chat-tab") as HTMLButtonElement | null;
  if (appFrame?.classList.contains("right-panel-collapsed")) assistantToggle?.click();
  chatTab?.click();
}

function resolveTarget(step: TourStep): HTMLElement | null {
  if (typeof step.target === "function") return step.target();
  return document.querySelector<HTMLElement>(step.target);
}

function isVisible(target: HTMLElement): boolean {
  const rect = target.getBoundingClientRect();
  const style = window.getComputedStyle(target);
  return !target.hidden && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

function clearTargetRetry(): void {
  if (targetRetryTimer !== null) window.clearTimeout(targetRetryTimer);
  targetRetryTimer = null;
  targetRetryCount = 0;
}

function stopObservingTarget(): void {
  targetResizeObserver?.disconnect();
  targetResizeObserver = null;
}

function observeTarget(target: HTMLElement): void {
  stopObservingTarget();
  targetResizeObserver = new ResizeObserver(requestTourLayout);
  targetResizeObserver.observe(target);
}

function rebindCurrentTarget(): void {
  if (!active || interactionSuspended) return;
  const step = steps[currentStepIndex];
  if (!step) return;
  const target = resolveTarget(step);
  if (!target || !isVisible(target)) return;
  if (target === currentTarget && currentTarget.isConnected) return;
  currentTarget = target;
  observeTarget(target);
  requestTourLayout();
}

function setRect(element: HTMLElement, left: number, top: number, width: number, height: number): void {
  element.style.left = `${Math.max(0, left)}px`;
  element.style.top = `${Math.max(0, top)}px`;
  element.style.width = `${Math.max(0, width)}px`;
  element.style.height = `${Math.max(0, height)}px`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function positionCard(targetRect: DOMRect, preferred: TourPlacement): void {
  const tourCard = card();
  const cardRect = tourCard.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const placements: TourPlacement[] = [preferred, "bottom", "left", "right", "top"];
  const uniquePlacements = [...new Set(placements)];

  const candidateFor = (placement: TourPlacement): { left: number; top: number; fits: boolean } => {
    let left = targetRect.left + (targetRect.width - cardRect.width) / 2;
    let top = targetRect.bottom + CARD_GAP;
    if (placement === "top") top = targetRect.top - cardRect.height - CARD_GAP;
    if (placement === "left") {
      left = targetRect.left - cardRect.width - CARD_GAP;
      top = targetRect.top + (targetRect.height - cardRect.height) / 2;
    }
    if (placement === "right") {
      left = targetRect.right + CARD_GAP;
      top = targetRect.top + (targetRect.height - cardRect.height) / 2;
    }
    const fits = left >= VIEWPORT_MARGIN && top >= VIEWPORT_MARGIN &&
      left + cardRect.width <= viewportWidth - VIEWPORT_MARGIN &&
      top + cardRect.height <= viewportHeight - VIEWPORT_MARGIN;
    return { left, top, fits };
  };

  const selected = uniquePlacements.map(candidateFor).find((candidate) => candidate.fits)
    ?? candidateFor(preferred);
  tourCard.style.left = `${clamp(selected.left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportWidth - cardRect.width - VIEWPORT_MARGIN))}px`;
  tourCard.style.top = `${clamp(selected.top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportHeight - cardRect.height - VIEWPORT_MARGIN))}px`;
}

function layoutTour(): void {
  layoutFrame = null;
  if (!active || !currentTarget || !isVisible(currentTarget)) return;

  const step = steps[currentStepIndex];
  if (!step) return;
  const padding = step.padding ?? TARGET_GAP;
  const rawRect = currentTarget.getBoundingClientRect();
  const left = clamp(rawRect.left - padding, 0, window.innerWidth);
  const top = clamp(rawRect.top - padding, 0, window.innerHeight);
  const right = clamp(rawRect.right + padding, 0, window.innerWidth);
  const bottom = clamp(rawRect.bottom + padding, 0, window.innerHeight);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);

  setRect(highlight(), left, top, width, height);
  const shield = targetShield();
  const allowTargetInteraction = step.allowTargetInteraction ?? step.advance !== "next";
  shield.hidden = allowTargetInteraction;
  if (!allowTargetInteraction) setRect(shield, left, top, width, height);
  setRect(getBlocker("top"), 0, 0, window.innerWidth, top);
  setRect(getBlocker("left"), 0, top, left, height);
  setRect(getBlocker("right"), right, top, window.innerWidth - right, height);
  setRect(getBlocker("bottom"), 0, bottom, window.innerWidth, window.innerHeight - bottom);
  positionCard(new DOMRect(left, top, width, height), step.placement ?? "bottom");
}

function requestTourLayout(): void {
  if (layoutFrame !== null) return;
  layoutFrame = window.requestAnimationFrame(layoutTour);
}

function shouldShowNext(step: TourStep, target: HTMLElement): boolean {
  return step.advance === "next" || Boolean(step.canUseNext?.(target));
}

function renderStepTarget(): void {
  if (!active) return;
  const step = steps[currentStepIndex];
  if (!step) {
    finishTour();
    return;
  }
  let target = resolveTarget(step);
  if ((!target || !isVisible(target)) && targetRetryCount < 8) {
    targetRetryCount += 1;
    targetRetryTimer = window.setTimeout(renderStepTarget, 80);
    return;
  }
  if ((!target || !isVisible(target)) && step.fallbackTarget) {
    target = document.querySelector<HTMLElement>(step.fallbackTarget);
  }
  if (!target || !isVisible(target)) {
    target = document.querySelector<HTMLElement>(".app-frame");
  }
  if (!target) {
    skipOnboardingTour();
    return;
  }

  clearTargetRetry();
  currentTarget = target;
  currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
  observeTarget(currentTarget);

  eyebrow().textContent = step.eyebrow;
  title().textContent = step.title;
  description().textContent = step.description;
  note().textContent = step.note ?? "";
  note().hidden = !step.note;
  counter().textContent = `${currentStepIndex + 1} / ${steps.length}`;
  progress().style.width = `${((currentStepIndex + 1) / steps.length) * 100}%`;
  nextButton().textContent = step.nextLabel ?? (currentStepIndex === steps.length - 1 ? "完成引导" : "下一步");
  nextButton().hidden = !shouldShowNext(step, currentTarget);
  announcer().textContent = `${step.title}。${step.description}`;

  root().hidden = false;
  root().setAttribute("aria-hidden", "false");
  requestTourLayout();
  window.setTimeout(requestTourLayout, 180);
}

function renderCurrentStep(): void {
  if (!active) return;
  clearTargetRetry();
  stopObservingTarget();
  currentTarget = null;
  const step = steps[currentStepIndex];
  if (!step) {
    finishTour();
    return;
  }
  if (step.prepare) {
    preparing = true;
    try {
      step.prepare();
    } finally {
      preparing = false;
    }
  }
  renderStepTarget();
}

function finishTour(): void {
  active = false;
  interactionSuspended = false;
  currentTarget = null;
  clearTargetRetry();
  stopObservingTarget();
  if (layoutFrame !== null) window.cancelAnimationFrame(layoutFrame);
  layoutFrame = null;
  root().hidden = true;
  root().setAttribute("aria-hidden", "true");
  document.body.classList.remove("onboarding-tour-open");
}

function advanceTour(): void {
  if (!active) return;
  if (currentStepIndex >= steps.length - 1) {
    finishTour();
    return;
  }
  currentStepIndex += 1;
  renderCurrentStep();
}

function pauseForKnowledgeOverview(): void {
  window.setTimeout(() => {
    const dialog = document.getElementById("knowledge-overview-dialog") as HTMLDialogElement | null;
    if (!dialog?.open) {
      advanceTour();
      return;
    }
    interactionSuspended = true;
    root().hidden = true;
    root().setAttribute("aria-hidden", "true");
    dialog.addEventListener("close", () => {
      if (!active) return;
      interactionSuspended = false;
      advanceTour();
    }, { once: true });
  }, 0);
}

function handleTargetActivation(): void {
  const step = steps[currentStepIndex];
  if (!step) return;
  if (step.advance === "click") {
    window.setTimeout(advanceTour, 0);
    return;
  }
  if (step.advance === "knowledge-overview") pauseForKnowledgeOverview();
}

function isAllowedEventTarget(eventTarget: EventTarget | null): boolean {
  if (!(eventTarget instanceof Node)) return false;
  if (!currentTarget?.isConnected) rebindCurrentTarget();
  return card().contains(eventTarget) || Boolean(currentTarget?.contains(eventTarget));
}

function blockOutsidePointer(event: Event): void {
  if (!active || preparing || interactionSuspended || isAllowedEventTarget(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleTourClick(event: MouseEvent): void {
  if (!active || preparing || interactionSuspended) return;
  if (!isAllowedEventTarget(event.target)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (root().contains(event.target as Node)) return;
  if (currentTarget?.contains(event.target as Node)) handleTargetActivation();
}

function getFocusableElements(): HTMLElement[] {
  const values = [
    currentTarget,
    ...Array.from(currentTarget?.querySelectorAll<HTMLElement>("button, a[href], input, textarea, select, [tabindex]:not([tabindex='-1'])") ?? []),
    skipButton(),
    ...(nextButton().hidden ? [] : [nextButton()]),
  ];
  return values.filter((value): value is HTMLElement => Boolean(value && isVisible(value)));
}

function handleTourKeydown(event: KeyboardEvent): void {
  if (!active || preparing || interactionSuspended) return;
  const allowed = isAllowedEventTarget(event.target);
  if (event.key === "Tab") {
    const focusable = getFocusableElements();
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? (index <= 0 ? focusable.length - 1 : index - 1)
      : (index + 1) % focusable.length;
    event.preventDefault();
    focusable[nextIndex]?.focus({ preventScroll: true });
    return;
  }
  if (!allowed) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

export function skipOnboardingTour(): void {
  finishTour();
}

export function startOnboardingTour(): void {
  if (active) finishTour();
  const settingsPanel = document.getElementById("assistant-settings-panel");
  if (settingsPanel && !settingsPanel.hidden) {
    (document.getElementById("close-deepseek-settings") as HTMLButtonElement | null)?.click();
    window.setTimeout(startOnboardingTour, 380);
    return;
  }
  const knowledgeBack = document.getElementById("knowledge-base-back") as HTMLButtonElement | null;
  const vocabularyBack = document.getElementById("vocabulary-library-back") as HTMLButtonElement | null;
  if (knowledgeBack && !document.getElementById("knowledge-base-page")?.hidden) knowledgeBack.click();
  if (vocabularyBack && !document.getElementById("vocabulary-library-page")?.hidden) vocabularyBack.click();
  active = true;
  currentStepIndex = 0;
  document.body.classList.add("onboarding-tour-open");
  void markOnboardingSeen();
  renderCurrentStep();
}

export function initializeOnboardingTour(): void {
  if (initialized) return;
  initialized = true;

  skipButton().addEventListener("click", skipOnboardingTour);
  nextButton().addEventListener("click", advanceTour);
  document.addEventListener("pointerdown", blockOutsidePointer, true);
  document.addEventListener("click", handleTourClick, true);
  document.addEventListener("keydown", handleTourKeydown, true);
  window.addEventListener("resize", requestTourLayout, { passive: true });
  document.addEventListener("scroll", requestTourLayout, { capture: true, passive: true });
  window.addEventListener("pdf-helper:knowledge-corpus-change", () => {
    if (active && steps[currentStepIndex]?.id === "knowledge-document") {
      window.requestAnimationFrame(rebindCurrentTarget);
    }
  });
  eventBus.on("pagesinit", () => {
    if (active && steps[currentStepIndex]?.advance === "pdf-ready") advanceTour();
  });

  window.setTimeout(() => {
    void hasSeenOnboarding().then((seen) => {
      if (!seen) startOnboardingTour();
    });
  }, 500);
}
