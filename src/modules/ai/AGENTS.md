# AI module

Owns provider-neutral AI requests, provider registration, streaming normalization, configuration persistence, and provider adapters.

- Viewer features consume only `public.ts` and must not branch on provider ids.
- A new provider belongs in `providers/` and must declare its capabilities.
- Provider-specific payloads and stream parsing stay inside that provider adapter or `transport/`.
- User-facing features receive normalized messages, tool calls, usage, and errors.
- Do not add provider-specific fields to unrelated viewer features.
