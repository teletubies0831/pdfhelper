# Research module

Owns literature discovery, source adapters, candidate normalization, ranking, diversity selection, and CCF lookup.

- Provider HTTP formats stay in `providers/`.
- Related-paper ranking must not depend on DOM or browser UI.
- CCF parsing and venue matching stay independent from related-paper rendering.
- Viewer code consumes only normalized research results through `public.ts`.
