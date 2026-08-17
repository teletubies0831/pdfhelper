

import { type LongTermMemory } from "../../../../shared/memory";
import { memoryTools } from "../../../../entrypoints/viewer/memory-store";

import { longTermMemoryCount, longTermMemoryList, refreshLongTermMemoriesButton } from "../../app/viewer-elements";

export const LONG_TERM_MEMORY_CATEGORY_LABELS: Record<LongTermMemory["category"], string> = {
  preference: "偏好",
  profile: "用户",
  project: "项目",
  fact: "事实",
  correction: "纠正",
};

const LONG_TERM_MEMORY_SCOPE_LABELS: Record<LongTermMemory["scope"], string> = {
  global: "全局",
  project: "当前项目",
  pdf: "当前文档",
};

let renderedMemories = new Map<string, LongTermMemory>();

export async function createLongTermMemory(): Promise<void> {
  const content = window.prompt("输入希望长期记住的内容：")?.trim();
  if (!content) return;
  await memoryTools.upsert({
    key: `manual.fact.${Date.now()}`,
    category: "fact",
    content,
    scope: "global",
    confidence: 1,
    importance: 0.8,
    sourceType: "explicit",
  });
  await refreshLongTermMemoryList();
}

export async function editLongTermMemory(memoryId: string): Promise<void> {
  const memory = renderedMemories.get(memoryId);
  if (!memory) return;
  const content = window.prompt("编辑长期记忆：", memory.content)?.trim();
  if (!content || content === memory.content) return;
  await memoryTools.upsert({
    id: memory.id,
    key: memory.key,
    category: memory.category,
    content,
    scope: memory.scope,
    scopeId: memory.scopeId,
    confidence: memory.confidence,
    importance: memory.importance,
    sourceType: "explicit",
    sourceConversationId: memory.sourceConversationId,
    sourcePdfId: memory.sourcePdfId,
    expiresAt: memory.expiresAt,
  });
  await refreshLongTermMemoryList();
}

export async function deleteLongTermMemory(memoryId: string): Promise<void> {
  if (!renderedMemories.has(memoryId)) {
    throw new Error("找不到要删除的长期记忆。");
  }
  const deleted = await memoryTools.forget(memoryId);
  if (!deleted) throw new Error("这条长期记忆已经不存在。");
  renderedMemories.delete(memoryId);
  await refreshLongTermMemoryList();
}

export async function refreshLongTermMemoryList(): Promise<void> {
  refreshLongTermMemoriesButton.disabled = true;
  try {
    const memories = await memoryTools.list({ limit: 100 });
    renderedMemories = new Map(memories.map((memory) => [memory.id, memory]));
    longTermMemoryCount.textContent = `${memories.length} 条`;
    longTermMemoryList.replaceChildren();
    if (memories.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-memory-empty";
      empty.textContent = "暂无长期记忆；明确表达的长期偏好会在回答后异步记录。";
      longTermMemoryList.append(empty);
      return;
    }
    for (const memory of memories) {
      const item = document.createElement("div");
      item.className = "settings-memory-item";

      const category = document.createElement("span");
      category.className = "settings-memory-category";
      category.textContent = LONG_TERM_MEMORY_CATEGORY_LABELS[memory.category];

      const content = document.createElement("div");
      content.className = "settings-memory-content";
      content.textContent = memory.content;
      const meta = document.createElement("small");
      meta.textContent = LONG_TERM_MEMORY_SCOPE_LABELS[memory.scope];
      content.append(meta);

      const actions = document.createElement("div");
      actions.className = "settings-memory-item-actions";
      const edit = document.createElement("button");
      edit.className = "settings-memory-edit";
      edit.type = "button";
      edit.dataset.memoryId = memory.id;
      edit.dataset.memoryAction = "edit";
      edit.textContent = "编辑";

      const remove = document.createElement("button");
      remove.className = "settings-memory-delete";
      remove.type = "button";
      remove.dataset.memoryId = memory.id;
      remove.dataset.memoryAction = "delete";
      remove.setAttribute("aria-label", `删除长期记忆：${memory.content}`);
      remove.title = "删除";
      remove.textContent = "×";
      actions.append(edit, remove);
      item.append(category, content, actions);
      longTermMemoryList.append(item);
    }
  } catch (error) {
    longTermMemoryList.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "settings-memory-empty";
    empty.textContent = `读取长期记忆失败：${error instanceof Error ? error.message : String(error)}`;
    longTermMemoryList.append(empty);
  } finally {
    refreshLongTermMemoriesButton.disabled = false;
  }
}
