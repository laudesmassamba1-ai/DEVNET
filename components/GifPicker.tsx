"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { isAllowedGifUrl, searchGifs, type Gif, type GifProvider } from "@/lib/gifs";
import { focusOnMount } from "@/lib/focus-on-mount";

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
  const [directUrl, setDirectUrl] = useState("");

  function pickDirect() {
    const url = directUrl.trim();
    if (!isAllowedGifUrl(url)) return;
    onPick({
      id: url.slice(-24),
      url,
      preview: url,
      alt: "GIF",
      width: 0,
      height: 0,
    });
    setDirectUrl("");
    onClose();
  }

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
    <Sheet open={open} onClose={onClose} title="Choisir un GIF" stacked>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Rechercher un GIF"
        placeholder="Chercher un GIF…"
        ref={focusOnMount}
        className="mb-3 h-(--h-input) w-full rounded-(--radius-input)
          border border-line-3 bg-surface px-3.5 text-base shadow-sh-1
          placeholder:text-chalk-4
          focus:shadow-[3px_3px_0_var(--color-signal)]"
      />

      {state === "loading" && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className="block h-24 mo-pulse rounded-(--radius-input) bg-surface-2"
            />
          ))}
        </div>
      )}

      {state === "error" && (
        <div className="rounded-(--radius-input) border border-line-2 bg-surface-2 px-3.5 py-3">
          <p className="text-13 font-semibold text-chalk">
            {configured ? "La recherche de GIF est indisponible" : "Recherche de GIF non configurée"}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-chalk-3">
            {configured
              ? message
              : "Aucune clé de recherche (Tenor/Giphy) n'est définie. Tu peux quand même coller l'adresse d'un GIF hébergé sur Tenor ou Giphy ci-dessous."}
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={directUrl}
              onChange={(e) => setDirectUrl(e.target.value)}
              aria-label="Adresse du GIF"
              placeholder="https://media.tenor.com/…"
              className="h-10 min-w-0 flex-1 rounded-(--radius-input) border border-line-3
                bg-surface px-3 text-base placeholder:text-chalk-4"
            />
            <button
              type="button"
              onClick={pickDirect}
              disabled={!isAllowedGifUrl(directUrl.trim())}
              className="h-10 shrink-0 rounded-(--radius-input) border border-signal bg-signal
                px-3 font-mono text-12 font-bold uppercase tracking-wide text-void disabled:opacity-40"
            >
              Utiliser
            </button>
          </div>
        </div>
      )}

      {state === "ready" && results.length === 0 && (
        <p className="py-2 text-13 text-chalk-3">
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
                  className="block w-full overflow-hidden rounded-(--radius-input)
                    border border-line-2 bg-surface-2 transition-[border-color,transform]
                    duration-(--d-fast) hover:border-signal active:translate-y-px"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={gif.preview}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-24 w-full object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-12 text-chalk-4">
            <span aria-hidden="true" className="mr-1 inline-flex">
              <Icon name="gif" size={12} />
            </span>
            GIF fournis par {provider === "tenor" ? "Tenor" : "Giphy"}.
          </p>
        </>
      )}

      <div className="mt-3 border-t border-line pt-3">
        <p className="mb-1.5 text-12 text-chalk-3">
          Colle l&apos;adresse d&apos;un GIF (Tenor ou Giphy) pour l&apos;envoyer directement
        </p>
        <div className="flex gap-2">
          <input
            value={directUrl}
            onChange={(e) => setDirectUrl(e.target.value)}
            aria-label="Adresse directe du GIF"
            placeholder="https://media.tenor.com/…"
            className="h-10 min-w-0 flex-1 rounded-(--radius-input) border border-line-3
              bg-surface px-3 text-base placeholder:text-chalk-4"
          />
          <button
            type="button"
            onClick={pickDirect}
            disabled={!isAllowedGifUrl(directUrl.trim())}
            className="h-10 shrink-0 rounded-(--radius-input) border border-signal bg-signal
              px-3 font-mono text-12 font-bold uppercase tracking-wide text-void disabled:opacity-40"
          >
            Utiliser
          </button>
        </div>
      </div>
    </Sheet>
  );
}
