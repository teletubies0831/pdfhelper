import { browser } from 'wxt/browser';
import {
  AI_CONNECTION_TEST_SETTINGS_KEY,
  explainConnectionTestError,
  normalizeConnectionTestSettings,
  redactConnectionTestText,
  type ConnectionTestSettings,
} from '../../../modules/ai/public';
import { requiredElement } from '../../app/elements/required-element';

const tokensInput = requiredElement<HTMLInputElement>('connection-test-max-output-tokens');
const concurrencyInput = requiredElement<HTMLSelectElement>('connection-test-concurrency');
const resultsElement = requiredElement<HTMLElement>('connection-test-results');

export function readConnectionTestPreferences(): ConnectionTestSettings {
  return normalizeConnectionTestSettings({
    maxOutputTokens: tokensInput.value,
    concurrency: concurrencyInput.value,
  });
}

function populate(preferences: ConnectionTestSettings): void {
  tokensInput.value = String(preferences.maxOutputTokens);
  concurrencyInput.value = String(preferences.concurrency);
}

export async function loadConnectionTestPreferences(): Promise<void> {
  const stored = await browser.storage.local.get(AI_CONNECTION_TEST_SETTINGS_KEY);
  populate(normalizeConnectionTestSettings(stored[AI_CONNECTION_TEST_SETTINGS_KEY]));
}

export async function saveConnectionTestPreferences(): Promise<void> {
  const preferences = readConnectionTestPreferences();
  await browser.storage.local.set({ [AI_CONNECTION_TEST_SETTINGS_KEY]: preferences });
  populate(preferences);
}

export function clearConnectionTestResults(): void {
  resultsElement.replaceChildren();
  resultsElement.hidden = true;
}

export function appendConnectionTestResult(
  model: string,
  capability: string,
  ok: boolean,
  detail: string,
  apiKey: string,
): void {
  resultsElement.hidden = false;
  const row = document.createElement('details');
  row.className = 'settings-test-result';
  row.open = !ok;
  const summary = document.createElement('summary');
  summary.textContent = redactConnectionTestText(
    `${model} · ${capability} · ${ok ? '通过' : '未通过'}`, apiKey,
  );
  const body = document.createElement('p');
  body.style.whiteSpace = 'pre-wrap';
  body.style.overflowWrap = 'anywhere';
  body.textContent = redactConnectionTestText(ok ? detail : explainConnectionTestError(detail), apiKey);
  row.append(summary, body);
  resultsElement.append(row);
}
