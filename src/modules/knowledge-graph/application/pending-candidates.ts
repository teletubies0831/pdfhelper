import type {
  GraphEntity,
} from '../contracts.ts';
import { normalizeEntityAliases, normalizeEntityName } from '../domain/entity-normalization.ts';
import { assessEntityName, variantBaseOf } from '../domain/entity-name-quality.ts';
import { mergeEvidence } from './entity-planning.ts';

/**
 * Incremental candidate upsert plan.
 *
 * Extraction commits **per batch**, not once at the end. Two reasons:
 *
 * - The MV3 worker can be killed between batches. If nothing were written until
 *   the end, every teardown would discard the batches that already succeeded —
 *   tokens already paid for.
 * - Candidates become visible immediately, which is the "AI does the coarse work"
 *   half of the design.
 *
 * Committing per batch makes every write re-entrant, which is what this module
 * has to guarantee: running the same batch twice must change nothing.
 */

export interface PendingCandidateInput {
  name: string;
  type: GraphEntity['type'];
  confidence: number;
  evidence: GraphEntity['evidence'];
  /** Other spellings the paper used for the same thing, when extraction reported them. */
  aliases?: string[];
}

export interface PendingUpsertPlan {
  /** Entities to write. `status: 'pending'` for new, updated for existing. */
  entities: GraphEntity[];
  /** How many of `entities` are new relative to the stored set. */
  newEntityCount: number;
  /**
   * Candidates refused for scoring below `MIN_PENDING_CONFIDENCE`.
   *
   * Reported rather than swallowed: "the model found 40 things and 18 were too weak to review" is a
   * different situation from "the model found 22 things", and only one of them means the prompt
   * needs work.
   */
  droppedLowConfidence: number;
  /**
   * Candidates refused because the name is not a concept at all — a table label, a bare number, `b l
   * cost`. Counted separately from the confidence floor: this is a *content* problem, not a scoring
   * one.
   */
  droppedLowQuality: number;
  /** Numbered copies of a known name (`XOR2` next to `XOR`) folded in as aliases instead of added. */
  collapsedVariants: number;
  /** Candidates skipped because the name is on the "never suggest again" list. */
  droppedIgnored: number;
  /** Candidates a previous run's 忽略 had rejected, proposed again by this run. */
  reProposed: number;
  /**
   * Candidates demoted out of the review list because the name describes an action or is mostly
   * numbering — readable, but not a name.
   *
   * Counted apart from `droppedLowQuality`: that bucket is "this is not a concept", this one is
   * "this might be one, wrapped in a sentence". Keeping them apart is what lets the prompt work be
   * judged: one number says the model invents junk, the other says it phrases names as clauses.
   */
  demotedSuspect: number;
}

/**
 * Candidates below this confidence never reach the review list.
 *
 * The review dialog already leaves low-confidence rows unticked and hidden behind a toggle, so a
 * candidate down here is one the user would have to go looking for in order to reject. Filtering at
 * the door keeps the list honest and short; the threshold is explicit so the trade-off is visible
 * (raise it and useful-but-uncertain entities are lost, lower it and the noise comes back).
 */
export const MIN_PENDING_CONFIDENCE = 0.4;

function sameEvidence(left: GraphEntity['evidence'], right: GraphEntity['evidence']): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return Boolean(other)
      && item.paperId === other!.paperId
      && item.pageNumber === other!.pageNumber
      && item.quote === other!.quote;
  });
}

/**
 * Finds the entity a candidate belongs to.
 *
 * Matching is `normalizedName` **plus** type, deliberately:
 *
 * - Normalized name is the identity rule used everywhere else, so candidates
 *   land on an existing entity instead of creating a near-duplicate.
 * - Type is part of the match because the same string can legitimately be two
 *   different things ("BLEU" the metric and a dataset named BLEU). Collapsing
 *   those silently would be a wrong merge, and wrong merges lose knowledge.
 *
 * An exact name match always wins. Failing that, **aliases are consulted**: an extraction that
 * reported `BP heuristic` as an alias of `Boyar-Peralta heuristic` means a later chunk naming
 * `BP heuristic` belongs to that same entity, and string similarity would never discover it.
 * A candidate's own aliases are tried too, so two chunks that each list the other's spelling meet
 * in the middle.
 *
 * Merged tombstones are excluded: their aliases and edges live on the survivor.
 */
export function findMatchingEntity(
  candidate: PendingCandidateInput,
  entities: readonly GraphEntity[],
): GraphEntity | undefined {
  const normalized = normalizeEntityName(candidate.name);
  if (!normalized) return undefined;
  const usable = entities.filter((entity) => (
    entity.status !== 'merged'
    && entity.type === candidate.type
  ));

  const exact = usable.find((entity) => entity.normalizedName === normalized);
  if (exact) return exact;

  const candidateKeys = new Set(
    [normalized, ...(candidate.aliases ?? []).map((alias) => normalizeEntityName(alias))]
      .filter(Boolean),
  );
  return usable.find((entity) => {
    if (entity.normalizedName && candidateKeys.has(entity.normalizedName)) {
      // The candidate's own name differs, so this is an alias match, not an identity match. It is
      // still the right entity — that is the point of recording aliases — but the caller records
      // the name as a new alias instead of renaming anything.
      return true;
    }
    return entity.aliases.some((alias) => candidateKeys.has(normalizeEntityName(alias)));
  });
}

/**
 * Builds the entity writes for one batch.
 *
 * **No edges are planned here, on purpose.** A candidate is a *suggestion*; it
 * becomes a graph relationship only when the user confirms it, and confirmation
 * goes through `planEntityConfirmation`. Writing `MENTIONS` edges for pending
 * candidates would put unconfirmed AI guesses into the graph and make the
 * "pending" filter cosmetic rather than real.
 */
export function planPendingCandidateUpsert(
  paperId: string,
  candidates: readonly PendingCandidateInput[],
  existingEntities: readonly GraphEntity[],
  options: {
    now?: number;
    /** Called with each entity id as it is planned, for accumulation by callers. */
    onEntityId?: (entityId: string) => void;
    /**
     * Names the user marked 不再提示.
     *
     * Skipped here rather than only at confirmation: a permanently ignored name that keeps coming
     * back as a pending row is exactly what made the button look broken.
     */
    ignoredNames?: readonly string[];
  } = {},
): PendingUpsertPlan {
  const now = options.now ?? Date.now();
  const entityById = new Map<string, GraphEntity>();

  // Working set grows as this batch plans, so two candidates in one batch that
  // normalize the same way land on one entity instead of racing to create twins.
  const working: GraphEntity[] = [...existingEntities];
  const ignoredKeys = new Set(
    (options.ignoredNames ?? []).map((name) => normalizeEntityName(name)).filter(Boolean),
  );
  let droppedLowConfidence = 0;
  let droppedLowQuality = 0;
  let collapsedVariants = 0;
  let droppedIgnored = 0;
  let reProposed = 0;
  let demotedSuspect = 0;

  for (const candidate of candidates) {
    // Below the floor: never shown, never stored, but counted so the caller can say how many.
    if (!(candidate.confidence >= MIN_PENDING_CONFIDENCE)) {
      droppedLowConfidence += 1;
      continue;
    }
    // Permanently refused by the user: a new extraction is not a reason to ask again.
    if (ignoredKeys.has(normalizeEntityName(candidate.name))) {
      droppedIgnored += 1;
      continue;
    }

    // Junk names (table fragments, bare numbers, `b l cost`) never reach the review list: there is
    // nothing behind them to review. See `domain/entity-name-quality.ts` for the rules.
    const verdict = assessEntityName(candidate.name);
    if (!verdict.usable) {
      droppedLowQuality += 1;
      continue;
    }
    // Readable but demoted: an action phrase or a name that is mostly numbering. It stays out of the
    // review list and is counted on its own, because "the model describes names as clauses" is a
    // different problem from "the model invents junk".
    if (verdict.suspect) {
      demotedSuspect += 1;
      continue;
    }

    // A numbered copy of a name we already hold (`XOR2` while `XOR` exists) is an alias, not a new
    // entity. The information survives; the list does not grow.
    const knownNames = working.map((entity) => entity.name);
    const baseName = variantBaseOf(verdict.cleaned, knownNames);
    if (baseName) {
      const base = findMatchingEntity(
        { ...candidate, name: baseName, aliases: [] },
        working,
      );
      if (base) {
        // Counted only when the merge actually happens: the base may be rejected on type mismatch, in which case
        // this candidate goes on to become a new entity and the "N 个编号副本已并入" line would have been wrong.
        collapsedVariants += 1;
        const merged = normalizeEntityAliases([...base.aliases, verdict.cleaned]);
        if (merged.length !== base.aliases.length) {
          const updated: GraphEntity = {
            ...base,
            aliases: merged,
            evidence: mergeEvidence(base.evidence, candidate.evidence),
            updatedAt: now,
          };
          entityById.set(updated.entityId, updated);
          const index = working.findIndex((entity) => entity.entityId === updated.entityId);
          if (index >= 0) working[index] = updated;
        }
        options.onEntityId?.(base.entityId);
        continue;
      }
    }

    const cleanedCandidate: PendingCandidateInput = {
      ...candidate,
      name: verdict.cleaned,
      ...(candidate.aliases?.length
        ? {
          aliases: candidate.aliases
            .map((alias) => assessEntityName(alias))
            .filter((aliasVerdict) => aliasVerdict.usable)
            .map((aliasVerdict) => aliasVerdict.cleaned),
        }
        : {}),
    };

    const normalized = normalizeEntityName(cleanedCandidate.name);
    if (!normalized) {
      droppedLowQuality += 1;
      continue;
    }

    const existing = findMatchingEntity(cleanedCandidate, working);
    const confidence = Math.min(1, Math.max(0, candidate.confidence));

    if (existing) {
      const evidence = mergeEvidence(existing.evidence, candidate.evidence);
      const aliases = normalizeEntityAliases([
        ...existing.aliases,
        // The spelling that did not match exactly becomes an alias, and so do the candidate's own
        // aliases: they are the paper's other names for this entity.
        ...(existing.name === cleanedCandidate.name ? [] : [cleanedCandidate.name]),
        ...(cleanedCandidate.aliases ?? []),
      ]);
      // 忽略 rejects a candidate for *this* review only. A new extraction of the paper is a new
      // suggestion, so a rejected candidate becomes pending again — unless it is on the ignore list,
      // which was checked at the top of the loop.
      const repropose = existing.status === 'rejected';
      if (repropose) reProposed += 1;
      const changed = repropose
        || !sameEvidence(existing.evidence, evidence)
        || existing.confidence !== Math.max(existing.confidence, confidence)
        || aliases.length !== existing.aliases.length;
      // Skip a no-op write: re-processing the same batch must be silent, and an
      // unconditional write would bump `updatedAt` and make every pass look like
      // a change.
      if (!changed) {
        options.onEntityId?.(existing.entityId);
        continue;
      }
      const updated: GraphEntity = {
        ...existing,
        aliases,
        confidence: Math.max(existing.confidence, confidence),
        evidence,
        // A pending entity stays pending: only an explicit user confirmation
        // promotes it. Re-running extraction must not silently confirm anything.
        status: repropose ? 'pending' : existing.status,
        updatedAt: now,
      };
      entityById.set(updated.entityId, updated);
      const index = working.findIndex((entity) => entity.entityId === updated.entityId);
      if (index >= 0) working[index] = updated;
      options.onEntityId?.(updated.entityId);
      continue;
    }

    const created: GraphEntity = {
      entityId: createPendingEntityId(),
      name: cleanedCandidate.name,
      normalizedName: normalized,
      aliases: normalizeEntityAliases(cleanedCandidate.aliases ?? []),
      type: candidate.type,
      status: 'pending',
      confidence,
      sourcePaperId: paperId,
      evidence: mergeEvidence([], candidate.evidence),
      mergedInto: null,
      userEdited: false,
      createdAt: now,
      updatedAt: now,
    };
    entityById.set(created.entityId, created);
    working.push(created);
    options.onEntityId?.(created.entityId);
  }

  const existingIds = new Set(existingEntities.map((entity) => entity.entityId));
  return {
    entities: [...entityById.values()],
    newEntityCount: [...entityById.values()]
      .filter((entity) => !existingIds.has(entity.entityId)).length,
    droppedLowConfidence,
    droppedLowQuality,
    collapsedVariants,
    droppedIgnored,
    reProposed,
    demotedSuspect,
  };
}

/** Local id factory, kept beside the planner so this module has no other deps. */
function createPendingEntityId(): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `entity:${suffix}`;
}
