import { select } from '../store.js';
import { messages } from '../messages.js';
import { formatMoney } from '../format.js';
import { el } from './dom.js';
import { categoryId } from './category-nav.js';

function groupByCategory(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.category || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function findMenuItem(items, itemId) {
  return items.find((item) => item.item_id === itemId) || null;
}

function findCartLine(cartLines, itemId) {
  return cartLines.find((line) => line.item_id === itemId) || null;
}

function imageBox(item) {
  const useRemote = typeof item.image_url === 'string' && item.image_url.startsWith('https:');
  const img = el('img', {
    class: 'w-full h-full object-cover',
    loading: 'lazy',
    decoding: 'async',
    alt: messages.image.alt,
    width: 96,
    height: 96,
    src: useRemote ? item.image_url : './img/placeholder-dish.svg',
  });
  let swapped = false;
  img.addEventListener('error', () => {
    if (swapped) return;
    swapped = true;
    img.src = './img/placeholder-dish.svg';
  });
  return el(
    'div',
    { class: 'menu-item__image-box w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-slate-100 shrink-0 relative' },
    [img],
  );
}

/**
 * Botón/selector de acción de la tarjeta de producto: "+ Agregar" cuando
 * el item aún no tiene unidades en el carrito, o un stepper compacto
 * `[- n +]` cuando `quantity > 0`. Dispara los mismos handlers
 * `increment`/`decrement` que ya usa `cart-sheet.js` (sin duplicar lógica
 * de dispatch en `actions.js`), vía los `data-action`
 * `increment-item`/`decrement-item` nuevos que `mountMenuView` resuelve
 * más abajo contra `handlers.increment`/`handlers.decrement`.
 */
function quantityControl(item, quantity) {
  if (quantity <= 0) {
    return el(
      'button',
      {
        type: 'button',
        class:
          'menu-item__add min-h-11 min-w-11 bg-white/95 text-orange-600 border border-orange-200 font-bold text-xs px-3 py-1 rounded-full shadow-md hover:bg-orange-50 active:scale-95 flex items-center gap-1',
        'data-action': 'add-item',
        'data-item-id': item.item_id,
      },
      [messages.menu.add],
    );
  }
  return el(
    'div',
    {
      class:
        'bg-orange-600 text-white font-bold text-xs rounded-full px-2 py-0.5 flex items-center gap-2 shadow-md',
    },
    [
      el(
        'button',
        {
          type: 'button',
          class: 'min-h-11 min-w-11 flex items-center justify-center active:scale-95 transition-transform duration-100',
          'aria-label': messages.menu.decrement,
          'data-action': 'decrement-item',
          'data-item-id': item.item_id,
        },
        ['-'],
      ),
      el('span', {}, [String(quantity)]),
      el(
        'button',
        {
          type: 'button',
          class: 'min-h-11 min-w-11 flex items-center justify-center active:scale-95 transition-transform duration-100',
          'aria-label': messages.menu.increment,
          'data-action': 'increment-item',
          'data-item-id': item.item_id,
        },
        ['+'],
      ),
    ],
  );
}

function renderItem(item, cartLines) {
  const line = findCartLine(cartLines, item.item_id);
  const quantity = line ? line.quantity : 0;
  return el(
    'li',
    {
      class:
        'menu-item bg-white rounded-2xl p-3 border border-slate-100 shadow-sm flex items-center gap-3.5 active:scale-[0.99] transition-transform',
    },
    [
      el('div', { class: 'menu-item__body flex-1 min-w-0' }, [
        el('p', { class: 'menu-item__name text-sm font-bold text-slate-900 line-clamp-1' }, [item.name]),
        el('p', { class: 'menu-item__description text-xs text-slate-500 line-clamp-2 mt-0.5 leading-relaxed' }, [
          item.description || '',
        ]),
        el('p', { class: 'menu-item__price text-sm font-extrabold text-slate-900 font-mono mt-2' }, [
          formatMoney(item.price),
        ]),
      ]),
      el('div', { class: 'flex flex-col items-center gap-2' }, [imageBox(item), quantityControl(item, quantity)]),
    ],
  );
}

function renderLoading() {
  return el('p', { class: 'menu-status menu-status--loading' }, [messages.menu.loading]);
}

function renderEmpty() {
  return el('p', { class: 'menu-status menu-status--empty' }, [messages.menu.empty]);
}

function renderError(menuState) {
  const text = menuState.error && menuState.error.offline ? messages.menu.offline : messages.menu.error;
  return el('div', { class: 'menu-status menu-status--error' }, [
    el('p', {}, [text]),
    el(
      'button',
      {
        type: 'button',
        class: 'menu-status__retry min-h-11 min-w-11 active:scale-95 transition-transform duration-100',
        'data-action': 'retry-menu',
      },
      [messages.menu.retry],
    ),
  ]);
}

function renderReady(menuState, cartLines) {
  const fragment = document.createDocumentFragment();
  for (const [category, items] of groupByCategory(menuState.items)) {
    fragment.appendChild(
      el('section', { id: categoryId(category), class: 'menu-category scroll-mt-28' }, [
        el('h2', { class: 'menu-category__title text-lg font-bold text-slate-900 tracking-tight' }, [
          messages.menu.categoryTitle(category, items.length),
        ]),
        el('ul', { class: 'menu-list flex flex-col gap-3 mt-2' }, items.map((item) => renderItem(item, cartLines))),
      ]),
    );
  }
  return fragment;
}

function render(menuState, cartLines) {
  const fragment = document.createDocumentFragment();
  if (menuState.status === 'loading') {
    fragment.appendChild(renderLoading());
  } else if (menuState.status === 'error') {
    fragment.appendChild(renderError(menuState));
  } else if (menuState.status === 'empty') {
    fragment.appendChild(renderEmpty());
  } else {
    fragment.appendChild(renderReady(menuState, cartLines));
  }
  return fragment;
}

/**
 * Monta la vista del menú: estados loading/empty/error/ready, agrupado por
 * categoría, con "Reintentar", agregar-al-carrito y el selector de
 * cantidad inline por item (`diner-menu`).
 *
 * No usa el helper `mount()` genérico de `dom.js`: esta vista necesita
 * re-renderizar tanto cuando cambia `state.menu` como cuando cambia
 * `state.cart.lines` (para reflejar la cantidad vigente en cada tarjeta),
 * dos porciones de estado independientes que `mount()` (pensado para una
 * sola porción) no contempla sin duplicar lógica de combinación en cada
 * llamada a render.
 *
 * @param {HTMLElement} root
 * @param {import('../store.js').createStore<any>} store
 * @param {{
 *   loadMenu: () => void,
 *   addItem: (menuItem: any) => void,
 *   increment: (itemId: string) => void,
 *   decrement: (itemId: string) => void,
 * }} handlers
 * @returns {() => void} unmount
 */
export function mountMenuView(root, store, handlers) {
  function renderNow() {
    const state = store.getState();
    root.replaceChildren(render(state.menu, state.cart.lines));
  }

  function dispatchFromEvent(event) {
    const target = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!target || !root.contains(target)) return;
    const action = target.dataset.action;
    if (action === 'retry-menu') {
      handlers.loadMenu();
    } else if (action === 'add-item') {
      const item = findMenuItem(store.getState().menu.items, target.dataset.itemId);
      if (item) handlers.addItem(item);
    } else if (action === 'increment-item') {
      handlers.increment(target.dataset.itemId);
    } else if (action === 'decrement-item') {
      handlers.decrement(target.dataset.itemId);
    }
  }

  renderNow();
  root.addEventListener('click', dispatchFromEvent);
  const unsubMenu = select(store, (state) => state.menu, renderNow);
  const unsubCart = select(store, (state) => state.cart.lines, renderNow);

  return function unmount() {
    unsubMenu();
    unsubCart();
    root.removeEventListener('click', dispatchFromEvent);
  };
}
