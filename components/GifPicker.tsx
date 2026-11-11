"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { searchGifs, type Gif, type GifProvider } from "@/lib/gifs";

/**
 * Choix d'un GIF pour une publication.
 *
 * La grille montre des vignettes, le clic retient le GIF pleine taille :
 * la vignette est légère à charger, le GIF publié est celui qu'on a vu.
 *
 * Trois états sont distincts et le disent : « pas configuré » (pas de
 * clé côté serveur), « injoignable » (le fournisseur ne répond pas), et
 * « aucun résultat » (la recherche est simplement vide). Les confondre
 * ferait chercher un problème réseau là où il manque une variable
 * d'environnement.
 */
export function GifPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (gif: Gif) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Gif[]>([]);
  const [provider, setProvider] = useState<GifProvider>("tenor");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // Anti-rebond : une requête par pause de frappe, pas par touche.
    const timer = setTimeout(() => {
      setState("loading");
      void searchGifs(query, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setResults(result.results);
          setProvider(result.provider);
          setState("ready");
          return;
        }
        setResults([]);
        setMessage(result.error);
        setConfigured(result.configured);
        setState("error");
      });
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  return (
    <Sheet open={open} onClose={onClose} title="Choisir un GIF">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Rechercher un GIF"
        placeholder="Chercher un GIF…"
        autoFocus
        className="mb-3 h-[var(--h-input)] w-full rounded-[var(--radius-input)]
          border border-line-3 bg-surface px-3.5 text-[14px] shadow-sh-1
          placeholder:text-chalk-4
          focus:shadow-[3px_3px_0_var(--color-signal)]"
      />

      {state === "loading" && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className="block h-24 mo-pulse rounded-[var(--radius-input)] bg-surface-2"
            />
          ))}
        </div>
      )}

      {state === "error" && (
        <div className="rounded-[var(--radius-input)] border border-line-2 bg-surface-2 px-3.5 py-3">
          <p className="text-[13px] font-semibold text-chalk">
            {configured ? "Les GIF sont indisponibles" : "Les GIF ne sont pas configurés"}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-chalk-3">
            {configured
              ? message
              : "Ajoute une clé TENOR_API_KEY (ou GIPHY_API_KEY) au fichier .env de l'installation, puis recharge la page."}
          </p>
        </div>
      )}

      {state === "ready" && results.length === 0 && (
        <p className="py-2 text-[13px] text-chalk-3">
          Aucun GIF pour cette recherche. Essaie un mot plus large.
        </p>
      )}

      {state === "ready" && results.length > 0 && (
        <>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {results.map((gif) => (
              <li key={gif.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(gif);
                    onClose();
                  }}
                  aria-label={`Choisir le GIF : ${gif.alt}`}
                  className="block w-full overflow-hidden rounded-[var(--radius-input)]
                    border border-line-2 bg-surface-2 transition-[border-color,transform]
                    duration-[var(--d-fast)] hover:border-signal active:translate-y-px"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={gif.preview}
                    alt=""
                    loading="lazy"
                    className="h-24 w-full object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-chalk-4">
            <span aria-hidden="true" className="mr-1 inline-flex">
              <Icon name="gif" size={12} />
            </span>
            GIF fournis par {provider === "tenor" ? "Tenor" : "Giphy"}.
          </p>
        </>
      )}
    </Sheet>
  );
}
