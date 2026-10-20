import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, classifyResponseText } from '../js/api.js';

function noopTimer() {
  return {
    setTimer: () => 'fake-timer-id',
    clearTimer: () => {},
  };
}

function okResponse(body) {
  return new Response(JSON.stringify(body));
}

// --- classifyResponseText: una fila por caso de la tabla ---

test('classifyResponseText: ok:false with error object classifies as definitive (any code)', () => {
  const result = classifyResponseText(
    JSON.stringify({ ok: false, error: { code: 'LOCK_TIMEOUT', message: 'busy' } }),
    () => true,
  );
  assert.deepStrictEqual(result, {
    kind: 'definitive',
    code: 'LOCK_TIMEOUT',
    message: 'busy',
    details: null,
  });
});

test('classifyResponseText: ok:false with an unlisted code is still definitive', () => {
  const result = classifyResponseText(
    JSON.stringify({ ok: false, error: { code: 'SOMETHING_NEW' } }),
    () => true,
  );
  assert.equal(result.kind, 'definitive');
  assert.equal(result.code, 'SOMETHING_NEW');
});

test('classifyResponseText: ok:true with valid data classifies as success', () => {
  const result = classifyResponseText(JSON.stringify({ ok: true, data: [] }), () => true);
  assert.deepStrictEqual(result, { kind: 'success', data: [], meta: null });
});

test('classifyResponseText: ok:true with invalid data shape classifies as ambiguous/invalid_response', () => {
  const result = classifyResponseText(JSON.stringify({ ok: true, data: null }), () => false);
  assert.deepStrictEqual(result, { kind: 'ambiguous', reason: 'invalid_response' });
});

test('classifyResponseText: non-JSON body classifies as ambiguous/invalid_response', () => {
  const result = classifyResponseText('<html>not json</html>', () => true);
  assert.deepStrictEqual(result, { kind: 'ambiguous', reason: 'invalid_response' });
});

test('classifyResponseText: JSON missing boolean ok classifies as ambiguous/invalid_response', () => {
  const result = classifyResponseText(JSON.stringify({ data: [] }), () => true);
  assert.deepStrictEqual(result, { kind: 'ambiguous', reason: 'invalid_response' });
});

// --- createOrder: data validation per design (order_id string + items array) ---

test('classifyResponseText: createOrder-style data without order_id is ambiguous', () => {
  const validateOrder = (data) =>
    !!data && typeof data.order_id === 'string' && Array.isArray(data.items);
  const result = classifyResponseText(
    JSON.stringify({ ok: true, data: { items: [] } }),
    validateOrder,
  );
  assert.deepStrictEqual(result, { kind: 'ambiguous', reason: 'invalid_response' });
});

// --- createApiClient: transport options ---

test('getMenu sends GET with no headers and the exact transport options', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return okResponse({ ok: true, data: [] });
  };
  const client = createApiClient({
    baseUrl: 'https://example.test/exec',
    fetchImpl,
    orderTimeoutMs: 35000,
    menuTimeoutMs: 15000,
    ...noopTimer(),
  });

  await client.getMenu();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/exec?action=getMenu');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[0].options.redirect, 'follow');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.ok(calls[0].options.signal);
});

test('createOrder sends the exact request options and body (no total_amount)', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return okResponse({ ok: true, data: { order_id: 'ORD-1', items: [] } });
  };
  const client = createApiClient({
    baseUrl: 'https://example.test/exec',
    fetchImpl,
    orderTimeoutMs: 35000,
    menuTimeoutMs: 15000,
    ...noopTimer(),
  });

  await client.createOrder({ table_number: '05', items: [{ item_id: 'A', quantity: 1 }], customer_notes: 'x' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/exec');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepStrictEqual(calls[0].options.headers, { 'Content-Type': 'text/plain;charset=utf-8' });
  assert.equal(calls[0].options.redirect, 'follow');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.cache, 'no-store');

  const body = JSON.parse(calls[0].options.body);
  assert.deepStrictEqual(body, {
    action: 'createOrder',
    table_number: '05',
    items: [{ item_id: 'A', quantity: 1 }],
    customer_notes: 'x',
  });
  assert.equal('total_amount' in body, false);
});

test('the client never reads response.status even when it is misleading', async () => {
  const fetchImpl = async () => {
    const res = okResponse({ ok: true, data: [] });
    // status misleading a propósito: si el cliente lo leyera, fallaría la
    // intención de este test (no hay assert directo posible sobre "nunca se
    // llamó a .status", pero el resultado de abajo prueba que se clasificó
    // por el envelope, no por el status 500).
    Object.defineProperty(res, 'status', { get() { throw new Error('status read!'); } });
    return res;
  };
  const client = createApiClient({
    baseUrl: 'https://example.test/exec',
    fetchImpl,
    orderTimeoutMs: 35000,
    menuTimeoutMs: 15000,
    ...noopTimer(),
  });

  const result = await client.getMenu();
  assert.deepStrictEqual(result, { kind: 'success', data: [], meta: null });
});

// --- timeout path ---

test('a request that times out is classified as ambiguous/timeout', async () => {
  let abortListenerAttached = false;
  let timerCallback;
  const setTimer = (cb) => {
    timerCallback = cb;
    return 'timer-id';
  };
  const clearTimer = () => {};

  const fetchImpl = (url, options) =>
    new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        abortListenerAttached = true;
        reject(new Error('aborted'));
      });
      // nunca resuelve por su cuenta; solo el abort la termina
    });

  const client = createApiClient({
    baseUrl: 'https://example.test/exec',
    fetchImpl,
    orderTimeoutMs: 35000,
    menuTimeoutMs: 15000,
    setTimer,
    clearTimer,
  });

  const promise = client.getMenu();
  // Simula el disparo del timer de timeout.
  timerCallback();
  const result = await promise;

  assert.equal(abortListenerAttached, true);
  assert.deepStrictEqual(result, { kind: 'ambiguous', reason: 'timeout' });
});

test('a network rejection not caused by the timeout is classified as ambiguous/network', async () => {
  const fetchImpl = async () => {
    throw new Error('network down');
  };
  const client = createApiClient({
    baseUrl: 'https://example.test/exec',
    fetchImpl,
    orderTimeoutMs: 35000,
    menuTimeoutMs: 15000,
    ...noopTimer(),
  });

  const result = await client.getMenu();
  assert.deepStrictEqual(result, { kind: 'ambiguous', reason: 'network' });
});

// --- clearTimer is always called exactly once ---

test('clearTimer is called exactly once for success, definitive, and ambiguous outcomes', async () => {
  let clearCalls = 0;
  const setTimer = () => 'id';
  const clearTimer = () => {
    clearCalls++;
  };

  async function runOnce(fetchImpl) {
    clearCalls = 0;
    const client = createApiClient({
      baseUrl: 'https://example.test/exec',
      fetchImpl,
      orderTimeoutMs: 35000,
      menuTimeoutMs: 15000,
      setTimer,
      clearTimer,
    });
    await client.getMenu();
    assert.equal(clearCalls, 1);
  }

  await runOnce(async () => okResponse({ ok: true, data: [] })); // success
  await runOnce(async () => okResponse({ ok: false, error: { code: 'INTERNAL_ERROR' } })); // definitive
  await runOnce(async () => {
    throw new Error('boom');
  }); // ambiguous
});
