import type { AiReasoningMode } from '../../modules/ai/public';
import {
  chatReasoningTrigger,
  deepSeekThinkingSelect,
} from './elements/assistant-elements';

/**
 * The reasoning switch beside the chat composer.
 *
 * It used to be a two-item dropdown ("关闭 / 开启"), which meant two clicks and a panel to change a boolean
 * and a state label to read the value. The state is a colour now — blue means on — so the control is a plain
 * toggle, the way the DeepSeek web app does it. The value still lives in `#deepseek-thinking`, which is what
 * the rest of the app reads; this button only flips it.
 */

export function syncChatReasoningControl(): void {
  const enabled = deepSeekThinkingSelect.value === 'enabled';
  chatReasoningTrigger.classList.toggle('is-on', enabled);
  chatReasoningTrigger.setAttribute('aria-pressed', String(enabled));
  // Colour alone is not a state for a screen reader, so the wording lives here and in the tooltip.
  chatReasoningTrigger.title = `思考模式：${enabled ? '开启' : '关闭'}（点击切换）`;
}

export function selectChatReasoningMode(mode: AiReasoningMode): void {
  const changed = deepSeekThinkingSelect.value !== mode;
  deepSeekThinkingSelect.value = mode;
  syncChatReasoningControl();
  if (changed) {
    deepSeekThinkingSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

export function toggleChatReasoning(): void {
  selectChatReasoningMode(
    deepSeekThinkingSelect.value === 'enabled' ? 'disabled' : 'enabled',
  );
}
