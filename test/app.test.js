const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const request = require('supertest');
const path = require('node:path');
const { createApp } = require('../src/app');

function setup() {
  const client = { id: 'cliente1', name: 'Cliente Teste', session: 'sessao1', pin: '123456' };
  const clientStore = {
    get(id) {
      return id === client.id ? client : null;
    },
    getPublic(id) {
      return id === client.id ? { id: client.id, name: client.name } : null;
    },
    size: 1,
  };
  const wppService = {
    health: async () => true,
    getConnectionStatus: async () => ({ state: 'disconnected' }),
    prepareQrCode: async () => ({ state: 'connecting', qrReady: true }),
    getQrCode: async () => ({ buffer: Buffer.from([137, 80, 78, 71]), contentType: 'image/png' }),
  };
  const config = {
    root: path.resolve(__dirname, '..'),
    adminSecret: 'test-secret-that-is-long-enough-for-tests',
    isProduction: false,
    sessionTtlMs: 30 * 60_000,
    authRateLimitWindowMs: 60_000,
    authRateLimitMax: 5,
  };
  return createApp({ config, clientStore, wppService });
}

async function listen(app) {
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}` };
}

test('health check não depende do WPPConnect', async (t) => {
  const { server, url } = await listen(setup());
  t.after(() => server.close());
  const response = await request(url).get('/health').expect(200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('protege APIs do cliente e autentica por cookie HttpOnly', async (t) => {
  const { server, url } = await listen(setup());
  t.after(() => server.close());
  const agent = request.agent(url);
  await agent.get('/api/client/status').expect(401);

  const login = await agent
    .post('/api/auth/cliente1/login')
    .send({ pin: '123456' })
    .expect(200);
  assert.equal(login.body.ok, true);
  assert.match(login.headers['set-cookie'][0], /HttpOnly/);
  assert.match(login.headers['set-cookie'][0], /SameSite=Lax/);

  const status = await agent.get('/api/client/status').expect(200);
  assert.deepEqual(status.body, { state: 'disconnected' });
  const qr = await agent.get('/api/client/qr').expect(200).expect('Content-Type', /image\/png/);
  assert.deepEqual(qr.body, Buffer.from([137, 80, 78, 71]));
});

test('mensagem de login é igual para cliente inexistente e PIN incorreto', async (t) => {
  const { server, url } = await listen(setup());
  t.after(() => server.close());
  const wrongPin = await request(url).post('/api/auth/cliente1/login').send({ pin: '0000' }).expect(401);
  const unknown = await request(url).post('/api/auth/inexistente/login').send({ pin: '0000' }).expect(401);
  assert.equal(wrongPin.body.error, unknown.body.error);
});
