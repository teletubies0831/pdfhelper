import type { AiStreamErrorInfo } from '../contracts';

export class AiProviderRequestError extends Error {
  constructor(message: string, readonly details: AiStreamErrorInfo) {
    super(message);
    this.name = 'AiProviderRequestError';
  }
}

export function getSafeProviderErrorDetails(error: unknown): AiStreamErrorInfo {
  if (error instanceof AiProviderRequestError) return error.details;
  return { name: error instanceof Error ? error.name : 'UnknownError' };
}

export function getProviderErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as { error?: unknown; code?: unknown; message?: unknown };
  const nestedError = record.error;
  if (typeof nestedError === 'string' && nestedError.trim()) return nestedError.trim();
  if (nestedError && typeof nestedError === 'object') {
    const nestedMessage = (nestedError as { message?: unknown }).message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage.trim();
  }
  if (typeof record.message === 'string' && record.message.trim()) {
    const code = typeof record.code === 'string' && record.code.trim() ? record.code.trim() : '';
    return code ? `${code}: ${record.message.trim()}` : record.message.trim();
  }
  return fallback;
}
