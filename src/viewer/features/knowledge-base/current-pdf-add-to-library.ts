import {
  paperCardReturnTarget,
  resolvedReadingMode,
} from "../../core/pdf-reader/public";
import { pdfDocument } from "../../app/viewer-state";
import { openPaperCardPage } from "../paper-card/public";
import { openKnowledgeEditor } from "./knowledge-editor-dialog";
import { setKnowledgePageStatus } from "./knowledge-domain";

/**
 * Main knowledge-library action.
 * In paper mode this intentionally behaves like the reference
 * "论文阅读卡片" toolbar entry: open the full card page and generate now.
 */
export function addCurrentPdfToLibrary(): void {
  if (!pdfDocument.value) {
    setKnowledgePageStatus("请先打开 PDF，再添加当前 PDF 到知识库。", true);
    return;
  }

  if (resolvedReadingMode.value === "paper") {
    openPaperCardPage();
    paperCardReturnTarget.value = "knowledge";
    return;
  }

  openKnowledgeEditor();
}
