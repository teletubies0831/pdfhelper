import { normalizeConnectionModels, type AiConnectionCapability } from '../../../modules/ai/public';
import {
  settingsAvailableModelCount,
  settingsAvailableModelResults,
  testSelectedModelsButton,
} from '../../app/viewer-elements';

export interface AvailableModelVerification {
  model: string;
  capabilities: AiConnectionCapability[];
}

let availableModels: string[] = [];
let selectedModels = new Set<string>();
let verifiedCapabilities: Record<string, AiConnectionCapability[]> = {};

function render(): void {
  settingsAvailableModelResults.replaceChildren();
  settingsAvailableModelCount.textContent = `${selectedModels.size} 个已选`;
  testSelectedModelsButton.disabled = selectedModels.size === 0;
  if (availableModels.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'settings-model-results-empty';
    empty.textContent = '请先点击“获取模型列表”';
    settingsAvailableModelResults.append(empty);
    return;
  }

  for (const model of availableModels) {
    const label = document.createElement('label');
    label.className = 'settings-available-model-choice';
    const name = document.createElement('span');
    name.textContent = model;
    name.title = model;
    const choice = document.createElement('span');
    const capabilities = verifiedCapabilities[model] ?? [];
    const state = document.createElement('span');
    state.textContent = capabilities.length
      ? `已验证：${capabilities.map((item) => item === 'vision' ? '视觉' : '文本').join('、')}`
      : '未验证';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedModels.has(model);
    checkbox.setAttribute('aria-label', `选择测试 ${model}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedModels.add(model);
      else selectedModels.delete(model);
      settingsAvailableModelCount.textContent = `${selectedModels.size} 个已选`;
      testSelectedModelsButton.disabled = selectedModels.size === 0;
    });
    choice.append(state, checkbox);
    label.append(name, choice);
    settingsAvailableModelResults.append(label);
  }
}

function verificationMap(models: readonly AvailableModelVerification[]): Record<string, AiConnectionCapability[]> {
  return Object.fromEntries(models.map((item) => [item.model, [...item.capabilities]]));
}

export function showAvailableModels(
  models: readonly string[],
  verifiedModels: readonly AvailableModelVerification[],
): void {
  availableModels = normalizeConnectionModels(models);
  selectedModels = new Set();
  verifiedCapabilities = verificationMap(verifiedModels);
  render();
}

export function addAvailableModel(
  modelValue: string,
  verifiedModels: readonly AvailableModelVerification[],
): boolean {
  const model = modelValue.trim();
  if (!model) return false;
  availableModels = normalizeConnectionModels([...availableModels, model]);
  selectedModels.add(model);
  verifiedCapabilities = verificationMap(verifiedModels);
  render();
  return true;
}

export function updateAvailableModelVerification(
  verifiedModels: readonly AvailableModelVerification[],
): void {
  verifiedCapabilities = verificationMap(verifiedModels);
  render();
}

export function readSelectedAvailableModels(): string[] {
  return availableModels.filter((model) => selectedModels.has(model));
}

export function hasSelectedAvailableModels(): boolean {
  return selectedModels.size > 0;
}

export function clearAvailableModels(): void {
  availableModels = [];
  selectedModels = new Set();
  verifiedCapabilities = {};
  render();
}
