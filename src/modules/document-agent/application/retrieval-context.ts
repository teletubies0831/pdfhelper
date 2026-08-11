
import { buildDocumentToolPlanningPrompt, formatDocumentToolResults, parseDocumentToolDecision, type DocumentToolCall, type DocumentToolResult } from "../../../../shared/document-agent";


import type { BuildRetrievalContextOptions, DocumentRetrievalContext } from './runtime-contracts';
import { uniquePages } from './section-resolver';
import { executeDocumentToolCalls } from './document-tool-executor';



export async function buildDocumentRetrievalContext(
  options: BuildRetrievalContextOptions,
): Promise<DocumentRetrievalContext> {
  const explicitlyReferencesPdfVisual = (
    /(?:PDF|文档|论文|本页|当前页|第\s*\d+\s*页).{0,12}(?:图\s*\d*|图表|表格|公式|方程|曲线|流程图|架构图|示意图|figure|fig\.?|table|chart|equation|diagram)/i.test(options.question)
    || /(?:figure|fig\.?|图)\s*\d+.{0,12}(?:PDF|文档|论文|本页|当前页|第\s*\d+\s*页)/i.test(options.question)
  );
  // A chat attachment is an explicit user action. Treat it as the primary visual
  // question even when the wording is only "this part" and contains no image keyword.
  // References such as "Fig. 2 in the PDF" still belong to the PDF-page vision tool.
  const userImageQuestion = Boolean(options.userImageAttached && !explicitlyReferencesPdfVisual);
  const maximumPlanningRounds = 3;
  const maximumToolCalls = 6;
  const toolResults: DocumentToolResult[] = [];
  const seenToolCalls = new Set<string>();
  let plannerReason = '';
  let planningRounds = 0;
  let plannerFailed = false;

  const toolCallKey = (call: DocumentToolCall): string => {
    const orderedArguments = Object.fromEntries(
      Object.entries(call.arguments).sort(([left], [right]) => left.localeCompare(right)),
    );
    return `${call.name}:${JSON.stringify(orderedArguments)}`;
  };

  for (let round = 1; round <= maximumPlanningRounds; round += 1) {
    planningRounds = round;
    try {
      const planningPrompt = buildDocumentToolPlanningPrompt({
        question: options.question,
        currentPage: options.currentPage,
        totalPages: options.pageCount,
        selectedText: options.selectedText,
        currentPageText: options.currentPageText,
        visionAvailable: options.hasVisionModel && !userImageQuestion,
        userImageAttached: Boolean(options.userImageAttached),
        outlineTitles: options.outline.map((item) => item.title),
        previousResults: toolResults,
        round,
      });
      console.debug(`[PDF Helper Agent] 第 ${round} 轮工具规划提示词`, planningPrompt);
      const plan = await options.requestAi(
        [{ role: 'user', content: planningPrompt }],
        {
          task: `Agent 证据规划 · 第 ${round} 轮`,
          documentName: options.documentName,
          pageNumber: options.currentPage,
          totalPages: options.pageCount,
          pageText: '',
          selectedText: '',
          sourceScope: 'document',
          sourceLabel: 'Agent 已知证据与本地工具目录',
          sourcePages: uniquePages([options.currentPage, ...toolResults.flatMap((result) => result.pages)]),
          contextNote: '只判断证据是否充分并选择工具；必须返回 JSON，不直接回答用户。',
        },
      );
      const decision = parseDocumentToolDecision(plan);
      if (/Planner returned (?:no valid|malformed) JSON\./.test(decision.reason)) {
        throw new Error(decision.reason);
      }
      plannerReason = decision.reason;
      console.debug(`[PDF Helper Agent] 第 ${round} 轮工具决策`, decision);
      if (decision.decision === 'answer' || decision.calls.length === 0) break;

      const remainingCallCount = maximumToolCalls - seenToolCalls.size;
      const calls = decision.calls
        .filter((call) => !(userImageQuestion && call.name === 'inspect_page_image'))
        .filter((call) => !seenToolCalls.has(toolCallKey(call)))
        .slice(0, Math.max(0, remainingCallCount));
      if (calls.length === 0) {
        plannerReason = `${plannerReason}（后续工具调用与已有调用重复，停止继续检索。）`;
        break;
      }
      calls.forEach((call) => seenToolCalls.add(toolCallKey(call)));

      const roundResults = await executeDocumentToolCalls(calls, options);
      toolResults.push(...roundResults);
      console.debug(`[PDF Helper Agent] 第 ${round} 轮工具结果`, roundResults.map((result) => ({
        name: result.name,
        label: result.label,
        pages: result.pages,
        contentLength: result.content.length,
      })));
      if (seenToolCalls.size >= maximumToolCalls) {
        plannerReason = `${plannerReason}（已达到单次回答的工具调用上限。）`;
        break;
      }
    } catch (error) {
      plannerFailed = true;
      plannerReason = error instanceof Error ? error.message : String(error);
      console.warn('[PDF Helper Agent] 证据规划失败，准备使用通用检索回退', error);
      break;
    }
  }

  // This is a capability fallback, not a question-specific rule. If the planner is
  // unavailable, retrieve semantically related chunks instead of pretending that
  // the visible page represents the requested scope.
  if (
    plannerFailed
    && toolResults.length === 0
    && options.chunks.length > 0
    && !options.selectedText.trim()
    && !userImageQuestion
  ) {
    const fallbackCall: DocumentToolCall = {
      name: 'search_document',
      arguments: { query: options.question, limit: 5 },
    };
    seenToolCalls.add(toolCallKey(fallbackCall));
    toolResults.push(...await executeDocumentToolCalls([fallbackCall], options));
    plannerReason = `工具规划失败，已执行通用全文语义检索：${plannerReason}`;
  }

  const retrievalText = toolResults.length
    ? formatDocumentToolResults(toolResults)
    : '';
  const currentPageLabel = userImageQuestion ? 'PDF 当前页文字补充' : '当前页正文';
  // Tool evidence is placed first so a long visible page cannot truncate or
  // semantically overshadow the evidence the agent deliberately retrieved.
  const orderedText = toolResults.length
    ? `[Agent 工具检索结果]\n${retrievalText}\n\n[${currentPageLabel} · 第 ${options.currentPage} 页，仅作补充]\n${options.currentPageText}`
    : `[${currentPageLabel} · 第 ${options.currentPage} 页]\n${options.currentPageText}`;
  return {
    text: orderedText.slice(0, 26000),
    sourcePages: uniquePages([options.currentPage, ...toolResults.flatMap((result) => result.pages)]),
    toolResults,
    plannerReason,
    planningRounds,
  };
}
