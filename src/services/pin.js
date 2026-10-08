const { createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const scryptAsync = promisify(scrypt);
const FAKE_HASH =
  'scrypt$16384$8$1$5Yp3Hq9YxJpGWuD6pF2HRQ==$eD+YjvX4j7rM5zFrP3t89swlLfQZvnHzRVOLM4H2vXc=';

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  const length = Math.max(a.length, b.length, 1);
  const paddedA = Buffer.alloc(length);
  const paddedB = Buffer.alloc(length);
  a.copy(paddedA);
  b.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && a.length === b.length;
}

async function verifyScrypt(pin, encoded) {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, costRaw, blockSizeRaw, parallelizationRaw, saltRaw, hashRaw] = parts;
  const cost = Number(costRaw);
  const blockSize = Number(blockSizeRaw);
  const parallelization = Number(parallelizationRaw);
  const salt = Buffer.from(saltRaw, 'base64');
  const expected = Buffer.from(hashRaw, 'base64');

  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelization) ||
    salt.length < 8 ||
    expected.length < 16
  ) {
    return false;
  }

  try {
    const actual = await scryptAsync(pin, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function verifyPin(pin, client) {
  const normalizedPin = typeof pin === 'string' ? pin : '';
  if (normalizedPin.length < 4 || normalizedPin.length > 128) {
    await verifyScrypt('invalid-pin', FAKE_HASH);
    return false;
  }

  if (client?.pinHash) return verifyScrypt(normalizedPin, client.pinHash);

  if (client?.pin) {
    const actual = createHash('sha256').update(normalizedPin).digest('hex');
    const expected = createHash('sha256').update(client.pin).digest('hex');
    return safeEqual(actual, expected);
  }

  await verifyScrypt(normalizedPin, FAKE_HASH);
  return false;
}

module.exports = { verifyPin, verifyScrypt };
