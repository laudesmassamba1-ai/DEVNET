/**
 * Métriques applicatives minimales.
 *
 * Le projet n’a pas encore de collecteur (Prometheus, Axiom…). En attendant,
 * chaque événement part sur **une seule ligne JSON** dans les logs serveur :
 * un log drain Vercel peut la compter sans parseur spécifique.
 *
 * Format : `[metric] {"name":"…","value":1,"tags":{…}}`
 */
export type MetricTags = Record<string, string | number | boolean | null>;

export function formatMetric(
  name: string,
  value: number,
  tags: MetricTags = {},
): string {
  return `[metric] ${JSON.stringify({ name, value, tags })}`;
}

export function recordMetric(
  name: string,
  value = 1,
  tags: MetricTags = {},
): void {
  console.info(formatMetric(name, value, tags));
}
