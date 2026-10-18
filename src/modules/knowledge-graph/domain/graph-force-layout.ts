/**
 * Minimal deterministic force-directed layout for the knowledge graph.
 *
 * Written in-house on purpose: the extension's CSP forbids `unsafe-eval`, so graph libraries that
 * compile selectors or shaders at runtime are a liability, and the layout only needs three forces to
 * look right for a literature graph. Determinism matters more than physical accuracy — the same graph
 * must settle into the same picture across reloads.
 *
 * The forces are **not** uniform. A literature graph is not a bag of interchangeable points: a paper
 * is a subject, a private entity belongs to exactly one paper, and a shared entity exists to connect
 * several. Giving all three the same spring length is what made a real canvas look like a loose
 * tangle — the shared nodes sat as close to one paper as its own datasets, so nothing read as a
 * bridge and the documents were not the anchors of the picture. `springForLink` therefore assigns each
 * link its resting distance from the node roles in `paper-degree.ts`.
 *
 * It lives in the domain layer because it is pure geometry with no DOM, like `graph-render-model.ts`
 * and `graph-culling.ts`. That placement is also what lets the contract tests execute it: files under
 * `src/viewer/features/` import the module barrel, whose extensionless imports Node cannot resolve.
 */

import {
  SHARED_PAPER_DEGREE,
  buildNodeRoleIndex,
  paperDegreeOf,
  type NodeRoleIndex,
} from './paper-degree.ts';

export interface LayoutNode {
  id: string;
  /** Preferred radius; hubs are drawn larger. */
  radius: number;
  /** Higher values pull the node towards the centre (papers beat everything else). */
  weight: number;
  /** Pinned nodes (e.g. the focus paper, or a dragged node) never move. */
  fixed: boolean;
  /**
   * What the node represents.
   *
   * Only papers matter to the physics: a `paper ↔ paper` link is the widest gap on the canvas. The
   * private/shared distinction comes from the paper memberships in `buildNodeRoleIndex`, not from
   * this field, because "is it shared" is a property of the graph, not of the node.
   */
  kind?: LayoutNodeKind;
}

export type LayoutNodeKind = 'paper' | 'entity' | 'user';

export interface LayoutEdge {
  source: string;
  target: string;
  /** Larger values pull endpoints closer. */
  strength: number;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  /** Number of relaxation passes. */
  iterations: number;
  /** Distance for a link with nothing special about it. */
  linkDistance: number;
  repulsion: number;
  gravity: number;
  /** 0..1 velocity retention; lower settles faster but jitters less. */
  damping: number;
  /**
   * Link distance between a paper and its private entities.
   *
   * A private entity (a method, dataset or metric that appears in exactly one paper) is a *satellite*
   * of that paper. At the generic distance it drifted into open canvas and read as a hub of its own;
   * tight springs gather the satellites into a cluster around their document instead.
   */
  privateLinkDistance?: number;
  /**
   * Link distance between two papers.
   *
   * The documents are the subjects of the picture, so they get the widest gap — and this is only half
   * of it, see `paperRepulsionMultiplier`.
   */
  paperLinkDistance?: number;
  /**
   * Link distance from a shared entity (reaching two or more papers) to *everything* it touches.
   *
   * This is the mirror image of the private rule. A shared method belongs between the papers it
   * connects, and leaving it close to either one collapses the very gap it should be holding open.
   * Applied to all of its links, not only the paper links: a shared node trailing a private
   * sub-entity would otherwise drag that sub-entity into the gap.
   */
  sharedLinkDistance?: number;
  /** Extra distance per paper beyond the second, so a four-paper bridge sits even further out. */
  sharedDegreeStep?: number;
  /**
   * Extra repulsion between two papers.
   *
   * Two papers that merely share an entity have no spring between them, so nothing else stops them
   * from settling next to each other: the shared node pulls both ends in along its own links and
   * gravity gathers the rest in the middle. Multiplying only the paper-paper pairs opens the canvas
   * up without inflating every other pair.
   */
  paperRepulsionMultiplier?: number;
}

/**
 * Default forces.
 *
 * `linkDistance`/`repulsion` are the values tuned against a real canvas (a hub paper with a dozen
 * leaves packed too tightly at 96/5200); the role-specific distances are measured, not guessed — see
 * the numbers recorded in `docs/knowledge-graph-plan.md` §24.
 */
export const DEFAULT_LAYOUT_OPTIONS: Omit<LayoutOptions, 'width' | 'height'> = {
  iterations: 260,
  linkDistance: 150,
  repulsion: 14000,
  gravity: 0.022,
  damping: 0.82,
  privateLinkDistance: 62,
  paperLinkDistance: 260,
  sharedLinkDistance: 240,
  sharedDegreeStep: 16,
  paperRepulsionMultiplier: 12,
};

/** A private spring is stiffer, so "close to its paper" survives the global repulsion. */
const PRIVATE_LINK_STRENGTH_BOOST = 3;

/** A sub-cluster of one paper (private ↔ its own sub-entity) stays tight, but not paper-tight. */
const PRIVATE_CHAIN_DISTANCE_SCALE = 1.25;

/** Deterministic 32-bit hash used to seed initial positions. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed: number, salt: number): number {
  const mixed = Math.imul(seed ^ (salt * 2654435761), 2246822519) >>> 0;
  return (mixed % 100000) / 100000;
}

/**
 * Initial placement on a seeded phyllotaxis spiral. A spiral (rather than a random cloud) removes the
 * "everything overlaps in the middle" first frame and keeps disconnected components from stacking on
 * each other.
 */
export function createInitialPositions(
  nodes: LayoutNode[],
  width: number,
  height: number,
): Map<string, LayoutPoint> {
  const positions = new Map<string, LayoutPoint>();
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.max(60, Math.min(width, height) / 2 - 48);

  nodes.forEach((node, index) => {
    const seed = hashString(node.id);
    const angle = index * 2.399963229728653 + seededUnit(seed, 1) * 0.6;
    const radial = Math.sqrt((index + 0.5) / Math.max(1, nodes.length)) * maxRadius;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radial,
      y: centerY + Math.sin(angle) * radial * 0.86,
    });
  });
  return positions;
}

interface MutablePoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** What one link is worth: its resting length and how hard it pulls towards it. */
export interface LinkSpring {
  distance: number;
  strength: number;
}

/**
 * The resting distance and stiffness of one link.
 *
 * Precedence is the whole design, so it is spelled out:
 *
 * 1. **paper ↔ paper** — the widest gap; two documents are never drawn as close as one document and
 *    its own keyword.
 * 2. **anything touching a shared node** — a node reaching two or more papers is pulled away from
 *    every neighbour, which is what parks it *between* the documents instead of beside one of them.
 * 3. **a paper and its private entities** — tight and stiff, so the satellites gather around their
 *    document instead of floating in the middle of the canvas.
 * 4. **a private entity and its own sub-entities** — still tight, slightly looser, so a paper's
 *    cluster grows outward from the paper rather than collapsing onto it.
 * 5. everything else — the generic distance.
 */
export function springForLink(
  link: LayoutEdge,
  roles: NodeRoleIndex,
  kindOf: ReadonlyMap<string, LayoutNodeKind | undefined>,
  options: LayoutOptions,
): LinkSpring {
  const privateDistance = options.privateLinkDistance ?? DEFAULT_LAYOUT_OPTIONS.privateLinkDistance!;
  const paperDistance = options.paperLinkDistance ?? DEFAULT_LAYOUT_OPTIONS.paperLinkDistance!;
  const sharedDistance = options.sharedLinkDistance ?? DEFAULT_LAYOUT_OPTIONS.sharedLinkDistance!;
  const degreeStep = options.sharedDegreeStep ?? DEFAULT_LAYOUT_OPTIONS.sharedDegreeStep!;

  const sourceIsPaper = kindOf.get(link.source) === 'paper';
  const targetIsPaper = kindOf.get(link.target) === 'paper';

  if (sourceIsPaper && targetIsPaper) {
    return { distance: paperDistance, strength: link.strength };
  }

  // Papers are not "private to" or "shared with" anything: their membership count is not a role.
  const sourceDegree = sourceIsPaper ? 0 : paperDegreeOf(roles, link.source);
  const targetDegree = targetIsPaper ? 0 : paperDegreeOf(roles, link.target);

  const bridgeDegree = Math.max(sourceDegree, targetDegree);
  if (bridgeDegree >= SHARED_PAPER_DEGREE) {
    return {
      // A node bridging four papers needs more room than one bridging two, otherwise the busier
      // bridge is dragged onto top of the papers it is supposed to separate.
      distance: sharedDistance + degreeStep * (bridgeDegree - SHARED_PAPER_DEGREE),
      strength: link.strength,
    };
  }

  if ((sourceIsPaper || targetIsPaper) && sourceDegree <= 1 && targetDegree <= 1) {
    return { distance: privateDistance, strength: link.strength * PRIVATE_LINK_STRENGTH_BOOST };
  }

  if (sourceDegree <= 1 && targetDegree <= 1 && (sourceDegree === 1 || targetDegree === 1)) {
    return {
      distance: privateDistance * PRIVATE_CHAIN_DISTANCE_SCALE,
      strength: link.strength,
    };
  }

  return { distance: options.linkDistance, strength: link.strength };
}

/**
 * Runs the simulation to completion and returns the settled positions.
 *
 * Callers that need to keep the UI responsive should size `iterations` so the loop stays well under a
 * frame budget, or run it inside the layout worker.
 */
export function computeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions,
): Map<string, LayoutPoint> {
  const { width, height } = options;
  const initial = createInitialPositions(nodes, width, height);
  const state = new Map<string, MutablePoint>();
  for (const node of nodes) {
    const point = initial.get(node.id) ?? { x: width / 2, y: height / 2 };
    state.set(node.id, { x: point.x, y: point.y, vx: 0, vy: 0 });
  }

  const known = new Set(nodes.map((node) => node.id));
  const links = edges.filter(
    (edge) => known.has(edge.source) && known.has(edge.target) && edge.source !== edge.target,
  );

  // Membership and resting distances are constant for the whole run, so they are resolved once
  // instead of per iteration — and, more importantly, in a place that can be read and tested.
  const paperIds = new Set(nodes.flatMap((node) => (node.kind === 'paper' ? [node.id] : [])));
  const kindOf = new Map(nodes.map((node) => [node.id, node.kind] as const));
  const roles = buildNodeRoleIndex(links, paperIds);
  const springs = links.map((link) => springForLink(link, roles, kindOf, options));
  const paperRepulsion = options.paperRepulsionMultiplier
    ?? DEFAULT_LAYOUT_OPTIONS.paperRepulsionMultiplier!;

  // Index-based double loop over the node array: iteration order is the array order, so results do
  // not depend on Map key ordering.
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const cooling = 1 - iteration / (options.iterations + 1);

    // Repulsion, O(n^2): acceptable because the renderer only ever lays out a capped subgraph. A
    // full-graph layout of thousands of nodes is out of scope for stage 1 and is where Barnes-Hut
    // would go next.
    for (let left = 0; left < nodes.length; left += 1) {
      const leftNode = nodes[left]!;
      const leftPoint = state.get(leftNode.id)!;
      for (let right = left + 1; right < nodes.length; right += 1) {
        const rightNode = nodes[right]!;
        const rightPoint = state.get(rightNode.id)!;
        let dx = leftPoint.x - rightPoint.x;
        let dy = leftPoint.y - rightPoint.y;
        let distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 1) {
          // Coincident nodes need a deterministic nudge, not Math.random().
          dx = seededUnit(hashString(leftNode.id), right) - 0.5 || 0.01;
          dy = seededUnit(hashString(rightNode.id), left) - 0.5 || 0.01;
          distanceSquared = dx * dx + dy * dy;
        }
        const distance = Math.sqrt(distanceSquared);
        // Documents push each other much harder than anything else does: they are the subjects of the
        // picture, and without this two papers that only share an entity settle side by side.
        const pairMultiplier = leftNode.kind === 'paper' && rightNode.kind === 'paper'
          ? paperRepulsion
          : 1;
        const force = (options.repulsion * pairMultiplier) / distanceSquared;
        const ux = dx / distance;
        const uy = dy / distance;
        leftPoint.vx += ux * force;
        leftPoint.vy += uy * force;
        rightPoint.vx -= ux * force;
        rightPoint.vy -= uy * force;
      }
    }

    // Springs, each with its own resting distance (see `springForLink`).
    for (let index = 0; index < links.length; index += 1) {
      const link = links[index]!;
      const spring = springs[index]!;
      const sourcePoint = state.get(link.source)!;
      const targetPoint = state.get(link.target)!;
      const dx = targetPoint.x - sourcePoint.x;
      const dy = targetPoint.y - sourcePoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const displacement = distance - spring.distance;
      const force = displacement * 0.06 * spring.strength;
      const ux = dx / distance;
      const uy = dy / distance;
      sourcePoint.vx += ux * force;
      sourcePoint.vy += uy * force;
      targetPoint.vx -= ux * force;
      targetPoint.vy -= uy * force;
    }

    // Gravity towards the centre, weighted so papers hold the middle.
    for (const node of nodes) {
      const point = state.get(node.id)!;
      const pull = options.gravity * (0.6 + node.weight);
      point.vx += (width / 2 - point.x) * pull;
      point.vy += (height / 2 - point.y) * pull;
    }

    // Integrate.
    for (const node of nodes) {
      const point = state.get(node.id)!;
      if (node.fixed) {
        point.vx = 0;
        point.vy = 0;
        continue;
      }
      point.vx *= options.damping;
      point.vy *= options.damping;
      point.x += Math.max(-24, Math.min(24, point.vx * cooling));
      point.y += Math.max(-24, Math.min(24, point.vy * cooling));
      point.x = Math.max(node.radius, Math.min(width - node.radius, point.x));
      point.y = Math.max(node.radius, Math.min(height - node.radius, point.y));
    }
  }

  const result = new Map<string, LayoutPoint>();
  for (const [id, point] of state) result.set(id, { x: point.x, y: point.y });
  return result;
}
