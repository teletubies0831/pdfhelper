import {
  buildFolderEdges,
  buildTagEdges,
  planTagAssignments,
  projectPersonalGraph,
  type GraphUserNode,
  type GraphEdge,
  type PersonalGraphProjection,
  type ProjectPersonalGraphInput,
  type TagAssignment,
} from '../../../modules/knowledge-graph/public';
import {
  listKnowledgeDocuments,
  listKnowledgeFolders,
} from '../knowledge-base/public';
import { readSavedKnowledgeNotes } from '../knowledge-base/public';
import { notesToGraphRecords } from './graph-note-records';
import type { GraphHighlightRecord } from '../../../modules/knowledge-graph/public';

/**
 * Reads the user's own material and projects it into graph form.
 *
 * Sourcing is deliberately narrow: notes from the knowledge store, folders and
 * their paper assignments from the knowledge corpus, and highlights supplied by
 * the caller (they live inside the annotated PDF rather than in a store this
 * feature can read). Anything not yet sourced is simply absent rather than
 * fabricated — a personal graph that invents nodes would be worse than one that
 * shows fewer.
 *
 * The projection itself is pure and lives in the module; this file only reads
 * storage, joins identifiers, and resolves document names to graph paper ids.
 */

export interface PersonalGraphReadResult extends PersonalGraphProjection {
  /** Notes found in storage, before projection. */
  noteCount: number;
  /** Folders found in the knowledge corpus. */
  folderCount: number;
  /** Papers filed in a folder, and therefore carrying `IN_FOLDER` edges. */
  filedPaperCount: number;
  /** Distinct tags in the derived vocabulary. */
  tagCount: number;
  /** Papers carrying at least one tag, and therefore `TAGGED` edges. */
  taggedPaperCount: number;
}

export interface ReadPersonalGraphOptions {
  /**
   * Maps a stored document name to a graph paper id.
   *
   * Notes and highlights are keyed by file name while the graph keys papers by
   * document id, so this is the join. Returning `undefined` is normal: the
   * material then attaches to the user anchor only, and the note's text is still
   * in the graph.
   */
  resolvePaperId: (documentName: string) => string | undefined;
  highlights?: readonly GraphHighlightRecord[];
  /** `KnowledgeFolder` records; read from the corpus when omitted. */
  folders?: readonly {
    folderId: string;
    name: string;
    parentId: string | null;
    createdAt: number;
  }[];
  tags?: ProjectPersonalGraphInput['tags'];
  /**
   * Raw tag assignments: document name plus the tag strings on that document.
   *
   * Supplied by the caller because collecting them runs the knowledge
   * synchronisation pass, which must not happen on every graph render.
   */
  tagAssignments?: readonly TagAssignment[];
  /** Graph paper ids, used to skip filing edges for papers not in the graph. */
  paperIds?: readonly string[];
  now?: number;
}

export function readPersonalGraph(options: ReadPersonalGraphOptions): PersonalGraphReadResult {
  const notes = notesToGraphRecords(readSavedKnowledgeNotes());

  // Folders come from the knowledge corpus unless the caller supplies its own.
  // `KnowledgeLibraryDocument.documentId` is the same identifier the graph uses as
  // `paperId`, so the filing join is exact rather than a name match.
  const folders = options.folders
    ? options.folders.map((folder) => ({ ...folder }))
    : listKnowledgeFolders().map((folder) => ({
      folderId: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      createdAt: Date.parse(folder.createdAt) || Date.now(),
    }));
  const documents = listKnowledgeDocuments();

  // Tags are supplied by the caller rather than collected here: collecting means
  // running the knowledge synchronisation pass, which is far too heavy to trigger
  // on every graph render. The caller collects once and passes the result.
  const tagPlan = planTagAssignments(options.tagAssignments ?? []);

  const projection = projectPersonalGraph({
    notes,
    highlights: options.highlights ?? [],
    folders,
    tags: tagPlan.tags,
    resolvePaperId: options.resolvePaperId,
    now: options.now,
  });

  // Filing and tagging edges are keyed by paper rather than by a personal record,
  // so they are built here and appended: a paper can be filed or tagged with no
  // note existing, and the folder tree or tag vocabulary can change with no note
  // changing.
  const knownPaperIds = new Set(options.paperIds ?? []);
  const paperEdges: GraphEdge[] = [];
  let filedPaperCount = 0;
  let taggedPaperCount = 0;
  for (const document of documents) {
    // Skip papers that are not in the graph projection: an edge to a paper the
    // renderer does not have would be dropped anyway, and counting it would
    // overstate what the user can see.
    const known = !knownPaperIds.size || knownPaperIds.has(document.documentId);
    if (!known) continue;
    if (document.folderId) {
      filedPaperCount += 1;
      paperEdges.push(
        ...buildFolderEdges(document.documentId, document.folderId, folders, options.now),
      );
    }
    const tagIds = tagPlan.tagsByPaperId.get(document.documentId);
    if (tagIds?.length) {
      taggedPaperCount += 1;
      paperEdges.push(
        ...buildTagEdges(document.documentId, tagIds, tagPlan.tags, options.now),
      );
    }
  }

  return {
    ...projection,
    edges: [...projection.edges, ...paperEdges],
    noteCount: notes.length,
    folderCount: folders.length,
    filedPaperCount,
    tagCount: tagPlan.tags.length,
    taggedPaperCount,
  };
}

/** Re-exported so callers do not need a second import for the node type. */
export type { GraphUserNode, GraphEdge };
