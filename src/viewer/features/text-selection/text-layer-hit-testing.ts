export function findTextLayerAtPoint(
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const elements = document.elementsFromPoint(clientX, clientY);
  return (
    (elements.find(
      (element) =>
        element instanceof HTMLElement
        && element.classList.contains("textLayer"),
    ) as HTMLElement | undefined) ?? null
  );
}

export function isPointInsideTextGlyph(clientX: number, clientY: number): boolean {
  const elementsAtPoint = document.elementsFromPoint(clientX, clientY);
  const textLayer = elementsAtPoint.find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement
      && element.classList.contains("textLayer"),
  );
  if (!textLayer) return false;

  const directTextItem = elementsAtPoint.find((element) => {
    if (!(element instanceof HTMLElement) || !textLayer.contains(element)) {
      return false;
    }
    const textItem = element.closest<HTMLElement>(
      'span[role="presentation"], span',
    );
    return Boolean(textItem && textLayer.contains(textItem) && textItem.textContent?.trim());
  });
  if (directTextItem) return true;

  // Probe native caret targets instead of synchronously measuring every span.
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const probeOffsets = [
    [0, 0],
    [-8, 0],
    [8, 0],
    [0, -3],
    [0, 3],
  ] as const;

  return probeOffsets.some(([offsetX, offsetY]) => {
    const x = clientX + offsetX;
    const y = clientY + offsetY;
    const caretNode = documentWithCaret.caretPositionFromPoint?.(x, y)?.offsetNode
      ?? documentWithCaret.caretRangeFromPoint?.(x, y)?.startContainer
      ?? null;
    if (!caretNode || !textLayer.contains(caretNode)) return false;

    const textItem = (caretNode.nodeType === Node.TEXT_NODE
      ? caretNode.parentElement
      : caretNode as Element
    )?.closest<HTMLElement>('span[role="presentation"], span');
    return Boolean(
      textItem
      && textLayer.contains(textItem)
      && textItem.textContent?.trim(),
    );
  });
}
