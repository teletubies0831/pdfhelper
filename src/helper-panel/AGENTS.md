# Helper panel

Owns the compact selection hand-off page and lightweight PDF text inspection.

- Shared selection contracts come from the selection module public API.
- PDF extraction logic must not depend on viewer feature internals.
- Keep browser tab/storage access in the bootstrap/controller layer.
