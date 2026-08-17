import { type PDFDocumentProxy } from "pdfjs-dist";
import { browser } from "wxt/browser";
import { type AiMemoryCandidate, type AiRuntimeResponse } from "../../../../shared/ai";
import { type LongTermMemory } from "../../../../shared/memory";
import { memoryTools } from "../../../../entrypoints/viewer/memory-store";
import { chatHistory } from "../../core/pdf-reader/public";
import { updateChatActivity } from "../../shared-ui/markdown/markdown-renderer";
import { assistantSettingsPanel } from "../../app/viewer-elements";

import { getDisplayFileName } from "../../core/pdf-reader/public";
import { getDocumentChatId } from './chat-session';

import { createLocalExplicitMemoryCandidates, findConfirmedMemoryProposal } from "./memory-candidate-parser";
import { refreshLongTermMemoryList } from "./memory-list";

export async function loadLongTermMemoryContext(
  documentProxy: PDFDocumentProxy | null,
): Promise<{ text: string; memories: LongTermMemory[] }> {
  try {
    const documentId = documentProxy ? getDocumentChatId(documentProxy) : "";
    const all = await memoryTools.list({ limit: 100 });
    const relevant = all
      .filter((memory) =>
        memory.scope === "global" ||
        memory.scope === "project" ||
        (memory.scope === "pdf" && memory.scopeId === documentId),
      )
      .sort(
        (left, right) =>
          right.importance + right.confidence -
          (left.importance + left.confidence),
      )
      .slice(0, 10);
    const text = relevant
      .map(
        (memory) =>
          `- [${memory.category}/${memory.key}] ${memory.content}`,
      )
      .join("\n");
    console.info("[PDFPal 长期记忆] 本轮检索", {
      documentId: documentId || undefined,
      count: relevant.length,
      memories: relevant,
    });
    return { text, memories: relevant };
  } catch (error) {
    console.warn("[PDFPal 长期记忆] 检索失败，本轮不注入长期记忆", error);
    return { text: "", memories: [] };
  }
}

export async function extractAndStoreLongTermMemories(
  userMessage: string,
  assistantMessage: string,
  documentProxy: PDFDocumentProxy | null,
  documentName: string,
  requestId?: string,
  assistantElement?: HTMLElement,
): Promise<void> {
  const currentUserIndex = chatHistory.value.findLastIndex(
    (message) => message.role === "user" && message.content.trim() === userMessage.trim(),
  );
  const confirmedMemoryProposal = findConfirmedMemoryProposal(
    chatHistory.value,
    currentUserIndex,
  );
  const durableMemorySignal =
    /记住|以后|今后|长期|一直|默认|偏好|我(?:更)?喜欢|我希望|我习惯|我的研究方向|我(?:主要|目前|现在)研究|我的项目|项目目标|回答时|不要再|改为/i;
  if (!durableMemorySignal.test(userMessage) && !confirmedMemoryProposal) {
    console.debug("[PDFPal 长期记忆] 本轮没有持续性表达，跳过异步提取", {
      requestId,
    });
    return;
  }
  if (assistantElement) {
    updateChatActivity(
      assistantElement,
      "long-term-memory",
      "长期记忆工具正在更新",
      "active",
    );
  }
  try {
    const documentId = documentProxy ? getDocumentChatId(documentProxy) : undefined;
    const existing = await memoryTools.list({ limit: 100 });
    console.info("[PDFPal 长期记忆] 异步提取开始", {
      requestId,
      documentId,
      userMessage,
    });
    const response = (await browser.runtime.sendMessage({
      type: "pdf-helper:ai-extract-long-term-memory",
      userMessage,
      assistantMessage,
      confirmedMemoryProposal: confirmedMemoryProposal || undefined,
      documentId,
      documentName: documentName
        ? getDisplayFileName(documentName)
        : undefined,
      existingMemories: existing.map((memory) => ({
        key: memory.key,
        content: memory.content,
        scope: memory.scope,
        scopeId: memory.scopeId,
      })),
    })) as AiRuntimeResponse;
    if (!response?.ok) throw new Error(response?.error || "长期记忆提取失败。");

    const fixedProgramRulePattern =
      /latex|markdown|api\s*key|原文引用|查看原文|点击定位|截图优先|全文注入|公式渲染/i;
    const localCandidates = [
      ...createLocalExplicitMemoryCandidates(userMessage),
      ...(confirmedMemoryProposal
        ? createLocalExplicitMemoryCandidates(`请记住：${confirmedMemoryProposal}`)
        : []),
    ];
    const mergedCandidates = new Map<string, AiMemoryCandidate>();
    for (const candidate of response.memoryCandidates ?? []) {
      mergedCandidates.set(candidate.key, candidate);
    }
    for (const candidate of localCandidates) {
      if (candidate.key.startsWith("profile.personal.likes.")) {
        // A provider may use the old singleton key for a multi-value fact.
        // Prefer the deterministic local key so separate likes can coexist.
        mergedCandidates.delete("profile.personal.likes");
      }
      mergedCandidates.set(candidate.key, candidate);
    }
    const candidates = [...mergedCandidates.values()].filter(
      (candidate) =>
        candidate.sourceType === "explicit" &&
        candidate.confidence >= 0.9 &&
        !fixedProgramRulePattern.test(`${candidate.key} ${candidate.content}`),
    );
    console.info("[PDFPal 工具调用] memory.upsert", {
      requestId,
      confirmedMemoryProposal: confirmedMemoryProposal || undefined,
      candidates,
      execution: "async-after-response",
    });
    const legacyLikesMemories = candidates.some((candidate) =>
      candidate.key.startsWith("profile.personal.likes."),
    )
      ? existing.filter((memory) => memory.key === "profile.personal.likes")
      : [];
    const stored = await Promise.all(
      candidates.map((candidate) =>
        memoryTools.upsert({
          key: candidate.key,
          category: candidate.category,
          content: candidate.content,
          scope: candidate.scope,
          scopeId: candidate.scope === "pdf" ? documentId : undefined,
          confidence: candidate.confidence,
          importance: candidate.importance,
          sourceType: "explicit",
          sourceConversationId: requestId,
          sourcePdfId: documentId,
        }),
      ),
    );
    if (legacyLikesMemories.length > 0) {
      await Promise.all(
        legacyLikesMemories.map((memory) => memoryTools.forget(memory.id)),
      );
      console.info("[PDFPal 长期记忆] 已移除旧的单值喜好记录", {
        removed: legacyLikesMemories,
      });
    }
    const logPayload = {
      requestId,
      candidateCount: response.memoryCandidates?.length ?? 0,
      localCandidateCount: localCandidates.length,
      storedCount: stored.length,
      stored,
    };
    if (stored.length > 0) {
      console.info("[PDFPal 工具结果] memory.upsert", stored);
      console.info("[PDFPal 长期记忆] 写入成功", logPayload);
      if (assistantElement) {
        updateChatActivity(
          assistantElement,
          "long-term-memory",
          "长期记忆工具已更新",
          "done",
          `${stored.length} 条`,
        );
      }
    } else {
      console.info("[PDFPal 长期记忆] 本轮没有可写入条目", logPayload);
      if (assistantElement) {
        updateChatActivity(
          assistantElement,
          "long-term-memory",
          "长期记忆工具未发现新条目",
          "done",
        );
      }
    }
    if (!assistantSettingsPanel.hidden) void refreshLongTermMemoryList();
  } catch (error) {
    console.warn("[PDFPal 长期记忆] 异步提取失败，不影响当前回答", error);
    if (assistantElement) {
      updateChatActivity(
        assistantElement,
        "long-term-memory",
        "长期记忆工具更新失败",
        "error",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
