import { updateControls } from "../core/pdf-reader/public";
import {
  hasUnsavedChanges,
  isSavingAnnotatedPdf,
  pdfDocument,
  sourcePdfBytes,
} from "./viewer-state";
import {
  embedHelperAnnotationsIntoPdf,
  markSavedChanges,
  writeEmbeddedPdfBytes,
} from "../features/annotations/public";
import { setStatus } from "./status-bar";

/**
 * Annotated-PDF export orchestration: embeds PDFPal annotations into the PDF
 * bytes and writes the result back (or downloads it). Lives in the app
 * assembly layer; the PDF core stays free of feature imports.
 */
export async function saveAnnotatedPdf(): Promise<boolean> {
  if (!pdfDocument.value || isSavingAnnotatedPdf.value) return false;
  isSavingAnnotatedPdf.value = true;
  updateControls();

  try {
    setStatus("正在把 PDFPal 批注嵌入 PDF…");
    const { bytes, count, snapshot } = await embedHelperAnnotationsIntoPdf();
    const result = await writeEmbeddedPdfBytes(bytes);
    sourcePdfBytes.value = new Uint8Array(bytes);
    // The baseline is what went into the file, not what is on screen now: anything added while the bytes were being
    // written stays unsaved (and keeps its close-tab prompt) instead of being silently reported as saved.
    markSavedChanges(snapshot);
    const pendingNote = hasUnsavedChanges.value ? " 保存期间新增的批注尚未写入，再保存一次即可。" : "";
    if (result === "overwritten") {
      setStatus(`批注已嵌入当前 PDF（${count} 条）。${pendingNote}`);
    } else if (result === "permission-denied-downloaded") {
      setStatus(
        `未获得覆盖原文件的写入权限，已下载带 PDFPal 数据的新 PDF（${count} 条）。知识库仍指向原文件：打开刚下载的这份并点一次“添加到知识库”，会把原来的记录指向它（不会重复添加）。${pendingNote}`,
      );
    } else {
      setStatus(
        `当前打开方式不能覆盖原文件，已下载带 PDFPal 数据的新 PDF（${count} 条）。知识库仍指向原文件：打开刚下载的这份并点一次“添加到知识库”，会把原来的记录指向它（不会重复添加）。${pendingNote}`,
      );
    }
    return true;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    return false;
  } finally {
    isSavingAnnotatedPdf.value = false;
    updateControls();
  }
}
