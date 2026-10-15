import assert from 'node:assert/strict';

import { createStateCell } from '../src/viewer/app/state-cell.ts';

const cell = createStateCell(null);
const seen = [];
const unsubscribe = cell.subscribe((value) => seen.push(value));

assert.equal(cell.value, null);
cell.value = 42;
cell.value = 42;
// Every write notifies, including writes of an equal value.
assert.deepEqual(seen, [42, 42]);
assert.equal(cell.value, 42);

unsubscribe();
cell.value = 7;
assert.deepEqual(seen, [42, 42]);
assert.equal(cell.value, 7);

// Plain-object interop: reading through destructuring still sees the value.
const { value } = cell;
assert.equal(value, 7);

// Independent cells never cross-talk.
const other = createStateCell('a');
other.value = 'b';
assert.equal(cell.value, 7);

console.log('State cell contract tests passed.');
