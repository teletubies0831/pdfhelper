import assert from 'node:assert/strict';

import {
  formatTranslationPreferencesPrompt,
  isTranslationPreferenceMemory,
  parseTranslationPreference,
  pickContextTranslation,
  serializeTranslationPreference,
  translationPreferenceKey,
  TRANSLATION_PREFERENCE_KEY_PREFIX,
} from '../src/modules/memory/translation-preferences.ts';

// Key generation is stable and lowercased.
assert.equal(
  translationPreferenceKey('Transformer'),
  `${TRANSLATION_PREFERENCE_KEY_PREFIX}transformer`,
);

// Memory classification only matches preference-category, prefixed memories.
assert.equal(
  isTranslationPreferenceMemory({
    key: translationPreferenceKey('field'), category: 'preference',
  }),
  true,
);
assert.equal(
  isTranslationPreferenceMemory({ key: translationPreferenceKey('field'), category: 'fact' }),
  false,
);
assert.equal(
  isTranslationPreferenceMemory({ key: 'manual.fact.1', category: 'preference' }),
  false,
);

// Round-trip: keep rule.
const keepRule = { kind: 'keep', term: 'Transformer' };
assert.deepEqual(
  parseTranslationPreference(serializeTranslationPreference(keepRule)),
  keepRule,
);

// Round-trip: contextual rule with deduped/trimmed context terms.
const fieldRule = {
  kind: 'contextual',
  term: 'field',
  defaultTranslation: '领域',
  contexts: [
    { contextTerms: ['电路', '电磁', 'electric', 'circuit'], translation: '电路' },
  ],
};
const fieldRoundTrip = parseTranslationPreference(serializeTranslationPreference(fieldRule));
assert.deepEqual(fieldRoundTrip, fieldRule);
assert.deepEqual(
  parseTranslationPreference(serializeTranslationPreference({
    ...fieldRule,
    contexts: [{ contextTerms: ['电路', ' 电路 ', 'electric'], translation: '电路' }],
  }))?.contexts?.[0]?.contextTerms,
  ['电路', 'electric'],
);

// Invalid contents fall back to null.
for (const invalid of [
  '',
  'not json',
  JSON.stringify({ version: 1, kind: 'keep', term: '' }),
  JSON.stringify({ version: 2, kind: 'keep', term: 'x' }),
  JSON.stringify({ version: 1, kind: 'contextual', term: 'field' }),
]) {
  assert.equal(parseTranslationPreference(invalid), null);
}

// Deterministic context resolution.
assert.equal(
  pickContextTranslation(fieldRule, 'The electric field of the circuit'),
  '电路',
);
assert.equal(
  pickContextTranslation(fieldRule, 'This field of research'),
  '领域',
);
assert.equal(pickContextTranslation(keepRule, 'Transformer models'), undefined);

// Prompt formatting covers both rule kinds and is null without rules.
const prompt = formatTranslationPreferencesPrompt([keepRule, fieldRule]);
assert.ok(prompt.includes('保留英文原文'));
assert.ok(prompt.includes('“Transformer”'));
assert.ok(prompt.includes('“field”'));
assert.ok(prompt.includes('电路'));
assert.ok(prompt.includes('领域'));
assert.equal(formatTranslationPreferencesPrompt([]), null);

console.log('Translation preference contract tests passed.');
