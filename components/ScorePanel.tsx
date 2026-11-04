"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { GuideLegend, ScoreCurve, MEDIAN_DASH, MEDIAN_TONE, MEAN_DASH, MEAN_TONE } from "./ScoreCurve";
import { TrendNote } from "./TrendNote";
import { frNumber } from "@/lib/utils";
import {
  DIMENSION_LABELS,
  SCORE_MAX,
  histogramGeometry,
  historyCoverage,
  historyStats,
  isTestPath,
  checkBand,
  gradeBandFor,
  gradeFor,
  scoreFile,
  scoreRepo,
  type FileEntry,
  type Grade,
  type HistoryCoverage,
  type HistoryPoint,
  type ProjectDimension,
  type RepoScore,
} from "@/lib/scoring";
import { fetchScoreHistory, type ScoreHistory } from "@/lib/repo";

/**
 * Panneau de score — la note du dépôt sur 1000, décomposée.
 *
 * ## Pourquoi tout décomposer
 *
 * Un score unique sur 1000 se suffit à lui-même dans une liste de projets :
 * on trie, on compare. Mais devant un dépôt précis, un nombre sans
 * explication est un verdict, pas un conseil. Ce panneau montre donc :
 *
 * 1. les **deux notes** — projet et dépôt — parce qu'elles répondent à
 *    deux questions différentes : le code est-il bon, et peut-on
 *    l'installer ;
 * 2. les **dimensions** — ce qui tire vers le haut, ce qui tire vers le
 *    bas, avec la barre pleine pour dire « là, agis » ;
 * 3. l'**hygiène** — une liste de critères nommés, présents ou absents :
 *    c'est la partie qui se corrige en cinq minutes ;
 * 4. les **points chauds** — les fichiers qui coûtent le plus, cliquables
 *    pour aller les corriger ;
 * 5. la **répartition** des fichiers — où ils se situent les uns par rapport
 *    aux autres, avec la moyenne et la médiane tracées dessus ;
 * 6. le **fichier ouvert** — sa note, et ses lignes problématiques.
 *
 * Tout est recalculé à partir du contenu déjà chargé : aucune requête,
 * aucun stockage, donc aucune migration à faire tourner. La seule exception
 * est la **courbe** ci-dessous, et elle est assumée : une note instantanée
 * se calcule sur les fichiers en mémoire, une trajectoire a besoin de
 * l'historique, donc de la base.
 */

function toneText(tone: Grade["tone"]): string {
  return tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-danger";
}

function toneBar(tone: Grade["tone"]): string {
  return tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-danger";
}

/** La barre d'une dimension : signal au-dessus de 0,7, warn entre, danger en bas. */
function dimensionTone(value: number): Grade["tone"] {
  if (value >= 0.7) return "ok";
  if (value >= 0.45) return "warn";
  return "danger";
}

/**
 * La marge (en points) en dessous de laquelle une note est dite **fragile** :
 * assez près d'une borne pour qu'une retouche du barème la fasse changer de
 * lettre. Le chiffre est un ordre de grandeur, pas un seuil mesuré — il sert à
 * décider d'un ton, pas d'un verdict.
 */
const BAND_TIGHT = 20;

/**
 * Ordre d'affichage des dimensions : le code d'abord (ce qui coûte le plus
 * à corriger), puis ce qui rend le dépôt reprenable.
 *
 * `repository` n'apparaît que sur la note du dépôt : la note du projet
 * répond à « le code est-il bon ? », celle du dépôt ajoute « peut-on
 * l'installer ? ». Ce sont deux questions, donc deux listes.
 */
const PROJECT_ORDER: ProjectDimension[] = [
  "complexity", "structure", "duplication", "coupling",
  "tests", "documentation", "security", "repository",
];

export function ScorePanel({
  files,
  openPath,
  openContent,
  onOpenFile,
  projectId,
  branch,
}: {
  files: FileEntry[];
  /** Fichier ouvert dans l'éditeur : on montre sa note en premier. */
  openPath?: string | null;
  openContent?: string;
  onOpenFile?: (path: string) => void;
  /**
   * Projet dont on trace l'historique. Absent, il n'y a pas de courbe —
   * et c'est ce qui garde ce panneau utilisable hors d'un dépôt (tests,
   * aperçu), sans requête ni branche morte.
   */
  projectId?: string;
  branch?: string;
}) {
  // Le score du dépôt ne dépend que des fichiers enregistrés — le brouillon
  // en cours n'y entre pas : ce qu'on note est ce qui est publié.
  const repo = useMemo(() => scoreRepo(files), [files]);

  const current = useMemo(
    () => (openPath && openContent !== undefined ? scoreFile(openPath, openContent) : null),
    [openPath, openContent],
  );

  if (files.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line-3 bg-surface-2 p-4">
        <p className="text-[12.5px] leading-snug text-chalk-3">
          Aucun fichier à noter.
        </p>
      </div>
    );
  }

  return (
    <div className="mo-slide space-y-3">
      <ScoreHeader repo={repo} />
      <ScoreHistoryCard projectId={projectId} branch={branch} />
      <DimensionsCard repo={repo} />
      <HygieneCard repo={repo} />
      <ActionsCard repo={repo} />
      <HotspotsCard repo={repo} onOpenFile={onOpenFile} />
      <DistributionCard repo={repo} />
      {current && <CurrentFileCard path={openPath!} file={current} />}
      <MethodCard repo={repo} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* En-tête : les deux notes                                            */
/* ------------------------------------------------------------------ */

function ScoreHeader({ repo }: { repo: RepoScore }) {
  return (
    <section className="relative overflow-hidden rounded-[var(--radius-card)] border
      border-line-2 bg-surface-2 p-4 shadow-sh-2">

      <div className="relative grid gap-4 sm:grid-cols-2">
        <BigScore
          caption="Note du projet"
          icon="target"
          score={repo.projectScore}
          grade={gradeFor(repo.projectScore)}
        />
        <BigScore
          caption="Note du dépôt"
          icon="package"
          score={repo.score}
          grade={repo.grade}
          secondary={`dont hygiène ${repo.hygieneScore}/1000`}
        />
      </div>
    </section>
  );
}

function BigScore({
  caption,
  icon,
  score,
  grade,
  secondary,
}: {
  caption: string;
  icon: IconName;
  score: number;
  grade: Grade;
  secondary?: string;
}) {
  const pct = Math.round((score / SCORE_MAX) * 100);
  return (
    <div className="min-w-0">
      <div className="prompt-label mb-2 flex items-center gap-1.5 text-chalk-4">
        <Icon name={icon} size={11} strokeWidth={1.8} />
        {caption}
      </div>
      <div className="flex items-end gap-2">
        <span className={`tnum font-display text-[2.2rem] font-bold leading-none ${toneText(grade.tone)}`}>
          {score}
        </span>
        <span className="label-micro pb-1 text-chalk-4">/ {SCORE_MAX}</span>
        <span className={`mb-1 ml-auto border px-2 py-0.5 font-mono text-[11px] font-bold ${toneText(grade.tone)}`}
          style={{ borderColor: "currentColor" }}>
          {grade.letter}
        </span>
      </div>
      {secondary && <p className="label-micro mt-1 text-chalk-4">{secondary}</p>}

      <div className="mt-2 h-[8px] w-full border border-line-2/30 bg-void/10">
        <div
          className={`h-full ${toneBar(grade.tone)} transition-[width] duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <GradeBandNote score={score} />
    </div>
  );
}

/**
 * Où la note se situe **dans sa bande** — la marge qui reste avant de basculer.
 *
 * Le bandeau de note ne dit que la lettre : « B » couvre cent points, et 741
 * comme 839 s'écrivent « B ». La marge dit lequel des deux — c'est elle qui
 * prévient qu'une retouche du barème, ou un seul commit, suffira à faire tomber
 * la lettre. C'est le pendant à l'écran des bandes de calibration du corpus
 * réel : le calcul de marge est le même (`checkBand`, `lib/scoring/bands.ts`),
 * appliqué ici aux bornes des notes plutôt qu'à celles du corpus.
 */
function GradeBandNote({ score }: { score: number }) {
  const { band, grade, next, below } = gradeBandFor(score);
  const check = checkBand(score, band);
  // Fragile : à moins de `BAND_TIGHT` de la borne basse, donc prêt à tomber.
  const fragile = check.marginLow <= BAND_TIGHT;

  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[10.5px] leading-snug">
      <span className="text-chalk-4">
        bande {grade.letter} {band.min}–{band.max}
      </span>
      <span aria-hidden className="text-chalk-4/40">·</span>
      {fragile && below ? (
        <span className="text-warn">
          à {check.marginLow} pt de tomber en {below.grade.letter}
        </span>
      ) : next ? (
        // La marche du dessus commence à `next.min` : la borne haute de la
        // bande courante vaut `next.min - 1`, donc il reste `next.min - score`.
        <span className="text-chalk-3">
          {next.min - score} pt avant {next.grade.letter}
        </span>
      ) : (
        <span className="text-ok">au sommet de l&apos;échelle</span>
      )}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* La courbe : le score commit par commit                             */
/* ------------------------------------------------------------------ */

/**
 * L'évolution du dépôt, du premier commit tracé au dernier.
 *
 * ## Pourquoi une courbe, et pas seulement une note
 *
 * Un chiffre dit où en est un dépôt ; une courbe dit comment il y est
 * arrivé, et si l'effort est régulier ou concentré. C'est aussi ce qui rend
 * la note difficile à falsifier : gonfler un instantané est facile, mentir
 * sur dix révisions successives ne l'est pas.
 *
 * ## Pourquoi la requête est ici et pas dans le parent
 *
 * Le panneau n'est monté que sur l'onglet « score » : charger l'historique
 * à ce moment-là est déjà du chargement paresseux, et cela évite de faire
 * payer vingt lectures d'instantanés à quelqu'un qui ouvre le dépôt pour
 * lire du code. C'est la même convention que les panneaux d'issues et de
 * demandes de fusion.
 */
/** L'historique vide, pour qu'une erreur reste de même nature qu'une donnée. */
const EMPTY_HISTORY: ScoreHistory = { points: [], total: 0, skipped: 0, reused: 0 };

function ScoreHistoryCard({ projectId, branch }: { projectId?: string; branch?: string }) {
  /**
   * Résultat **attaché à sa clé de requête**.
   *
   * Stocker un simple `{ history, failed }` forçait à réinitialiser l'état
   * en début d'effet — un `setState` synchron, que la règle
   * `react-hooks/set-state-in-effect` signale à raison. Ici, rien n'est
   * effacé au départ : la réponse du branchement précédent reste en mémoire,
   * ignorée jusqu'à ce que sa clé diffère. L'écran affiche donc
   * « lecture en cours » simplement parce qu'aucune réponse **à cette clé**
   * n'est encore arrivée — et une réponse tardive d'une autre branche ne
   * peut jamais s'afficher sous la branche courante.
   */
  const [result, setResult] = useState<
    { key: string; value: ScoreHistory; failed: boolean } | null
  >(null);

  const key = `${projectId ?? ""}#${branch ?? ""}`;

  useEffect(() => {
    if (!projectId) return;

    let alive = true;
    void fetchScoreHistory({ projectId, branch })
      .then((value) => {
        if (alive) setResult({ key, value, failed: false });
      })
      .catch(() => {
        // Un historique illisible ne doit pas effacer la note : on le dit,
        // et le reste du panneau continue de fonctionner.
        if (alive) setResult({ key, value: EMPTY_HISTORY, failed: true });
      });

    return () => {
      alive = false;
    };
  }, [projectId, branch, key]);

  if (!projectId) return null;

  // Une réponse d'une autre branche n'est pas **la** réponse de celle-ci.
  const current = result && result.key === key ? result : null;
  const points = current?.failed ? [] : (current?.value.points ?? []);
  // Ce que la courbe **ignore** : des révisions de la période sans
  // instantané, et un historique plus ancien que la fenêtre lue.
  const coverage = historyCoverage({
    traced: points.length,
    total: current?.failed ? 0 : (current?.value.total ?? 0),
    missing: current?.failed ? 0 : (current?.value.skipped ?? 0),
  });

  return (
    <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2 p-4">
      <h3 className="label mb-3 flex items-center justify-between text-chalk-3">
        <span className="flex items-center gap-1.5">
          <Icon name="chart" size={12} strokeWidth={1.8} />
          évolution
        </span>
        {current && !current.failed && points.length > 1 && (
          <span className="tnum text-chalk-4">
            {points.length} révision(s)
            {current.value.total > points.length ? ` sur ${current.value.total}` : ""}
          </span>
        )}
      </h3>

      {current?.failed && (
        <p className="text-[11.5px] leading-snug text-chalk-3">
          L&apos;historique n&apos;a pas pu être lu. La note ci-dessous reste valable :
          elle ne dépend que des fichiers enregistrés.
        </p>
      )}

      {!current && (
        <p className="text-[11.5px] leading-snug text-chalk-4">Lecture de l&apos;historique…</p>
      )}

      {/* L'avertissement passe **avant** le tracé : une courbe qui saute des
          révisions doit le dire avant qu'on la lise, pas dans une note de bas
          de page. */}
      {current && !current.failed && <CoverageWarning coverage={coverage} />}

      {current && !current.failed && points.length < 2 && (
        <p className="mt-3 text-[11.5px] leading-snug text-chalk-3">
          Une révision enregistrée : une courbe a besoin d&apos;au moins deux points pour
          dire quelque chose.
        </p>
      )}

      {points.length >= 2 && current && !current.failed && (
        <>
          <ScoreCurve
            scores={points.map((p) => p.score)}
            label={`Score de ${points[0].score} à ${points[points.length - 1].score} sur ${points.length} révisions`}
            grid
          />
          <HistorySummary points={points} reused={current.value.reused} />
        </>
      )}
    </section>
  );
}

/**
 * Ce que la courbe **ignore**, dit avant qu'on la lise.
 *
 * Une courbe de score ne trace que les révisions dont un instantané a été
 * enregistré, et elle les espace régulièrement : deux points voisins peuvent
 * donc être séparés de trois révisions, dont aucune n'apparaît. Rien dans le
 * dessin ne le dit — il faudrait compter les révisions et lire les dates pour
 * s'en apercevoir, c'est-à-dire faire le travail que la courbe est censée
 * éviter.
 *
 * L'avertissement est donc explicite, et il ne dit pas « certaines révisions
 * n'ont pas d'instantané » : il dit combien, sur combien, et ce que ça change
 * à la lecture. Un avertissement qui ne dit pas ce qu'il ignore ne laisse que
 * l'inquiétude.
 */
function CoverageWarning({ coverage }: { coverage: HistoryCoverage }) {
  if (coverage.complete) return null;

  const window = coverage.traced + coverage.missing;

  return (
    <div className="mt-3 flex items-start gap-2 rounded-[var(--radius-input)] border
      border-warn/40 bg-warn/8 p-2.5">
      <Icon name="info" size={12} strokeWidth={1.8} className="mt-0.5 shrink-0 text-warn" />

      <div className="min-w-0 space-y-1">
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-warn">
          la courbe ne trace pas tout
        </p>

        {coverage.missing > 0 && (
          <p className="text-[11px] leading-snug text-chalk-3">
            {coverage.missing} révision(s) de la période n&apos;ont pas d&apos;instantané :
            elles sont absentes du tracé, et une absence n&apos;est pas un zéro.
          </p>
        )}

        {coverage.untraced > 0 && (
          <p className="text-[11px] leading-snug text-chalk-3">
            la courbe ne remonte qu&apos;aux {window} révision(s) les plus récentes :{" "}
            {coverage.untraced} révision(s) plus ancienne(s) ne sont pas lues.
          </p>
        )}

        <p className="text-[11px] leading-snug text-chalk-4">
          {coverage.missing > 0
            ? "Un écart entre deux points peut donc couvrir plusieurs révisions : c'est ce que la courbe ne dit pas."
            : "Le début du dépôt n'est donc pas dans le dessin."}
        </p>
      </div>
    </div>
  );
}

/**
 * Les chiffres sous la courbe, et les dernières révisions.
 *
 * La courbe est un dessin ; ces lignes sont ce qu'on peut vérifier. On y
 * met le point de départ, le dernier, l'écart — et le détail des révisions
 * récentes, avec le nombre de fichiers modifiés, qui explique d'où vient une
 * marche dans le tracé.
 */
function HistorySummary({
  points,
  reused,
}: {
  points: HistoryPoint[];
  reused: number;
}) {
  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.score - first.score;
  const deltaTone = delta > 0 ? "text-ok" : delta < 0 ? "text-danger" : "text-chalk-3";

  // Les chiffres de la trajectoire : moyenne, médiane, étendue, dispersion,
  // et le **verdict** qui les résume. Le calcul vit dans `lib/scoring/trend.ts`
  // et s'y vérifie en Node ; ici, on ne fait que l'écrire.
  const stats = useMemo(() => historyStats(points.map((p) => p.score)), [points]);
  const drift = `${stats.delta > 0 ? "+" : ""}${stats.delta}`;
  const rate = `${stats.delta > 0 ? "+" : "−"}${frNumber(Math.abs(stats.slope))}`;

  // Les cinq dernières révisions, de la plus récente à la plus ancienne,
  // chacune avec l'écart **depuis la précédente** : c'est ce qui explique
  // une marche dans la courbe, là où le score seul la constate.
  const recent = points
    .map((point, index) => ({
      point,
      step: index > 0 ? point.score - points[index - 1].score : 0,
    }))
    .reverse()
    .slice(0, 5);

  return (
    <>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line-2/20 pt-3">
        <span className="label-micro text-chalk-4">
          départ <span className="tnum text-chalk-2">{first.score}</span> ({first.grade})
        </span>
        <span className="label-micro text-chalk-4">
          maintenant <span className={`tnum ${toneText(gradeFor(last.score).tone)}`}>{last.score}</span> ({last.grade})
        </span>
        <span className={`tnum label-micro ${deltaTone}`}>
          {delta > 0 ? `+${delta}` : String(delta)} point(s)
        </span>
      </div>

      {/* Les repères tracés sur la courbe, nommés : un trait pointillé sans
          légende est une décoration, pas une information. */}
      <div className="mt-1.5 space-y-1.5">
        <GuideLegend label="moyenne" value={stats.mean} tone={MEAN_TONE} dash={MEAN_DASH} />
        <GuideLegend label="médiane" value={stats.median} tone={MEDIAN_TONE} dash={MEDIAN_DASH} />
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {[
          ["min", String(stats.min)],
          ["max", String(stats.max)],
          ["écart-type", frNumber(stats.stddev, 0)],
          ["points", String(stats.count)],
        ].map(([label, value]) => (
          <div key={label}>
            <dd className="tnum font-mono text-[12px] font-bold text-chalk-2">{value}</dd>
            <dt className="label-micro mt-0.5 text-chalk-4">{label}</dt>
          </div>
        ))}
      </dl>

      {/* Le verdict, avec la comparaison qui le justifie : « +40 points » ne
          dit pas si le dépôt progresse ou s'il tremble. Le texte dit donc
          toujours à quoi la dérive a été comparée — sans quoi celui qui lit
          n'a aucun moyen de contester le verdict. */}
      <TrendNote trend={stats.trend} className="mt-2">
        {stats.trend === "stable"
          ? stats.noise < 0.5
            ? `la dérive de ${drift} point(s) sur ${stats.count} révisions est trop petite pour être une tendance.`
            : `la dérive de ${drift} point(s) sur ${stats.count} révisions reste dans ce que le bruit (±${frNumber(stats.noise, 0)} par révision) peut produire tout seul.`
          : stats.noise < 0.5
            ? `${drift} point(s) sur ${stats.count} révisions, soit ${rate} pt par révision, sans à-coup d'une révision à l'autre.`
            : `${drift} point(s) sur ${stats.count} révisions, soit ${rate} pt par révision — plus que ce que le bruit (±${frNumber(stats.noise, 0)} par révision) produirait.`}
      </TrendNote>

      <ul className="mt-2 space-y-1">
        {recent.map(({ point, step }) => {
          return (
            <li key={point.sha} className="flex items-baseline gap-2">
              <span className="tnum w-[4ch] shrink-0 text-right font-mono text-[11.5px] font-bold text-chalk-2">
                {point.score}
              </span>
              <span className={`tnum w-[4ch] shrink-0 font-mono text-[10.5px] ${step > 0 ? "text-ok" : step < 0 ? "text-danger" : "text-chalk-4"}`}>
                {step === 0 ? "—" : step > 0 ? `+${step}` : String(step)}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-chalk-4">{point.sha.slice(0, 7)}</span>
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-chalk-4">
                {point.at.slice(0, 10)} · {point.changedFiles} fichier(s) · {point.sloc} ligne(s)
              </span>
            </li>
          );
        })}
      </ul>

      {/* Ce qui a été **ignoré** (révisions sans instantané, historique plus
          ancien que la fenêtre lue) n'est plus dit ici : c'est un
          avertissement, et il est au-dessus du tracé, là où on lit la
          courbe. Ici ne reste que le cache, qui n'est pas un manque. */}
      {reused > 0 && (
        <p className="mt-2 text-[10.5px] leading-snug text-chalk-4">
          {reused} fichier(s) inchangés réutilisés depuis le cache.
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Dimensions                                                          */
/* ------------------------------------------------------------------ */

function DimensionsCard({ repo }: { repo: RepoScore }) {
  const rows = PROJECT_ORDER.map((key) => {
    // `null` = pas de mesure (aucune fonction, aucun lien d'import) : on
    // l'affiche comme tel plutôt que comme un zéro, qui se lirait comme
    // une faute alors que ce n'est qu'une absence.
    const raw = repo.dimensions[key];
    return { key, label: DIMENSION_LABELS[key] ?? key, value: raw };
  });

  return (
    <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2 p-4">
      <h3 className="label mb-3 flex items-center gap-1.5 text-chalk-3">
        <Icon name="chart" size={12} strokeWidth={1.8} />
        dimensions
      </h3>

      <ul className="space-y-2.5">
        {rows.map(({ key, label, value }) => {
          if (value === null || value === undefined) {
            return (
              <li key={key} className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11.5px] text-chalk-2">{label}</span>
                <span className="label-micro text-chalk-4">non mesurée</span>
              </li>
            );
          }
          const pct = Math.round(value * 100);
          const tone = dimensionTone(value);
          return (
            <li key={key}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11.5px] text-chalk-2">{label}</span>
                <span className="tnum label-micro text-chalk-4">{pct}%</span>
              </div>
              <div className="h-[6px] w-full border border-line-2/25 bg-void/10">
                <div
                  className={`h-full ${toneBar(tone)} transition-[width] duration-500`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {repo.caps.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line-2/20 pt-3">
          {repo.caps.map((cap) => (
            <li key={cap.id} className="flex items-start gap-1.5 text-[11.5px] text-warn">
              <Icon name="flag" size={11} strokeWidth={1.8} className="mt-0.5 shrink-0" />
              plafond : {cap.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Hygiène de dépôt                                                    */
/* ------------------------------------------------------------------ */

function HygieneCard({ repo }: { repo: RepoScore }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2 p-4">
      <h3 className="label mb-3 flex items-center justify-between text-chalk-3">
        <span className="flex items-center gap-1.5">
          <Icon name="package" size={12} strokeWidth={1.8} />
          hygiène de dépôt
        </span>
        <span className="tnum text-chalk-4">{repo.hygieneScore}/1000</span>
      </h3>

      <ul className="space-y-2">
        {repo.hygiene.map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            <Icon
              name={item.present ? "check" : "close"}
              size={12}
              strokeWidth={2}
              className={`mt-0.5 shrink-0 ${item.present ? "text-ok" : "text-chalk-4"}`}
            />
            <div className="min-w-0">
              <p className={`font-mono text-[11.5px] ${item.present ? "text-chalk-2" : "text-chalk-3"}`}>
                {item.label}
              </p>
              {/* Ce qui a été vérifié : un critère se juge par son contenu,
                  pas par la présence d'un fichier. */}
              <p className="text-[10.5px] leading-snug text-chalk-4">{item.evidence}</p>
            </div>
            <span className="tnum ml-auto shrink-0 text-[10.5px] text-chalk-4">
              +{Math.round(item.weight * 1000)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Les actions qui rapportent le plus de points                        */
/* ------------------------------------------------------------------ */

/**
 * Un score sur 1000 qui ne dit pas *quoi faire* reste un verdict.
 *
 * Chaque ligne donne le gain estimé — recalculé en rejouant la moyenne
 * pondérée avec la dimension corrigée, donc vérifiable — et renvoie à
 * `fichier:ligne` quand le défaut est localisable. C'est la différence
 * entre « ton projet vaut 640 » et « ajoute une étape de test dans le CI :
 * +42 points ».
 */
function ActionsCard({ repo }: { repo: RepoScore }) {
  if (repo.actions.length === 0) return null;

  return (
    <section className="rounded-[var(--radius-card)] border border-signal/40 bg-surface-2 p-4">
      <h3 className="label mb-3 flex items-center gap-1.5 text-chalk-3">
        <Icon name="spark" size={12} strokeWidth={1.8} />
        à faire en premier
      </h3>

      <ul className="space-y-3">
        {repo.actions.map((action) => (
          <li key={action.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11.5px] leading-snug text-chalk-2">{action.label}</span>
              <span className="tnum shrink-0 font-mono text-[11.5px] font-bold text-ok">
                +{action.gain}
              </span>
            </div>
            {action.where.length > 0 && (
              <ul className="mt-1 space-y-0.5 border-l border-line-2/40 pl-2">
                {action.where.map((where) => (
                  <li key={where} className="truncate font-mono text-[10.5px] text-chalk-4">
                    {where}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Points chauds                                                       */
/* ------------------------------------------------------------------ */

function HotspotsCard({ repo, onOpenFile }: { repo: RepoScore; onOpenFile?: (path: string) => void }) {
  if (repo.hotspots.length === 0) return null;

  return (
    <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2 p-4">
      <h3 className="label mb-3 flex items-center gap-1.5 text-chalk-3">
        <Icon name="flag" size={12} strokeWidth={1.8} />
        à corriger en priorité
      </h3>
      <ul className="space-y-1.5">
        {repo.hotspots.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              onClick={() => onOpenFile?.(f.path)}
              disabled={!onOpenFile}
              className="flex w-full items-center gap-2 text-left disabled:cursor-default"
            >
              <span className={`tnum w-[4ch] shrink-0 text-right font-mono text-[12px] font-bold ${toneText(f.grade.tone)}`}>
                {f.score}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-chalk-2">
                {f.path}
              </span>
              <span className="label-micro shrink-0 text-chalk-4">{f.grade.letter}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Répartition des fichiers                                            */
/* ------------------------------------------------------------------ */

/**
 * Où se situent les fichiers les uns par rapport aux autres.
 *
 * Une note de dépôt est une **moyenne** de fichiers, et une moyenne cache
 * exactement ce qu'on veut savoir : un dépôt à 720 peut être vingt fichiers
 * propres ou dix-huit fichiers propres et deux catastrophiques. La
 * répartition le dit d'un regard, la moyenne et la médiane tracées dessus
 * disent **lesquelles** des deux lectures est la bonne — vingt points
 * d'écart entre les deux, et ce sont des cas extrêmes qui portent la note.
 *
 * L'histogramme est calculé dans `lib/scoring/curve.ts` : les classes, les
 * hauteurs et la position des repères s'y vérifient en Node, y compris les
 * cas qui produisent des barres invisibles — une classe à un fichier sur
 * deux cents doit rester un trait, sans quoi l'information cherchée est
 * précisément celle qui disparaît.
 */
function DistributionCard({ repo }: { repo: RepoScore }) {
  const width = 100;
  const height = 30;

  const scores = useMemo(() => repo.files.map((f) => f.score), [repo.files]);
  const geo = useMemo(
    () => histogramGeometry(scores, { width, height, bins: 8 }),
    [scores],
  );

  // Un fichier unique : une barre unique, une moyenne égale à la médiane
  // égale au fichier. Il n'y a pas de répartition à montrer.
  if (scores.length < 2) return null;

  const flat = geo.max <= geo.min;

  return (
    <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2 p-4">
      <h3 className="label mb-3 flex items-center justify-between gap-2 text-chalk-3">
        <span className="flex items-center gap-1.5">
          <Icon name="chart" size={12} strokeWidth={1.8} />
          répartition des fichiers
        </span>
        <span className="tnum shrink-0 text-chalk-4">{scores.length} notés</span>
      </h3>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Notes de ${scores.length} fichiers réparties de ${geo.min} à ${geo.max}, médiane ${Math.round(geo.median)}`}
        className="h-[52px] w-full text-signal"
      >
        {/* Une classe vide ne se dessine pas : une barre de hauteur nulle
            n'est pas une donnée, c'est un vide, et les confondre revient à
            compter deux fois l'intervalle où il n'y a rien. */}
        {geo.bars
          .filter((bar) => bar.count > 0)
          .map((bar) => (
            <rect
              key={bar.from}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              fill="currentColor"
              fillOpacity={0.55}
            >
              <title>
                {`${bar.count} fichier(s) entre ${Math.round(bar.from)} et ${Math.round(bar.to)}`}
              </title>
            </rect>
          ))}

        {geo.meanX !== null && (
          <line
            x1={geo.meanX}
            x2={geo.meanX}
            y1={0}
            y2={height}
            className={MEAN_TONE}
            stroke="currentColor"
            strokeWidth={1.2}
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
            opacity={0.9}
          />
        )}
        {geo.medianX !== null && (
          <line
            x1={geo.medianX}
            x2={geo.medianX}
            y1={0}
            y2={height}
            className={MEDIAN_TONE}
            stroke="currentColor"
            strokeWidth={1.2}
            strokeDasharray="1 2.5"
            vectorEffect="non-scaling-stroke"
            opacity={0.9}
          />
        )}
      </svg>

      <div className="mt-1 flex items-baseline justify-between font-mono text-[10px] text-chalk-4">
        <span className="tnum">{geo.min}</span>
        <span>
          {flat
            ? "toutes au même niveau"
            : `${geo.bars.length} classe(s) de ${Math.round((geo.max - geo.min) / geo.bars.length)} point(s)`}
        </span>
        <span className="tnum">{geo.max}</span>
      </div>

      <div className="mt-2 border-t border-line-2/20 pt-2">
        <GuideLegend label="moyenne" value={geo.mean} tone={MEAN_TONE} dash={MEAN_DASH} />
        <GuideLegend label="médiane" value={geo.median} tone={MEDIAN_TONE} dash={MEDIAN_DASH} />
        <p className="mt-2 text-[10.5px] leading-snug text-chalk-4">
          {Math.abs(geo.mean - geo.median) < 25
            ? "Moyenne et médiane se confondent : les fichiers se valent, la note du dépôt ne tient pas à quelques cas extrêmes."
            : "Moyenne et médiane s'écartent : des fichiers extrêmes tirent la note, et la médiane dit mieux où se situe le dépôt."}
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Fichier ouvert                                                      */
/* ------------------------------------------------------------------ */

function CurrentFileCard({
  path,
  file,
}: {
  path: string;
  file: ReturnType<typeof scoreFile>;
}) {
  // Les lignes les plus coûteuses, hors lignes vides : c'est la liste de
  // courses de la relecture.
  const worst = useMemo(() => {
    return file.lines
      .map((l, i) => ({ ...l, number: i + 1 }))
      .filter((l) => l.score < SCORE_MAX && l.kind !== "blank")
      .sort((a, b) => a.score - b.score)
      .slice(0, 6);
  }, [file]);

  return (
    <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2 p-4">
      <h3 className="label mb-3 flex items-center justify-between gap-2 text-chalk-3">
        <span className="flex items-center gap-1.5">
          <Icon name="file" size={12} strokeWidth={1.8} />
          fichier ouvert
        </span>
        <span className={`tnum shrink-0 ${toneText(file.grade.tone)}`}>
          {file.score}/1000 · {file.grade.letter}
        </span>
      </h3>

      <p className="mb-2 truncate font-mono text-[11px] text-chalk-4">{path}</p>

      <p className="mb-3 font-mono text-[11.5px] leading-snug text-chalk-3">
        {file.metrics.sloc} lignes de code · {file.metrics.functions.length} fonction
        {file.metrics.functions.length > 1 ? "s" : ""} · complexité {file.metrics.cyclomatic}
        {file.metrics.maintainability !== null && (
          <> · maintenabilité {Math.round(file.metrics.maintainability)}/100</>
        )}
        {isTestPath(path) && <span className="ml-1 text-signal">· test</span>}
        {file.metrics.confidence === "heuristic" && (
          <span className="ml-1 text-chalk-4">· masquage heuristique</span>
        )}
      </p>

      {worst.length === 0 ? (
        <p className="flex items-center gap-1.5 font-mono text-[11.5px] text-ok">
          <Icon name="check" size={12} strokeWidth={2} />
          aucune ligne ne coûte de points.
        </p>
      ) : (
        <ul className="space-y-1">
          {worst.map((l) => (
            <li key={l.number} className="flex items-baseline gap-2">
              <span className="tnum w-8 shrink-0 text-right font-mono text-[11px] text-chalk-4">
                {l.number}
              </span>
              <span className="tnum shrink-0 font-mono text-[11px] text-warn">{l.score}</span>
              <span className="min-w-0 truncate text-[11px] text-chalk-3">
                {l.reasons.join(" · ") || "ligne signalée"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Méthode                                                             */
/* ------------------------------------------------------------------ */

function MethodCard({ repo }: { repo: RepoScore }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2 p-4">
      <h3 className="label mb-3 flex items-center gap-1.5 text-chalk-3">
        <Icon name="info" size={12} strokeWidth={1.8} />
        mesures
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {[
          ["Fichiers notés", repo.metrics.scored],
          ["Lignes de code", repo.metrics.sloc],
          ["Fonctions", repo.metrics.functions],
          ["Complexité totale", repo.metrics.cyclomatic],
          ["Maintenabilité moyenne", `${Math.round(repo.metrics.maintainability)}/100`],
          ["Langages", repo.metrics.languages],
          ["Code recopié", `${Math.round(repo.metrics.duplicateShare * 100)} %`],
          ["Cycles d'imports", repo.metrics.cyclicFiles],
          ["Fichiers jamais importés", repo.metrics.orphanFiles],
          ["Analyse", repo.metrics.confidence === "lexer" ? "lexicale" : "heuristique"],
        ].map(([label, value]) => (
          <div key={label as string}>
            <dd className="tnum font-display text-[1rem] font-bold leading-none text-chalk-2">
              {value as number | string}
            </dd>
            <dt className="label-micro mt-1 text-chalk-4">{label as string}</dt>
          </div>
        ))}
      </dl>

      {repo.strengths.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line-2/20 pt-3">
          {repo.strengths.map((s) => (
            <li key={s} className="flex items-start gap-1.5 text-[11.5px] text-chalk-2">
              <Icon name="spark" size={11} strokeWidth={1.8} className="mt-0.5 shrink-0 text-ok" />
              {s}
            </li>
          ))}
        </ul>
      )}

      {repo.weaknesses.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line-2/20 pt-3">
          {repo.weaknesses.map((s) => (
            <li key={s} className="flex items-start gap-1.5 text-[11.5px] text-chalk-2">
              <Icon name="flag" size={11} strokeWidth={1.8} className="mt-0.5 shrink-0 text-warn" />
              {s}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
