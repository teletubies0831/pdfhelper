import {
  type GraphEdge,
  type GraphEvidence,
  type GraphUserNode,
} from '../contracts.ts';
import type {
  GraphFolderRecord,
  GraphHighlightRecord,
  GraphNoteRecord,
  GraphTagRecord,
} from '../contracts-user-graph.ts';
import { createEdgeOriginKey, createGraphId } from '../domain/graph-identity.ts';

/**
 * Personal graph projection.
 *
 * Turns the user's own material — notes, highlights, folders, tags — into graph
 * nodes and edges. Two design rules shape everything here:
 *
 * 1. **User data is private by default.** Every edge is `origin: 'user'`, which is
 *    what the renderer uses to draw it distinctly and what the inspector uses to
 *    label it as the user's own annotation rather than a model's conclusion.
 * 2. **A folder is a hub, and a tag is a hub.** Filing three notes under
 *    "Chapter 2" is a claim that those notes belong together; rendering folders
 *    and tags as real nodes is what makes the user's own structure visible
 *    instead of flattening it into the papers.
 *
 * All functions here are pure. Reading the stores and resolving a document name to
 * a graph paper id are the caller's job, injected through `resolvePaperId`, so the
 * projection can be tested without a browser, a database or a PDF.
 */

export const USER_NODE_ID = 'user:self';

/** Excerpt length kept as evidence for a note. */
const NOTE_EXCERPT_LENGTH = 120;

export interface PersonalGraphInput {
  notes?: readonly GraphNoteRecord[];
  highlights?: readonly GraphHighlightRecord[];
  folders?: readonly GraphFolderRecord[];
  tags?: readonly GraphTagRecord[];
  /**
   * Maps a stored document name to a graph paper id.
   *
   * Injected because the graph keys papers by document id while notes and
   * highlights are keyed by file name. Returning `undefined` means "this material
   * cannot be attached to a paper", and it is then linked to the user anchor
   * only — the note still exists in the graph, it just has no document to hang
   * from, which is strictly better than dropping the user's text.
   */
  resolvePaperId: (documentName: string) => string | undefined;
  now?: number;
}

export interface PersonalGraphProjection {
  nodes: GraphUserNode[];
  edges: GraphEdge[];
  /** Notes and highlights whose document name could not be resolved. */
  unresolvedPaperCount: number;
}

/**
 * The graph's edge and user-node record types, re-exported from the contract so
 * callers of this module do not need a second import.
 */
export type { GraphEdge, GraphUserNode };

export function noteNodeId(noteId: string): string {
  return `note:${noteId}`;
}

export function highlightNodeId(highlightId: string): string {
  return `highlight:${highlightId}`;
}

export function folderNodeId(folderId: string): string {
  return `folder:${folderId}`;
}

export function tagNodeId(tagId: string): string {
  return `tag:${tagId}`;
}

/** Truncates a note into a usable quote without cutting mid-word where avoidable. */
function excerpt(text: string, limit = NOTE_EXCERPT_LENGTH): string {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  if (collapsed.length <= limit) return collapsed;
  const clipped = collapsed.slice(0, limit);
  const lastSpace = clipped.lastIndexOf(' ');
  const base = lastSpace > limit * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${base}…`;
}

function edge(input: {
  source: string;
  sourceKind: GraphEdge['sourceKind'];
  target: string;
  targetKind: GraphEdge['targetKind'];
  type: GraphEdge['type'];
  originKey: string;
  sourcePaperId?: string | null;
  evidence?: GraphEvidence[];
  now: number;
}): GraphEdge {
  return {
    edgeId: createGraphId('edge'),
    source: input.source,
    sourceKind: input.sourceKind,
    target: input.target,
    targetKind: input.targetKind,
    type: input.type,
    // User assertions are not probabilities: the user said it, so confidence is 1.
    confidence: 1,
    evidence: input.evidence ?? [],
    sourcePaperId: input.sourcePaperId ?? null,
    origin: 'user',
    originKey: input.originKey,
    provenance: {},
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Walks from a folder up to the root.
 *
 * Returns the folder itself first, then its ancestors. The chain is what lets
 * filing a note in `Chapter 2 / Methods` also place it in `Methods`, which is the
 * behaviour a user expects from a tree — and it is why the projection emits one
 * `IN_FOLDER` edge per level rather than only the leaf.
 *
 * Cycles are guarded with a visited set: a corrupt `parentId` loop must not hang
 * the graph.
 */
export function collectFolderAncestors(
  folderId: string,
  foldersById: ReadonlyMap<string, GraphFolderRecord>,
): GraphFolderRecord[] {
  const chain: GraphFolderRecord[] = [];
  const visited = new Set<string>();
  let current = foldersById.get(folderId);
  while (current && !visited.has(current.folderId)) {
    visited.add(current.folderId);
    chain.push(current);
    current = current.parentId ? foldersById.get(current.parentId) : undefined;
  }
  return chain;
}

export function projectPersonalGraph(input: PersonalGraphInput): PersonalGraphProjection {
  const now = input.now ?? Date.now();
  const nodes: GraphUserNode[] = [];
  const edges: GraphEdge[] = [];
  // Keyed by origin key so a re-projection of unchanged data produces the same
  // edge set, and the unique index then makes the write a no-op.
  const edgeByOriginKey = new Map<string, GraphEdge>();

  const foldersById = new Map((input.folders ?? []).map((folder) => [folder.folderId, folder]));
  const tagsById = new Map((input.tags ?? []).map((tag) => [tag.tagId, tag]));

  // The anchor exists only when there is personal material to anchor.
  const hasPersonalMaterial = Boolean(
    (input.notes ?? []).length
    || (input.highlights ?? []).length
    || (input.folders ?? []).length
    || (input.tags ?? []).length,
  );
  if (hasPersonalMaterial) {
    nodes.push({
      id: USER_NODE_ID,
      kind: 'user',
      label: '我的标注',
      createdAt: now,
    });
  }

  for (const folder of input.folders ?? []) {
    nodes.push({
      id: folderNodeId(folder.folderId),
      kind: 'folder',
      label: folder.name,
      createdAt: folder.createdAt,
    });
  }

  for (const tag of input.tags ?? []) {
    nodes.push({
      id: tagNodeId(tag.tagId),
      kind: 'tag',
      label: tag.name,
      createdAt: now,
    });
  }

  let unresolvedPaperCount = 0;

  for (const note of input.notes ?? []) {
    const nodeId = noteNodeId(note.noteId);
    nodes.push({
      id: nodeId,
      kind: 'note',
      label: note.sectionTitle?.trim() || excerpt(note.content, 40) || '笔记',
      paperId: undefined,
      createdAt: note.createdAt,
    });

    edgeByOriginKey.set(
      createEdgeOriginKey(USER_NODE_ID, nodeId, 'ANNOTATED_AS', false),
      edge({
        source: USER_NODE_ID,
        sourceKind: 'user',
        target: nodeId,
        targetKind: 'note',
        type: 'ANNOTATED_AS',
        originKey: createEdgeOriginKey(USER_NODE_ID, nodeId, 'ANNOTATED_AS', false),
        now,
      }),
    );

    const paperId = input.resolvePaperId(note.paperId);
    if (paperId) {
      // The note's own text is the evidence: it is the user's words about a
      // specific paper, and the inspector should be able to show it in place.
      const quote = excerpt(note.content);
      const evidence: GraphEvidence[] = [{
        paperId,
        pageNumber: 1,
        quote,
        ...(note.sectionTitle ? { chunkHeading: note.sectionTitle } : {}),
      }];
      edgeByOriginKey.set(
        createEdgeOriginKey(nodeId, paperId, 'ANNOTATED_AS', false),
        edge({
          source: nodeId,
          sourceKind: 'note',
          target: paperId,
          targetKind: 'paper',
          type: 'ANNOTATED_AS',
          originKey: createEdgeOriginKey(nodeId, paperId, 'ANNOTATED_AS', false),
          sourcePaperId: paperId,
          evidence,
          now,
        }),
      );
    } else {
      unresolvedPaperCount += 1;
    }
  }

  for (const highlight of input.highlights ?? []) {
    const nodeId = highlightNodeId(highlight.highlightId);
    nodes.push({
      id: nodeId,
      kind: 'highlight',
      // The user's own remark labels the node when they wrote one: "why I
      // highlighted this" is more informative than the sentence itself when the
      // graph is dense. The highlighted text remains the evidence either way.
      label: excerpt(highlight.note ?? '', 40) || excerpt(highlight.text, 40) || '高亮',
      createdAt: highlight.createdAt,
    });

    edgeByOriginKey.set(
      createEdgeOriginKey(USER_NODE_ID, nodeId, 'HIGHLIGHTED', false),
      edge({
        source: USER_NODE_ID,
        sourceKind: 'user',
        target: nodeId,
        targetKind: 'highlight',
        type: 'HIGHLIGHTED',
        originKey: createEdgeOriginKey(USER_NODE_ID, nodeId, 'HIGHLIGHTED', false),
        now,
      }),
    );

    const paperId = input.resolvePaperId(highlight.paperId);
    if (paperId) {
      // A highlight is the strongest provenance in the graph: the user selected
      // this exact text, so it becomes the edge evidence verbatim.
      const evidence: GraphEvidence[] = [{
        paperId,
        pageNumber: highlight.pageNumber ?? 1,
        quote: excerpt(highlight.text),
      }];
      edgeByOriginKey.set(
        createEdgeOriginKey(nodeId, paperId, 'HIGHLIGHTED', false),
        edge({
          source: nodeId,
          sourceKind: 'highlight',
          target: paperId,
          targetKind: 'paper',
          type: 'HIGHLIGHTED',
          originKey: createEdgeOriginKey(nodeId, paperId, 'HIGHLIGHTED', false),
          sourcePaperId: paperId,
          evidence,
          now,
        }),
      );
    } else {
      unresolvedPaperCount += 1;
    }
  }

  return {
    nodes,
    edges: [...edgeByOriginKey.values()],
    unresolvedPaperCount,
  };
}

/**
 * Filing edges for one paper: the paper belongs to its folder and every ancestor.
 *
 * Emitted separately from `projectPersonalGraph` because it is keyed by paper
 * rather than by a personal record — a paper can be filed without any note
 * existing, and the folder tree can change without any note changing.
 */
export function buildFolderEdges(
  paperId: string,
  folderId: string | null | undefined,
  folders: readonly GraphFolderRecord[],
  now = Date.now(),
): GraphEdge[] {
  if (!folderId) return [];
  const foldersById = new Map(folders.map((folder) => [folder.folderId, folder]));
  return collectFolderAncestors(folderId, foldersById).map((folder) => {
    const originKey = createEdgeOriginKey(paperId, folderNodeId(folder.folderId), 'IN_FOLDER', false);
    return edge({
      source: paperId,
      sourceKind: 'paper',
      target: folderNodeId(folder.folderId),
      targetKind: 'folder',
      type: 'IN_FOLDER',
      originKey,
      sourcePaperId: paperId,
      now,
    });
  });
}

/**
 * Tag edges, given each paper's tags resolved to tag ids.
 *
 * Tags are user-defined vocabulary, so unlike folders there is no hierarchy to
 * walk — one edge per tag.
 */
export function buildTagEdges(
  paperId: string,
  tagIds: readonly string[],
  tags: readonly GraphTagRecord[],
  now = Date.now(),
): GraphEdge[] {
  const known = new Set(tags.map((tag) => tag.tagId));
  const seen = new Set<string>();
  const built: GraphEdge[] = [];
  for (const tagId of tagIds) {
    if (!known.has(tagId) || seen.has(tagId)) continue;
    seen.add(tagId);
    const originKey = createEdgeOriginKey(paperId, tagNodeId(tagId), 'TAGGED', false);
    built.push(edge({
      source: paperId,
      sourceKind: 'paper',
      target: tagNodeId(tagId),
      targetKind: 'tag',
      type: 'TAGGED',
      originKey,
      sourcePaperId: paperId,
      now,
    }));
  }
  return built;
}

/** Origin keys of personal edges that the current data no longer implies. */
export function findStalePersonalOriginKeys(
  previous: readonly GraphEdge[],
  next: readonly GraphEdge[],
): string[] {
  const live = new Set(next.map((edge) => edge.originKey));
  return previous
    .filter((edge) => edge.origin === 'user' && !live.has(edge.originKey))
    .map((edge) => edge.originKey);
}
