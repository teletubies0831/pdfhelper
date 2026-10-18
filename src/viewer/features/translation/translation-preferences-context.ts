import {
  formatTranslationPreferencesPrompt,
  isTranslationPreferenceMemory,
  memoryTools,
  parseTranslationPreference,
  type TranslationPreferenceRule,
} from "../../../modules/memory/public";

/**
 * Loads the user's translation preference rules from long-term memory
 * (`preference` category, `translation-preference:` key prefix).
 */
export async function loadTranslationPreferenceRules(): Promise<TranslationPreferenceRule[]> {
  try {
    const memories = await memoryTools.list({ categories: ["preference"], limit: 100 });
    return memories
      .filter(isTranslationPreferenceMemory)
      .map((memory) => parseTranslationPreference(memory.content))
      .filter((rule): rule is TranslationPreferenceRule => rule !== null);
  } catch {
    return [];
  }
}

/**
 * Renders the rules as a strict prompt instruction block, or null when no
 * rules exist.
 */
export async function loadTranslationPreferencePromptBlock(): Promise<string | null> {
  const rules = await loadTranslationPreferenceRules();
  return formatTranslationPreferencesPrompt(rules);
}
