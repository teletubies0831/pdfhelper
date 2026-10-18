import { createStateCell } from "../state-cell";

/**
 * Graph page view state.
 *
 * Lives in `app/models` rather than in the feature so the assembly layer can
 * persist and restore it without importing a feature (the same reason the
 * knowledge filters live here).
 */

export type GraphFocusMode = "all" | "current";

export const graphFocusMode = createStateCell<GraphFocusMode>("all");

/** Hops kept around the focus node when a focus is active (1..3). */
export const graphFocusHops = createStateCell(1);

/**
 * Nodes and edges below this confidence are filtered out of the canvas.
 *
 * Defaults to 0.6 rather than 0: a fresh graph used to open with every extracted candidate on
 * screen, which read as clutter before it read as completeness. The controls are still there for
 * anyone who wants the full set back.
 */
export const graphMinConfidence = createStateCell(0.6);

export const graphSearchQuery = createStateCell("");

export const graphShowPapers = createStateCell(true);

export const graphShowEntities = createStateCell(true);

export const graphShowOriginAi = createStateCell(true);

export const graphShowOriginRule = createStateCell(true);

export const graphShowOriginUser = createStateCell(true);

/** Selected node id (`paperId` or `entityId`); empty means nothing selected. */
export const graphSelectedNodeId = createStateCell("");

/** Selected edge id; takes precedence over the node selection in the inspector. */
export const graphSelectedEdgeId = createStateCell("");
