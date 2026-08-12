import {
  paperCardReturnTarget,
  resolvedReadingMode,
} from "../../core/pdf-reader/public";
import { pdfDocument } from "../../app/viewer-state";
import { openPaperCardPage } from "../paper-card/public";
import { openKnowledgeEditor } from "./knowledge-editor-dialog";
import { setKnowledgePageStatus } from "./knowledge-domain";

/**
 * Knowledge-base primary action.
 *
 * Paper mode deliberately starts a fresh paper-card generation run, matching
 * the reference paper-card workflow. Saved cards are reviewed through the
 * knowledge library and do not regenerate when opened there.
 */
export function addCurrentPdfToKnowledgeLibrary(): void {
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
