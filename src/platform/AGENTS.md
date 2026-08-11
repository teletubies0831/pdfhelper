# Platform adapters

Owns concrete browser persistence and infrastructure primitives.

- Domain and viewer code call repositories; they do not open databases directly.
- Preserve existing storage keys and upgrade behavior unless an explicit migration is requested.
- Keep adapters replaceable and free of UI decisions.
- Database schema changes require a migration path and verification against existing data.
