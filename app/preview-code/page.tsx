/**
 * Banc d'essai visuel de la coloration syntaxique.
 *
 *   npm run dev  puis  http://localhost:3000/preview-code
 *
 * Montre le même extrait dans les deux variantes et sur plusieurs langages,
 * pour juger d'un coup d'œil la cohérence de la palette. Cette page n'est
 * pas un routeur : elle n'apparaît pas dans la navigation.
 */
"use client";

import { CodeBlock } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";

const PYTHON = `# Normaliser AVANT de découper : sinon les scores mentent.
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

scaler = StandardScaler()
X = scaler.fit_transform(X)          # avant le split, pas après

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)`;

const SQL = `-- Un étudiant ne peut pas démarrer une conversation avec un pro.
select exists (
  select 1 from public.users
  where id = :recipient and account_type = 'professional'
) is not true
or exists (
  select 1 from public.users where id = :sender and account_type = 'professional'
);`;

const TS = `export function FollowButton({ following, onToggle }: Props) {
  const [busy, setBusy] = useState(false);
  // Le décompte vient de la table, jamais d&apos;un cache client.
  return following ? null : (
    <button disabled={busy} onClick={() => setBusy(true)}>
      Suivre
    </button>
  );
}`;

const RUST = `fn main() {
    let mut v: Vec<String> = Vec::new();
    v.push("réseau".to_string());
    println!("{N} éléments", v.len());
}`;

export default function PreviewCode() {
  return (
    <main className="mo-rise mx-auto max-w-[520px] px-(--gutter) py-6">
      <h1 className="label-micro mb-1 text-chalk-3">DevNet · banc d&apos;essai</h1>
      <h2 className="font-display mb-5 text-(--text-display-l) font-bold
        tracking-[-0.03em]">
        Coloration syntaxique
      </h2>

      <h3 className="label mb-3 text-chalk">Variante « encre sur papier »</h3>
      <CodeBlock code={PYTHON} lang="Python" variant="paper" lineNumbers />

      <h3 className="label mb-3 mt-8 text-chalk">Variante « terminal »</h3>
      <CodeBlock code={PYTHON} lang="Python" variant="terminal" lineNumbers />

      <h3 className="label mb-3 mt-8 text-chalk">SQL</h3>
      <CodeBlock code={SQL} lang="SQL" variant="paper" />

      <h3 className="label mb-3 mt-8 text-chalk">TypeScript</h3>
      <CodeBlock code={TS} lang="TypeScript" variant="paper" lineNumbers />

      <h3 className="label mb-3 mt-8 text-chalk">Rust</h3>
      <CodeBlock code={RUST} lang="Rust" variant="terminal" />

      <h3 className="label mb-3 mt-8 text-chalk">Jeu d&apos;icônes</h3>
      <div className="flex flex-wrap gap-2 rounded-(--radius-card) border
        border-line-3 bg-surface p-4 shadow-sh-1">
        {(
          [
            "feed", "groups", "messages", "profile", "search", "notifications",
            "like", "comment", "share", "repost", "bookmark", "follow",
            "code", "copy", "check", "check-double", "star", "fork", "link",
            "verified", "globe", "lock", "trash", "edit", "plus", "send",
          ] as const
        ).map((n) => (
          <span key={n}
            title={n}
            className="flex size-8.5 items-center justify-center
              border-(--bw-thin) border-line-2 text-chalk-2">
            <Icon name={n} size={16} />
          </span>
        ))}
      </div>
    </main>
  );
}