# PDF reader core

Owns PDF.js lifecycle, loading, page navigation, zoom, find, outline, internal navigation history, reading position, and annotated PDF export.

- It must not import assistant, translation, paper-card, or knowledge-base feature internals.
- Expose document state and navigation through `public.ts`.
- Keep a single PDFViewer/EventBus instance owned by the reader controller.
- PDF.js event ordering and annotation restoration behavior must be preserved.
