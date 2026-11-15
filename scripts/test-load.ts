/**
 * Petit test de charge reproductible.
 *
 * Il ne simule pas des utilisateurs complets : il mesure ce que le serveur
 * fait sous des navigations concurrentes, avec une page publique et une
 * sonde qui touche la base. C'est volontairement borné, car un test qui
 * martèle la production sans accord ne prouve rien de bon.
 *
 * Variables :
 *   LOAD_BASE_URL    défaut http://127.0.0.1:3000
 *   LOAD_PATH        défaut /login
 *   LOAD_REQUESTS    défaut 1000
 *   LOAD_CONCURRENCY défaut 100
 *
 * Exemple local :
 *   LOAD_BASE_URL=http://127.0.0.1:3127 npm run test:load
 */
const base = (process.env.LOAD_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const path = process.env.LOAD_PATH ?? "/login";
const total = Math.max(1, Number(process.env.LOAD_REQUESTS ?? 1000));
const concurrency = Math.max(1, Number(process.env.LOAD_CONCURRENCY ?? 100));

if (!/^https?:\/\//.test(base)) {
  console.error("LOAD_BASE_URL doit commencer par http:// ou https://");
  process.exit(2);
}

const url = new URL(path, base).href;
const latencies: number[] = [];
let failures = 0;
let next = 0;
const started = performance.now();

async function worker(): Promise<void> {
  for (;;) {
    const index = next++;
    if (index >= total) return;
    const at = performance.now();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "text/html" },
      });
      if (!response.ok) failures += 1;
      // Lire le corps compte : sans cela on mesurerait seulement les en-têtes.
      await response.arrayBuffer();
    } catch {
      failures += 1;
    } finally {
      latencies.push(performance.now() - at);
    }
  }
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function main(): Promise<void> {
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsed = performance.now() - started;
  const ok = total - failures;
  const rate = failures / total;
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const p99 = percentile(latencies, 0.99);
  const rps = ok / (elapsed / 1000);
  
  console.log(`charge ${url}`);
  console.log(`  requêtes        ${total} (concurrence ${concurrency})`);
  console.log(`  succès          ${ok}`);
  console.log(`  échecs          ${failures} (${(rate * 100).toFixed(2)} %)`);
  console.log(`  durée           ${(elapsed / 1000).toFixed(2)} s`);
  console.log(`  débit           ${rps.toFixed(1)} req/s`);
  console.log(`  latence p50     ${p50.toFixed(0)} ms`);
  console.log(`  latence p95     ${p95.toFixed(0)} ms`);
  console.log(`  latence p99     ${p99.toFixed(0)} ms`);
  
  if (failures > 0 || p95 > 2_000) {
    console.error("Seuil dépassé : échecs ou p95 > 2 000 ms.");
    process.exit(1);
  }
  
  
}

void main();
