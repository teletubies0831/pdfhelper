# Document agent module

Owns PDF text chunks, document profiles, retrieval, section resolution, document tools, sessions, and vision cache metadata.

- It does not own chat UI, knowledge-library UI, or AI provider transport.
- Application services depend on repository and AI requester ports.
- PDF.js-specific extraction belongs in adapters, not domain algorithms.
- Preserve document and index compatibility through explicit migrations.
