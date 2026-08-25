import { z } from "zod";

export interface AgentToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface AgentToolDefinition {
  /** Stable name used by application services and existing persistence contracts. */
  applicationName: string;
  /** MCP and provider-facing function name. */
  protocolName: string;
  label: string;
  description: string;
  trigger: string;
  parametersSummary: string;
  inputSchema: z.ZodObject;
  annotations: AgentToolAnnotations;
}

const readOnlyAnnotations: AgentToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const writeAnnotations: AgentToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export const AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    applicationName: "document.search",
    protocolName: "document_search",
    label: "检索当前 PDF",
    description:
      "在当前 PDF 的本地全文索引中进行语义与关键词检索，返回相关页码和可引用原文。",
    trigger: "回答需要从整篇 PDF 中查找方法、实验、结论、术语或具体证据时。",
    parametersSummary: "query, limit?",
    inputSchema: z
      .object({
        query: z.string(),
        limit: z.number().int().min(1).max(8).optional(),
      })
      .strict(),
    annotations: readOnlyAnnotations,
  },
  {
    applicationName: "document.readPages",
    protocolName: "document_read_pages",
    label: "读取指定页",
    description: "读取当前 PDF 指定连续页的完整可提取文字，一次最多 8 页。",
    trigger: "已经知道证据页码，或需要补齐某几页的连续上下文时。",
    parametersSummary: "startPage, endPage?",
    inputSchema: z
      .object({
        startPage: z.number().int().min(1),
        endPage: z.number().int().min(1).optional(),
      })
      .strict(),
    annotations: readOnlyAnnotations,
  },
  {
    applicationName: "document.readSection",
    protocolName: "document_read_section",
    label: "读取完整章节",
    description: "根据 PDF 目录或全文索引定位并读取一个完整章节。",
    trigger: "用户询问某一章、摘要、方法、实验、讨论或结论的整体内容时。",
    parametersSummary: "title",
    inputSchema: z.object({ title: z.string() }).strict(),
    annotations: readOnlyAnnotations,
  },
  {
    applicationName: "document.getProfile",
    protocolName: "document_get_profile",
    label: "读取论文档案",
    description:
      "读取已生成的整篇论文结构化档案，包括问题、方法、证据、结论与局限。",
    trigger: "需要先快速掌握整篇论文，且该文档已有档案时。",
    parametersSummary: "无参数",
    inputSchema: z.object({}).strict(),
    annotations: readOnlyAnnotations,
  },
  {
    applicationName: "document.getOutline",
    protocolName: "document_get_outline",
    label: "读取 PDF 目录",
    description: "读取当前 PDF 的章节目录及对应页码。",
    trigger: "需要了解论文结构、定位章节或规划后续读取时。",
    parametersSummary: "无参数",
    inputSchema: z.object({}).strict(),
    annotations: readOnlyAnnotations,
  },
  {
    applicationName: "document.inspectPageImage",
    protocolName: "document_inspect_page_image",
    label: "查看 PDF 页面图像",
    description: "调用视觉模型查看某一 PDF 页面的图、表、公式或空间布局。",
    trigger: "问题依赖图表、公式截图、页面布局，文字层不足以回答时。",
    parametersSummary: "pageNumber, question",
    inputSchema: z
      .object({
        pageNumber: z.number().int().min(1),
        question: z.string(),
      })
      .strict(),
    annotations: { ...readOnlyAnnotations, openWorldHint: true },
  },
  {
    applicationName: "memory.search",
    protocolName: "memory_search",
    label: "搜索长期记忆",
    description:
      "按关键词搜索用户的长期偏好、个人资料、研究项目、事实和纠正记录。",
    trigger:
      "当前问题需要用户习惯、研究方向或跨会话信息，但已注入的记忆不充分时。",
    parametersSummary: "query, limit?",
    inputSchema: z
      .object({
        query: z.string(),
        limit: z.number().int().min(1).max(20).optional(),
      })
      .strict(),
    annotations: readOnlyAnnotations,
  },
  {
    applicationName: "memory.list",
    protocolName: "memory_list",
    label: "列出长期记忆",
    description: "列出长期记忆，可按类别或作用域筛选。",
    trigger: "用户询问记住了什么，或需要核对现有长期记忆时。",
    parametersSummary: "category?, scope?, limit?",
    inputSchema: z
      .object({
        category: z.string().optional(),
        scope: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    annotations: readOnlyAnnotations,
  },
  {
    applicationName: "memory.upsert",
    protocolName: "memory_upsert",
    label: "写入长期记忆",
    description:
      "创建或更新用户明确要求跨会话保留的长期记忆。用户以“以后、今后、始终、默认、每次”等措辞表达持续偏好时，即使没有说“记住”也应调用。",
    trigger:
      "用户说“记住”，或明确表达以后持续生效的稳定偏好、研究方向、个人资料、持续项目目标时；必须在口头确认前完成写入。",
    parametersSummary:
      "key, category, content, scope, confidence?, importance?",
    inputSchema: z
      .object({
        key: z
          .string()
          .describe("稳定英文点分 key，例如 profile.education.major。"),
        category: z.enum([
          "preference",
          "profile",
          "project",
          "fact",
          "correction",
        ]),
        content: z.string(),
        scope: z.enum(["global", "project", "pdf"]),
        confidence: z.number().min(0).max(1).optional(),
        importance: z.number().min(0).max(1).optional(),
      })
      .strict(),
    annotations: writeAnnotations,
  },
  {
    applicationName: "memory.forget",
    protocolName: "memory_forget",
    label: "删除长期记忆",
    description: "删除一条指定的长期记忆。只有用户明确要求忘记时才能调用。",
    trigger: "用户明确要求忘记或删除某条长期记忆时。",
    parametersSummary: "id",
    inputSchema: z.object({ id: z.string() }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    applicationName: "journal.add",
    protocolName: "journal_add",
    label: "添加到知识库",
    description:
      "把当前对话中用户明确要求保存的单词、句子、摘录、解释或想法保存为知识库中的 Markdown 笔记。",
    trigger: "用户明确说“添加到知识库”“保存为笔记”“把这个保存下来”时调用。",
    parametersSummary: "title, content, quote?, tags?, pageNumber?",
    inputSchema: z
      .object({
        title: z.string(),
        content: z.string().describe("Markdown 格式的札记正文"),
        quote: z.string().optional(),
        tags: z.array(z.string()).optional(),
        pageNumber: z.number().int().min(1).optional(),
      })
      .strict(),
    annotations: writeAnnotations,
  },
  {
    applicationName: "journal.search",
    protocolName: "journal_search",
    label: "搜索知识库笔记",
    description: "搜索当前阅读模式下保存到知识库的笔记，不读取其他模式的数据。",
    trigger: "用户询问以前记录过的单词、句子、摘录或阅读想法时调用。",
    parametersSummary: "query, limit?",
    inputSchema: z
      .object({
        query: z.string(),
        limit: z.number().int().min(1).max(30).optional(),
      })
      .strict(),
    annotations: readOnlyAnnotations,
  },
  {
    applicationName: "library.searchPapers",
    protocolName: "library_search_papers",
    label: "搜索历史文献与知识库",
    description:
      "使用用户配置的关键词、语义或混合检索，搜索历史 PDF 全文分块、文献笔记、阅读卡片和论文卡片，并返回命中文献与页码。",
    trigger:
      "用户询问另一篇文献的内容、以前读过什么、跨论文比较或寻找相关历史文献时。",
    parametersSummary: "query, limit?",
    inputSchema: z
      .object({
        query: z.string(),
        limit: z.number().int().min(1).max(30).optional(),
      })
      .strict(),
    annotations: readOnlyAnnotations,
  },
  {
    applicationName: "library.getPaper",
    protocolName: "library_get_paper",
    label: "读取历史文献记录",
    description:
      "按文献 ID 读取一篇历史 PDF 的元数据、阅读记录、论文阅读卡片和关联的片段卡片。",
    trigger: "已经从文献库搜索得到目标文献，需要查看详情时。",
    parametersSummary: "documentId",
    inputSchema: z.object({ documentId: z.string() }).strict(),
    annotations: readOnlyAnnotations,
  },
  {
    applicationName: "library.readPaper",
    protocolName: "library_read_paper",
    label: "读取历史论文原文",
    description:
      "在知识库 RAG 已定位目标文献后，通过保存的本地文件句柄或远程地址读取命中页附近原文；仅用于补齐上下文或核验精确内容。",
    trigger:
      "仅当知识库命中片段不足，或需要核对具体数字、实验设置、表格、公式、逐字原句或结论时；RAG 片段足够时不要调用。",
    parametersSummary: "documentId, query?, startPage?, endPage?, limit?",
    inputSchema: z
      .object({
        documentId: z.string(),
        query: z.string().optional(),
        startPage: z.number().int().min(1).optional(),
        endPage: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(8).optional(),
      })
      .strict(),
    annotations: readOnlyAnnotations,
  },
];

export function getAgentToolByProtocolName(
  protocolName: string,
): AgentToolDefinition | undefined {
  return AGENT_TOOL_DEFINITIONS.find(
    (tool) => tool.protocolName === protocolName,
  );
}

export function getAgentToolByApplicationName(
  applicationName: string,
): AgentToolDefinition | undefined {
  return AGENT_TOOL_DEFINITIONS.find(
    (tool) => tool.applicationName === applicationName,
  );
}

export function getAgentToolInputJsonSchema(
  tool: AgentToolDefinition,
): Record<string, unknown> {
  const { $schema: _schemaDialect, ...inputSchema } = z.toJSONSchema(
    tool.inputSchema,
    { target: "draft-7" },
  );
  return inputSchema;
}

export function getProviderAgentTools(
  applicationNames?: string[],
): Array<Record<string, unknown>> {
  const allowedNames = applicationNames
    ? new Set(applicationNames)
    : undefined;
  return AGENT_TOOL_DEFINITIONS.filter(
    (tool) => !allowedNames || allowedNames.has(tool.applicationName),
  ).map((tool) => ({
    type: "function",
    function: {
      name: tool.protocolName,
      description: tool.description,
      parameters: getAgentToolInputJsonSchema(tool),
    },
  }));
}

export function convertMcpToolsToProviderFunctions(
  tools: Array<{
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
  }>,
): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema,
    },
  }));
}

export function formatAgentToolCatalogForPrompt(): string {
  return [
    "【当前可用 Agent 工具】",
    ...AGENT_TOOL_DEFINITIONS.map((tool) =>
      [
        `- ${tool.applicationName}：${tool.description}`,
        `  参数：${tool.parametersSummary}`,
        `  调用时机：${tool.trigger}`,
      ].join("\n"),
    ),
    "这些工具由 PDFPal 在最终回答前执行。用户询问工具能力时必须依据本目录回答，不要声称工具列表为空。",
  ].join("\n");
}
