"use client";

import { Motion } from "./Motion";

/**
 * L'accusé de lecture, sous un message qu'on a écrit.
 *
 * ## Trois glyphes, pas deux
 *
 * WhatsApp n'en montre que deux (`✓` envoyé, `✓✓` lu). On en montre un
 * troisième — `✓✓` **en ambre** — pour le dernier message de la
 * conversation. La raison n'est pas décorative : c'est ce qui permet à
 * l'œil de survoler la liste et de voir « où on en est » sans lire les
 * 200 messages du bas. Un double tick ambré est un **point de contrôle**,
 * exactement comme le curseur clignotant dans une ligne de commande.
 *
 * ## Ce qui n'est pas montré
 *
 * L'**heure de lecture**. Elle existe, elle est stockée, et on ne
 * l'affiche pas : WhatsApp la montre et tout le monde s'en plaint,
 * parce qu'elle transforme une conversation en registre. Un `✓✓` ne
 * demande rien.
 *
 * ## Pourquoi le glyphe est un texte, pas une icône
 *
 * `✓` et `✓✓` sont des caractères Unicode, pas des dessins : ils
 * inherits `currentColor`, se placent au rythme de la ligne, et
 * s-annulent si la police n'a pas le glyphe. Une icône SVG aurait un
 * chemin à maintenir pour redessiner un point.
 */
export function Receipt({
  state,
  isLatest = false,
}: {
  state: "envoye" | "lu";
  /** Dernier message de la conversation : c'est lui qui s'allume. */
  isLatest?: boolean;
}) {
  // Le dernier message seulement porte la couleur : c'est lui qui est
  // lisible maintenant, et un ambre répété sur toute la conversation
  // dirait « tout est lu » sans distinction.
  const accent = state === "lu" && isLatest;

  return (
    <Motion
      key={`${state}-${accent}`}
      as="span"
      role="pop"
      delay={0}
      aria-label={state === "lu" ? "Lu" : "Envoyé"}
      attrs={{ title: state === "lu" ? "Lu" : "Envoyé" }}
      className={`ml-1.5 inline-block font-mono text-12 leading-none
        transition-colors duration-(--d-fast)
        ${accent ? "text-signal" : "text-chalk-4"}`}
    >
      {state === "lu" ? "✓✓" : "✓"}
    </Motion>
  );
}

/**
 * « Lu par 4 sur 10 » — la forme d'un canal.
 *
 * On ne met **pas** de double tick dans un groupe : il y signifierait
 * « lu par quelqu'un », ce que personne ne croit en voyant un double
 * tick. La fraction est la seule forme honnête, et elle est plus
 * informative : elle dit aussi combien n'ont **pas** lu.
 */
export function GroupReceipt({ count, total }: { count: number; total: number }) {
  if (count === 0 || total === 0) return null;

  return (
    <span
      className="ml-1.5 font-mono text-12 text-chalk-4"
      title={`Lu par ${count} sur ${total}`}
    >
      Lu par {count}/{total}
    </span>
  );
}