import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPersisted, attachPersistence } from '../js/persistence.js';
import { createStore } from '../js/store.js';
import { initialState, actions } from '../js/actions.js';

function fakeStorage(initial = new Map()) {
  const map = initial;
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
  };
}

test('loadPersisted tolerates a null storage', () => {
  const result = loadPersisted(null, 'k');
  assert.deepStrictEqual(result, {
    cart: { lines: [], notes: '' },
    lastReceipt: null,
    ambiguousPending: null,
    table: null,
  });
});

test('loadPersisted tolerates missing key', () => {
  const storage = fakeStorage();
  const result = loadPersisted(storage, 'k');
  assert.deepStrictEqual(result.cart, { lines: [], notes: '' });
});

test('loadPersisted tolerates corrupt JSON', () => {
  const storage = fakeStorage(new Map([['k', '{not valid json']]));
  const result = loadPersisted(storage, 'k');
  assert.deepStrictEqual(result.cart, { lines: [], notes: '' });
});

test('loadPersisted tolerates missing or old version', () => {
  const storage = fakeStorage(new Map([['k', JSON.stringify({ cart: { lines: [], notes: '' } })]]));
  const result = loadPersisted(storage, 'k');
  assert.deepStrictEqual(result.cart, { lines: [], notes: '' });

  const storageOldV = fakeStorage(
    new Map([['k', JSON.stringify({ v: 0, cart: { lines: [{ item_id: 'A', quantity: 1 }], notes: '' } })]]),
  );
  const resultOldV = loadPersisted(storageOldV, 'k');
  assert.deepStrictEqual(resultOldV.cart, { lines: [], notes: '' });
});

test('loadPersisted sanitizes invalid cart lines away', () => {
  const stored = {
    v: 1,
    cart: {
      lines: [
        { item_id: 'A', name: 'A', unit_price: 1, quantity: 5 }, // válida
        { item_id: '', name: 'bad', unit_price: 1, quantity: 1 }, // item_id vacío
        { item_id: 'B', name: 'B', unit_price: 1, quantity: 0 }, // quantity fuera de rango
        { item_id: 'C', name: 'C', unit_price: 1, quantity: 100 }, // quantity fuera de rango
        { item_id: 'D', name: 'D', unit_price: 1, quantity: 'two' }, // quantity no entera
        { quantity: 1 }, // sin item_id
      ],
      notes: 'x'.repeat(260),
    },
    lastReceipt: null,
    ambiguousPending: null,
  };
  const storage = fakeStorage(new Map([['k', JSON.stringify(stored)]]));
  const result = loadPersisted(storage, 'k');
  assert.deepStrictEqual(result.cart.lines, [{ item_id: 'A', name: 'A', unit_price: 1, quantity: 5 }]);
  assert.equal(result.cart.notes.length, 250);
});

test('a successful mutation results in exactly one setItem call', () => {
  const storage = fakeStorage();
  let setItemCalls = 0;
  const originalSetItem = storage.setItem.bind(storage);
  storage.setItem = (...args) => {
    setItemCalls++;
    originalSetItem(...args);
  };

  const store = createStore(initialState());
  attachPersistence(store, storage, 'k');

  store.setState((s) => actions.addItem(s, { item_id: 'A', name: 'A', price: 1 }));
  assert.equal(setItemCalls, 1);

  // Deja el estado con ambiguousPending no nulo antes de medir, sin contar
  // esa escritura preparatoria.
  store.setState((s) => ({ ...s, ambiguousPending: { at: 'x' } }));

  // orderSucceeded cambia cart + lastReceipt + ambiguousPending en una sola
  // transición atómica: debe seguir siendo una única escritura, no una por
  // porción modificada.
  setItemCalls = 0;
  store.setState((s) => actions.orderSucceeded(s, { data: { order_id: 'ORD-1' } }));
  assert.equal(setItemCalls, 1);
});

test('loadPersisted round-trips the table value persisted alongside cart/receipt', () => {
  const stored = { v: 1, cart: { lines: [], notes: '' }, lastReceipt: null, ambiguousPending: null, table: '05' };
  const storage = fakeStorage(new Map([['k', JSON.stringify(stored)]]));
  const result = loadPersisted(storage, 'k');
  assert.equal(result.table, '05');
});

test('loadPersisted treats a non-string table as absent', () => {
  const stored = { v: 1, cart: { lines: [], notes: '' }, lastReceipt: null, ambiguousPending: null, table: 7 };
  const storage = fakeStorage(new Map([['k', JSON.stringify(stored)]]));
  const result = loadPersisted(storage, 'k');
  assert.equal(result.table, null);
});

test('a table-only change still results in exactly one setItem call, with the table included', () => {
  const storage = fakeStorage();
  const store = createStore(initialState({}, { value: '05', source: 'url' }));
  attachPersistence(store, storage, 'k');

  let setItemCalls = 0;
  const originalSetItem = storage.setItem.bind(storage);
  storage.setItem = (...args) => {
    setItemCalls++;
    originalSetItem(...args);
  };

  store.setState((s) => actions.tableResolved(s, { value: '12', source: 'url' }));
  assert.equal(setItemCalls, 1);
  assert.equal(JSON.parse(storage.map.get('k')).table, '12');
});

test('a setItem that throws does not crash the store or lose in-memory state', () => {
  const storage = fakeStorage();
  storage.setItem = () => {
    throw new Error('QuotaExceededError');
  };

  const store = createStore(initialState());
  assert.doesNotThrow(() => attachPersistence(store, storage, 'k'));

  assert.doesNotThrow(() => {
    store.setState((s) => actions.addItem(s, { item_id: 'A', name: 'A', price: 1 }));
  });
  assert.equal(store.getState().cart.lines.length, 1);
});
