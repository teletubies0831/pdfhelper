import { viewerElement } from "../../app/viewer-elements";
import {
  findAnnotationEditorAtPoint,
  isPointInsideHighlightNoteIndicator,
  isTextSelectionMode,
} from "./annotation-editor";

export function installHighlightNotePointerHover(): void {
  let hoveredIndicator: HTMLElement | null = null;
  let hoverFrame = 0;
  let pendingPoint: { x: number; y: number } | null = null;

  const setHoveredIndicator = (indicator: HTMLElement | null) => {
    if (hoveredIndicator === indicator) return;
    hoveredIndicator?.classList.remove("is-coordinate-hovered");
    hoveredIndicator = indicator;
    hoveredIndicator?.classList.add("is-coordinate-hovered");
  };

  viewerElement.addEventListener("pointermove", (event) => {
    if (event.buttons !== 0) {
      pendingPoint = null;
      setHoveredIndicator(null);
      return;
    }

    pendingPoint = { x: event.clientX, y: event.clientY };
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const point = pendingPoint;
      pendingPoint = null;
      if (!point) return;

      const editor = isTextSelectionMode()
        ? findAnnotationEditorAtPoint(point.x, point.y, {
            highlightOnly: true,
          })
        : null;
      const editorElement = editor?.div as HTMLElement | null;
      const indicator =
        editorElement &&
        isPointInsideHighlightNoteIndicator(editorElement, point.x, point.y)
          ? editorElement.querySelector<HTMLElement>(
              ".pdf-helper-note-indicator",
            )
          : null;
      setHoveredIndicator(indicator);
    });
  });

  viewerElement.addEventListener("pointerleave", () => {
    pendingPoint = null;
    setHoveredIndicator(null);
  });
}
