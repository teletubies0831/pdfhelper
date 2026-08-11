

import { type AiMemoryCandidate } from "../../../../shared/ai";
import { type LongTermMemory } from "../../../../shared/memory";
import { memoryTools } from "../../../../entrypoints/viewer/memory-store";
import { chatHistory } from "../../core/pdf-reader/public";

import { longTermMemoryCount, longTermMemoryList, refreshLongTermMemoriesButton } from "../../app/viewer-elements";




import { createLocalExplicitMemoryCandidates, findConfirmedMemoryProposal } from "./memory-candidate-parser";

export const LONG_TERM_MEMORY_CATEGORY_LABELS: Record<LongTermMemory["category"], string> = {
  preference: "偏好",
  profile: "用户",
  project: "项目",
  fact: "事实",
  correction: "纠正",
};

export async function backfillExplicitMemoriesFromCurrentChat(): Promise<void> {
  const existing = await memoryTools.list({ limit: 100 });
  const existingByKey = new Map(
    existing.map((memory) => [`${memory.key}:${memory.scope}:${memory.scopeId ?? ""}`, memory]),
  );
  const pending = new Map<string, AiMemoryCandidate>();

  const recentHistory = chatHistory.value.slice(-50);
  for (const [index, message] of recentHistory.entries()) {
    if (message.role !== "user") continue;
    for (const candidate of createLocalExplicitMemoryCandidates(message.content)) {
      pending.set(`${candidate.key}:${candidate.scope}:`, candidate);
    }
    const confirmedProposal = findConfirmedMemoryProposal(recentHistory, index);
    if (confirmedProposal) {
      for (const candidate of createLocalExplicitMemoryCandidates(
        `请记住：${confirmedProposal}`,
      )) {
        pending.set(`${candidate.key}:${candidate.scope}:`, candidate);
      }
    }
  }

  const candidatesToStore = [...pending.entries()]
    .filter(([identity, candidate]) =>
      existingByKey.get(identity)?.content !== candidate.content,
    )
    .map(([, candidate]) => candidate);
  if (candidatesToStore.length === 0) return;
  await Promise.all(
    candidatesToStore.map((candidate) =>
      memoryTools.upsert({
        ...candidate,
        sourceConversationId: "current-chat-backfill",
      }),
      ),
  );
  const legacyLikesMemories = existing.filter(
    (memory) => memory.key === "profile.personal.likes",
  );
  if (
    legacyLikesMemories.length > 0 &&
    [...pending.values()].some((candidate) =>
      candidate.key.startsWith("profile.personal.likes."),
    )
  ) {
    await Promise.all(
      legacyLikesMemories.map((memory) => memoryTools.forget(memory.id)),
    );
  }
  console.info("[PDF Helper 长期记忆] 已补录当前对话中的明确偏好", {
    storedCount: candidatesToStore.length,
    keys: candidatesToStore.map((candidate) => candidate.key),
  });
}

export async function refreshLongTermMemoryList(): Promise<void> {
  refreshLongTermMemoriesButton.disabled = true;
  try {
    await backfillExplicitMemoriesFromCurrentChat();
    const memories = await memoryTools.list({ limit: 100 });
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
      meta.textContent = `${memory.key} · ${memory.scope}`;
      content.append(meta);

      const remove = document.createElement("button");
      remove.className = "settings-memory-delete";
      remove.type = "button";
      remove.dataset.memoryId = memory.id;
      remove.setAttribute("aria-label", `删除长期记忆：${memory.content}`);
      remove.title = "删除";
      remove.textContent = "×";
      item.append(category, content, remove);
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
