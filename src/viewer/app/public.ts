/**
 * Application assembly surface.
 *
 * `app/` owns cross-feature viewer state and view persistence. Feature code
 * must import this state from here (or from the individual files), never
 * through `core/pdf-reader/public` — the PDF core only exposes PDF reading
 * capabilities.
 */
export * from './feature-models';
export * from './app-view-persistence';
export * from './assistant-state';
