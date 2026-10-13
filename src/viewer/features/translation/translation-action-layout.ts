const TRANSLATION_ACTIONS_SELECTOR = "#translation-primary-actions";
const TRANSLATION_RESULT_SECTION_SELECTOR = "#translation-result-section";

/**
 * Keep the persistent translation actions outside the replaceable result body.
 *
 * Sentence rendering may place the actions inside its result card for layout.
 * Before a loading/error message replaces that card, move the actions back to
 * their stable position so the buttons and their event listeners survive.
 */
export function placeTranslationActionsBeforeResult(
  root: ParentNode = document,
): void {
  const actions = root.querySelector<HTMLElement>(
    TRANSLATION_ACTIONS_SELECTOR,
  );
  const resultSection = root.querySelector<HTMLElement>(
    TRANSLATION_RESULT_SECTION_SELECTOR,
  );
  if (actions && resultSection) resultSection.before(actions);
}

export function replaceTranslationResultText(
  resultElement: Pick<HTMLElement, "textContent">,
  message: string,
  root: ParentNode = document,
): void {
  placeTranslationActionsBeforeResult(root);
  resultElement.textContent = message;
}
