import { NOTES_MAX } from './config.js';
import * as cart from './cart.js';

/**
 * Normalización de `details.fields` del servidor (Code.gs L836-882) al
 * dominio de la vista.
 * @param {string[]|undefined} fields
 * @returns {('table'|'items'|'notes')[]}
 */
function normalizeFields(fields) {
  if (!Array.isArray(fields)) return [];
  const out = new Set();
  for (const f of fields) {
    if (f === 'table_number') out.add('table');
    else if (f === 'customer_notes') out.add('notes');
    else if (f === 'items' || /^items\[\d+\]/.test(f)) out.add('items');
  }
  return Array.from(out);
}

/**
 * @param {{ cart?: Partial<import('./cart.js').Cart>, lastReceipt?: any, ambiguousPending?: any }} hydrated
 * @param {{ value: string|null, source: 'url'|'session'|'manual'|null }} table
 */
export function initialState(hydrated = {}, table = { value: null, source: null }) {
  return {
    table,
    menu: { status: 'idle', items: [], error: null },
    cart: hydrated.cart ?? { lines: [], notes: '' },
    cartNotice: null,
    submission: { status: 'idle', error: null },
    ambiguousPending: hydrated.ambiguousPending ?? null,
    lastReceipt: hydrated.lastReceipt ?? null,
  };
}

function buildCartNotice(removed, priceChanged) {
  if (removed.length === 0 && priceChanged.length === 0) return null;
  return { removed, priceChanged };
}

export const actions = {
  tableResolved(state, { value, source }) {
    return { ...state, table: { value, source } };
  },

  menuLoading(state) {
    return { ...state, menu: { ...state.menu, status: 'loading', error: null } };
  },

  menuLoaded(state, items) {
    const status = items.length === 0 ? 'empty' : 'ready';
    const { cart: reconciledCart, removed, priceChanged } = cart.reconcile(state.cart, items);
    return {
      ...state,
      menu: { status, items, error: null },
      cart: reconciledCart,
      cartNotice: buildCartNotice(removed, priceChanged),
    };
  },

  menuFailed(state, { offline }) {
    return { ...state, menu: { ...state.menu, status: 'error', error: { offline: !!offline } } };
  },

  addItem(state, menuItem) {
    // Agregar un producto mientras todavía se muestra el ticket de un pedido
    // ya confirmado (`lastReceipt`) es, en los hechos, empezar un pedido
    // nuevo: desde el rediseño el ticket es solo una sección arriba de la
    // página (no una pantalla bloqueante), así que el usuario puede seguir
    // explorando el menú sin tocar "Pedir algo más" primero. Sin este reset,
    // `canSubmit` seguía negando el envío indefinidamente porque
    // `lastReceipt` nunca se limpiaba (mismo efecto que `newOrderStarted`,
    // disparado implícitamente por la acción de agregar en vez de requerir
    // el botón explícito).
    const startingNewOrder = state.lastReceipt !== null;
    return {
      ...state,
      cart: cart.addItem(state.cart, menuItem),
      lastReceipt: startingNewOrder ? null : state.lastReceipt,
      submission: startingNewOrder ? { status: 'idle', error: null } : state.submission,
    };
  },

  increment(state, itemId) {
    return { ...state, cart: cart.increment(state.cart, itemId) };
  },

  decrement(state, itemId) {
    return { ...state, cart: cart.decrement(state.cart, itemId) };
  },

  removeItem(state, itemId) {
    return { ...state, cart: cart.removeItem(state.cart, itemId) };
  },

  setNotes(state, text) {
    const clipped = Array.from(text).slice(0, NOTES_MAX).join('');
    return { ...state, cart: { ...state.cart, notes: clipped } };
  },

  dismissCartNotice(state) {
    if (state.cartNotice === null) return state;
    return { ...state, cartNotice: null };
  },

  submissionStarted(state) {
    return { ...state, submission: { status: 'sending', error: null } };
  },

  submissionSlow(state) {
    if (state.submission.status !== 'sending') return state;
    return { ...state, submission: { ...state.submission, status: 'slow' } };
  },

  orderSucceeded(state, { data }) {
    return {
      ...state,
      cart: { lines: [], notes: '' },
      submission: { status: 'idle', error: null },
      ambiguousPending: null,
      lastReceipt: data,
    };
  },

  orderFailed(state, { code, details }) {
    const fields = normalizeFields(details && details.fields);
    return {
      ...state,
      submission: { status: 'error', error: { code, fields } },
    };
  },

  orderAmbiguous(state, { at }) {
    return {
      ...state,
      submission: { status: 'ambiguous', error: null },
      ambiguousPending: { at },
    };
  },

  ambiguousAcknowledged(state) {
    return { ...state, submission: { status: 'idle', error: null }, ambiguousPending: null };
  },

  newOrderStarted(state) {
    return { ...state, lastReceipt: null, submission: { status: 'idle', error: null } };
  },
};

/**
 * @param {ReturnType<typeof initialState>} state
 * @returns {boolean}
 */
export function canSubmit(state) {
  if (state.cart.lines.length === 0) return false;
  if (state.table.value === null) return false;
  if (['sending', 'slow', 'ambiguous'].includes(state.submission.status)) return false;
  if (state.ambiguousPending !== null) return false;
  if (state.lastReceipt !== null) return false;
  if (Array.from(state.cart.notes).length > NOTES_MAX) return false;
  return true;
}
