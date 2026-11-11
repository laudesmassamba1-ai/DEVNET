"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, IconButton } from "@/components/AppShell";
import { Icon, asIconName } from "@/components/Icon";
import { EmptyState, Loading } from "@/components/Avatar";
import { ExtensionSlot } from "@/components/ExtensionSlot";
import { Field } from "@/components/Field";
import { ExtensionStudio } from "@/components/ExtensionStudio";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import {
  CATEGORY_LABELS, CATEGORY_ORDER, createExtension, deleteExtension,
  fetchExtensions, fetchMyInstalls, installExtension, setExtensionEnabled,
  setExtensionSettings, uninstallExtension,
} from "@/lib/extensions";
import { EXAMPLE_EXTENSION, EXAMPLE_EXTENSION_SLUG } from "@/lib/example-extension";
import type {
  ExtensionCategory, ExtensionInstall, ExtensionSetting, ExtensionSnippet,
  ExtensionWithAuthor,
} from "@/lib/types";

const ICONS = ["grid", "package", "star", "bolt",  "terminal",
  "code", "layers", "server", "lock", "globe"] as const;

const SNIPPET_LANGS = ["*", "javascript", "typescript", "python", "json", "html", "css"] as const;

/** Formulaire vide d'un extrait, pour la ligne ajoutée par défaut. */
const BLANK_SNIPPET: ExtensionSnippet = { language: "*", prefix: "", body: "" };

export default function ExtensionsPage() {
  const { profile } = useSession();
  const toast = useToast();

  const [extensions, setExtensions] = useState<ExtensionWithAuthor[] | null>(null);
  const [installs, setInstalls] = useState<Map<string, ExtensionInstall>>(new Map());
  const [cat, setCat] = useState<ExtensionCategory | "all">("all");
  const [query, setQuery] = useState("");

  const [open, setOpen] = useState(false);
  const [settingsFor, setSettingsFor] = useState<ExtensionWithAuthor | null>(null);

  // Le brouillon de publication.
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [version, setVersion] = useState("0.1.0");
  const [category, setCategory] = useState<ExtensionCategory>("snippets");
  const [icon, setIcon] = useState<(typeof ICONS)[number]>(ICONS[0]);
  const [snippets, setSnippets] = useState<ExtensionSnippet[]>([{ ...BLANK_SNIPPET }]);
  const [settingRows, setSettingRows] = useState<ExtensionSetting[]>([]);
  /** Les commandes : un titre lisible et le texte inséré dans l'éditeur. */
  const [commandRows, setCommandRows] = useState<{ title: string; body: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setExtensions(await fetchExtensions());
  }, []);

  const loadMine = useCallback(async () => {
    if (!profile?.id) return;
    setInstalls(await fetchMyInstalls(profile.id));
  }, [profile]);

  useEffect(() => {
    let alive = true;
    fetchExtensions().then((rows) => {
      if (alive) setExtensions(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      await loadMine();
    })();
  }, [loadMine]);

  async function install(e: ExtensionWithAuthor) {
    if (!profile) return;
    const { error } = await installExtension(e.id, profile.id);
    if (error && !/duplicate|unique/i.test(error)) {
      return toast(`Erreur : ${error}`, "err");
    }
    setInstalls((prev) =>
      new Map(prev).set(e.id, {
        extension_id: e.id, user_id: profile.id, enabled: true,
        settings: {}, installed_at: new Date().toISOString(),
      }),
    );
    setExtensions((prev) =>
      (prev ?? []).map((x) => (x.id === e.id ? { ...x, installs: (x.installs || 0) + 1 } : x)),
    );
    toast("Extension installée");
  }

  async function uninstall(e: ExtensionWithAuthor) {
    if (!profile) return;
    const { error } = await uninstallExtension(e.id, profile.id);
    if (error) return toast(`Erreur : ${error}`, "err");
    setInstalls((prev) => {
      const next = new Map(prev);
      next.delete(e.id);
      return next;
    });
    setExtensions((prev) =>
      (prev ?? []).map((x) =>
        x.id === e.id ? { ...x, installs: Math.max(0, (x.installs || 1) - 1) } : x,
      ),
    );
    toast("Extension désinstallée");
  }

  async function toggle(e: ExtensionWithAuthor) {
    if (!profile) return;
    const current = installs.get(e.id);
    if (!current) return;
    const enabled = !current.enabled;
    const { error } = await setExtensionEnabled(e.id, profile.id, enabled);
    if (error) return toast(`Erreur : ${error}`, "err");
    setInstalls((prev) => new Map(prev).set(e.id, { ...current, enabled }));
    toast(enabled ? "Extension activée" : "Extension désactivée");
  }

  async function saveSettings(e: ExtensionWithAuthor, values: Record<string, string | boolean | number>) {
    if (!profile) return;
    const { error } = await setExtensionSettings(e.id, profile.id, values);
    if (error) return toast(`Erreur : ${error}`, "err");
    const current = installs.get(e.id);
    if (current) setInstalls((prev) => new Map(prev).set(e.id, { ...current, settings: values }));
    setSettingsFor(null);
    toast("Réglages enregistrés");
  }

  async function publish() {
    if (!profile) return;
    if (!name.trim()) return toast("Donne un nom à l'extension", "err");

    const cleanSnippets = snippets.filter((s) => s.prefix.trim() && s.body.trim());
    const cleanSettings = settingRows.filter((s) => s.key.trim() && s.label.trim());
    // Une commande sans titre ou sans corps ne fait rien : on ne la publie
    // pas. L'`id` est stable dans le manifeste et n'est pas destiné à
    // l'écran — le titre est ce que la palette affiche.
    const cleanCommands = commandRows
      .filter((c) => c.title.trim() && c.body.trim())
      .map((c, i) => ({ id: `cmd-${i + 1}`, title: c.title.trim(), body: c.body }));

    setBusy(true);
    const { error } = await createExtension(
      {
        name, description: desc, version, icon, category,
        manifest: {
          snippets: cleanSnippets,
          commands: cleanCommands,
          settings: cleanSettings,
        },
      },
      profile.id,
    );
    setBusy(false);
    if (error) return toast(`Erreur : ${error}`, "err");

    setOpen(false);
    resetDraft();
    toast("Extension publiée");
    await load();
  }

  function resetDraft() {
    setName(""); setDesc(""); setVersion("0.1.0"); setCategory("snippets");
    setIcon(ICONS[0]); setSnippets([{ ...BLANK_SNIPPET }]); setSettingRows([]);
    setCommandRows([]);
  }

  /**
   * Publier l’exemple sur le backend courant, puis l’installer.
   *
   * Sur backend réel, aucune migration n’est nécessaire : c’est un insert
   * ordinaire, soumis à la RLS de `029`, avec l’utilisateur comme auteur.
   * En démonstration, l’exemple existe déjà (fixture `e-5`).
   */
  async function publishExample() {
    if (!profile) return;
    if (extensions?.some((e) => e.slug === EXAMPLE_EXTENSION_SLUG)) {
      return toast("L’exemple est déjà publié", "err");
    }

    setBusy(true);
    const { extension, error } = await createExtension(EXAMPLE_EXTENSION, profile.id);
    if (error || !extension) {
      setBusy(false);
      return toast(`Erreur : ${error ?? "publication impossible"}`, "err");
    }

    const { error: installError } = await installExtension(extension.id, profile.id);
    setBusy(false);
    if (installError) {
      return toast(`Publiée, mais installation impossible : ${installError}`, "err");
    }

    await load();
    await loadMine();
    toast("Exemple publié et installé");
  }

  async function remove(e: ExtensionWithAuthor) {
    const { error } = await deleteExtension(e.id);
    if (error) return toast(`Erreur : ${error}`, "err");
    toast("Extension retirée");
    await load();
  }

  const q = query.trim().toLowerCase();
  const visible = (extensions ?? []).filter((e) =>
    (cat === "all" || e.category === cat) &&
    (!q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)),
  );
  const activeCount = useMemo(
    () => [...installs.values()].filter((i) => i.enabled).length,
    [installs],
  );
  const example = (extensions ?? []).find((e) => e.slug === EXAMPLE_EXTENSION_SLUG) ?? null;
  const exampleInstall = example ? installs.get(example.id) : undefined;

  return (
    <AppShell
      title="Extensions"
      path="~/extensions"
      action={<IconButton label="Publier une extension" name="plus" dataTour="extensions-new" onClick={() => setOpen(true)} />}
    >
      <div className="px-(--gutter) pt-3" data-tour="extensions-list">
        <div className="mb-4 rounded-[var(--radius-input)] border border-line-3 bg-surface-2 px-3.5 py-3
          text-sm leading-relaxed text-chalk-2">
          Une extension DevNet est un <span className="font-bold text-chalk">manifeste</span>, pas
          du code exécuté : des <span className="font-bold text-chalk">extraits</span> de saisie,
          des <span className="font-bold text-chalk">commandes</span> et des réglages que l&apos;IDE
          interprète. {activeCount > 0 && <span>{activeCount} active{activeCount > 1 ? "s" : ""}.</span>}
        </div>

        <ExtensionStudio
          example={example}
          install={exampleInstall}
          signedIn={Boolean(profile)}
          onPublish={() => void publishExample()}
          onInstall={() => { if (example) void install(example); }}
          onToggle={() => { if (example) void toggle(example); }}
          onSettings={() => { if (example) setSettingsFor(example); }}
        />

        <div className="mb-3">
          <ExtensionSlot slot="extensions.page" title="Vos extensions actives" />
        </div>

        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          aria-label="Rechercher une extension"
          placeholder="Rechercher une extension…"
          className="mb-3 h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 bg-surface
            px-3.5 text-[14px] shadow-sh-1 placeholder:text-chalk-4
            focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_var(--color-signal)]"
        />

        <div className="mb-4 flex flex-wrap gap-2">
          <Chip active={cat === "all"} onClick={() => setCat("all")}>Tout</Chip>
          {CATEGORY_ORDER.map((c) => (
            <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
              {CATEGORY_LABELS[c]}
            </Chip>
          ))}
        </div>

        {extensions === null && <Loading />}

        {extensions !== null && visible.length === 0 && (
          <EmptyState title="Aucune extension trouvée" />
        )}

        {visible.map((e) => {
          const installed = installs.get(e.id);
          const mine = e.owner_id === profile?.id;
          return (
            <div key={e.id} className="depth-card mb-[9px] rounded-[var(--radius-card)] border border-edge
              glass-flat p-3.5">
              <div className="flex items-start gap-3.5">
                <span className="flex size-[38px] shrink-0 items-center justify-center
                  rounded-[var(--radius-input)] border border-line-3 bg-surface-2 text-signal-d">
                  <Icon name={asIconName(e.icon, "package")} size={18} strokeWidth={1.7} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-bold">{e.name}</span>
                    <span className="text-sm font-bold text-chalk-4">v{e.version}</span>
                    <span className="shrink-0 rounded-[var(--radius-chip)] border border-line-3 px-1.5 py-0.5
                      text-sm font-bold uppercase tracking-[0.1em] text-chalk-3">
                      {CATEGORY_LABELS[e.category]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-chalk-4">{e.description}</p>
                  <p className="mt-1 text-[10.5px] text-chalk-4">
                    {e.author?.pseudo ? `@${e.author.pseudo} · ` : ""}
                    {e.installs || 0} installation{(e.installs || 0) === 1 ? "" : "s"}
                    {e.manifest.snippets?.length
                      ? ` · ${e.manifest.snippets.length} extrait${e.manifest.snippets.length > 1 ? "s" : ""}`
                      : ""}
                    {e.manifest.commands?.length
                      ? ` · ${e.manifest.commands.length} commande${e.manifest.commands.length > 1 ? "s" : ""}`
                      : ""}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!installed && (
                  <button type="button" onClick={() => install(e)}
                    className="mo-press rounded-[var(--radius-chip)] border border-line-3 bg-signal px-3.5
                      py-1.5 text-sm font-bold text-void shadow-sh-1">
                    Installer
                  </button>
                )}

                {installed && (
                  <>
                    <button type="button" onClick={() => toggle(e)}
                      className="mo-press flex items-center gap-1.5 rounded-[var(--radius-chip)] border
                        px-3 py-1.5 text-sm font-bold"
                      style={installed.enabled
                        ? { borderColor: "var(--color-line-3)", background: "var(--color-surface)", color: "var(--color-chalk)" }
                        : { borderColor: "var(--color-line-3)", background: "var(--color-surface-2)", color: "var(--color-chalk-4)" }}>
                      <Icon name={installed.enabled ? "check" : "lock"} size={12} />
                      {installed.enabled ? "Activée" : "Désactivée"}
                    </button>

                    {!!e.manifest.settings?.length && (
                      <button type="button" onClick={() => setSettingsFor(e)}
                        className="mo-press rounded-[var(--radius-chip)] border border-line-3 px-3.5
                          py-1.5 text-sm font-bold text-chalk-2 hover:bg-surface-2">
                        Réglages
                      </button>
                    )}

                    <button type="button" onClick={() => uninstall(e)}
                      className="rounded-[var(--radius-chip)] px-2 py-1.5 text-sm font-bold
                        text-chalk-4 hover:text-signal">
                      Désinstaller
                    </button>
                  </>
                )}

                {mine && (
                  <button type="button" onClick={() => remove(e)}
                    className="ml-auto rounded-[var(--radius-chip)] px-2 py-1.5 text-sm font-bold
                      text-chalk-4 hover:text-[var(--color-err,var(--color-signal))]">
                    Retirer la mienne
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Publier */}
      <Sheet open={open} onClose={() => setOpen(false)} title="Publier une extension">
        <Field label="Nom">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="ex: Extraits Rust"
            className="h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5
              text-[14px] shadow-sh-1 placeholder:text-chalk-4" />
        </Field>

        <Field label="Description">
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
            placeholder="À quoi sert cette extension ?"
            className="w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5 py-3
              text-[14px] shadow-sh-1 placeholder:text-chalk-4" />
        </Field>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <Field label="Version" tight>
            <input value={version} onChange={(e) => setVersion(e.target.value)}
              className="h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5
                text-[14px] shadow-sh-1" />
          </Field>
          <Field label="Catégorie" tight>
            <select value={category} onChange={(e) => setCategory(e.target.value as ExtensionCategory)}
              className="h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3
                text-[14px] shadow-sh-1">
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Icône">
          <div className="grid grid-cols-5 gap-2">
            {ICONS.map((k) => (
              <button key={k} type="button" onClick={() => setIcon(k)}
                aria-label={`Icône ${k}`} aria-pressed={icon === k}
                className="flex aspect-square items-center justify-center rounded-[var(--radius-input)]
                  border border-line-3 transition-colors"
                data-active={icon === k ? "true" : "false"}
                style={icon === k
                  ? { background: "var(--color-signal)", color: "var(--color-void)" }
                  : { background: "var(--color-surface-2)", color: "var(--color-signal-d, var(--color-chalk))" }}>
                <Icon name={k} size={18} strokeWidth={1.7} />
              </button>
            ))}
          </div>
        </Field>

        <Field label="Extraits de saisie">
          {snippets.map((s, i) => (
            <div key={i} className="mb-2 rounded-[var(--radius-input)] border border-line-3 bg-surface-2 p-2.5">
              <div className="mb-2 flex gap-2">
                <select value={s.language} aria-label={`Langage de l'extrait ${i + 1}`}
                  onChange={(e) => setSnippets((prev) => prev.map((x, j) => j === i ? { ...x, language: e.target.value } : x))}
                  className="h-9 rounded-[var(--radius-chip)] border border-line-3 bg-surface px-2 text-sm ">
                  {SNIPPET_LANGS.map((l) => <option key={l} value={l}>{l === "*" ? "tous" : l}</option>)}
                </select>
                <input value={s.prefix} aria-label={`Préfixe de l'extrait ${i + 1}`}
                  onChange={(e) => setSnippets((prev) => prev.map((x, j) => j === i ? { ...x, prefix: e.target.value } : x))}
                  placeholder="préfixe"
                  className="h-9 flex-1 rounded-[var(--radius-chip)] border border-line-3 bg-surface px-3 text-sm " />
                {snippets.length > 1 && (
                  <button type="button"
                    onClick={() => setSnippets((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Supprimer l'extrait ${i + 1}`}
                    className="flex size-9 items-center justify-center rounded-[var(--radius-chip)] text-chalk-4 hover:text-signal">
                    <Icon name="close" size={14} />
                  </button>
                )}
              </div>
              <textarea value={s.body} aria-label={`Corps de l'extrait ${i + 1}`} rows={2}
                onChange={(e) => setSnippets((prev) => prev.map((x, j) => j === i ? { ...x, body: e.target.value } : x))}
                placeholder={"Corps inséré. ${1}, ${2}… marquent les tabulations."}
                className="w-full rounded-[var(--radius-chip)] border border-line-3 bg-surface px-3 py-2
                  font-mono text-sm " />
            </div>
          ))}
          <button type="button" onClick={() => setSnippets((prev) => [...prev, { ...BLANK_SNIPPET }])}
            className="text-sm font-bold text-signal">
            + Ajouter un extrait
          </button>
        </Field>

        <Field label="Commandes de l'éditeur">
          <p className="mb-2 text-sm leading-relaxed text-chalk-4">
            Chaque commande apparaît dans la palette de l&apos;IDE (F1) et insère
            son corps au curseur.
          </p>
          {commandRows.map((c, i) => (
            <div key={i} className="mb-2 rounded-[var(--radius-input)] border border-line-3 bg-surface-2 p-2.5">
              <div className="mb-2 flex gap-2">
                <input value={c.title} aria-label={`Titre de la commande ${i + 1}`}
                  onChange={(e) => setCommandRows((prev) => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                  placeholder="Titre de la commande"
                  className="h-9 flex-1 rounded-[var(--radius-chip)] border border-line-3 bg-surface px-3 text-sm " />
                <button type="button"
                  onClick={() => setCommandRows((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Retirer la commande"
                  className="flex size-9 items-center justify-center rounded-[var(--radius-chip)] text-chalk-4 hover:text-signal">
                  <Icon name="close" size={14} />
                </button>
              </div>
              <textarea value={c.body} aria-label={`Corps de la commande ${i + 1}`} rows={2}
                onChange={(e) => setCommandRows((prev) => prev.map((x, j) => j === i ? { ...x, body: e.target.value } : x))}
                placeholder="Texte inséré au curseur"
                className="w-full rounded-[var(--radius-chip)] border border-line-3 bg-surface px-3 py-2
                  font-mono text-sm " />
            </div>
          ))}
          <button type="button"
            onClick={() => setCommandRows((prev) => [...prev, { title: "", body: "" }])}
            className="text-sm font-bold text-signal">
            + Ajouter une commande
          </button>
        </Field>

        <Field label="Réglages">
          {settingRows.map((s, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input value={s.key} aria-label={`Clé du réglage ${i + 1}`}
                onChange={(e) => setSettingRows((prev) => prev.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                placeholder="clé"
                className="h-9 flex-1 rounded-[var(--radius-chip)] border border-line-3 bg-surface px-3 text-sm " />
              <input value={s.label} aria-label={`Libellé du réglage ${i + 1}`}
                onChange={(e) => setSettingRows((prev) => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                placeholder="libellé"
                className="h-9 flex-1 rounded-[var(--radius-chip)] border border-line-3 bg-surface px-3 text-sm " />
              <select value={s.type} aria-label={`Type du réglage ${i + 1}`}
                onChange={(e) => setSettingRows((prev) => prev.map((x, j) => j === i
                  ? { ...x, type: e.target.value as ExtensionSetting["type"] } : x))}
                className="h-9 rounded-[var(--radius-chip)] border border-line-3 bg-surface px-2 text-sm ">
                <option value="string">texte</option>
                <option value="number">nombre</option>
                <option value="boolean">booléen</option>
              </select>
              <button type="button"
                onClick={() => setSettingRows((prev) => prev.filter((_, j) => j !== i))}
                aria-label={`Supprimer le réglage ${i + 1}`}
                className="flex size-9 items-center justify-center rounded-[var(--radius-chip)] text-chalk-4 hover:text-signal">
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
          <button type="button"
            onClick={() => setSettingRows((prev) => [...prev, { key: "", label: "", type: "string", default: "" }])}
            className="text-sm font-bold text-signal">
            + Ajouter un réglage
          </button>
        </Field>

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => setOpen(false)}
            className="rounded-[var(--radius-input)] border border-transparent px-5 text-[13px]
              font-bold text-chalk-2 transition-colors hover:bg-surface-2 hover:text-chalk">
            Annuler
          </button>
          <button type="button" onClick={publish} disabled={busy}
            className="mo-press flex h-[var(--h-tap)] flex-1 items-center justify-center rounded-[var(--radius-input)]
              border border-line-3 bg-signal text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-40">
            Publier
          </button>
        </div>
      </Sheet>

      {/* Réglages d'une installation */}
      {settingsFor && (
        <SettingsSheet
          e={settingsFor}
          install={installs.get(settingsFor.id)}
          onClose={() => setSettingsFor(null)}
          onSave={saveSettings}
        />
      )}
    </AppShell>
  );
}

function SettingsSheet({ e, install, onClose, onSave }: {
  e: ExtensionWithAuthor;
  install?: ExtensionInstall;
  onClose: () => void;
  onSave: (e: ExtensionWithAuthor, values: Record<string, string | boolean | number>) => void;
}) {
  const fields = e.manifest.settings ?? [];
  const [values, setValues] = useState<Record<string, string | boolean | number>>(() => {
    const start: Record<string, string | boolean | number> = {};
    for (const f of fields) {
      const saved = install?.settings?.[f.key];
      start[f.key] = saved !== undefined ? saved : f.default;
    }
    return start;
  });

  return (
    <Sheet open onClose={onClose} title={`Réglages · ${e.name}`}>
      {fields.length === 0 && <p className="text-[13px] text-chalk-4">Cette extension n&apos;a aucun réglage.</p>}
      {fields.map((f) => (
        <Field key={f.key} label={f.label}>
          {f.type === "boolean" ? (
            <button type="button"
              onClick={() => setValues((prev) => ({ ...prev, [f.key]: !prev[f.key] }))}
              className="flex h-[var(--h-input)] w-full items-center justify-between rounded-[var(--radius-input)]
                border border-line-3 bg-surface px-3.5 text-[14px] shadow-sh-1">
              <span>{values[f.key] ? "Activé" : "Désactivé"}</span>
              <span className="text-signal-d"><Icon name={values[f.key] ? "check" : "close"} size={16} /></span>
            </button>
          ) : (
            <input
              type={f.type === "number" ? "number" : "text"}
              value={String(values[f.key] ?? "")}
              onChange={(ev) => setValues((prev) => ({
                ...prev,
                [f.key]: f.type === "number" ? Number(ev.target.value) : ev.target.value,
              }))}
              className="h-[var(--h-input)] w-full rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5
                text-[14px] shadow-sh-1"
            />
          )}
        </Field>
      ))}

      <div className="mt-5 flex gap-2">
        <button type="button" onClick={onClose}
          className="rounded-[var(--radius-input)] border border-transparent px-5 text-[13px]
            font-bold text-chalk-2 hover:bg-surface-2 hover:text-chalk">
          Annuler
        </button>
        <button type="button" onClick={() => onSave(e, values)}
          className="mo-press flex h-[var(--h-tap)] flex-1 items-center justify-center rounded-[var(--radius-input)]
            border border-line-3 bg-signal text-[13px] font-bold text-void shadow-sh-2">
          Enregistrer
        </button>
      </div>
    </Sheet>
  );
}

function Chip({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className="mo-press rounded-[var(--radius-chip)] border px-3 py-1.5 text-sm font-bold
        transition-colors"
      style={active
        ? { borderColor: "var(--color-line-3)", background: "var(--color-signal)", color: "var(--color-void)" }
        : { borderColor: "var(--color-line-3)", background: "var(--color-surface)", color: "var(--color-chalk-2)" }}>
      {children}
    </button>
  );
}
