import {
  DEFAULT_AI_CONFIG,
  DEFAULT_VISION_AI_CONFIG,
  DEEPSEEK_TOOLS_BASE_URL,
  normalizeAiBaseUrl,
  normalizeAiMaxOutputTokens,
  normalizeAiToolsBaseUrl,
  normalizeWebRetrievalCount,
  normalizeWebRetrievalMaxFetches,
  WEB_RETRIEVAL_DEFAULT_COUNT,
  type AiConfig,
  type AiWebRetrievalConfig,
  type VisionAiConfig,
} from '../contracts';
import {
  collectConnectionCapabilities,
  normalizeConnectionModelCapabilities,
  normalizeConnectionModels,
  type AiConnectionCatalogState,
  type AiConnectionCapability,
  type AiConnectionInput,
  type AiConnectionRecord,
  type AiModelRoute,
  type AiTaskRouteId,
  type AiWebRetrievalSettings,
} from '../domain/ai-connection';
import type { AiConnectionRepository } from '../ports/ai-connection-repository';

function createConnectionId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `connection-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function supports(record: AiConnectionRecord, capability: AiConnectionCapability): boolean {
  return record.models.some((model) => supportsModel(record, model, capability));
}

function supportsModel(
  record: AiConnectionRecord,
  model: string,
  capability: AiConnectionCapability,
): boolean {
  return record.modelCapabilities[model]?.includes(capability) ?? false;
}

function firstRoute(
  connections: AiConnectionRecord[],
  capability: AiConnectionCapability,
): AiModelRoute | undefined {
  for (const connection of connections) {
    const model = connection.models.find((item) => supportsModel(connection, item, capability));
    if (model) return { connectionId: connection.id, model };
  }
  return undefined;
}

function normalizeRoute(
  route: AiModelRoute | undefined,
  connections: AiConnectionRecord[],
  capability: AiConnectionCapability,
): AiModelRoute | undefined {
  const connection = route
    ? connections.find((item) => item.id === route.connectionId && supports(item, capability))
    : undefined;
  if (!connection) return firstRoute(connections, capability);
  const model = connection.models.some((item) => (
    item === route?.model && supportsModel(connection, item, capability)
  ))
    ? route!.model
    : connection.models.find((item) => supportsModel(connection, item, capability));
  return model ? { connectionId: connection.id, model } : firstRoute(connections, capability);
}

export function normalizeAiConnectionCatalogState(
  state: AiConnectionCatalogState,
): AiConnectionCatalogState {
  const connections = state.connections.map((connection) => {
    const models = normalizeConnectionModels(connection.models);
    const modelCapabilities = normalizeConnectionModelCapabilities(
      models,
      connection.modelCapabilities,
      connection.capabilities,
    );
    return {
      ...connection,
      name: connection.name.trim(),
      apiKey: connection.apiKey.trim(),
      baseUrl: connection.baseUrl.trim().replace(/\/+$/, ''),
      capabilities: collectConnectionCapabilities(models, modelCapabilities),
      modelCapabilities,
      models,
    };
  });
  return {
    connections,
    routes: {
      chat: normalizeRoute(state.routes.chat, connections, 'text'),
      translation: normalizeRoute(state.routes.translation, connections, 'text'),
      vision: normalizeRoute(state.routes.vision, connections, 'vision'),
    },
    reasoning: state.reasoning === 'enabled' ? 'enabled' : 'disabled',
    maxOutputTokens: normalizeAiMaxOutputTokens(state.maxOutputTokens),
    webRetrieval: normalizeWebRetrievalSettings(state.webRetrieval),
  };
}

/**
 * Normalizes the retrieval settings, defaulting the address to DeepSeek's tools base.
 *
 * The default is filled in on purpose: a user who already holds a DeepSeek key should not have to type an
 * address they will never change, and the 联网 switch only needs *a* key to become usable.
 */
export function normalizeWebRetrievalSettings(
  settings: Partial<AiWebRetrievalSettings> | undefined,
): AiWebRetrievalSettings {
  let baseUrl: string;
  if (settings?.baseUrl === undefined || settings.baseUrl === null) {
    baseUrl = DEEPSEEK_TOOLS_BASE_URL;
  } else {
    try {
      // An empty string is a deliberate "switched off" and must stay empty; only a *missing* address defaults.
      baseUrl = normalizeAiToolsBaseUrl(settings.baseUrl);
    } catch {
      // A stored address that no longer parses would lock the user out of the whole settings page; keeping the
      // default lets them see the field and fix it.
      baseUrl = DEEPSEEK_TOOLS_BASE_URL;
    }
  }
  return {
    baseUrl,
    apiKey: typeof settings?.apiKey === 'string' ? settings.apiKey.trim() : '',
    count: settings?.count === undefined
      ? WEB_RETRIEVAL_DEFAULT_COUNT
      : normalizeWebRetrievalCount(settings.count),
    maxFetches: settings?.maxFetches === undefined
      ? 1
      : normalizeWebRetrievalMaxFetches(settings.maxFetches),
  };
}

export class AiConnectionCatalog {
  constructor(private readonly repository: AiConnectionRepository) {}

  async load(): Promise<AiConnectionCatalogState> {
    return normalizeAiConnectionCatalogState(await this.repository.load());
  }

  async saveConnection(input: AiConnectionInput): Promise<AiConnectionRecord> {
    const state = await this.load();
    const name = input.name.trim();
    const apiKey = input.apiKey.trim();
    const baseUrl = normalizeAiBaseUrl(input.baseUrl, input.providerId);
    const models = normalizeConnectionModels(input.models);
    const modelCapabilities = normalizeConnectionModelCapabilities(
      models,
      input.modelCapabilities,
      input.capabilities,
    );
    const capabilities = collectConnectionCapabilities(models, modelCapabilities);
    if (!name) throw new Error('请输入连接名称。');
    if (!apiKey) throw new Error('请输入 API Key。');
    if (!baseUrl) throw new Error('请输入 API 地址。');
    if (models.length === 0) throw new Error('请至少填写一个模型。');
    if (capabilities.length === 0) throw new Error('请先测试连接，确认至少有一个可用模型。');

    const previous = input.id
      ? state.connections.find((connection) => connection.id === input.id)
      : undefined;
    const now = Date.now();
    const record: AiConnectionRecord = {
      id: previous?.id ?? createConnectionId(),
      name,
      providerId: input.providerId,
      capabilities,
      modelCapabilities,
      apiKey,
      baseUrl,
      models,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    const connections = previous
      ? state.connections.map((connection) => connection.id === previous.id ? record : connection)
      : [...state.connections, record];
    await this.repository.save(normalizeAiConnectionCatalogState({ ...state, connections }));
    return record;
  }

  async removeConnection(connectionId: string): Promise<void> {
    const state = await this.load();
    await this.repository.save(normalizeAiConnectionCatalogState({
      ...state,
      connections: state.connections.filter((connection) => connection.id !== connectionId),
    }));
  }

  async saveRoutes(
    routes: Partial<Record<AiTaskRouteId, AiModelRoute>>,
    preferences?: Pick<AiConnectionCatalogState, 'reasoning' | 'maxOutputTokens'>,
  ): Promise<AiConnectionCatalogState> {
    const state = await this.load();
    const next = normalizeAiConnectionCatalogState({
      ...state,
      ...preferences,
      routes: { ...state.routes, ...routes },
    });
    await this.repository.save(next);
    return next;
  }

  async resolveTextConfig(routeId: 'chat' | 'translation' = 'chat'): Promise<AiConfig> {
    const state = await this.load();
    const route = state.routes[routeId];
    const connection = route
      ? state.connections.find((item) => (
        item.id === route.connectionId && supportsModel(item, route.model, 'text')
      ))
      : undefined;
    if (!connection || !route) return { ...DEFAULT_AI_CONFIG, apiKey: '' };
    return {
      providerId: connection.providerId,
      apiKey: connection.apiKey,
      baseUrl: normalizeAiBaseUrl(connection.baseUrl, connection.providerId),
      model: route.model,
      translationModel: state.routes.translation?.model ?? route.model,
      reasoning: state.reasoning,
      maxOutputTokens: state.maxOutputTokens,
    };
  }

  async resolveVisionConfig(): Promise<VisionAiConfig> {
    const state = await this.load();
    const route = state.routes.vision;
    const connection = route
      ? state.connections.find((item) => (
        item.id === route.connectionId && supportsModel(item, route.model, 'vision')
      ))
      : undefined;
    if (!connection || !route) return { ...DEFAULT_VISION_AI_CONFIG };
    return {
      mode: 'separate',
      providerId: 'openai-compatible',
      apiKey: connection.apiKey,
      baseUrl: normalizeAiBaseUrl(connection.baseUrl, connection.providerId),
      model: route.model,
    };
  }

  async saveWebRetrieval(
    settings: Partial<AiWebRetrievalSettings>,
  ): Promise<AiConnectionCatalogState> {
    const state = await this.load();
    const next = normalizeAiConnectionCatalogState({
      ...state,
      webRetrieval: { ...state.webRetrieval, ...settings },
    });
    await this.repository.save(next);
    return next;
  }

  /**
   * The retrieval settings, or `null` when they cannot be used.
   *
   * `null` is the signal the whole UI keys on: the 联网 switch and the 检索相关论文 button are inert without a
   * working configuration, so the state has to be answerable in one call rather than re-derived in three
   * places. The key falls back to the DeepSeek chat connection's key, which is what most users already have.
   */
  async resolveWebRetrievalConfig(): Promise<AiWebRetrievalConfig | null> {
    const state = await this.load();
    const settings = state.webRetrieval;
    const baseUrl = settings.baseUrl.trim();
    if (!baseUrl) return null;
    const fallbackKey = state.connections.find((connection) => (
      connection.providerId === 'deepseek' && connection.apiKey.trim()
    ))?.apiKey.trim() ?? '';
    const apiKey = settings.apiKey.trim() || fallbackKey;
    if (!apiKey) return null;
    return {
      baseUrl,
      apiKey,
      count: normalizeWebRetrievalCount(settings.count),
      maxFetches: normalizeWebRetrievalMaxFetches(settings.maxFetches),
    };
  }
}
