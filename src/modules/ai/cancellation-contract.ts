/**
 * 取消进行中的 AI 请求（协议）.
 *
 * Kept out of `contracts.ts` (which is at its size limit) and — more to the point — it is a different kind of message: it
 * carries no config, spends nothing, and its only job is to reach the worker while an original request is still awaiting the
 * provider. `runtime.sendMessage` has no signal to thread through, so cancellation has to be a second message.
 */
export interface AiCancelRequestMessage {
  type: 'pdf-helper:ai-cancel-request';
  /** Every request whose id starts with this prefix is aborted (`extract:<paperId>:`). */
  requestIdPrefix: string;
}

export function isCancelAiRequestMessage(value: unknown): value is AiCancelRequestMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as { type?: unknown; requestIdPrefix?: unknown };
  return message.type === 'pdf-helper:ai-cancel-request'
    && typeof message.requestIdPrefix === 'string'
    && message.requestIdPrefix.length > 0;
}
