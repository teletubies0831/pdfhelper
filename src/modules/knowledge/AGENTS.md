# Knowledge module

Owns the canonical knowledge library: documents, items, relations, tags, querying, and persistence.

- Notes, summaries, reading cards, paper cards, journals, and research results all save through the knowledge service.
- UI code must not merge legacy storage collections itself.
- IndexedDB details stay in `adapters/indexed-db/` behind repository ports.
- Compatibility imports belong in `migration/` and must be idempotent.
- Changes to the canonical item schema require repository and migration tests.
