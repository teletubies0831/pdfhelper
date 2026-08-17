

import { currentFileHandle, pdfDocument, sourceName, sourcePdfBytes } from "../../app/viewer-state";


import type { FileHandleLike, FileHandlePermissionDescriptor } from "../../app/viewer-types";
import { createEmbeddedHelperPayload } from "./embedded-helper-payload";
import { PDF_HELPER_ATTACHMENT_DESCRIPTION, PDF_HELPER_ATTACHMENT_NAME } from "./annotation-value-codec";
import { safeDecodeURIComponent } from "./annotation-ui-state";

export async function embedHelperAnnotationsIntoPdf(): Promise<{
  bytes: Uint8Array;
  count: number;
}> {
  if (!pdfDocument.value || !sourcePdfBytes.value)
    throw new Error("PDF 尚未打开，无法保存批注。");
  const payload = createEmbeddedHelperPayload();
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  const { PDFDocument: PdfLibDocument } = await import("pdf-lib");
  const pdfDoc = await PdfLibDocument.load(sourcePdfBytes.value, {
    ignoreEncryption: true,
  });
  const now = new Date();

  await pdfDoc.attach(jsonBytes, PDF_HELPER_ATTACHMENT_NAME, {
    mimeType: "application/json",
    description: PDF_HELPER_ATTACHMENT_DESCRIPTION,
    creationDate: now,
    modificationDate: now,
  });

  const bytes = await pdfDoc.save();
  (pdfDocument.value as any).annotationStorage?.resetModified?.();
  return { bytes, count: payload.entries.length };
}

export async function requestFileWritePermission(
  fileHandle: FileHandleLike,
): Promise<boolean> {
  const descriptor: FileHandlePermissionDescriptor = { mode: "readwrite" };

  try {
    const currentPermission = await fileHandle.queryPermission?.(descriptor);
    if (currentPermission === "granted") return true;

    if (fileHandle.requestPermission) {
      const requestedPermission =
        await fileHandle.requestPermission(descriptor);
      return requestedPermission === "granted";
    }

    return currentPermission !== "denied";
  } catch {
    // Some browser/extension combinations do not expose permission helpers but
    // still prompt from createWritable(). Let that path decide.
    return true;
  }
}

export function downloadEmbeddedPdfBytes(blob: Blob) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const baseName =
    sourceName.value
      .split("/")
      .pop()
      ?.replace(/\.pdf$/i, "") || "document";
  link.href = blobUrl;
  link.download = `${safeDecodeURIComponent(baseName)}-pdfpal.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}

export async function writeEmbeddedPdfBytes(
  bytes: Uint8Array,
): Promise<"overwritten" | "downloaded" | "permission-denied-downloaded"> {
  const blobBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(blobBuffer).set(bytes);
  const blob = new Blob([blobBuffer], { type: "application/pdf" });

  if (currentFileHandle.value) {
    const hasWritePermission =
      await requestFileWritePermission(currentFileHandle.value);
    if (!hasWritePermission) {
      downloadEmbeddedPdfBytes(blob);
      return "permission-denied-downloaded";
    }

    try {
      const writable = await currentFileHandle.value.createWritable();
      await writable.write(blob);
      await writable.close();
      return "overwritten";
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotAllowedError"))
        throw error;
      downloadEmbeddedPdfBytes(blob);
      return "permission-denied-downloaded";
    }
  }

  downloadEmbeddedPdfBytes(blob);
  return "downloaded";
}
