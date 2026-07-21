export const READING_MODE_STORAGE_KEY = 'pdf-helper-reading-modes-v1';

export type ReadingModePreference = 'auto' | 'general' | 'paper' | 'novel';
export type ResolvedReadingMode = Exclude<ReadingModePreference, 'auto'>;

export interface ReadingModeState {
  preference: ReadingModePreference;
  resolved: ResolvedReadingMode;
  source: 'default' | 'manual' | 'ai';
  rationale?: string;
  updatedAt: number;
}

export interface ReadingModeStrategy {
  id: ResolvedReadingMode;
  label: string;
  description: string;
  systemInstruction: string;
  contextInstruction(currentPage: number, totalPages?: number): string;
}

const GENERAL_STRATEGY: ReadingModeStrategy = {
  id: 'general',
  label: '通用阅读',
  description: '适合教材、报告、传记和普通外文材料',
  systemInstruction: '当前采用通用阅读模式。优先解释原文、概念和上下文关系，并区分原文事实与推断。',
  contextInstruction: (currentPage) => `当前阅读位置是第 ${currentPage} 页。回答时优先依据选区和当前页正文。`,
};

const PAPER_STRATEGY: ReadingModeStrategy = {
  id: 'paper',
  label: '论文阅读',
  description: '关注研究问题、方法、证据、实验和结论',
  systemInstruction: [
    '当前采用论文阅读模式。',
    '回答时优先识别研究问题、方法、实验设置、证据、结论和局限性。',
    '不要把作者的假设、相关工作或讨论误写成已经被实验验证的事实。',
    '能够定位时请标注页码；上下文不足时明确指出还需要方法、实验或结论部分。',
  ].join('\n'),
  contextInstruction: (currentPage) => `用户当前位于第 ${currentPage} 页；当前页可能属于论文的某一章节，可结合选区和当前页分析。`,
};

const NOVEL_STRATEGY: ReadingModeStrategy = {
  id: 'novel',
  label: '小说阅读',
  description: '关注人物、情节、关系、语言表达并默认避免剧透',
  systemInstruction: [
    '当前采用小说阅读模式。',
    '关注人物、事件、关系、场景、叙事视角和语言表达。',
    '严格避免剧透：除非用户明确允许，否则不得使用当前阅读位置之后的情节，也不要暗示未来人物身份、结局或反转。',
    '如果现有上下文不足以判断，请直接说明需要前文或更多页面，不要根据常识补写原著情节。',
  ].join('\n'),
  contextInstruction: (currentPage, totalPages) => [
    `用户当前阅读到第 ${currentPage}${totalPages ? ` / ${totalPages}` : ''} 页。`,
    `默认知识边界截止到第 ${currentPage} 页，不得引用之后的内容。`,
  ].join('\n'),
};

const STRATEGIES: Record<ResolvedReadingMode, ReadingModeStrategy> = {
  general: GENERAL_STRATEGY,
  paper: PAPER_STRATEGY,
  novel: NOVEL_STRATEGY,
};

export function getReadingModeStrategy(mode: ResolvedReadingMode): ReadingModeStrategy {
  return STRATEGIES[mode] || GENERAL_STRATEGY;
}

export function getReadingModeLabel(mode: ReadingModePreference | ResolvedReadingMode): string {
  if (mode === 'auto') return 'AI 自动识别';
  return getReadingModeStrategy(mode).label;
}

export function isResolvedReadingMode(value: unknown): value is ResolvedReadingMode {
  return value === 'general' || value === 'paper' || value === 'novel';
}

export function isReadingModePreference(value: unknown): value is ReadingModePreference {
  return value === 'auto' || isResolvedReadingMode(value);
}
