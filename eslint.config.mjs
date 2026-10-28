import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Les adaptateurs du magasin de démonstration portent la même
    // signature que le client Supabase : des paramètres qu'ils ignorent
    // font partie du contrat. Le tiret bas les distingue d'un oubli.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `react-hooks/set-state-in-effect` est arrivée avec react-hooks v7.
      // Elle signale tout `setState` *atteignable* depuis un effet, y compris
      // quand l'appel traverse une fonction `async` et que l'écriture a lieu
      // après un `await` — donc dans un callback, pas dans le rendu en cours.
      //
      // Les écrans de DevNet interrogent Supabase directement (décision : pas
      // de route handler), donc ils chargent au montage et posent leur état
      // dans la continuation asynchrone. C'est le motif que la règle vise le
      // moins, et le refuser imposerait un route handler ou un cache client
      // entier. On la garde en avertissement : le signal reste visible, mais
      // une pile de faux positifs ne casse plus `npm run lint`.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
