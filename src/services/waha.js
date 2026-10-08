const { SESSION_PATTERN } = require('../config/clients');

const CONNECTED_STATUSES = new Set(['WORKING']);
const CONNECTING_STATUSES = new Set([
  'STARTING',
  'SCAN_QR_CODE',
  'PAIRING',
  'PASSKEY_REQUIRED',
  'PASSKEY_CONFIRMATION_REQUIRED',
]);
const DISCONNECTED_STATUSES = new Set(['STOPPED']);
const ERROR_STATUSES = new Set(['FAILED']);

class WahaError extends Error {
  constructor(code, operation, httpStatus) {
    super('Falha na comunicação com o WAHA.');
    this.name = 'WahaError';
    this.code = code;
    this.operation = operation;
    this.httpStatus = httpStatus;
  }
}

function normalizeStatus(payload) {
  const raw = typeof payload === 'string' ? payload : payload?.status;
  const status = typeof raw === 'string' ? raw.trim().toUpperCase() : '';

  if (CONNECTED_STATUSES.has(status)) return { state: 'connected' };
  if (CONNECTING_STATUSES.has(status)) return { state: 'connecting' };
  if (DISCONNECTED_STATUSES.has(status)) return { state: 'disconnected' };
  if (ERROR_STATUSES.has(status)) return { state: 'error' };
  return { state: 'unknown' };
}

function qrFromJson(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.data !== 'string') return null;
  const contentType = typeof payload.mimetype === 'string' ? payload.mimetype : 'image/png';
  if (!['image/png', 'image/jpeg'].includes(contentType)) return null;

  const buffer = Buffer.from(payload.data, 'base64');
  return buffer.length ? { buffer, contentType } : null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class WahaService {
  constructor(options) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs || 10_000;
    this.startTimeoutMs = options.startTimeoutMs || 35_000;
    this.qrPollAttempts = options.qrPollAttempts || 10;
    this.qrPollIntervalMs = options.qrPollIntervalMs || 1500;
    this.startCooldownMs = options.startCooldownMs || 15_000;
    this.fetch = options.fetch || global.fetch;
    this.startPromises = new Map();
    this.lastStartAt = new Map();
  }

  validateSession(session) {
    if (typeof session !== 'string' || !SESSION_PATTERN.test(session)) {
      throw new WahaError('INVALID_SESSION', 'validation');
    }
  }

  url(pathname) {
    return `${this.baseUrl}${pathname}`;
  }

  async rawRequest(pathname, options = {}) {
    const operation = options.operation || 'request';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);
    timeout.unref?.();

    try {
      return await this.fetch(this.url(pathname), {
        method: options.method || 'GET',
        headers: {
          Accept: options.accept || 'application/json',
          'X-Api-Key': this.apiKey,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body,
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      const code = error?.name === 'AbortError' ? 'TIMEOUT' : 'UNAVAILABLE';
      throw new WahaError(code, operation);
    } finally {
      clearTimeout(timeout);
    }
  }

  async readJson(response, operation) {
    try {
      return await response.json();
    } catch {
      throw new WahaError('INVALID_RESPONSE', operation, response.status);
    }
  }

  async getSession(session) {
    this.validateSession(session);
    const response = await this.rawRequest(`/api/sessions/${encodeURIComponent(session)}`, {
      operation: 'get-session',
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new WahaError('UPSTREAM_HTTP_ERROR', 'get-session', response.status);
    return this.readJson(response, 'get-session');
  }

  async getConnectionStatus(session) {
    const payload = await this.getSession(session);
    return payload ? normalizeStatus(payload) : { state: 'disconnected' };
  }

  async startSession(session) {
    this.validateSession(session);
    if (this.startPromises.has(session)) return this.startPromises.get(session);

    const pending = (async () => {
      this.lastStartAt.set(session, Date.now());
      const current = await this.getSession(session);
      let response;

      if (!current) {
        response = await this.rawRequest('/api/sessions', {
          method: 'POST',
          operation: 'create-session',
          timeoutMs: this.startTimeoutMs,
          body: JSON.stringify({
            name: session,
            config: { noweb: { store: { enabled: true, fullSync: false } } },
          }),
        });
      } else if (normalizeStatus(current).state === 'connected') {
        return { state: 'connected', qrReady: false };
      } else {
        const action = current.status === 'FAILED' ? 'restart' : 'start';
        response = await this.rawRequest(
          `/api/sessions/${encodeURIComponent(session)}/${action}`,
          {
            method: 'POST',
            operation: `${action}-session`,
            timeoutMs: this.startTimeoutMs,
            body: JSON.stringify({}),
          }
        );
      }

      if (!response.ok) {
        throw new WahaError('UPSTREAM_HTTP_ERROR', 'start-session', response.status);
      }
      const payload = await this.readJson(response, 'start-session');
      const status = normalizeStatus(payload);
      return { state: status.state === 'connected' ? 'connected' : 'connecting', qrReady: false };
    })();

    this.startPromises.set(session, pending);
    try {
      return await pending;
    } finally {
      this.startPromises.delete(session);
    }
  }

  async getQrCode(session) {
    this.validateSession(session);
    const response = await this.rawRequest(
      `/api/${encodeURIComponent(session)}/auth/qr?format=image`,
      { operation: 'get-qr', accept: 'image/png, application/json' }
    );

    if ([404, 409, 422].includes(response.status)) return null;
    if (!response.ok) throw new WahaError('UPSTREAM_HTTP_ERROR', 'get-qr', response.status);

    const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (contentType === 'image/png' || contentType === 'image/jpeg') {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > 2 * 1024 * 1024) {
        throw new WahaError('INVALID_QR_IMAGE', 'get-qr');
      }
      return { buffer, contentType };
    }

    return qrFromJson(await this.readJson(response, 'get-qr'));
  }

  async prepareQrCode(session) {
    const current = await this.getConnectionStatus(session);
    if (current.state === 'connected') return { state: 'connected', qrReady: false };

    if (current.state === 'connecting') {
      const existingQr = await this.getQrCode(session);
      if (existingQr) return { state: 'connecting', qrReady: true };
    }

    const lastStart = this.lastStartAt.get(session) || 0;
    if (Date.now() - lastStart >= this.startCooldownMs) {
      try {
        await this.startSession(session);
      } catch (error) {
        if (error.code !== 'TIMEOUT') throw error;
      }
    }

    for (let attempt = 0; attempt < this.qrPollAttempts; attempt += 1) {
      const status = await this.getConnectionStatus(session);
      if (status.state === 'connected') return { state: 'connected', qrReady: false };

      const qr = await this.getQrCode(session);
      if (qr) return { state: 'connecting', qrReady: true };
      if (attempt < this.qrPollAttempts - 1) await delay(this.qrPollIntervalMs);
    }

    return { state: 'connecting', qrReady: false };
  }

  async health() {
    const response = await this.rawRequest('/health', {
      operation: 'health',
      timeoutMs: Math.min(this.timeoutMs, 5000),
    });
    if (!response.ok) throw new WahaError('UPSTREAM_HTTP_ERROR', 'health', response.status);
    return true;
  }
}

module.exports = { WahaService, WahaError, normalizeStatus, qrFromJson };
