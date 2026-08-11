# Assistant feature

Owns chat UI, conversation state, attachments, tool activity presentation, settings presentation, and conversation persistence.

- Use the AI module public client; never call a provider endpoint directly.
- Use document-agent and memory public APIs for tools and retrieval.
- Markdown and math rendering use viewer shared UI services.
- Provider-specific settings are rendered from provider descriptors.
