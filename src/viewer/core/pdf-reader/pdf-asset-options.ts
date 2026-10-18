/**
 * Asset URLs every PDF parse in this extension must pass to PDF.js.
 *
 * PDF.js 5 ships three decoders separately from the bundle: JBIG2 (the format
 * scanned pages are almost always encoded in), JPEG 2000, and the colour-management
 * module. Without them the *page still "loads"* — which is what makes the failure so
 * confusing: a scanned page renders as an empty white sheet while its OCR text layer
 * extracts perfectly, so search and indexing keep working and only the human reading
 * the document sees nothing. The decoders are copied into the extension by
 * `public/pdfjs-wasm/` and located through `wasmUrl`.
 *
 * `cMapUrl` is the same class of problem for CJK documents: a PDF that relies on a
 * predefined CMap needs those tables to map character codes to Unicode, so without
 * them Chinese/Japanese/Korean text either fails to render or extracts as garbage.
 * The tables live in `public/pdfjs-cmaps/`.
 *
 * Kept dependency-free and in one place on purpose: four call sites parse PDFs (the
 * reader, the knowledge-library reader, "add current PDF to the library", and the
 * selection page), and a missing option at any one of them is a silent rendering or
 * text-quality bug rather than an error.
 */
export interface PdfAssetOptions {
  standardFontDataUrl: string;
  wasmUrl: string;
  cMapUrl: string;
  /** The shipped CMaps are packed (`.bcmap`), which is also what `cMapUrl` expects. */
  cMapPacked: boolean;
}

export function buildPdfAssetOptions(baseUrl: string = window.location.href): PdfAssetOptions {
  return {
    standardFontDataUrl: new URL("pdfjs-standard-fonts/", baseUrl).href,
    wasmUrl: new URL("pdfjs-wasm/", baseUrl).href,
    cMapUrl: new URL("pdfjs-cmaps/", baseUrl).href,
    cMapPacked: true,
  };
}
