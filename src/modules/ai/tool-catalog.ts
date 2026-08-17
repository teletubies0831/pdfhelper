export interface AgentToolDefinition {
  name: string;
  apiName: string;
  label: string;
  description: string;
  trigger: string;
  parametersSummary: string;
  parameters: Record<string, unknown>;
}

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
});

export const AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: 'document.search', apiName: 'document_search', label: '检索当前 PDF',
    description: '在当前 PDF 的本地全文索引中进行语义与关键词检索，返回相关页码和可引用原文。',
    trigger: '回答需要从整篇 PDF 中查找方法、实验、结论、术语或具体证据时。',
    parametersSummary: 'query, limit?',
    parameters: objectSchema({ query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 8 } }, ['query']),
  },
  {
    name: 'document.readPages', apiName: 'document_read_pages', label: '读取指定页',
    description: '读取当前 PDF 指定连续页的完整可提取文字，一次最多 8 页。',
    trigger: '已经知道证据页码，或需要补齐某几页的连续上下文时。',
    parametersSummary: 'startPage, endPage?',
    parameters: objectSchema({ startPage: { type: 'integer', minimum: 1 }, endPage: { type: 'integer', minimum: 1 } }, ['startPage']),
  },
  {
    name: 'document.readSection', apiName: 'document_read_section', label: '读取完整章节',
    description: '根据 PDF 目录或全文索引定位并读取一个完整章节。',
    trigger: '用户询问某一章、摘要、方法、实验、讨论或结论的整体内容时。',
    parametersSummary: 'title',
    parameters: objectSchema({ title: { type: 'string' } }, ['title']),
  },
  {
    name: 'document.getProfile', apiName: 'document_get_profile', label: '读取论文档案',
    description: '读取已生成的整篇论文结构化档案，包括问题、方法、证据、结论与局限。',
    trigger: '需要先快速掌握整篇论文，且该文档已有档案时。',
    parametersSummary: '无参数', parameters: objectSchema({}),
  },
  {
    name: 'document.getOutline', apiName: 'document_get_outline', label: '读取 PDF 目录',
    description: '读取当前 PDF 的章节目录及对应页码。',
    trigger: '需要了解论文结构、定位章节或规划后续读取时。',
    parametersSummary: '无参数', parameters: objectSchema({}),
  },
  {
    name: 'document.inspectPageImage', apiName: 'document_inspect_page_image', label: '查看 PDF 页面图像',
    description: '调用视觉模型查看某一 PDF 页面的图、表、公式或空间布局。',
    trigger: '问题依赖图表、公式截图、页面布局，文字层不足以回答时。',
    parametersSummary: 'pageNumber, question',
    parameters: objectSchema({ pageNumber: { type: 'integer', minimum: 1 }, question: { type: 'string' } }, ['pageNumber', 'question']),
  },
  {
    name: 'memory.search', apiName: 'memory_search', label: '搜索长期记忆',
    description: '按关键词搜索用户的长期偏好、个人资料、研究项目、事实和纠正记录。',
    trigger: '当前问题需要用户习惯、研究方向或跨会话信息，但已注入的记忆不充分时。',
    parametersSummary: 'query, limit?',
    parameters: objectSchema({ query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, ['query']),
  },
  {
    name: 'memory.list', apiName: 'memory_list', label: '列出长期记忆',
    description: '列出长期记忆，可按类别或作用域筛选。',
    trigger: '用户询问记住了什么，或需要核对现有长期记忆时。',
    parametersSummary: 'category?, scope?, limit?',
    parameters: objectSchema({ category: { type: 'string' }, scope: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }),
  },
  {
    name: 'memory.upsert', apiName: 'memory_upsert', label: '写入长期记忆',
    description: '创建或更新用户明确要求跨会话保留的长期记忆。',
    trigger: '用户说“记住”，或明确表达稳定偏好、研究方向、个人资料、持续项目目标时。',
    parametersSummary: 'key, category, content, scope, confidence?, importance?',
    parameters: objectSchema({
      key: { type: 'string', description: '稳定英文点分 key，例如 profile.education.major。' },
      category: { type: 'string', enum: ['preference', 'profile', 'project', 'fact', 'correction'] },
      content: { type: 'string' }, scope: { type: 'string', enum: ['global', 'project', 'pdf'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 }, importance: { type: 'number', minimum: 0, maximum: 1 },
    }, ['key', 'category', 'content', 'scope']),
  },
  {
    name: 'memory.forget', apiName: 'memory_forget', label: '删除长期记忆',
    description: '删除一条指定的长期记忆。只有用户明确要求忘记时才能调用。',
    trigger: '用户明确要求忘记或删除某条长期记忆时。',
    parametersSummary: 'id', parameters: objectSchema({ id: { type: 'string' } }, ['id']),
  },
  {
    name: 'journal.add', apiName: 'journal_add', label: '添加到知识库',
    description: '把当前对话中用户明确要求保存的单词、句子、摘录、解释或想法保存为知识库中的 Markdown 笔记。',
    trigger: '用户明确说“添加到知识库”“保存为笔记”“把这个保存下来”时调用。',
    parametersSummary: 'title, content, quote?, tags?, pageNumber?',
    parameters: objectSchema({
      title: { type: 'string' },
      content: { type: 'string', description: 'Markdown 格式的札记正文' },
      quote: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      pageNumber: { type: 'integer', minimum: 1 },
    }, ['title', 'content']),
  },
  {
    name: 'journal.search', apiName: 'journal_search', label: '搜索知识库笔记',
    description: '搜索当前阅读模式下保存到知识库的笔记，不读取其他模式的数据。',
    trigger: '用户询问以前记录过的单词、句子、摘录或阅读想法时调用。',
    parametersSummary: 'query, limit?',
    parameters: objectSchema({
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 30 },
    }, ['query']),
  },
  {
    name: 'library.searchPapers', apiName: 'library_search_papers', label: '搜索历史文献',
    description: '搜索用户以前打开或阅读过的 PDF 文献记录。',
    trigger: '用户询问以前读过什么、跨论文比较或寻找相关历史文献时。',
    parametersSummary: 'query, limit?',
    parameters: objectSchema({ query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, ['query']),
  },
  {
    name: 'library.getPaper', apiName: 'library_get_paper', label: '读取历史文献记录',
    description: '按文献 ID 读取一篇历史 PDF 的元数据、阅读记录、论文阅读卡片和关联的片段卡片。',
    trigger: '已经从文献库搜索得到目标文献，需要查看详情时。',
    parametersSummary: 'documentId', parameters: objectSchema({ documentId: { type: 'string' } }, ['documentId']),
  },
  {
    name: 'library.readPaper', apiName: 'library_read_paper', label: '读取历史论文原文',
    description: '通过历史文献记录中保存的本地文件句柄或远程地址，读取指定页或检索整篇论文原文。',
    trigger: '模型需要核对一篇历史论文的原文、具体方法、实验数据或结论，而阅读卡片信息不足时。',
    parametersSummary: 'documentId, query?, startPage?, endPage?, limit?',
    parameters: objectSchema({
      documentId: { type: 'string' },
      query: { type: 'string' },
      startPage: { type: 'integer', minimum: 1 },
      endPage: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 8 },
    }, ['documentId']),
  },
];

export function getNativeAgentTools(
  names?: string[],
): Array<Record<string, unknown>> {
  const allowedNames = names ? new Set(names) : null;
  return AGENT_TOOL_DEFINITIONS.filter((tool) => !allowedNames || allowedNames.has(tool.name)).map((tool) => ({
    type: 'function',
    function: { name: tool.apiName, description: tool.description, parameters: tool.parameters },
  }));
}

export function getAgentToolDefinitionByApiName(
  apiName: string,
): AgentToolDefinition | undefined {
  return AGENT_TOOL_DEFINITIONS.find((tool) => tool.apiName === apiName);
}

export function formatAgentToolCatalogForPrompt(): string {
  return [
    '【当前可用 Agent 工具】',
    ...AGENT_TOOL_DEFINITIONS.map((tool) => [
      `- ${tool.name}：${tool.description}`,
      `  参数：${tool.parametersSummary}`,
      `  调用时机：${tool.trigger}`,
    ].join('\n')),
    '这些工具由 PDFPal 在最终回答前执行。用户询问工具能力时必须依据本目录回答，不要声称工具列表为空。',
  ].join('\n');
}
