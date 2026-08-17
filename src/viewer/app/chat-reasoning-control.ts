import type { AiReasoningMode } from '../../modules/ai/public';
import {
  chatReasoningMenu,
  chatReasoningOptionButtons,
  chatReasoningTrigger,
  chatReasoningValue,
  deepSeekThinkingSelect,
} from './elements/assistant-elements';

export function syncChatReasoningControl(): void {
  const enabled = deepSeekThinkingSelect.value === 'enabled';
  const label = enabled ? '开启' : '关闭';
  chatReasoningValue.textContent = label;
  chatReasoningTrigger.classList.toggle('is-enabled', enabled);
  chatReasoningTrigger.setAttribute('aria-label', `思考模式：${label}`);
  for (const button of chatReasoningOptionButtons) {
    const selected = button.dataset.chatReasoningValue === deepSeekThinkingSelect.value;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-selected', String(selected));
  }
}

export function setChatReasoningMenuOpen(open: boolean): void {
  chatReasoningMenu.hidden = !open;
  chatReasoningTrigger.classList.toggle('open', open);
  chatReasoningTrigger.setAttribute('aria-expanded', String(open));
}

export function selectChatReasoningMode(mode: AiReasoningMode): void {
  const changed = deepSeekThinkingSelect.value !== mode;
  deepSeekThinkingSelect.value = mode;
  syncChatReasoningControl();
  setChatReasoningMenuOpen(false);
  if (changed) {
    deepSeekThinkingSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
