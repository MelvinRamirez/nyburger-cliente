import { CURRENCY_SYMBOL } from './config.js';

const moneyFormatter = new Intl.NumberFormat('es', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** @param {number} amount @returns {string} */
export function formatMoney(amount) {
  return CURRENCY_SYMBOL + moneyFormatter.format(amount);
}

/** @param {string} value @returns {string} */
export function formatTableLabel(value) {
  return 'Mesa ' + value;
}
