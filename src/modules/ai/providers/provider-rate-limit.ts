import { normalizeAiBaseUrl, type AiConfig } from '../contracts';
import { AiProviderRequestError, getProviderErrorMessage } from './provider-error';

class ProviderHttpError extends AiProviderRequestError {
  constructor(message: string, status: number, readonly retryAfterMs: number) {
    super(message, { name: 'ProviderHttpError', httpStatus: status });
  }
}

export function providerHttpError(response: Response, payload: unknown): Error {
  const value = response.headers.get('Retry-After');
  const seconds = value === null ? NaN : Number(value);
  const retryAfterMs = Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Math.max(0, Date.parse(value || '') - Date.now()) || 0;
  return new ProviderHttpError(
    `HTTP ${response.status}：${getProviderErrorMessage(payload, 'AI 请求失败')}`,
    response.status, retryAfterMs,
  );
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Normal requests remain concurrent. Queue only after this account actually reports 429. */
export function createRateLimitedRequester(clock = { now: Date.now, wait }) {
  const queues = new Map<string, { tail: Promise<unknown>; nextAt: number; interval: number }>();
  return function request<T>(config: AiConfig, signal: AbortSignal | undefined, attempt: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    // Credentials are used only as an in-memory partition; never logged or persisted.
    const key = `${normalizeAiBaseUrl(config.baseUrl, config.providerId)}\n${config.apiKey}`;
    let queue = queues.get(key);
    if (!queue) {
      queue = { tail: Promise.resolve(), nextAt: 0, interval: 0 };
      queues.set(key, queue);
    }
    const state = queue;
    const handleLimit = (error: unknown, retry: number): void => {
      if (!(error instanceof ProviderHttpError) || error.details.httpStatus !== 429) throw error;
      if (/insufficient[_ ]quota|余额|欠费|billing|credit|balance|\bTPD\b|per day|daily|quota.*exhaust/i.test(error.message)) throw error;
      const rpm = Number(error.message.match(/(?:max\s+)?RPM\s*[:=]\s*(\d+)/i)?.[1]);
      if (rpm > 0) state.interval = Math.max(state.interval, Math.ceil(60_000 / rpm) + 1000);
      const hintedSeconds = Number(error.message.match(/(?:try again|retry) after\s+([\d.]+)\s*s/i)?.[1]) || 0;
      const backoff = Math.max(rpm > 0 ? 61_000 : 5000, state.interval) * 2 ** retry;
      state.nextAt = Math.max(state.nextAt, clock.now() + Math.max(backoff, error.retryAfterMs, hintedSeconds * 1000));
      if (retry >= 3) {
        throw new AiProviderRequestError(
          `AI 服务仍在限流，已自动等待重试 3 次。请稍后重试或在供应商后台检查额度。${error.message}`,
          error.details,
        );
      }
    };
    const enqueue = (firstRetry: number): Promise<T> => {
      const job = state.tail.catch(() => {}).then(async () => {
        for (let retry = firstRetry; ; retry++) {
          signal?.throwIfAborted();
          const delay = state.nextAt - clock.now();
          if (delay > 0) await clock.wait(delay, signal);
          signal?.throwIfAborted();
          state.nextAt = clock.now() + state.interval;
          try {
            return await attempt();
          } catch (error) {
            handleLimit(error, retry);
          }
        }
      });
      state.tail = job.catch(() => {});
      return abortable(job, signal);
    };
    if (state.interval > 0 || state.nextAt > clock.now()) return enqueue(0);
    return attempt().catch(error => {
      handleLimit(error, 0);
      return enqueue(1);
    });
  };
}

export const requestWithRateLimit = createRateLimitedRequester();
