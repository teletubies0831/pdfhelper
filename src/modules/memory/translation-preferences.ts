import type { LongTermMemory } from './contracts';

/**
 * Translation preferences stored inside the long-term memory store as
 * `preference`-category memories with the `translation-preference:` key
 * prefix. Each memory holds one term rule:
 *
 * - kind "keep":       the term stays untranslated in Chinese output;
 * - kind "contextual": the term translates differently per context (e.g.
 *                      "field" -> "电路" in circuit contexts, "领域" otherwise).
 *
 * Rules are consumed by the translation prompts and can be created both by
 * the user (settings panel) and by AI suggestions.
 */
export const TRANSLATION_PREFERENCE_KEY_PREFIX = 'translation-preference:';

export interface TranslationPreferenceContext {
  contextTerms: string[];
  translation: string;
}

export interface TranslationPreferenceRule {
  kind: 'keep' | 'contextual';
  term: string;
  /** Default translation for contextual rules (used outside listed contexts). */
  defaultTranslation?: string;
  contexts?: TranslationPreferenceContext[];
}

export function translationPreferenceKey(term: string): string {
  return `${TRANSLATION_PREFERENCE_KEY_PREFIX}${term.trim().toLocaleLowerCase()}`;
}

export function isTranslationPreferenceMemory(memory: LongTermMemory): boolean {
  return (
    memory.category === 'preference'
    && memory.key.startsWith(TRANSLATION_PREFERENCE_KEY_PREFIX)
  );
}

function normalizeTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

export function serializeTranslationPreference(rule: TranslationPreferenceRule): string {
  return JSON.stringify({
    version: 1,
    kind: rule.kind,
    term: rule.term.trim(),
    defaultTranslation: rule.defaultTranslation?.trim() || undefined,
    contexts: rule.contexts
      ?.map((context) => ({
        contextTerms: normalizeTerms(context.contextTerms),
        translation: context.translation.trim(),
      }))
      .filter((context) => context.translation && context.contextTerms.length > 0),
  });
}

export function parseTranslationPreference(
  content: string,
): TranslationPreferenceRule | null {
  try {
    const value = JSON.parse(content) as {
      version?: number;
      kind?: unknown;
      term?: unknown;
      defaultTranslation?: unknown;
      contexts?: unknown;
    };
    if (value?.version !== 1) return null;
    if (typeof value.term !== 'string' || !value.term.trim()) return null;
    if (value.kind === 'keep') {
      return { kind: 'keep', term: value.term.trim() };
    }
    if (value.kind === 'contextual') {
      const contexts = Array.isArray(value.contexts)
        ? value.contexts
          .map((raw) => {
            const context = raw as { contextTerms?: unknown; translation?: unknown };
            const contextTerms = normalizeTerms(context.contextTerms);
            const translation =
              typeof context.translation === 'string'
                ? context.translation.trim()
                : '';
            return { contextTerms, translation };
          })
          .filter((context) => context.translation && context.contextTerms.length > 0)
        : [];
      if (contexts.length === 0) {
        const fallback = typeof value.defaultTranslation === 'string'
          ? value.defaultTranslation.trim()
          : '';
        if (!fallback) return null;
      }
      return {
        kind: 'contextual',
        term: value.term.trim(),
        defaultTranslation:
          typeof value.defaultTranslation === 'string'
            ? value.defaultTranslation.trim()
            : undefined,
        contexts,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Deterministic context resolution used for hints and tests; the translation
 * model applies the same rules from the prompt.
 */
export function pickContextTranslation(
  rule: TranslationPreferenceRule,
  sourceText: string,
): string | undefined {
  if (rule.kind !== 'contextual') return undefined;
  const normalizedSource = sourceText.toLocaleLowerCase();
  for (const context of rule.contexts ?? []) {
    if (
      context.contextTerms.some((term) =>
        normalizedSource.includes(term.toLocaleLowerCase()),
      )
    ) {
      return context.translation;
    }
  }
  return rule.defaultTranslation;
}

/**
 * Renders the rules as a strict Chinese instruction block for translation
 * prompts. Returns null when there is nothing to enforce.
 */
export function formatTranslationPreferencesPrompt(
  rules: readonly TranslationPreferenceRule[],
): string | null {
  const keepTerms = rules
    .filter((rule) => rule.kind === 'keep')
    .map((rule) => rule.term);
  const contextual = rules.filter((rule) => rule.kind === 'contextual');
  if (keepTerms.length === 0 && contextual.length === 0) return null;

  const lines = ['翻译偏好（必须严格遵守）：'];
  if (keepTerms.length > 0) {
    lines.push(
      `- 以下术语在译文中保留英文原文，不要翻译：${keepTerms.map((term) => `“${term}”`).join('、')}。`,
    );
  }
  for (const rule of contextual) {
    const contextLines = (rule.contexts ?? []).map(
      (context) =>
        `当上下文涉及【${context.contextTerms.join('、')}】时译为“${context.translation}”`,
    );
    if (contextLines.length > 0) {
      lines.push(`- 术语“${rule.term}”：${contextLines.join('；')}${rule.defaultTranslation ? `；其他场景译为“${rule.defaultTranslation}”` : ''}。`);
    } else if (rule.defaultTranslation) {
      lines.push(`- 术语“${rule.term}”统一译为“${rule.defaultTranslation}”。`);
    }
  }
  return lines.join('\n');
}
