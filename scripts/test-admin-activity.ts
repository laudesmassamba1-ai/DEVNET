import { buildPostActivitySeries } from "../lib/admin-activity";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) passed++;
  else failures.push(name);
}

const now = new Date("2026-11-04T12:00:00.000Z");
const series = buildPostActivitySeries(
  [
    { created_at: "2026-10-19T10:00:00.000Z" },
    { created_at: "2026-10-20T08:00:00.000Z" },
    { created_at: "2026-11-02T08:00:00.000Z" },
    { created_at: "invalid-date" },
  ],
  now,
);

check("le graphe couvre huit semaines", series.length === 8);
check("la série commence un lundi UTC", new Date(`${series[0].start}T00:00:00Z`).getUTCDay() === 1);
check("les publications sont rangées dans leur semaine", series[5]?.count === 2);
check("la semaine courante compte ses publications", series[7]?.count === 1);
check("les dates invalides ne gonflent pas les comptes", series.reduce((sum, week) => sum + week.count, 0) === 3);
check("les semaines sans activité restent visibles", series[0]?.count === 0);

if (failures.length > 0) {
  console.error(failures.map((failure) => `✗ ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`✓ ${passed} vérifications du graphe d'activité admin`);
}
