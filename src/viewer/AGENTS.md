# Viewer application

Owns browser UI composition around the PDF reader and feature public APIs.

- `app/bootstrap.ts` is the composition root; event wiring belongs in `app/registrations/`.
- Cross-feature imports must target the other feature's `public.ts`.
- DOM ids are stable compatibility contracts; bindings belong in `app/elements/`.
- Keep templates and styles grouped by visible function and preserve stylesheet import order.
- Feature business rules belong in the feature or a domain module, not in registrations.
