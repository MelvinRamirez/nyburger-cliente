/**
 * @typedef {{ kind: 'success', data: any, meta: any }
 *   | { kind: 'definitive', code: string, message: string, details: object|null }
 *   | { kind: 'ambiguous', reason: 'network'|'timeout'|'invalid_response' }} ApiResult
 */

/**
 * Clasificador puro del cuerpo de respuesta ya leído como texto. No conoce
 * fetch, timers ni AbortController: solo decide `success` / `definitive` /
 * `ambiguous(invalid_response)` a partir del texto y de `validateData`.
 *
 * @param {string} text
 * @param {(data: any) => boolean} validateData
 * @returns {ApiResult}
 */
export function classifyResponseText(text, validateData) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { kind: 'ambiguous', reason: 'invalid_response' };
  }

  if (!body || typeof body !== 'object' || typeof body.ok !== 'boolean') {
    return { kind: 'ambiguous', reason: 'invalid_response' };
  }

  if (body.ok === false) {
    const error = body.error && typeof body.error === 'object' ? body.error : {};
    return {
      kind: 'definitive',
      code: typeof error.code === 'string' ? error.code : 'UNKNOWN_ERROR',
      message: typeof error.message === 'string' ? error.message : '',
      details: error.details ?? null,
    };
  }

  // body.ok === true
  if (!validateData(body.data)) {
    return { kind: 'ambiguous', reason: 'invalid_response' };
  }

  return { kind: 'success', data: body.data, meta: body.meta ?? null };
}

function validateMenuData(data) {
  return Array.isArray(data);
}

function validateOrderData(data) {
  return (
    !!data &&
    typeof data === 'object' &&
    typeof data.order_id === 'string' &&
    Array.isArray(data.items)
  );
}

/**
 * @param {{
 *   baseUrl: string,
 *   fetchImpl?: typeof fetch,
 *   orderTimeoutMs: number,
 *   menuTimeoutMs: number,
 *   setTimer?: typeof setTimeout,
 *   clearTimer?: typeof clearTimeout,
 * }} options
 */
export function createApiClient({
  baseUrl,
  fetchImpl = globalThis.fetch.bind(globalThis),
  orderTimeoutMs,
  menuTimeoutMs,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  /**
   * @param {string} url
   * @param {RequestInit} requestOptions
   * @param {number} timeoutMs
   * @param {(data: any) => boolean} validateData
   * @returns {Promise<ApiResult>}
   */
  async function request(url, requestOptions, timeoutMs, validateData) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimer(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);

    try {
      const res = await fetchImpl(url, { ...requestOptions, signal: ctrl.signal });
      // El timer sigue activo durante la lectura del body.
      const text = await res.text();
      return classifyResponseText(text, validateData);
    } catch {
      return { kind: 'ambiguous', reason: timedOut ? 'timeout' : 'network' };
    } finally {
      clearTimer(timer);
    }
  }

  async function getMenu() {
    return request(
      `${baseUrl}?action=getMenu`,
      { method: 'GET', redirect: 'follow', credentials: 'omit', cache: 'no-store' },
      menuTimeoutMs,
      validateMenuData,
    );
  }

  async function createOrder(payload) {
    return request(
      baseUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'createOrder', ...payload }),
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store',
      },
      orderTimeoutMs,
      validateOrderData,
    );
  }

  return { getMenu, createOrder };
}
