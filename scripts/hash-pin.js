const { randomBytes, scrypt } = require('node:crypto');
const { promisify } = require('node:util');

const scryptAsync = promisify(scrypt);

async function readPin() {
  if (process.argv.length > 2) {
    throw new Error('Por segurança, não informe o PIN na linha de comando. Rode apenas npm run hash-pin.');
  }

  if (!process.stdin.isTTY) {
    let value = '';
    for await (const chunk of process.stdin) value += chunk;
    return value.replace(/[\r\n]+$/, '');
  }

  process.stdout.write('Digite o PIN (a entrada ficará oculta): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let value = '';
    let finished = false;
    const finish = (callback) => {
      if (finished) return;
      finished = true;
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      callback();
    };
    const onData = (input) => {
      for (const character of input) {
        if (character === '\u0003') {
          finish(() => reject(new Error('Operação cancelada.')));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish(() => resolve(value));
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

(async () => {
  const pin = await readPin();
  if (pin.length < 4 || pin.length > 128) {
    throw new Error('O PIN deve ter entre 4 e 128 caracteres.');
  }
  const salt = randomBytes(16);
  const cost = 16384;
  const blockSize = 8;
  const parallelization = 1;
  const derived = await scryptAsync(pin, salt, 32, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: 64 * 1024 * 1024,
  });

  console.log(
    `scrypt$${cost}$${blockSize}$${parallelization}$${salt.toString('base64')}$${derived.toString('base64')}`
  );
})().catch((error) => {
  console.error(error.message || 'Não foi possível gerar o hash do PIN.');
  process.exit(1);
});
