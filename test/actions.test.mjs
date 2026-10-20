import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, actions, canSubmit } from '../js/actions.js';

const menuItem = { item_id: 'ITM-001', name: 'Milanesa', price: 10 };

test('initialState builds defaults when nothing is hydrated', () => {
  const s = initialState();
  assert.deepStrictEqual(s, {
    table: { value: null, source: null },
    menu: { status: 'idle', items: [], error: null },
    cart: { lines: [], notes: '' },
    cartNotice: null,
    submission: { status: 'idle', error: null },
    ambiguousPending: null,
    lastReceipt: null,
  });
});

test('initialState uses hydrated cart, lastReceipt and ambiguousPending', () => {
  const hydrated = {
    cart: { lines: [{ item_id: 'x', name: 'x', unit_price: 1, quantity: 1 }], notes: 'hola' },
    lastReceipt: { order_id: 'ORD-1' },
    ambiguousPending: { at: '2024-01-01' },
  };
  const s = initialState(hydrated, { value: '05', source: 'url' });
  assert.deepStrictEqual(s.cart, hydrated.cart);
  assert.deepStrictEqual(s.lastReceipt, hydrated.lastReceipt);
  assert.deepStrictEqual(s.ambiguousPending, hydrated.ambiguousPending);
  assert.deepStrictEqual(s.table, { value: '05', source: 'url' });
});

test('tableResolved sets table value and source', () => {
  const s = actions.tableResolved(initialState(), { value: '12', source: 'manual' });
  assert.deepStrictEqual(s.table, { value: '12', source: 'manual' });
});

test('menuLoading sets status loading and clears error', () => {
  let s = initialState();
  s = actions.menuFailed(s, { offline: true });
  s = actions.menuLoading(s);
  assert.equal(s.menu.status, 'loading');
  assert.equal(s.menu.error, null);
});

test('menuLoaded sets ready status for non-empty items', () => {
  const s = actions.menuLoaded(initialState(), [menuItem]);
  assert.equal(s.menu.status, 'ready');
  assert.deepStrictEqual(s.menu.items, [menuItem]);
});

test('menuLoaded sets empty status for zero items', () => {
  const s = actions.menuLoaded(initialState(), []);
  assert.equal(s.menu.status, 'empty');
});

test('menuLoaded triggers reconciliation and sets cartNotice only when something actually changed', () => {
  let s = initialState();
  s = { ...s, cart: { lines: [{ item_id: 'ITM-999', name: 'Old', unit_price: 1, quantity: 1 }], notes: '' } };

  const withNotice = actions.menuLoaded(s, [menuItem]); // ITM-999 no está en el menú
  assert.deepStrictEqual(withNotice.cartNotice, {
    removed: [{ item_id: 'ITM-999', name: 'Old' }],
    priceChanged: [],
  });
  assert.deepStrictEqual(withNotice.cart.lines, []);

  const s2 = { ...initialState(), cart: { lines: [{ item_id: 'ITM-001', name: 'Milanesa', unit_price: 10, quantity: 1 }], notes: '' } };
  const noNotice = actions.menuLoaded(s2, [menuItem]);
  assert.equal(noNotice.cartNotice, null);
});

test('menuFailed sets error status with offline flag', () => {
  const s = actions.menuFailed(initialState(), { offline: true });
  assert.deepStrictEqual(s.menu, { status: 'error', items: [], error: { offline: true } });
});

test('addItem/increment/decrement/removeItem delegate to cart module', () => {
  let s = initialState();
  s = actions.addItem(s, menuItem);
  assert.equal(s.cart.lines.length, 1);
  s = actions.increment(s, 'ITM-001');
  assert.equal(s.cart.lines[0].quantity, 2);
  s = actions.decrement(s, 'ITM-001');
  assert.equal(s.cart.lines[0].quantity, 1);
  s = actions.removeItem(s, 'ITM-001');
  assert.equal(s.cart.lines.length, 0);
});

test('addItem while a receipt is showing implicitly starts a new order', () => {
  let s = initialState();
  s = { ...s, table: { value: '05', source: 'url' } };
  s = actions.orderSucceeded(s, { data: { order_id: 'ORD-1' } });
  assert.equal(canSubmit(s), false);

  s = actions.addItem(s, menuItem);
  assert.equal(s.lastReceipt, null);
  assert.equal(s.submission.status, 'idle');
  assert.equal(s.cart.lines.length, 1);
  assert.equal(canSubmit(s), true);
});

test('addItem does not touch lastReceipt or submission when there is no pending receipt', () => {
  let s = initialState();
  s = { ...s, submission: { status: 'error', error: { code: 'X', fields: [] } } };
  s = actions.addItem(s, menuItem);
  assert.equal(s.lastReceipt, null);
  assert.deepStrictEqual(s.submission, { status: 'error', error: { code: 'X', fields: [] } });
});

test('setNotes clips to NOTES_MAX code points', () => {
  const long = 'a'.repeat(300);
  const s = actions.setNotes(initialState(), long);
  assert.equal(Array.from(s.cart.notes).length, 250);
});

test('dismissCartNotice clears the notice', () => {
  let s = initialState();
  s = { ...s, cartNotice: { removed: [], priceChanged: [] } };
  s = actions.dismissCartNotice(s);
  assert.equal(s.cartNotice, null);
});

test('submissionStarted and submissionSlow transition submission status', () => {
  let s = initialState();
  s = actions.submissionStarted(s);
  assert.equal(s.submission.status, 'sending');
  s = actions.submissionSlow(s);
  assert.equal(s.submission.status, 'slow');
});

test('submissionSlow is a no-op when not currently sending', () => {
  const s = initialState();
  const s2 = actions.submissionSlow(s);
  assert.equal(s2.submission.status, 'idle');
});

test('orderSucceeded purges cart, sets receipt, clears ambiguousPending', () => {
  let s = initialState();
  s = { ...s, cart: { lines: [{ item_id: 'x', name: 'x', unit_price: 1, quantity: 1 }], notes: 'nota' }, ambiguousPending: { at: 'x' } };
  const data = { order_id: 'ORD-1', total_amount: 10 };
  s = actions.orderSucceeded(s, { data });
  assert.deepStrictEqual(s.cart, { lines: [], notes: '' });
  assert.equal(s.ambiguousPending, null);
  assert.deepStrictEqual(s.lastReceipt, data);
  assert.equal(s.submission.status, 'idle');
});

test('orderFailed normalizes details.fields', () => {
  const s = actions.orderFailed(initialState(), {
    code: 'VALIDATION_ERROR',
    details: { fields: ['table_number', 'items[0]', 'customer_notes'] },
  });
  assert.equal(s.submission.status, 'error');
  assert.equal(s.submission.error.code, 'VALIDATION_ERROR');
  assert.deepStrictEqual(new Set(s.submission.error.fields), new Set(['table', 'items', 'notes']));
});

test('orderFailed with no details yields empty fields', () => {
  const s = actions.orderFailed(initialState(), { code: 'LOCK_TIMEOUT', details: null });
  assert.deepStrictEqual(s.submission.error.fields, []);
});

test('orderAmbiguous sets ambiguous status and persists ambiguousPending', () => {
  const s = actions.orderAmbiguous(initialState(), { at: '2024-01-01T00:00:00.000Z' });
  assert.equal(s.submission.status, 'ambiguous');
  assert.deepStrictEqual(s.ambiguousPending, { at: '2024-01-01T00:00:00.000Z' });
});

test('ambiguousAcknowledged clears ambiguousPending and re-enables submission', () => {
  let s = initialState();
  s = actions.orderAmbiguous(s, { at: 'x' });
  s = actions.ambiguousAcknowledged(s);
  assert.equal(s.submission.status, 'idle');
  assert.equal(s.ambiguousPending, null);
});

test('newOrderStarted clears lastReceipt and resets submission', () => {
  let s = initialState();
  s = { ...s, lastReceipt: { order_id: 'ORD-1' } };
  s = actions.newOrderStarted(s);
  assert.equal(s.lastReceipt, null);
  assert.equal(s.submission.status, 'idle');
});

function baseCanSubmitState() {
  return {
    cart: { lines: [{ item_id: 'x', name: 'x', unit_price: 1, quantity: 1 }], notes: '' },
    table: { value: '05', source: 'url' },
    submission: { status: 'idle', error: null },
    ambiguousPending: null,
    lastReceipt: null,
  };
}

test('canSubmit is true only when every condition is satisfied', () => {
  assert.equal(canSubmit(baseCanSubmitState()), true);
});

test('canSubmit is false for each disqualifying condition independently', () => {
  assert.equal(canSubmit({ ...baseCanSubmitState(), cart: { lines: [], notes: '' } }), false);
  assert.equal(canSubmit({ ...baseCanSubmitState(), table: { value: null, source: null } }), false);
  assert.equal(
    canSubmit({ ...baseCanSubmitState(), submission: { status: 'sending', error: null } }),
    false,
  );
  assert.equal(
    canSubmit({ ...baseCanSubmitState(), submission: { status: 'slow', error: null } }),
    false,
  );
  assert.equal(
    canSubmit({ ...baseCanSubmitState(), submission: { status: 'ambiguous', error: null } }),
    false,
  );
  assert.equal(canSubmit({ ...baseCanSubmitState(), ambiguousPending: { at: 'x' } }), false);
  assert.equal(canSubmit({ ...baseCanSubmitState(), lastReceipt: { order_id: 'x' } }), false);
  assert.equal(
    canSubmit({ ...baseCanSubmitState(), cart: { lines: baseCanSubmitState().cart.lines, notes: 'a'.repeat(251) } }),
    false,
  );
});
