/**
 * Création d'un compte par l'administration — mode réel, clé de service.
 *
 * ## Pourquoi cette route existe
 *
 * Insérer une ligne `users` pour quelqu'un d'autre est **interdit**, et
 * c'est la bonne politique (`users_insert with check (auth.uid() = id)`) :
 * une identité ne se pose pas depuis la session d'un tiers. Un
 * administrateur qui veut ouvrir un compte ne peut donc pas le faire avec
 * le client anonyme — ni écrire dans `auth.users`, qui n'est pas exposé
 * par PostgREST.
 *
 * La clé de service, elle, contourne les politiques de ligne. C'est
 * exactement pour ça qu'elle ne doit **jamais** partir au navigateur, et
 * pour ça que cette route n'est pas un simple relais : elle **vérifie
 * l'appelant avant** d'ouvrir la porte.
 *
 * ## L'ordre des contrôles
 *
 *  1. `SUPABASE_SERVICE_ROLE_KEY` absente → 503. La route ne devine pas,
 *     elle dit qu'elle n'est pas configurée. Un compte créé à moitié
 *     (ligne `users` sans `auth.users`) serait pire que pas de compte.
 *  2. L'appelant, lu depuis son cookie de session, doit porter
 *     `is_admin`. C'est la seule autorisation : le mot de passe est
 *     vérifié par Supabase Auth, pas ici.
 *  3. Forme des champs, puis création.
 *
 * La clé de service n'est **pas** `NEXT_PUBLIC_` : elle n'existe que dans
 * l'environnement du serveur, et le client ci-dessous est construit sans
 * persistance de session, exprès — il ne doit jamais s'approprier
 * l'identité du compte qu'il crée.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseUrl } from "@/lib/backend";
import { getOrCreateServerClient } from "@/lib/supabase/server";

const MIN_PASSWORD = 6;

interface Body {
  email?: unknown;
  prenom?: unknown;
  pseudo?: unknown;
  password?: unknown;
  account_type?: unknown;
  is_admin?: unknown;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(request: NextRequest) {
  const url = getSupabaseUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return NextResponse.json(
      {
        error:
          "création de compte indisponible : renseigne SUPABASE_SERVICE_ROLE_KEY " +
          "côté serveur (jamais préfixée NEXT_PUBLIC_)",
      },
      { status: 503 },
    );
  }

  // 1. Qui appelle ? Le client serveur lit le cookie de session.
  //
  // Le registre rend `unknown` (c'est un tampon sans dépendance serveur,
  // voir `lib/supabase/server-registry.ts`) : la seule chose qu'on sache
  // de lui, c'est qu'il lit les cookies de la requête.
  const caller = (await getOrCreateServerClient()) as SupabaseClient | null;
  if (!caller) {
    return NextResponse.json({ error: "aucune session serveur" }, { status: 503 });
  }

  const { data: auth } = await caller.auth.getUser();
  const callerId = auth?.user?.id;
  if (!callerId) {
    return NextResponse.json({ error: "session requise" }, { status: 401 });
  }

  // 2. Le rôle se lit en base, pas dans le jeton : un jeton reste valide
  //    après un retrait de rôle, et il ne doit pas rouvrir cette porte.
  const { data: callerRow } = await caller
    .from("users")
    .select("is_admin")
    .eq("id", callerId)
    .maybeSingle();

  if (callerRow?.is_admin !== true) {
    return NextResponse.json(
      { error: "réservé à l'administration" },
      { status: 403 },
    );
  }

  // 3. Forme des champs.
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "corps illisible" }, { status: 400 });
  }

  const email = str(body.email).toLowerCase();
  const prenom = str(body.prenom);
  const pseudoInput = str(body.pseudo);
  const password = typeof body.password === "string" ? body.password : "";
  const isAdmin = body.is_admin === true;
  const accountType =
    body.account_type === "professional" ? "professional" : "student";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return NextResponse.json({ error: "adresse email invalide" }, { status: 400 });
  }
  if (!prenom) {
    return NextResponse.json({ error: "le prénom est requis" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `mot de passe : ${MIN_PASSWORD} caractères au moins` },
      { status: 400 },
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // `email_confirm` : un compte ouvert par l'administration est un compte
  // ouvert pour quelqu'un qui est déjà identifié — on ne lui demande pas
  // de confirmer par courriel ce qu'un administrateur vient d'affirmer.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      prenom,
      pseudo: pseudoInput || prenom,
      account_type: accountType,
    },
  });

  if (createError || !created?.user) {
    const duplicate = /already|registered|exists/i.test(createError?.message ?? "");
    return NextResponse.json(
      {
        error: duplicate
          ? "un compte existe déjà avec cette adresse"
          : (createError?.message ?? "création refusée"),
      },
      { status: duplicate ? 409 : 502 },
    );
  }

  const userId = created.user.id;

  // `handle_new_user()` a créé la ligne `users`. On pose le rôle dans la
  // même foulée ; si cette écriture échouait, le compte existerait sans
  // le rôle — d'où le contrôle des lignes rendues.
  const patch = isAdmin
    ? { is_admin: true, verified: true, verification_status: "acceptee" }
    : { is_admin: false };

  const { data: updated, error: updateError } = await admin
    .from("users")
    .update(patch)
    .eq("id", userId)
    .select("id, pseudo");

  if (updateError || !updated || updated.length === 0) {
    return NextResponse.json(
      {
        error:
          "compte créé, mais le rôle n'a pas pu être posé — " +
          (updateError?.message ?? "ligne introuvable"),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    account: { id: userId, email, pseudo: updated[0].pseudo, is_admin: isAdmin },
  });
}
