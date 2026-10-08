const test = require('node:test');
const assert = require('node:assert/strict');
const { WppConnectService, normalizeStatus, qrFromJson } = require('../src/services/wppconnect');
const { createClientStore } = require('../src/config/clients');

test('carrega clientes por CLIENTS_JSON sem depender de arquivo montado', () => {
  const store = createClientStore('/arquivo/inexistente.json', JSON.stringify({
    cliente1: { name: 'Cliente 1', session: 'cliente1', pin: '1234' },
  }));
  assert.equal(store.size, 1);
  assert.deepEqual(store.getPublic('cliente1'), { id: 'cliente1', name: 'Cliente 1' });
});

test('normaliza formatos reais de status do WPPConnect', () => {
  assert.deepEqual(normalizeStatus({ status: true, message: 'Connected' }), { state: 'connected' });
  assert.deepEqual(normalizeStatus({ status: 'CONNECTED' }), { state: 'connected' });
  assert.deepEqual(normalizeStatus({ status: 'INITIALIZING' }), { state: 'connecting' });
  assert.deepEqual(normalizeStatus({ status: 'notLogged' }), { state: 'connecting' });
  assert.deepEqual(normalizeStatus({ status: 'CLOSED' }), { state: 'disconnected' });
  assert.deepEqual(normalizeStatus({ status: false, message: 'Disconnected' }), {
    state: 'disconnected',
  });
});

test('aceita QR em data URI para compatibilidade com respostas JSON', () => {
  const qr = qrFromJson({ qrcode: 'data:image/png;base64,aGVsbG8=' });
  assert.equal(qr.contentType, 'image/png');
  assert.equal(qr.buffer.toString(), 'hello');
});

test('gera token no backend, usa Bearer e faz proxy do PNG', async () => {
  const calls = [];
  const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/generate-token')) {
      return new Response(JSON.stringify({ status: 'success', token: 'server-only-token' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/qrcode-session')) {
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    throw new Error('unexpected request');
  };
  const service = new WppConnectService({
    baseUrl: 'http://wppconnect:21465',
    secretKey: 'top-secret',
    fetch: fakeFetch,
  });

  const result = await service.getQrCode('cliente1');
  assert.deepEqual(result.buffer, png);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /cliente1\/top-secret\/generate-token$/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer server-only-token');
});

test('rejeita session arbitrária antes de formar URL', async () => {
  const service = new WppConnectService({
    baseUrl: 'http://wppconnect:21465',
    secretKey: 'secret',
    fetch: async () => {
      throw new Error('não deveria chamar a rede');
    },
  });
  await assert.rejects(() => service.generateToken('../admin'), { code: 'INVALID_SESSION' });
});

test('reinicia sessão travada em connecting quando não existe QR', async () => {
  const service = new WppConnectService({
    baseUrl: 'http://wppconnect:21465',
    secretKey: 'secret',
    qrPollAttempts: 1,
  });
  let starts = 0;
  let qrReads = 0;
  service.getConnectionStatus = async () => ({ state: 'connecting' });
  service.startSession = async () => {
    starts += 1;
    return { state: 'connecting', qrReady: false };
  };
  service.getQrCode = async () => {
    qrReads += 1;
    return qrReads === 1 ? null : { buffer: Buffer.from('qr'), contentType: 'image/png' };
  };

  const result = await service.prepareQrCode('cliente1');
  assert.equal(starts, 1);
  assert.deepEqual(result, { state: 'connecting', qrReady: true });
});
