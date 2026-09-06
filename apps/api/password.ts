import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP scrypt profile: 16 MiB with p=5, below Workers' isolate memory limit.
const derive = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:16384:8:5:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  const parts = encoded?.split(':');
  const valid =
    parts?.length === 6 &&
    parts.slice(0, 4).join(':') === 'scrypt:16384:8:5' &&
    /^[a-f0-9]{32}$/.test(parts[4]) &&
    /^[a-f0-9]{128}$/.test(parts[5]);
  // Unknown accounts still perform the same expensive derivation.
  const actual = await derive(password, valid ? parts[4] : '0'.repeat(32));
  const expected = Buffer.from(valid ? parts[5] : '0'.repeat(128), 'hex');
  return timingSafeEqual(actual, expected) && !!valid;
}
