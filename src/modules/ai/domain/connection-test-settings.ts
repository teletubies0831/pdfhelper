export const AI_CONNECTION_TEST_SETTINGS_KEY = 'pdfpal-connection-test-settings-v1';

export interface ConnectionTestSettings {
  maxOutputTokens: number;
  concurrency: number;
}

export const CONNECTION_TEST_PROMPT = '你好！请用一两句话介绍你能怎样帮助我阅读和理解 PDF 文档。';
export const DEFAULT_CONNECTION_TEST_SETTINGS: ConnectionTestSettings = {
  maxOutputTokens: 8192,
  concurrency: 1,
};

export function normalizeConnectionTestSettings(value: unknown): ConnectionTestSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const integer = (value: unknown, fallback: number, min: number, max: number): number => {
    if (value === '' || value == null) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback;
  };
  return {
    maxOutputTokens: integer(input.maxOutputTokens, 8192, 256, 65536),
    concurrency: integer(input.concurrency, 1, 1, 4),
  };
}

export function redactConnectionTestText(value: string, apiKey: string): string {
  const redacted = apiKey ? value.split(apiKey).join('[密钥已隐藏]') : value;
  return redacted.replace(/\bsk-[a-zA-Z0-9_-]+/g, '[密钥已隐藏]').slice(0, 4000);
}

export function explainConnectionTestError(error: string): string {
  const message = error.toLowerCase();
  let hint = '';
  if (/insufficient|balance|quota|credit/.test(message)) {
    hint = '请检查此 API Key 所属组织／项目的余额和额度限制。';
  } else if (/429|rate.limit|overload/.test(message)) {
    hint = '接口限流或繁忙，请稍后重试，并在“常规”将同时测试的请求数设为 1。';
  } else if (/401|unauthorized|invalid.api.key|authentication/.test(message)) {
    hint = '密钥认证失败，请核对 API Key 与接口地址是否属于同一平台及站点。';
  } else if (/403|permission|access.denied/.test(message)) {
    hint = '当前密钥可能没有此模型的调用权限，请检查平台的项目权限。';
  } else if (/timeout|timed.out|aborted/.test(message)) {
    hint = '请求超时，请检查网络或稍后重试。';
  } else if (/failed to fetch|network/.test(message)) {
    hint = '无法连接接口，请检查网络、API 地址及扩展访问权限。';
  }
  return hint ? `${hint}\n接口返回：${error}` : error;
}
