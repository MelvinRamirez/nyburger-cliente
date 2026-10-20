import { SLOW_NOTICE_MS, TABLE_SESSION_KEY } from './config.js';
import { actions, canSubmit } from './actions.js';
import { toOrderPayload, removeItem as removeCartItem } from './cart.js';
import { normalizeTable } from './table.js';

/**
 * Contexto compartido por todos los efectos. `sessionStorage` es una
 * extensión opcional (no forma parte del shape base `{ store, api, now,
 * isOnline, setTimer, clearTimer }`) que `main.js` inyecta únicamente para
 * que `setTableManually` pueda recordar la mesa para la sesión.
 *
 * @typedef {{
 *   store: import('./store.js').createStore<any>,
 *   api: import('./api.js').createApiClient,
 *   now: () => string,
 *   isOnline: () => boolean,
 *   setTimer: typeof setTimeout,
 *   clearTimer: typeof clearTimeout,
 *   sessionStorage?: { setItem: (key: string, value: string) => void } | null,
 * }} EffectsContext
 */

function dispatch(store, actionName, payload) {
  store.setState((state) => actions[actionName](state, payload));
}

/**
 * Carga el menú: `menuLoading` → `api.getMenu()` → `menuLoaded`/`menuFailed`.
 * Si el dispositivo está offline, no emite ninguna request (per
 * `diner-pwa-shell` "Ordering is blocked while offline"): directamente marca
 * el estado de error como offline.
 *
 * @param {EffectsContext} ctx
 */
export async function loadMenu(ctx) {
  const { store, api, isOnline } = ctx;
  dispatch(store, 'menuLoading');

  if (typeof isOnline === 'function' && isOnline() === false) {
    dispatch(store, 'menuFailed', { offline: true });
    return;
  }

  const result = await api.getMenu();
  if (result.kind === 'success') {
    dispatch(store, 'menuLoaded', result.data);
    return;
  }
  dispatch(store, 'menuFailed', { offline: false });
}

function fallbackRemoveItems(store, itemIds) {
  if (!Array.isArray(itemIds) || itemIds.length === 0) return;
  store.setState((state) => {
    let cart = state.cart;
    for (const itemId of itemIds) {
      cart = removeCartItem(cart, itemId);
    }
    if (cart === state.cart) return state;
    return { ...state, cart };
  });
}

/**
 * Envía el pedido aplicando la Error Recovery Policy completa
 * (`diner-order-submission`). Nunca reintenta `createOrder` automáticamente
 * bajo ningún resultado.
 *
 * @param {EffectsContext} ctx
 */
export async function submitOrder(ctx) {
  const { store, api, now, isOnline, setTimer, clearTimer } = ctx;
  const state = store.getState();

  if (!canSubmit(state)) {
    return; // doble toque / guardas de canSubmit: no-op silencioso.
  }

  if (typeof isOnline === 'function' && isOnline() === false) {
    dispatch(store, 'orderFailed', { code: 'OFFLINE', details: null });
    return;
  }

  dispatch(store, 'submissionStarted');

  const slowTimer = setTimer(() => dispatch(store, 'submissionSlow'), SLOW_NOTICE_MS);
  const payload = toOrderPayload(state.cart, state.table.value);

  let result;
  try {
    result = await api.createOrder(payload);
  } finally {
    clearTimer(slowTimer);
  }

  if (result.kind === 'success') {
    dispatch(store, 'orderSucceeded', { data: result.data });
    return;
  }

  if (result.kind === 'ambiguous') {
    dispatch(store, 'orderAmbiguous', { at: now() });
    return;
  }

  // result.kind === 'definitive'
  const { code, details } = result;

  if (code === 'VALIDATION_ERROR' && details && Array.isArray(details.items)) {
    dispatch(store, 'orderFailed', { code, details });
    await loadMenu(ctx);
    if (store.getState().menu.status === 'error') {
      // El refetch falló: como respaldo, quitamos directamente los item_id
      // que el servidor marcó como inválidos.
      fallbackRemoveItems(store, details.items);
    }
    return;
  }

  dispatch(store, 'orderFailed', { code, details });
}

/**
 * Reconoce una falla ambigua ya confirmada con el personal: re-habilita el
 * envío sin tocar el carrito.
 * @param {EffectsContext} ctx
 */
export function acknowledgeAmbiguous(ctx) {
  dispatch(ctx.store, 'ambiguousAcknowledged');
}

/**
 * Limpia el recibo actual y vuelve a cargar el menú para iniciar un pedido
 * nuevo.
 * @param {EffectsContext} ctx
 */
export async function startNewOrder(ctx) {
  dispatch(ctx.store, 'newOrderStarted');
  await loadMenu(ctx);
}

/**
 * Resuelve manualmente la mesa (modal de ingreso manual). Devuelve `true`
 * si el valor fue aceptado y despachado, `false` si fue rechazado
 * (vacío/excede TABLE_MAX).
 *
 * @param {EffectsContext} ctx
 * @param {string} value
 * @returns {boolean}
 */
export function setTableManually(ctx, value) {
  const normalized = normalizeTable(value);
  if (normalized === null) {
    return false;
  }
  dispatch(ctx.store, 'tableResolved', { value: normalized, source: 'manual' });
  try {
    if (ctx.sessionStorage) {
      ctx.sessionStorage.setItem(TABLE_SESSION_KEY, normalized);
    }
  } catch {
    // Modo privado o cuota excedida: la mesa queda resuelta en memoria
    // igual, solo no se recuerda para la próxima sesión.
  }
  return true;
}
