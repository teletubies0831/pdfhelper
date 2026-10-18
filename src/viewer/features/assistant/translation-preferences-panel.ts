import {
  memoryTools,
  parseTranslationPreference,
  serializeTranslationPreference,
  translationPreferenceKey,
  isTranslationPreferenceMemory,
  type TranslationPreferenceRule,
} from "../../../modules/memory/public";
import type { LongTermMemory } from "../../../modules/memory/public";
import { parseAiJson, requestAiContent } from "../../shared-ui/markdown/markdown-renderer";
import { extractPageText } from "../translation/public";
import { aiConfig } from "../../app/public";
import {
  pdfDocument,
  pdfViewer,
} from "../../app/viewer-state";
import {
  addTranslationPreferenceButton,
  suggestTranslationPreferencesButton,
  translationPreferenceCount,
  translationPreferenceDialog,
  translationPreferenceTermInput,
  translationPreferenceKindSelect,
  translationPreferenceContextualFields,
  translationPreferenceDefaultInput,
  translationPreferenceContextTermsInput,
  translationPreferenceContextTranslationInput,
  translationPreferenceCancelButton,
  translationPreferenceForm,
  translationPreferenceList,
  translationPreferenceStatus,
  translationPreferenceSuggestionsDialog,
  translationPreferenceSuggestionsList,
  translationPreferenceSuggestionsCancelButton,
  translationPreferenceSuggestionsSaveButton,
} from "../../app/viewer-elements";

let renderedPreferences = new Map<string, LongTermMemory>();

export async function refreshTranslationPreferenceList(): Promise<void> {
  try {
    const memories = await memoryTools.list({ categories: ["preference"], limit: 100 });
    const preferences = memories.filter(isTranslationPreferenceMemory);
    renderedPreferences = new Map(preferences.map((memory) => [memory.id, memory]));
    translationPreferenceCount.textContent = `${preferences.length} 条`;
    translationPreferenceList.replaceChildren();
    if (preferences.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-memory-empty";
      empty.textContent = "暂无翻译偏好；可手动添加术语规则，或让 AI 从当前 PDF 总结建议。";
      translationPreferenceList.append(empty);
      return;
    }
    for (const memory of preferences) {
      const rule = parseTranslationPreference(memory.content);
      if (!rule) continue;

      const item = document.createElement("div");
      item.className = "settings-memory-item translation-preference-item";

      const term = document.createElement("span");
      term.className = "translation-preference-term";
      term.textContent = rule.term;

      const detail = document.createElement("div");
      detail.className = "settings-memory-content";
      if (rule.kind === "keep") {
        detail.textContent = "译文保留英文原文，不翻译";
      } else {
        const contexts = (rule.contexts ?? [])
          .map((context) => `${context.contextTerms.join('/')} → ${context.translation}`)
          .join('；');
        detail.textContent = [
          contexts || null,
          rule.defaultTranslation ? `默认 → ${rule.defaultTranslation}` : null,
        ].filter(Boolean).join('；') || '按场景翻译';
      }

      const actions = document.createElement("div");
      actions.className = "settings-memory-item-actions";
      const remove = document.createElement("button");
      remove.className = "settings-memory-delete";
      remove.type = "button";
      remove.dataset.translationPreferenceId = memory.id;
      remove.setAttribute("aria-label", `删除翻译偏好：${rule.term}`);
      remove.title = "删除";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        void deleteTranslationPreference(memory.id);
      });
      actions.append(remove);
      item.append(term, detail, actions);
      translationPreferenceList.append(item);
    }
  } catch (error) {
    translationPreferenceList.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "settings-memory-empty";
    empty.textContent = `读取翻译偏好失败：${error instanceof Error ? error.message : String(error)}`;
    translationPreferenceList.append(empty);
  }
}

export function openAddTranslationPreferenceDialog(): void {
  translationPreferenceForm.reset();
  translationPreferenceContextualFields.hidden = true;
  translationPreferenceDialog.showModal();
  window.setTimeout(() => translationPreferenceTermInput.focus(), 0);
}

function syncContextualFieldsVisibility(): void {
  translationPreferenceContextualFields.hidden =
    translationPreferenceKindSelect.value !== "contextual";
}

export async function saveTranslationPreferenceFromForm(): Promise<void> {
  const term = translationPreferenceTermInput.value.trim();
  if (!term) {
    showTranslationPreferenceStatus("请输入术语。", true);
    return;
  }
  const kind = translationPreferenceKindSelect.value;
  const rule: TranslationPreferenceRule =
    kind === "keep"
      ? { kind: "keep", term }
      : {
          kind: "contextual",
          term,
          defaultTranslation: translationPreferenceDefaultInput.value.trim() || undefined,
          contexts: [],
        };
  if (kind === "contextual") {
    const contextTerms = translationPreferenceContextTermsInput.value
      .split(/[,，、;；]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const translation = translationPreferenceContextTranslationInput.value.trim();
    if (contextTerms.length > 0 && translation) {
      rule.contexts = [{ contextTerms, translation }];
    }
    if (!rule.defaultTranslation && (rule.contexts?.length ?? 0) === 0) {
      showTranslationPreferenceStatus("场景译法至少需要默认译法或一组场景关键词+译法。", true);
      return;
    }
  }

  await memoryTools.upsert({
    key: translationPreferenceKey(term),
    category: "preference",
    content: serializeTranslationPreference(rule),
    scope: "global",
    sourceType: "explicit",
  });
  translationPreferenceDialog.close();
  showTranslationPreferenceStatus(`已保存术语“${term}”的翻译偏好。`);
  await refreshTranslationPreferenceList();
}

export async function deleteTranslationPreference(memoryId: string): Promise<void> {
  const deleted = await memoryTools.forget(memoryId);
  if (!deleted) {
    showTranslationPreferenceStatus("这条翻译偏好已经不存在。", true);
    return;
  }
  renderedPreferences.delete(memoryId);
  showTranslationPreferenceStatus("已删除翻译偏好。");
  await refreshTranslationPreferenceList();
}

const SUGGESTION_PROMPT = [
  "你是翻译术语专家。请阅读下面这段 PDF 原文，总结值得固化的翻译偏好规则，最多 6 条：",
  "1. keep：学术翻译中通常保留英文原文的专有术语或缩写（如 Transformer、token、BERT、CLIP）。",
  "2. contextual：同一个词在不同学科/场景下译法不同（如 field 在电磁/电路场景译“电路”，其他场景译“领域”；loss 在深度学习场景译“损失”，在通信场景可译“损耗”）。",
  "只输出 JSON 对象，不要 Markdown、代码块或额外说明。",
  'JSON 格式：{"rules":[{"kind":"keep","term":"Transformer"},{"kind":"contextual","term":"field","defaultTranslation":"领域","contexts":[{"contextTerms":["电路","电磁","electric","circuit"],"translation":"电路"}]}]}',
  "没有值得固化的规则时返回空数组。",
  "PDF 原文：",
].join("\n");

let pendingSuggestions: TranslationPreferenceRule[] = [];

export async function suggestTranslationPreferences(): Promise<void> {
  if (!pdfDocument.value) {
    showTranslationPreferenceStatus("请先打开一篇 PDF，再让 AI 总结翻译偏好。", true);
    return;
  }
  const pageNumber = Math.max(1, pdfViewer.currentPageNumber || 1);
  showTranslationPreferenceStatus(`正在总结第 ${pageNumber} 页的术语偏好…`);
  suggestTranslationPreferencesButton.disabled = true;
  try {
    const pageText = await extractPageText(pdfDocument.value, pageNumber);
    if (!pageText.trim()) {
      showTranslationPreferenceStatus("当前页没有可提取的文字。", true);
      return;
    }
    const content = await requestAiContent(
      [
        {
          role: "user",
          content: `${SUGGESTION_PROMPT}\n${pageText.slice(0, 6000)}`,
        },
      ],
      {
        pageNumber,
        task: "翻译偏好：AI 总结术语规则",
      },
      {
        model: aiConfig.value.translationModel || aiConfig.value.model,
        reasoning: "disabled",
        maxOutputTokens: 2048,
      },
    );
    const parsed = parseAiJson(content) as { rules?: unknown } | null;
    const rawRules = Array.isArray(parsed?.rules) ? parsed.rules.slice(0, 8) : [];
    pendingSuggestions = rawRules
      .map((raw) => parseTranslationPreference(JSON.stringify(raw)))
      .filter((rule): rule is TranslationPreferenceRule => rule !== null);
    if (pendingSuggestions.length === 0) {
      showTranslationPreferenceStatus("AI 没有提出值得固化的翻译偏好。");
      return;
    }
    renderTranslationPreferenceSuggestions(pendingSuggestions);
    translationPreferenceSuggestionsDialog.showModal();
  } catch (error) {
    showTranslationPreferenceStatus(
      `总结失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  } finally {
    suggestTranslationPreferencesButton.disabled = false;
  }
}

function renderTranslationPreferenceSuggestions(rules: TranslationPreferenceRule[]): void {
  translationPreferenceSuggestionsList.replaceChildren();
  for (const [index, rule] of rules.entries()) {
    const row = document.createElement("label");
    row.className = "translation-preference-suggestion";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.suggestionIndex = String(index);
    const text = document.createElement("span");
    if (rule.kind === "keep") {
      text.textContent = `“${rule.term}” 保留英文原文`;
    } else {
      const contexts = (rule.contexts ?? [])
        .map((context) => `${context.contextTerms.join('/')} → ${context.translation}`)
        .join('；');
      text.textContent = `“${rule.term}”${contexts ? ` ${contexts}` : ''}${rule.defaultTranslation ? `；默认 ${rule.defaultTranslation}` : ''}`;
    }
    row.append(checkbox, text);
    translationPreferenceSuggestionsList.append(row);
  }
}

export async function saveSelectedTranslationPreferenceSuggestions(): Promise<void> {
  const checkboxes = translationPreferenceSuggestionsList.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  let saved = 0;
  for (const checkbox of checkboxes) {
    if (!checkbox.checked) continue;
    const rule = pendingSuggestions[Number(checkbox.dataset.suggestionIndex)];
    if (!rule) continue;
    await memoryTools.upsert({
      key: translationPreferenceKey(rule.term),
      category: "preference",
      content: serializeTranslationPreference(rule),
      scope: "global",
      sourceType: "explicit",
    });
    saved += 1;
  }
  translationPreferenceSuggestionsDialog.close();
  pendingSuggestions = [];
  showTranslationPreferenceStatus(`已保存 ${saved} 条翻译偏好。`);
  await refreshTranslationPreferenceList();
}

function showTranslationPreferenceStatus(message: string, isError = false): void {
  translationPreferenceStatus.textContent = message;
  translationPreferenceStatus.classList.toggle("error", isError);
}

export function registerTranslationPreferencePanelEvents(): void {
  addTranslationPreferenceButton.addEventListener(
    "click",
    openAddTranslationPreferenceDialog,
  );
  suggestTranslationPreferencesButton.addEventListener(
    "click",
    () => {
      void suggestTranslationPreferences();
    },
  );
  translationPreferenceKindSelect.addEventListener(
    "change",
    syncContextualFieldsVisibility,
  );
  translationPreferenceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveTranslationPreferenceFromForm();
  });
  translationPreferenceCancelButton.addEventListener("click", () => {
    translationPreferenceDialog.close();
  });
  translationPreferenceSuggestionsCancelButton.addEventListener("click", () => {
    translationPreferenceSuggestionsDialog.close();
  });
  translationPreferenceSuggestionsSaveButton.addEventListener("click", () => {
    void saveSelectedTranslationPreferenceSuggestions();
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-close-dialog]",
  )) {
    const dialogId = button.dataset.closeDialog;
    if (!dialogId) continue;
    button.addEventListener("click", () => {
      const dialog = document.getElementById(dialogId);
      if (dialog instanceof HTMLDialogElement) dialog.close();
    });
  }
}
