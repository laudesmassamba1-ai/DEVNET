"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import type { EditorProps, OnMount } from "@monaco-editor/react";
import type { Position, editor as MonacoEditor } from "monaco-editor";

import { CodeEditor } from "@/components/CodeEditor";
import { LoadingLogo } from "./LoadingLogo";
import { useToast } from "@/components/Toast";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import type { ExtensionSnippet } from "@/lib/types";
import {
  DEVNET_THEME,
  DEVNET_THEME_NAME,
  hasIntelliSense,
  monacoLanguage,
} from "@/lib/editor/monaco-lang";

/**
 * L'éditeur Monaco — le moteur de VSCode dans DevNet.
 *
 * ## Ce que ça donne, et pourquoi ce n'est pas une coquetterie
 *
 * Monaco **est** l'éditeur de VSCode, extrait en bibliothèque. Le brancher
 * fait tomber d'un coup tout ce qu'un éditeur maison met des semaines à
 * imiter : sélections multiples (`Alt+clic`, `Ctrl+D`), recherche-remplacement
 * (`Ctrl+F` / `Ctrl+H`), palette de commandes (`F1`), pliage de blocs,
 * minimap, appariement et **colorisation** des paires de parenthèses,
 * indentation automatique, déplacer/dupliquer une ligne, commenter
 * (`Ctrl+/`), aller à la ligne (`Ctrl+G`), et surtout — pour JavaScript,
 * TypeScript, JSON, HTML et CSS — de **vraies** erreurs de compilation, du
 * survol de types et de la complétion, servis par un worker embarqué.
 *
 * ## Le prix
 *
 * Monaco pèse plusieurs mégaoctets. On ne l'embarque donc **pas** dans le
 * bundle : `@monaco-editor/react` le charge depuis un CDN (jsDelivr), une
 * fois, puis le navigateur le met en cache. C'est le même choix que Pyodide
 * (voir `lib/execution`), et pour la même raison : garder le dépôt léger.
 *
 * La conséquence est assumée : **hors ligne, Monaco ne se charge pas.** Un
 * éditeur qui resterait figé sur un cadre vide serait pire que l'ancien, donc
 * `loader.init()` est surveillé — si le CDN ne répond pas, on retombe
 * automatiquement sur l'éditeur texte maison (`components/CodeEditor.tsx`).
 * On perd la complétion et les raccourcis, on garde un éditeur qui écrit.
 *
 * ## Le thème
 *
 * `beforeMount` définit un thème `devnet-liquid` dont les couleurs viennent
 * de `globals.css` (`lib/editor/monaco-lang.ts` les porte en littéraux, Monaco
 * ne sachant pas lire une variable CSS) : fond encre, commentaires gris
 * ardoise, et les mêmes tons par jeton que la coloration maison — quand du
 * vert ou du bleu apparaît, c'est du code, jamais un bouton.
 */

/** Le composant Monaco, chargé **côté client uniquement**. */
const Monaco = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => (
      <Box>
        <div className="flex min-h-[120px] items-center justify-center">
          <LoadingLogo size="md" ariaLabel="Chargement de l'éditeur de code" />
        </div>
      </Box>
    ),
  },
) as unknown as ComponentType<EditorProps>;

/**
 * Les langages sur lesquels on enregistre les extraits des extensions.
 *
 * Monaco enregistre un fournisseur de complétion **par langage** — il n'y a
 * pas de fournisseur « tous langages ». On couvre donc l'ensemble que
 * l'éditeur connaît, plus tout langage nommé par un extrait.
 */
const SNIPPET_LANGUAGES = [
  "javascript", "typescript", "python", "json", "html", "css", "markdown",
  "java", "c", "cpp", "go", "rust", "php", "sql", "shell", "yaml", "xml",
];

export interface MonacoCodeEditorProps {
  path: string;
  value: string;
  onChange: (next: string) => void;
  /** Appelé par `Ctrl/Cmd+S`. */
  onSave?: () => void;
  /** Appelé par `Ctrl/Cmd+Entrée`. */
  onRun?: () => void;
  /**
   * La sélection courante, en coordonnées Monaco (1-based).
   *
   * Sert à la présence partagée : on diffuse les deux extrémités du curseur
   * pour que les autres voient où l'on écrit. On passe des positions brutes
   * plutôt que l'objet Monaco, pour que l'appelant n'ait pas à importer
   * `monaco-editor` juste pour lire `lineNumber`/`column`.
   */
  onSelectionChange?: (selection: {
    anchor: { line: number; column: number };
    head: { line: number; column: number };
  }) => void;
  /**
   * Défilement vertical, en pixels.
   *
   * La couche de curseurs distants est posée **au-dessus** de Monaco, qui
   * gère son propre défilement : sans cette valeur, un curseur resterait
   * figé pendant qu'on fait défiler le code.
   */
  onScrollChange?: (scrollTop: number) => void;
  /**
   * Les extraits des extensions activées (migration 029).
   *
   * On les enregistre comme **fournisseurs de complétion** Monaco : taper le
   * préfixe propose le corps, qui se déploie avec ses tabulations. Les
   * extraits arrivent souvent après le montage (requête réseau), ce que la
   * référence `snippetsRef` absorbe sans réabonner Monaco.
   */
  snippets?: ExtensionSnippet[];
  readOnly?: boolean;
  /** Hauteur du cadre, en pixels. Monaco ne suit pas le contenu tout seul. */
  height?: number;
  /**
   * Remplir la hauteur disponible au lieu d'une hauteur fixe.
   *
   * C'est le mode de l'**IDE plein écran** : l'éditeur prend toute la
   * place que lui laisse la fenêtre, et c'est la fenêtre qui décide — pas
   * une constante en pixels qui laisserait une bande vide en bas sur un
   * grand écran et écraserait l'éditeur sur un petit.
   */
  fill?: boolean;
  /** Afficher la minimap (désactivée sur téléphone). */
  minimap?: boolean;
}

/**
 * Après combien de temps on cesse d'attendre le CDN.
 *
 * Six secondes : au-delà, la personne a déjà cru que le bouton n'avait pas
 * marché. On ne peut pas savoir « à l'avance » si un réseau lent finira par
 * répondre — on choisit donc de **servir** l'éditeur de secours, quitte à ce
 * que Monaco arrive trop tard et soit ignoré pour cette session.
 */
const MONACO_CDN_DEADLINE_MS = 6_000;

export function MonacoCodeEditor({
  path,
  value,
  onChange,
  onSave,
  onRun,
  onSelectionChange,
  onScrollChange,
  snippets,
  readOnly = false,
  height = 460,
  fill = false,
  minimap = true,
}: MonacoCodeEditorProps) {
  const [engine, setEngine] = useState<"pending" | "monaco" | "fallback">("pending");
  const desktop = useIsDesktop();
  const toast = useToast();

  // L'instance Monaco, conservée pour les boutons Copier/Coller : sur
  // téléphone, Monaco n'offre ni clavier ni menu fiable pour copier ou
  // coller — ces actions passent donc par l'API du presse-papiers, et
  // l'insertion par `executeEdits` garde l'historique d'annulation.
  const editorRef = useRef<Parameters<NonNullable<EditorProps["onMount"]>>[0] | null>(null);

  const copier = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast("Code copié", "ok");
    } catch {
      toast("Le presse-papiers est indisponible : copiez-le par la sélection", "err");
    }
  }, [toast, value]);

  const coller = useCallback(async () => {
    const editor = editorRef.current;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      if (editor) {
        const selection = editor.getSelection();
        if (selection) {
          editor.executeEdits("devnet-clipboard", [
            { range: selection, text, forceMoveMarkers: true },
          ]);
          editor.focus();
        }
      }
    } catch {
      toast("Le presse-papiers ne peut pas être lu ici — utilisez Ctrl+V", "err");
    }
  }, [toast]);

  // Les rappels changent à chaque rendu du parent : on les lit par une
  // référence, sinon la commande clavier ajoutée à `onMount` figerait la
  // première version — et `Ctrl+S` enregistrerait toujours le premier
  // fichier ouvert.
  const saveRef = useRef(onSave);
  const runRef = useRef(onRun);
  const selectionRef = useRef(onSelectionChange);
  const scrollRef = useRef(onScrollChange);
  const snippetsRef = useRef(snippets);
  useEffect(() => {
    saveRef.current = onSave;
    runRef.current = onRun;
    selectionRef.current = onSelectionChange;
    scrollRef.current = onScrollChange;
    snippetsRef.current = snippets;
  }, [onSave, onRun, onSelectionChange, onScrollChange, snippets]);

  // On interroge le chargeur pour **savoir** si Monaco arrivera. Le
  // composant seul ne dit rien en cas d'échec réseau : il reste sur son
  // écran de chargement, ce qui est indiscernable d'un blocage.
  useEffect(() => {
    let alive = true;
    const deadline = window.setTimeout(() => {
      if (alive) {
        alive = false;
        setEngine("fallback");
      }
    }, MONACO_CDN_DEADLINE_MS);

    import("@monaco-editor/react")
      .then((mod) => mod.loader.init())
      .then(() => {
        if (!alive) return;
        alive = false;
        window.clearTimeout(deadline);
        setEngine("monaco");
      })
      .catch(() => {
        if (!alive) return;
        alive = false;
        window.clearTimeout(deadline);
        setEngine("fallback");
      });

    return () => {
      alive = false;
      window.clearTimeout(deadline);
    };
  }, []);

  const beforeMount = useCallback((monaco: Parameters<NonNullable<EditorProps["beforeMount"]>>[0]) => {
    monaco.editor.defineTheme(DEVNET_THEME_NAME, DEVNET_THEME);
  }, []);

  const onMount = useCallback<OnMount>((editor, monaco) => {
    editorRef.current = editor;
    // Les deux raccourcis annoncés par l'interface. Monaco a déjà `Ctrl+F`,
    // `Ctrl+/`, `F1`, etc. ; on n'ajoute que ce qui est propre à DevNet.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveRef.current?.();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      runRef.current?.();
    });

    // Présence partagée : on transmet les deux extrémités de la sélection.
    // L'abonnement suit le cycle de vie de l'éditeur, et `selectionRef` évite
    // de réabonner (donc de perdre le focus) quand le rappel change de
    // référence à chaque rendu du parent.
    if (selectionRef.current) {
      const sub = editor.onDidChangeCursorSelection((event) => {
        const anchor = event.selection.getStartPosition();
        const head = event.selection.getEndPosition();
        selectionRef.current?.({
          anchor: { line: anchor.lineNumber, column: anchor.column },
          head: { line: head.lineNumber, column: head.column },
        });
      });
      editor.onDidDispose(() => sub.dispose());
    }

    // Le défilement déplace la couche de curseurs posée par-dessus.
    if (scrollRef.current) {
      const sub = editor.onDidScrollChange((event) => {
        scrollRef.current?.(event.scrollTop);
      });
      editor.onDidDispose(() => sub.dispose());
    }

    // Les extraits des extensions activées (029) : un fournisseur de
    // complétion par langage. On enregistre une fois pour toutes sur un
    // ensemble de langages, et le rappel relit `snippetsRef` — ainsi les
    // extraits qui arrivent après le montage (requête asynchrone) sont pris
    // en compte sans réenregistrer de fournisseur.
    const snippetLangs = new Set<string>(SNIPPET_LANGUAGES);
    for (const s of snippetsRef.current ?? []) {
      if (s.language && s.language !== "*") snippetLangs.add(s.language);
    }
    for (const lang of snippetLangs) {
      const provider = monaco.languages.registerCompletionItemProvider(lang, {
        provideCompletionItems: (model: MonacoEditor.ITextModel, position: Position) => {
          const word = model.getWordUntilPosition(position);
          const range = new monaco.Range(
            position.lineNumber, word.startColumn, position.lineNumber, word.endColumn,
          );
          const suggestions = (snippetsRef.current ?? [])
            .filter((s) => s.language === "*" || s.language === lang)
            .map((s) => ({
              label: s.prefix,
              kind: monaco.languages.CompletionItemKind.Snippet,
              // Le corps est déjà au format de snippet VS Code (`${1:…}`),
              // donc `InsertAsSnippet` déploie les tabulations attendues.
              insertText: s.body,
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: s.description,
              detail: "extrait",
              range,
            }));
          return { suggestions };
        },
      });
      editor.onDidDispose(() => provider.dispose());
    }
    
    // Seules les actions que Monaco expose vraiment en mode autonome.
    // Les raccourcis `workbench.action.*` (palette de commandes, aller au
    // fichier ou au symbole du projet) n'existent pas hors de VSCode complet :
    // les enregistrer consommait la touche sans rien declencher. `Alt+Up/Down`,
    // `Ctrl+D`, `Ctrl+Shift+K`, `F2` et `Ctrl+.` sont deja des raccourcis par
    // defaut de Monaco - les redeclarer ne changeait rien.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
      editor.getAction("editor.action.formatDocument")?.run();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO, () => {
      editor.getAction("editor.action.quickOutline")?.run();
    });

    const host = editor.getDomNode()?.parentElement;
    if (host) {
      const layoutNow = () => {
        if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return;
        editor.layout({ width: host.clientWidth, height: host.clientHeight });
      };
      const layout = () => {
        layoutNow();
        requestAnimationFrame(layoutNow);
      };
      const observer = new ResizeObserver(layout);
      observer.observe(host);
      window.addEventListener("resize", layout);
      layout();
      editor.onDidDispose(() => {
        observer.disconnect();
        window.removeEventListener("resize", layout);
      });
    }
    
  }, []);

  if (engine === "pending") {
    return (
      <Box fill={fill}>
        <div className={`flex items-center justify-center ${fill ? "h-full" : "min-h-[120px]"}`}>
          {/* Le logo en boucle EST le message : aucun « Chargement… »
              visible, l'information reste au lecteur d'écran. */}
          <LoadingLogo size="md" ariaLabel="Chargement de l'éditeur de code" />
        </div>
      </Box>
    );
  }

  // Repli assumé : le CDN n'a pas répondu (hors ligne, réseau filtré). On
  // sert l'éditeur maison plutôt qu'un cadre vide.
  if (engine === "fallback") {
    return (
      <div className={fill ? "flex h-full min-h-0 flex-col" : ""}>
        <CodeEditor
          path={path}
          value={value}
          onChange={onChange}
          onSave={onSave}
          onRun={onRun}
          readOnly={readOnly}
        />
      </div>
    );
  }

  const language = monacoLanguage(path);

  return (
    <div
      className={`overflow-hidden bg-[var(--color-code-bg)] ${
        fill
          ? "flex h-full min-h-0 flex-col"
          : "rounded-[var(--radius-card)] border border-line-3 shadow-sh-1 focus-within:border-signal"
      }`}
    >
      <div className={fill ? "min-h-0 flex-1" : ""}>
      <Monaco
        // `path` donne à Monaco un **modèle par fichier** : l'historique
        // d'annulation, le pliage et la position du curseur survivent au
        // changement de fichier, comme dans un vrai éditeur. Un seul modèle
        // réutilisé effacerait tout ça à chaque clic dans l'arbre.
        path={path}
        language={language}
        value={value}
        onChange={(next) => onChange(next ?? "")}
        theme={DEVNET_THEME_NAME}
        beforeMount={beforeMount}
        onMount={onMount}
        height={fill ? "100%" : `${height}px`}
        loading={
          <Box fill={fill}>
            <div className="flex items-center justify-center" style={{ height: fill ? "100%" : `${height}px` }}>
              <LoadingLogo size="md" ariaLabel="Chargement de l'éditeur de code" />
            </div>
          </Box>
        }
        options={{
          ariaLabel: `Contenu de ${path}`,
          readOnly,
          fontSize: 16,
          fontFamily:
            '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontLigatures: true,
          lineHeight: 25,
          tabSize: 2,
          insertSpaces: true,
          // VSCode : pliage, minimap, aides visuelles, curseur fluide.
          minimap: { enabled: minimap && desktop, renderCharacters: false, maxColumn: 90 },
          folding: true,
          foldingHighlight: true,
          showFoldingControls: "mouseover",
          renderLineHighlight: "all",
          renderWhitespace: "selection",
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true, highlightActiveIndentation: true },
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          smoothScrolling: true,
          stickyScroll: { enabled: true },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: "off",
          trimAutoWhitespace: true,
          formatOnPaste: true,
          suggestOnTriggerCharacters: true,
          quickSuggestions: { other: true, comments: false, strings: false },
          tabCompletion: "on",
          // Les options d'aide sont posées ici, pas dans `onMount` : Monaco
          // ne monte qu'une fois, donc un `updateOptions` lié au chemin figeait
          // le réglage du premier fichier ouvert pour tous les suivants.
          parameterHints: { enabled: true },
          hover: { enabled: "on" },
          padding: { top: 12, bottom: 12 },
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
            useShadows: false,
          },
          // Un éditeur lisible sur téléphone : les barres restent fines et
          // la minimap se coupe (elle volerait un tiers de l'écran).
          overviewRulerBorder: false,
          contextmenu: true,
        }}
      />
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line-3/70 bg-surface-3/40 px-2.5 py-1">
        <span className="label-micro text-chalk-4 tnum">{language}</span>
        {hasIntelliSense(path) && (
          <span className="sr-only">Analyse du langage activée</span>
        )}
        {/* Copier/Coller explicitement, pour le téléphone : Monaco y n'a ni
            menu fiable ni raccourci clavier, la seule façon de coller y est
            un bouton qui passe par l'API du presse-papiers. */}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void copier()}
            aria-label="Copier le code"
            className="rounded-[var(--radius-input)] border border-line-3 px-2 py-0.5
              text-[11px] font-bold text-chalk-3 transition-colors
              hover:border-signal hover:text-signal"
          >
            Copier
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={() => void coller()}
              aria-label="Coller depuis le presse-papiers"
              className="rounded-[var(--radius-input)] border border-line-3 px-2 py-0.5
                text-[11px] font-bold text-chalk-3 transition-colors
                hover:border-signal hover:text-signal"
            >
              Coller
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Le cadre affiché tant que Monaco n'est pas là. */
function Box({ children, fill = false }: { children: React.ReactNode; fill?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center gap-2 bg-[var(--color-code-bg)]
        px-4 py-6 font-mono text-[12px] text-chalk-4 ${
          fill
            ? "h-full min-h-0 rounded-none"
            : "min-h-[120px] rounded-[var(--radius-card)] border border-line-3"
        }`}
    >
      {children}
    </div>
  );
}
