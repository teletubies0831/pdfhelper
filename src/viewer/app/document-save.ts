import { updateControls } from "../core/pdf-reader/public";
import {
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
    const { bytes, count } = await embedHelperAnnotationsIntoPdf();
    const result = await writeEmbeddedPdfBytes(bytes);
    sourcePdfBytes.value = new Uint8Array(bytes);
    markSavedChanges();
    if (result === "overwritten") {
      setStatus(`批注已嵌入当前 PDF（${count} 条）。`);
    } else if (result === "permission-denied-downloaded") {
      setStatus(
        `未获得覆盖原文件的写入权限，已下载带 PDFPal 数据的新 PDF（${count} 条）。`,
      );
    } else {
      setStatus(
        `当前打开方式不能覆盖原文件，已下载带 PDFPal 数据的新 PDF（${count} 条）。`,
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
