import { browser } from 'wxt/browser';
import {
  AI_PROVIDERS,
  AI_VISION_TEST_MARKER,
  normalizeConnectionModels,
  redactConnectionTestText,
  type AiConnectionCapability,
  type AiProviderId,
  type AiRuntimeResponse,
} from '../../../modules/ai/public';
import {
  aiProviderSelect,
  deepSeekApiKeyInput,
  deepSeekBaseUrlInput,
  saveDeepSeekSettingsButton,
  testDeepSeekButton,
  testSelectedModelsButton,
} from '../../app/viewer-elements';
import {
  readSelectedAvailableModels,
  showAvailableModels,
  updateAvailableModelVerification,
} from './connection-model-selection';
import {
  appendConnectionTestResult,
  clearConnectionTestResults,
  readConnectionTestPreferences,
} from './connection-test-preferences';
import {
  markSettingsConnectionModelsVerified,
  readSettingsConnectionVerifiedModels,
  showSettingsStatus,
  type SettingsConnectionVerifiedModel,
} from './settings-navigation';

interface ConnectionTestContext {
  providerId: AiProviderId;
  apiKey: string;
  baseUrl: string;
}

function readConnectionContext(): ConnectionTestContext | undefined {
  const providerId = aiProviderSelect.value as AiProviderId;
  const provider = AI_PROVIDERS.find((item) => item.id === providerId && item.available);
  if (!provider) {
    showSettingsStatus('请先选择已支持的接口类型。', 'error');
    return undefined;
  }
  const apiKey = deepSeekApiKeyInput.value.trim();
  const baseUrl = deepSeekBaseUrlInput.value.trim() || provider.defaultBaseUrl || '';
  if (!apiKey || !baseUrl) {
    showSettingsStatus('请先填写 API Key 和 API 地址。', 'error');
    return undefined;
  }
  return { providerId, apiKey, baseUrl };
}

function connectionIdentity(): string {
  return JSON.stringify([
    aiProviderSelect.value,
    deepSeekApiKeyInput.value.trim(),
    deepSeekBaseUrlInput.value.trim(),
  ]);
}

function mergeVerifiedModels(
  existing: readonly SettingsConnectionVerifiedModel[],
  additions: readonly SettingsConnectionVerifiedModel[],
): SettingsConnectionVerifiedModel[] {
  const merged = new Map<string, Set<AiConnectionCapability>>();
  for (const item of [...existing, ...additions]) {
    const capabilities = merged.get(item.model) ?? new Set<AiConnectionCapability>();
    item.capabilities.forEach((capability) => capabilities.add(capability));
    merged.set(item.model, capabilities);
  }
  return Array.from(merged, ([model, capabilities]) => ({
    model,
    capabilities: Array.from(capabilities),
  }));
}

function beginOperation(button: HTMLButtonElement): {
  owns: () => boolean;
  isCurrent: () => boolean;
} {
  const operationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const identity = connectionIdentity();
  button.dataset.testRunId = operationId;
  testDeepSeekButton.disabled = true;
  testSelectedModelsButton.disabled = true;
  saveDeepSeekSettingsButton.disabled = true;
  const owns = (): boolean => button.dataset.testRunId === operationId;
  return { owns, isCurrent: () => owns() && connectionIdentity() === identity };
}

function finishOperation(
  button: HTMLButtonElement,
  operation: ReturnType<typeof beginOperation>,
): void {
  if (!operation.owns()) return;
  const connectionWasChanged = !operation.isCurrent();
  delete button.dataset.testRunId;
  testDeepSeekButton.disabled = false;
  testSelectedModelsButton.disabled = readSelectedAvailableModels().length === 0;
  saveDeepSeekSettingsButton.disabled = false;
  if (connectionWasChanged) showSettingsStatus('连接信息已修改，请重新获取模型列表。', 'error');
}

export async function discoverDeepSeekModels(): Promise<boolean> {
  if (testDeepSeekButton.disabled) return false;
  const context = readConnectionContext();
  if (!context) return false;
  const verifiedModels = readSettingsConnectionVerifiedModels();
  const operation = beginOperation(testDeepSeekButton);
  clearConnectionTestResults();
  showSettingsStatus('正在获取模型列表…', 'progress');
  try {
    const response = await browser.runtime.sendMessage({
      type: 'pdf-helper:ai-test',
      mode: 'discover',
      config: { ...context, model: verifiedModels[0]?.model ?? '' },
    }) as AiRuntimeResponse;
    if (!response?.ok) throw new Error(response?.error || '扩展后台没有返回模型列表。');
    if (!operation.isCurrent()) return false;
    const models = normalizeConnectionModels([
      ...(response.models ?? []),
      ...verifiedModels.map((item) => item.model),
    ]);
    if (models.length === 0) throw new Error('接口没有返回模型列表，可在下方手动加入 Model ID。');
    showAvailableModels(models, verifiedModels);
    showSettingsStatus(`已获取 ${models.length} 个模型。请勾选本次需要测试的模型。`, 'success');
    return true;
  } catch (error) {
    if (operation.isCurrent()) {
      const message = error instanceof Error ? error.message : String(error);
      appendConnectionTestResult('模型列表', '获取', false, message, context.apiKey);
      showSettingsStatus(redactConnectionTestText(message, context.apiKey), 'error');
    }
    return false;
  } finally {
    finishOperation(testDeepSeekButton, operation);
  }
}

export async function testDeepSeekConnection(): Promise<boolean> {
  if (testSelectedModelsButton.disabled) return false;
  const context = readConnectionContext();
  if (!context) return false;
  const candidates = readSelectedAvailableModels();
  if (candidates.length === 0) {
    showSettingsStatus('请先在“可测试模型”中勾选至少一个模型。', 'error');
    return false;
  }
  const testSettings = readConnectionTestPreferences();
  const operation = beginOperation(testSelectedModelsButton);
  const existingVerifiedModels = readSettingsConnectionVerifiedModels();
  clearConnectionTestResults();
  const capabilities: AiConnectionCapability[] = ['text', 'vision'];
  const tasks = candidates.flatMap((model) => capabilities.map((capability) => ({ model, capability })));
  showSettingsStatus(`正在验证 0/${tasks.length} 项能力（并发 ${testSettings.concurrency}）…`, 'progress');
  const imageDataUrl = createVisionTestImage();
  const results: Array<({ model: string; capability: AiConnectionCapability; ok: boolean; error?: string }) | undefined>
    = new Array(tasks.length);
  let nextTaskIndex = 0;
  let completedCount = 0;

  const validateNext = async (): Promise<void> => {
    while (operation.isCurrent() && nextTaskIndex < tasks.length) {
      const taskIndex = nextTaskIndex++;
      const task = tasks[taskIndex];
      if (!task) return;
      let response: AiRuntimeResponse;
      try {
        response = await browser.runtime.sendMessage({
          type: 'pdf-helper:ai-test',
          mode: 'validate',
          testSettings,
          config: { ...context, model: task.model, capabilities: [task.capability] },
          imageDataUrl: task.capability === 'vision' ? imageDataUrl : undefined,
        }) as AiRuntimeResponse;
      } catch (error) {
        response = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      results[taskIndex] = response?.ok
        ? { ...task, ok: true }
        : { ...task, ok: false, error: response?.error || '扩展后台没有返回测试结果。' };
      completedCount += 1;
      if (operation.isCurrent()) {
        appendConnectionTestResult(
          task.model,
          task.capability === 'text' ? '文本' : '视觉',
          Boolean(response?.ok),
          response?.ok ? response.content || '验证通过。' : response?.error || '扩展后台没有返回测试结果。',
          context.apiKey,
        );
        showSettingsStatus(
          `正在验证 ${completedCount}/${tasks.length} 项能力（并发 ${testSettings.concurrency}）…`,
          'progress',
        );
      }
    }
  };

  try {
    const workerCount = Math.min(testSettings.concurrency, tasks.length);
    await Promise.all(Array.from({ length: workerCount }, validateNext));
    if (!operation.isCurrent()) return false;
    const completed = results.filter((item): item is NonNullable<typeof item> => Boolean(item));
    const newlyVerified = candidates.flatMap((model) => {
      const passed = capabilities.filter((capability) => completed.some(
        (item) => item.model === model && item.capability === capability && item.ok,
      ));
      return passed.length ? [{ model, capabilities: passed }] : [];
    });
    if (newlyVerified.length === 0) {
      showSettingsStatus(`已测试 ${candidates.length} 个选中模型，但没有新增通过的模型。请查看具体原因。`, 'error');
      return false;
    }
    const merged = mergeVerifiedModels(existingVerifiedModels, newlyVerified);
    markSettingsConnectionModelsVerified(merged);
    updateAvailableModelVerification(merged);
    const addedCount = merged.length - existingVerifiedModels.length;
    showSettingsStatus(
      `测试完成：${newlyVerified.length} 个选中模型通过；${addedCount > 0 ? `新增 ${addedCount} 个` : '已更新验证结果'}。`,
      'success',
    );
    return true;
  } finally {
    finishOperation(testSelectedModelsButton, operation);
  }
}

export function createVisionTestImage(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#cbd5e1';
  context.lineWidth = 4;
  context.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
  context.fillStyle = '#0f172a';
  context.font = '700 64px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(AI_VISION_TEST_MARKER, canvas.width / 2, canvas.height / 2);
  return canvas.toDataURL('image/png');
}
