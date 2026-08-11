# Text selection feature

Owns PDF text selection normalization, sentence context, range geometry, overlays, context menu state, and smart copy.

- Keep geometry pure and independent from AI requests.
- Translation and assistant consume selection snapshots through public functions.
- Do not mutate annotation state directly.
