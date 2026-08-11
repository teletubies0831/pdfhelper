# Annotation feature

Owns highlight/free-text editing, annotation selection, hit testing, notes, history controls, restoration, and annotation UI.

- Receive the PDF reader and editor access through explicit dependencies.
- Selection text extraction belongs to the text-selection feature, not here.
- Keep geometry and hit-testing functions pure where possible.
- Preserve undo, redo, note restoration, and annotated export behavior.
