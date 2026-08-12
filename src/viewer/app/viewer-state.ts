import { AnnotationMode, AnnotationEditorType, type AnnotationEditorUIManager, type PDFDocumentProxy } from "pdfjs-dist";




import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";



import { type DocumentAgentRecord, type DocumentChunk } from "../../../shared/document-agent";







import { viewerContainer, viewerElement } from './viewer-elements';
import type { FileHandleLike } from './viewer-types';
import type { InternalNavigationEntry, ReadingPosition } from '../features/recent-files/public';



export const eventBus = new EventBus();

export const linkService = new PDFLinkService({ eventBus });

export const findController = new PDFFindController({ eventBus, linkService });

export const pdfViewer = new PDFViewer({
  container: viewerContainer,
  viewer: viewerElement,
  eventBus,
  linkService,
  findController,
  // Keep the PDF annotation layer enabled so native internal citations and
  // external links remain interactive. PDF Helper's own editor layer stays
  // independent from it.
  annotationMode: AnnotationMode.ENABLE,
  annotationEditorHighlightColors:
    "yellow=#FFF066,green=#9BE7A5,blue=#8EC5FF,pink=#FF9FC9,orange=#FFC078",
  removePageBorders: false,
  enableAutoLinking: true,
});


export let pdfDocument: { value: PDFDocumentProxy | null } = { value: null };

export let sourceName = { value: "" };

export const documentKnowledgeCache = new Map<string, {
  record: DocumentAgentRecord;
  chunks: DocumentChunk[];
}>();

export const documentKnowledgeTasks = new Map<string, Promise<{
  record: DocumentAgentRecord;
  chunks: DocumentChunk[];
}>>();

export let annotationEditor: { value: AnnotationEditorUIManager | null } = { value: null };

export let activeEditorMode = { value: AnnotationEditorType.NONE };

export let canUndoAnnotation = { value: false };

export let canRedoAnnotation = { value: false };

export let hasUnsavedChanges = { value: false };

export let savedAnnotationSnapshot = { value: "" };

export let unsavedChangesCheckHandle: { value: number | null } = { value: null };

export let isOpeningDocument = { value: false };

export let isSavingAnnotatedPdf = { value: false };

export let restoredAnnotationWarmUpPending = { value: false };

export let annotationEditorWarmUpInFlight = { value: false };

export let currentFileHandle: { value: FileHandleLike | null } = { value: null };

export let currentRecentEntryId: { value: string | null } = { value: null };

export let pendingReadingPosition: { value: ReadingPosition | null } = { value: null };

export let lastReadingPosition: { value: ReadingPosition | null } = { value: null };

export let readingPositionSaveHandle: { value: number | null } = { value: null };

export let isRestoringReadingPosition = { value: false };

export let suppressInternalNavigationCapture = { value: false };

export let isReturningFromInternalNavigation = { value: false };

export const internalNavigationHistory: InternalNavigationEntry[] = [];

export let areNoteIndicatorsHidden = { value: false };

export let sourcePdfBytes: { value: Uint8Array | null } = { value: null };

export let contextSelectionRanges: { value: Range[] } = { value: [] };

export let contextSelectionText = { value: "" };

export let selectedAnnotationEditor: { value: any | null } = { value: null };

export let selectedHighlightEditor: { value: any | null } = { value: null };

export let contextHighlightEditor: { value: any | null } = { value: null };

export let openHighlightNoteEditor: { value: any | null } = { value: null };

export const nativeAnnotationNotes = new Map<string, string>();

export const restoredHelperNotesBySignature = new Map<string, string>();

export const restoredHelperNotesByStorageKey = new Map<string, string>();

export let lastPointerDown: { value: {
  x: number;
  y: number;
  button: number;
} | null } = { value: null };
