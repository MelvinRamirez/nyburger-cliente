import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReceiptTime } from '../js/views/receipt-view.js';

test('formatReceiptTime: falls back to the raw string for an invalid/unparseable date', () => {
  assert.equal(formatReceiptTime('not-a-date'), 'not-a-date');
});

test('formatReceiptTime: returns an empty string for a missing value', () => {
  assert.equal(formatReceiptTime(undefined), '');
  assert.equal(formatReceiptTime(null), '');
  assert.equal(formatReceiptTime(''), '');
});

test('formatReceiptTime: formats a valid ISO timestamp as a short local time (not the raw ISO string)', () => {
  const formatted = formatReceiptTime('2024-05-01T19:15:00.000Z');
  assert.notEqual(formatted, '2024-05-01T19:15:00.000Z');
  assert.match(formatted, /\d{1,2}:\d{2}/);
});
