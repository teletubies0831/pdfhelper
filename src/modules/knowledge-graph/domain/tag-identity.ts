import type { GraphTagRecord } from '../contracts-user-graph.ts';

/**
 * Tag derivation.
 *
 * Tags are the one personal source with **no independent store**: they exist only
 * as `tags: string[]` on knowledge items. Rather than inventing a tag table and
 * silently promoting it to the source of truth — which would fork the user's data
 * and require a migration to reconcile — identity is derived from the tag *name*:
 * normalize it and hash it. That makes the id stable across sessions and machines
 * with zero storage and zero migration, so an existing tag is already a graph node
 * the first time the graph is opened.
 *
 * The name is the identity. Two tags differing only in case or surrounding
 * whitespace are the same tag, which is what a user means by "题目" and " 题目 ".
 */

/**
 * FNV-1a, 32-bit.
 *
 * Used instead of a cryptographic digest because this is an identity key, not a
 * security boundary, and it keeps the id short enough to read in a debugger. The
 * collision risk over a personal tag vocabulary (tens to low hundreds of tags) is
 * negligible; a collision would merge two tags, which the user can see and undo
 * by renaming.
 */
export function hashTagName(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Canonical form of a tag name.
 *
 * Case-folded and whitespace-collapsed, but *not* punctuation-stripped: unlike
 * entity names, a tag is a literal label the user typed, and "#important" and
 * "important" may well be deliberate. Being conservative here means the graph
 * shows exactly the tags the user created.
 */
export function normalizeTagName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function tagIdForName(name: string): string {
  return `tag:${hashTagName(normalizeTagName(name))}`;
}

/**
 * Deterministic tag records from every tag name seen.
 *
 * Ordering is by display name so the node list is stable between runs; the
 * first spelling encountered for a normalized name becomes the display label, so
 * re-deriving from the same data yields the same graph.
 */
export function deriveTagRecords(tagNames: readonly string[]): GraphTagRecord[] {
  const byId = new Map<string, GraphTagRecord>();
  for (const raw of tagNames) {
    const display = raw.trim().replace(/\s+/g, ' ');
    if (!display) continue;
    const tagId = tagIdForName(display);
    if (byId.has(tagId)) continue;
    byId.set(tagId, { tagId, name: display });
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export interface TagAssignment {
  /** Paper the tags belong to. */
  paperId: string;
  tags: readonly string[];
}

export interface TagEdgePlan {
  tags: GraphTagRecord[];
  /** `paperId -> tagId[]`, ready for `buildTagEdges`. */
  tagsByPaperId: Map<string, string[]>;
}

/**
 * Builds the tag vocabulary and each paper's tag ids from raw assignments.
 *
 * Kept separate from `buildTagEdges` because the vocabulary must be derived once
 * across all papers: deriving per paper would produce a different tag list per
 * call, and `buildTagEdges` rejects tag ids it was not told about.
 */
export function planTagAssignments(assignments: readonly TagAssignment[]): TagEdgePlan {
  const tags = deriveTagRecords(assignments.flatMap((assignment) => assignment.tags));
  const knownIds = new Set(tags.map((tag) => tag.tagId));
  const tagsByPaperId = new Map<string, string[]>();

  for (const assignment of assignments) {
    const ids = new Set<string>();
    for (const raw of assignment.tags) {
      const display = raw.trim().replace(/\s+/g, ' ');
      if (!display) continue;
      const tagId = tagIdForName(display);
      if (knownIds.has(tagId)) ids.add(tagId);
    }
    if (ids.size) tagsByPaperId.set(assignment.paperId, [...ids].sort());
  }

  return { tags, tagsByPaperId };
}
