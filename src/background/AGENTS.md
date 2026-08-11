# Background runtime

Owns extension lifecycle, runtime messages, context menus, AI request orchestration, and composition of network adapters.

- Keep `bootstrap.ts` limited to listener registration and dependency composition.
- Provider-specific payloads belong to AI provider adapters, not request handlers.
- Runtime message guards must remain provider-neutral and backward compatible.
- Do not import viewer UI code into the background runtime.
