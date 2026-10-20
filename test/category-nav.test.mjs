import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickActiveCategory, categoryId } from '../js/views/category-nav.js';

test('pickActiveCategory: picks the entry with highest intersectionRatio among intersecting entries', () => {
  const entries = [
    { isIntersecting: true, intersectionRatio: 0.2, target: { id: 'category-bebidas' } },
    { isIntersecting: true, intersectionRatio: 0.8, target: { id: 'category-entradas' } },
    { isIntersecting: false, intersectionRatio: 0.0, target: { id: 'category-postres' } },
  ];
  assert.equal(pickActiveCategory(entries, null), 'category-entradas');
});

test('pickActiveCategory: ignores non-intersecting entries entirely', () => {
  const entries = [
    { isIntersecting: false, intersectionRatio: 0.9, target: { id: 'category-bebidas' } },
    { isIntersecting: true, intersectionRatio: 0.1, target: { id: 'category-entradas' } },
  ];
  assert.equal(pickActiveCategory(entries, null), 'category-entradas');
});

test('pickActiveCategory: keeps the current active category when nothing intersects', () => {
  const entries = [
    { isIntersecting: false, intersectionRatio: 0.0, target: { id: 'category-bebidas' } },
    { isIntersecting: false, intersectionRatio: 0.0, target: { id: 'category-entradas' } },
  ];
  assert.equal(pickActiveCategory(entries, 'category-bebidas'), 'category-bebidas');
});

test('pickActiveCategory: returns null when nothing intersects and there was no active category', () => {
  const entries = [{ isIntersecting: false, intersectionRatio: 0.0, target: { id: 'category-bebidas' } }];
  assert.equal(pickActiveCategory(entries, null), null);
});

test('categoryId: slugifies category names consistently (accents, spaces, case)', () => {
  assert.equal(categoryId('Bebidas'), 'category-bebidas');
  assert.equal(categoryId('Platos Fuertes'), 'category-platos-fuertes');
  assert.equal(categoryId('Postres y Café'), 'category-postres-y-cafe');
});

test('categoryId: falls back to "otros" for empty/undefined category', () => {
  assert.equal(categoryId(''), 'category-otros');
  assert.equal(categoryId(undefined), 'category-otros');
});
