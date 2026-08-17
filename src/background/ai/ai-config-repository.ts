import {
  aiConnectionCatalog,
  type AiConfig,
  type VisionAiConfig,
} from '../../modules/ai/public';

export function getAiConfig(routeId: 'chat' | 'translation' = 'chat'): Promise<AiConfig> {
  return aiConnectionCatalog.resolveTextConfig(routeId);
}

export function getVisionAiConfig(): Promise<VisionAiConfig> {
  return aiConnectionCatalog.resolveVisionConfig();
}
