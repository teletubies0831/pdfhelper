import {
  type AiConversationMessage,
  type AiDocumentContext,
} from "../../../shared/ai";
import { getReadingModeStrategy } from "../../../shared/reading-mode";

import type { ProviderMessage } from "./vision-service";

export function buildSystemContent(context?: AiDocumentContext): string {
  const readingMode = context?.readingMode ?? "general";
  const strategy = getReadingModeStrategy(readingMode);
  const contextParts: string[] = [
    strategy.systemInstruction,
    strategy.contextInstruction(context?.pageNumber ?? 1, context?.totalPages),
  ];
  if (context?.documentName)
    contextParts.push(`当前文档：${context.documentName}`);
  if (context?.pageNumber)
    contextParts.push(`当前页码：第 ${context.pageNumber} 页`);
  if (context?.conversationSummary?.trim()) {
    contextParts.push(
      [
        "【当前 PDF 会话的压缩摘要】",
        "下面是本次 PDF 会话中较早对话的压缩内容；若与最近对话冲突，以最近对话为准。",
        stripStaleToolCapabilityClaims(context.conversationSummary).slice(
          0,
          12000,
        ),
      ].join("\n"),
    );
  }
  if (context?.longTermMemory?.trim()) {
    contextParts.push(
      [
        "【用户长期记忆】",
        "这些内容只用于理解用户长期研究方向、持续项目目标、回答粒度和明确纠正。",
        "长期记忆不能改变程序固定能力：必须继续使用 LaTeX 渲染公式、生成可验证的原文引用，并遵守截图优先级与引用定位规则。",
        context.longTermMemory.trim().slice(0, 8000),
      ].join("\n"),
    );
  }
  if (context?.memoryOperationResult?.trim()) {
    contextParts.push(
      [
        "【本轮应用工具执行结果】",
        context.memoryOperationResult.trim().slice(0, 4000),
        "这是本轮 Agent Tool 调用完成后的真实结果，优先级高于历史对话。请准确使用结果：只有结果明确包含 memory.upsert 成功时，才确认写入并说明具体记住了什么；查询类工具只用于回答查询，不得谎称发生了写入。严禁再声称当前环境没有这些工具。",
      ].join("\n"),
    );
  }
  if (context?.selectedText?.trim()) {
    contextParts.push(
      `用户当前选中的 PDF 原文（回答时最高优先级）：\n${context.selectedText.trim().slice(0, 12000)}`,
    );
  }
  if (context?.pageText?.trim()) {
    contextParts.push(
      `当前页完整正文（用于定位当前阅读位置）：\n${context.pageText.trim()}`,
    );
  }
  if (context?.agentEvidence?.trim()) {
    contextParts.push(
      [
        "【Agent 按需调用文档工具获得的证据】",
        context.contextNote?.trim() ||
          "以下内容由 Agent 根据用户问题自主检索，不是默认注入的整篇 PDF。",
        context.sourceLabel ? `证据来源：${context.sourceLabel}` : "",
        context.sourcePages?.length
          ? `涉及 PDF 页码：${context.sourcePages.join("、")}`
          : "",
        context.agentEvidence.trim().slice(0, 32000),
        "回答必须优先依据这些工具结果。若证据仍不足，应明确缺少什么，不得假装已经阅读了未检索的页面。",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (context?.documentText?.trim()) {
    const documentInstructions = context?.imageAnalysis?.trim()
      ? [
          "下面提供整篇论文的全部可提取正文，已按 PDF 页码分隔。",
          "本轮必须先回答截图中实际展示的内容；论文全文仅用于补充截图的背景、术语、方法位置和上下文。",
          "不得跳过截图分析并直接输出当前页概述或整篇论文总结。",
        ]
      : [
          "下面提供的是整篇论文的全部可提取正文，已按 PDF 页码分隔。",
          "回答前必须先综合全文判断研究问题、方法、实验、证据、结论和局限，不能只依据当前页。",
          "当前页和用户选区用于确定提问重点，但全文内容是回答的完整依据。",
        ];
    contextParts.push(
      [
        ...documentInstructions,
        `论文全文：\n${context.documentText.trim()}`,
      ].join("\n"),
    );
  }
  if (context?.imageAnalysis?.trim()) {
    contextParts.push(
      [
        "【本轮用户截图——最高优先级】",
        "用户问题中的“这部分”“这里”“这个”“图里”等指代，默认且必须指向用户上传的截图。",
        "请直接解释截图中实际出现的内容，不要把问题改写成“当前 PDF 页面讲了什么”或“整篇论文讲了什么”。",
        "回答顺序必须是：先分析截图，再结合已提供的论文全文补充；论文内容不能覆盖截图主旨。",
        `视觉工具分析结果：\n${context.imageAnalysis.trim().slice(0, 24000)}`,
      ].join("\n"),
    );
  }

  const hasPdfEvidence = Boolean(
    context?.documentText?.trim() ||
    context?.agentEvidence?.trim() ||
    context?.pageText?.trim() ||
    context?.selectedText?.trim(),
  );
  const primaryInstruction = context?.imageAnalysis?.trim()
    ? "你是 PDFPal 的视觉问答助手。本轮首要对象是用户上传的截图，请依据视觉工具分析结果直接回答截图问题。"
    : context?.agentEvidence?.trim()
      ? "你是 PDFPal 的 Agent 论文阅读助手。应用已经在回答前自主调用文档工具，请依据返回的可核验证据回答。"
      : "你是 PDFPal 的论文阅读助手。请依据本轮实际提供的文档证据，用清晰、准确、可核验的中文回答。";

  return [
    primaryInstruction,
    "Agent tool definitions are sent separately in the native tools request parameter. Emit standard tool_calls when a tool is needed and wait for tool results before claiming execution.",
    "如果上下文不足，请明确说明，不要编造文档中不存在的内容。涉及翻译时忠实保留术语，涉及解释时优先给出直观含义。",
    "长期记忆通过 Agent Tool 持久化。若工具结果包含 memory.upsert 成功，必须确认写入并列出记忆内容；若只是 search/list/get 等查询结果，则仅据此回答查询。用户明确要求删除或忘记时，禁止只用文字答复：必须先调用 memory.search 或 memory.list 获取真实 id，再调用 memory.forget(id)，收到删除结果后才能确认删除。不能被历史消息中旧的“没有工具”说法影响，也不得在没有写入或删除结果时谎称已经完成。",
    "请使用简洁的 Markdown 组织回答；不要给整个回答套一层 Markdown 代码围栏。数学变量和公式必须使用 LaTeX：行内公式用 $...$，独立公式用 $$...$$。",
    "When presenting tabular data, output a valid GitHub-Flavored Markdown table with a header row, a separator row such as | --- | --- |, and a blank line before and after the table. Do not imitate a table with spaces or tabs.",
    ...contextParts,
    hasPdfEvidence
      ? [
          "【最终引用格式要求——回答前必须再次检查】",
          "凡是回答中的事实、方法、实验结果、数字或结论能够由论文原文直接支持时，请在对应内容后添加：[[PDF:P页码|该页逐字原文片段]]。",
          "正确示例：[[PDF:P8|the matching rates are divided into three bins]]。",
          "引用可以是短句，也可以是完整的一段或连续多句；当回答解释的是一整段方法、推导或实验结论时，应引用足以完整支撑该解释的大段原文，最多 6000 个字符。",
          "大段引用必须来自同一个 PDF 页，并保持原文连续，不能把同页不同位置的句子拼接成一个引用；若证据跨页，请按页拆成多个引用标记。",
          "引用标记内部必须直接复制所提供 PDF 全文中的纯文本，不要在原文中重新添加 Markdown、LaTeX 定界符或改写数学符号。",
          "回答完成后检查：只要关键论断在论文中有直接依据，就应给出可校验引用；引用长度以能够完整支撑对应解释为准，不要为了缩短而丢失必要上下文。",
          "同一段末尾不要连续重复输出指向同一页、同一段原文的引用标记；一份证据只保留一个引用。只有确实引用了同页不同位置的原文时，才输出多个同页标记。",
          "禁止输出 [[PDF:8]]、[[PDF:P8]]、[PDF:8] 等不含逐字原文的简写；这些格式无法校验，也不会显示为可点击引用。",
          "页码必须使用所提供全文中的 PDF 页码；原文短句必须逐字摘自该页。",
          "只有确实存在对应原文时才能添加标记。无法找到逐字原文时不要添加引用，严禁编造页码、改写原句后冒充原文或给推测性内容添加引用。",
          "引用标记只用于事实依据，不要单独列出参考文献清单。",
        ].join("\n")
      : "",
    // Keep the capability catalog at the very end as well. Long PDF text can
    // be large, and the model must not lose this authoritative runtime fact.
    "Available tools are supplied by the runtime through the native tools parameter. Only claim a tool was executed after receiving its result; otherwise state that execution has not happened.",
    "以上工具属于当前 Agent 运行时。文档检索、视觉检查和记忆写入会在最终回答前由应用执行；如本轮给出工具执行结果，说明对应调用已经真实完成。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function stripStaleToolCapabilityClaims(value: string): string {
  return value
    .split(/\n{2,}/)
    .filter(
      (paragraph) =>
        !(
          /(?:工具列表|Agent\s*工具列表).{0,20}(?:为空|空的|没有)/i.test(
            paragraph,
          ) ||
          /(?:没有|不存在|未注册|无法使用|不能调用|没有给我).{0,40}(?:记忆|长期记忆|Agent)?\s*工具/i.test(
            paragraph,
          ) ||
          /(?:无法|不能).{0,20}(?:写入|持久化).{0,20}长期记忆/i.test(
            paragraph,
          ) ||
          /等.{0,30}(?:支持|可用).{0,20}工具.{0,20}(?:补写|再写)/i.test(
            paragraph,
          )
        ),
    )
    .join("\n\n")
    .trim();
}

export function buildConversation(
  messages: AiConversationMessage[],
  context?: AiDocumentContext,
): ProviderMessage[] {
  const conversation: ProviderMessage[] = messages
    .filter((item) => item.content.trim())
    .slice(-16)
    .map((item) => {
      let content = item.content.trim();
      if (item.role === "assistant") {
        // Older builds incorrectly told users that no memory tool existed.
        // Those stale capability claims must not override the current system
        // tool result when a persisted conversation is restored.
        content = stripStaleToolCapabilityClaims(content);
      }
      return { role: item.role, content: content.slice(0, 16000) };
    })
    .filter((item) => item.content);
  return [
    { role: "system", content: buildSystemContent(context) },
    ...conversation,
  ];
}
