import { QTY_MAX, LINES_MAX } from './config.js';

/**
 * @typedef {{ item_id: string, name: string, unit_price: number, quantity: number }} CartLine
 * @typedef {{ lines: CartLine[], notes: string }} Cart
 */

/**
 * Agrega una línea nueva (cantidad 1) o incrementa una existente, respetando
 * el tope por línea (QTY_MAX) y el tope de líneas (LINES_MAX). No agrega una
 * línea nº 51.
 *
 * @param {Cart} cart
 * @param {{ item_id: string, name: string, price: number }} menuItem
 * @returns {Cart}
 */
export function addItem(cart, menuItem) {
  const idx = cart.lines.findIndex((l) => l.item_id === menuItem.item_id);
  if (idx !== -1) {
    const line = cart.lines[idx];
    if (line.quantity >= QTY_MAX) {
      return cart;
    }
    const lines = cart.lines.slice();
    lines[idx] = { ...line, quantity: line.quantity + 1 };
    return { ...cart, lines };
  }
  if (cart.lines.length >= LINES_MAX) {
    return cart;
  }
  const newLine = {
    item_id: menuItem.item_id,
    name: menuItem.name,
    unit_price: menuItem.price,
    quantity: 1,
  };
  return { ...cart, lines: [...cart.lines, newLine] };
}

/** @param {Cart} cart @param {string} itemId @returns {Cart} */
export function increment(cart, itemId) {
  const idx = cart.lines.findIndex((l) => l.item_id === itemId);
  if (idx === -1) return cart;
  const line = cart.lines[idx];
  if (line.quantity >= QTY_MAX) return cart;
  const lines = cart.lines.slice();
  lines[idx] = { ...line, quantity: line.quantity + 1 };
  return { ...cart, lines };
}

/**
 * Decrementa una línea; al llegar a cantidad 0 la elimina por completo
 * (nunca deja una línea en cantidad 0).
 * @param {Cart} cart @param {string} itemId @returns {Cart}
 */
export function decrement(cart, itemId) {
  const idx = cart.lines.findIndex((l) => l.item_id === itemId);
  if (idx === -1) return cart;
  const line = cart.lines[idx];
  if (line.quantity <= 1) {
    return { ...cart, lines: cart.lines.filter((l) => l.item_id !== itemId) };
  }
  const lines = cart.lines.slice();
  lines[idx] = { ...line, quantity: line.quantity - 1 };
  return { ...cart, lines };
}

/** @param {Cart} cart @param {string} itemId @returns {Cart} */
export function removeItem(cart, itemId) {
  if (!cart.lines.some((l) => l.item_id === itemId)) return cart;
  return { ...cart, lines: cart.lines.filter((l) => l.item_id !== itemId) };
}

/**
 * Suma en centavos usando el mismo método de redondeo que priceOrder_ en el
 * servidor: Math.round(unit_price * 100) * quantity por línea.
 * @param {Cart} cart @returns {number}
 */
export function totalCents(cart) {
  return cart.lines.reduce(
    (sum, line) => sum + Math.round(line.unit_price * 100) * line.quantity,
    0,
  );
}

/** @param {Cart} cart @returns {number} */
export function itemCount(cart) {
  return cart.lines.reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * Reconcilia el carrito contra el menú vigente (RF-CLI-03). Devuelve la
 * misma referencia de `cart` cuando nada cambió (idempotente).
 *
 * @param {Cart} cart
 * @param {{ item_id: string, name: string, price: number }[]} menuItems
 * @returns {{ cart: Cart, removed: { item_id: string, name: string }[], priceChanged: { item_id: string, name: string, from: number, to: number }[] }}
 */
export function reconcile(cart, menuItems) {
  const byId = new Map(menuItems.map((m) => [m.item_id, m]));
  const kept = [];
  const removed = [];
  const priceChanged = [];
  let anyNameChanged = false;

  for (const line of cart.lines) {
    const m = byId.get(line.item_id);
    if (!m) {
      removed.push({ item_id: line.item_id, name: line.name });
      continue;
    }
    if (m.name !== line.name) {
      anyNameChanged = true;
    }
    const newLine = { ...line, name: m.name, unit_price: m.price };
    if (Math.round(line.unit_price * 100) !== Math.round(m.price * 100)) {
      priceChanged.push({
        item_id: line.item_id,
        name: m.name,
        from: line.unit_price,
        to: m.price,
      });
    }
    kept.push(newLine);
  }

  if (removed.length === 0 && priceChanged.length === 0 && !anyNameChanged) {
    return { cart, removed, priceChanged };
  }

  return { cart: { lines: kept, notes: cart.notes }, removed, priceChanged };
}

/**
 * Convierte el carrito al payload exacto esperado por createOrder: nunca
 * incluye un total calculado por el cliente ni campos extra.
 *
 * @param {Cart} cart
 * @param {string} tableValue
 * @returns {{ table_number: string, items: { item_id: string, quantity: number }[], customer_notes: string }}
 */
export function toOrderPayload(cart, tableValue) {
  return {
    table_number: tableValue,
    items: cart.lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
    customer_notes: cart.notes,
  };
}
