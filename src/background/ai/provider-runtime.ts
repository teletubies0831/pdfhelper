
import { DeepSeekProviderAdapter } from "../../modules/ai/providers/deepseek-provider";
import { AiProviderRegistry } from '../../modules/ai/providers/provider-registry';

import { type AiConfig } from "../../../shared/ai";

import { getProviderError } from './vision-service';
import type { ProviderChatResult, ProviderMessage, ProviderStreamDelta } from './vision-service';




export interface AiProviderAdapter {
  readonly id: AiConfig['providerId'];
  test(config: AiConfig): Promise<string[]>;
  chat(config: AiConfig, messages: ProviderMessage[], maxOutputTokens: number): Promise<ProviderChatResult>;
  stream(
    config: AiConfig,
    messages: ProviderMessage[],
    maxOutputTokens: number,
    signal: AbortSignal,
    onDelta: (delta: ProviderStreamDelta) => void,
    options?: {
      toolChoice?: 'auto' | 'none' | 'required';
      tools?: Array<Record<string, unknown>>;
    },
  ): Promise<ProviderChatResult>;
}

export async function fetchProviderJson(
  path: string,
  config: AiConfig,
  init?: RequestInit,
): Promise<unknown> {
  if (!config.apiKey) {
    throw new Error('请先在 PDF Helper 的“设置”中配置 API Key。');
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getProviderError(payload, `AI 请求失败：HTTP ${response.status}`));
  }

  return payload;
}

export const providerRegistry = new AiProviderRegistry();

providerRegistry.register(new DeepSeekProviderAdapter());

export const providerAdapters: Partial<Record<AiConfig['providerId'], AiProviderAdapter>> =
  new Proxy({}, {
    get: (_target, providerId: string) => {
      try {
        return providerRegistry.get(providerId);
      } catch {
        return undefined;
      }
    },
  });

export function getProviderAdapter(config: AiConfig): AiProviderAdapter {
  const adapter = providerAdapters[config.providerId];
  if (!adapter) throw new Error('当前模型供应商尚未接入，请在设置中选择已支持的供应商。');
  return adapter;
}
