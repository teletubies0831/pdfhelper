import type { AiProviderAdapter, AiProviderDescriptor } from './provider';

export class AiProviderRegistry {
  private readonly providers = new Map<string, AiProviderAdapter>();

  register(provider: AiProviderAdapter): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`AI provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): AiProviderAdapter {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`AI provider is not registered: ${id}`);
    return provider;
  }

  list(): AiProviderDescriptor[] {
    return Array.from(this.providers.values(), ({ descriptor }) => descriptor);
  }
}
