import type { MemoryToolResult } from "../../../../modules/memory/public";

export function parseAgentToolResult(
  content: string,
  toolName: string,
  transportOk: boolean,
): MemoryToolResult {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "ok" in parsed &&
      typeof parsed.ok === "boolean"
    ) {
      return parsed as MemoryToolResult;
    }
    return {
      ok: transportOk,
      tool: toolName as MemoryToolResult["tool"],
      data: parsed,
    };
  } catch {
    return {
      ok: false,
      tool: toolName as MemoryToolResult["tool"],
      error: content || "MCP 工具没有返回有效结果。",
    };
  }
}
