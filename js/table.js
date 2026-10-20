import { TABLE_MAX } from './config.js';

/**
 * Normaliza un valor crudo de mesa: recorta espacios; `null` si queda vacío
 * o excede TABLE_MAX caracteres. El valor se envía al servidor tal cual
 * (sin reformatear), per A3.
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
export function normalizeTable(raw) {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > TABLE_MAX) return null;
  return trimmed;
}

/**
 * @param {string} search - `location.search` o equivalente
 * @returns {string|null}
 */
export function parseTableParam(search) {
  const params = new URLSearchParams(search);
  return normalizeTable(params.get('table'));
}

/**
 * Resuelve la mesa con precedencia URL > sesión > null.
 * @param {{ search: string, sessionValue: string|null }} args
 * @returns {{ value: string|null, source: 'url'|'session'|null }}
 */
export function resolveTable({ search, sessionValue }) {
  const fromUrl = parseTableParam(search);
  if (fromUrl !== null) {
    return { value: fromUrl, source: 'url' };
  }
  const fromSession = normalizeTable(sessionValue);
  if (fromSession !== null) {
    return { value: fromSession, source: 'session' };
  }
  return { value: null, source: null };
}
