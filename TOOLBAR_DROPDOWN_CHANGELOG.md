# Toolbar dropdown redesign

## What changed

- Removed the horizontal scrollbar from the top toolbar.
- Grouped related actions into three dropdown menus:
  - **File**: Recent files, Open PDF, Save annotated PDF
  - **Annotation tools**: Selection, highlight, ink, text annotation, color, undo/redo, smart copy, note visibility
  - **AI tools**: Chat/explanation, paper card generation, knowledge base
- Kept **Outline**, **Reading mode**, and **Settings** directly accessible.
- Added outside-click and Escape-key closing behavior.
- Preserved all existing element IDs, so the original event handlers continue to work.
- Added responsive compaction for narrower windows.

## Files modified

- `entrypoints/viewer/index.html`
- `entrypoints/viewer/style.css`
- `entrypoints/viewer/main.ts`

## Build for Chrome

```bash
pnpm install
pnpm build:chrome
```

Then reload `.output/chrome-mv3` from `chrome://extensions`.
