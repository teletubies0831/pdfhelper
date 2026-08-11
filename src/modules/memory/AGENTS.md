# Memory module

Owns long-term conversational memory and its tool operations.

- Long-term memory is separate from the research knowledge library.
- UI and tool callers use `public.ts`; they never open the memory database directly.
- Search scoring is pure domain logic and must have focused tests.
- Repository implementations and database schema stay under `adapters/`.
