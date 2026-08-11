

















import { generateMoreExamplesButton, selectedSnippetElement, translationLearningTitleElement, translationResultElement } from "../../app/viewer-elements";
import { normalizeCopiedText } from "../../core/pdf-reader/public";














export function setTranslationState(message: string, isError = false): void {
  translationResultElement.textContent = message;
  translationResultElement.classList.toggle("error", isError);
}



export function setTranslationLearningTitle(title: string): void {
  translationLearningTitleElement.textContent = "2. " + title;
}



export function setMoreExamplesButtonVisible(visible: boolean): void {
  generateMoreExamplesButton.hidden = !visible;
  generateMoreExamplesButton.disabled = false;
  generateMoreExamplesButton.textContent = "生成更多例句";
}



export function createLearningElement<T extends keyof HTMLElementTagNameMap>(
  tagName: T,
  className: string,
  text = "",
): HTMLElementTagNameMap[T] {
  const element = document.createElement(tagName);
  element.className = className;
  if (text) element.textContent = text;
  return element;
}



export function readLearningString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}



export function readLearningArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}



export function normalizeLearningInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}



export const ENGLISH_WORD_SELECTION_PATTERN =
  /^[\p{L}]+(?:[’'-][\p{L}]+)*$/u;



export function getSelectedEnglishWord(text: string): string {
  const candidate = text
    .trim()
    .replace(/^[“”"'([{<\s]+|[”"'!?,.;:)\]}>，。！？；：\s]+$/g, "");
  return ENGLISH_WORD_SELECTION_PATTERN.test(candidate) ? candidate : "";
}



export interface EnglishWordSelection {
  word: string;
  wasExpanded: boolean;
}

export interface SelectionSurroundingText {
  before: string;
  selected: string;
  after: string;
}

interface TextLayerTextSnapshot {
  childElementCount: number;
  starts: Map<Text, number>;
  combined: string;
}

const textLayerTextSnapshots = new WeakMap<HTMLElement, TextLayerTextSnapshot>();



export function getRangeBoundaryTextNode(
  container: Node,
  offset: number,
  preferStart: boolean,
): { node: Text; offset: number } | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const node = container as Text;
    return { node, offset: Math.max(0, Math.min(offset, node.data.length)) };
  }

  const children = Array.from(container.childNodes);
  const child = preferStart
    ? children[Math.min(offset, Math.max(0, children.length - 1))]
    : children[Math.max(0, Math.min(offset - 1, children.length - 1))];
  if (!child) return null;

  let current: Node = child;
  while (current.childNodes.length) {
    current = preferStart
      ? current.childNodes[0]!
      : current.childNodes[current.childNodes.length - 1]!;
  }
  if (current.nodeType !== Node.TEXT_NODE) return null;

  const node = current as Text;
  return { node, offset: preferStart ? 0 : node.data.length };
}



export function getEnglishWordSelection(
  text: string,
  surroundingText?: SelectionSurroundingText,
): EnglishWordSelection | null {
  const selectedWord = getSelectedEnglishWord(text);
  if (!selectedWord) return null;

  let word = selectedWord;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const rawSelectedText =
      (surroundingText ?? getSelectionSurroundingText()).selected
      || selection.toString();
    const selectionStartsInsideWord = /^[\p{L}\p{M}’'-]/u.test(
      rawSelectedText,
    );
    const selectionEndsInsideWord = /[\p{L}\p{M}’'-]$/u.test(
      rawSelectedText,
    );

    // Complete a fragment only inside the exact text nodes where the drag
    // started and ended. Never cross into a neighbouring PDF.js span: those
    // spans may be visually separated words even when Range#toString omits the
    // space (the previous `data` -> `dataand` bug). A selected boundary space
    // is also authoritative: if the user included it, the word ended there.
    const startNode = range.startContainer instanceof Text
      ? range.startContainer
      : null;
    const endNode = range.endContainer instanceof Text
      ? range.endContainer
      : null;
    const prefix = startNode && selectionStartsInsideWord
      ? startNode.data
          .slice(0, range.startOffset)
          .match(/[\p{L}\p{M}’'-]+$/u)?.[0] ?? ""
      : "";
    const suffix = endNode && selectionEndsInsideWord
      ? endNode.data
          .slice(range.endOffset)
          .match(/^[\p{L}\p{M}’'-]+/u)?.[0] ?? ""
      : "";
    const completedWord = `${prefix}${selectedWord}${suffix}`;
    if (ENGLISH_WORD_SELECTION_PATTERN.test(completedWord)) {
      word = completedWord;
    }
  }

  return {
    word,
    wasExpanded: normalizeLearningInlineText(text) !== word,
  };
}



export function getSelectionSurroundingText(): SelectionSurroundingText {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return { before: "", selected: "", after: "" };

  const range = selection.getRangeAt(0);
  const anchorElement =
    selection.anchorNode?.nodeType === Node.TEXT_NODE
      ? selection.anchorNode.parentElement
      : (selection.anchorNode as Element | null);
  const textLayer = anchorElement?.closest<HTMLElement>(".textLayer");
  if (!textLayer || !textLayer.contains(range.startContainer)) {
    return { before: "", selected: selection.toString(), after: "" };
  }

  const start = getRangeBoundaryTextNode(range.startContainer, range.startOffset, true);
  const end = getRangeBoundaryTextNode(range.endContainer, range.endOffset, false);
  if (!start || !end) {
    return { before: "", selected: selection.toString(), after: "" };
  }

  // Range#toString concatenates adjacent PDF.js spans without their visual
  // spacing. Rebuild that page text once and reuse it while the user adjusts
  // the selection. Reading every span's rectangle on every selectionchange
  // forces a full synchronous layout and makes mouse selection noticeably lag.
  let snapshot = textLayerTextSnapshots.get(textLayer);
  if (
    !snapshot
    || snapshot.childElementCount !== textLayer.childElementCount
    || !snapshot.starts.has(start.node)
    || !snapshot.starts.has(end.node)
  ) {
    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push(node as Text);
    }

    const starts = new Map<Text, number>();
    let combined = "";
    nodes.forEach((node, index) => {
      if (index > 0) {
        const previousElement = nodes[index - 1]?.parentElement;
        const currentElement = node.parentElement;
        const previousRect = previousElement?.getBoundingClientRect();
        const currentRect = currentElement?.getBoundingClientRect();
        const changedLine = Boolean(
          previousRect
          && currentRect
          && Math.abs(currentRect.top - previousRect.top)
            > Math.max(2, Math.min(previousRect.height, currentRect.height) * 0.45),
        );
        const minimumTextHeight = Math.max(
          1,
          Math.min(previousRect?.height ?? 0, currentRect?.height ?? 0),
        );
        const maximumTextHeight = Math.max(
          previousRect?.height ?? 0,
          currentRect?.height ?? 0,
          1,
        );
        const verticalLineAdvance = currentRect && previousRect
          ? currentRect.top - previousRect.top
          : 0;
        const changedReadingFlow = Boolean(
          changedLine
          && (
            // Moving from the bottom of one PDF column to the top of the next.
            verticalLineAdvance < -maximumTextHeight * 0.8
            // A larger-than-normal vertical gap marks a paragraph boundary.
            || verticalLineAdvance > maximumTextHeight * 1.45
            // Headings and their following body text normally change scale.
            || maximumTextHeight / minimumTextHeight > 1.18
          )
        );
        const alreadyHasWhitespace = Boolean(
          /\s$/u.test(nodes[index - 1]?.data ?? "")
          || /^\s/u.test(node.data),
        );
        const visualWordGap = Boolean(
          previousRect
          && currentRect
          && currentRect.left - previousRect.right
            > Math.max(
              0.75,
              Math.min(previousRect.height, currentRect.height) * 0.06,
            ),
        );
        combined += changedReadingFlow
          ? "\n\n"
          : changedLine
            ? "\n"
            : alreadyHasWhitespace
              ? ""
              : visualWordGap
                ? " "
                : "";
      }
      starts.set(node, combined.length);
      combined += node.data;
    });

    snapshot = {
      childElementCount: textLayer.childElementCount,
      starts,
      combined,
    };
    textLayerTextSnapshots.set(textLayer, snapshot);
  }

  const { starts, combined } = snapshot;
  if (!starts.has(start.node) || !starts.has(end.node)) {
    return { before: "", selected: selection.toString(), after: "" };
  }
  const startIndex = (starts.get(start.node) ?? 0) + start.offset;
  const endIndex = (starts.get(end.node) ?? startIndex) + end.offset;
  return {
    before: combined.slice(0, startIndex),
    selected: combined.slice(startIndex, endIndex),
    after: combined.slice(endIndex),
  };
}



export function normalizeSelectionContextFragment(value: string): string {
  if (!value) return "";
  const hadLeadingWhitespace = /^\s/u.test(value);
  const hadTrailingWhitespace = /\s$/u.test(value);
  const hadLeadingParagraphBoundary = /^(?:[\t ]*\n){2,}/u.test(value);
  const hadTrailingParagraphBoundary = /(?:\n[\t ]*){2,}$/u.test(value);
  const normalized = normalizeCopiedText(value);
  if (!normalized) return hadLeadingWhitespace || hadTrailingWhitespace ? " " : "";
  const leadingBoundary = hadLeadingParagraphBoundary
    ? "\n\n"
    : hadLeadingWhitespace
      ? " "
      : "";
  const trailingBoundary = hadTrailingParagraphBoundary
    ? "\n\n"
    : hadTrailingWhitespace
      ? " "
      : "";
  return `${leadingBoundary}${normalized}${trailingBoundary}`;
}



export function getSelectionSentenceContext(
  selectedText: string,
  surroundingText?: SelectionSurroundingText,
): string {
  const { before, selected: reconstructedSelection, after } =
    surroundingText ?? getSelectionSurroundingText();
  if (!before && !after) return selectedText;

  const liveSelectionText = reconstructedSelection
    || window.getSelection()?.toString()
    || selectedText;
  const beforeText = normalizeSelectionContextFragment(before);
  const selected = normalizeSelectionContextFragment(liveSelectionText);
  const afterText = normalizeSelectionContextFragment(after);
  const combined = beforeText + selected + afterText;
  const selectionStart = beforeText.length;
  const punctuationStart = Math.max(
    0,
    combined.lastIndexOf(".", Math.max(0, selectionStart - 1)) + 1,
    combined.lastIndexOf("!", Math.max(0, selectionStart - 1)) + 1,
    combined.lastIndexOf("?", Math.max(0, selectionStart - 1)) + 1,
    combined.lastIndexOf("。", Math.max(0, selectionStart - 1)) + 1,
    combined.lastIndexOf("！", Math.max(0, selectionStart - 1)) + 1,
    combined.lastIndexOf("？", Math.max(0, selectionStart - 1)) + 1,
  );
  const paragraphBoundaryStart = combined.lastIndexOf(
    "\n\n",
    Math.max(0, selectionStart - 1),
  );
  const sentenceStart = Math.max(
    punctuationStart,
    paragraphBoundaryStart >= 0 ? paragraphBoundaryStart + 2 : 0,
    selectionStart - 520,
  );
  const afterSelection = combined.slice(selectionStart + selected.length);
  const sentenceEndMatch = afterSelection.match(/[.!?。！？](?:\s|$)/);
  const paragraphBoundaryEnd = afterSelection.indexOf("\n\n");
  const sentenceEndOffsets = [
    sentenceEndMatch?.index === undefined
      ? Number.POSITIVE_INFINITY
      : sentenceEndMatch.index + 1,
    paragraphBoundaryEnd < 0
      ? Number.POSITIVE_INFINITY
      : paragraphBoundaryEnd,
    520,
  ];
  const sentenceEnd = Math.min(
    combined.length,
    selectionStart + selected.length + Math.min(...sentenceEndOffsets),
  );
  const sentence = normalizeCopiedText(
    combined.slice(sentenceStart, sentenceEnd),
  ).replace(/\s+/g, " ").trim();
  return sentence.length >= selected.length ? sentence : selectedText;
}



export function getTranslationScopeFromSelection(
  selectedText: string,
  sentenceContext: string,
): string {
  const selected = normalizeLearningInlineText(selectedText);
  const context = normalizeLearningInlineText(sentenceContext);
  if (!selected || !context || context.length <= selected.length) return selected;

  const terminalMarks = selected.match(/[.!?。！？]/g)?.length ?? 0;
  const endsAtSentenceBoundary = /[.!?。！？]["'”’）)\]]*$/.test(selected);
  const isLongOrMultiSentenceSelection = selected.length > 360
    || terminalMarks >= 2
    || (terminalMarks >= 1 && endsAtSentenceBoundary);
  if (isLongOrMultiSentenceSelection) return selected;

  // Only repair a genuinely short, cut-off sentence. Large expansions usually
  // mean the PDF text layer crossed a heading, column or paragraph boundary.
  const expansionIsPlausible = context.length <= 700
    && context.length - selected.length <= 420
    && context.length <= selected.length * 3 + 180;
  return expansionIsPlausible ? context : selected;
}



export function autoResizeTranslationTextarea(
  textarea: HTMLTextAreaElement,
): void {
  const resize = (): void => {
    textarea.style.height = "auto";
    const borderHeight = Math.max(
      0,
      textarea.offsetHeight - textarea.clientHeight,
    );
    const minimumHeight = textarea === selectedSnippetElement ? 58 : 44;
    textarea.style.height = `${Math.max(
      minimumHeight,
      Math.ceil(textarea.scrollHeight + borderHeight + 10),
    )}px`;
    textarea.scrollTop = 0;
  };

  resize();
  // Fonts and the right-panel width can settle one frame after content is
  // assigned. Re-measure then so the final one or two lines are never clipped.
  requestAnimationFrame(resize);
}
