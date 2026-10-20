import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendQuickTag } from '../js/views/cart-sheet.js';

test('appendQuickTag: appends the tag to an empty textarea value as-is', () => {
  assert.equal(appendQuickTag('', 'Sin cebolla', 250), 'Sin cebolla');
});

test('appendQuickTag: appends with a single separating space when there is existing text', () => {
  assert.equal(appendQuickTag('Sin cebolla', 'Salsa aparte', 250), 'Sin cebolla Salsa aparte');
});

test('appendQuickTag: does not add a double space if the current value already ends with one', () => {
  assert.equal(appendQuickTag('Sin cebolla ', 'Salsa aparte', 250), 'Sin cebolla Salsa aparte');
});

test('appendQuickTag: treats a null/undefined current value as empty', () => {
  assert.equal(appendQuickTag(undefined, 'Término medio', 250), 'Término medio');
});

test('appendQuickTag: clips the result to the max code point length, same rule as actions.setNotes', () => {
  const current = 'x'.repeat(245);
  const result = appendQuickTag(current, 'Sin cebolla', 250);
  assert.equal(Array.from(result).length, 250);
  assert.equal(result, current + ' Sin ');
});

test('appendQuickTag: returns exactly max-length text unmodified when already at the limit', () => {
  const current = 'x'.repeat(250);
  const result = appendQuickTag(current, 'Sin cebolla', 250);
  assert.equal(result, current);
  assert.equal(Array.from(result).length, 250);
});
