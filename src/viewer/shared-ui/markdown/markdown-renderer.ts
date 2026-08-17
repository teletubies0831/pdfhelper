

import DOMPurify from "dompurify";
import katex from "katex";
import { marked } from "marked";

import { browser } from "wxt/browser";
import { type AiConfig, type AiConversationMessage, type AiRuntimeResponse, type AiStreamStartMessage } from "../../../../shared/ai";









import { aiConfig, resolvedReadingMode, setDeepSeekSettingsOpen } from '../../core/pdf-reader/public';
import { chatMessagesElement, deepSeekSettingsStatus } from '../../app/viewer-elements';
import { normalizeCitationMatchText } from '../../features/translation/public';


const DEFAULT_AI_CONTENT_TIMEOUT_MS = 120_000;

export interface AiContentRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  routeId?: 'chat' | 'translation';
}

function requestAiRuntimeResponse(
  message: Record<string, unknown>,
  options: AiContentRequestOptions,
): Promise<AiRuntimeResponse> {
  const timeoutMs = Math.max(
    1_000,
    options.timeoutMs ?? DEFAULT_AI_CONTENT_TIMEOUT_MS,
  );

  return new Promise<AiRuntimeResponse>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", handleAbort);
      callback();
    };
    const handleAbort = (): void => {
      finish(() => reject(new DOMException("AI 请求已取消。", "AbortError")));
    };
    const timeoutId = window.setTimeout(() => {
      finish(() => reject(new Error(
        `AI 请求超过 ${Math.round(timeoutMs / 1_000)} 秒仍未返回，请检查网络或模型配置后重试。`,
      )));
    }, timeoutMs);

    if (options.signal?.aborted) {
      handleAbort();
      return;
    }
    options.signal?.addEventListener("abort", handleAbort, { once: true });

    void browser.runtime.sendMessage(message).then(
      (response) => finish(() => resolve(response as AiRuntimeResponse)),
      (error) => finish(() => reject(error)),
    );
  });
}



export async function requestAiContent(
  messages: AiConversationMessage[],
  context: AiStreamStartMessage["context"] = {},
  configOverride?: Pick<AiConfig, "model" | "reasoning" | "maxOutputTokens">,
  requestOptions: AiContentRequestOptions = {},
): Promise<string> {
  if (!aiConfig.value.apiKey) {
    setDeepSeekSettingsOpen(true);
    deepSeekSettingsStatus.classList.add("error");
    deepSeekSettingsStatus.textContent = "请先配置并保存模型供应商的 API Key。";
    throw new Error("请先在右上角“设置”中配置 API Key。");
  }

  const response = await requestAiRuntimeResponse({
    type: "pdf-helper:ai-chat",
    messages,
    configOverride,
    routeId: requestOptions.routeId,
    context: {
      ...context,
      readingMode: context.readingMode ?? resolvedReadingMode.value,
    },
  }, requestOptions);

  if (!response?.ok || !response.content?.trim()) {
    throw new Error(response?.error || "AI 模型没有返回有效内容。");
  }
  return response.content.trim();
}


export function parseAiList(content: string): string[] {
  const points = content
    .replace(/^```(?:markdown|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, "").trim())
    .filter(Boolean);
  return points.length > 1 ? points : [content.trim()].filter(Boolean);
}


export function parseAiJson(content: string): Record<string, unknown> {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型没有返回有效 JSON。");
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}


export interface MarkdownMathToken {
  expression: string;
  displayMode: boolean;
}


export interface MarkdownCitationToken {
  pageNumber: number;
  quotes: string[];
}


// A citation may intentionally contain a full paragraph. Keep one page worth
// of text available so the click target can resolve and highlight the complete
// source range instead of forcing the model to cite only a short sentence.
export const PDF_CITATION_PATTERN_SOURCE = String.raw`\[\[PDF:P(\d{1,5})\|([\s\S]{2,6000}?)\]\]`;


export function createPdfCitationPattern(): RegExp {
  return new RegExp(PDF_CITATION_PATTERN_SOURCE, "g");
}


export function protectMarkdownCitations(content: string): {
  markdown: string;
  tokens: MarkdownCitationToken[];
} {
  const tokens: MarkdownCitationToken[] = [];
  const output: string[] = [];
  let cursor = 0;
  let previousCitation:
    | { tokenIndex: number; sourceEnd: number }
    | undefined;

  for (const match of content.matchAll(createPdfCitationPattern())) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const gap = content.slice(cursor, start);
    output.push(gap);

    const pageNumber = Number(match[1]);
    const quote = (match[2] ?? "").replace(/\s+/g, " ").trim();
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || quote.length < 2) {
      cursor = end;
      previousCitation = undefined;
      continue;
    }

    const previousToken = previousCitation
      ? tokens[previousCitation.tokenIndex]
      : undefined;
    const separator = previousCitation
      ? content.slice(previousCitation.sourceEnd, start)
      : "";
    const isAdjacentSamePage =
      Boolean(previousToken) &&
      previousToken?.pageNumber === pageNumber &&
      separator.length <= 16 &&
      !/[\p{L}\p{N}]/u.test(separator);

    if (isAdjacentSamePage && previousToken) {
      const normalizedQuote = normalizeCitationMatchText(quote);
      if (
        !previousToken.quotes.some(
          (existingQuote) =>
            normalizeCitationMatchText(existingQuote) === normalizedQuote,
        )
      ) {
        previousToken.quotes.push(quote);
      }
      previousCitation = {
        tokenIndex: previousCitation!.tokenIndex,
        sourceEnd: end,
      };
    } else {
      const tokenIndex = tokens.push({ pageNumber, quotes: [quote] }) - 1;
      output.push(`PDFHELPERCITATIONTOKEN${tokenIndex}END`);
      previousCitation = { tokenIndex, sourceEnd: end };
    }
    cursor = end;
  }

  output.push(content.slice(cursor));
  return { markdown: output.join(""), tokens };
}


export function restoreMarkdownCitations(
  container: HTMLElement,
  tokens: MarkdownCitationToken[],
): void {
  if (tokens.length === 0) return;
  const tokenPattern = /PDFHELPERCITATIONTOKEN(\d+)END/g;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const textNode of textNodes) {
    const value = textNode.nodeValue ?? "";
    tokenPattern.lastIndex = 0;
    if (!tokenPattern.test(value)) continue;
    tokenPattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of value.matchAll(tokenPattern)) {
      const start = match.index ?? 0;
      if (start > cursor) fragment.append(value.slice(cursor, start));
      const token = tokens[Number(match[1])];
      if (token) {
        const citation = document.createElement("button");
        citation.type = "button";
        citation.className = "pdf-source-citation";
        citation.dataset.pdfPage = String(token.pageNumber);
        citation.dataset.pdfQuote = token.quotes[0] ?? "";
        citation.dataset.pdfQuotes = JSON.stringify(token.quotes);
        citation.dataset.citationTooltip =
          token.quotes.length > 1
            ? `点击跳转到第 ${token.pageNumber} 页并高亮 ${token.quotes.length} 处原文`
            : `点击跳转到第 ${token.pageNumber} 页：${(token.quotes[0] ?? "").slice(0, 88)}${(token.quotes[0]?.length ?? 0) > 88 ? "…" : ""}`;
        citation.setAttribute("aria-label", citation.dataset.citationTooltip);
        citation.textContent =
          token.quotes.length > 1
            ? `第 ${token.pageNumber} 页 · 查看 ${token.quotes.length} 处原文`
            : `第 ${token.pageNumber} 页 · 查看原文`;
        fragment.append(citation);
      }
      cursor = start + match[0].length;
    }
    if (cursor < value.length) fragment.append(value.slice(cursor));
    textNode.replaceWith(fragment);
  }
}


export function normalizeBareLatexMath(content: string): string {
  return content.replace(
    /(^|[^$\\\w])(\d+(?:\.\d+)?\^\{[^{}\n]{1,80}\})(?![$])/g,
    (_match, prefix: string, expression: string) => `${prefix}$${expression}$`,
  );
}


export function repairUnclosedInlineMathLines(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const delimiters: number[] = [];
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== "$" || line[index - 1] === "\\") continue;
        if (line[index - 1] === "$" || line[index + 1] === "$") continue;
        delimiters.push(index);
      }
      if (delimiters.length % 2 === 0) return line;
      const opener = delimiters.at(-1);
      if (opener === undefined) return line;
      const candidate = line.slice(opener + 1).trim();
      const looksLikeLatex =
        candidate.length >= 3 &&
        candidate.length <= 2000 &&
        (/\\[A-Za-z]+/.test(candidate) ||
          /[_^](?:\{|[A-Za-z0-9])/.test(candidate) ||
          /(?:^|\s)[A-Za-z][A-Za-z0-9_{}^]*\s*=/.test(candidate));
      return looksLikeLatex ? `${line}$` : line;
    })
    .join("\n");
}


export function protectMarkdownMath(content: string): {
  markdown: string;
  tokens: MarkdownMathToken[];
} {
  const tokens: MarkdownMathToken[] = [];
  const addToken = (expression: string, displayMode: boolean): string => {
    const index =
      tokens.push({ expression: expression.trim(), displayMode }) - 1;
    return `PDFHELPERMATHTOKEN${index}END`;
  };

  let markdown = normalizeBareLatexMath(content)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, expression: string) =>
      addToken(expression, true),
    )
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, expression: string) =>
      addToken(expression, true),
    )
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, expression: string) =>
      addToken(expression, false),
    );

  // Models occasionally wrap one inline formula across several Markdown
  // lines. Accept soft line breaks inside $...$, but never cross an empty
  // paragraph; otherwise one unmatched currency/document dollar sign could
  // consume a large part of the answer.
  markdown = markdown.replace(
    /(^|[^\\$])\$((?:[^$\r\n]|\r?\n(?!\s*\r?\n)){1,2000}?)\$/g,
    (_match, prefix: string, expression: string) =>
      `${prefix}${addToken(expression.replace(/\s*\r?\n\s*/g, " "), false)}`,
  );
  // Some providers occasionally omit the closing dollar entirely. Repair it
  // only when the unmatched tail is unmistakably LaTeX, then tokenize again.
  markdown = repairUnclosedInlineMathLines(markdown).replace(
    /(^|[^\\$])\$([^$\r\n]{1,2000}?)\$/g,
    (_match, prefix: string, expression: string) =>
      `${prefix}${addToken(expression, false)}`,
  );
  return { markdown, tokens };
}


export function restoreMarkdownMath(
  container: HTMLElement,
  tokens: MarkdownMathToken[],
): void {
  if (tokens.length === 0) return;

  const tokenPattern = /PDFHELPERMATHTOKEN(\d+)END/g;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const textNode of textNodes) {
    const value = textNode.nodeValue ?? "";
    tokenPattern.lastIndex = 0;
    if (!tokenPattern.test(value)) continue;

    tokenPattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of value.matchAll(tokenPattern)) {
      const start = match.index ?? 0;
      if (start > cursor) fragment.append(value.slice(cursor, start));

      const token = tokens[Number(match[1])];
      if (token) {
        const math = document.createElement("span");
        math.className = token.displayMode
          ? "pdf-helper-math display"
          : "pdf-helper-math inline";
        math.setAttribute("aria-label", token.expression);
        math.innerHTML = katex.renderToString(token.expression, {
          displayMode: token.displayMode,
          output: "htmlAndMathml",
          strict: false,
          throwOnError: false,
          trust: false,
        });
        fragment.append(math);
      }
      cursor = start + match[0].length;
    }
    if (cursor < value.length) fragment.append(value.slice(cursor));
    textNode.replaceWith(fragment);
  }
}


export function renderChatMarkdown(
  container: HTMLElement,
  content: string,
  renderCitations = true,
  fitMath = true,
): void {
  const citationResult = renderCitations
    ? protectMarkdownCitations(content)
    : {
        markdown: content.replace(createPdfCitationPattern(), ""),
        tokens: [] as MarkdownCitationToken[],
      };
  const mathResult = protectMarkdownMath(citationResult.markdown);
  const html = marked.parse(mathResult.markdown, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string;
  container.innerHTML = DOMPurify.sanitize(html, {
    FORBID_TAGS: ["img"],
    USE_PROFILES: { html: true },
  });
  for (const link of container.querySelectorAll<HTMLAnchorElement>("a")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  restoreMarkdownMath(container, mathResult.tokens);
  restoreMarkdownCitations(container, citationResult.tokens);
  enhanceRenderedTables(container);
  if (fitMath) {
    window.requestAnimationFrame(() => fitDisplayMath(container));
  }
}


export function enhanceRenderedTables(container: HTMLElement): void {
  for (const table of container.querySelectorAll<HTMLTableElement>("table")) {
    if (table.parentElement?.classList.contains("chat-markdown-table")) continue;

    const wrapper = document.createElement("div");
    wrapper.className = "chat-markdown-table";
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "可横向滚动的表格");
    wrapper.tabIndex = 0;
    table.before(wrapper);
    wrapper.append(table);
  }
}


export function fitDisplayMath(container: HTMLElement): void {
  for (const wrapper of container.querySelectorAll<HTMLElement>(
    ".pdf-helper-math.display",
  )) {
    wrapper.classList.remove("needs-horizontal-scroll");
    wrapper.style.removeProperty("--pdf-math-scale");

    const math = wrapper.querySelector<HTMLElement>(".katex");
    const availableWidth = wrapper.clientWidth;
    if (!math || availableWidth <= 0) continue;

    const naturalWidth = math.scrollWidth;
    if (naturalWidth <= availableWidth - 4) continue;

    const scale = Math.max(
      0.72,
      Math.min(1, (availableWidth - 8) / naturalWidth),
    );
    wrapper.style.setProperty("--pdf-math-scale", scale.toFixed(3));

    // KaTeX does not safely line-wrap every construct. Keep a subtle scroll
    // fallback only for exceptionally long formulas after readable scaling.
    if (math.scrollWidth > wrapper.clientWidth + 3) {
      wrapper.classList.add("needs-horizontal-scroll");
    }
  }
}


export type ChatActivityState = "active" | "done" | "error";


export function updateChatActivity(
  message: HTMLElement,
  key: string,
  label: string,
  state: ChatActivityState,
  detail = "",
): void {
  let activity = message.querySelector<HTMLElement>(".chat-message-activity");
  if (!activity) {
    activity = document.createElement("div");
    activity.className = "chat-message-activity";
    activity.setAttribute("aria-live", "polite");
    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "chat-activity-summary";
    summary.setAttribute("aria-expanded", "false");
    summary.setAttribute("aria-label", "展开工具活动详情");
    const summaryIcon = document.createElement("span");
    summaryIcon.className = "chat-activity-summary-icon";
    summaryIcon.setAttribute("aria-hidden", "true");
    const summaryText = document.createElement("span");
    summaryText.className = "chat-activity-summary-label";
    const summaryDetail = document.createElement("small");
    summaryDetail.className = "chat-activity-summary-detail";
    const summaryChevron = document.createElement("span");
    summaryChevron.className = "chat-activity-summary-chevron";
    summaryChevron.setAttribute("aria-hidden", "true");
    summaryChevron.textContent = "›";
    summary.append(summaryIcon, summaryText, summaryDetail, summaryChevron);
    summary.addEventListener("click", () => {
      const expanded = !activity?.classList.contains("is-expanded");
      activity?.classList.toggle("is-expanded", expanded);
      summary.setAttribute("aria-expanded", String(expanded));
    });
    const details = document.createElement("div");
    details.className = "chat-activity-details";
    activity.append(summary, details);
    const firstContent = message.querySelector(
      ".chat-message-reasoning, .chat-message-content",
    );
    if (firstContent) message.insertBefore(activity, firstContent);
    else message.append(activity);
  }

  // Keep the DOM resilient when an activity was created by an older build or
  // survived a hot reload. Existing rows are moved under the collapsible body.
  let summary = activity.querySelector<HTMLButtonElement>(".chat-activity-summary");
  let details = activity.querySelector<HTMLElement>(".chat-activity-details");
  if (!summary) {
    summary = document.createElement("button");
    summary.type = "button";
    summary.className = "chat-activity-summary";
    summary.setAttribute("aria-expanded", "false");
    summary.setAttribute("aria-label", "展开工具活动详情");
    summary.innerHTML = '<span class="chat-activity-summary-icon" aria-hidden="true"></span><span class="chat-activity-summary-label"></span><small class="chat-activity-summary-detail"></small><span class="chat-activity-summary-chevron" aria-hidden="true">›</span>';
    summary.addEventListener("click", () => {
      const expanded = !activity?.classList.contains("is-expanded");
      activity?.classList.toggle("is-expanded", expanded);
      summary?.setAttribute("aria-expanded", String(expanded));
    });
    activity.prepend(summary);
  }
  if (!details) {
    details = document.createElement("div");
    details.className = "chat-activity-details";
    for (const oldRow of Array.from(activity.querySelectorAll<HTMLElement>(".chat-activity-row"))) {
      details.append(oldRow);
    }
    activity.append(details);
  }

  let row = Array.from(
    details.querySelectorAll<HTMLElement>(".chat-activity-row"),
  ).find((item) => item.dataset.activityKey === key);
  if (!row) {
    row = document.createElement("div");
    row.className = "chat-activity-row";
    row.dataset.activityKey = key;
    const icon = document.createElement("span");
    icon.className = "chat-activity-icon";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "chat-activity-label";
    const secondary = document.createElement("small");
    secondary.className = "chat-activity-detail";
    row.append(icon, text, secondary);
    details.append(row);
  }

  row.dataset.state = state;
  const text = row.querySelector<HTMLElement>(".chat-activity-label");
  const secondary = row.querySelector<HTMLElement>(".chat-activity-detail");
  if (text) text.textContent = label;
  if (secondary) {
    secondary.textContent = detail;
    secondary.hidden = !detail;
  }
  const rows = Array.from(details.querySelectorAll<HTMLElement>(".chat-activity-row"));
  const latest = [...rows].reverse().find((item) => item.dataset.state === "active") ?? rows.at(-1);
  if (latest) {
    const summaryLabel = summary.querySelector<HTMLElement>(".chat-activity-summary-label");
    const summaryDetail = summary.querySelector<HTMLElement>(".chat-activity-summary-detail");
    const summaryIcon = summary.querySelector<HTMLElement>(".chat-activity-summary-icon");
    const latestLabel = latest.querySelector<HTMLElement>(".chat-activity-label")?.textContent ?? label;
    const latestDetail = latest.querySelector<HTMLElement>(".chat-activity-detail")?.textContent ?? "";
    summaryLabel && (summaryLabel.textContent = latestLabel);
    summaryDetail && (summaryDetail.textContent = rows.length > 1 ? `+${rows.length - 1} 个步骤` : latestDetail);
    if (summaryDetail) summaryDetail.hidden = rows.length <= 1 && !latestDetail;
    summary.dataset.state = latest.dataset.state ?? state;
    summaryIcon?.setAttribute("aria-label", latest.dataset.state ?? state);
    activity.dataset.stepCount = String(rows.length);
  }
  chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
}
