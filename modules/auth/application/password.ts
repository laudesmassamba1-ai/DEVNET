/**
 * Hachage des mots de passe — `scrypt`, fourni par Node, aucune dépendance.
 *
 * Le format stocké porte ses propres paramètres (`scrypt$N$r$p$sel$clé`) :
 * le jour où le coût doit monter, les anciennes empreintes restent
 * vérifiables et seules les nouvelles utilisent le coût courant.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCHEME = "scrypt";
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelism: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_BYTES,
      { N: cost, r: blockSize, p: parallelism, maxmem: MAX_MEMORY },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST, BLOCK_SIZE, PARALLELISM);
  return [
    SCHEME,
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * Empreinte factice, de coût identique, utilisée quand aucun compte ne
 * correspond : sans elle, une adresse inconnue répondrait plus vite qu'un
 * mauvais mot de passe, et le temps de réponse dirait qui existe.
 */
export const ABSENT_CREDENTIAL_HASH = [
  SCHEME,
  COST,
  BLOCK_SIZE,
  PARALLELISM,
  Buffer.alloc(SALT_BYTES).toString("base64"),
  Buffer.alloc(KEY_BYTES).toString("base64"),
].join("$");

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== SCHEME) return false;

  const [, cost, blockSize, parallelism, saltPart, keyPart] = parts;
  const parameters = [Number(cost), Number(blockSize), Number(parallelism)];
  if (!parameters.every((value) => Number.isInteger(value) && value > 0)) return false;

  const salt = Buffer.from(saltPart, "base64");
  const expected = Buffer.from(keyPart, "base64");
  if (salt.length === 0 || expected.length !== KEY_BYTES) return false;

  const actual = await derive(
    password,
    salt,
    parameters[0],
    parameters[1],
    parameters[2],
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
