/**
 * Création d'un compte par l'administration.
 *
 * Le compte est créé par le service d'authentification (empreinte scrypt +
 * ligne `auth.users`, qui déclenche `handle_new_user()`), puis le rôle est
 * posé par une requête `withUser` : PostgreSQL applique `users_admin_update`
 * et le déclencheur `guard_account_roles`, pas une clé de service.
 *
 * La session ouverte par `signUp` est immédiatement révoquée : cette route
 * crée un compte pour quelqu'un d'autre, elle ne doit pas s'approprier son
 * identité ni laisser un jeton valide.
 */
import { NextRequest, NextResponse } from "next/server";
import { AuthRepositoryError } from "@/modules/auth/ports/auth-repository";
import { MIN_PASSWORD_LENGTH } from "@/modules/auth";
import { currentUserId } from "@/lib/api/server";
import { getServerAuthService } from "@/platform/auth-container";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

interface Body {
  email?: unknown;
  prenom?: unknown;
  pseudo?: unknown;
  password?: unknown;
  account_type?: unknown;
  is_admin?: unknown;
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const noStore = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  let callerId: string | null;
  try {
    callerId = await currentUserId();
  } catch (error) {
    console.error("[admin] session lookup failed", error);
    return NextResponse.json(
      { error: "administration indisponible" },
      { status: 503, headers: noStore },
    );
  }
  if (!callerId) {
    return NextResponse.json(
      { error: "session requise" },
      { status: 401, headers: noStore },
    );
  }

  try {
    const callerRows = await withUser(callerId, (query) =>
      query<{ is_admin: boolean }>(
        "select is_admin from public.users where id = $1 limit 1",
        [callerId],
      ),
    );
    if (callerRows[0]?.is_admin !== true) {
      return NextResponse.json(
        { error: "réservé à l'administration" },
        { status: 403, headers: noStore },
      );
    }
  } catch (error) {
    console.error("[admin] role lookup failed", error);
    return NextResponse.json(
      { error: "rôle indisponible" },
      { status: 503, headers: noStore },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "corps illisible" },
      { status: 400, headers: noStore },
    );
  }

  const email = str(body.email).toLowerCase();
  const prenom = str(body.prenom);
  const pseudoInput = str(body.pseudo);
  const password = typeof body.password === "string" ? body.password : "";
  const isAdmin = body.is_admin === true;
  const accountType =
    body.account_type === "professional" ? "professional" : "student";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return NextResponse.json(
      { error: "adresse email invalide" },
      { status: 400, headers: noStore },
    );
  }
  if (!prenom) {
    return NextResponse.json(
      { error: "le prénom est requis" },
      { status: 400, headers: noStore },
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `mot de passe : ${MIN_PASSWORD_LENGTH} caractères au moins` },
      { status: 400, headers: noStore },
    );
  }

  const auth = getServerAuthService();
  try {
    const created = await auth.signUp({
      email,
      password,
      metadata: {
        prenom,
        pseudo: pseudoInput || prenom,
        account_type: accountType,
      },
      userAgent: request.headers.get("user-agent"),
    });

    if (!created.ok) {
      return NextResponse.json(
        {
          error:
            created.reason === "email-taken"
              ? "un compte existe déjà avec cette adresse"
              : `mot de passe : ${MIN_PASSWORD_LENGTH} caractères au moins`,
        },
        { status: created.reason === "email-taken" ? 409 : 400, headers: noStore },
      );
    }

    // Le jeton n'est jamais rendu au navigateur de l'administrateur.
    await auth.signOut(created.token);

    const verified = isAdmin;
    const verificationStatus = isAdmin ? "acceptee" : "none";

    const updated = await withUser(callerId, (query) =>
      query<{ id: string; pseudo: string }>(
        `update public.users
            set is_admin = $2,
                verified = $3,
                verification_status = $4
          where id = $1
          returning id::text as id, pseudo`,
        [created.userId, isAdmin, verified, verificationStatus],
      ),
    );

    if (updated.length === 0) {
      return NextResponse.json(
        { error: "compte créé, mais le rôle n'a pas pu être posé" },
        { status: 500, headers: noStore },
      );
    }

    return NextResponse.json({
      account: {
        id: created.userId,
        email: created.email,
        pseudo: updated[0].pseudo,
        is_admin: isAdmin,
      },
    });
  } catch (error) {
    if (error instanceof AuthRepositoryError) {
      return NextResponse.json(
        { error: "création indisponible. Réessaie dans un instant." },
        { status: 503, headers: noStore },
      );
    }
    console.error("[admin] création de compte impossible", error);
    return NextResponse.json(
      { error: "création impossible" },
      { status: 500, headers: noStore },
    );
  }
}
