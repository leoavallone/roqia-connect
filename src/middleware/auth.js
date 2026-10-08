function requireClientAuth(req, res, next) {
  if (!req.session?.clientId) {
    return res.status(401).json({
      error: 'Sessão expirada. Acesse novamente com seu PIN.',
      code: 'AUTH_REQUIRED',
    });
  }

  const client = req.app.locals.clientStore.get(req.session.clientId);
  if (!client) {
    req.session.destroy(() => {});
    return res.status(401).json({
      error: 'Sessão expirada. Acesse novamente com seu PIN.',
      code: 'AUTH_REQUIRED',
    });
  }

  req.clientAccount = client;
  return next();
}

module.exports = { requireClientAuth };
