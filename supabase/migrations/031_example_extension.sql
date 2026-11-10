-- 031 — Une extension d'exemple pour la place de marché.
--
-- Elle montre les trois formes qu'une extension peut prendre :
--   - des snippets (préfixe -> corps, avec tabulations $1...$n)
--   - des commandes (apparaissent dans la palette F1 de l'IDE)
--   - des réglages (configurables par l'utilisateur lors de l'installation)
--
-- Elle est publiée par l'utilisateur de démonstration
-- (test@devnet.local, id 99ee9d99-9277-4f20-9799-3b8d2bbe848b).
--
-- Le manifeste est un JSON pur : les $1, $2... sont des tabulations Monaco,
-- pas des paramètres de liaison SQL (le client pg n'est pas concerné ici,
-- c'est l'application qui lit le jsonb). Les apostrophes du JSON sont
-- doublées pour le SQL (l''IDE, d''un, etc.).

insert into public.extensions (
  slug, name, description, version, icon, category, manifest, owner_id
) values (
  'devnet-starter-kit',
  'DevNet Starter Kit',
  'Extraits, commandes et réglages pour bien démarrer dans l''IDE DevNet : squelettes de composant, commandes rapides et une option de thème.',
  '1.2.0',
  'rocket',
  'snippets',
  '{
    "snippets": [
      {
        "language": "typescript",
        "prefix": "dcomponent",
        "body": [
          "import { useState } from \"react\";",
          "",
          "export default function ${1:ComponentName}() {",
          "  const [${2:value}, set${2:Value}] = useState(${3:false});",
          "",
          "  return (",
          "    <div className=\"p-4\">",
          "      <h1>{${2:value}}</h1>",
          "    </div>",
          "  );",
          "}"
        ],
        "description": "Squelette d''un composant React functionnel"
      },
      {
        "language": "typescript",
        "prefix": "dapi",
        "body": [
          "export async function ${1:action}() {",
          "  const { data, error } = await supabase",
          "    .from(\"${2:table}\")",
          "    .select(\"*\")",
          "    .${3:eq}(\"id\", ${4:userId});",
          "  if (error) throw error;",
          "  return data;",
          "}"
        ],
        "description": "Appel Supabase typé"
      },
      {
        "language": "typescript",
        "prefix": "dhook",
        "body": [
          "export function use${1:Feature}() {",
          "  const [${2:data}, setData] = useState<${3:unknown}[]>([]);",
          "",
          "  useEffect(() => {",
          "    let alive = true;",
          "    fetch${1:Feature}().then((rows) => {",
          "      if (alive) setData(rows);",
          "    });",
          "    return () => { alive = false; };",
          "  }, []);",
          "",
          "  return { ${2:data} };",
          "}"
        ],
        "description": "Hook de données avec cleanup"
      },
      {
        "language": "python",
        "prefix": "dmain",
        "body": [
          "def ${1:main}() -> None:",
          "    \"\"\"${2:Description du programme}.\"\"\"",
          "    ${3:pass}",
          "",
          "",
          "if __name__ == \"__main__\":",
          "    ${1:main}()"
        ],
        "description": "Point d''entrée Python"
      },
      {
        "language": "python",
        "prefix": "dtest",
        "body": [
          "import pytest",
          "",
          "",
          "def test_${1:feature}() -> None:",
          "    \"\"\"${2:Scénario à vérifier}.\"\"\"",
          "    # Arrange",
          "    ${3:actual} = ...",
          "    # Act",
          "    # Assert",
          "    assert ${3:actual} == ${4:expected}"
        ],
        "description": "Squelette de test pytest"
      },
      {
        "language": "json",
        "prefix": "denv",
        "body": [
          "{",
          "  \"${1:KEY}\": \"${2:VALUE}\"",
          "}"
        ],
        "description": "Objet JSON rapide"
      }
    ],
    "commands": [
      {
        "id": "cmd-component",
        "title": "Insérer un composant React",
        "body": "import { useState } from \"react\";\n\nexport default function ${1:ComponentName}() {\n  const [${2:value}, set${2:Value}] = useState(${3:false});\n\n  return (\n    <div className=\"p-4\">\n      <h1>{${2:value}}</h1>\n    </div>\n  );\n}\n"
      },
      {
        "id": "cmd-api",
        "title": "Insérer un appel Supabase",
        "body": "const { data, error } = await supabase\n  .from(\"${1:table}\")\n  .select(\"*\")\n  .eq(\"id\", ${2:userId});\nif (error) throw error;\n"
      },
      {
        "id": "cmd-license",
        "title": "Insérer un en-tête de fichier",
        "body": "/**\n * ${1:Fichier} — ${2:À quoi sert-il ?}\n * Auteur : ${3:toi}\n */\n"
      }
    ],
    "settings": [
      {
        "key": "tabSize",
        "label": "Taille d''indentation",
        "type": "number",
        "default": 2
      },
      {
        "key": "showComments",
        "label": "Afficher les commentaires",
        "type": "boolean",
        "default": true
      },
      {
        "key": "authorName",
        "label": "Nom d''auteur par défaut",
        "type": "string",
        "default": "DevNet"
      }
    ]
  }',
  '99ee9d99-9277-4f20-9799-3b8d2bbe848b'
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  version = excluded.version,
  icon = excluded.icon,
  category = excluded.category,
  manifest = excluded.manifest;