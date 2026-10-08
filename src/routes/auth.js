const express = require('express');
const { verifyPin } = require('../services/pin');

function createAuthRouter(rateLimiter) {
  const router = express.Router();

  router.post('/:clientId/login', rateLimiter.guard, async (req, res) => {
    const client = req.app.locals.clientStore.get(req.params.clientId);
    const valid = await verifyPin(req.body?.pin, client);

    if (!client || !valid) {
      rateLimiter.failure(req);
      return res.status(401).json({
        error: 'Cliente ou PIN inválido.',
        code: 'INVALID_CREDENTIALS',
      });
    }

    rateLimiter.success(req);
    return req.session.regenerate((error) => {
      if (error) {
        return res.status(500).json({ error: 'Não foi possível iniciar a sessão.' });
      }

      req.session.clientId = client.id;
      return req.session.save((saveError) => {
        if (saveError) {
          return res.status(500).json({ error: 'Não foi possível iniciar a sessão.' });
        }
        return res.status(200).json({ ok: true });
      });
    });
  });

  router.post('/logout', (req, res) => {
    if (!req.session) return res.status(204).end();
    return req.session.destroy(() => {
      res.clearCookie('roqia.sid', { path: '/' });
      res.status(204).end();
    });
  });

  return router;
}

module.exports = { createAuthRouter };
