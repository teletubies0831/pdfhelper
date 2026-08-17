import { AGENT_TOOL_DEFINITIONS, type AgentToolDefinition } from '../../../modules/ai/public';

import {
  settingsAgentToolCatalog,
  settingsAgentToolCount,
} from '../../app/viewer-elements';

interface AgentToolGroupPresentation {
  prefix: string;
  title: string;
  description: string;
  iconPath?: string;
  iconSymbol?: string;
  tone: string;
}

const AGENT_TOOL_GROUPS: AgentToolGroupPresentation[] = [
  {
    prefix: 'document.',
    title: '当前 PDF',
    description: '检索、阅读章节并查看页面图像',
    iconPath: '/resources/ai-settings/pdf.svg',
    tone: 'pdf',
  },
  {
    prefix: 'memory.',
    title: '长期记忆',
    description: '搜索、查看、写入和删除跨会话记忆',
    iconPath: '/resources/ai-settings/memory.svg',
    tone: 'memory',
  },
  {
    prefix: 'journal.',
    title: '知识库',
    description: '保存和搜索阅读笔记',
    iconSymbol: 'toolbar-icon-knowledge',
    tone: 'knowledge',
  },
  {
    prefix: 'library.',
    title: '历史文献',
    description: '搜索记录并读取历史论文原文',
    iconPath: '/resources/ai-settings/literature.svg',
    tone: 'library',
  },
];

function createGroupIcon(group: AgentToolGroupPresentation): HTMLElement {
  const icon = document.createElement('span');
  icon.className = `settings-tool-icon ${group.tone}`;
  icon.setAttribute('aria-hidden', 'true');
  if (group.iconPath) {
    const image = document.createElement('img');
    image.src = group.iconPath;
    image.alt = '';
    icon.append(image);
    return icon;
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/resources/icons.svg#${group.iconSymbol}`);
  svg.append(use);
  icon.append(svg);
  return icon;
}

function createToolChip(tool: AgentToolDefinition): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'settings-tool-chip';
  chip.textContent = tool.label;
  chip.title = tool.description;
  return chip;
}

export function renderAgentToolCatalog(): void {
  settingsAgentToolCount.textContent = String(AGENT_TOOL_DEFINITIONS.length);
  settingsAgentToolCatalog.replaceChildren();

  for (const group of AGENT_TOOL_GROUPS) {
    const tools = AGENT_TOOL_DEFINITIONS.filter((tool) => tool.name.startsWith(group.prefix));
    if (tools.length === 0) continue;

    const card = document.createElement('article');
    card.className = 'settings-tool-card';

    const header = document.createElement('header');
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = group.title;
    const description = document.createElement('small');
    description.textContent = group.description;
    copy.append(title, description);

    const count = document.createElement('span');
    count.className = 'settings-tool-count';
    count.textContent = `${tools.length} 个`;
    header.append(createGroupIcon(group), copy, count);

    const chips = document.createElement('div');
    chips.className = 'settings-tool-chips';
    chips.append(...tools.map(createToolChip));

    card.append(header, chips);
    settingsAgentToolCatalog.append(card);
  }
}
