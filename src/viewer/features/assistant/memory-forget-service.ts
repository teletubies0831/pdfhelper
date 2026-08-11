


import { type LongTermMemory } from "../../../../shared/memory";
import { executeMemoryTool, memoryTools } from "../../../../entrypoints/viewer/memory-store";

import { updateChatActivity } from "../../shared-ui/markdown/markdown-renderer";
import { assistantSettingsPanel } from "../../app/viewer-elements";




import { refreshLongTermMemoryList } from "./memory-list";

export interface ImmediateMemoryWriteResult {
  stored: LongTermMemory[];
  contextText: string;
  completedTools: Array<{
    name: string;
    arguments?: Record<string, unknown>;
  }>;
}

export function isExplicitMemoryForgetRequest(value: string): boolean {
  const hasAction = /删除|删掉|移除|忘记|(?:不要|别|不再)\s*记住/u.test(value);
  const hasTargetCue = /记忆|这条|这个|喜欢|不喜欢|偏好|习惯|研究方向|项目|设置|内容|列表|残留|条目|记住|memory\.(?:search|list|forget)|工具/u.test(value);
  return hasAction && hasTargetCue;
}

export function extractMemoryForgetTarget(value: string): string {
  const candidates = [
    value.match(/(?:把|将)\s*(.+?)(?:这条|这个(?:长期)?记忆)?\s*(?:删除|删掉|移除|忘记)(?:了|吧)?/u)?.[1],
    value.match(/(?:请)?(?:删除|删掉|移除|忘记)\s*(.+?)(?:这条|这个(?:长期)?记忆)?(?:了|吧)?$/u)?.[1],
    value.match(/(?:不要|别|不再)\s*记住\s*(.+?)(?:这条|这个(?:长期)?记忆)?(?:了|吧|吗)?$/u)?.[1],
    value.match(/(.+?)(?:这条|这个(?:长期)?记忆)?\s*(?:删除|删掉|移除|忘记)(?:了|吧)?$/u)?.[1],
  ];
  return (candidates.find((candidate) => candidate?.trim()) ?? "")
    .replace(/^(?:请|帮我)\s*/u, "")
    .trim();
}

export function normalizeMemoryForgetText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/用户明确(?:表示|要求(?:长期)?记住)|用户(?:说|表示)|长期记忆|这条记忆|这个记忆|那条记忆|这条|这个|那条|那个|偏好|记录|记忆|请|帮我|把|将|删除|删掉|移除|忘记|了|吧/gu, "")
    .replace(/^[我吾]想?要?/u, "")
    .replace(/[\s,，。.!！?？:：;；"“”'‘’、]/gu, "")
    .trim();
}

export async function executeExplicitMemoryForget(
  userMessage: string,
  assistantElement: HTMLElement,
): Promise<ImmediateMemoryWriteResult> {
  const operationId = crypto.randomUUID();
  const target = extractMemoryForgetTarget(userMessage);
  updateChatActivity(
    assistantElement,
    "long-term-memory",
    "Agent 正在调用工具 · memory.list",
    "active",
    target || "memory.list",
  );
  try {
    const existing = await memoryTools.list({ limit: 100 });
    const normalizedTarget = normalizeMemoryForgetText(target);
    const matches = normalizedTarget.length >= 2
      ? existing.filter((memory) => {
        const normalizedMemory = normalizeMemoryForgetText(`${memory.content} ${memory.key}`);
        return normalizedMemory.length >= 2
          && (normalizedMemory.includes(normalizedTarget) || normalizedTarget.includes(normalizedMemory));
      })
      : [];
    if (!matches.length) {
      updateChatActivity(
        assistantElement,
        "long-term-memory",
        "Agent 未找到可删除的记忆",
        "done",
        target || "请提供要删除的内容",
      );
      return {
        stored: [],
        contextText: `用户要求删除长期记忆${target ? `“${target}”` : ""}，但当前没有找到可匹配的已有条目，因此没有新增或修改任何记忆。`,
        completedTools: [{ name: "memory.list", arguments: { limit: 100 } }],
      };
    }

    const deleted: LongTermMemory[] = [];
    const completedTools: ImmediateMemoryWriteResult["completedTools"] = [
      { name: "memory.list", arguments: { limit: 100 } },
    ];
    for (const memory of matches.slice(0, 5)) {
      const toolKey = `memory-forget-${memory.id}`;
      updateChatActivity(
        assistantElement,
        toolKey,
        "Agent 正在调用工具 · memory.forget",
        "active",
        memory.content,
      );
      console.info("[PDF Helper Agent 工具调用] memory.forget", {
        operationId,
        id: memory.id,
        content: memory.content,
      });
      const result = await executeMemoryTool({
        name: "memory.forget",
        arguments: { id: memory.id },
      });
      console.info("[PDF Helper Agent 工具结果] memory.forget", { operationId, result });
      if (result.ok && result.data === true) {
        deleted.push(memory);
        completedTools.push({ name: "memory.forget", arguments: { id: memory.id } });
        updateChatActivity(assistantElement, toolKey, "Agent 已完成 · memory.forget", "done", memory.content);
      } else {
        updateChatActivity(
          assistantElement,
          toolKey,
          "Agent 工具失败 · memory.forget",
          "error",
          result.error || "记忆条目不存在",
        );
      }
    }
    updateChatActivity(
      assistantElement,
      "long-term-memory",
      deleted.length ? "Agent 已删除长期记忆" : "Agent 未删除任何记忆",
      deleted.length ? "done" : "error",
      `${deleted.length} 条`,
    );
    if (!assistantSettingsPanel.hidden) void refreshLongTermMemoryList();
    return {
      stored: [],
      contextText: deleted.length
        ? [
          `Agent 已在最终回答前调用 memory.forget，删除 ${deleted.length} 条长期记忆：`,
          ...deleted.map((memory) => `- ${memory.content}`),
          "请明确告诉用户删除了哪些内容。",
        ].join("\n")
        : "Agent 尝试调用 memory.forget，但没有成功删除匹配条目。",
      completedTools,
    };
  } catch (error) {
    console.error("[PDF Helper Agent 工具失败] memory.forget", { operationId, error });
    updateChatActivity(
      assistantElement,
      "long-term-memory",
      "Agent 工具失败 · memory.forget",
      "error",
      error instanceof Error ? error.message : String(error),
    );
    return { stored: [], contextText: "Agent 删除长期记忆失败。", completedTools: [] };
  }
}
