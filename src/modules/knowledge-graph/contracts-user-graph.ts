/**
 * User-side graph records.
 *
 * Notes, highlights, folders and tags are the user's private material and are
 * projected into the graph as `origin: 'user'` edges. They live in the graph
 * database as a local copy so the graph can render and export offline; the
 * reading features remain the authority for their own content.
 */

export interface GraphNoteRecord {
  noteId: string;
  paperId: string;
  content: string;
  /** Heading or section the note was taken under, when known. */
  sectionTitle: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GraphHighlightRecord {
  highlightId: string;
  paperId: string;
  text: string;
  /** Serialized reader position; opaque to the graph. */
  position: string;
  pageNumber: number | null;
  createdAt: number;
  /**
   * The user's own remark on the highlight, when they wrote one.
   *
   * Present because "why I highlighted this" is the user's material, not the
   * document's; the highlighted text stays the provenance either way.
   */
  note?: string;
}

export interface GraphFolderRecord {
  folderId: string;
  name: string;
  /** Null for a root folder. */
  parentId: string | null;
  createdAt: number;
}

export interface GraphTagRecord {
  tagId: string;
  name: string;
}
