import {
  AI_PROVIDERS,
  aiConnectionCatalog,
  type AiConnectionCapability,
  type AiConnectionCatalogState,
  type AiConnectionRecord,
  type AiModelRoute,
  type AiProviderId,
  type AiTaskRouteId,
} from '../../../modules/ai/public';
import {
  aiProviderSelect,
  deepSeekApiKeyInput,
  deepSeekBaseUrlInput,
  deepSeekModelSelect,
  deepSeekSettingsStatus,
  longTermMemoryList,
  longTermMemorySearchInput,
  saveDeepSeekSettingsButton,
  settingsConnectionCapabilitySelect,
  settingsConnectionDeleteButton,
  settingsConnectionGrid,
  settingsConnectionManualModelInput,
  settingsConnectionModelCount,
  settingsConnectionModelResults,
  settingsConnectionModelsInput,
  settingsConnectionNameInput,
  settingsConnectionEditor,
  settingsConnectionTitle,
  settingsFooterNote,
  settingsModelNavigation,
  settingsModelOverview,
  settingsPages,
  settingsPrimaryPanels,
  settingsPrimaryTabButtons,
  testDeepSeekButton,
  testVisionAiButton,
  translationModelSelect,
  visionRouteSummary,
} from '../../app/viewer-elements';

export type SettingsTab = 'models' | 'tools' | 'memory';

let activeSettingsTab: SettingsTab = 'models';
type SettingsModelScreen = 'overview' | 'editor';

let activeSettingsModelScreen: SettingsModelScreen = 'overview';
let activeConnectionId: string | null = null;
let addingConnection = false;
let catalogState: AiConnectionCatalogState | null = null;
let verifiedConnectionDraft: string | null = null;
let verifiedConnectionModelCapabilities: Record<string, AiConnectionCapability[]> = {};
let settingsModelTransitionToken = 0;
let settingsModelAnimations: Animation[] = [];
let settingsStatusDismissTimer: number | undefined;
let settingsStatusClearTimer: number | undefined;

export type SettingsStatusKind = 'progress' | 'success' | 'info' | 'error';

const SETTINGS_STATUS_DISMISS_DELAY: Partial<Record<SettingsStatusKind, number>> = {
  success: 5000,
  info: 8000,
};
const SETTINGS_STATUS_FADE_DURATION = 180;

function cancelSettingsStatusTimers(): void {
  if (settingsStatusDismissTimer !== undefined) {
    window.clearTimeout(settingsStatusDismissTimer);
    settingsStatusDismissTimer = undefined;
  }
  if (settingsStatusClearTimer !== undefined) {
    window.clearTimeout(settingsStatusClearTimer);
    settingsStatusClearTimer = undefined;
  }
}

export function clearSettingsStatus(): void {
  cancelSettingsStatusTimers();
  deepSeekSettingsStatus.textContent = '';
  deepSeekSettingsStatus.classList.remove('error', 'is-dismissing');
  delete deepSeekSettingsStatus.dataset.statusKind;
}

export function showSettingsStatus(message: string, kind: SettingsStatusKind): void {
  cancelSettingsStatusTimers();
  deepSeekSettingsStatus.classList.remove('error', 'is-dismissing');
  deepSeekSettingsStatus.classList.toggle('error', kind === 'error');
  deepSeekSettingsStatus.dataset.statusKind = kind;
  deepSeekSettingsStatus.textContent = message;

  const dismissDelay = SETTINGS_STATUS_DISMISS_DELAY[kind];
  if (dismissDelay === undefined) return;
  settingsStatusDismissTimer = window.setTimeout(() => {
    settingsStatusDismissTimer = undefined;
    deepSeekSettingsStatus.classList.add('is-dismissing');
    settingsStatusClearTimer = window.setTimeout(() => {
      settingsStatusClearTimer = undefined;
      clearSettingsStatus();
    }, SETTINGS_STATUS_FADE_DURATION);
  }, dismissDelay);
}

export function cancelSettingsConnectionActivity(): void {
  delete testDeepSeekButton.dataset.testRunId;
  testDeepSeekButton.disabled = false;
  saveDeepSeekSettingsButton.disabled = false;
  clearSettingsStatus();
}

function modelScreenElement(screen: SettingsModelScreen): HTMLElement {
  return screen === 'overview' ? settingsModelOverview : settingsConnectionEditor;
}

function cancelSettingsModelTransition(): void {
  settingsModelTransitionToken += 1;
  for (const animation of settingsModelAnimations) animation.cancel();
  settingsModelAnimations = [];
  settingsModelNavigation.classList.remove('is-transitioning');
  settingsModelNavigation.style.removeProperty('height');
}

function setSettingsModelScreenImmediately(screen: SettingsModelScreen): void {
  cancelSettingsModelTransition();
  activeSettingsModelScreen = screen;
  const visible = modelScreenElement(screen);
  const hidden = modelScreenElement(screen === 'overview' ? 'editor' : 'overview');
  visible.hidden = false;
  visible.inert = false;
  visible.removeAttribute('aria-hidden');
  hidden.hidden = true;
  hidden.inert = true;
  hidden.setAttribute('aria-hidden', 'true');
}

async function transitionSettingsModelScreen(screen: SettingsModelScreen): Promise<void> {
  if (screen === activeSettingsModelScreen) {
    setSettingsModelScreenImmediately(screen);
    settingsPages.scrollTop = 0;
    return;
  }

  const outgoingScreen = activeSettingsModelScreen;
  cancelSettingsModelTransition();
  const transitionToken = ++settingsModelTransitionToken;
  activeSettingsModelScreen = screen;
  const outgoing = modelScreenElement(outgoingScreen);
  const incoming = modelScreenElement(screen);
  const forward = screen === 'editor';
  settingsPages.scrollTop = 0;

  outgoing.hidden = false;
  incoming.hidden = false;
  outgoing.inert = true;
  incoming.inert = false;
  outgoing.setAttribute('aria-hidden', 'true');
  incoming.removeAttribute('aria-hidden');

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setSettingsModelScreenImmediately(screen);
    return;
  }

  const outgoingHeight = outgoing.getBoundingClientRect().height;
  const incomingHeight = incoming.getBoundingClientRect().height;
  settingsModelNavigation.style.height = `${outgoingHeight}px`;
  settingsModelNavigation.classList.add('is-transitioning');

  const timing: KeyframeAnimationOptions = {
    duration: 300,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'both',
  };
  const outgoingAnimation = outgoing.animate([
    { transform: 'translate3d(0, 0, 0) rotateY(0deg)', opacity: 1 },
    {
      transform: forward
        ? 'translate3d(-100%, 0, 0) rotateY(1.5deg)'
        : 'translate3d(100%, 0, 0) rotateY(-1.5deg)',
      opacity: 0,
    },
  ], timing);
  const incomingAnimation = incoming.animate([
    {
      transform: forward
        ? 'translate3d(100%, 0, 0) rotateY(-2deg)'
        : 'translate3d(-100%, 0, 0) rotateY(2deg)',
      opacity: 0.9,
      boxShadow: forward
        ? '-18px 0 32px rgb(15 23 42 / 10%)'
        : '18px 0 32px rgb(15 23 42 / 10%)',
    },
    {
      transform: 'translate3d(0, 0, 0) rotateY(0deg)',
      opacity: 1,
      boxShadow: '0 0 0 rgb(15 23 42 / 0%)',
    },
  ], timing);
  const heightAnimation = settingsModelNavigation.animate([
    { height: `${outgoingHeight}px` },
    { height: `${incomingHeight}px` },
  ], timing);
  settingsModelAnimations = [outgoingAnimation, incomingAnimation, heightAnimation];

  await Promise.allSettled(settingsModelAnimations.map((animation) => animation.finished));
  if (transitionToken !== settingsModelTransitionToken) return;
  outgoing.hidden = true;
  incoming.hidden = false;
  const completedAnimations = settingsModelAnimations;
  settingsModelAnimations = [];
  for (const animation of completedAnimations) animation.cancel();
  settingsModelNavigation.classList.remove('is-transitioning');
  settingsModelNavigation.style.removeProperty('height');
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `•••••••• ${trimmed.slice(-4)}` : '尚未配置密钥';
}

export function readSettingsConnectionCapabilities(): AiConnectionCapability[] {
  return Array.from(new Set(Object.values(verifiedConnectionModelCapabilities).flat()));
}

function readDraftModels(): string[] {
  return Array.from(new Set(settingsConnectionModelsInput.value
    .split(/[\n,，]+/)
    .map((model) => model.trim())
    .filter(Boolean)));
}

function fingerprintModelCapabilities(
  models: readonly string[],
  modelCapabilities: Record<string, AiConnectionCapability[]>,
): Record<string, AiConnectionCapability[]> {
  return Object.fromEntries(models.map((model) => [
    model,
    [...(modelCapabilities[model] ?? [])].sort(),
  ]));
}

function connectionDraftFingerprint(
  models: string[] = readDraftModels(),
  modelCapabilities = verifiedConnectionModelCapabilities,
): string {
  return JSON.stringify({
    providerId: aiProviderSelect.value,
    apiKey: deepSeekApiKeyInput.value.trim(),
    baseUrl: deepSeekBaseUrlInput.value.trim().replace(/\/+$/, ''),
    models,
    modelCapabilities: fingerprintModelCapabilities(models, modelCapabilities),
  });
}

export interface SettingsConnectionVerifiedModel {
  model: string;
  capabilities: AiConnectionCapability[];
}

function renderConnectionModelResults(): void {
  const models = readDraftModels();
  settingsConnectionModelResults.replaceChildren();
  settingsConnectionModelCount.textContent = `${models.length} 个`;
  if (models.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'settings-model-results-empty';
    empty.textContent = '尚未测试连接';
    settingsConnectionModelResults.append(empty);
    return;
  }

  for (const model of models) {
    const row = document.createElement('div');
    row.className = 'settings-model-result';
    const name = document.createElement('span');
    name.className = 'settings-model-result-name';
    name.textContent = model;
    name.title = model;
    const badges = document.createElement('span');
    badges.className = 'settings-model-capabilities';
    const capabilities = verifiedConnectionModelCapabilities[model] ?? [];
    if (capabilities.length === 0) {
      const pending = document.createElement('span');
      pending.className = 'settings-model-capability pending';
      pending.textContent = '待测试';
      badges.append(pending);
    } else {
      for (const capability of capabilities) {
        const badge = document.createElement('span');
        badge.className = 'settings-model-capability';
        badge.textContent = capability === 'vision' ? '视觉' : '文本';
        badges.append(badge);
      }
    }
    row.append(name, badges);
    settingsConnectionModelResults.append(row);
  }
}

export function queueSettingsConnectionModelForValidation(modelValue: string): boolean {
  const model = modelValue.trim();
  if (!model) return false;
  const models = readDraftModels();
  if (!models.includes(model)) models.push(model);
  settingsConnectionModelsInput.value = models.join('\n');
  verifiedConnectionDraft = null;
  renderConnectionModelResults();
  return true;
}

export function markSettingsConnectionModelsVerified(
  verifiedModels: SettingsConnectionVerifiedModel[],
): void {
  const models = verifiedModels.map((item) => item.model);
  settingsConnectionModelsInput.value = models.join('\n');
  verifiedConnectionModelCapabilities = Object.fromEntries(verifiedModels.map((item) => [
    item.model,
    Array.from(new Set(item.capabilities)),
  ]));
  verifiedConnectionDraft = connectionDraftFingerprint(models, verifiedConnectionModelCapabilities);
  renderConnectionModelResults();
}

function routeValue(route: AiModelRoute): string {
  return JSON.stringify([route.connectionId, route.model]);
}

export function readModelRoute(value: string): AiModelRoute | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
    const [connectionId, model] = parsed;
    return typeof connectionId === 'string' && typeof model === 'string'
      ? { connectionId, model }
      : undefined;
  } catch {
    return undefined;
  }
}

const CONNECTION_MARK_COLORS = [
  { background: '#e8f1ff', foreground: '#2468df' },
  { background: '#eee9ff', foreground: '#7047d8' },
  { background: '#e5f6ee', foreground: '#23845a' },
  { background: '#fff1df', foreground: '#b66a12' },
  { background: '#ffe9ef', foreground: '#c6426e' },
  { background: '#e5f6f7', foreground: '#167b83' },
] as const;

function connectionMarkColor(connection: AiConnectionRecord): typeof CONNECTION_MARK_COLORS[number] {
  const source = connection.id || connection.name;
  let hash = 0;
  for (const character of source) {
    hash = ((hash * 31) + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return CONNECTION_MARK_COLORS[hash % CONNECTION_MARK_COLORS.length]!;
}

function renderConnectionCards(): void {
  settingsConnectionGrid.replaceChildren();
  const connections = catalogState?.connections ?? [];
  if (connections.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'settings-connection-empty';
    empty.textContent = '还没有供应商连接，点击“添加供应商”开始配置。';
    settingsConnectionGrid.append(empty);
    return;
  }

  for (const connection of connections) {
    const card = document.createElement('article');
    card.className = 'settings-connection-card';

    const main = document.createElement('div');
    main.className = 'settings-connection-main';
    const mark = document.createElement('span');
    mark.className = 'settings-provider-mark';
    const markColor = connectionMarkColor(connection);
    mark.style.backgroundColor = markColor.background;
    mark.style.color = markColor.foreground;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '/resources/icons.svg#toolbar-icon-ai');
    icon.append(use);
    mark.append(icon);
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = connection.name;
    const secret = document.createElement('small');
    secret.textContent = maskSecret(connection.apiKey);
    copy.append(name, secret);
    main.append(mark, copy);

    const state = document.createElement('span');
    state.className = 'settings-connection-state configured';
    state.textContent = connection.capabilities
      .map((item) => item === 'text' ? '文本' : '视觉')
      .join(' + ');
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.dataset.editConnectionId = connection.id;
    edit.textContent = '编辑连接';
    card.append(main, state, edit);
    settingsConnectionGrid.append(card);
  }
}

function populateRouteSelect(
  select: HTMLSelectElement,
  capability: AiConnectionCapability,
  route: AiModelRoute | undefined,
): void {
  select.replaceChildren();
  const connections = (catalogState?.connections ?? [])
    .filter((connection) => connection.capabilities.includes(capability));
  for (const connection of connections) {
    const group = document.createElement('optgroup');
    group.label = connection.name;
    for (const model of connection.models.filter(
      (item) => connection.modelCapabilities[item]?.includes(capability),
    )) {
      const option = document.createElement('option');
      option.value = routeValue({ connectionId: connection.id, model });
      option.textContent = `${connection.name} · ${model}`;
      group.append(option);
    }
    select.append(group);
  }
  if (select.options.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = capability === 'text'
      ? '请先添加文本模型连接'
      : '请先添加视觉模型连接';
    select.append(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  const selected = route ? routeValue(route) : '';
  select.value = Array.from(select.options).some((option) => option.value === selected)
    ? selected
    : select.options.item(0)?.value ?? '';
}

function renderTaskRoutes(): void {
  populateRouteSelect(deepSeekModelSelect, 'text', catalogState?.routes.chat);
  populateRouteSelect(translationModelSelect, 'text', catalogState?.routes.translation);
  populateRouteSelect(visionRouteSummary, 'vision', catalogState?.routes.vision);
}

export async function loadSettingsConnectionCatalog(): Promise<AiConnectionCatalogState> {
  catalogState = await aiConnectionCatalog.load();
  renderConnectionCards();
  renderTaskRoutes();
  return catalogState;
}

export function getSettingsConnectionCatalog(): AiConnectionCatalogState | null {
  return catalogState;
}

export function updateSettingsConnectionSummaries(): void {
  renderConnectionCards();
  renderTaskRoutes();
}

function clearConnectionEditor(): void {
  activeConnectionId = null;
  verifiedConnectionDraft = null;
  verifiedConnectionModelCapabilities = {};
  settingsConnectionNameInput.value = '';
  settingsConnectionCapabilitySelect.value = 'both';
  aiProviderSelect.value = 'openai-compatible';
  deepSeekApiKeyInput.value = '';
  deepSeekBaseUrlInput.value = '';
  settingsConnectionModelsInput.value = '';
  settingsConnectionManualModelInput.value = '';
  renderConnectionModelResults();
  settingsConnectionDeleteButton.hidden = true;
  cancelSettingsConnectionActivity();
}

function updateSettingsFooter(): void {
  const editingConnection = activeSettingsTab === 'models' && (addingConnection || activeConnectionId);
  testDeepSeekButton.hidden = !editingConnection;
  testVisionAiButton.hidden = true;
  saveDeepSeekSettingsButton.textContent = editingConnection ? '保存连接' : '保存配置';

  if (editingConnection) {
    settingsFooterNote.textContent = '连接会统一保存在当前浏览器中，保存后可分配给不同任务。';
  } else if (activeSettingsTab === 'tools') {
    settingsFooterNote.textContent = '工具只会在回答需要时调用，执行结果会显示在对话中。';
  } else if (activeSettingsTab === 'memory') {
    settingsFooterNote.textContent = '长期记忆保存在当前浏览器中，可随时编辑或删除。';
  } else {
    settingsFooterNote.textContent = '任务选择会引用上方已保存的供应商连接。';
  }
}

export function showSettingsModelOverview(): void {
  cancelSettingsConnectionActivity();
  activeConnectionId = null;
  addingConnection = false;
  updateSettingsConnectionSummaries();
  updateSettingsFooter();
  void transitionSettingsModelScreen('overview');
}

export function showSettingsConnectionEditor(connectionId?: string): void {
  if (activeSettingsTab !== 'models') activateSettingsTab('models');
  addingConnection = !connectionId;
  activeConnectionId = connectionId ?? null;
  clearConnectionEditor();

  const connection = connectionId
    ? catalogState?.connections.find((item) => item.id === connectionId)
    : undefined;
  if (connection) {
    activeConnectionId = connection.id;
    addingConnection = false;
    settingsConnectionTitle.textContent = '编辑供应商连接';
    settingsConnectionNameInput.value = connection.name;
    aiProviderSelect.value = connection.providerId;
    deepSeekApiKeyInput.value = connection.apiKey;
    deepSeekBaseUrlInput.value = connection.baseUrl;
    settingsConnectionModelsInput.value = connection.models.join('\n');
    verifiedConnectionModelCapabilities = Object.fromEntries(connection.models.map((model) => [
      model,
      [...(connection.modelCapabilities[model] ?? [])],
    ]));
    renderConnectionModelResults();
    settingsConnectionDeleteButton.hidden = false;
    verifiedConnectionDraft = connectionDraftFingerprint(connection.models);
  } else {
    addingConnection = true;
    settingsConnectionTitle.textContent = '添加供应商连接';
  }
  updateSettingsFooter();
  void transitionSettingsModelScreen('editor').then(() => settingsConnectionNameInput.focus());
}

export function isEditingSettingsConnection(): boolean {
  return addingConnection || Boolean(activeConnectionId);
}

export function isSettingsConnectionDraftVerified(): boolean {
  return verifiedConnectionDraft === connectionDraftFingerprint();
}

export async function saveSettingsConnection(): Promise<boolean> {
  const providerId = aiProviderSelect.value as AiProviderId;
  if (!AI_PROVIDERS.some((provider) => provider.id === providerId && provider.available)) {
    showSettingsStatus('请选择已支持的接口类型。', 'error');
    return false;
  }
  if (verifiedConnectionDraft !== connectionDraftFingerprint()) {
    showSettingsStatus('连接信息或模型列表已改变，请先测试连接。', 'error');
    return false;
  }
  try {
    await aiConnectionCatalog.saveConnection({
      id: activeConnectionId ?? undefined,
      name: settingsConnectionNameInput.value,
      providerId,
      capabilities: readSettingsConnectionCapabilities(),
      modelCapabilities: verifiedConnectionModelCapabilities,
      apiKey: deepSeekApiKeyInput.value,
      baseUrl: deepSeekBaseUrlInput.value,
      models: settingsConnectionModelsInput.value.split(/[\n,，]+/),
    });
    await loadSettingsConnectionCatalog();
    showSettingsModelOverview();
    showSettingsStatus('连接已保存。', 'success');
    return true;
  } catch (error) {
    showSettingsStatus(error instanceof Error ? error.message : String(error), 'error');
    return false;
  }
}

export async function removeActiveSettingsConnection(): Promise<boolean> {
  if (!activeConnectionId) return false;
  await aiConnectionCatalog.removeConnection(activeConnectionId);
  await loadSettingsConnectionCatalog();
  showSettingsModelOverview();
  return true;
}

export async function saveSettingsRoutes(
  reasoning: AiConnectionCatalogState['reasoning'],
  maxOutputTokens: number,
): Promise<AiConnectionCatalogState> {
  const routes: Partial<Record<AiTaskRouteId, AiModelRoute>> = {};
  const chat = readModelRoute(deepSeekModelSelect.value);
  const translation = readModelRoute(translationModelSelect.value);
  const vision = readModelRoute(visionRouteSummary.value);
  if (chat) routes.chat = chat;
  if (translation) routes.translation = translation;
  if (vision) routes.vision = vision;
  catalogState = await aiConnectionCatalog.saveRoutes(routes, { reasoning, maxOutputTokens });
  renderTaskRoutes();
  return catalogState;
}

export function activateSettingsTab(tab: SettingsTab): void {
  cancelSettingsConnectionActivity();
  activeSettingsTab = tab;
  activeConnectionId = null;
  addingConnection = false;
  for (const button of settingsPrimaryTabButtons) {
    const active = button.dataset.settingsTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
  for (const panel of settingsPrimaryPanels) {
    panel.hidden = panel.dataset.settingsPanel !== tab;
  }
  settingsPages.scrollTop = 0;
  if (tab === 'models') {
    showSettingsModelOverview();
  } else {
    setSettingsModelScreenImmediately('overview');
  }
  updateSettingsFooter();
}

export function toggleSettingsSecret(inputId: string): void {
  const input = document.getElementById(inputId);
  if (!(input instanceof HTMLInputElement)) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

export function filterLongTermMemoryList(query: string): void {
  const normalized = query.trim().toLocaleLowerCase();
  for (const item of longTermMemoryList.querySelectorAll<HTMLElement>('.settings-memory-item')) {
    item.hidden = Boolean(normalized) && !item.textContent?.toLocaleLowerCase().includes(normalized);
  }
}

export function resetSettingsPresentation(): void {
  deepSeekApiKeyInput.type = 'password';
  longTermMemorySearchInput.value = '';
  filterLongTermMemoryList('');
  activateSettingsTab('models');
  updateSettingsConnectionSummaries();
}
