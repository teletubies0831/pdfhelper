import type {
  EdgeType,
  GraphEdge,
  GraphEntity,
  KnowledgeGraphSettings,
} from '../contracts.ts';
import { ENTITY_TYPES } from '../contracts.ts';
import { normalizeEntityName } from '../domain/entity-normalization.ts';
import { mergePairKey, normalizeMergeRejections } from '../domain/merge-rejection.ts';
import {
  planEntityConfirmation,
  planEntityMerge,
  type AcceptedCandidate,
} from './entity-planning.ts';
import { parseEntityCandidates } from './candidate-parsing.ts';

/**
 * Entity lifecycle service: extraction results become confirmed graph entities
 * only through here.
 *
 * Every mutation is planned in pure code first and then applied in one
 * repository transaction, so a confirmation can never half-land.
 */

export interface ConfirmCandidatesResult {
  /** Entities newly created by this confirmation. */
  createdEntityIds: string[];
  /** Existing entities that received the candidate instead of a new twin. */
  reusedEntityIds: string[];
  /** Candidates the user had previously marked "never suggest again". */
  skippedIgnoredNames: string[];
  /** Edges actually written (duplicates are skipped by the unique index). */
  edgesWritten: number;
}

export interface GraphEntityRepositoryPort {
  listEntities(): Promise<GraphEntity[]>;
  readSettings(): Promise<KnowledgeGraphSettings>;
  writeSettings(settings: KnowledgeGraphSettings): Promise<void>;
  listEdges(): Promise<GraphEdge[]>;
  applyEntityPlan(plan: {
    entities: GraphEntity[];
    edges: GraphEdge[];
    dropOriginKeys?: string[];
  }): Promise<number>;
}

/**
 * Confirmable candidate set for the review UI.
 *
 * Grouping and pre-check decisions live here rather than in the dialog so the
 * same rules apply to any other surface (an agent tool, a future batch view) and
 * so they are covered by the contract tests instead of only by clicking.
 */
export interface PendingReviewGroup {
  type: GraphEntity['type'];
  candidates: PendingReviewCandidate[];
}

export interface PendingReviewCandidate {
  entityId: string;
  name: string;
  normalizedName: string;
  type: GraphEntity['type'];
  confidence: number;
  aliases: string[];
  paperId: string;
  evidence: GraphEntity['evidence'];
  /** Whether the checkbox starts ticked. */
  preChecked: boolean;
}

function toReviewCandidate(
  entity: GraphEntity,
  preCheckThreshold: number,
): PendingReviewCandidate {
  return {
    entityId: entity.entityId,
    name: entity.name,
    normalizedName: entity.normalizedName,
    type: entity.type,
    confidence: entity.confidence,
    aliases: entity.aliases,
    paperId: entity.sourcePaperId,
    evidence: entity.evidence,
    preChecked: entity.confidence >= preCheckThreshold,
  };
}

/**
 * Builds the grouped, ordered review payload.
 *
 * Types keep the canonical `ENTITY_TYPES` order so the dialog does not reshuffle
 * between openings, and candidates are ordered by confidence within a type.
 *
 * Names on the ignore list are dropped here as well as at confirmation: leaving them visible made
 * "不再提示" look broken — the row came back on the next open and the pending badge never moved.
 */
export function buildPendingReview(
  pendingEntities: readonly GraphEntity[],
  settings: Pick<KnowledgeGraphSettings, 'minConfidenceToAutoCheck' | 'ignoredEntityNames'>,
): PendingReviewGroup[] {
  const ignoredKeys = new Set(
    (settings.ignoredEntityNames ?? []).map((name) => normalizeEntityName(name)).filter(Boolean),
  );
  const usable = pendingEntities.filter((entity) => (
    normalizeEntityName(entity.name).length > 0
    && !ignoredKeys.has(entity.normalizedName || normalizeEntityName(entity.name))
  ));
  const groups: PendingReviewGroup[] = [];
  for (const type of ENTITY_TYPES) {
    const candidates = usable
      .filter((entity) => entity.type === type)
      .sort((left, right) => (
        right.confidence - left.confidence
        || left.entityId.localeCompare(right.entityId)
      ))
      .map((entity) => toReviewCandidate(entity, settings.minConfidenceToAutoCheck));
    if (candidates.length) groups.push({ type, candidates });
  }
  return groups;
}

export interface PendingReviewSummary {
  total: number;
  preChecked: number;
  groups: PendingReviewGroup[];
}

export async function loadPendingReview(
  repository: GraphEntityRepositoryPort & {
    listPendingEntities(): Promise<GraphEntity[]>;
  },
): Promise<PendingReviewSummary> {
  const [pending, settings] = await Promise.all([
    repository.listPendingEntities(),
    repository.readSettings(),
  ]);
  const groups = buildPendingReview(pending, settings);
  const total = groups.reduce((sum, group) => sum + group.candidates.length, 0);
  const preChecked = groups.reduce(
    (sum, group) => sum + group.candidates.filter((candidate) => candidate.preChecked).length,
    0,
  );
  return { total, preChecked, groups };
}

/**
 * Marks pending candidates whose name is on the ignore list as rejected.
 *
 * The review list already hides them, but hiding is not the same as resolving: a record that stays
 * `pending` forever is counted by every read of the store, which is exactly how the page ended up
 * showing "待确认 9" while the dialog said there was nothing to review. Those nine had been marked
 * 不再提示 back when that button only wrote the ignore list and left the record pending.
 *
 * Idempotent, and returns how many it resolved so callers can mention it once.
 */
export async function reconcileIgnoredPendingCandidates(
  repository: GraphEntityRepositoryPort & {
    listPendingEntities(): Promise<GraphEntity[]>;
  },
): Promise<number> {
  const [pending, settings] = await Promise.all([
    repository.listPendingEntities(),
    repository.readSettings(),
  ]);
  const ignoredKeys = new Set(
    (settings.ignoredEntityNames ?? []).map((name) => normalizeEntityName(name)).filter(Boolean),
  );
  if (!ignoredKeys.size) return 0;
  const stale = pending.filter((entity) => (
    entity.status === 'pending'
    && ignoredKeys.has(entity.normalizedName || normalizeEntityName(entity.name))
  ));
  if (!stale.length) return 0;
  const now = Date.now();
  await repository.applyEntityPlan({
    entities: stale.map((entity) => ({ ...entity, status: 'rejected', updatedAt: now })),
    edges: [],
  });
  return stale.length;
}

/**
 * Confirms candidates into the graph.
 *
 * Ignored names are filtered *before* planning rather than after, so an ignored
 * entity is not even counted as a reuse. Filtering happens on the normalized key,
 * which means "不再提示 Transformer" also suppresses "Transformer模型".
 */
export async function confirmEntityCandidates(
  accepted: readonly AcceptedCandidate[],
  paperId: string,
  repository: GraphEntityRepositoryPort,
  options: { edgeType?: EdgeType; now?: number } = {},
): Promise<ConfirmCandidatesResult> {
  const [settings, existingEntities] = await Promise.all([
    repository.readSettings(),
    repository.listEntities(),
  ]);

  const ignoredKeys = new Set(
    settings.ignoredEntityNames.map((name) => normalizeEntityName(name)).filter(Boolean),
  );
  const skippedIgnoredNames: string[] = [];
  const usable: AcceptedCandidate[] = [];
  for (const candidate of accepted) {
    const key = normalizeEntityName(candidate.name);
    if (!key) continue;
    if (ignoredKeys.has(key)) {
      skippedIgnoredNames.push(candidate.name);
      continue;
    }
    usable.push(candidate);
  }

  if (!usable.length) {
    return {
      createdEntityIds: [],
      reusedEntityIds: [],
      skippedIgnoredNames,
      edgesWritten: 0,
    };
  }

  const existingIds = new Set(existingEntities.map((entity) => entity.entityId));
  const plan = planEntityConfirmation(usable, existingEntities, {
    paperId,
    edgeType: options.edgeType,
    now: options.now,
  });

  const edgesWritten = await repository.applyEntityPlan(plan);
  const touched = plan.entities.map((entity) => entity.entityId);
  return {
    createdEntityIds: touched.filter((id) => !existingIds.has(id)),
    reusedEntityIds: touched.filter((id) => existingIds.has(id)),
    skippedIgnoredNames,
    edgesWritten,
  };
}

export interface MergeEntitiesResult {
  keepEntityId: string;
  absorbedEntityId: string;
  edgesRewritten: number;
  edgesDropped: number;
}

/**
 * Folds one entity into another.
 *
 * Refuses to merge when either side is already a tombstone, because folding into
 * a `merged` record would orphan the whole chain of aliases and edges.
 */
export async function mergeGraphEntities(
  keepEntityId: string,
  mergeEntityId: string,
  repository: GraphEntityRepositoryPort,
  now = Date.now(),
): Promise<MergeEntitiesResult | null> {
  const [entities, edges] = await Promise.all([
    repository.listEntities(),
    repository.listEdges(),
  ]);
  const plan = planEntityMerge(keepEntityId, mergeEntityId, entities, edges, now);
  if (!plan) return null;

  const edgesWritten = await repository.applyEntityPlan({
    entities: [plan.keep, plan.absorbed],
    edges: plan.edges,
    dropOriginKeys: plan.dropOriginKeys,
  });

  return {
    keepEntityId: plan.keep.entityId,
    absorbedEntityId: plan.absorbed.entityId,
    edgesRewritten: edgesWritten,
    // Touched edges that produced no replacement are the dropped ones: self-loops
    // and collisions with an already-existing edge between the same endpoints.
    edgesDropped: Math.max(0, plan.dropOriginKeys.length - plan.edges.length),
  };
}

/** Adds a name to the "never suggest again" list, keyed by normalized name. */
export async function ignoreEntityName(
  name: string,
  repository: GraphEntityRepositoryPort,
): Promise<KnowledgeGraphSettings | null> {
  const key = normalizeEntityName(name);
  if (!key) return null;
  const settings = await repository.readSettings();
  if (settings.ignoredEntityNames.some((item) => normalizeEntityName(item) === key)) {
    return settings;
  }
  const next: KnowledgeGraphSettings = {
    ...settings,
    ignoredEntityNames: [...settings.ignoredEntityNames, name.trim()],
  };
  await repository.writeSettings(next);
  return next;
}

export interface DismissCandidatesResult {
  /** Candidates that left the pending list. */
  dismissed: number;
  /** Candidates that also went onto the ignore list. */
  remembered: number;
}

/**
 * Refuses candidates for good, or just for now.
 *
 * A candidate the user has looked at and refused must **leave the pending list** — otherwise the
 * badge keeps counting it, the row comes back on the next open, and the button reads as broken even
 * though it wrote something. `status: 'rejected'` is exactly that state: it is already excluded from
 * the pending list and already counted as a refused candidate by the statistics report.
 *
 * `remember` decides the difference between the two buttons:
 * - 忽略 (`remember: false`) — rejected now. A later extraction of the same paper may propose it
 *   again, because the name is not on the ignore list and a new run is a new suggestion.
 * - 不再提示 (`remember: true`) — rejected **and** put on the ignore list, so no future extraction
 *   proposes it, and the review list filters it even before that.
 */
export async function dismissEntityCandidates(
  entityIds: readonly string[],
  repository: GraphEntityRepositoryPort,
  options: { remember: boolean; now?: number } = { remember: false },
): Promise<DismissCandidatesResult> {
  const wanted = new Set(entityIds.filter(Boolean));
  if (!wanted.size) return { dismissed: 0, remembered: 0 };
  const entities = await repository.listEntities();
  const now = options.now ?? Date.now();
  const targets = entities.filter((entity) => (
    wanted.has(entity.entityId)
    && entity.status !== 'merged'
    && entity.status !== 'confirmed'
  ));
  if (!targets.length) return { dismissed: 0, remembered: 0 };

  await repository.applyEntityPlan({
    entities: targets.map((entity) => ({
      ...entity,
      status: 'rejected',
      updatedAt: now,
    })),
    edges: [],
  });

  let remembered = 0;
  if (options.remember) {
    let settings = await repository.readSettings();
    const known = new Set(settings.ignoredEntityNames.map((name) => normalizeEntityName(name)));
    const additions: string[] = [];
    for (const entity of targets) {
      const key = normalizeEntityName(entity.name);
      if (!key || known.has(key)) continue;
      known.add(key);
      additions.push(entity.name);
    }
    if (additions.length) {
      settings = {
        ...settings,
        ignoredEntityNames: [...settings.ignoredEntityNames, ...additions],
      };
      await repository.writeSettings(settings);
      remembered = additions.length;
    }
  }

  return { dismissed: targets.length, remembered };
}

export async function unignoreEntityName(
  name: string,
  repository: GraphEntityRepositoryPort,
): Promise<KnowledgeGraphSettings> {
  const key = normalizeEntityName(name);
  const settings = await repository.readSettings();
  const next: KnowledgeGraphSettings = {
    ...settings,
    ignoredEntityNames: settings.ignoredEntityNames.filter(
      (item) => normalizeEntityName(item) !== key,
    ),
  };
  await repository.writeSettings(next);
  return next;
}

/**
 * Records that two entities are *not* the same thing.
 *
 * The merge dialog's suggestions are string-similarity guesses: `s-XOR` and `b-XOR` share three
 * letters and score 0.70, and no threshold separates that from a real typo. Without a way to say
 * "no", the same wrong pair returns every time the dialog opens, so the user stops opening it.
 *
 * Returns the number of remembered rejections after the write.
 */
export async function rejectMergeSuggestion(
  leftEntityId: string,
  rightEntityId: string,
  repository: GraphEntityRepositoryPort,
): Promise<number> {
  const key = mergePairKey(leftEntityId, rightEntityId);
  const settings = await repository.readSettings();
  if (!key || settings.mergeRejections.includes(key)) return settings.mergeRejections.length;
  const next: KnowledgeGraphSettings = {
    ...settings,
    mergeRejections: normalizeMergeRejections([...settings.mergeRejections, key]),
  };
  await repository.writeSettings(next);
  return next.mergeRejections.length;
}

/** Forgets every remembered rejection, so the suggestions come back. */
export async function clearMergeRejections(
  repository: GraphEntityRepositoryPort,
): Promise<number> {
  const settings = await repository.readSettings();
  const cleared = settings.mergeRejections.length;
  if (!cleared) return 0;
  await repository.writeSettings({ ...settings, mergeRejections: [] });
  return cleared;
}

/**
 * Turns a raw model response into confirmable candidates.
 *
 * Parse failures are returned as `rejected` rather than thrown: a malformed batch
 * must not abort a job that already spent tokens, and the caller surfaces the
 * count so the user knows why fewer candidates appeared.
 */
export function readCandidatesFromModelResponse(
  content: string,
  context: {
    paperId: string;
    defaultPageNumber: number;
    chunkId?: string;
    chunkHeading?: string;
    maxEvidence?: number;
    maxQuoteLength?: number;
  },
): ReturnType<typeof parseEntityCandidates> {
  return parseEntityCandidates(content, context, (name) => normalizeEntityName(String(name ?? '')));
}
