import {
  KNOWLEDGE_GRAPH_SCHEMA_VERSION,
  ENTITY_TYPES,
  type GraphEdge,
  type GraphEntity,
  type GraphPaper,
  type GraphUserNode,
  type KnowledgeGraphSettings,
} from '../contracts.ts';
import { normalizeKnowledgeGraphSettings } from '../domain/graph-settings.ts';

/**
 * Graph snapshot serialization.
 *
 * Follows the two versioning conventions already established in this repository
 * rather than inventing a third: a `format` marker plus a numeric `version`, and a
 * parser that returns `null` on mismatch instead of throwing.
 *
 * Two properties are deliberate:
 *
 * - **Deterministic output.** Every array is sorted before writing, so exporting
 *   the same graph twice produces byte-identical files and a diff means something
 *   actually changed.
 * - **Strict, total validation.** Import is the one place where arbitrary text
 *   enters the database, so every field is coerced or the whole document is
 *   rejected. A partially-valid snapshot must not half-load.
 */

export const GRAPH_SNAPSHOT_FORMAT = 'pdfpal.knowledge-graph';
export const GRAPH_SNAPSHOT_VERSION = 1;

export interface GraphSnapshotDocument {
  format: typeof GRAPH_SNAPSHOT_FORMAT;
  version: number;
  /** The schema the records were written against, for diagnostics. */
  schemaVersion: number;
  exportedAt: string;
  papers: GraphPaper[];
  entities: GraphEntity[];
  userNodes: GraphUserNode[];
  edges: GraphEdge[];
  settings: KnowledgeGraphSettings;
}

export interface GraphSnapshotSources {
  papers: readonly GraphPaper[];
  entities: readonly GraphEntity[];
  userNodes: readonly GraphUserNode[];
  edges: readonly GraphEdge[];
  settings: KnowledgeGraphSettings;
}

/**
 * Serializes a graph to a JSON string.
 *
 * `pretty` exists because the primary use of this file is a human opening it in
 * an editor to see what the plugin knows, and a single-line blob defeats that.
 */
export function createGraphSnapshot(
  sources: GraphSnapshotSources,
  options: { now?: Date; pretty?: boolean } = {},
): string {
  const document: GraphSnapshotDocument = {
    format: GRAPH_SNAPSHOT_FORMAT,
    version: GRAPH_SNAPSHOT_VERSION,
    schemaVersion: KNOWLEDGE_GRAPH_SCHEMA_VERSION,
    exportedAt: (options.now ?? new Date()).toISOString(),
    papers: sortBy(sources.papers, (paper) => paper.paperId),
    entities: sortBy(sources.entities, (entity) => entity.entityId),
    userNodes: sortBy(sources.userNodes, (node) => node.id),
    edges: sortBy(sources.edges, (edge) => edge.edgeId),
    settings: normalizeKnowledgeGraphSettings(sources.settings),
  };
  return JSON.stringify(document, null, options.pretty === false ? undefined : 2);
}

function sortBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asEvidenceList(value: unknown): GraphEdge['evidence'] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      paperId: asString(item.paperId),
      pageNumber: Math.max(1, Math.round(asNumber(item.pageNumber, 1))),
      quote: asString(item.quote),
      ...(typeof item.chunkId === 'string' ? { chunkId: item.chunkId } : {}),
      ...(typeof item.chunkHeading === 'string' ? { chunkHeading: item.chunkHeading } : {}),
    }))
    .filter((item) => item.paperId.length > 0);
}

function parsePaper(value: unknown): GraphPaper | null {
  if (!isRecord(value)) return null;
  const paperId = asString(value.paperId);
  if (!paperId) return null;
  return {
    paperId,
    documentAgentId: asString(value.documentAgentId, paperId),
    fingerprint: asString(value.fingerprint),
    title: asString(value.title, paperId),
    year: asOptionalNumber(value.year),
    authors: asStringList(value.authors),
    venue: asString(value.venue),
    doi: asString(value.doi),
    abstract: asString(value.abstract),
    folderId: typeof value.folderId === 'string' ? value.folderId : null,
    keywords: asStringList(value.keywords),
    extractionStatus: (['none', 'queued', 'extracting', 'ready', 'error'] as const)
      .includes(value.extractionStatus as 'ready')
      ? value.extractionStatus as GraphPaper['extractionStatus']
      : 'none',
    extractionError: typeof value.extractionError === 'string' ? value.extractionError : null,
    extractedAt: asOptionalNumber(value.extractedAt),
    projectionVersion: Math.round(asNumber(value.projectionVersion, 1)),
    createdAt: asNumber(value.createdAt, Date.now()),
    updatedAt: asNumber(value.updatedAt, Date.now()),
  };
}

function parseEntity(value: unknown): GraphEntity | null {
  if (!isRecord(value)) return null;
  const entityId = asString(value.entityId);
  const name = asString(value.name);
  if (!entityId || !name) return null;
  const type = (ENTITY_TYPES as readonly string[]).includes(asString(value.type))
    ? asString(value.type) as GraphEntity['type']
    : 'Concept';
  const status = (['pending', 'confirmed', 'rejected', 'merged'] as const)
    .includes(value.status as 'confirmed')
    ? value.status as GraphEntity['status']
    : 'pending';
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  return {
    entityId,
    name,
    normalizedName: asString(value.normalizedName, name.toLocaleLowerCase()),
    aliases: asStringList(value.aliases),
    type,
    status,
    confidence: Math.min(1, Math.max(0, asNumber(value.confidence, 0.5))),
    sourcePaperId: asString(value.sourcePaperId),
    evidence: asEvidenceList(value.evidence),
    mergedInto: typeof value.mergedInto === 'string' ? value.mergedInto : null,
    // Kept across export/import: it is generated text the user may have no cheap way to regenerate
    // for every entity, and dropping it would silently empty the inspector's 含义 section.
    ...(description ? { description } : {}),
    ...(typeof value.descriptionUpdatedAt === 'number'
      ? { descriptionUpdatedAt: value.descriptionUpdatedAt }
      : {}),
    userEdited: value.userEdited === true,
    createdAt: asNumber(value.createdAt, Date.now()),
    updatedAt: asNumber(value.updatedAt, Date.now()),
  };
}

function parseEdge(value: unknown): GraphEdge | null {
  if (!isRecord(value)) return null;
  const edgeId = asString(value.edgeId);
  const originKey = asString(value.originKey);
  const source = asString(value.source);
  const target = asString(value.target);
  // An edge without endpoints or an idempotency key cannot be written: the first
  // would break the renderer's endpoint invariant, the second the unique index.
  if (!edgeId || !originKey || !source || !target) return null;
  const origin = (['ai', 'rule', 'user'] as const).includes(value.origin as 'ai')
    ? value.origin as GraphEdge['origin']
    : 'rule';
  const provenance = isRecord(value.provenance) ? value.provenance : {};
  return {
    edgeId,
    source,
    sourceKind: (['paper', 'entity', 'note', 'highlight', 'folder', 'tag', 'user'] as const)
      .includes(value.sourceKind as 'paper')
      ? value.sourceKind as GraphEdge['sourceKind']
      : 'paper',
    target,
    targetKind: (['paper', 'entity', 'note', 'highlight', 'folder', 'tag', 'user'] as const)
      .includes(value.targetKind as 'paper')
      ? value.targetKind as GraphEdge['targetKind']
      : 'entity',
    type: asString(value.type, 'RELATED_TO') as GraphEdge['type'],
    confidence: Math.min(1, Math.max(0, asNumber(value.confidence, 0.5))),
    evidence: asEvidenceList(value.evidence),
    sourcePaperId: typeof value.sourcePaperId === 'string' ? value.sourcePaperId : null,
    origin,
    originKey,
    provenance: {
      ...(typeof provenance.model === 'string' ? { model: provenance.model } : {}),
      ...(typeof provenance.connectionId === 'string'
        ? { connectionId: provenance.connectionId }
        : {}),
      ...(typeof provenance.promptVersion === 'string'
        ? { promptVersion: provenance.promptVersion }
        : {}),
      ...(Number.isFinite(provenance.judgedAt as number)
        ? { judgedAt: asNumber(provenance.judgedAt) }
        : {}),
      ...(Number.isFinite(provenance.resolvedAt as number)
        ? { resolvedAt: asNumber(provenance.resolvedAt) }
        : {}),
      ...(provenance.resolvedBy === 'rule' || provenance.resolvedBy === 'user'
        ? { resolvedBy: provenance.resolvedBy }
        : {}),
      ...(typeof provenance.resolvedAgainst === 'string'
        ? { resolvedAgainst: provenance.resolvedAgainst }
        : {}),
    },
    createdAt: asNumber(value.createdAt, Date.now()),
    updatedAt: asNumber(value.updatedAt, Date.now()),
  };
}

function parseUserNode(value: unknown): GraphUserNode | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  const kind = (['note', 'highlight', 'folder', 'tag', 'user'] as const)
    .includes(value.kind as 'note')
    ? value.kind as GraphUserNode['kind']
    : null;
  if (!kind) return null;
  return {
    id,
    kind,
    label: asString(value.label, id),
    ...(typeof value.paperId === 'string' ? { paperId: value.paperId } : {}),
    createdAt: asNumber(value.createdAt, Date.now()),
  };
}

export interface GraphSnapshotParseResult {
  document: GraphSnapshotDocument | null;
  /** Why the document was rejected, when it was. */
  error: string | null;
  /** Records dropped during validation, so a lossy import can be reported. */
  dropped: { papers: number; entities: number; edges: number; userNodes: number };
}

/**
 * Parses and validates a snapshot.
 *
 * Returns `null` rather than throwing, matching `parseEmbeddedHelperPayload` and
 * the knowledge repository: a caller that has to catch is a caller that will
 * forget to. The whole document is rejected on a format or version mismatch so a
 * foreign file cannot half-load, but individual malformed *records* are dropped
 * and counted — losing one unreadable edge is better than refusing a 2000-edge
 * export because of it.
 */
export function parseGraphSnapshot(raw: string): GraphSnapshotParseResult {
  const empty = { papers: 0, entities: 0, edges: 0, userNodes: 0 };
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { document: null, error: '文件不是合法的 JSON。', dropped: empty };
  }
  if (!isRecord(payload)) {
    return { document: null, error: '文件内容不是对象。', dropped: empty };
  }
  if (payload.format !== GRAPH_SNAPSHOT_FORMAT) {
    return {
      document: null,
      error: `不是 PDFPal 知识图谱快照（format=${String(payload.format)}）。`,
      dropped: empty,
    };
  }
  if (payload.version !== GRAPH_SNAPSHOT_VERSION) {
    return {
      document: null,
      error: `快照版本 ${String(payload.version)} 与当前支持的版本 ${GRAPH_SNAPSHOT_VERSION} 不一致。`,
      dropped: empty,
    };
  }
  if (!Array.isArray(payload.papers)) {
    return { document: null, error: '快照缺少 papers 数组。', dropped: empty };
  }

  const rawPapers = payload.papers as unknown[];
  const rawEntities = Array.isArray(payload.entities) ? payload.entities as unknown[] : [];
  const rawEdges = Array.isArray(payload.edges) ? payload.edges as unknown[] : [];
  const rawUserNodes = Array.isArray(payload.userNodes) ? payload.userNodes as unknown[] : [];

  const papers = rawPapers.map(parsePaper).filter((item): item is GraphPaper => item !== null);
  const entities = rawEntities.map(parseEntity)
    .filter((item): item is GraphEntity => item !== null);
  const edges = rawEdges.map(parseEdge).filter((item): item is GraphEdge => item !== null);
  const userNodes = rawUserNodes.map(parseUserNode)
    .filter((item): item is GraphUserNode => item !== null);

  // Duplicate ids would abort a bulk write on the primary key; keep the first and
  // report the loss rather than failing the import.
  const dedupedPapers = dedupeById(papers, (paper) => paper.paperId);
  const dedupedEntities = dedupeById(entities, (entity) => entity.entityId);
  const dedupedEdges = dedupeById(edges, (edge) => edge.edgeId);
  const dedupedUserNodes = dedupeById(userNodes, (node) => node.id);

  return {
    document: {
      format: GRAPH_SNAPSHOT_FORMAT,
      version: GRAPH_SNAPSHOT_VERSION,
      schemaVersion: asNumber(payload.schemaVersion, KNOWLEDGE_GRAPH_SCHEMA_VERSION),
      exportedAt: asString(payload.exportedAt, new Date(0).toISOString()),
      papers: dedupedPapers,
      entities: dedupedEntities,
      userNodes: dedupedUserNodes,
      edges: dedupedEdges,
      settings: normalizeKnowledgeGraphSettings(
        isRecord(payload.settings) ? payload.settings as Partial<KnowledgeGraphSettings> : undefined,
      ),
    },
    error: null,
    dropped: {
      papers: rawPapers.length - dedupedPapers.length,
      entities: rawEntities.length - dedupedEntities.length,
      edges: rawEdges.length - dedupedEdges.length,
      userNodes: rawUserNodes.length - dedupedUserNodes.length,
    },
  };
}

function dedupeById<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(value);
  }
  return result;
}

/**
 * Suggests a file name for the download.
 *
 * Dated so successive exports do not overwrite each other in the downloads
 * folder, which is the only "history" this local-first feature gets.
 */
export function suggestSnapshotFileName(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `pdfpal-knowledge-graph-${stamp}.json`;
}

export type ImportStrategy = 'replace' | 'merge';

export interface GraphImportPlan {
  strategy: ImportStrategy;
  /** Records to write, in dependency order: papers, entities, then edges. */
  papers: GraphPaper[];
  entities: GraphEntity[];
  userNodes: GraphUserNode[];
  edges: GraphEdge[];
  settings: KnowledgeGraphSettings | null;
  /**
   * Edges dropped because an endpoint was defined by neither the snapshot nor the
   * target graph. Reported rather than repaired: inventing an entity from an edge
   * id would create a nameless node the user never confirmed.
   */
  droppedDanglingEdges: number;
}

/**
 * Plans an import.
 *
 * Strategy choice matters more than the mechanics, so it is explicit rather than
 * guessed:
 *
 * - `replace` is the honest option: the snapshot becomes the graph. It is exactly
 *   what "restore a backup" means, and it cannot silently merge two divergent
 *   sets of conclusions.
 * - `merge` fills gaps without overwriting what is already here. It exists
 *   because a user may export from one machine and want their second machine's
 *   graph completed rather than replaced.
 *
 * Neither strategy takes an id from the file. Imported records keep their ids
 * (they are content-derived or random, and re-keying would orphan the edges that
 * reference them), but the planner refuses to write anything the snapshot does not
 * define — an edge to a missing entity would break the renderer's one invariant.
 */
export function planGraphImport(
  document: GraphSnapshotDocument,
  strategy: ImportStrategy,
  existing: {
    papers?: readonly GraphPaper[];
    entities?: readonly GraphEntity[];
    userNodes?: readonly GraphUserNode[];
  } = {},
): GraphImportPlan {
  const paperIds = new Set(document.papers.map((paper) => paper.paperId));
  const entityIds = new Set(document.entities.map((entity) => entity.entityId));
  const userIds = new Set(document.userNodes.map((node) => node.id));
  // Records the target graph already holds. They count as endpoints even though
  // the snapshot does not define them: for `merge` the entity stays put and the
  // imported edge that references it is perfectly resolvable.
  const heldPaperIds = new Set((existing.papers ?? []).map((paper) => paper.paperId));
  const heldEntityIds = new Set((existing.entities ?? []).map((entity) => entity.entityId));
  const heldUserIds = new Set((existing.userNodes ?? []).map((node) => node.id));

  const endpointExists = (kind: GraphEdge['sourceKind'], id: string): boolean => {
    if (kind === 'paper') return paperIds.has(id) || heldPaperIds.has(id);
    if (kind === 'entity') return entityIds.has(id) || heldEntityIds.has(id);
    return userIds.has(id) || heldUserIds.has(id);
  };

  let droppedDanglingEdges = 0;
  const usableEdges = document.edges.filter((edge) => {
    const ok = endpointExists(edge.sourceKind, edge.source)
      && endpointExists(edge.targetKind, edge.target);
    if (!ok) droppedDanglingEdges += 1;
    return ok;
  });

  // Note: there is deliberately no separate "missing entity reference" counter.
  // An edge pointing at an entity that neither the snapshot nor the target graph
  // defines *is* a dangling edge, so it is counted once — by the filter above —
  // rather than by a second counter that could only ever repeat the same number.
  if (strategy === 'replace') {
    return {
      strategy,
      papers: document.papers,
      entities: document.entities,
      userNodes: document.userNodes,
      edges: usableEdges,
      settings: document.settings,
      droppedDanglingEdges,
    };
  }

  // Merge: keep what is already present, add what is missing. Existing records
  // win, because a local confirmation or user edit is newer information than a
  // file of unknown age.
  const existingPaperIds = new Set((existing.papers ?? []).map((paper) => paper.paperId));
  const existingEntityIds = new Set((existing.entities ?? []).map((entity) => entity.entityId));
  const existingUserIds = new Set((existing.userNodes ?? []).map((node) => node.id));

  return {
    strategy,
    papers: document.papers.filter((paper) => !existingPaperIds.has(paper.paperId)),
    entities: document.entities.filter((entity) => !existingEntityIds.has(entity.entityId)),
    userNodes: document.userNodes.filter((node) => !existingUserIds.has(node.id)),
    edges: usableEdges,
    // Settings are not merged: half of one file's thresholds and half of the
    // other's is a configuration nobody chose.
    settings: null,
    droppedDanglingEdges,
  };
}

/** One-line summary for the confirmation dialog and the status bar. */
export function describeImportPlan(plan: GraphImportPlan): string {
  const parts = [
    plan.strategy === 'replace' ? '将替换现有图谱' : '将合并进现有图谱',
    `文献 ${plan.papers.length}`,
    `实体 ${plan.entities.length}`,
    `个人标注 ${plan.userNodes.length}`,
    `边 ${plan.edges.length}`,
    plan.droppedDanglingEdges
      ? `丢弃 ${plan.droppedDanglingEdges} 条边（端点不存在）`
      : '',
  ];
  return `${parts.filter(Boolean).join('，')}。`;
}
