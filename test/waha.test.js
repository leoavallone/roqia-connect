const test = require('node:test');
const assert = require('node:assert/strict');
const { WahaService, normalizeStatus, qrFromJson } = require('../src/services/waha');

test('normaliza estados do WAHA', () => {
  assert.deepEqual(normalizeStatus({ status: 'WORKING' }), { state: 'connected' });
  assert.deepEqual(normalizeStatus({ status: 'SCAN_QR_CODE' }), { state: 'connecting' });
  assert.deepEqual(normalizeStatus({ status: 'STARTING' }), { state: 'connecting' });
  assert.deepEqual(normalizeStatus({ status: 'STOPPED' }), { state: 'disconnected' });
  assert.deepEqual(normalizeStatus({ status: 'FAILED' }), { state: 'error' });
});

test('aceita QR base64 retornado pelo WAHA', () => {
  const qr = qrFromJson({ mimetype: 'image/png', data: 'aGVsbG8=' });
  assert.equal(qr.contentType, 'image/png');
  assert.equal(qr.buffer.toString(), 'hello');
});

test('usa X-Api-Key e faz proxy do QR em PNG', async () => {
  const calls = [];
  const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
  const service = new WahaService({
    baseUrl: 'http://waha:3000',
    apiKey: 'top-secret',
    fetch: async (url, options) => {
      calls.push({ url, options });
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    },
  });

  const result = await service.getQrCode('cliente1');
  assert.deepEqual(result.buffer, png);
  assert.match(calls[0].url, /api\/cliente1\/auth\/qr\?format=image$/);
  assert.equal(calls[0].options.headers['X-Api-Key'], 'top-secret');
});

test('rejeita session arbitrária antes de formar URL', async () => {
  const service = new WahaService({
    baseUrl: 'http://waha:3000',
    apiKey: 'secret',
    fetch: async () => {
      throw new Error('não deveria chamar a rede');
    },
  });
  await assert.rejects(() => service.getConnectionStatus('../admin'), { code: 'INVALID_SESSION' });
});

test('cria e inicia uma sessão ausente com store NOWEB', async () => {
  const calls = [];
  const service = new WahaService({
    baseUrl: 'http://waha:3000',
    apiKey: 'secret',
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'GET') return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ name: 'cliente1', status: 'STARTING' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await service.startSession('cliente1');
  assert.deepEqual(result, { state: 'connecting', qrReady: false });
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.name, 'cliente1');
  assert.equal(body.config.noweb.store.enabled, true);
});
