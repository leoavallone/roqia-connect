const fs = require('node:fs');

const CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const SESSION_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function isValidClientId(value) {
  return typeof value === 'string' && CLIENT_ID_PATTERN.test(value);
}

function validateClient(id, client) {
  if (!isValidClientId(id) || !client || typeof client !== 'object') {
    throw new Error(`Cliente inválido em clients.json: ${id}`);
  }
  if (typeof client.name !== 'string' || client.name.trim().length < 1 || client.name.length > 100) {
    throw new Error(`Nome inválido para o cliente ${id}.`);
  }
  if (typeof client.session !== 'string' || !SESSION_PATTERN.test(client.session)) {
    throw new Error(`Session inválida para o cliente ${id}.`);
  }
  if (typeof client.pinHash !== 'string' && typeof client.pin !== 'string') {
    throw new Error(`Configure pinHash para o cliente ${id}.`);
  }
}

function createClientStore(filePath, serialized = '') {
  let parsed;
  try {
    parsed = JSON.parse(serialized || fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (!serialized && error.code === 'ENOENT') {
      throw new Error(`Arquivo de clientes não encontrado: ${filePath}`);
    }
    throw new Error(
      serialized
        ? 'CLIENTS_JSON não contém um JSON válido.'
        : 'Não foi possível ler config/clients.json. Verifique o JSON.'
    );
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('config/clients.json deve conter um objeto de clientes.');
  }

  const clients = new Map();
  for (const [id, client] of Object.entries(parsed)) {
    validateClient(id, client);
    clients.set(id, Object.freeze({ id, ...client, name: client.name.trim() }));
  }

  return Object.freeze({
    get(id) {
      return isValidClientId(id) ? clients.get(id) || null : null;
    },
    getPublic(id) {
      const client = this.get(id);
      return client ? { id: client.id, name: client.name } : null;
    },
    size: clients.size,
  });
}

module.exports = { createClientStore, isValidClientId, SESSION_PATTERN };
