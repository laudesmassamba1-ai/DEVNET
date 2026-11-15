/**
 * Politique CORS du compartiment R2.
 *
 * L'envoi par morceaux met le navigateur en relation **directe** avec R2 :
 * sans CORS, chaque `PUT` de partie est bloqué avant d'envoyer le moindre
 * octet et l'interface ne voit qu'un « échec réseau » sans explication.
 *
 * Usage : `node scripts/storage/set-cors.mjs` (lit `.env.local`).
 * Idempotent : remplace la politique existante.
 */
import { readFileSync } from "node:fs";
import { AwsClient } from "aws4fetch";

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const value = match[2].replace(/^["']|["']$/g, "");
      if (!process.env[match[1]]) process.env[match[1]] = value;
    }
  } catch {
    /* pas de fichier : variables déjà dans l'environnement */
  }
}

loadEnv();

const account = process.env.R2_ACCOUNT_ID?.trim();
const endpoint = (
  process.env.R2_ENDPOINT?.trim() ||
  (account ? `https://${account}.r2.cloudflarestorage.com` : "")
).replace(/\/+$/, "");
const bucket = process.env.R2_BUCKET?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  console.error("R2_* manquantes : rien à configurer.");
  process.exit(1);
}

const origins = (process.env.R2_CORS_ORIGINS?.trim() || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const allowed = origins.length
  ? origins
  : [
      "https://devnet-brown.vercel.app",
      "http://localhost:3100",
      "http://127.0.0.1:3100",
      "http://localhost:3101",
      "http://127.0.0.1:3101",
    ];

const policy = `<CORSConfiguration>${allowed
  .map(
    (origin) => `<CORSRule>
  <AllowedOrigin>${origin}</AllowedOrigin>
  <AllowedMethod>GET</AllowedMethod>
  <AllowedMethod>HEAD</AllowedMethod>
  <AllowedMethod>PUT</AllowedMethod>
  <AllowedMethod>POST</AllowedMethod>
  <AllowedHeader>*</AllowedHeader>
  <ExposeHeader>ETag</ExposeHeader>
  <MaxAgeSeconds>86400</MaxAgeSeconds>
</CORSRule>`,
  )
  .join("")}</CORSConfiguration>`;

const client = new AwsClient({
  accessKeyId,
  secretAccessKey,
  service: "s3",
  region: process.env.R2_REGION?.trim() || "auto",
});

const response = await client.fetch(`${endpoint}/${bucket}?cors`, {
  method: "PUT",
  headers: { "Content-Type": "application/xml" },
  body: policy,
});

if (!response.ok) {
  console.error(`CORS refusé (${response.status}) — ${(await response.text()).slice(0, 300)}`);
  process.exit(1);
}
console.log(`CORS appliqué à ${bucket} pour ${allowed.join(", ")}`);
