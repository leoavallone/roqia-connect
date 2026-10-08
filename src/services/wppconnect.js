const { SESSION_PATTERN } = require('../config/clients');

const CONNECTED_STATUSES = new Set([
  'CONNECTED',
  'ISLOGGED',
  'INCHAT',
  'READY',
  'OPEN',
]);

const CONNECTING_STATUSES = new Set([
  'INITIALIZING',
  'STARTING',
  'CONNECTING',
  'QRCODE',
  'QR',
  'PAIRING',
  'UNPAIRED',
  'NOTLOGGED',
  'QRREADSUCCESS',
  'SYNCING',
]);

const DISCONNECTED_STATUSES = new Set([
  'CLOSED',
  'DISCONNECTED',
  'BROWSERCLOSE',
  'QRREADFAIL',
  'QRREADERROR',
  'AUTOCLOSECALLED',
  'DISCONNECTEDMOBILE',
  'DESCONNECTEDMOBILE',
  'PHONENOTCONNECTED',
  'SERVERCLOSE',
  'DELETETOKEN',
  'UNPAIREDIDLE',
]);

class WppConnectError extends Error {
  constructor(code, operation, httpStatus) {
    super('Falha na comunicação com o WPPConnect.');
    this.name = 'WppConnectError';
    this.code = code;
    this.operation = operation;
    this.httpStatus = httpStatus;
  }
}

function normalizedStatusValue(payload) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';

  if (typeof payload.status === 'string') return payload.status;
  if (typeof payload.state === 'string') return payload.state;
  if (typeof payload.response === 'string') return payload.response;
  if (typeof payload.response?.status === 'string') return payload.response.status;
  if (typeof payload.response?.state === 'string') return payload.response.state;
  return '';
}

function normalizeStatus(payload) {
  if (payload?.status === true || payload?.connected === true || payload?.response?.connected === true) {
    return { state: 'connected' };
  }

  const raw = normalizedStatusValue(payload).replace(/[\s_-]/g, '').toUpperCase();
  if (CONNECTED_STATUSES.has(raw)) return { state: 'connected' };
  if (CONNECTING_STATUSES.has(raw)) return { state: 'connecting' };
  if (DISCONNECTED_STATUSES.has(raw) || payload?.status === false || payload?.connected === false) {
    return { state: 'disconnected' };
  }
  if (raw === 'ERROR' || raw === 'FAILURE' || raw === 'FAILED') return { state: 'error' };
  return { state: 'unknown' };
}

function parseDataUri(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:(image\/(?:png|jpeg|jpg));base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  return buffer.length ? { buffer, contentType: match[1] === 'image/jpg' ? 'image/jpeg' : match[1] } : null;
}

function qrFromJson(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [payload.qrcode, payload.qrCode, payload.base64, payload.response?.qrcode];
  for (const candidate of candidates) {
    const parsed = parseDataUri(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class WppConnectService {
  constructor(options) {
    this.baseUrl = options.baseUrl;
    this.secretKey = options.secretKey;
    this.timeoutMs = options.timeoutMs || 10_000;
    this.startTimeoutMs = options.startTimeoutMs || 35_000;
    this.qrPollAttempts = options.qrPollAttempts || 10;
    this.qrPollIntervalMs = options.qrPollIntervalMs || 1500;
    this.startCooldownMs = options.startCooldownMs || 15_000;
    this.fetch = options.fetch || global.fetch;
    this.tokenCache = new Map();
    this.tokenPromises = new Map();
    this.startPromises = new Map();
    this.lastStartAt = new Map();
    this.qrCache = new Map();
  }

  validateSession(session) {
    if (typeof session !== 'string' || !SESSION_PATTERN.test(session)) {
      throw new WppConnectError('INVALID_SESSION', 'validation');
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
        headers: options.headers,
        body: options.body,
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      const code = error?.name === 'AbortError' ? 'TIMEOUT' : 'UNAVAILABLE';
      throw new WppConnectError(code, operation);
    } finally {
      clearTimeout(timeout);
    }
  }

  async readJson(response, operation) {
    try {
      return await response.json();
    } catch {
      throw new WppConnectError('INVALID_RESPONSE', operation, response.status);
    }
  }

  async generateToken(session) {
    this.validateSession(session);
    if (this.tokenCache.has(session)) return this.tokenCache.get(session);
    if (this.tokenPromises.has(session)) return this.tokenPromises.get(session);

    const pending = (async () => {
      const response = await this.rawRequest(
        `/api/${encodeURIComponent(session)}/${encodeURIComponent(this.secretKey)}/generate-token`,
        { method: 'POST', operation: 'generate-token' }
      );
      if (!response.ok) throw new WppConnectError('TOKEN_REJECTED', 'generate-token', response.status);
      const data = await this.readJson(response, 'generate-token');
      const token = typeof data.token === 'string' ? data.token : null;
      if (!token) throw new WppConnectError('INVALID_TOKEN_RESPONSE', 'generate-token', response.status);
      this.tokenCache.set(session, token);
      return token;
    })();

    this.tokenPromises.set(session, pending);
    try {
      return await pending;
    } finally {
      this.tokenPromises.delete(session);
    }
  }

  async authorizedRequest(session, pathname, options = {}, mayRetry = true) {
    const token = await this.generateToken(session);
    const response = await this.rawRequest(pathname, {
      ...options,
      headers: {
        Accept: options.accept || 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401 && mayRetry) {
      this.tokenCache.delete(session);
      return this.authorizedRequest(session, pathname, options, false);
    }

    if (!response.ok) {
      throw new WppConnectError('UPSTREAM_HTTP_ERROR', options.operation || 'request', response.status);
    }
    return response;
  }

  async statusSession(session) {
    this.validateSession(session);
    const response = await this.authorizedRequest(
      session,
      `/api/${encodeURIComponent(session)}/status-session`,
      { operation: 'status-session' }
    );
    const payload = await this.readJson(response, 'status-session');
    return normalizeStatus(payload);
  }

  async getConnectionStatus(session) {
    this.validateSession(session);
    const response = await this.authorizedRequest(
      session,
      `/api/${encodeURIComponent(session)}/check-connection-session`,
      { operation: 'check-connection' }
    );
    const payload = await this.readJson(response, 'check-connection');
    const check = normalizeStatus(payload);
    if (check.state === 'connected') return check;

    try {
      const detail = await this.statusSession(session);
      return detail.state === 'unknown' ? check : detail;
    } catch (error) {
      if (check.state === 'disconnected') return check;
      throw error;
    }
  }

  async startSession(session, webhookUrl = '') {
    this.validateSession(session);
    if (typeof webhookUrl !== 'string') throw new WppConnectError('INVALID_WEBHOOK', 'start-session');
    if (this.startPromises.has(session)) return this.startPromises.get(session);

    const pending = (async () => {
      this.lastStartAt.set(session, Date.now());
      const response = await this.authorizedRequest(
        session,
        `/api/${encodeURIComponent(session)}/start-session`,
        {
          method: 'POST',
          operation: 'start-session',
          timeoutMs: this.startTimeoutMs,
          body: JSON.stringify({ webhook: webhookUrl, waitQrCode: true }),
        }
      );
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await this.readJson(response, 'start-session')
        : null;
      const qr = qrFromJson(payload);
      if (qr) this.qrCache.set(session, { ...qr, expiresAt: Date.now() + 25_000 });
      const normalized = normalizeStatus(payload);
      return { state: normalized.state === 'connected' ? 'connected' : 'connecting', qrReady: Boolean(qr) };
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
    const cached = this.qrCache.get(session);
    if (cached && cached.expiresAt > Date.now()) {
      return { buffer: cached.buffer, contentType: cached.contentType };
    }
    this.qrCache.delete(session);

    const response = await this.authorizedRequest(
      session,
      `/api/${encodeURIComponent(session)}/qrcode-session`,
      { operation: 'qrcode-session', accept: 'image/png, application/json' }
    );
    const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();

    if (contentType === 'image/png' || contentType === 'image/jpeg') {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > 2 * 1024 * 1024) {
        throw new WppConnectError('INVALID_QR_IMAGE', 'qrcode-session');
      }
      return { buffer, contentType };
    }

    const payload = await this.readJson(response, 'qrcode-session');
    return qrFromJson(payload);
  }

  async prepareQrCode(session, webhookUrl = '') {
    const current = await this.getConnectionStatus(session);
    if (current.state === 'connected') return { state: 'connected', qrReady: false };

    // After a WPPConnect restart, a persisted session can remain in
    // INITIALIZING/STARTING without exposing a QR code. Check for an existing
    // QR first, then allow start-session to recover that stalled state.
    try {
      const existingQr = await this.getQrCode(session);
      if (existingQr) return { state: 'connecting', qrReady: true };
    } catch (error) {
      if (!['INVALID_RESPONSE', 'UPSTREAM_HTTP_ERROR'].includes(error.code)) throw error;
    }

    const lastStart = this.lastStartAt.get(session) || 0;
    if (Date.now() - lastStart >= this.startCooldownMs) {
      try {
        await this.startSession(session, webhookUrl);
      } catch (error) {
        if (error.code !== 'TIMEOUT') throw error;
      }
    }

    for (let attempt = 0; attempt < this.qrPollAttempts; attempt += 1) {
      try {
        const qr = await this.getQrCode(session);
        if (qr) return { state: 'connecting', qrReady: true };
      } catch (error) {
        if (!['INVALID_RESPONSE', 'UPSTREAM_HTTP_ERROR'].includes(error.code)) throw error;
      }
      if (attempt < this.qrPollAttempts - 1) await delay(this.qrPollIntervalMs);
    }

    const finalStatus = await this.getConnectionStatus(session);
    return { state: finalStatus.state === 'connected' ? 'connected' : 'connecting', qrReady: false };
  }

  async health() {
    const response = await this.rawRequest('/healthz', {
      operation: 'health',
      timeoutMs: Math.min(this.timeoutMs, 5000),
    });
    if (!response.ok) throw new WppConnectError('UPSTREAM_HTTP_ERROR', 'health', response.status);
    return true;
  }
}

module.exports = { WppConnectService, WppConnectError, normalizeStatus, qrFromJson };
