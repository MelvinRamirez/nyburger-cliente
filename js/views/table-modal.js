import { select } from '../store.js';
import { messages } from '../messages.js';
import { el } from './dom.js';

/**
 * Modal bloqueante de ingreso manual de mesa. No usa el helper `mount()`
 * genérico: un `<dialog>` necesita que `showModal()`/`close()` se invoquen
 * sobre el MISMO nodo ya insertado en el documento, así que esta vista crea
 * el diálogo una sola vez y solo alterna su estado abierto/cerrado en
 * reacción a `state.table`, en vez de recrearlo en cada render
 * (`diner-menu` "Missing table parameter blocks ordering until manual entry").
 *
 * @param {HTMLElement} root
 * @param {import('../store.js').createStore<any>} store
 * @param {{ setTableManually: (value: string) => boolean }} handlers
 * @returns {() => void} unmount
 */
export function mountTableModal(root, store, handlers) {
  const errorEl = el('p', { class: 'table-modal__error' }, [messages.table.modalRequired]);
  errorEl.hidden = true;

  const input = el('input', {
    type: 'text',
    name: 'table',
    required: true,
    maxlength: 20,
    class: 'table-modal__input',
    'aria-label': messages.table.modalPrompt,
  });

  const form = el('form', { method: 'dialog', class: 'table-modal__form' }, [
    el('h2', { class: 'table-modal__title' }, [messages.table.modalTitle]),
    el('p', { class: 'table-modal__prompt' }, [messages.table.modalPrompt]),
    input,
    errorEl,
    el(
      'button',
      { type: 'submit', class: 'table-modal__submit min-h-11 min-w-11 active:scale-95 transition-transform duration-100' },
      [messages.table.modalSubmit],
    ),
  ]);

  const dialog = el('dialog', { class: 'table-modal' }, [form]);
  root.appendChild(dialog);

  function handleSubmit(event) {
    event.preventDefault();
    const ok = handlers.setTableManually(input.value);
    if (!ok) {
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;
    input.value = '';
  }

  function syncOpenState(table) {
    if (table.value === null) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }

  form.addEventListener('submit', handleSubmit);
  syncOpenState(store.getState().table);
  const unsubscribe = select(store, (state) => state.table, syncOpenState);

  return function unmount() {
    unsubscribe();
    form.removeEventListener('submit', handleSubmit);
    if (dialog.open) dialog.close();
    root.removeChild(dialog);
  };
}
