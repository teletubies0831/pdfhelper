export * from './contracts';
export * from './tool-catalog';
export * from './providers/provider';
export * from './providers/provider-error';
export * from './providers/provider-registry';
export { DeepSeekProviderAdapter } from './providers/deepseek-provider';
export * from './domain/ai-connection';
export type { AiConnectionRepository } from './ports/ai-connection-repository';
export { AiConnectionCatalog, normalizeAiConnectionCatalogState } from './application/ai-connection-catalog';
export { BrowserStorageAiConnectionRepository } from './adapters/browser-storage-ai-connection-repository';

import { AiConnectionCatalog } from './application/ai-connection-catalog';
import { BrowserStorageAiConnectionRepository } from './adapters/browser-storage-ai-connection-repository';

export const aiConnectionCatalog = new AiConnectionCatalog(
  new BrowserStorageAiConnectionRepository(),
);
