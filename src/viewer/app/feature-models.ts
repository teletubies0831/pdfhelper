/**
 * Feature model barrel (kept for import compatibility).
 *
 * The former single-file "everything model" is split by domain under
 * app/models/; this file only re-exports the splits. New code should import
 * the domain file directly when it only needs one domain.
 */
export * from './models/summary-models';
export * from './models/card-models';
export * from './models/knowledge-models';
export * from './models/learning-models';
export * from './models/graph-models';
export * from './models/app-view-models';
