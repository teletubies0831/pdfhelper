import assert from 'node:assert/strict';

import { isAiRuntimeRequest, normalizeAiBaseUrl } from '../src/modules/ai/contracts.ts';

assert.equal(
  normalizeAiBaseUrl('  https://api.example.com/v1///  ', 'openai-compatible'),
  'https://api.example.com/v1',
);
assert.equal(
  normalizeAiBaseUrl('', 'deepseek'),
  'https://api.deepseek.com',
);
assert.equal(
  normalizeAiBaseUrl('http://localhost:8080/v1/', 'openai-compatible'),
  'http://localhost:8080/v1',
);
assert.equal(
  normalizeAiBaseUrl('http://127.0.0.1:8080/v1', 'openai-compatible'),
  'http://127.0.0.1:8080/v1',
);
assert.equal(
  normalizeAiBaseUrl('http://[::1]:8080/v1', 'openai-compatible'),
  'http://[::1]:8080/v1',
);

for (const value of [
  'http://api.example.com/v1',
  'ftp://api.example.com/v1',
  'not a URL',
  'https://user:secret@api.example.com/v1',
  'https://api.example.com/v1?tenant=secret',
  'https://api.example.com/v1#fragment',
]) {
  assert.throws(
    () => normalizeAiBaseUrl(value, 'openai-compatible'),
    Error,
    `Expected ${value} to be rejected`,
  );
}

// ---------------------------------------------------------------------------
// `isAiRuntimeRequest` is a hand-maintained string whitelist, and the background
// listener drops anything it rejects *silently* — no error, no response, just a
// hung caller. Every request type must therefore be pinned here, so adding a
// contract without adding it to the whitelist fails the build instead of
// producing a message that never gets an answer.
// ---------------------------------------------------------------------------
const RUNTIME_REQUEST_TYPES = [
  'pdf-helper:ai-chat',
  'pdf-helper:ai-test',
  'pdf-helper:ai-detect-reading-mode',
  'pdf-helper:ai-generate-document-overview',
  'pdf-helper:ai-extract-entities',
  'pdf-helper:ai-judge-relations',
  'pdf-helper:ai-compress-conversation',
  'pdf-helper:ai-vision',
  'pdf-helper:ai-vision-test',
];
for (const type of RUNTIME_REQUEST_TYPES) {
  assert.equal(
    isAiRuntimeRequest({ type }),
    true,
    `${type} must be accepted by isAiRuntimeRequest, otherwise the message is dropped silently`,
  );
}

// Non-requests and unknown types must be rejected so unrelated messages
// (progress broadcasts, first-run flags) do not enter the AI dispatch path.
for (const value of [
  null,
  undefined,
  'pdf-helper:ai-chat',
  {},
  { type: 'pdf-helper:ai-document-overview-progress' },
  { type: 'pdf-helper:ai-unknown' },
  { type: 42 },
]) {
  assert.equal(isAiRuntimeRequest(value), false, `${JSON.stringify(value)} must be rejected`);
}

console.log('AI base URL contract tests passed.');
