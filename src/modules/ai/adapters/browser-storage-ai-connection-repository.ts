import { browser } from 'wxt/browser';
import {
  AI_CONFIG_STORAGE_KEY,
  AI_PROVIDERS,
  DEFAULT_AI_CONFIG,
  DEEPSEEK_MODELS,
  LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY,
  VISION_AI_CONFIG_STORAGE_KEY,
  type AiConfig,
  type VisionAiConfig,
} from '../contracts';
import type {
  AiConnectionCatalogState,
  AiConnectionRecord,
} from '../domain/ai-connection';
import type { AiConnectionRepository } from '../ports/ai-connection-repository';

const AI_CONNECTION_TABLE_KEY = 'pdf-helper-ai-connection-table-v1';
const AI_CONNECTION_TABLE_VERSION = 1;

interface StoredAiConnectionTable extends AiConnectionCatalogState {
  schemaVersion: number;
}

function emptyState(): AiConnectionCatalogState {
  return {
    connections: [],
    routes: {},
    reasoning: DEFAULT_AI_CONFIG.reasoning,
    maxOutputTokens: DEFAULT_AI_CONFIG.maxOutputTokens,
  };
}

function isStoredTable(value: unknown): value is StoredAiConnectionTable {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredAiConnectionTable>;
  return candidate.schemaVersion === AI_CONNECTION_TABLE_VERSION
    && Array.isArray(candidate.connections)
    && Boolean(candidate.routes && typeof candidate.routes === 'object');
}

function providerLabel(providerId: AiConfig['providerId']): string {
  return AI_PROVIDERS.find((provider) => provider.id === providerId)?.label ?? '模型供应商';
}

export class BrowserStorageAiConnectionRepository implements AiConnectionRepository {
  async load(): Promise<AiConnectionCatalogState> {
    const stored = await browser.storage.local.get([
      AI_CONNECTION_TABLE_KEY,
      AI_CONFIG_STORAGE_KEY,
      LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY,
      VISION_AI_CONFIG_STORAGE_KEY,
    ]);
    const current = stored[AI_CONNECTION_TABLE_KEY];
    if (isStoredTable(current)) {
      return {
        connections: current.connections,
        routes: current.routes,
        reasoning: current.reasoning,
        maxOutputTokens: current.maxOutputTokens,
      };
    }

    const migrated = this.migrateLegacy(
      (stored[AI_CONFIG_STORAGE_KEY] ?? stored[LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY]) as Partial<AiConfig> | undefined,
      stored[VISION_AI_CONFIG_STORAGE_KEY] as Partial<VisionAiConfig> | undefined,
    );
    await this.save(migrated);
    return migrated;
  }

  async save(state: AiConnectionCatalogState): Promise<void> {
    const table: StoredAiConnectionTable = {
      schemaVersion: AI_CONNECTION_TABLE_VERSION,
      ...state,
    };
    await browser.storage.local.set({ [AI_CONNECTION_TABLE_KEY]: table });
  }

  private migrateLegacy(
    textConfig?: Partial<AiConfig>,
    visionConfig?: Partial<VisionAiConfig>,
  ): AiConnectionCatalogState {
    const state = emptyState();
    const now = Date.now();
    const textApiKey = textConfig?.apiKey?.trim() ?? '';
    const textBaseUrl = textConfig?.baseUrl?.trim().replace(/\/+$/, '') ?? '';
    if (textApiKey && textBaseUrl) {
      const providerId = textConfig?.providerId ?? DEFAULT_AI_CONFIG.providerId;
      const models = Array.from(new Set([
        textConfig?.model || DEFAULT_AI_CONFIG.model,
        textConfig?.translationModel,
        ...(providerId === 'deepseek' ? DEEPSEEK_MODELS.map((model) => model.value) : []),
      ].filter((model): model is string => Boolean(model?.trim()))));
      const connection: AiConnectionRecord = {
        id: 'migrated-text-connection',
        name: providerLabel(providerId),
        providerId,
        capabilities: ['text'],
        modelCapabilities: Object.fromEntries(models.map((model) => [model, ['text']])),
        apiKey: textApiKey,
        baseUrl: textBaseUrl,
        models,
        createdAt: now,
        updatedAt: now,
      };
      state.connections.push(connection);
      state.routes.chat = { connectionId: connection.id, model: textConfig?.model || DEFAULT_AI_CONFIG.model };
      state.routes.translation = {
        connectionId: connection.id,
        model: textConfig?.translationModel || textConfig?.model || DEFAULT_AI_CONFIG.translationModel,
      };
      state.reasoning = textConfig?.reasoning === 'enabled' ? 'enabled' : 'disabled';
      state.maxOutputTokens = textConfig?.maxOutputTokens ?? DEFAULT_AI_CONFIG.maxOutputTokens;
    }

    const visionApiKey = visionConfig?.apiKey?.trim() ?? '';
    const visionBaseUrl = visionConfig?.baseUrl?.trim().replace(/\/+$/, '') ?? '';
    const visionModel = visionConfig?.model?.trim() ?? '';
    if (visionConfig?.mode === 'separate' && visionApiKey && visionBaseUrl && visionModel) {
      const connection: AiConnectionRecord = {
        id: 'migrated-vision-connection',
        name: '视觉模型',
        providerId: 'openai-compatible',
        capabilities: ['vision'],
        modelCapabilities: { [visionModel]: ['vision'] },
        apiKey: visionApiKey,
        baseUrl: visionBaseUrl,
        models: [visionModel],
        createdAt: now,
        updatedAt: now,
      };
      state.connections.push(connection);
      state.routes.vision = { connectionId: connection.id, model: visionModel };
    }
    return state;
  }
}
