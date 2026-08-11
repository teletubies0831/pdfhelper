# PDF Helper architecture rules

## Required dependency direction

- `entrypoints` may only start a runtime bootstrap.
- `src/viewer/features` may depend on module public APIs and viewer shared UI.
- `src/modules/*` may only be imported through that module's `public.ts` from outside the module.
- Domain code must not import DOM, WXT, IndexedDB, or concrete network adapters.
- A feature must not import another feature's internal files.
- Storage keys, database versions, and migration compatibility are infrastructure details and must never be shown in user-facing copy.

## Change discipline

- Keep one implementation per behavior. Do not add `v2`, `v3`, `final`, or appended override implementations.
- Preserve existing DOM ids, storage data, runtime messages, and user-visible behavior unless a task explicitly changes them.
- Prefer clear domain names over generic `utils`, `helpers`, `manager`, or `data` modules.
- Add or update focused tests when changing a public contract, parser, repository, ranking algorithm, or migration.
- Run `pnpm check` after structural work.

## Scope guidance for coding agents

- Start in the requested feature or module directory and read its `AGENTS.md`.
- Do not inspect or edit other modules unless the public contract proves insufficient.
- If a public contract must change, identify every consumer before editing it.
- Do not bypass a repository by reading IndexedDB or localStorage from UI code.
- Do not bypass the AI provider registry with provider-specific logic in a viewer feature.
