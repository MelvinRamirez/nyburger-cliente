import { messages } from '../messages.js';
import { formatMoney, formatTableLabel } from '../format.js';
import { select } from '../store.js';
import { el, mount } from './dom.js';

/**
 * Formatea `created_at` (string ISO que devuelve el backend, ej.
 * "2024-05-01T19:15:00.000Z") como hora local corta ("07:15 PM"). Si el
 * valor no es una fecha parseable, cae de vuelta al string crudo en lugar
 * de mostrar "Invalid Date" — función local puramente presentacional, no
 * duplica nada de `format.js` (que no tiene formateo de fecha/hora).
 *
 * @param {string|undefined} value
 * @returns {string}
 */
export function formatReceiptTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', hour12: true }).format(date);
  } catch {
    return value;
  }
}

function renderReceiptLine(item) {
  const label = item.name || item.item_id;
  const lineTotal = typeof item.line_total === 'number' ? item.line_total : null;
  return el(
    'li',
    { class: 'receipt__item flex items-center justify-between gap-3 py-2 text-sm' },
    [
      el('span', { class: 'receipt__item-label text-slate-700' }, [`${item.quantity}x ${label}`]),
      lineTotal === null
        ? null
        : el('span', { class: 'receipt__item-price font-mono text-slate-900' }, [formatMoney(lineTotal)]),
    ].filter(Boolean),
  );
}

/**
 * Sección de notas del ticket: solo se muestra si el recibo trae notas. Hoy
 * la respuesta de `createOrder_` (Code.gs) NO incluye `customer_notes` en
 * el objeto que llega como `lastReceipt` (solo expone order_id, created_at,
 * table_number, status, total_amount, items) — esta sección queda escrita
 * de forma defensiva/futuro-compatible, pero en el comportamiento actual
 * nunca se renderiza. Ver "Desviaciones (WU3)" en el documento de tareas.
 *
 * @param {any} receipt
 * @returns {HTMLElement|null}
 */
function renderNotesIfPresent(receipt) {
  const notes = typeof receipt.customer_notes === 'string' ? receipt.customer_notes.trim() : '';
  if (!notes) return null;
  return el('p', { class: 'receipt__notes py-2 text-xs text-slate-500' }, [
    `${messages.receipt.notesLabel}: ${notes}`,
  ]);
}

function render(slice) {
  const fragment = document.createDocumentFragment();
  const receipt = slice.lastReceipt;
  if (!receipt) return fragment;

  const tableLabel = formatTableLabel(receipt.table_number ?? slice.table.value);

  const notesNode = renderNotesIfPresent(receipt);

  const ticketRows = [
    el(
      'div',
      { class: 'receipt__ticket-header flex flex-wrap items-center justify-between gap-1 py-2 text-xs font-semibold text-slate-500' },
      [
        el('span', { class: 'receipt__order-id' }, [messages.receipt.orderId(receipt.order_id)]),
        el('span', { class: 'receipt__table' }, [tableLabel]),
        el('span', { class: 'receipt__timestamp' }, [
          `${messages.receipt.timestamp} ${formatReceiptTime(receipt.created_at)}`,
        ]),
      ],
    ),
    el('ul', { class: 'receipt__items flex flex-col' }, (receipt.items || []).map(renderReceiptLine)),
  ];
  if (notesNode) ticketRows.push(notesNode);
  ticketRows.push(
    el('p', { class: 'receipt__total flex items-center justify-between py-2 text-base font-black text-slate-900' }, [
      el('span', {}, [messages.receipt.total]),
      el('span', { class: 'font-mono' }, [
        // El total SIEMPRE viene del servidor, nunca se recalcula en el cliente.
        formatMoney(receipt.total_amount),
      ]),
    ]),
  );

  fragment.appendChild(
    el('div', { class: 'receipt flex flex-col items-center px-1 py-6 text-center' }, [
      el(
        'div',
        {
          class:
            'receipt__success-icon mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl font-black text-emerald-600',
          'aria-hidden': 'true',
        },
        // `el()`/dom.js crean nodos vía `document.createElement` (sin namespace
        // SVG), así que un `<svg>` real quedaría como HTMLUnknownElement y no
        // se vería. Se usa un glifo de texto para el check, igual patrón que
        // los demás iconos del repo (🍽️ en el estado vacío, ✕ en el cierre
        // del sheet) en vez de tocar `dom.js` para soportar namespaces SVG.
        ['✓'],
      ),
      el('h2', { class: 'receipt__title text-xl font-black text-slate-900' }, [messages.receipt.title]),
      el('p', { class: 'receipt__subtitle mt-1 text-sm text-slate-500' }, [messages.receipt.subtitle]),
      el(
        'div',
        { class: 'receipt__ticket mt-4 w-full max-w-sm divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm' },
        ticketRows,
      ),
      el(
        'button',
        {
          type: 'button',
          class:
            'receipt__new-order mt-4 w-full rounded-xl border border-slate-200 bg-slate-100 py-3 font-bold text-slate-800 active:scale-95 transition-transform duration-100 min-h-11',
          'data-action': 'new-order',
        },
        [messages.receipt.newOrder(tableLabel)],
      ),
      // Enlace de asistencia: no existe un endpoint de "llamar al personal"
      // en la API (api.js/Code.gs no expone ninguna acción de este tipo).
      // Se renderiza como texto estático inerte (sin <a>/<button>, sin
      // handler, sin alert()) en vez de fabricar una acción que no tiene
      // soporte real de backend — ver constraint explícita de la tarea 3.1
      // y "Desviaciones (WU3)".
      el('p', { class: 'receipt__assistance mt-3 text-xs text-slate-400' }, [messages.receipt.assistance]),
    ]),
  );
  return fragment;
}

/**
 * Muestra el recibo de `lastReceipt` (`order_id`/`total_amount` tal cual
 * los devuelve el servidor) y sobrevive a un reload hasta "Nuevo pedido"
 * (`diner-order-submission`).
 *
 * @param {HTMLElement} root
 * @param {import('../store.js').createStore<any>} store
 * @param {{ startNewOrder: () => void }} handlers
 * @returns {() => void} unmount
 */
export function mountReceiptView(root, store, handlers) {
  const unmount = mount(
    root,
    store,
    (state) => ({ lastReceipt: state.lastReceipt, table: state.table }),
    render,
    (action) => {
      if (action === 'new-order') handlers.startNewOrder();
    },
  );

  // El recibo se arma en `#receipt-root`, al tope de `<main>`, pero al
  // confirmar el pedido el usuario suele estar scrolleado más abajo (en el
  // menú o en el carrito que acaba de cerrarse) — sin esto, el ticket queda
  // invisible fuera de pantalla y parece que "no pasó nada" al enviar.
  const unsubScroll = select(store, (state) => state.lastReceipt, (receipt) => {
    if (!receipt) return;
    requestAnimationFrame(() => {
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  return function unmountAll() {
    unmount();
    unsubScroll();
  };
}
