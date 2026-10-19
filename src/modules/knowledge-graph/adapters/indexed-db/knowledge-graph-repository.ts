import {
  type GraphEdge,
  type GraphEntity,
  type GraphPaper,
  type KnowledgeGraphSettings,
} from '../../contracts.ts';
import type { GraphHighlightRecord } from '../../contracts-user-graph.ts';
import { normalizeKnowledgeGraphSettings } from '../../domain/graph-settings.ts';
import {
  GRAPH_EDGES_STORE,
  GRAPH_ENTITIES_STORE,
  GRAPH_HIGHLIGHTS_STORE,
  GRAPH_PAPERS_STORE,
  GRAPH_SETTINGS_STORE,
  EDGE_ORIGIN_KEY_INDEX,
  ENTITY_STATUS_INDEX,
  openKnowledgeGraphDatabase,
  readAllFromGraphStore,
  requestToPromise,
  transactionDone,
  writeGraphStore,
} from './knowledge-graph-database.ts';

export interface KnowledgeGraphRepository {
  listPapers(): Promise<GraphPaper[]>;
  putPaper(paper: GraphPaper): Promise<void>;
  putPapers(papers: GraphPaper[]): Promise<void>;
  deletePaper(paperId: string): Promise<void>;

  listEntities(): Promise<GraphEntity[]>;
  /** Entities awaiting user confirmation, newest first. */
  listPendingEntities(): Promise<GraphEntity[]>;
  putEntity(entity: GraphEntity): Promise<void>;
  putEntities(entities: GraphEntity[]): Promise<void>;
  deleteEntities(entityIds: string[]): Promise<void>;

  listEdges(): Promise<GraphEdge[]>;
  /** Returns false when the unique `originKey` index rejected the write. */
  putEdge(edge: GraphEdge): Promise<boolean>;
  putEdges(edges: GraphEdge[]): Promise<number>;
  deleteEdge(edgeId: string): Promise<void>;
  deleteEdges(edgeIds: string[]): Promise<void>;
  /**
   * Removes a paper together with the entities and edges that only it supported,
   * in one transaction. A cleanup interrupted midway would leave edges whose
   * endpoint no longer exists.
   */
  deletePaperCascade(
    paperId: string,
    entityIds: string[],
    edgeIds: string[],
  ): Promise<void>;
  /** Removes entities by id (alias of `deleteEntities`, for the cleanup port). */
  deleteEntitiesById(entityIds: string[]): Promise<void>;
  /**
   * Removes one entity and the edges that touch it, in one transaction.
   *
   * Same reason as `deletePaperCascade`: an interrupted delete would leave edges whose endpoint no
   * longer exists, and every edge endpoint being present is the renderer's one hard invariant. The
   * paper store is not touched at all — a paper is a knowledge-base projection, not a deletable node.
   */
  deleteEntityCascade(entityId: string, edgeIds: string[]): Promise<void>;
  /** Removes edges by id (alias of `deleteEdges`, for the cleanup port). */
  deleteEdgesById(edgeIds: string[]): Promise<void>;
  /** Removes every edge with the given origin key; used before a re-judgement. */
  deleteEdgesByOriginKeys(originKeys: string[]): Promise<void>;
  /**
   * Applies a relation judgement in one transaction: retires the superseded
   * conclusions, then writes the current ones.
   *
   * Ordering matters inside the transaction — a re-judgement whose verdict type
   * changed frees one `originKey` and occupies another, and writing before
   * deleting would trip the unique index.
   */
  applyRelationPlan(plan: {
    edges: GraphEdge[];
    dropOriginKeys: string[];
  }): Promise<number>;
  findEdgeByOriginKey(originKey: string): Promise<GraphEdge | null>;

  /**
   * The graph's own copy of the user's highlights.
   *
   * A copy rather than the authority: highlights live inside the annotated PDF, so
   * this is what was captured while a document was open (see `highlight-capture.ts`).
   */
  listHighlights(): Promise<GraphHighlightRecord[]>;
  /** Upserts highlight records by id; returns how many were written. */
  putHighlights(records: GraphHighlightRecord[]): Promise<number>;

  readSettings(): Promise<KnowledgeGraphSettings>;
  writeSettings(settings: KnowledgeGraphSettings): Promise<void>;
  clearAll(): Promise<void>;

  /**
   * Applies a confirmation or merge plan atomically.
   *
   * Entities and edges must land together: a user pressing "confirm" must never
   * be left with confirmed entities and no `Paper -> Entity` edge, which is what
   * a sequence of independent writes can produce if the page closes midway.
   * Returns the number of edges actually written (duplicate `originKey` values
   * are skipped rather than aborting the batch).
   */
  applyEntityPlan(plan: {
    entities: GraphEntity[];
    edges: GraphEdge[];
    dropOriginKeys?: string[];
  }): Promise<number>;
}

export class IndexedDbKnowledgeGraphRepository
implements KnowledgeGraphRepository {
  listPapers(): Promise<GraphPaper[]> {
    return readAllFromGraphStore<GraphPaper>(GRAPH_PAPERS_STORE);
  }

  async putPaper(paper: GraphPaper): Promise<void> {
    await this.putPapers([paper]);
  }

  async putPapers(papers: GraphPaper[]): Promise<void> {
    if (!papers.length) return;
    await writeGraphStore(GRAPH_PAPERS_STORE, (store) => {
      for (const paper of papers) store.put(paper);
    });
  }

  listEntities(): Promise<GraphEntity[]> {
    return readAllFromGraphStore<GraphEntity>(GRAPH_ENTITIES_STORE);
  }

  async listPendingEntities(): Promise<GraphEntity[]> {
    const database = await openKnowledgeGraphDatabase();
    try {
      const transaction = database.transaction(GRAPH_ENTITIES_STORE, 'readonly');
      const rows = await requestToPromise<GraphEntity[]>(
        transaction
          .objectStore(GRAPH_ENTITIES_STORE)
          .index(ENTITY_STATUS_INDEX)
          .getAll('pending'),
      );
      // Highest confidence first: the confirmation dialog pre-checks from the
      // top, so the most trustworthy candidates must be the ones the user sees
      // without scrolling.
      return rows.sort((left, right) => (
        right.confidence - left.confidence
        || right.createdAt - left.createdAt
        || left.entityId.localeCompare(right.entityId)
      ));
    } finally {
      database.close();
    }
  }

  async putEntity(entity: GraphEntity): Promise<void> {
    await this.putEntities([entity]);
  }

  async putEntities(entities: GraphEntity[]): Promise<void> {
    if (!entities.length) return;
    await writeGraphStore(GRAPH_ENTITIES_STORE, (store) => {
      for (const entity of entities) store.put(entity);
    });
  }

  async deleteEntities(entityIds: string[]): Promise<void> {
    if (!entityIds.length) return;
    await writeGraphStore(GRAPH_ENTITIES_STORE, (store) => {
      for (const entityId of entityIds) store.delete(entityId);
    });
  }

  listEdges(): Promise<GraphEdge[]> {
    return readAllFromGraphStore<GraphEdge>(GRAPH_EDGES_STORE);
  }

  listHighlights(): Promise<GraphHighlightRecord[]> {
    return readAllFromGraphStore<GraphHighlightRecord>(GRAPH_HIGHLIGHTS_STORE);
  }

  async putHighlights(records: GraphHighlightRecord[]): Promise<number> {
    if (!records.length) return 0;
    await writeGraphStore(GRAPH_HIGHLIGHTS_STORE, (store) => {
      for (const record of records) store.put(record);
    });
    return records.length;
  }

  async putEdge(edge: GraphEdge): Promise<boolean> {
    return (await this.putEdges([edge])) === 1;
  }

  /**
   * Writes what it can in a single transaction and reports how many records
   * landed. Duplicate `originKey` values are skipped rather than aborting the
   * whole batch, so one cached relationship never discards its siblings.
   */
  async putEdges(edges: GraphEdge[]): Promise<number> {
    if (!edges.length) return 0;
    const database = await openKnowledgeGraphDatabase();
    try {
      const transaction = database.transaction(GRAPH_EDGES_STORE, 'readwrite');
      const store = transaction.objectStore(GRAPH_EDGES_STORE);
      let written = 0;
      for (const edge of edges) {
        const request = store.put(edge);
        request.onsuccess = () => {
          written += 1;
        };
        request.onerror = (event) => {
          // Swallow the unique-index violation; any other failure still aborts
          // the transaction and surfaces through `transactionDone`.
          if ((request.error as { name?: string } | null)?.name === 'ConstraintError') {
            event.preventDefault();
            event.stopPropagation();
          }
        };
      }
      await transactionDone(transaction);
      return written;
    } finally {
      database.close();
    }
  }

  async deleteEdge(edgeId: string): Promise<void> {
    await this.deleteEdges([edgeId]);
  }

  async deleteEdges(edgeIds: string[]): Promise<void> {
    if (!edgeIds.length) return;
    await writeGraphStore(GRAPH_EDGES_STORE, (store) => {
      for (const edgeId of edgeIds) store.delete(edgeId);
    });
  }

  /**
   * Removes a paper together with its own entities and edges in one transaction.
   *
   * The three writes must land together: a cleanup interrupted between them would
   * leave edges whose endpoint no longer exists, and the renderer's one hard
   * invariant is that every edge endpoint is present.
   */
  async deletePaperCascade(
    paperId: string,
    entityIds: string[],
    edgeIds: string[],
  ): Promise<void> {
    const database = await openKnowledgeGraphDatabase();
    try {
      const transaction = database.transaction(
        [GRAPH_PAPERS_STORE, GRAPH_ENTITIES_STORE, GRAPH_EDGES_STORE],
        'readwrite',
      );
      const edgeStore = transaction.objectStore(GRAPH_EDGES_STORE);
      for (const edgeId of edgeIds) edgeStore.delete(edgeId);
      const entityStore = transaction.objectStore(GRAPH_ENTITIES_STORE);
      for (const entityId of entityIds) entityStore.delete(entityId);
      transaction.objectStore(GRAPH_PAPERS_STORE).delete(paperId);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async deletePaper(paperId: string): Promise<void> {
    await writeGraphStore(GRAPH_PAPERS_STORE, (store) => store.delete(paperId));
  }

  async deleteEntitiesById(entityIds: string[]): Promise<void> {
    await this.deleteEntities(entityIds);
  }

  /**
   * Deletes one entity and its edges together.
   *
   * Two stores, one transaction: the edges must not outlive their endpoint, and the entity must not
   * outlive them either (a node whose edges vanished in a separate step would look like a node the user
   * un-connected rather than deleted).
   */
  async deleteEntityCascade(entityId: string, edgeIds: string[]): Promise<void> {
    const database = await openKnowledgeGraphDatabase();
    try {
      const transaction = database.transaction(
        [GRAPH_ENTITIES_STORE, GRAPH_EDGES_STORE],
        'readwrite',
      );
      const edgeStore = transaction.objectStore(GRAPH_EDGES_STORE);
      for (const edgeId of edgeIds) edgeStore.delete(edgeId);
      transaction.objectStore(GRAPH_ENTITIES_STORE).delete(entityId);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async deleteEdgesById(edgeIds: string[]): Promise<void> {
    await this.deleteEdges(edgeIds);
  }

  async deleteEdgesByOriginKeys(originKeys: string[]): Promise<void> {
    if (!originKeys.length) return;
    const database = await openKnowledgeGraphDatabase();
    try {
      const transaction = database.transaction(GRAPH_EDGES_STORE, 'readwrite');
      const index = transaction.objectStore(GRAPH_EDGES_STORE).index(EDGE_ORIGIN_KEY_INDEX);
      const requests = originKeys.map((key) => requestToPromise(index.getAllKeys(key)));
      const keyGroups = await Promise.all(requests);
      const store = transaction.objectStore(GRAPH_EDGES_STORE);
      for (const keys of keyGroups) {
        for (const key of keys) store.delete(key);
      }
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async applyRelationPlan(plan: {
    edges: GraphEdge[];
    dropOriginKeys: string[];
  }): Promise<number> {
    const { edges, dropOriginKeys } = plan;
    if (!edges.length && !dropOriginKeys.length) return 0;

    const database = await openKnowledgeGraphDatabase();
    try {
      const transaction = database.transaction(GRAPH_EDGES_STORE, 'readwrite');
      const store = transaction.objectStore(GRAPH_EDGES_STORE);

      // Retire first: a verdict that changed type frees its old key and occupies
      // a new one, so writing before deleting would hit the unique index.
      if (dropOriginKeys.length) {
        const index = store.index(EDGE_ORIGIN_KEY_INDEX);
        const keyGroups = await Promise.all(
          dropOriginKeys.map((key) => requestToPromise<IDBValidKey[]>(index.getAllKeys(key))),
        );
        for (const keys of keyGroups) {
          for (const key of keys) store.delete(key);
        }
      }

      let written = 0;
      for (const edge of edges) {
        const request = store.put(edge);
        request.onsuccess = () => {
          written += 1;
        };
        request.onerror = (event) => {
          // Only the duplicate-key case is swallowed; anything else must abort.
          if ((request.error as { name?: string } | null)?.name === 'ConstraintError') {
            event.preventDefault();
            event.stopPropagation();
          }
        };
      }

      await transactionDone(transaction);
      return written;
    } finally {
      database.close();
    }
  }

  async findEdgeByOriginKey(originKey: string): Promise<GraphEdge | null> {
    const database = await openKnowledgeGraphDatabase();
    try {
      const transaction = database.transaction(GRAPH_EDGES_STORE, 'readonly');
      const match = await requestToPromise<GraphEdge | undefined>(
        transaction.objectStore(GRAPH_EDGES_STORE).index(EDGE_ORIGIN_KEY_INDEX).get(originKey),
      );
      return match ?? null;
    } finally {
      database.close();
    }
  }

  async readSettings(): Promise<KnowledgeGraphSettings> {
    const database = await openKnowledgeGraphDatabase();
    try {
      const transaction = database.transaction(GRAPH_SETTINGS_STORE, 'readonly');
      const stored = await requestToPromise<KnowledgeGraphSettings | undefined>(
        transaction.objectStore(GRAPH_SETTINGS_STORE).get('knowledge-graph-settings'),
      );
      return normalizeKnowledgeGraphSettings(stored);
    } finally {
      database.close();
    }
  }

  async writeSettings(settings: KnowledgeGraphSettings): Promise<void> {
    const normalized = normalizeKnowledgeGraphSettings(settings);
    await writeGraphStore(GRAPH_SETTINGS_STORE, (store) => store.put(normalized));
  }

  async clearAll(): Promise<void> {
    for (const storeName of [GRAPH_EDGES_STORE, GRAPH_ENTITIES_STORE, GRAPH_PAPERS_STORE]) {
      await writeGraphStore(storeName, (store) => store.clear());
    }
  }

  /**
   * One transaction over the entity and edge stores.
   *
   * Order inside the transaction: resolve the origin keys being retired to their
   * edge ids, delete them, then write. Deleting first is what frees the unique
   * `originKey` slot for a rewritten edge — a merge redirects `CITES|p1|e1` to
   * `CITES|p1|e2`, and writing before deleting would trip the constraint.
   */
  async applyEntityPlan(plan: {
    entities: GraphEntity[];
    edges: GraphEdge[];
    dropOriginKeys?: string[];
  }): Promise<number> {
    const { entities, edges, dropOriginKeys = [] } = plan;
    if (!entities.length && !edges.length && !dropOriginKeys.length) return 0;

    const database = await openKnowledgeGraphDatabase();
    try {
      const transaction = database.transaction(
        [GRAPH_ENTITIES_STORE, GRAPH_EDGES_STORE],
        'readwrite',
      );
      const entityStore = transaction.objectStore(GRAPH_ENTITIES_STORE);
      const edgeStore = transaction.objectStore(GRAPH_EDGES_STORE);

      for (const entity of entities) entityStore.put(entity);

      if (dropOriginKeys.length) {
        const index = edgeStore.index(EDGE_ORIGIN_KEY_INDEX);
        const keyGroups = await Promise.all(
          dropOriginKeys.map((originKey) => requestToPromise<IDBValidKey[]>(
            index.getAllKeys(originKey),
          )),
        );
        for (const keys of keyGroups) {
          for (const key of keys) edgeStore.delete(key);
        }
      }

      let written = 0;
      for (const edge of edges) {
        const request = edgeStore.put(edge);
        request.onsuccess = () => {
          written += 1;
        };
        request.onerror = (event) => {
          // Skip only the duplicate-key case; any other failure must still abort
          // the transaction and surface through `transactionDone`.
          if ((request.error as { name?: string } | null)?.name === 'ConstraintError') {
            event.preventDefault();
            event.stopPropagation();
          }
        };
      }

      await transactionDone(transaction);
      return written;
    } finally {
      database.close();
    }
  }
}
