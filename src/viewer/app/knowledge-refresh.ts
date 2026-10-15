/**
 * Knowledge-page refresh coordination. The paper-card feature notifies here
 * when card data changes; the registration layer wires the actual re-render
 * (which lives in the knowledge-base feature) so neither feature imports the
 * other for this concern.
 */
let knowledgeRefreshHandler: (() => void) | null = null;

export function setKnowledgeRefreshHandler(handler: typeof knowledgeRefreshHandler): void {
  knowledgeRefreshHandler = handler;
}

export function notifyKnowledgeRefresh(): void {
  knowledgeRefreshHandler?.();
}
