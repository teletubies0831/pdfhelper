import type { PDFDocumentProxy } from "pdfjs-dist";

import type { LongTermMemory } from "../../../modules/memory/public";
import { memoryTools } from "../../../../entrypoints/viewer/memory-store";
import { getDocumentChatId } from "./chat-session";

export async function loadLongTermMemoryContext(
  documentProxy: PDFDocumentProxy | null,
): Promise<{ text: string; memories: LongTermMemory[] }> {
  try {
    const documentId = documentProxy ? getDocumentChatId(documentProxy) : "";
    const all = await memoryTools.list({ limit: 100 });
    const relevant = all
      .filter((memory) =>
        memory.scope === "global"
        || memory.scope === "project"
        || (memory.scope === "pdf" && memory.scopeId === documentId),
      )
      .sort(
        (left, right) =>
          right.importance + right.confidence
          - (left.importance + left.confidence),
      )
      .slice(0, 10);
    const text = relevant
      .map((memory) => `- [${memory.category}/${memory.key}] ${memory.content}`)
      .join("\n");
    console.info("[PDFPal 长期记忆] 本轮上下文", {
      documentId: documentId || undefined,
      count: relevant.length,
    });
    return { text, memories: relevant };
  } catch (error) {
    console.warn("[PDFPal 长期记忆] 读取失败，本轮不注入长期记忆", error);
    return { text: "", memories: [] };
  }
}
