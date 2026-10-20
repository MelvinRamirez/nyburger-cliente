import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTable, parseTableParam, resolveTable } from '../js/table.js';

test('table parameter resolves without a modal', () => {
  const result = resolveTable({ search: '?table=05', sessionValue: null });
  assert.deepStrictEqual(result, { value: '05', source: 'url' });
});

test('whitespace-only or empty table parameter is treated as absent', () => {
  assert.equal(parseTableParam('?table='), null);
  assert.equal(parseTableParam('?table=%20'), null);
});

test('reload within the same session keeps the resolved table', () => {
  const result = resolveTable({ search: '', sessionValue: '05' });
  assert.deepStrictEqual(result, { value: '05', source: 'session' });
});

test('URL beats session when both are present and differ', () => {
  const result = resolveTable({ search: '?table=12', sessionValue: '05' });
  assert.deepStrictEqual(result, { value: '12', source: 'url' });
});

test('no table in URL or session resolves to null', () => {
  const result = resolveTable({ search: '', sessionValue: null });
  assert.deepStrictEqual(result, { value: null, source: null });
});

test('normalizeTable trims whitespace', () => {
  assert.equal(normalizeTable('  05  '), '05');
});

test('normalizeTable returns null for empty or null input', () => {
  assert.equal(normalizeTable(''), null);
  assert.equal(normalizeTable('   '), null);
  assert.equal(normalizeTable(null), null);
  assert.equal(normalizeTable(undefined), null);
});

test('normalizeTable boundary at TABLE_MAX (20 characters)', () => {
  const exactly20 = 'a'.repeat(20);
  const over20 = 'a'.repeat(21);
  assert.equal(normalizeTable(exactly20), exactly20);
  assert.equal(normalizeTable(over20), null);
});
