/**
 * Re-exports of the reader control surface shared by several viewer features.
 *
 * This file must NOT re-export app-layer state (`feature-models`,
 * `app-view-persistence`): the PDF core exposes PDF reading capabilities only.
 * Application state is available through `src/viewer/app/public`.
 */
export * from './reader-controls';
