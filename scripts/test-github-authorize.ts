import { authenticatedUserMatchesRequest } from "@/lib/github/oauth";

const cases: [string, string, string | null, boolean][] = [
  ["the authenticated account may authorize its own GitHub link", "user-1", "user-1", true],
  ["a valid but different account is rejected", "user-2", "user-1", false],
  ["an unauthenticated request is rejected", "user-1", null, false],
  ["an empty requested account is rejected", "", "user-1", false],
];

let passed = 0;
let failed = 0;
for (const [label, requested, authenticated, expected] of cases) {
  const actual = authenticatedUserMatchesRequest(requested, authenticated);
  const ok = actual === expected;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (ok) passed++;
  else failed++;
}

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s)`);
if (failed > 0) process.exitCode = 1;
