/** Only apply Moonshot's native parameters to its official API endpoints. */
export function getMoonshotReasoningPayload(
  baseUrl: string,
  model: string,
  enabled: boolean,
): Record<string, unknown> | undefined {
  let hostname: string;
  try { hostname = new URL(baseUrl).hostname.toLowerCase(); } catch { return undefined; }
  if (!['api.moonshot.cn', 'api.moonshot.ai'].includes(hostname)) return undefined;
  const name = model.toLowerCase();
  // K3 and K2.7 Code cannot disable thinking. K3 supports a smaller effort budget.
  if (/^kimi-k3(?:-|$)/.test(name)) return enabled ? {} : { reasoning_effort: 'low' };
  if (/^kimi-k2\.[56](?:-|$)/.test(name)) {
    return { thinking: { type: enabled ? 'enabled' : 'disabled' } };
  }
  return {};
}
