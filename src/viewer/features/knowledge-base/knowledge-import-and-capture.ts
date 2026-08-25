import { selectedKnowledgeRecordKey } from "../../core/pdf-reader/public";
import { knowledgeImportInput } from "../../app/viewer-elements";
import type { SavedKnowledgeNote } from "../../core/pdf-reader/public";
import { renderKnowledgeBase } from './knowledge-base-controller';

import { getKnowledgeRecordKey, normalizeKnowledgeTags, readSavedKnowledgeNotes, writeSavedKnowledgeNotes } from './knowledge-repository';
import { getKnowledgeExcerpt, setKnowledgePageStatus } from './knowledge-domain';


export async function importKnowledgeNotes(file: File): Promise<void> {
  try {
    const parsed = JSON.parse(await file.text()) as unknown;
    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { notes?: unknown }).notes)
        ? (parsed as { notes: unknown[] }).notes
        : parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { items?: unknown }).items)
          ? (parsed as { items: unknown[] }).items
          : [];
    const imported: SavedKnowledgeNote[] = [];
    const now = new Date().toISOString();
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const value = candidate as Record<string, unknown>;
      const title = typeof value.title === "string" ? value.title.trim() : "";
      const content =
        typeof value.content === "string" ? value.content.trim() : "";
      if (!title && !content) continue;
      imported.push({
        id: crypto.randomUUID(),
        title: title || getKnowledgeExcerpt(content).slice(0, 40) || "导入笔记",
        content,
        documentName:
          typeof value.documentName === "string" && value.documentName.trim()
            ? value.documentName.trim()
            : "导入内容",
        pageNumber:
          typeof value.pageNumber === "number" &&
          Number.isFinite(value.pageNumber)
            ? Math.max(1, Math.round(value.pageNumber))
            : undefined,
        positionLabel:
          typeof value.positionLabel === "string" && value.positionLabel.trim()
            ? value.positionLabel.trim()
            : "导入内容",
        category:
          typeof value.category === "string" && value.category.trim()
            ? value.category.trim()
            : "导入笔记",
        tags: normalizeKnowledgeTags(value.tags),
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!imported.length) throw new Error("文件中没有可识别的笔记。");
    writeSavedKnowledgeNotes([...imported, ...readSavedKnowledgeNotes()]);
    selectedKnowledgeRecordKey.value = getKnowledgeRecordKey(
      "knowledge-note",
      imported[0]!.id,
    );
    setKnowledgePageStatus(`已导入 ${imported.length} 条笔记。`);
    renderKnowledgeBase();
  } catch (error) {
    setKnowledgePageStatus(
      `导入失败：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  } finally {
    knowledgeImportInput.value = "";
  }
}
