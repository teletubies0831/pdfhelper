export const SELECTION_STORAGE_KEY = 'pdfHelperSelection';

export type SelectionAction = 'explain' | 'translate' | 'card';

export interface SelectionRequest {
  id: string;
  action: SelectionAction;
  text: string;
  pageUrl?: string;
  pageTitle?: string;
  createdAt: number;
}

export const ACTION_LABELS: Record<SelectionAction, string> = {
  explain: '解释这段内容',
  translate: '翻译成中文',
  card: '加入知识卡片',
};

export function isSelectionAction(value: unknown): value is SelectionAction {
  return value === 'explain' || value === 'translate' || value === 'card';
}
