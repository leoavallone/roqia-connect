const { loadConfig } = require('./config/env');
const { createClientStore } = require('./config/clients');
const { WppConnectService } = require('./services/wppconnect');
const { createApp } = require('./app');

function start() {
  const config = loadConfig();
  const clientStore = createClientStore(config.clientsFile, config.clientsJson);
  const wppService = new WppConnectService({
    baseUrl: config.wppconnectUrl,
    secretKey: config.wppconnectSecretKey,
    timeoutMs: config.wppconnectTimeoutMs,
    startTimeoutMs: config.wppconnectStartTimeoutMs,
    qrPollAttempts: config.qrPollAttempts,
    qrPollIntervalMs: config.qrPollIntervalMs,
    startCooldownMs: config.qrStartCooldownMs,
  });
  const app = createApp({ config, clientStore, wppService });
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`RoqIA WhatsApp Manager ouvindo em 0.0.0.0:${config.port}`);
    console.log(`${clientStore.size} cliente(s) configurado(s).`);
  });

  function shutdown(signal) {
    console.log(`${signal} recebido. Encerrando servidor.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  start();
} catch (error) {
  console.error(`Falha ao iniciar: ${error.message}`);
  process.exit(1);
}
