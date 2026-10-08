const express = require('express');
const { requireClientAuth } = require('../middleware/auth');

function logWppError(operation, error) {
  console.error('[WPPConnect]', {
    operation,
    code: error?.code || 'UNEXPECTED',
    httpStatus: error?.httpStatus,
  });
}

function createClientRouter(wppService) {
  const router = express.Router();
  router.use(requireClientAuth);

  router.get('/status', async (req, res) => {
    try {
      const status = await wppService.getConnectionStatus(req.clientAccount.session);
      return res.json({ state: status.state });
    } catch (error) {
      logWppError('status', error);
      return res.status(502).json({
        state: 'error',
        error: 'Não foi possível verificar a conexão. Tente novamente.',
      });
    }
  });

  router.post('/qr/prepare', async (req, res) => {
    try {
      const result = await wppService.prepareQrCode(req.clientAccount.session);
      return res.status(result.qrReady || result.state === 'connected' ? 200 : 202).json(result);
    } catch (error) {
      logWppError('prepare-qr', error);
      return res.status(502).json({
        state: 'error',
        error: 'Não foi possível gerar o QR Code. Tente novamente.',
      });
    }
  });

  router.get('/qr', async (req, res) => {
    try {
      const qr = await wppService.getQrCode(req.clientAccount.session);
      if (!qr) {
        return res.status(404).json({ error: 'QR Code ainda não está disponível.' });
      }

      res.set({
        'Content-Type': qr.contentType,
        'Content-Length': String(qr.buffer.length),
        'Cache-Control': 'no-store, private',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(qr.buffer);
    } catch (error) {
      logWppError('qr-image', error);
      return res.status(502).json({ error: 'QR Code indisponível no momento.' });
    }
  });

  return router;
}

module.exports = { createClientRouter };
