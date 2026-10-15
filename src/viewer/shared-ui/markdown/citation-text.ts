/**
 * Normalizes PDF text for citation matching (LaTeX tokens, dashes, whitespace,
 * case). Shared by the markdown renderer (citation tokens) and the translation
 * citation locator.
 */
export function normalizeCitationMatchText(value: string): string {
  return value
    .replace(
      /\\(?:mathbb|mathbf|mathrm|mathit|text|operatorname)\s*\{([^{}]*)\}/g,
      "$1",
    )
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\times\b/g, "×")
    .replace(/\\in\b/g, "∈")
    .replace(/\\lambda\b/g, "λ")
    .replace(/\\sigma\b/g, "σ")
    .replace(/[$\\{}_^]/g, "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\u00ad/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, "");
}
