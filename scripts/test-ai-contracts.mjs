import assert from 'node:assert/strict';

import { normalizeAiBaseUrl } from '../src/modules/ai/contracts.ts';

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

console.log('AI base URL contract tests passed.');
