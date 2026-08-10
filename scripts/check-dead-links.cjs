#!/usr/bin/env node
/**
 * check-dead-links.cjs
 *
 * Scans Markdown files across the configured scopes and reports broken internal links.
 * - Internal links: resolved relative to the source file, existence checked with fs.existsSync
 * - Anchor links: heading normalisation applied, presence checked in the target file
 * - External URLs (https?://): listed separately, not fetched
 *
 * Exit code 0 — no broken internal links
 * Exit code 1 — one or more broken internal links detected
 *
 * Usage:
 *   node scripts/check-dead-links.cjs [--dir <path>] [--verbose]
 *
 * Périmètre par défaut (T6.6) : les docs publiques de `@geoleaf/core` (récursif) PLUS
 * le markdown de la RACINE (profondeur 0). `--dir <path>` force un scope unique.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const dirArgIdx = args.indexOf("--dir");
const CWD = process.cwd();
const registry = require("./lib/packages.cjs");
const docsPaths = require("./lib/docs-paths.cjs");
// Ancré au SCRIPT, jamais à `process.cwd()` : le périmètre racine doit être le même
// quel que soit le répertoire d'invocation.
const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * T6.6 — le périmètre par défaut compte DEUX scopes, plus un seul.
 *
 * Le markdown de la RACINE n'était scanné par rien, et ce trou coûtait quatre 404 bien
 * réels dans le README public : `packages/core/docs/poi/GeoLeaf_POI_README.md`
 * (supprimé au `54b5651b`, sous-système POI dissous au S9) et trois `LICENCE` pour
 * `LICENSE`. C'est le rejeu exact de `b3d85253`/`MIGRATION_V1_V2.md` — le défaut qui a
 * fait câbler cette gate au S7bis.10 — un cran plus haut.
 *
 * ⚠️ `depth: 0` sur la racine n'est pas un raccourci, c'est LE contrat : récurser depuis
 * la racine descendrait dans `.git/`, `docs-dist/`, `coverage/`, `deploy/`,
 * `_archive_local/` et `.claude/worktrees/`. Leur donner une liste d'exclusion serait
 * une énumération non bornée qui pourrit en silence — la classe de défaut que T3 a
 * passé son sprint à fermer. `node_modules/` fait exception et est sauté par `walkDir`
 * lui-même : voir le motif sur la fonction.
 *
 * ## 31/07/2026 — B-09 seconde moitié : les README de paquets ENTRENT au périmètre
 *
 * ⚠️ Ce bloc a porté jusqu'au 31/07 le motif inverse (« DÉLIBÉRÉMENT non étendu à
 * `packages/*​/README.md` »), et **ce motif est tombé** — mode d'échec n° 6 du §Pré-vol de
 * `CLAUDE.md` : la cible existait toujours, c'est la contrainte qui avait disparu. Il est
 * conservé ici plutôt que supprimé, parce qu'il dit ce qui bloquait et donc ce qu'il a
 * fallu traiter.
 *
 * Ancien motif : `packages/core/README.md` pointait `docs/api/index.html`, artefact TypeDoc
 * **gitignoré** et **exclu du tarball** (`files[]` porte `!docs/api/`) — donc absent d'un
 * clone frais ET du paquet publié. Gater ce fichier l'aurait rendu rouge en permanence.
 *
 * Ce qui a changé : la **cible** a été traitée, pas le générateur. `packages/core/README.md`
 * est réécrit en vitrine + pointeurs et renvoie désormais vers la référence API **par son
 * URL publique**, idiome que `packages/core/docs/README.md:13` appliquait déjà. Il ne reste
 * aucun lien vers un artefact généré, donc plus rien à attendre d'un clone frais.
 *
 * ⚠️ Et le trou que cette exclusion laissait n'était pas théorique. Mesuré au câblage, sur
 * des fichiers qu'AUCUNE gate ne voyait : `packages/core/README.md` renvoyait vers
 * `docs/poi/GeoLeaf_POI_README.md` (sous-système dissous au S9) — le rejeu **exact** du
 * défaut qui a fait câbler cette gate, un cran plus bas ; trois README de plugins publiés
 * portaient `[LICENSE](../../LICENSE)`, qui résout `packages/LICENSE` et n'existe **ni sur
 * GitHub ni dans le tarball** ; et `addpoi/docs/` portait 5 ancres de sommaire mortes.
 *
 * Périmètre ajouté, tout **dérivé de `lib/packages.cjs`** — jamais un glob `packages/**`,
 * qui capterait les artefacts générés (`core/node_modules`, `core/dist`) :
 *
 *   README des paquets   `<paquet>/*.md` à profondeur 0, les 18 du registre
 *   docs des paquets     `<paquet>/docs/` récursif (aujourd'hui `addpoi`, `offline-ui`)
 *   `.github/`           CODE_OF_CONDUCT · SECURITY · copilot-instructions — la vitrine
 *                        que GitHub affiche dans ses propres onglets
 *   `e2e/`               procédure qu'on exécute, donc état COURANT
 *   `_plugin-template/`  le SCAFFOLD : un lien mort y est re-semé dans chaque plugin futur.
 *                        Hors `workspaces` (`!packages/_*`), donc absent du registre —
 *                        c'est le seul chemin nommé en dur ici, et il l'est pour ça.
 *
 * Aucun script npm ni câblage de CI n'est ajouté : le périmètre change, le nom
 * `check:links` ne change pas. Un `check:links:root` séparé, ce serait trois câblages
 * de plus à ne pas oublier (`ci.yml`, `ci-local.cjs`, `.husky/pre-commit`) et un
 * quatrième point de désynchronisation.
 *
 * ## B-09 (27/07/2026) — la doc INTERNE entre dans le périmètre, par scopes explicites
 *
 * Second angle mort de B-09 : `_docs_projet/` — le plus gros corpus du dépôt, et celui que
 * chaque session lit — n'était vu par rien. Il a coûté cher deux fois dans la seule journée
 * du 27/07 : un lien frère entre deux specs de `specs/contrats/`, et **20 liens morts dans
 * les deux registres permanents**, cassés par leur propre déplacement de `travail/rapports/`
 * vers `registres/` (7 × `../../archives/` au lieu de `../archives/`). Ce sont les documents
 * qui ORIENTENT le travail : un lien mort y coûte plus qu'ailleurs.
 *
 * ⚠️ **`_docs_projet/` n'est PAS ajouté en bloc, et ce n'est pas de la prudence.** Mesuré :
 * `archives/` seul rend **1 175 liens morts** — et ils sont LÉGITIMES. Un document d'archive
 * pointe vers le code de sa date, code supprimé depuis ; le « réparer » en ferait un faux
 * témoignage (règle énoncée dans `_docs_projet/archives/README.md`). B-09 le dit déjà :
 * ce sont des ENREGISTREMENTS, à exclure par conception.
 *
 * Sont donc gatés les seuls répertoires dont le contenu prétend décrire l'état COURANT :
 *
 *   `_docs_projet/` (depth 0)   ETAT · JOURNAL · INDEX · les 2 checklists
 *   `specs/`                    le gelé — c'est là que vivent les liens frères
 *   `registres/`                les listes vivantes qui orientent le travail
 *   `reference/`                le généré et le lu-par-un-programme
 *   `travail/roadmaps/`         les roadmaps actives
 *
 * Restent hors périmètre, délibérément : `archives/` (ci-dessus), et
 * `travail/{audits,cdc,rapports}` — daté et périssable, dont `cdc/` qui est de la matière
 * première en cours de consommation.
 *
 * **Vert au câblage** (les 5 scopes à 0), donc **pas de baseline** — même régime que
 * `check-orphan-exports`. La gate ne peut mordre que sur une régression neuve.
 *
 * ## 10/08/2026 — la SCISSION : 7 scopes de doc interne deviennent 3 scopes publics
 *
 * ⚠️ **Le paragraphe ci-dessus décrit un périmètre qui n'existe plus, et il est conservé
 * parce qu'il dit ce qui a été gaté et pourquoi.** La doc se partage en deux racines
 * (`lib/docs-paths.cjs`) : `docs/` part dans le dépôt public, `_docs_projet/` reste à
 * l'atelier. Le périmètre suit la partition, pas l'ancien répertoire.
 *
 *   RETARGÉS sur `docs/`, **avec `mustNotBeEmpty`** : `specs/` · `reference/` · `guides/`
 *   RETIRÉS : la racine `_docs_projet/` (depth 0) · `registres/` · `vision/` ·
 *             `travail/roadmaps/`
 *
 * Les 4 retirés ne sont pas une perte de couverture consentie à la légère : ils gatent un
 * corpus qui **ne sera pas dans le clone public**, et un scope dont le répertoire est
 * absent sort vert en n'ayant rien lu — exactement la panne que les 3 assertions
 * ci-dessous interdisent désormais côté public. Le jour où la doc interne se re-gate, ce
 * sera dans son propre dépôt, avec `--dir`.
 *
 * 🛑 **Aucun des 7 ne portait `mustNotBeEmpty`** — vérifié avant de déplacer quoi que ce
 * soit. Un déplacement fait sans poser les 3 assertions d'abord aurait fait passer
 * `Scanned 172` à ~110 **sans qu'aucune ligne ne rougisse**.
 *
 * ⚠️ **Angle mort connu, non fermé ici** : la forme **badge** (une image imbriquée dans un
 * lien) échappe à la regex — c'est la dette **D-13** du registre, mesurée et acceptée. Elle
 * devient visible dans ce nouveau périmètre ; ne pas la confondre avec une régression.
 */
const SCOPES =
    dirArgIdx >= 0
        ? [{ dir: path.resolve(CWD, args[dirArgIdx + 1]), depth: Infinity, label: "--dir" }]
        : [
              // T5.5 — le défaut vient du registre, qui jette.
              {
                  dir: path.join(registry.requireByDirName("core").absDir, "docs"),
                  depth: Infinity,
                  label: "docs publiques",
              },
              { dir: REPO_ROOT, depth: 0, label: "markdown de la racine" },
              // ── 10/08/2026 — la doc se SCINDE, et le périmètre suit la scission
              //
              // Les 7 scopes `_docs_projet/` de B-09 deviennent 3, et les 3 changent de
              // NATURE : ils décrivent désormais une surface PUBLIÉE, donc chacun porte son
              // assertion anti-gate-vide. Les 4 autres (racine de la doc interne, `registres/`,
              // `vision/`, `travail/roadmaps/`) sont RETIRÉS : ce qui reste sous
              // `_docs_projet/` ne part pas dans le dépôt public, et un scope qui gate un
              // corpus absent du clone est un scope qui sortira vert en ne lisant rien.
              //
              // 🛑 Aucun des 7 ne portait `mustNotBeEmpty`, et c'est ce trou qui rendait le
              // déplacement dangereux : `walkDir` rend `[]` sur un répertoire absent (voir
              // son garde :265-267), donc la gate aurait annoncé « 0 lien mort » sur ~60
              // fichiers en moins, en sortant 0. Une gate ne perd pas sa cible en rougissant,
              // elle se tait — d'où les trois assertions ci-dessous.
              {
                  dir: docsPaths.specs(),
                  depth: Infinity,
                  label: "specs",
                  mustNotBeEmpty: true,
              },
              {
                  dir: docsPaths.reference(),
                  depth: Infinity,
                  label: "reference",
                  mustNotBeEmpty: true,
              },
              // Ajouté le 27/07/2026 avec la sortie de la zone : un guide décrit une procédure
              // qu'on exécute, donc l'état COURANT. 16 liens morts au câblage, tous corrigés
              // avant de brancher — vert, sans baseline, comme les autres scopes.
              {
                  dir: docsPaths.guides(),
                  depth: Infinity,
                  label: "guides",
                  mustNotBeEmpty: true,
              },
              // ── 31/07/2026 — les surfaces PRODUIT (voir l'en-tête, B-09 seconde moitié)
              //
              // Deux scopes SYNTHÉTIQUES : leur liste de fichiers est calculée depuis le
              // registre plutôt que marchée depuis un répertoire. Les déclarer en 18 entrées
              // rendrait la ligne de périmètre illisible, et surtout un paquet sans `.md` à
              // sa racine ferait alors sortir un scope vide sans que ce soit un défaut.
              {
                  label: "README des paquets",
                  files: registry
                      .all()
                      .flatMap((p) => walkDir(p.absDir, (f) => f.endsWith(".md"), 0)),
                  // Ce que l'assertion ci-dessous vérifie, et pourquoi elle n'est pas
                  // circulaire : l'oracle est `fs.existsSync` sur `<paquet>/README.md`, la
                  // chose testée est la construction du scope. Un `path.join` faux ou une
                  // profondeur qui dérape laisse le fichier sur le disque et hors du scan —
                  // exactement la panne que `packages.cjs` refuse de laisser silencieuse.
                  mustContain: registry
                      .all()
                      .map((p) => path.join(p.absDir, "README.md"))
                      .filter((f) => fs.existsSync(f)),
              },
              {
                  label: "docs des paquets",
                  files: registry
                      .all()
                      .flatMap((p) =>
                          walkDir(path.join(p.absDir, "docs"), (f) => f.endsWith(".md"))
                      ),
                  mustNotBeEmpty: true,
              },
              {
                  dir: path.join(REPO_ROOT, ".github"),
                  depth: Infinity,
                  label: "vitrine GitHub",
                  mustNotBeEmpty: true,
              },
              {
                  dir: path.join(REPO_ROOT, "e2e"),
                  depth: Infinity,
                  label: "e2e",
                  mustNotBeEmpty: true,
              },
              {
                  dir: path.join(REPO_ROOT, "packages", "_plugin-template"),
                  depth: Infinity,
                  label: "scaffold plugin",
                  mustNotBeEmpty: true,
              },
          ];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk a directory and return all files matching the predicate.
 *
 * ⚠️ `node_modules/` est sauté, et c'est le SEUL nom exclu. L'en-tête de ce fichier
 * affirmait déjà que le marcheur n'y descend pas ; c'était faux, et la mesure du 31/07 le
 * dit : `--dir packages/build-config` rendait **36 liens morts, tous dans `node_modules`**
 * — un vhost de gate qui crie au loup sur du code tiers. Inoffensif tant que les scopes
 * configurés n'en contenaient pas ; bloquant dès qu'on ajoute des racines de paquets, et
 * déjà nuisible pour l'opérateur, à qui la recette de la refonte V3 fait justement lancer
 * `--dir <répertoire>` document par document.
 *
 * Un seul nom, universel et borné — ce n'est pas l'énumération non bornée que l'en-tête
 * refuse : les autres répertoires générés (`dist/`, `docs/api/`, `docs/public/`,
 * `docs-dist/`) ne portent aucun `.md` et sont écartés par le prédicat, pas par une liste.
 *
 * @param {string} dir
 * @param {(f: string) => boolean} predicate
 * @param {number} [maxDepth=Infinity] 0 = ce répertoire SEUL, aucune récursion (T6.6).
 * @returns {string[]}
 */
function walkDir(dir, predicate, maxDepth = Infinity) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (maxDepth > 0) results.push(...walkDir(full, predicate, maxDepth - 1));
        } else if (predicate(full)) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Extract all Markdown link targets from a file's text content.
 * Returns objects { target, line } where target is the raw href string.
 * Matches: [text](target) — skips image links ![...](...) as well as
 * HTML/JS code blocks delimited by ```...```.
 *
 * ⚠️ ANGLE MORT CONNU, MESURÉ, NON CORRIGÉ ICI (T6.6) — la forme BADGE
 * `[![alt](image)](cible)` n'est PAS extraite : la regex ci-dessous consomme le lien
 * INTERNE de l'image et s'arrête avant `](cible)`. Vérifié par mutation — casser
 * délibérément la cible d'un badge de `README.md` laisse cette gate VERTE.
 *
 * `README.md` en porte 5. Trois pointaient `LICENCE` pour `LICENSE` et ont été corrigés
 * À LA MAIN au T6.6, faute de pouvoir l'être par la gate. Élargir la regex demande de
 * re-mesurer les 62 documents publics (risque de faux positifs sur les images
 * imbriquées) — versé au backlog sous **T6.6ter**, plutôt que bricolé au passage.
 *
 * @param {string} content
 * @returns {{ target: string; line: number }[]}
 */
function extractLinks(content) {
    const links = [];
    const lines = content.split("\n");
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];

        // Toggle fenced code block state
        if (/^```/.test(ln.trim())) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock) continue;

        // Match [text](target) — exclude image syntax ![ and empty targets
        const linkRe = /(?<!!)\[(?:[^\]]*)\]\(([^)]+)\)/g;
        let m;
        while ((m = linkRe.exec(ln)) !== null) {
            const raw = m[1].trim();
            if (raw) links.push({ target: raw, line: i + 1 });
        }
    }
    return links;
}

/**
 * Normalise a heading text to a GitHub-style anchor ID.
 *
 * GitHub's algorithm (spec-accurate, Ruby \w is Unicode-aware):
 *   1. Convert to lowercase
 *   2. Remove everything that is not a Unicode letter/digit, underscore, space, or hyphen
 *      (em-dash, en-dash, colons, brackets, backticks etc. are stripped)
 *   3. Replace each space with a hyphen (no collapsing — consecutive spaces → consecutive hyphens)
 *
 * This means:
 *   "GeoLeafAPI — top-level API" → "geoleafapi--top-level-api"  (spaces around em-dash → --)
 *   "Recipe 1: Minimal Map"     → "recipe-1-minimal-map"
 *   "Config (v1.1)"             → "config-v11"
 *   "Synthèse chiffrée"         → "synthèse-chiffrée"           (Unicode letters preserved)
 *
 * @param {string} text  Raw heading text (with or without leading #)
 * @returns {string}
 */
function headingToAnchor(text) {
    return (
        text
            .toLowerCase()
            // Remove leading #+ from raw heading lines (when called on a full line)
            .replace(/^#+\s*/, "")
            // Strip everything that isn't a Unicode letter (\p{L}), digit (\p{N}), underscore, space, or hyphen
            // Note: \p{L} and \p{N} require the 'u' flag and correctly handle accented chars (é, è, ô…)
            .replace(/[^\p{L}\p{N}_\s-]/gu, "")
            .trim()
            // Replace each individual space with a hyphen (preserves consecutive spaces → consecutive hyphens)
            .replace(/ /g, "-")
    );
}

/**
 * Extract all heading anchors from a Markdown file.
 * @param {string} filePath
 * @returns {Set<string>}
 */
function extractAnchors(filePath) {
    const anchors = new Set();
    if (!fs.existsSync(filePath)) return anchors;
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    let inCodeBlock = false;
    for (const ln of lines) {
        if (/^```/.test(ln.trim())) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock) continue;
        const m = ln.match(/^(#{1,6})\s+(.+)/);
        if (m) anchors.add(headingToAnchor(m[2]));
    }
    return anchors;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Libellé lisible d'un scope — `docs publiques (packages/core/docs)`. */
const scopeLabel = (s) =>
    s.dir ? `${s.label} (${path.relative(REPO_ROOT, s.dir) || "."})` : `${s.label} (dérivé)`;

/** Les fichiers d'un scope — liste calculée si elle est fournie, sinon marche du répertoire. */
const scopeFiles = (s) => s.files ?? walkDir(s.dir, (f) => f.endsWith(".md"), s.depth);

// ── Assertions anti-gate-vide, par scope
//
// Le garde global « 0 fichier au total » ne suffit plus depuis que le périmètre est
// multiple : un scope qui ne trouve rien disparaît dans la somme des autres et la gate
// sort VERTE en n'ayant pas regardé. C'est la règle de `CLAUDE.md` — une garde jamais vue
// rouge ne garde rien — appliquée au périmètre plutôt qu'au verdict.
//
// Deux formes, parce que les deux pannes diffèrent :
//   `mustNotBeEmpty`  un répertoire nommé en dur qu'un renommage ferait disparaître
//   `mustContain`     un scope dérivé : le fichier est sur le disque, la construction du
//                     scope doit le ramener. `packages.cjs` protège la liste des paquets,
//                     rien ne protégeait le chemin qu'on en tire.
/**
 * Le compte de fichiers PAR SCOPE, dans l'ordre de déclaration.
 *
 * Ajouté le 10/08/2026 (tâche 6.13) : jusque-là le rapport n'imprimait qu'un TOTAL, même
 * en `--verbose`. Un total est indiscernable — `Scanned 172` reste `Scanned 172` qu'un
 * scope ait perdu 30 fichiers pendant qu'un autre en gagnait 30. Or c'est précisément la
 * question qu'on se pose après un déplacement de répertoire, et la seule que
 * `mustNotBeEmpty` ne réponde pas : elle distingue « vide » de « non vide », pas
 * « complet » de « amputé ».
 *
 * @type {{label: string, n: number}[]}
 */
const scopeCounts = [];

for (const s of SCOPES) {
    const files = scopeFiles(s);
    scopeCounts.push({ label: scopeLabel(s), n: files.length });
    if (s.mustNotBeEmpty && files.length === 0) {
        console.error(`[check-dead-links] Scope VIDE : ${scopeLabel(s)} — périmètre déplacé ?`);
        process.exit(1);
    }
    const missing = (s.mustContain ?? []).filter((f) => !files.includes(f));
    if (missing.length > 0) {
        console.error(
            `[check-dead-links] Scope ${scopeLabel(s)} : ${missing.length} fichier(s) sur le disque hors du scan —\n` +
                missing.map((f) => `    ${path.relative(REPO_ROOT, f)}`).join("\n")
        );
        process.exit(1);
    }
}

// Union dédupliquée : deux scopes peuvent se recouvrir (`--dir .` face à un défaut,
// ou une future racine de docs déplacée sous la racine du dépôt).
const mdFiles = [...new Set(SCOPES.flatMap(scopeFiles))];

if (mdFiles.length === 0) {
    // Le garde doit nommer TOUS les scopes : avec un périmètre multiple, citer le seul
    // premier enverrait chercher la panne au mauvais endroit.
    console.error(
        `[check-dead-links] Aucun .md trouvé dans : ${SCOPES.map(scopeLabel).join(" + ")}`
    );
    process.exit(1);
}

if (VERBOSE) {
    console.log(
        `[check-dead-links] Scan de ${mdFiles.length} fichier(s) — ${SCOPES.map(scopeLabel).join(" + ")}\n`
    );
}

const broken = [];
const externalLinks = [];

for (const mdFile of mdFiles) {
    const content = fs.readFileSync(mdFile, "utf8");
    const links = extractLinks(content);
    const relFile = path.relative(REPO_ROOT, mdFile);

    for (const { target, line } of links) {
        // Split anchor from file path
        const hashIdx = target.indexOf("#");
        const filePart = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
        const anchor = hashIdx >= 0 ? target.slice(hashIdx + 1) : null;

        // External link
        if (/^https?:\/\//i.test(filePart) || (!filePart && /^https?:\/\//i.test(target))) {
            externalLinks.push({ file: relFile, line, href: target });
            continue;
        }

        // Anchor-only link (within same file)
        if (!filePart) {
            if (anchor) {
                const anchors = extractAnchors(mdFile);
                if (!anchors.has(anchor)) {
                    broken.push({
                        file: relFile,
                        line,
                        href: target,
                        reason: `anchor #${anchor} not found in same file`,
                    });
                }
            }
            continue;
        }

        // Skip mailto / data URIs
        if (/^(mailto:|data:)/i.test(filePart)) continue;

        // Resolve the target file relative to the source file's directory.
        //
        // VitePress resolves extensionless links to `<link>.md` (that is the convention
        // the corpus is written in), so a bare `releases/PATCHNOTE_V2.0.0` is NOT dead.
        // Judging those by the GitHub convention produced 5 false positives and would
        // have made this gate permanently red the day it got wired — the anti-pattern
        // this repo avoids elsewhere (see .husky/pre-commit on check-config-consumers).
        // NB: do NOT gate this on `path.extname(filePart)` — a link such as
        // `releases/PATCHNOTE_V2.0.0` reports an extension of ".0" because of the
        // version dots, which would skip exactly the links that need resolving.
        let resolved = path.resolve(path.dirname(mdFile), filePart);

        if (!fs.existsSync(resolved) && fs.existsSync(`${resolved}.md`)) {
            resolved = `${resolved}.md`;
        }

        if (!fs.existsSync(resolved)) {
            broken.push({
                file: relFile,
                line,
                href: target,
                reason: `file not found: ${path.relative(REPO_ROOT, resolved)}`,
            });
            continue;
        }

        // If there is an anchor, verify it exists in the target file
        if (anchor) {
            // Target could be a directory — skip anchor check
            const stat = fs.statSync(resolved);
            if (stat.isFile()) {
                const anchors = extractAnchors(resolved);
                if (!anchors.has(anchor)) {
                    broken.push({
                        file: relFile,
                        line,
                        href: target,
                        reason: `anchor #${anchor} not found in ${path.relative(REPO_ROOT, resolved)}`,
                    });
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const sep = "─".repeat(72);

/** Le périmètre, scope par scope, avec son compte — imprimé dans les deux verdicts. */
function printScopes(indent) {
    console.log(`${indent}Scanned ${mdFiles.length} file(s) — ${scopeCounts.length} scope(s) :`);
    for (const { label, n } of scopeCounts) {
        console.log(`${indent}  ${String(n).padStart(4)}  ${label}`);
    }
}

if (broken.length === 0) {
    console.log(`${sep}`);
    console.log(`✅  check-dead-links — 0 broken internal links`);
    // T6.6 — `in docs/` était CODÉ EN DUR, donc faux dès que le périmètre a bougé.
    printScopes("    ");
    if (externalLinks.length > 0) {
        console.log(
            `    ⚠️  ${externalLinks.length} external URL(s) not validated (use --verbose to list)`
        );
        if (VERBOSE) {
            console.log("\n  External URLs (not checked):");
            for (const { file, line, href } of externalLinks) {
                console.log(`    ${file}:${line}  →  ${href}`);
            }
        }
    }
    console.log(sep);
    process.exit(0);
} else {
    console.log(`${sep}`);
    console.log(`❌  check-dead-links — ${broken.length} broken internal link(s) found\n`);
    printScopes("  ");
    console.log("");
    for (const { file, line, href, reason } of broken) {
        console.log(`  ${file}:${line}`);
        console.log(`    link   : ${href}`);
        console.log(`    reason : ${reason}\n`);
    }
    if (externalLinks.length > 0) {
        console.log(
            `  ⚠️  ${externalLinks.length} external URL(s) not validated (use --verbose to list)`
        );
        if (VERBOSE) {
            console.log("\n  External URLs (not checked):");
            for (const { file, line, href } of externalLinks) {
                console.log(`    ${file}:${line}  →  ${href}`);
            }
        }
    }
    console.log(sep);
    process.exit(1);
}
