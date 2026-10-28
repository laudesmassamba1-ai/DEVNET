import { supabase } from "@/lib/supabase/client";
import { asVerificationStatus, type VerificationStatus } from "@/lib/verification";
import type { AvatarColor } from "@/lib/types";

/**
 * Ce que la demande de vérification **écrit**.
 *
 * Il n'y a pas de table `verification_requests` : la demande vit sur la
 * ligne du compte (`verification_status`, `verification_note`), exactement
 * comme `account_type`. Une table à part aurait exigé une clé étrangère,
 * une politique de lecture et un arbitrage des doublons — alors qu'on ne
 * veut jamais d'une seconde demande en parallèle d'une première.
 *
 * Les deux colonnes gardées (`verified`, `is_admin`) ne sont pas ici :
 * elles ne s'écrivent que dans `decideVerification`, et la base refuse
 * ailleurs (migration 037) comme le rejoue la démo.
 */

/** Colonnes qu'une demande ou un profil lit sur `users`. */
const REQUEST_FIELDS =
  "id, prenom, pseudo, avatar_color, account_type, verified, " +
  "is_admin, verification_status, verification_note, created_at";

export interface VerificationRequest {
  id: string;
  prenom: string;
  pseudo: string;
  avatar_color: AvatarColor;
  account_type: string;
  verified: boolean;
  is_admin: boolean;
  /** Toujours `attente` : c'est le filtre de lecture. */
  verification_status: VerificationStatus;
  verification_note: string;
  created_at: string;
}

/** Traduit la ligne brute en demande affichable. */
function toRequest(row: Record<string, unknown>): VerificationRequest {
  return {
    id: String(row.id ?? ""),
    prenom: String(row.prenom ?? ""),
    pseudo: String(row.pseudo ?? ""),
    avatar_color: String(row.avatar_color ?? "av-sage") as AvatarColor,
    account_type: String(row.account_type ?? "student"),
    verified: Boolean(row.verified),
    is_admin: Boolean(row.is_admin),
    verification_status: asVerificationStatus(row.verification_status),
    verification_note: String(row.verification_note ?? ""),
    created_at: String(row.created_at ?? ""),
  };
}

/**
 * Exige que l'écriture ait **effectivement** touché une ligne.
 *
 * C'est la contrepartie du comportement des politiques de ligne : elles ne
 * refusent pas, elles **retirent la ligne** des lignes atteignables. Un
 * `update` sur la ligne d'un autre — ou hors session — revient donc **sans
 * erreur**, avec zéro ligne touchée. Postgres et la démo font pareil.
 *
 * Sans cette lecture, `withdrawVerification` rendrait `void` après n'avoir
 * rien retiré, et l'écran annoncerait « Demande retirée ». C'est la seule
 * façon de distinguer « c'est écrit » de « ça n'a rien atteint » : le code
 * retour ne le dit pas — les lignes renvoyées, si.
 *
 * C'est aussi pour ça que chaque écriture demande `.select("id")` : sans
 * représentation, PostgREST rend `data: null` quel que soit le nombre de
 * lignes touchées, et la vérification serait aveugle en production.
 */
function requireTouched(data: unknown, action: string): void {
  if (Array.isArray(data) && data.length > 0) return;
  throw new Error(
    `écriture sans effet (${action}) — le compte n'existe pas, ou n'est pas à portée`,
  );
}

/**
 * Dépose sa demande de vérification.
 *
 * `note` est le seul champ libre : c'est ce que l'administration lit pour
 * trancher (adresse pro, lien GitHub, communauté portée). Une demande
 * déjà en cours est **remplacée**, pas dupliquée — la colonne ne peut pas
 * en porter deux.
 */
export async function requestVerification(
  userId: string,
  note: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("users")
    .update({ verification_status: "attente", verification_note: note })
    .eq("id", userId)
    .select("id");
  if (error) throw error;
  requireTouched(data, "demande de vérification");
}

/** Retire sa demande — on peut changer d'avis avant la décision. */
export async function withdrawVerification(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("users")
    .update({ verification_status: "none", verification_note: "" })
    .eq("id", userId)
    .select("id");
  if (error) throw error;
  requireTouched(data, "retrait de la demande");
}

/**
 * La file d'attente, pour un compte d'administration.
 *
 * Le tri est fait ici, pas en base : `order` sur une colonne que la démo
 * ne classe pas toujours pareil, et la file tient en une dizaine de lignes.
 * Les plus anciennes d'abord — une demande ne devrait pas vieillir parce
 * qu'un nouveau membre est arrivé.
 */
export async function fetchVerificationQueue(): Promise<VerificationRequest[]> {
  const { data, error } = await supabase
    .from("users")
    .select(REQUEST_FIELDS)
    .eq("verification_status", "attente")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(toRequest);
}

/**
 * La décision : accepter, ou refuser.
 *
 * Accepter pose `verified = true` **et** le statut d'un coup, parce que
 * deux écritures successives laisseraient un instant où le compte est
 * vérifié mais où la file dit encore « attente ». Refuser ne touche jamais
 * `verified` — déjà vérifier une fois, un refus ne retire pas le cachet.
 *
 * C'est le seul endroit du module qui écrit une colonne gardée : la base
 * le vérifie (déclencheur 037), et la démo le rejoue colonne par colonne.
 * Un appelant non administrateur échoue donc ici même, jamais en silence.
 */
export async function decideVerification(
  userId: string,
  accept: boolean,
): Promise<void> {
  const { data, error } = await supabase
    .from("users")
    .update(
      accept
        ? { verified: true, verification_status: "acceptee" }
        : { verification_status: "refusee" },
    )
    .eq("id", userId)
    .select("id");
  if (error) throw error;
  requireTouched(data, accept ? "acceptation" : "refus");
}

/** Retire le cachet — c'est une sanction, pas un refus de demande. */
export async function revokeVerification(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("users")
    .update({ verified: false, verification_status: "none", verification_note: "" })
    .eq("id", userId)
    .select("id");
  if (error) throw error;
  requireTouched(data, "retrait du cachet");
}
