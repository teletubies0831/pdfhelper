import type { AiProviderId, AiReasoningMode } from '../contracts';

export type AiConnectionCapability = 'text' | 'vision';
export type AiTaskRouteId = 'chat' | 'translation' | 'vision';
export type AiConnectionModelCapabilities = Record<string, AiConnectionCapability[]>;

export interface AiConnectionRecord {
  id: string;
  name: string;
  providerId: AiProviderId;
  capabilities: AiConnectionCapability[];
  modelCapabilities: AiConnectionModelCapabilities;
  apiKey: string;
  baseUrl: string;
  models: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AiModelRoute {
  connectionId: string;
  model: string;
}

export interface AiConnectionCatalogState {
  connections: AiConnectionRecord[];
  routes: Partial<Record<AiTaskRouteId, AiModelRoute>>;
  reasoning: AiReasoningMode;
  maxOutputTokens: number;
}

export interface AiConnectionInput {
  id?: string;
  name: string;
  providerId: AiProviderId;
  capabilities?: AiConnectionCapability[];
  modelCapabilities?: AiConnectionModelCapabilities;
  apiKey: string;
  baseUrl: string;
  models: string[];
}

export function normalizeConnectionModels(models: readonly string[]): string[] {
  return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

const CONNECTION_CAPABILITIES: readonly AiConnectionCapability[] = ['text', 'vision'];

function normalizeCapabilities(
  capabilities: readonly AiConnectionCapability[] | undefined,
): AiConnectionCapability[] {
  return Array.from(new Set(
    (capabilities ?? []).filter((capability) => CONNECTION_CAPABILITIES.includes(capability)),
  ));
}

export function normalizeConnectionModelCapabilities(
  models: readonly string[],
  modelCapabilities: AiConnectionModelCapabilities | undefined,
  fallbackCapabilities: readonly AiConnectionCapability[] = [],
): AiConnectionModelCapabilities {
  const fallback = normalizeCapabilities(fallbackCapabilities);
  const hasPerModelCapabilityMetadata = Boolean(
    modelCapabilities && Object.keys(modelCapabilities).length > 0,
  );
  return Object.fromEntries(normalizeConnectionModels(models).map((model) => {
    const capabilities = normalizeCapabilities(modelCapabilities?.[model]);
    return [
      model,
      capabilities.length > 0
        ? capabilities
        : hasPerModelCapabilityMetadata
          ? []
          : fallback,
    ];
  }));
}

export function collectConnectionCapabilities(
  models: readonly string[],
  modelCapabilities: AiConnectionModelCapabilities,
): AiConnectionCapability[] {
  return normalizeCapabilities(models.flatMap((model) => modelCapabilities[model] ?? []));
}
