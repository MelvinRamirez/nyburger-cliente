import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, formatTableLabel } from '../js/format.js';

test('formatMoney formats an integer-cents amount with currency symbol', () => {
  assert.equal(formatMoney(10), 'L10,00');
});

test('formatMoney formats a non-integer-cents amount with two decimals', () => {
  assert.equal(formatMoney(12.5), 'L12,50');
});

test('formatTableLabel prefixes a single-character table value', () => {
  assert.equal(formatTableLabel('5'), 'Mesa 5');
});

test('formatTableLabel prefixes a multi-character table value', () => {
  assert.equal(formatTableLabel('VIP-12'), 'Mesa VIP-12');
});
