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
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}
