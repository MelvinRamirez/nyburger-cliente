import { select } from '../store.js';
import { el } from './dom.js';

/**
 * Deriva la lista ordenada y única de categorías presentes en el menú,
 * en el mismo orden de aparición que usa `menu-view.js` al agrupar
 * (`groupByCategory`), sin duplicar esa función: solo necesitamos los
 * nombres de categoría aquí, no los items agrupados.
 *
 * @param {Array<{category?: string}>} items
 * @returns {string[]}
 */
function categoriesOf(items) {
  const seen = new Set();
  const ordered = [];
  for (const item of items) {
    const key = item.category || '';
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  return ordered;
}

/**
 * Convierte un nombre de categoría en el mismo `id` de sección usado por
 * `menu-view.js` (`category-<slug>`), para poder anclar el scroll del chip.
 *
 * @param {string} category
 * @returns {string}
 */
export function categoryId(category) {
  const slug = (category || 'otros')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `category-${slug || 'otros'}`;
}

/**
 * Dado un listado de entradas de `IntersectionObserver` (o un objeto
 * equivalente con `target.id` + `intersectionRatio`) y la categoría
 * activa actual, decide cuál debería ser la nueva categoría activa:
 * la de mayor `intersectionRatio` entre las que están intersectando.
 * Si ninguna entrada intersecta, conserva la activa actual (no hay
 * suficiente información para decidir un cambio).
 *
 * Extraída como función pura para poder testearla sin DOM real
 * (no hay jsdom en este repo).
 *
 * @param {Array<{isIntersecting: boolean, intersectionRatio: number, target: {id: string}}>} entries
 * @param {string|null} currentActiveId
 * @returns {string|null}
 */
export function pickActiveCategory(entries, currentActiveId) {
  let best = null;
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    if (!best || entry.intersectionRatio > best.intersectionRatio) {
      best = entry;
    }
  }
  if (!best) return currentActiveId;
  return best.target.id;
}

// Altura del header + nav sticky (56px + ~56px) y del padding inferior fijo
// de `<main>` (`pb-28` = 112px): ambos se restan al calcular cuánto espacio
// extra necesita la última categoría para poder llegar a la banda superior
// que observa el `IntersectionObserver` (ver `updateScrollSpacer`).
const STICKY_OFFSET_PX = 112;
const EXISTING_BOTTOM_PADDING_PX = 112;

/**
 * Sin este espaciador, una última categoría con poco contenido (p. ej. 2
 * items) puede no tener suficiente alto de documento debajo para que el
 * navegador la desplace hasta la banda superior que vigila el observer —
 * el scroll se topa con el final del documento antes de llegar ahí, y el
 * chip activo queda "pegado" en la categoría anterior aunque el usuario
 * haya tocado/scrolleado hasta la última. Este cálculo garantiza que
 * siempre exista suficiente alto de scroll, cualquiera sea el tamaño de
 * la última sección.
 *
 * @param {string[]} categories
 */
function updateScrollSpacer(categories) {
  const spacer = document.getElementById('menu-scroll-spacer');
  if (!spacer) return;
  if (categories.length === 0) {
    spacer.style.height = '0px';
    return;
  }
  const lastSection = document.getElementById(categoryId(categories[categories.length - 1]));
  const lastSectionHeight = lastSection ? lastSection.offsetHeight : 0;
  const viewportHeight = window.innerHeight || 0;
  const needed = Math.max(
    0,
    viewportHeight - lastSectionHeight - STICKY_OFFSET_PX - EXISTING_BOTTOM_PADDING_PX,
  );
  spacer.style.height = `${needed}px`;
}

function renderChip(category, id, isActive) {
  const label = category || 'Otros';
  return el(
    'button',
    {
      type: 'button',
      class: isActive
        ? 'bg-slate-900 text-white font-semibold text-xs px-4 py-2 rounded-full whitespace-nowrap shadow-sm shrink-0 active:scale-95 transition-transform duration-100'
        : 'bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium text-xs px-3.5 py-2 rounded-full whitespace-nowrap shrink-0 active:scale-95 transition duration-100',
      'data-action': 'scroll-to-category',
      'data-category-id': id,
      'aria-current': isActive ? 'true' : 'false',
    },
    [label],
  );
}

/**
 * Monta la nav de categorías: chips horizontales sticky debajo del header,
 * uno por categoría presente en `state.menu.items`. El chip activo se
 * resalta vía `IntersectionObserver` sobre las secciones `<section
 * class="menu-category">` ya ancladas por `menu-view.js` (`id` +
 * `scroll-mt-28`).
 *
 * Desviación del patrón `mount()` genérico de `dom.js`: esta vista necesita
 * mantener un `IntersectionObserver` vivo que se re-conecta a las secciones
 * del DOM cada vez que el menú cambia (items cargados), algo que el `mount()`
 * genérico (pensado para vistas sin estado de observación externo al store)
 * no contempla. El estado del observer (categoría activa) es puramente
 * local a este módulo y nunca se dispatcha al store.
 *
 * @param {HTMLElement} root
 * @param {import('../store.js').createStore<any>} store
 * @returns {() => void} unmount
 */
export function mountCategoryNav(root, store) {
  let activeId = null;
  let observer = null;
  let lastCategories = null;
  let suppressObserverUntil = 0;

  function renderChips(categories) {
    const fragment = document.createDocumentFragment();
    for (const category of categories) {
      const id = categoryId(category);
      fragment.appendChild(renderChip(category, id, id === activeId));
    }
    root.replaceChildren(fragment);
  }

  function observeSections(categories) {
    if (observer) observer.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;
    observer = new IntersectionObserver(
      (entries) => {
        // Mientras dura el scroll programático disparado por un click (ver
        // `handleClick`), ignoramos al observer: el scroll suave de paso
        // por categorías intermedias dispararía cambios de intersección
        // que pisarían el chip que el usuario eligió explícitamente, antes
        // de que el scroll termine de asentarse en la sección correcta.
        if (Date.now() < suppressObserverUntil) return;
        const next = pickActiveCategory(entries, activeId);
        if (next !== activeId) {
          activeId = next;
          renderChips(categories);
        }
      },
      { rootMargin: '-112px 0px -70% 0px', threshold: [0, 0.5, 1] },
    );
    for (const category of categories) {
      const section = document.getElementById(categoryId(category));
      if (section) observer.observe(section);
    }
  }

  function renderNow() {
    const { items } = store.getState().menu;
    const categories = categoriesOf(items || []);
    const sameCategories =
      lastCategories &&
      categories.length === lastCategories.length &&
      categories.every((category, index) => category === lastCategories[index]);
    if (sameCategories) return;
    lastCategories = categories;
    if (activeId === null && categories.length > 0) activeId = categoryId(categories[0]);
    renderChips(categories);
    observeSections(categories);
    // Se recalcula tras el próximo frame: el DOM de las secciones (montado
    // por menu-view.js vía su propia suscripción a `state.menu`) recién
    // tiene su alto final una vez que el navegador hizo layout.
    requestAnimationFrame(() => updateScrollSpacer(categories));
  }

  function handleResize() {
    if (lastCategories) updateScrollSpacer(lastCategories);
  }

  function handleClick(event) {
    const target = event.target.closest ? event.target.closest('[data-action="scroll-to-category"]') : null;
    if (!target || !root.contains(target)) return;
    const id = target.dataset.categoryId;
    // Actualiza el chip activo de inmediato (optimista), sin esperar a que
    // el IntersectionObserver detecte la sección: así el click siempre
    // refleja la elección del usuario, incluso si la sección es corta o el
    // observer tarda en reaccionar.
    if (id !== activeId && lastCategories) {
      activeId = id;
      renderChips(lastCategories);
    }
    suppressObserverUntil = Date.now() + 700;
    const section = document.getElementById(id);
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  renderNow();
  root.addEventListener('click', handleClick);
  window.addEventListener('resize', handleResize);
  const unsubscribe = select(store, (state) => state.menu, renderNow);

  return function unmount() {
    unsubscribe();
    root.removeEventListener('click', handleClick);
    window.removeEventListener('resize', handleResize);
    if (observer) observer.disconnect();
  };
}
