import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { initialState } from '../js/actions.js';
import {
  loadMenu,
  submitOrder,
  acknowledgeAmbiguous,
  startNewOrder,
  setTableManually,
} from '../js/effects.js';

const menuItem = { item_id: 'ITM-001', name: 'Milanesa', price: 10 };

function makeStore({ table = { value: '05', source: 'url' }, cartLines = [{ item_id: 'ITM-001', name: 'Milanesa', unit_price: 10, quantity: 1 }] } = {}) {
  const s = initialState({ cart: { lines: cartLines, notes: '' } }, table);
  return createStore(s);
}

function fakeTimers() {
  const pending = new Map();
  let nextId = 1;
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    clearTimer(id) {
      pending.delete(id);
    },
    fire(id) {
      const fn = pending.get(id);
      if (fn) fn();
    },
  };
}

function baseCtx(store, api, overrides = {}) {
  const timers = fakeTimers();
  return {
    ctx: {
      store,
      api,
      now: () => '2024-01-01T00:00:00.000Z',
      isOnline: () => true,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      ...overrides,
    },
    timers,
  };
}

test('Successful submission purges the cart and shows the receipt', async () => {
  const store = makeStore();
  const data = { order_id: 'ORD-1', total_amount: 10, items: [] };
  const api = { createOrder: async () => ({ kind: 'success', data, meta: null }) };
  const { ctx } = baseCtx(store, api);

  await submitOrder(ctx);

  const s = store.getState();
  assert.deepStrictEqual(s.cart, { lines: [], notes: '' });
  assert.deepStrictEqual(s.lastReceipt, data);
  assert.equal(s.submission.status, 'idle');
});

test('LOCK_TIMEOUT keeps the cart and allows a manual retry', async () => {
  const store = makeStore();
  const api = {
    createOrder: async () => ({ kind: 'definitive', code: 'LOCK_TIMEOUT', message: '', details: null }),
  };
  const { ctx } = baseCtx(store, api);

  await submitOrder(ctx);

  const s = store.getState();
  assert.equal(s.cart.lines.length, 1);
  assert.equal(s.submission.status, 'error');
  assert.equal(s.submission.error.code, 'LOCK_TIMEOUT');
});

test('VALIDATION_ERROR on items triggers menu reconciliation', async () => {
  const store = makeStore({
    cartLines: [
      { item_id: 'ITM-001', name: 'Milanesa', unit_price: 10, quantity: 1 },
      { item_id: 'ITM-999', name: 'Ya no existe', unit_price: 5, quantity: 1 },
    ],
  });
  let createOrderCalls = 0;
  const api = {
    createOrder: async () => {
      createOrderCalls += 1;
      return {
        kind: 'definitive',
        code: 'VALIDATION_ERROR',
        message: '',
        details: { items: ['ITM-999'] },
      };
    },
    getMenu: async () => ({ kind: 'success', data: [menuItem], meta: null }),
  };
  const { ctx } = baseCtx(store, api);

  await submitOrder(ctx);

  assert.equal(createOrderCalls, 1);
  const s = store.getState();
  // La reconciliación tras el refetch ya quitó ITM-999 porque no está en el menú devuelto.
  assert.deepStrictEqual(s.cart.lines.map((l) => l.item_id), ['ITM-001']);
  assert.equal(s.menu.status, 'ready');
  assert.equal(s.submission.error.code, 'VALIDATION_ERROR');
});

test('When the menu refetch itself fails, the fallback removes the named item_ids directly', async () => {
  const store = makeStore({
    cartLines: [
      { item_id: 'ITM-001', name: 'Milanesa', unit_price: 10, quantity: 1 },
      { item_id: 'ITM-999', name: 'Ya no existe', unit_price: 5, quantity: 1 },
    ],
  });
  const api = {
    createOrder: async () => ({
      kind: 'definitive',
      code: 'VALIDATION_ERROR',
      message: '',
      details: { items: ['ITM-999'] },
    }),
    getMenu: async () => ({ kind: 'ambiguous', reason: 'network' }),
  };
  const { ctx } = baseCtx(store, api);

  await submitOrder(ctx);

  const s = store.getState();
  assert.deepStrictEqual(s.cart.lines.map((l) => l.item_id), ['ITM-001']);
  assert.equal(s.menu.status, 'error');
});

test('VALIDATION_ERROR on another field highlights that field', async () => {
  const store = makeStore();
  const api = {
    createOrder: async () => ({
      kind: 'definitive',
      code: 'VALIDATION_ERROR',
      message: '',
      details: { fields: ['table_number'] },
    }),
  };
  const { ctx } = baseCtx(store, api);

  await submitOrder(ctx);

  const s = store.getState();
  assert.equal(s.cart.lines.length, 1);
  assert.equal(s.submission.error.code, 'VALIDATION_ERROR');
  assert.deepStrictEqual(s.submission.error.fields, ['table']);
});

test('A generic definitive error shows a generic message', async () => {
  for (const code of ['SHEET_UNAVAILABLE', 'INTERNAL_ERROR', 'INVALID_JSON', 'UNKNOWN_ACTION']) {
    const store = makeStore();
    const api = {
      createOrder: async () => ({ kind: 'definitive', code, message: '', details: null }),
    };
    const { ctx } = baseCtx(store, api);

    await submitOrder(ctx);

    const s = store.getState();
    assert.equal(s.cart.lines.length, 1, `cart kept for ${code}`);
    assert.equal(s.submission.error.code, code);
  }
});

test('Ambiguous failure warns before allowing a resend', async () => {
  const store = makeStore();
  const api = {
    createOrder: async () => ({ kind: 'ambiguous', reason: 'timeout' }),
  };
  const { ctx } = baseCtx(store, api);

  await submitOrder(ctx);

  let s = store.getState();
  assert.equal(s.cart.lines.length, 1);
  assert.equal(s.submission.status, 'ambiguous');
  assert.deepStrictEqual(s.ambiguousPending, { at: '2024-01-01T00:00:00.000Z' });

  acknowledgeAmbiguous(ctx);
  s = store.getState();
  assert.equal(s.submission.status, 'idle');
  assert.equal(s.ambiguousPending, null);
});

test('Double-tapping the submit action sends exactly one request', async () => {
  const store = makeStore();
  let calls = 0;
  let resolveFirst;
  const api = {
    createOrder: async () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveFirst = () =>
          resolve({ kind: 'success', data: { order_id: 'ORD-1', total_amount: 10, items: [] }, meta: null });
      });
    },
  };
  const { ctx } = baseCtx(store, api);

  const p1 = submitOrder(ctx);
  const p2 = submitOrder(ctx); // segundo toque mientras el primero está en vuelo

  assert.equal(calls, 1);
  resolveFirst();
  await Promise.all([p1, p2]);
  assert.equal(calls, 1);
});

test('An order submitted while offline sends zero requests', async () => {
  const store = makeStore();
  let calls = 0;
  const api = { createOrder: async () => { calls += 1; return { kind: 'success', data: {}, meta: null }; } };
  const { ctx } = baseCtx(store, api, { isOnline: () => false });

  await submitOrder(ctx);

  assert.equal(calls, 0);
  const s = store.getState();
  assert.equal(s.submission.status, 'error');
  assert.equal(s.submission.error.code, 'OFFLINE');
  assert.equal(s.cart.lines.length, 1);
});

test('submissionSlow fires at SLOW_NOTICE_MS and is cancelled once the response settles', async () => {
  const store = makeStore();
  let resolveOrder;
  const api = {
    createOrder: () =>
      new Promise((resolve) => {
        resolveOrder = () =>
          resolve({ kind: 'success', data: { order_id: 'ORD-1', total_amount: 10, items: [] }, meta: null });
      }),
  };
  const { ctx, timers } = baseCtx(store, api);

  const promise = submitOrder(ctx);
  assert.equal(store.getState().submission.status, 'sending');

  // El timer fue armado (id 1) pero aún no se disparó.
  timers.fire(1);
  assert.equal(store.getState().submission.status, 'slow');

  resolveOrder();
  await promise;

  // Tras resolver, clearTimer ya corrió; disparar el mismo id de nuevo no
  // debe producir ningún efecto porque fue eliminado del mapa de pendientes.
  const statusAfterSettle = store.getState().submission.status;
  timers.fire(1);
  assert.equal(store.getState().submission.status, statusAfterSettle);
  assert.equal(store.getState().lastReceipt.order_id, 'ORD-1');
});

test('loadMenu dispatches menuLoading then menuLoaded on success', async () => {
  const store = makeStore();
  const api = { getMenu: async () => ({ kind: 'success', data: [menuItem], meta: null }) };
  const { ctx } = baseCtx(store, api);

  await loadMenu(ctx);

  const s = store.getState();
  assert.equal(s.menu.status, 'ready');
  assert.deepStrictEqual(s.menu.items, [menuItem]);
});

test('loadMenu does not call the API when offline and marks the menu as an offline error', async () => {
  const store = makeStore();
  let called = false;
  const api = { getMenu: async () => { called = true; return { kind: 'success', data: [], meta: null }; } };
  const { ctx } = baseCtx(store, api, { isOnline: () => false });

  await loadMenu(ctx);

  assert.equal(called, false);
  const s = store.getState();
  assert.equal(s.menu.status, 'error');
  assert.equal(s.menu.error.offline, true);
});

test('startNewOrder clears the receipt and reloads the menu', async () => {
  const store = makeStore();
  store.setState((s) => ({ ...s, lastReceipt: { order_id: 'ORD-1' } }));
  const api = { getMenu: async () => ({ kind: 'success', data: [menuItem], meta: null }) };
  const { ctx } = baseCtx(store, api);

  await startNewOrder(ctx);

  const s = store.getState();
  assert.equal(s.lastReceipt, null);
  assert.equal(s.menu.status, 'ready');
});

test('setTableManually accepts a valid value, dispatches it and persists it to sessionStorage', () => {
  const store = makeStore({ table: { value: null, source: null } });
  const written = {};
  const sessionStorage = { setItem: (k, v) => { written[k] = v; } };
  const { ctx } = baseCtx(store, {}, { sessionStorage });

  const ok = setTableManually(ctx, '12');

  assert.equal(ok, true);
  assert.deepStrictEqual(store.getState().table, { value: '12', source: 'manual' });
  assert.equal(written['foodc.cliente.table'], '12');
});

test('setTableManually rejects an empty value without dispatching', () => {
  const store = makeStore({ table: { value: null, source: null } });
  const { ctx } = baseCtx(store, {});

  const ok = setTableManually(ctx, '   ');

  assert.equal(ok, false);
  assert.deepStrictEqual(store.getState().table, { value: null, source: null });
});
