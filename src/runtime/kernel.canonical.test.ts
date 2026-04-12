import { test } from 'vitest';
import assert from 'node:assert/strict';
import { toCanonical } from './kernel';

test('toCanonical: null', () => {
  assert.equal(toCanonical(null), 'null');
});

test('toCanonical: primitives', () => {
  assert.equal(toCanonical(42), '42');
  assert.equal(toCanonical('hello'), '"hello"');
  assert.equal(toCanonical(true), 'true');
  assert.equal(toCanonical(false), 'false');
});

test('toCanonical: object keys are sorted', () => {
  assert.equal(toCanonical({ z: 1, a: 2, m: 3 }), '{"a":2,"m":3,"z":1}');
});

test('toCanonical: nested objects have keys sorted recursively', () => {
  assert.equal(
    toCanonical({ b: { y: 1, x: 2 }, a: 'hello' }),
    '{"a":"hello","b":{"x":2,"y":1}}',
  );
});

test('toCanonical: arrays preserve element order', () => {
  assert.equal(toCanonical([3, 1, 2]), '[3,1,2]');
});

test('toCanonical: array with mixed types and nested object', () => {
  assert.equal(
    toCanonical([null, 1, 'two', { b: 2, a: 1 }]),
    '[null,1,"two",{"a":1,"b":2}]',
  );
});

test('toCanonical: undefined values are omitted from objects', () => {
  assert.equal(toCanonical({ a: 1, b: undefined, c: 3 }), '{"a":1,"c":3}');
});

test('toCanonical: empty object', () => {
  assert.equal(toCanonical({}), '{}');
});

test('toCanonical: empty array', () => {
  assert.equal(toCanonical([]), '[]');
});

test('toCanonical: object insertion order does not affect output', () => {
  const a = { x: 1, y: 2 };
  const b = { y: 2, x: 1 };
  assert.equal(toCanonical(a), toCanonical(b));
});
