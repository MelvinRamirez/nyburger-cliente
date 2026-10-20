import { NOTES_MAX, QTY_MAX } from './config.js';

const DEFAULTS = { cart: { lines: [], notes: '' }, lastReceipt: null, ambiguousPending: null, table: null };

function sanitizeCartLine(line) {
  if (!line || typeof line !== 'object') return null;
  if (typeof line.item_id !== 'string' || line.item_id.length === 0) return null;
  const quantity = Number(line.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > QTY_MAX) return null;
  return {
    item_id: line.item_id,
    name: typeof line.name === 'string' ? line.name : '',
    unit_price: typeof line.unit_price === 'number' ? line.unit_price : 0,
    quantity,
  };
}

function sanitizeCart(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.lines)) {
    return DEFAULTS.cart;
  }
  const lines = raw.lines.map(sanitizeCartLine).filter((l) => l !== null);
  const notes =
    typeof raw.notes === 'string' ? Array.from(raw.notes).slice(0, NOTES_MAX).join('') : '';
  return { lines, notes };
}

/**
 * Hidrata el estado persistido. Tolera `storage` nulo, JSON corrupto,
 * versión desconocida o shape inválido devolviendo los valores por defecto.
 *
 * @param {{ getItem: (key: string) => string|null } | null} storage
 * @param {string} key
 * @returns {{ cart: import('./cart.js').Cart, lastReceipt: any, ambiguousPending: any, table: string|null }}
 */
export function loadPersisted(storage, key) {
  if (!storage) return { ...DEFAULTS };
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    return { ...DEFAULTS };
  }
  if (!raw) return { ...DEFAULTS };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULTS };
  }

  if (!parsed || typeof parsed !== 'object' || parsed.v !== 1) {
    return { ...DEFAULTS };
  }

  return {
    cart: sanitizeCart(parsed.cart),
    lastReceipt: parsed.lastReceipt ?? null,
    ambiguousPending: parsed.ambiguousPending ?? null,
    table: typeof parsed.table === 'string' ? parsed.table : null,
  };
}

/**
 * Suscribe al store y escribe `{ v:1, cart, lastReceipt, ambiguousPending,
 * table }` en `storage[key]` únicamente cuando cambia la referencia de
 * alguna de esas cuatro porciones. Envuelve `setItem` en try/catch.
 *
 * El valor de mesa se persiste junto al resto para que `loadPersisted`
 * pueda compararlo contra la mesa resuelta en la próxima carga: sin esto,
 * un mismo navegador usado para pedir en la mesa 05 y después en la mesa
 * 12 (mismo dispositivo, otro QR) seguía mostrando el carrito/recibo de la
 * mesa 05 al abrir la 12, porque `localStorage` es por origen, no por mesa.
 *
 * @param {import('./store.js').createStore<any>} store
 * @param {{ setItem: (key: string, value: string) => void } | null} storage
 * @param {string} key
 * @returns {() => void} unsubscribe
 */
export function attachPersistence(store, storage, key) {
  if (!storage) {
    return () => {};
  }

  let prevCart = store.getState().cart;
  let prevReceipt = store.getState().lastReceipt;
  let prevAmbiguous = store.getState().ambiguousPending;
  let prevTable = store.getState().table.value;

  return store.subscribe((state) => {
    const cartChanged = state.cart !== prevCart;
    const receiptChanged = state.lastReceipt !== prevReceipt;
    const ambiguousChanged = state.ambiguousPending !== prevAmbiguous;
    const tableChanged = state.table.value !== prevTable;

    prevCart = state.cart;
    prevReceipt = state.lastReceipt;
    prevAmbiguous = state.ambiguousPending;
    prevTable = state.table.value;

    if (!cartChanged && !receiptChanged && !ambiguousChanged && !tableChanged) {
      return;
    }

    const payload = JSON.stringify({
      v: 1,
      cart: state.cart,
      lastReceipt: state.lastReceipt,
      ambiguousPending: state.ambiguousPending,
      table: state.table.value,
    });
    try {
      storage.setItem(key, payload);
    } catch {
      // Cuota excedida o modo privado: la app sigue funcionando sin persistir.
    }
  });
}
