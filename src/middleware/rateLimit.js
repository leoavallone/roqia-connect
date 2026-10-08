const { createHash } = require('node:crypto');

function createAuthRateLimiter({ windowMs, maxAttempts }) {
  const attempts = new Map();

  function keyFor(req, clientId) {
    const source = `${req.ip || req.socket.remoteAddress || 'unknown'}:${clientId || 'unknown'}`;
    return createHash('sha256').update(source).digest('hex');
  }

  function activeEntry(key, now = Date.now()) {
    const entry = attempts.get(key);
    if (entry && entry.resetAt <= now) {
      attempts.delete(key);
      return null;
    }
    return entry || null;
  }

  function guard(req, res, next) {
    const key = keyFor(req, req.params.clientId);
    const entry = activeEntry(key);
    req.authRateLimitKey = key;

    if (entry && entry.count >= maxAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
        code: 'RATE_LIMITED',
      });
    }

    return next();
  }

  function failure(req) {
    const key = req.authRateLimitKey || keyFor(req, req.params.clientId);
    const now = Date.now();
    const entry = activeEntry(key, now) || { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    attempts.set(key, entry);
  }

  function success(req) {
    const key = req.authRateLimitKey || keyFor(req, req.params.clientId);
    attempts.delete(key);
  }

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (entry.resetAt <= now) attempts.delete(key);
    }
  }, Math.min(windowMs, 60_000));
  cleanup.unref();

  return { guard, failure, success };
}

module.exports = { createAuthRateLimiter };
