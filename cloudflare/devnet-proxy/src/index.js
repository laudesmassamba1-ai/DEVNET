/**
 * Seconde porte d'entrée vers DevNet.
 *
 * Certains réseaux bloquent les plages Vercel ou échouent sur son DNS.
 * Cloudflare sert alors de relais HTTPS : l'application reste inchangée,
 * les cookies de session restent sur le domaine du Worker et les API sont
 * relayées avec la même méthode et le même corps.
 *
 * Les redirections absolues vers Vercel sont ramenées sur le Worker pour
 * garder le visiteur sur le même domaine. La connexion par mot de passe et
 * la navigation normale fonctionnent ainsi de bout en bout.
 */

const ORIGIN = "https://devnet-brown.vercel.app";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const target = new URL(ORIGIN);
    target.pathname = incoming.pathname;
    target.search = incoming.search;

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("x-forwarded-host", incoming.host);

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    const upstream = await fetch(target, init);
    const outgoing = new Headers(upstream.headers);
    const location = outgoing.get("location");
    if (location?.startsWith(ORIGIN)) {
      outgoing.set("location", incoming.origin + location.slice(ORIGIN.length));
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outgoing,
    });
  },
};
