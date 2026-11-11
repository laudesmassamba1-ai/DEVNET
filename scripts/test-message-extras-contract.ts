/**
 * Contrat du domaine messages — réactions, épingles, suppression.
 *
 * Exécuter avec :  npx tsx scripts/test-message-extras-contract.ts
 *
 * Ce test porte sur le **service**, pas sur la base : il remplace
 * l'adaptateur par un dépôt en mémoire et vérifie ce que le domaine décide.
 * C'est exactement ce que la frontière achète — les règles d'agrégation et de
 * bascule sont testables sans réseau, sans Supabase et sans navigateur.
 *
 * Les trois règles qui comptent :
 *
 *  1. **L'ordre des pastilles est déclaré, pas subi.** Deux personnes qui
 *     réagissent dans un ordre différent doivent voir la même rangée.
 *  2. **Une bascule est une lecture puis une écriture.** La base autorise
 *     deux lignes identiques : sans la lecture, un second clic empile une
 *     seconde icône au lieu de retirer la première.
 *  3. **Un refus reste un refus.** Une erreur de lecture ou d'écriture est
 *     remontée, et l'état rendu à l'écran est celui qui reste vrai.
 */

import { createMessageExtrasService } from "../modules/messages";
import type { MessageTarget } from "../lib/types";

type Reaction = {
  id: string;
  target_type: MessageTarget;
  target_id: string;
  user_id: string;
  emoji: string;
};

type Pin = {
  id: string;
  target_type: MessageTarget;
  target_id: string;
  user_id: string;
};

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function fakeRepository() {
  const reactions: Reaction[] = [];
  const pins: Pin[] = [];
  const calls = { listReactions: 0, addReaction: 0, deleteReaction: 0, deleteMessage: 0 };
  let nextId = 0;
  let readFailure: string | null = null;
  let writeFailure: string | null = null;

  function findReaction(
    targetType: MessageTarget,
    targetId: string,
    userId: string,
    emoji: string,
  ) {
    return reactions.find(
      (row) =>
        row.target_type === targetType &&
        row.target_id === targetId &&
        row.user_id === userId &&
        row.emoji === emoji,
    );
  }

  const repository = {
    reactions,
    pins,
    calls,
    setReadFailure(message: string | null) {
      readFailure = message;
    },
    setWriteFailure(message: string | null) {
      writeFailure = message;
    },
    async listReactions(targetType: MessageTarget, targetIds: string[]) {
      calls.listReactions++;
      return reactions.filter(
        (row) => row.target_type === targetType && targetIds.includes(row.target_id),
      );
    },
    async findReaction(
      targetType: MessageTarget,
      targetId: string,
      userId: string,
      emoji: string,
    ) {
      if (readFailure) return { row: null, error: readFailure };
      const row = findReaction(targetType, targetId, userId, emoji);
      return { row: row ? { id: row.id } : null, error: null };
    },
    async addReaction(input: {
      targetType: MessageTarget;
      targetId: string;
      userId: string;
      emoji: string;
    }) {
      calls.addReaction++;
      if (writeFailure) return { error: writeFailure };
      reactions.push({
        id: `reaction-${++nextId}`,
        target_type: input.targetType,
        target_id: input.targetId,
        user_id: input.userId,
        emoji: input.emoji,
      });
      return { error: null };
    },
    async deleteReaction(id: string) {
      calls.deleteReaction++;
      if (writeFailure) return { error: writeFailure };
      const index = reactions.findIndex((row) => row.id === id);
      if (index >= 0) reactions.splice(index, 1);
      return { error: null };
    },
    async deleteMessage() {
      calls.deleteMessage++;
      return { error: writeFailure };
    },
    async listPinnedIds(targetType: MessageTarget, userId: string) {
      return pins
        .filter((row) => row.target_type === targetType && row.user_id === userId)
        .map((row) => row.target_id);
    },
    async findPin(targetType: MessageTarget, targetId: string, userId: string) {
      if (readFailure) return { row: null, error: readFailure };
      const row =
        pins.find(
          (pin) =>
            pin.target_type === targetType &&
            pin.target_id === targetId &&
            pin.user_id === userId,
        ) ?? null;
      return { row: row ? { id: row.id } : null, error: null };
    },
    async addPin(input: {
      targetType: MessageTarget;
      targetId: string;
      userId: string;
    }) {
      if (writeFailure) return { error: writeFailure };
      pins.push({
        id: `pin-${++nextId}`,
        target_type: input.targetType,
        target_id: input.targetId,
        user_id: input.userId,
      });
      return { error: null };
    },
    async deletePin(id: string) {
      if (writeFailure) return { error: writeFailure };
      const index = pins.findIndex((row) => row.id === id);
      if (index >= 0) pins.splice(index, 1);
      return { error: null };
    },
  };

  return repository;
}

async function run(): Promise<void> {
  const repository = fakeRepository();
  const service = createMessageExtrasService(() => repository);

  // ── 1. Agrégation et ordre ───────────────────────────────────────────
  const empty = await service.fetchReactions("direct_message", [], "me");
  check("aucune lecture pour une liste vide", repository.calls.listReactions === 0);
  check("une liste vide rend un objet vide", Object.keys(empty).length === 0);

  // Écrites volontairement dans le désordre : ❤️ puis ✅ puis ✅ d'autrui.
  repository.reactions.push(
    { id: "r1", target_type: "direct_message", target_id: "m1", user_id: "bob", emoji: "\u2764\uFE0F" },
    { id: "r2", target_type: "direct_message", target_id: "m1", user_id: "me", emoji: "\u2705" },
    { id: "r3", target_type: "direct_message", target_id: "m1", user_id: "bob", emoji: "\u2705" },
    { id: "r4", target_type: "direct_message", target_id: "m2", user_id: "me", emoji: "\u{1F525}" },
    { id: "r5", target_type: "direct_message", target_id: "m2", user_id: "me", emoji: "\u{1F9EA}" },
  );

  const summary = await service.fetchReactions(
    "direct_message",
    ["m1", "m2", "m3"],
    "me",
  );

  check("une seule lecture pour tous les messages", repository.calls.listReactions === 1);
  check("les compteurs s'additionnent", summary.m1?.[0].count === 2, summary.m1?.[0]);
  check("les pastilles sont dans l'ordre déclaré", summary.m1?.[0].emoji === "\u2705", summary.m1?.map((r) => r.emoji));
  check("l'icône du lecteur est marquée", summary.m1?.[0].mine === true);
  check("l'icône posée par autrui seule ne l'est pas", summary.m1?.[1].mine === false);
  check("une icône inconnue passe en dernier", summary.m2?.[1].emoji === "\u{1F9EA}", summary.m2?.map((r) => r.emoji));
  check("un message sans réaction n'a pas d'entrée", summary.m3 === undefined);

  // ── 2. Bascule d'une réaction ────────────────────────────────────────
  const first = await service.toggleReaction("direct_message", "m3", "me", "\u2705");
  check("un premier clic pose la réaction", first.active === true && first.error === null, first);
  check("la réaction est réellement écrite", repository.reactions.length === 6);

  const second = await service.toggleReaction("direct_message", "m3", "me", "\u2705");
  check("un second clic retire la réaction", second.active === false && second.error === null, second);
  check("la lecture a précédé l'écriture", repository.calls.deleteReaction === 1);

  const anonymous = await service.toggleReaction("direct_message", "m3", "", "\u2705");
  check("sans session, la réaction est refusée", anonymous.active === false && anonymous.error === "Non connecté", anonymous);

  repository.setReadFailure("permission denied");
  const readRefused = await service.toggleReaction("direct_message", "m3", "me", "\u2705");
  check("une lecture refusée remonte l'erreur", readRefused.error === "permission denied", readRefused);
  check("aucune écriture après une lecture refusée", repository.calls.addReaction === 1);
  repository.setReadFailure(null);

  repository.setWriteFailure("insert refusé");
  const writeRefused = await service.toggleReaction("direct_message", "m4", "me", "\u2705");
  check("une écriture refusée remonte l'erreur", writeRefused.error === "insert refusé" && writeRefused.active === false, writeRefused);
  repository.setWriteFailure(null);

  // Erreur de suppression : l'état posé reste celui qui est vrai.
  repository.reactions.push({ id: "r9", target_type: "direct_message", target_id: "m5", user_id: "me", emoji: "\u2705" });
  repository.setWriteFailure("delete refusé");
  const deleteRefused = await service.toggleReaction("direct_message", "m5", "me", "\u2705");
  check("une suppression refusée laisse la réaction active", deleteRefused.active === true && deleteRefused.error === "delete refusé", deleteRefused);
  repository.setWriteFailure(null);

  // ── 3. Suppression d'un message ──────────────────────────────────────
  const deleted = await service.deleteMessage("m1");
  check("la suppression est déléguée à l'adaptateur", repository.calls.deleteMessage === 1);
  check("une suppression réussie ne rend pas d'erreur", deleted.error === null, deleted);

  repository.setWriteFailure("refus RLS");
  const deleteMessageRefused = await service.deleteMessage("m2");
  check("un refus de suppression se dit", deleteMessageRefused.error === "refus RLS", deleteMessageRefused);
  repository.setWriteFailure(null);

  // ── 4. Épingles ──────────────────────────────────────────────────────
  check("sans session, aucune épingle", (await service.fetchPinnedIds("direct_message", "")).size === 0);

  const pinned = await service.togglePin("direct_message", "m1", "me");
  check("un premier clic épingle", pinned.pinned === true && pinned.error === null, pinned);

  const pinnedIds = await service.fetchPinnedIds("direct_message", "me");
  check("l'épingle est relue pour son propriétaire", pinnedIds.has("m1"));

  const otherIds = await service.fetchPinnedIds("direct_message", "bob");
  check("l'épingle d'autrui n'est jamais relue", otherIds.size === 0);

  const unpinned = await service.togglePin("direct_message", "m1", "me");
  check("un second clic dépingle", unpinned.pinned === false && unpinned.error === null, unpinned);
  check("la liste se vide", (await service.fetchPinnedIds("direct_message", "me")).size === 0);

  const anonymousPin = await service.togglePin("direct_message", "m1", "");
  check("sans session, l'épingle est refusée", anonymousPin.pinned === false && anonymousPin.error === "Non connecté", anonymousPin);

  repository.setReadFailure("pin illisible");
  const pinReadRefused = await service.togglePin("direct_message", "m2", "me");
  check("une lecture d'épingle refusée remonte l'erreur", pinReadRefused.error === "pin illisible", pinReadRefused);
  repository.setReadFailure(null);

  if (failures.length > 0) {
    console.error("\n✗ Contrat des messages non tenu :");
    for (const failure of failures) console.error(`  · ${failure}`);
    console.error(`\n${passed} vérifications passées, ${failures.length} en échec.\n`);
    process.exit(1);
  }

  console.log(`${passed} vérification(s) passée(s), 0 échec(s).`);
  console.log("\n  ✓ Réactions, épingles et suppression tiennent leur contrat sans base");
}

void run();
