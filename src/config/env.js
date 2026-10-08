const path = require('node:path');
require('dotenv').config();

function integer(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} deve ser um número inteiro entre ${min} e ${max}.`);
  }

  return value;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não foi configurada.`);
  return value;
}

function validateWppUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('WPPCONNECT_URL deve ser uma URL HTTP ou HTTPS válida.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('WPPCONNECT_URL deve usar HTTP/HTTPS e não pode conter credenciais.');
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function loadConfig() {
  const root = path.resolve(__dirname, '../..');
  const nodeEnv = process.env.NODE_ENV || 'development';
  const adminSecret = required('ADMIN_SECRET');

  if (nodeEnv === 'production' && adminSecret.length < 32) {
    throw new Error('ADMIN_SECRET deve ter pelo menos 32 caracteres em produção.');
  }

  return Object.freeze({
    root,
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: integer('PORT', 3000, { min: 1, max: 65535 }),
    wppconnectUrl: validateWppUrl(required('WPPCONNECT_URL')),
    wppconnectSecretKey: required('WPPCONNECT_SECRET_KEY'),
    adminSecret,
    clientsFile: path.resolve(root, process.env.CLIENTS_FILE || 'config/clients.json'),
    clientsJson: process.env.CLIENTS_JSON?.trim() || '',
    sessionTtlMs: integer('SESSION_TTL_MINUTES', 30, { min: 5, max: 1440 }) * 60_000,
    authRateLimitWindowMs:
      integer('AUTH_RATE_LIMIT_WINDOW_MINUTES', 15, { min: 1, max: 1440 }) * 60_000,
    authRateLimitMax: integer('AUTH_RATE_LIMIT_MAX', 5, { min: 1, max: 100 }),
    wppconnectTimeoutMs: integer('WPPCONNECT_TIMEOUT_MS', 10_000, { min: 1000, max: 60_000 }),
    wppconnectStartTimeoutMs: integer('WPPCONNECT_START_TIMEOUT_MS', 35_000, {
      min: 5000,
      max: 120_000,
    }),
    qrPollAttempts: integer('QR_POLL_ATTEMPTS', 10, { min: 1, max: 30 }),
    qrPollIntervalMs: integer('QR_POLL_INTERVAL_MS', 1500, { min: 750, max: 10_000 }),
    qrStartCooldownMs: integer('QR_START_COOLDOWN_MS', 15_000, { min: 5000, max: 120_000 }),
  });
}

module.exports = { loadConfig, validateWppUrl };
