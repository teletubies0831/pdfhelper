# Selection contract module

Owns cross-page selection actions and the stored selection request contract.

- Keep this module free of DOM and browser APIs.
- Viewer selection geometry belongs to the viewer text-selection feature.
- Context-menu and helper-panel runtimes consume only `public.ts`.
