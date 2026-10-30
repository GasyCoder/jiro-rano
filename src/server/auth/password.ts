import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Hachage scrypt (module crypto natif de Node) : aucune dépendance native à compiler sur l'hébergeur.
 * Format stocké : scrypt$N$r$p$sel$hash (base64url).
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1, keyLength: 64 };
const MAX_MEMORY = 128 * PARAMS.N * PARAMS.r * 2;

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLength, { N, r, p, maxmem: Math.max(MAX_MEMORY, 128 * N * r * 2) }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS.N, PARAMS.r, PARAMS.p, PARAMS.keyLength);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltText, hashText] = stored.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const actual = await derive(password, Buffer.from(saltText, 'base64url'), Number(n), Number(r), Number(p), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | null = null;

/** Égalise le temps de réponse quand l'e-mail n'existe pas (pas d'énumération des comptes). */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(12).toString('hex'));
  await verifyPassword(password, await dummyHash);
}
