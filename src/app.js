const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { createAuthRateLimiter } = require('./middleware/rateLimit');
const { createAuthRouter } = require('./routes/auth');
const { createClientRouter } = require('./routes/client');

function createApp({ config, clientStore, wppService }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.root, 'views'));
  app.locals.clientStore = clientStore;

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
    })
  );
  app.use(express.json({ limit: '8kb', type: 'application/json' }));
  app.use(
    session({
      name: 'roqia.sid',
      secret: config.adminSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      unset: 'destroy',
      cookie: {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: 'lax',
        maxAge: config.sessionTtlMs,
        path: '/',
      },
    })
  );
  app.use('/assets', express.static(path.join(config.root, 'public'), {
    etag: true,
    maxAge: config.isProduction ? '1d' : 0,
    index: false,
  }));

  app.use(['/api', '/conectar'], (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/wppconnect', async (_req, res) => {
    try {
      await wppService.health();
      return res.json({ status: 'ok' });
    } catch (error) {
      console.error('[WPPConnect]', {
        operation: 'health',
        code: error?.code || 'UNEXPECTED',
        httpStatus: error?.httpStatus,
      });
      return res.status(503).json({ status: 'unavailable' });
    }
  });

  const rateLimiter = createAuthRateLimiter({
    windowMs: config.authRateLimitWindowMs,
    maxAttempts: config.authRateLimitMax,
  });
  app.use('/api/auth', createAuthRouter(rateLimiter));
  app.use('/api/client', createClientRouter(wppService));

  app.get('/', (_req, res) => res.redirect('/conectar/cliente'));
  app.get('/conectar/:clientId', (req, res) => {
    const client = clientStore.get(req.params.clientId);
    const authenticated = Boolean(client && req.session?.clientId === client.id);

    return res.status(200).render('connect', {
      authenticated,
      clientName: authenticated ? client.name : client?.name || 'Acesso do cliente',
      clientId: req.params.clientId,
    });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint não encontrado.' }));
  app.use((_req, res) => res.status(404).render('not-found'));
  app.use((error, _req, res, _next) => {
    console.error('[Aplicacao]', { code: error?.type || error?.name || 'UNEXPECTED' });
    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Requisição inválida.' });
    }
    return res.status(500).json({ error: 'Ocorreu um erro inesperado.' });
  });

  return app;
}

module.exports = { createApp };
