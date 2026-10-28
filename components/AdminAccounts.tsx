"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar, EmptyState, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Stagger } from "@/components/Motion";
import { useToast } from "@/components/Toast";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import {
  createAccount,
  fetchAccounts,
  setAdminRole,
  validateNewAccount,
  type AccountPage,
  type AdminAccount,
  type NewAccount,
} from "@/lib/admin-accounts";
import { VERIFY_OFFICIAL } from "@/lib/verification";
import type { AccountType } from "@/lib/types";

/**
 * L'onglet « Comptes » de `/admin` : l'annuaire, le rôle, et l'ouverture
 * de comptes.
 *
 * ## Sur quoi l'écran a le droit de s'appuyer
 *
 * Pas sur `profile.is_admin` : le composant ne *décide* rien. Les trois
 * écritures — promouvoir, retirer, créer — passent par
 * `lib/admin-accounts.ts`, et c'est la base qui tranche. Un appelant sans
 * le rôle reçoit un refus du déclencheur `037`, pas un `if` d'écran qui
 * aurait pu être contourné. Le `selfId` n'est là que pour interdire à un
 * administrateur de se retirer son propre rôle par mégarde.
 *
 * ## Relecture, jamais prédiction
 *
 * Après chaque écriture, on **relit** l'annuaire. La ligne affichée est
 * donc celle que la base contient, pas celle qu'on croit avoir écrite —
 * c'est la seule façon de voir un refus silencieux à l'écran.
 */
export function AdminAccounts({ selfId }: { selfId: string }) {
  const toast = useToast();

  const [page, setPage] = useState<AccountPage | null>(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");

  const [email, setEmail] = useState("");
  const [prenom, setPrenom] = useState("");
  const [pseudo, setPseudo] = useState("");
  const [password, setPassword] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("student");
  const [giveRole, setGiveRole] = useState(true);

  const load = useCallback(async () => {
    try {
      setPage(await fetchAccounts(search));
    } catch {
      setPage({ accounts: [], capped: false });
    }
  }, [search]);

  // La recherche est temporisée : on ne pose pas une requête par frappe.
  // Aucun état n'est écrit ici — la lecture part dans le minuteur, donc
  // pas de rendu en cascade.
  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 220);
    return () => clearTimeout(timer);
  }, [load]);

  async function toggleRole(account: AdminAccount) {
    if (busyId) return;
    setBusyId(account.id);
    try {
      await setAdminRole(account.id, !account.is_admin, selfId);
      await load();
      toast(
        account.is_admin
          ? `${account.prenom} n'est plus administrateur`
          : `${account.prenom} est administrateur`,
        "ok",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Changement refusé", "err");
    } finally {
      setBusyId(null);
    }
  }

  async function submitNew() {
    if (creating) return;
    setFormError("");

    const input: NewAccount = {
      email,
      prenom,
      pseudo,
      password,
      account_type: accountType,
      is_admin: giveRole,
    };

    const invalid = validateNewAccount(input);
    if (invalid) {
      setFormError(invalid);
      return;
    }

    setCreating(true);
    try {
      const { error } = await createAccount(input);
      if (error) {
        setFormError(error);
        return;
      }
      // Le compte créé peut ne pas tomber dans le filtre courant : on
      // efface la recherche pour le voir arriver dans la liste.
      setSearch("");
      await load();
      toast(`${prenom} : compte ouvert`, "ok");
      setEmail("");
      setPrenom("");
      setPseudo("");
      setPassword("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "création impossible");
    } finally {
      setCreating(false);
    }
  }

  const inputCls =
    "h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 " +
    "bg-surface px-3.5 text-[14px] shadow-sh-1 outline-none transition-[transform,box-shadow] " +
    "placeholder:text-chalk-4 focus:-translate-x-px focus:-translate-y-px " +
    "focus:shadow-[3px_3px_0_#FF8A3D]";

  return (
    <div>
      {/* ── Ouverture de compte ─────────────────────────────────────── */}
      <section className="border-b border-line-1 py-5">
        <h2 className="font-display text-[1.05rem] font-bold tracking-[-0.02em] text-chalk">
          Ouvrir un compte
        </h2>
        <p className="mt-1 font-mono text-[11px] leading-relaxed text-chalk-4">
          Le compte est créé confirmé : son adresse est tenue pour vraie parce
          qu&apos;un administrateur la pose. En mode démo, l&apos;insertion se fait
          localement.
        </p>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="new-email" className="label mb-1.5 block text-chalk">
              Adresse email
            </label>
            <input
              id="new-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="chef@devnet.africa"
              className={inputCls}
            />
          </div>

          <div>
            <label htmlFor="new-prenom" className="label mb-1.5 block text-chalk">
              Prénom
            </label>
            <input
              id="new-prenom"
              value={prenom}
              onChange={(e) => setPrenom(e.target.value)}
              placeholder="Nadia"
              className={inputCls}
            />
          </div>

          <div>
            <label htmlFor="new-pseudo" className="label mb-1.5 block text-chalk">
              Pseudo <span className="text-chalk-4">— dérivé du prénom si vide</span>
            </label>
            <input
              id="new-pseudo"
              value={pseudo}
              onChange={(e) => setPseudo(e.target.value)}
              placeholder="nadia"
              className={inputCls}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="new-password" className="label mb-1.5 block text-chalk">
              Mot de passe
            </label>
            <div className="flex gap-2">
              <input
                id="new-password"
                type="text"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="six caractères au moins"
                className={`${inputCls} font-mono`}
              />
              <button
                type="button"
                onClick={() => setPassword(generatePassword())}
                className="mo-press inline-flex h-[var(--h-input)] shrink-0 items-center
                  gap-1.5 rounded-[var(--radius-input)] border border-line-3 px-3
                  font-mono text-[11px] font-bold uppercase tracking-[0.1em]
                  text-chalk-3 hover:text-chalk"
              >
                <Icon name="spark" size={12} />
                tirer
              </button>
            </div>
          </div>

          <div>
            <span className="label mb-1.5 block text-chalk">Type de compte</span>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["student", "Étudiant"],
                ["professional", "Professionnel"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={accountType === value}
                  onClick={() => setAccountType(value)}
                  className={`h-[var(--h-input)] rounded-[var(--radius-input)] border
                    text-[12.5px] font-bold transition-[background-color,border-color]
                    duration-[var(--d-fast)] ${accountType === value
                      ? "border-signal bg-signal/10 text-chalk"
                      : "border-line-2 bg-surface hover:border-line-3 hover:bg-surface-2"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label mb-1.5 block text-chalk">Rôle</span>
            <button
              type="button"
              aria-pressed={giveRole}
              onClick={() => setGiveRole((v) => !v)}
              className={`flex h-[var(--h-input)] w-full items-center justify-center gap-2
                rounded-[var(--radius-input)] border text-[12.5px] font-bold
                transition-[background-color,border-color] duration-[var(--d-fast)] ${giveRole
                  ? "border-signal bg-signal/10 text-chalk"
                  : "border-line-2 bg-surface text-chalk-3 hover:border-line-3"}`}
            >
              <Icon name="profile" size={14} />
              {giveRole ? "Administrateur" : "Membre ordinaire"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={creating}
            onClick={() => void submitNew()}
            className="mo-press inline-flex items-center gap-1.5 rounded-[var(--radius-chip)]
              border border-signal bg-signal/10 px-3.5 py-2 font-mono text-[11px]
              font-bold uppercase tracking-[0.1em] text-signal disabled:opacity-40"
          >
            <Icon name="plus" size={12} strokeWidth={2.4} />
            {creating ? "création…" : "créer le compte"}
          </button>

          <p className="font-mono text-[11px] text-chalk-4">
            {giveRole
              ? "le compte portera le cachet de base et la file des demandes lui sera ouverte"
              : "le compte s'ouvrira comme un membre ordinaire"}
          </p>
        </div>

        {formError && (
          <p className="mt-3 border-l-2 border-danger pl-2.5 font-mono text-[11.5px] text-danger">
            {formError}
          </p>
        )}
      </section>

      {/* ── Annuaire ────────────────────────────────────────────────── */}
      <section className="pt-5">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-display text-[1.05rem] font-bold tracking-[-0.02em] text-chalk">
            Comptes
          </h2>
          {page && (
            <span className="font-mono text-[11px] text-chalk-4">
              {page.accounts.length} ligne{page.accounts.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-chalk-4">
              <Icon name="search" size={14} />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="pseudo, prénom ou email"
              className={`${inputCls} pl-9`}
            />
          </div>
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="mo-press inline-flex h-[var(--h-input)] items-center gap-1.5
                rounded-[var(--radius-input)] border border-line-3 px-3 font-mono
                text-[11px] font-bold uppercase tracking-[0.1em] text-chalk-3"
            >
              <Icon name="close" size={12} />
              effacer
            </button>
          )}
        </div>

        {page === null && <Loading label="Lecture de l'annuaire" />}

        {page !== null && page.accounts.length === 0 && (
          <div className="py-6">
            <EmptyState title="Aucun compte" />
            <p className="mt-3 text-center font-mono text-[11.5px] text-chalk-4">
              {search ? "La recherche ne rend rien." : "L'annuaire est vide."}
            </p>
          </div>
        )}

        {page !== null &&
          page.accounts.map((a, i) => (
            <Stagger
              key={a.id}
              index={Math.min(i, 12)}
              className="border-b border-line-1 py-3.5 last:border-b-0"
            >
              <div className="flex items-start gap-3">
                <Avatar name={a.prenom} color={a.avatar_color} size="md" />

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-[13.5px] font-bold text-chalk">{a.prenom}</span>
                    {a.is_admin && <VerifiedBadge tier={VERIFY_OFFICIAL} size="inline" />}
                    {!a.is_admin && a.verified && (
                      <VerifiedBadge size="inline" />
                    )}
                  </p>
                  <p className="truncate font-mono text-[11px] text-chalk-4">
                    @{a.pseudo} · {a.email}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="label-micro text-chalk-4">
                      {a.account_type === "professional" ? "pro" : "étudiant"}
                    </span>
                    {a.is_admin && (
                      <span className="label-micro text-signal">administrateur</span>
                    )}
                    {a.verification_status === "attente" && (
                      <span className="label-micro text-warn">demande en attente</span>
                    )}
                  </p>
                </div>

                <div className="shrink-0">
                  {a.id === selfId ? (
                    <span className="font-mono text-[10.5px] text-chalk-4">toi</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === a.id}
                      onClick={() => void toggleRole(a)}
                      className={`mo-press inline-flex items-center gap-1.5 rounded-[var(--radius-chip)]
                        border px-3 py-1.5 font-mono text-[10.5px] font-bold uppercase
                        tracking-[0.1em] disabled:opacity-40 ${a.is_admin
                          ? "border-danger bg-danger/8 text-danger"
                          : "border-line-3 text-chalk-3 hover:border-signal hover:text-signal"}`}
                    >
                      <Icon name={a.is_admin ? "lock" : "follow"} size={11} strokeWidth={2.4} />
                      {a.is_admin ? "retirer" : "nommer admin"}
                    </button>
                  )}
                </div>
              </div>
            </Stagger>
          ))}

        {page?.capped && (
          <p className="mt-3 border-l-2 border-warn pl-2.5 font-mono text-[11px] text-warn">
            Lecture plafonnée : la liste s&apos;arrête, ce n&apos;est pas tout
            l&apos;annuaire. Affine la recherche.
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * Mot de passe tiré au sort — lisible à voix haute, pas un bloc de
 * symboles : un administrateur va le transmettre à quelqu'un. On écarte
 * les caractères qui se confondent (l/1, O/0).
 */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = new Uint32Array(12);
  globalThis.crypto?.getRandomValues(bytes);
  for (let i = 0; i < 12; i += 1) {
    const n = bytes[i] ?? Math.floor(Math.random() * 0xffffffff);
    out += alphabet[n % alphabet.length];
  }
  return out;
}
