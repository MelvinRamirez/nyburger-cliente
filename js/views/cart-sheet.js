import { select } from '../store.js';
import { messages } from '../messages.js';
import { formatMoney, formatTableLabel } from '../format.js';
import { totalCents, itemCount } from '../cart.js';
import { NOTES_MAX } from '../config.js';
import { el } from './dom.js';

/**
 * Agrega un quick-tag al final del valor actual del textarea de notas,
 * respetando el mismo tope de 250 code points que `actions.setNotes`
 * aplica en el dispatch (config.js NOTES_MAX). Extraída como función pura
 * para poder testearla sin DOM (no hay jsdom en este repo).
 *
 * No duplica la lógica de persistencia de notas: solo calcula el texto
 * resultante; quien la llama es responsable de escribirlo en el textarea
 * y disparar el mismo evento `input` que ya dispara `setNotes`.
 *
 * @param {string} currentValue
 * @param {string} tag
 * @param {number} [max]
 * @returns {string}
 */
export function appendQuickTag(currentValue, tag, max = NOTES_MAX) {
  const current = currentValue || '';
  const needsSeparator = current.length > 0 && !current.endsWith(' ');
  const appended = current + (needsSeparator ? ' ' : '') + tag;
  const codePoints = Array.from(appended);
  if (codePoints.length <= max) return appended;
  return codePoints.slice(0, max).join('');
}

function renderNotice(cartNotice, onDismiss) {
  if (!cartNotice) return null;
  const items = [];
  for (const removed of cartNotice.removed) {
    items.push(el('li', {}, [messages.cart.itemRemoved(removed.name)]));
  }
  for (const changed of cartNotice.priceChanged) {
    items.push(
      el('li', {}, [
        messages.cart.priceChanged(changed.name, formatMoney(changed.from), formatMoney(changed.to)),
      ]),
    );
  }
  return el('div', { class: 'cart-notice', role: 'status' }, [
    el('ul', { class: 'cart-notice__list' }, items),
    el(
      'button',
      {
        type: 'button',
        class: 'cart-notice__dismiss min-h-11 min-w-11 active:scale-95 transition-transform duration-100',
        onclick: onDismiss,
      },
      [messages.cart.noticeDismiss],
    ),
  ]);
}

function renderLine(line, handlers) {
  return el('li', { class: 'cart-line flex items-center justify-between gap-3 py-2 border-b border-slate-100' }, [
    el('span', { class: 'cart-line__name text-sm font-semibold text-slate-900 flex-1 min-w-0' }, [line.name]),
    el('div', { class: 'cart-line__controls flex items-center gap-2' }, [
      el(
        'button',
        {
          type: 'button',
          class:
            'cart-line__btn min-h-11 min-w-11 rounded-full bg-slate-100 text-slate-700 active:scale-95 transition-transform duration-100',
          'aria-label': 'Quitar una unidad',
          onclick: () => handlers.decrement(line.item_id),
        },
        ['-'],
      ),
      el('span', { class: 'cart-line__qty w-6 text-center font-mono text-sm' }, [String(line.quantity)]),
      el(
        'button',
        {
          type: 'button',
          class:
            'cart-line__btn min-h-11 min-w-11 rounded-full bg-slate-100 text-slate-700 active:scale-95 transition-transform duration-100',
          'aria-label': 'Agregar una unidad',
          onclick: () => handlers.increment(line.item_id),
        },
        ['+'],
      ),
      el(
        'button',
        {
          type: 'button',
          class:
            'cart-line__remove min-h-11 min-w-11 text-xs text-slate-400 underline active:scale-95 transition-transform duration-100',
          onclick: () => handlers.removeItem(line.item_id),
        },
        ['Quitar'],
      ),
    ]),
    el('span', { class: 'cart-line__price text-sm font-bold text-slate-900 font-mono' }, [
      formatMoney((line.unit_price * line.quantity * 100) / 100),
    ]),
  ]);
}

function renderItemsRegion(cart, cartNotice, handlers) {
  const fragment = document.createDocumentFragment();
  const notice = renderNotice(cartNotice, () => handlers.dismissCartNotice());
  if (notice) fragment.appendChild(notice);
  fragment.appendChild(el('ul', { class: 'cart-list flex flex-col' }, cart.lines.map((line) => renderLine(line, handlers))));
  return fragment;
}

function renderEmptyState(onExplore) {
  return el('div', { class: 'cart-sheet__empty flex flex-col items-center text-center py-6' }, [
    el(
      'div',
      { class: 'w-16 h-16 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center mx-auto mb-3 text-2xl', 'aria-hidden': 'true' },
      ['🍽️'],
    ),
    el('p', { class: 'text-sm font-bold text-slate-900' }, [messages.cart.emptyTitle]),
    el('p', { class: 'text-xs text-slate-500 mt-1 leading-relaxed max-w-xs' }, [messages.cart.emptySubtitle]),
    el(
      'button',
      {
        type: 'button',
        class:
          'bg-slate-900 text-white text-xs font-semibold px-5 py-2.5 rounded-full mt-4 min-h-11 active:scale-95 transition-transform duration-100',
        onclick: onExplore,
      },
      [messages.cart.emptyExploreMenu],
    ),
  ]);
}

/**
 * Monta la barra flotante de carrito + el bottom sheet del pedido
 * (reemplazo de la antigua `cart-view.js` inline). No usa el helper
 * `mount()` genérico de `dom.js` por el mismo motivo que `menu-view.js`:
 * necesita reaccionar a varias porciones de estado independientes
 * (`cart`, `cartNotice`, `table`) y mantener nodos persistentes (textarea
 * de notas, contenedor del submit) vivos a través de los toggles de
 * apertura/cierre, en vez de recrearlos en cada render.
 *
 * Estado de apertura/cierre del sheet: variable local a esta función
 * (cerrada sobre las referencias del DOM que crea), nunca entra al store
 * global ni se persiste (design.md WU2, tarea 2.1). Equivalente en alcance
 * a la variable module-scoped que usa `category-nav.js` para su categoría
 * activa: vive mientras exista esta instancia montada, y la app solo monta
 * una instancia.
 *
 * @param {HTMLElement} root
 * @param {import('../store.js').createStore<any>} store
 * @param {{
 *   increment: (itemId: string) => void,
 *   decrement: (itemId: string) => void,
 *   removeItem: (itemId: string) => void,
 *   dismissCartNotice: () => void,
 *   setNotes: (text: string) => void,
 * }} handlers
 * @returns {{ unmount: () => void, submitRoot: HTMLElement }}
 */
export function mountCartSheet(root, store, handlers) {
  let isSheetOpen = false;

  // --- Barra flotante ---
  const barBadge = el('span', { class: 'bg-orange-600 text-white text-xs font-bold px-2.5 py-1 rounded-lg' }, ['0']);
  const barLabel = el('span', { class: 'text-sm font-semibold' }, ['']);
  const barTotal = el('span', { class: 'font-mono font-bold text-base text-white' }, ['']);
  const cartBar = el(
    'button',
    {
      type: 'button',
      class:
        'cart-bar fixed bottom-4 inset-x-4 z-40 bg-slate-900 text-white p-3.5 rounded-2xl shadow-xl shadow-slate-900/20 flex items-center justify-between active:scale-[0.98] transition-all min-h-11',
      onclick: () => openSheet(),
    },
    [
      el('span', { class: 'flex items-center gap-2' }, [barBadge, barLabel]),
      el('span', { class: 'flex items-center gap-2' }, [barTotal, el('span', { 'aria-hidden': 'true' }, ['→'])]),
    ],
  );
  cartBar.hidden = true;

  // --- Backdrop + sheet ---
  const backdrop = el('div', {
    class: 'cart-sheet__backdrop fixed inset-0 z-50 bg-slate-900/60 transition-opacity duration-300 opacity-0 pointer-events-none',
    onclick: () => closeSheet(),
  });

  const sheetTitle = el('h2', { class: 'text-base font-black text-slate-900 text-center flex-1' }, [messages.cart.sheetTitle]);
  const closeButton = el(
    'button',
    {
      type: 'button',
      class: 'min-h-11 min-w-11 text-slate-400 text-lg active:scale-95 transition-transform duration-100',
      'aria-label': messages.cart.sheetClose,
      onclick: () => closeSheet(),
    },
    ['✕'],
  );

  const itemsRegion = el('div', { class: 'cart-items' });

  const initialNotes = store.getState().cart.notes;
  const textarea = el('textarea', {
    class: 'cart-notes w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 resize-none h-18',
    maxlength: NOTES_MAX,
    'aria-label': messages.cart.notesLabel,
  });
  textarea.value = initialNotes;
  const counter = el('span', { class: 'cart-notes__counter text-[11px] text-slate-400 font-mono text-right block mt-1' }, [
    messages.cart.notesCounter(Array.from(initialNotes).length, NOTES_MAX),
  ]);

  function fireNotesInput() {
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function handleNotesInput() {
    counter.textContent = messages.cart.notesCounter(Array.from(textarea.value).length, NOTES_MAX);
    handlers.setNotes(textarea.value);
  }

  function makeQuickTagButton(tag) {
    return el(
      'button',
      {
        type: 'button',
        class:
          'bg-white border border-slate-200 text-slate-600 text-[11px] font-medium px-2.5 py-1.5 rounded-full min-h-11 active:scale-95 transition-transform duration-100',
        onclick: () => {
          textarea.value = appendQuickTag(textarea.value, tag, NOTES_MAX);
          fireNotesInput();
        },
      },
      [tag],
    );
  }

  const quickTagsRow = el('div', { class: 'flex gap-1.5 flex-wrap mb-2' }, [
    makeQuickTagButton(messages.cart.quickTagNoOnion),
    makeQuickTagButton(messages.cart.quickTagSauceAside),
    makeQuickTagButton(messages.cart.quickTagMediumDoneness),
  ]);

  const notesField = el('div', { class: 'cart-notes-field bg-slate-50 border border-slate-200 rounded-2xl p-3.5 my-3' }, [
    el('label', { class: 'cart-notes__label text-xs font-semibold text-slate-700 block mb-2' }, [
      messages.cart.notesSectionTitle,
    ]),
    quickTagsRow,
    textarea,
    counter,
  ]);

  const totalLine = el('p', { class: 'cart-total text-lg font-black text-slate-900 flex justify-between' }, [
    el('span', {}, [messages.cart.total]),
    el('span', { class: 'font-mono' }, ['']),
  ]);

  const submitRoot = el('div', { class: 'cart-sheet__submit' });

  const normalContent = el('div', { class: 'cart-sheet__normal flex flex-col min-h-0 overflow-y-auto' }, [
    itemsRegion,
    notesField,
    totalLine,
    submitRoot,
  ]);

  const emptyState = renderEmptyState(() => {
    closeSheet();
    const navRoot = document.getElementById('category-nav-root');
    if (navRoot) navRoot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  emptyState.hidden = true;

  const sheet = el(
    'div',
    {
      class:
        'cart-sheet fixed inset-x-0 bottom-0 max-h-[90vh] bg-white rounded-t-3xl shadow-2xl p-5 flex flex-col z-50 transform transition-transform duration-300 ease-out translate-y-full',
      role: 'dialog',
      'aria-modal': 'true',
    },
    [
      el('div', { class: 'w-10 h-1 bg-slate-300 rounded-full mx-auto mb-3' }),
      el('div', { class: 'flex items-center mb-2' }, [el('span', { class: 'min-h-11 min-w-11' }), sheetTitle, closeButton]),
      normalContent,
      emptyState,
    ],
  );

  root.appendChild(cartBar);
  root.appendChild(backdrop);
  root.appendChild(sheet);

  function openSheet() {
    if (isSheetOpen) return;
    isSheetOpen = true;
    syncSheetVisibility();
  }

  function closeSheet() {
    if (!isSheetOpen) return;
    isSheetOpen = false;
    syncSheetVisibility();
  }

  function syncSheetVisibility() {
    if (isSheetOpen) {
      sheet.classList.remove('translate-y-full');
      sheet.classList.add('translate-y-0');
      backdrop.classList.remove('opacity-0', 'pointer-events-none');
      backdrop.classList.add('opacity-100');
    } else {
      sheet.classList.remove('translate-y-0');
      sheet.classList.add('translate-y-full');
      backdrop.classList.remove('opacity-100');
      backdrop.classList.add('opacity-0', 'pointer-events-none');
    }
    cartBar.hidden = isSheetOpen || store.getState().cart.lines.length === 0;
  }

  function renderNow() {
    const { cart, cartNotice, table } = store.getState();
    const count = itemCount(cart);

    barBadge.textContent = String(count);
    barLabel.textContent = messages.cart.viewOrder(count);
    barTotal.textContent = formatMoney(totalCents(cart) / 100);

    sheetTitle.textContent = table.value === null ? messages.cart.sheetTitle : `${messages.cart.sheetTitle} • ${formatTableLabel(table.value)}`;

    if (cart.lines.length === 0) {
      normalContent.hidden = true;
      emptyState.hidden = false;
    } else {
      normalContent.hidden = false;
      emptyState.hidden = true;
      itemsRegion.replaceChildren(renderItemsRegion(cart, cartNotice, handlers));
      totalLine.lastElementChild.textContent = formatMoney(totalCents(cart) / 100);
    }

    syncSheetVisibility();
  }

  renderNow();
  textarea.addEventListener('input', handleNotesInput);

  const unsubCart = select(store, (state) => state.cart, renderNow);
  const unsubNotice = select(store, (state) => state.cartNotice, renderNow);
  const unsubTable = select(store, (state) => state.table, renderNow);
  // Al confirmarse un pedido, el carrito se vacía y `lastReceipt` pasa a
  // tener valor: si el sheet seguía abierto (el usuario lo abrió para
  // enviar el pedido), hay que cerrarlo para que el ticket de confirmación
  // (`receipt-view.js`, montado aparte en `#receipt-root`) quede visible
  // en vez de taparlo con el estado vacío del carrito.
  const unsubReceipt = select(store, (state) => state.lastReceipt, closeSheet);

  function unmount() {
    unsubCart();
    unsubNotice();
    unsubTable();
    unsubReceipt();
    textarea.removeEventListener('input', handleNotesInput);
    root.removeChild(cartBar);
    root.removeChild(backdrop);
    root.removeChild(sheet);
  }

  return { unmount, submitRoot };
}
