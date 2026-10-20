import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, increment, decrement, removeItem, totalCents, itemCount, reconcile, toOrderPayload } from '../js/cart.js';

const empty = { lines: [], notes: '' };

test('adding an item updates the cart and total', () => {
  const cart = addItem(empty, { item_id: 'ITM-001', name: 'Milanesa', price: 10 });
  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0].quantity, 1);
  assert.equal(totalCents(cart), 1000);
});

test('incrementing and decrementing adjust quantity and total', () => {
  let cart = { lines: [{ item_id: 'ITM-001', name: 'x', unit_price: 5, quantity: 2 }], notes: '' };
  cart = increment(cart, 'ITM-001');
  assert.equal(cart.lines[0].quantity, 3);
  assert.equal(totalCents(cart), 1500);
  cart = decrement(cart, 'ITM-001');
  assert.equal(cart.lines[0].quantity, 2);
  assert.equal(totalCents(cart), 1000);
});

test('decrementing to zero removes the line', () => {
  const cart = { lines: [{ item_id: 'ITM-001', name: 'x', unit_price: 5, quantity: 1 }], notes: '' };
  const next = decrement(cart, 'ITM-001');
  assert.deepStrictEqual(next.lines, []);
});

test('removing an item drops its line from the total', () => {
  const cart = {
    lines: [
      { item_id: 'A', name: 'A', unit_price: 3, quantity: 1 },
      { item_id: 'B', name: 'B', unit_price: 7, quantity: 1 },
    ],
    notes: '',
  };
  const next = removeItem(cart, 'A');
  assert.deepStrictEqual(next.lines.map((l) => l.item_id), ['B']);
  assert.equal(totalCents(next), 700);
});

test('addItem caps per-line quantity at QTY_MAX (99)', () => {
  const cart = { lines: [{ item_id: 'ITM-001', name: 'x', unit_price: 1, quantity: 99 }], notes: '' };
  const next = addItem(cart, { item_id: 'ITM-001', name: 'x', price: 1 });
  assert.equal(next.lines[0].quantity, 99);
  assert.equal(next, cart);
});

test('increment caps at QTY_MAX (99)', () => {
  const cart = { lines: [{ item_id: 'ITM-001', name: 'x', unit_price: 1, quantity: 99 }], notes: '' };
  const next = increment(cart, 'ITM-001');
  assert.equal(next.lines[0].quantity, 99);
  assert.equal(next, cart);
});

test('addItem does not add a 51st line beyond LINES_MAX (50)', () => {
  const lines = Array.from({ length: 50 }, (_, i) => ({
    item_id: `ITM-${i}`,
    name: `Item ${i}`,
    unit_price: 1,
    quantity: 1,
  }));
  const cart = { lines, notes: '' };
  const next = addItem(cart, { item_id: 'ITM-NEW', name: 'New', price: 1 });
  assert.equal(next.lines.length, 50);
  assert.equal(next, cart);
});

test('totalCents is correct for floating point prone values (0.10 + 0.20)', () => {
  const cart = {
    lines: [
      { item_id: 'A', name: 'A', unit_price: 0.1, quantity: 1 },
      { item_id: 'B', name: 'B', unit_price: 0.2, quantity: 1 },
    ],
    notes: '',
  };
  assert.equal(totalCents(cart), 30);
});

test('itemCount sums quantities across lines', () => {
  const cart = {
    lines: [
      { item_id: 'A', name: 'A', unit_price: 1, quantity: 2 },
      { item_id: 'B', name: 'B', unit_price: 1, quantity: 3 },
    ],
    notes: '',
  };
  assert.equal(itemCount(cart), 5);
});

test('reconcile removes a line whose item_id is no longer in the menu, with a notice', () => {
  const cart = { lines: [{ item_id: 'ITM-007', name: 'Old', unit_price: 5, quantity: 1 }], notes: '' };
  const result = reconcile(cart, []);
  assert.deepStrictEqual(result.removed, [{ item_id: 'ITM-007', name: 'Old' }]);
  assert.deepStrictEqual(result.cart.lines, []);
});

test('reconcile reflects a price change in the cart display', () => {
  const cart = { lines: [{ item_id: 'ITM-001', name: 'Milanesa', unit_price: 10, quantity: 1 }], notes: '' };
  const result = reconcile(cart, [{ item_id: 'ITM-001', name: 'Milanesa', price: 12 }]);
  assert.equal(result.cart.lines[0].unit_price, 12);
  assert.deepStrictEqual(result.priceChanged, [
    { item_id: 'ITM-001', name: 'Milanesa', from: 10, to: 12 },
  ]);
});

test('reconcile returns the same cart reference when nothing changed', () => {
  const cart = { lines: [{ item_id: 'ITM-001', name: 'Milanesa', unit_price: 10, quantity: 2 }], notes: 'nota' };
  const result = reconcile(cart, [{ item_id: 'ITM-001', name: 'Milanesa', price: 10 }]);
  assert.equal(result.cart, cart);
  assert.deepStrictEqual(result.removed, []);
  assert.deepStrictEqual(result.priceChanged, []);
});

test('reconcile is idempotent across repeated calls', () => {
  const cart = { lines: [{ item_id: 'ITM-001', name: 'Milanesa', unit_price: 10, quantity: 1 }], notes: '' };
  const menu = [{ item_id: 'ITM-001', name: 'Milanesa', price: 12 }];
  const once = reconcile(cart, menu);
  const twice = reconcile(once.cart, menu);
  assert.deepStrictEqual(twice.cart.lines, once.cart.lines);
  assert.deepStrictEqual(twice.removed, []);
  assert.deepStrictEqual(twice.priceChanged, []);
});

test('reconcile preserves line order and quantity on surviving lines', () => {
  const cart = {
    lines: [
      { item_id: 'B', name: 'B', unit_price: 2, quantity: 3 },
      { item_id: 'A', name: 'A', unit_price: 1, quantity: 5 },
    ],
    notes: '',
  };
  const menu = [
    { item_id: 'A', name: 'A', price: 1 },
    { item_id: 'B', name: 'B', price: 2 },
  ];
  const result = reconcile(cart, menu);
  assert.deepStrictEqual(result.cart.lines.map((l) => l.item_id), ['B', 'A']);
  assert.equal(result.cart.lines[0].quantity, 3);
  assert.equal(result.cart.lines[1].quantity, 5);
});

test('reconcile runs the same way on every call, not only the first', () => {
  const cart = { lines: [{ item_id: 'ITM-001', name: 'Milanesa', unit_price: 10, quantity: 1 }], notes: '' };
  const firstPass = reconcile(cart, [{ item_id: 'ITM-001', name: 'Milanesa', price: 10 }]);
  const secondPass = reconcile(firstPass.cart, []); // segunda carga: ahora no está disponible
  assert.deepStrictEqual(secondPass.removed, [{ item_id: 'ITM-001', name: 'Milanesa' }]);
});

test('toOrderPayload never includes a computed total or extra fields', () => {
  const cart = {
    lines: [
      { item_id: 'A', name: 'A', unit_price: 1, quantity: 2 },
      { item_id: 'B', name: 'B', unit_price: 2, quantity: 1 },
    ],
    notes: 'sin cebolla',
  };
  const payload = toOrderPayload(cart, '05');
  assert.deepStrictEqual(payload, {
    table_number: '05',
    items: [
      { item_id: 'A', quantity: 2 },
      { item_id: 'B', quantity: 1 },
    ],
    customer_notes: 'sin cebolla',
  });
  assert.equal('total_amount' in payload, false);
});
