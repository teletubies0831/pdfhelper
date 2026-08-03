export interface AgentToolDefinition {
  name: string;
  apiName: string;
  label: string;
  description: string;
  trigger: string;
  parametersSummary: string;
  parameters: Record<string, unknown>;
}

export const AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: 'memory.upsert',
    apiName: 'memory_upsert',
    label: '写入长期记忆',
    description: '创建或更新用户明确要求跨会话保留的长期记忆。',
    trigger: '用户说“记住”、确认长期偏好、研究方向或持续项目目标时',
    parametersSummary: 'key, category, content, scope, confidence?, importance?',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        key: {
          type: 'string',
          description: '稳定的英文路径 key，例如 profile.education.major 或 preference.response.style。',
        },
        category: {
          type: 'string',
          enum: ['preference', 'profile', 'project', 'fact', 'correction'],
        },
        content: {
          type: 'string',
          description: '简洁、明确、可直接在未来对话中使用的中文记忆内容。',
        },
        scope: {
          type: 'string',
          enum: ['global', 'project', 'pdf'],
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        importance: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['key', 'category', 'content', 'scope'],
    },
  },
];

export function getNativeAgentTools(): Array<Record<string, unknown>> {
  return AGENT_TOOL_DEFINITIONS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.apiName,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function formatAgentToolCatalogForPrompt(): string {
  return [
    '【当前可用 Agent 工具】',
    ...AGENT_TOOL_DEFINITIONS.map((tool) => [
      `- ${tool.name}：${tool.description}`,
      `  参数：${tool.parametersSummary}`,
      `  调用时机：${tool.trigger}。`,
    ].join('\n')),
    '当用户询问你有哪些工具、能做什么或工具参数时，必须依据本目录回答；不要声称工具列表为空。',
  ].join('\n');
}
