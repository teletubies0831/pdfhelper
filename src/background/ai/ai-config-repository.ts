import { browser } from "wxt/browser";




import { AI_CONFIG_STORAGE_KEY, DEFAULT_AI_CONFIG, DEFAULT_VISION_AI_CONFIG, LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY, VISION_AI_CONFIG_STORAGE_KEY, normalizeAiBaseUrl, normalizeAiMaxOutputTokens, type AiConfig, type VisionAiConfig } from "../../../shared/ai";






export type LegacyDeepSeekConfig = Partial<AiConfig> & { thinking?: AiConfig['reasoning'] };


export async function getAiConfig(): Promise<AiConfig> {
  const stored = await browser.storage.local.get([
    AI_CONFIG_STORAGE_KEY,
    LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY,
  ]);
  const current = stored[AI_CONFIG_STORAGE_KEY] as Partial<AiConfig> | undefined;
  const legacy = stored[LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY] as LegacyDeepSeekConfig | undefined;
  const source = current || legacy;
  const providerId = source?.providerId ?? DEFAULT_AI_CONFIG.providerId;
  const config: AiConfig = {
    ...DEFAULT_AI_CONFIG,
    ...source,
    providerId,
    apiKey: source?.apiKey?.trim() ?? '',
    baseUrl: normalizeAiBaseUrl(source?.baseUrl ?? '', providerId),
    reasoning: source?.reasoning ?? legacy?.thinking ?? DEFAULT_AI_CONFIG.reasoning,
    model: source?.model || DEFAULT_AI_CONFIG.model,
    translationModel:
      source?.translationModel?.trim()
      || source?.model?.trim()
      || DEFAULT_AI_CONFIG.translationModel,
    maxOutputTokens: normalizeAiMaxOutputTokens(source?.maxOutputTokens),
  };

  if (!current && legacy) {
    await browser.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: config });
  }
  return config;
}


export async function getVisionAiConfig(): Promise<VisionAiConfig> {
  const stored = await browser.storage.local.get(VISION_AI_CONFIG_STORAGE_KEY);
  const value = stored[VISION_AI_CONFIG_STORAGE_KEY] as Partial<VisionAiConfig> | undefined;
  return {
    ...DEFAULT_VISION_AI_CONFIG,
    ...value,
    mode: value?.mode === 'separate' ? 'separate' : 'disabled',
    providerId: 'openai-compatible',
    apiKey: value?.apiKey?.trim() ?? '',
    baseUrl: value?.baseUrl?.trim().replace(/\/+$/, '') ?? '',
    model: value?.model?.trim() ?? '',
  };
}
