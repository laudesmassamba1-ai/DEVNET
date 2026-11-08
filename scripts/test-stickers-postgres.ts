/**
 * Stickers PostgreSQL — test d'intégration sur la base **locale**.
 *
 * Exécuter avec : `npm run test:stickers-postgres` (base locale migrée).
 *
 * Ce que ce test prouve, et que la validation seule ne peut pas prouver :
 * un sticker privé n'existe pas pour les autres, un sticker public existe,
 * un retrait ne le supprime pas mais le cache, la RLS refuse d'écrire au nom
 * d'un autre, et une image ne sort du serveur que re-encodée en WebP, sans
 * ses métadonnées, sous 60 Ko.
 *
 * Il **écrit** : il refuse toute cible distante et nettoie dans `finally`.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import sharp from "sharp";
import { PostgresStickersRepository } from "../modules/stickers/infrastructure/postgres/postgres-stickers-repository";
import { reencodeSticker, STICKER_OUTPUT_MAX_BYTES } from "../modules/stickers";
import { closePostgresPool, getPostgresPool } from "../platform/infrastructure/postgres/pool";
import { withUser } from "../platform/infrastructure/postgres/with-user";
import { parseEndpoint } from "./db/guard";
import { isLocalHost, loadEnvFiles, resolveDatabaseUrl } from "./db/lib";

const users = { owner: randomUUID(), other: randomUUID(), solo: randomUUID() };

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

async function seed(client: Client): Promise<void> {
  for (const [id, label] of [
    [users.owner, "proprietaire"],
    [users.other, "voisin"],
    [users.solo, "tiers"],
  ] as const) {
    await client.query("insert into auth.users (id, email) values ($1, $2)", [
      id,
      `${label}-${id.slice(0, 8)}@probe.local`,
    ]);
    await client.query(
      "update public.users set pseudo = $2, prenom = $2, is_admin = false where id = $1",
      [id, `probe-${label}-${id.slice(0, 8)}`],
    );
  }
}

async function main(): Promise<void> {
  loadEnvFiles();
  const databaseUrl = resolveDatabaseUrl();
  const { host } = parseEndpoint(databaseUrl);
  if (!isLocalHost(host)) {
    console.error("Refus : ce test écrit des lignes, il n'est autorisé que sur une base locale.");
    process.exitCode = 2;
    return;
  }

  const client = new Client({
    connectionString: databaseUrl,
    application_name: "devnet-test-stickers",
  });
  await client.connect();

  const repository = new PostgresStickersRepository({
    asUser: (userId, run) => withUser(userId, run, getPostgresPool()),
    reencode: reencodeSticker,
  });

  try {
    await seed(client);

    // 1. Sticker de texte privé — visible par son auteur seulement.
    const privateSticker = await repository.create(users.owner, {
      kind: "texte",
      name: "Déploiement du vendredi",
      glyph: "🚀",
      fg: "void",
      bg: "signal",
      visibility: "prive",
    });
    check("texte : créé", privateSticker.id.startsWith("custom-"), privateSticker.id);
    check("texte : propriétaire reconnu", privateSticker.mine === true);
    check("texte : couleurs conservées", privateSticker.fg === "void" && privateSticker.bg === "signal");
    check("texte : privé", privateSticker.visibility === "prive");
    check("texte : pas d’octets", privateSticker.byteSize === 0);

    const ownerList = await repository.list(users.owner);
    check("liste : mon sticker présent", ownerList.some((row) => row.id === privateSticker.id));

    const otherList = await repository.list(users.other);
    check("liste : privé absent chez les autres", !otherList.some((row) => row.id === privateSticker.id));

    // 2. Retrait — il reste en base, il n'est plus proposé.
    await repository.retire(users.owner, privateSticker.id);
    const afterRetire = await repository.list(users.owner);
    const retired = afterRetire.find((row) => row.id === privateSticker.id);
    check("retrait : conservé pour l’auteur", retired !== undefined);
    check("retrait : état « retiré »", retired?.status === "retire");
    const stillHidden = await repository.list(users.other);
    check("retrait : toujours invisible aux autres", !stillHidden.some((row) => row.id === privateSticker.id));

    // 3. Sticker public — visible par le réseau, jamais avant accord.
    const publicSticker = await repository.create(users.owner, {
      kind: "texte",
      name: "Bien joué",
      glyph: "👏",
      fg: "chalk",
      bg: "ok",
      visibility: "public",
    });
    const seenByOther = await repository.list(users.other);
    const publicRow = seenByOther.find((row) => row.id === publicSticker.id);
    check("public : visible par les autres", publicRow !== undefined);
    check("public : pas « mien » chez les autres", publicRow?.mine === false);

    // 4. RLS — écrire au nom d'un autre est refusé avant toute politique.
    let forged = false;
    try {
      await withUser(
        users.other,
        (query) =>
          query(
            `insert into public.stickers (id, pack, kind, glyph, name, owner_id)
             values ($1, 'perso', 'texte', '🐛', 'forge', $2)`,
            [`custom-${randomUUID()}`, users.owner],
          ),
        getPostgresPool(),
      );
      forged = true;
    } catch (error) {
      forged = (error as { code?: string }).code !== "42501";
    }
    check("RLS : insertion au nom d’un autre refusée", forged === false);

    // 5. Image — re-encodage serveur, octets servis à part.
    const source = await sharp({
      create: {
        width: 1200,
        height: 1200,
        channels: 4,
        background: { r: 0, g: 214, b: 143, alpha: 0.8 },
      },
    })
      .png()
      .withMetadata()
      .toBuffer();

    const imageSticker = await repository.create(users.owner, {
      kind: "image",
      name: "Pastille",
      source,
      visibility: "prive",
    });
    check("image : créée", imageSticker.kind === "image");
    check(
      "image : poids re-encodé",
      imageSticker.byteSize > 0 && imageSticker.byteSize <= STICKER_OUTPUT_MAX_BYTES,
      imageSticker.byteSize,
    );

    const stored = await client.query<{
      mime: string;
      sha256: string;
      size: string;
      octets: Buffer;
    }>(
      "select mime, sha256, octet_length(bytes)::text as size, bytes as octets from public.stickers where id = $1",
      [imageSticker.id],
    );
    check("image : type stocké WebP", stored.rows[0]?.mime === "image/webp", stored.rows[0]?.mime);
    check(
      "image : source non stockée telle quelle",
      stored.rows[0]?.octets?.length !== source.length,
    );

    const asset = await repository.fetchAsset(users.owner, imageSticker.id);
    check("image : octets lisibles par l’auteur", asset !== null);
    check("image : empreinte identique au stockage", asset !== null && (await sha(asset.bytes)) === stored.rows[0]?.sha256);
    const metadata = asset ? await sharp(asset.bytes).metadata() : null;
    check("image : pas de métadonnées", metadata?.exif === undefined);
    check(
      "image : 512 px au plus",
      metadata !== null && Math.max(metadata.width ?? 0, metadata.height ?? 0) <= 512,
    );

    const forbiddenAsset = await repository.fetchAsset(users.other, imageSticker.id);
    check("image : privée illisible par les autres", forbiddenAsset === null);

    // Rendre public rend l'octet lisible — et pas avant.
    await repository.retire(users.owner, imageSticker.id);
    const publicImage = await repository.create(users.owner, {
      kind: "image",
      name: "Pastille publique",
      source,
      visibility: "public",
    });
    const sharedAsset = await repository.fetchAsset(users.other, publicImage.id);
    check("image : publique lisible par les autres", sharedAsset !== null);

    if (failures.length > 0) {
      console.error(`\n${failures.length} vérification(s) en échec`);
      for (const failure of failures) console.error(`  · ${failure}`);
      process.exitCode = 1;
      return;
    }
    console.log(`\n✓ Stickers PostgreSQL — ${passed} vérifications réussies.`);
  } finally {
    await client.query("delete from auth.users where id = any($1::uuid[])", [
      [users.owner, users.other, users.solo],
    ]);
    await client.end();
    await closePostgresPool();
  }
}

async function sha(bytes: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
