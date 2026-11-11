import { webcrypto } from "node:crypto";
import { decryptValue, encryptValue } from "@/lib/github/crypto";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  console.log(`${condition ? "ok  " : "FAIL"} ${label}`);
  if (condition) passed++;
  else failed++;
}

async function encryptLegacyValue(secret: string, plaintext: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await webcrypto.subtle.digest("SHA-256", encoder.encode(secret));
  const key = await webcrypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const cipher = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );

  return Buffer.concat([Buffer.from(iv), Buffer.from(cipher)]).toString("base64url");
}

async function main(): Promise<void> {
  const secret = "test-only-github-crypt-secret-with-32-bytes";
  const plaintext = "github-token-test-only";
  const first = await encryptValue(secret, plaintext);
  const second = await encryptValue(secret, plaintext);

  check("les nouvelles enveloppes portent la version v2", first.startsWith("v2."));
  check("chaque chiffrement utilise un sel ou un vecteur neuf", first !== second);
  check("une enveloppe v2 se déchiffre avec la bonne clé", await decryptValue(secret, first) === plaintext);
  check("une enveloppe v2 refuse une mauvaise clé", await decryptValue(`${secret}-wrong`, first) === null);
  check("une enveloppe altérée est refusée", await decryptValue(secret, `${first.slice(0, -1)}x`) === null);
  check("une entrée mal formée est refusée", await decryptValue(secret, "not-an-envelope") === null);

  const legacy = await encryptLegacyValue(secret, plaintext);
  const originalCutoff = process.env.GITHUB_CRYPT_LEGACY_UNTIL;
  try {
    process.env.GITHUB_CRYPT_LEGACY_UNTIL = "2999-01-01T00:00:00.000Z";
    check("une enveloppe v1 reste lisible pendant la grâce", await decryptValue(secret, legacy) === plaintext);

    process.env.GITHUB_CRYPT_LEGACY_UNTIL = "2000-01-01T00:00:00.000Z";
    check("une enveloppe v1 est refusée après la grâce", await decryptValue(secret, legacy) === null);

    process.env.GITHUB_CRYPT_LEGACY_UNTIL = "not-a-date";
    check("une échéance de grâce invalide échoue de façon fermée", await decryptValue(secret, legacy) === null);
  } finally {
    if (originalCutoff === undefined) delete process.env.GITHUB_CRYPT_LEGACY_UNTIL;
    else process.env.GITHUB_CRYPT_LEGACY_UNTIL = originalCutoff;
  }

  console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s)`);
  if (failed > 0) process.exitCode = 1;
}

void main();
