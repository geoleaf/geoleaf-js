#!/usr/bin/env node
/*!
 * GeoLeaf — Vérificateur de dérive des consommateurs de config (file:line)
 * © 2026 Mattieu Pottier — MIT
 *
 * Archi roadmap S5 (5.2 — « amorcer l'automation de l'inventaire »). NON destructif.
 *
 * La colonne « Consommateur (file:line) » de
 * docs/reference/inventaire_config_parametres.md est tracée À LA MAIN
 * (sémantique : suivi du type de config). Une régénération par grep est impossible
 * (la plupart des clés sont lues en accès propriété typé `cfg.x`, indistinct du code
 * sans rapport — cf. dry-run S5). Ce script ne RÉGÉNÈRE donc pas la colonne : il
 * VÉRIFIE que chaque citation `file:line` déjà inventoriée est toujours valide et
 * signale la dérive (fichier déplacé, ligne hors bornes, ligne ne référençant plus
 * la clé). Objectif roadmap : « réduit la maintenance manuelle de l'inventaire ».
 *
 * Sortie : un rapport Markdown + un code de sortie (0 si aucune dérive franche).
 *   - Dérive FRANCHE (exit 1 possible avec --fail) : fichier introuvable, ligne hors
 *     bornes. Ce sont des citations cassées à coup sûr.
 *   - Dérive PROBABLE (avertissement, n'échoue pas) : la ligne citée (±fenêtre) ne
 *     mentionne plus la clé — peut être un faux positif (alias, déstructuration).
 *
 * Usage : node scripts/check-config-consumers.cjs [--fail] [--no-report] [--update-baseline]
 * (CONFIG_INVENTORY pointe un inventaire alternatif — tests.)
 *
 * Câblage — pre-commit + CI + ci-local :
 *   - `--no-report` : n'écrit pas le rapport Markdown. Obligatoire pour un gate — le
 *     rapport a été supprimé volontairement du dépôt (ménage documentaire `2bc7c1e0`)
 *     et sans ce flag chaque commit le ressusciterait en fichier non tracké.
 *   - `--fail` : bloque sur TOUTE dérive franche. Plus de baseline.
 *
 * ⚠️ LA BASELINE A ÉTÉ SUPPRIMÉE (R.43, backlog résiduel S5, 25/07/2026).
 * Elle figeait 62 dérives franches héritées de la campagne de refacto S3→S6 (fichiers
 * cités supprimés : `app/init.ts`, `poi/**`, `geojson/clustering.ts`…) pour éviter
 * l'anti-pattern « gate rouge en permanence ». Le passif a été soldé : les 60 dérives
 * restantes ont été réparées une par une (citations re-résolues dans l'arborescence
 * post-restructuration `kernel/`), et 3 pointaient vers des clés RÉELLEMENT MORTES —
 * elles sont devenues de la prose, pas une citation inventée.
 *   - Avant : 117 valides / 44 fichiers introuvables / 16 lignes hors bornes, exit 0.
 *   - Après : 171 valides / 0 / 0, exit 0 — et le gate BLOQUE désormais.
 * Prouvé par mutation dans les deux catégories (fichier inexistant → rouge ; ligne
 * hors bornes → rouge ; restauration → vert). Une gate dont on vide la baseline sans
 * l'avoir vue rougir n'a rien prouvé — c'est la panne récurrente de ces roadmaps.
 *
 * ⚠️ NON traité, et il faut le savoir : les 312 dérives MOLLES subsistent (209 « la
 * ligne ne cite plus la clé » + 103 suffixes ambigus). Elles n'échouent pas, par
 * conception — ce sont des faux positifs probables (alias, déstructuration). Le taux de
 * validité est passé d'environ 24 % à environ 35 %, PAS à 100 %.
 *   - `--update-baseline` : recrée un instantané. À n'utiliser que si un futur chantier
 *     réintroduit délibérément un passif — pas pour faire taire une régression.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const docsPaths = require("./lib/docs-paths.cjs");

const ROOT = path.resolve(__dirname, "..");
const INVENTORY = process.env.CONFIG_INVENTORY
    ? path.resolve(process.env.CONFIG_INVENTORY)
    : docsPaths.reference("inventaire_config_parametres.md");
// ⚠️ SAUT NOMMÉ — le rapport de cette gate vit dans l'atelier, absent du dépôt public.
//
// Même motif et même patron que `audit-report-freshness.cjs` : `_docs_projet/` est retiré du
// dépôt public par décision (tâche 9.4), donc son absence y est le contrat et non une panne.
// 🛑 Le saut refuse de se lire comme un vert — patron `CONSUMER-CONTRACT/CC-00`.
//
// 📌 Il est placé AVANT le calcul de `REPORT` et non autour de son écriture : le chemin se
// résout au chargement, donc c'est là que la gate meurt. Le déplacer plus bas donnerait un
// saut qui n'a jamais l'occasion de s'exécuter.
if (!docsPaths.internalRootExists()) {
    console.log(
        "⏭️  [CONFIG-CONSUMERS] SAUTÉ — la racine INTERNE est absente : " +
            docsPaths.rel(docsPaths.INTERNAL_ROOT)
    );
    console.log(
        "    Ce n'est pas un vert : aucune citation de consommateur n'a été confrontée à\n" +
            "    l'inventaire. Sur le dépôt public c'est le comportement attendu — le rapport\n" +
            "    d'atelier n'y part pas. Ailleurs, c'est un défaut : corriger le chemin, ou\n" +
            "    poser GEOLEAF_INTERNAL_DOCS_ROOT."
    );
    process.exit(0);
}

// ⚠️ Le rapport reste sous la racine INTERNE : c'est une sortie d'atelier, pas de la doc
// publiée. Les deux racines coïncident avant la scission — les confondre ici publierait
// un rapport de travail le jour où elles divergent.
const REPORT = docsPaths.internal("travail", "rapports", "rapport_consommateurs-config-s5.md");
const PKG_DIR = path.join(ROOT, "packages");
const BASELINE = path.join(__dirname, "check-config-consumers.baseline.json");
const FAIL = process.argv.includes("--fail");
const NO_REPORT = process.argv.includes("--no-report");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");
const WINDOW = 3; // tolerance (± lines) around a cited line before flagging "key not on line"

/** Stable identity of a hard drift, independent of row order in the inventory. */
function driftId(d) {
    return `${d.family}|${d.key}|${d.cite}`;
}

function loadBaseline() {
    try {
        const raw = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
        return new Set(raw.drifts || []);
    } catch {
        return new Set();
    }
}

// ─── Source index (packages/*/src/**/*.ts, no tests/.d.ts) ──────────────────────
function collectSources(dir, acc) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (["node_modules", "dist", "coverage", "__tests__", ".turbo"].includes(e.name))
                continue;
            collectSources(full, acc);
        } else if (e.isFile()) {
            if (!e.name.endsWith(".ts")) continue;
            if (
                e.name.endsWith(".d.ts") ||
                e.name.endsWith(".test.ts") ||
                e.name.endsWith(".spec.ts")
            )
                continue;
            acc.push(full);
        }
    }
    return acc;
}
/** Collect build/tooling scripts (consumers cited for build-time params). */
function collectScripts(dir, acc) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === "node_modules") continue;
            collectScripts(full, acc);
        } else if (e.isFile() && /\.(cjs|mjs|js)$/.test(e.name)) {
            acc.push(full);
        }
    }
    return acc;
}
function buildIndex() {
    const files = [];
    // ARCHI S9.5 — from the workspace registry, not a one-level readdirSync. The old
    // form would have indexed ZERO sources once ARCHI S10 nests packages, and a
    // citation check over an empty index reports every parameter as uncited.
    for (const pkg of require("./lib/packages.cjs").all()) {
        const src = path.join(pkg.absDir, "src");
        if (fs.existsSync(src)) collectSources(src, files);
    }
    // Build scripts are legitimate consumers of build-time params (e.g. pwa.* in build-deploy.cjs).
    collectScripts(path.join(ROOT, "scripts"), files);
    const byRel = new Map();
    for (const abs of files) {
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        byRel.set(rel, fs.readFileSync(abs, "utf8").split(/\r?\n/));
    }
    return byRel;
}

/**
 * Resolve a terse path-suffix to a unique rel-path, reproducing the manual convention
 * (basename + just-enough parent dirs). Tolerant to omitted intermediate segments such
 * as `/src/` (e.g. `flatgeobuf/entry.ts` → `packages/plugin-flatgeobuf/src/entry.ts`):
 * the parent hints must appear IN ORDER as a subsequence of the path, not contiguously.
 */
function makeResolver(byRel) {
    const byBase = new Map();
    for (const rel of byRel.keys()) {
        const base = rel.split("/").pop();
        if (!byBase.has(base)) byBase.set(base, []);
        byBase.get(base).push(rel);
    }
    // A hint matches a segment exactly OR as a package short-name (`flatgeobuf` ↦ `plugin-flatgeobuf`).
    const segMatch = (seg, hint) => seg === hint || seg.endsWith("-" + hint);
    const hasSubseq = (segs, hints) => {
        let h = 0;
        for (const s of segs) if (h < hints.length && segMatch(s, hints[h])) h++;
        return h === hints.length;
    };
    return function resolve(suffix) {
        const want = suffix.replace(/^\/+/, "").split("/");
        const base = want[want.length - 1];
        const hints = want.slice(0, -1);
        let cands = byBase.get(base) || [];
        if (hints.length) cands = cands.filter((rel) => hasSubseq(rel.split("/"), hints));
        if (cands.length <= 1) return cands;
        // Prefer a unique core match ONLY when the human gave disambiguating parent dirs;
        // a bare ambiguous basename (no hints) stays ambiguous rather than force-resolving.
        if (!hints.length) return cands;
        // T5.5 — préfixe dérivé du registre, pas écrit. Ce filtre décide d'une
        // désambiguïsation : muet, il ne casse pas, il cesse de préférer le core.
        const coreSrcPrefix = `${require("./lib/packages.cjs").requireByDirName("core").dir}/src/`;
        const core = cands.filter((m) => m.startsWith(coreSrcPrefix));
        return core.length === 1 ? core : cands;
    };
}

// ─── Markdown table parsing (aligned with gen-config-reference.cjs) ──────────────
function columnIdOf(header) {
    const h = header.toLowerCase();
    if (h.includes("fichier")) return "fichier";
    if (h.includes("clé") || h.includes("cle")) return "cle";
    if (h.includes("consommateur")) return "consommateur";
    return null;
}
function splitRow(line) {
    const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
    if (cells.length && cells[0] === "") cells.shift();
    if (cells.length && cells[cells.length - 1] === "") cells.pop();
    return cells.map((c) => c.replace(/\\\|/g, "|"));
}
function isSeparatorRow(line) {
    return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

// ─── Key reference check ─────────────────────────────────────────────────────────
const WORD = /[A-Za-z0-9_]/;
function lineHasDottedKey(line, key) {
    let from = 0;
    for (;;) {
        const i = line.indexOf(key, from);
        if (i === -1) return false;
        const before = i === 0 ? "" : line[i - 1];
        const after = line[i + key.length] || "";
        if (!WORD.test(before) && !WORD.test(after)) return true;
        from = i + 1;
    }
}
function lineHasSegment(line, seg) {
    const re = new RegExp(
        `(?<![A-Za-z0-9_])${seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`
    );
    return re.test(line);
}
/** Does any line within ±WINDOW of `cited` plausibly reference `key`? */
function referencesKey(lines, cited, key) {
    const bare = key.replace(/\[\]/g, "");
    const last = bare.split(".").pop();
    const lo = Math.max(1, cited - WINDOW);
    const hi = Math.min(lines.length, cited + WINDOW);
    for (let l = lo; l <= hi; l++) {
        const text = lines[l - 1];
        if (bare.includes(".") && lineHasDottedKey(text, bare)) return true;
        if (lineHasSegment(text, last)) return true;
    }
    return false;
}

// ─── Main ────────────────────────────────────────────────────────────────────────
const CITE_RE = /([\w./@-]+\.(?:ts|tsx|cjs|mjs|js)):(\d+(?:,\d+)*)/g;

function run() {
    const byRel = buildIndex();
    const resolve = makeResolver(byRel);
    const lines = fs.readFileSync(INVENTORY, "utf8").split(/\r?\n/);

    let family = null;
    let cols = null;
    const r = {
        rows: 0,
        cited: 0,
        ok: 0,
        fileNotFound: [],
        ambiguous: [],
        lineOOR: [],
        keyNotOnLine: [],
        proseOnly: [],
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const mFam = line.match(/^##\s+(B\d)\s+—/);
        if (mFam) {
            family = mFam[1];
            cols = null;
            continue;
        }
        if (/^\s*\|/.test(line) && /\bFichier\b/i.test(line) && !cols) {
            const headers = splitRow(line);
            if (!isSeparatorRow(lines[i + 1] || "")) continue;
            const map = {};
            headers.forEach((h, idx) => {
                const id = columnIdOf(h);
                if (id && !(id in map)) map[id] = idx;
            });
            if ("cle" in map && "consommateur" in map && family) {
                cols = map;
                i++;
            }
            continue;
        }
        if (cols && !/^\s*\|/.test(line)) {
            cols = null;
            continue;
        }
        if (!cols || !/^\s*\|/.test(line) || isSeparatorRow(line)) continue;

        const cells = splitRow(line);
        const m = (cells[cols.cle] || "").trim().match(/^`([^`]+)`$/);
        if (!m) continue;
        const key = m[1];
        const cell = (cells[cols.consommateur] || "").trim();
        r.rows++;

        const cites = [];
        let mm;
        CITE_RE.lastIndex = 0;
        while ((mm = CITE_RE.exec(cell)) !== null) {
            for (const ln of mm[2].split(","))
                cites.push({ suffix: mm[1], line: parseInt(ln, 10) });
        }
        if (!cites.length) {
            r.proseOnly.push({ family, key, cell: cell || "(vide)" });
            continue;
        }

        for (const c of cites) {
            r.cited++;
            const cite = `${c.suffix}:${c.line}`;
            const matches = resolve(c.suffix);
            if (matches.length === 0) {
                r.fileNotFound.push({ family, key, cite });
                continue;
            }
            if (matches.length > 1) {
                r.ambiguous.push({ family, key, cite, n: matches.length });
                continue;
            }
            const src = byRel.get(matches[0]);
            if (c.line < 1 || c.line > src.length) {
                r.lineOOR.push({ family, key, cite, len: src.length });
                continue;
            }
            if (!referencesKey(src, c.line, key)) {
                r.keyNotOnLine.push({ family, key, cite });
                continue;
            }
            r.ok++;
        }
    }

    if (!NO_REPORT) writeReport(r, byRel.size);

    const hard = r.fileNotFound.length + r.lineOOR.length;
    const soft = r.keyNotOnLine.length + r.ambiguous.length;
    console.log(
        `Inventaire : ${path.relative(ROOT, INVENTORY)} — ${r.rows} lignes, ${r.cited} citations file:line`
    );
    console.log(`  ✓ valides                  : ${r.ok}`);
    console.log(`  ✗ fichier introuvable      : ${r.fileNotFound.length}`);
    console.log(`  ✗ ligne hors bornes        : ${r.lineOOR.length}`);
    console.log(`  ⚠ ligne ne cite plus la clé: ${r.keyNotOnLine.length}`);
    console.log(`  ⚠ suffixe ambigu           : ${r.ambiguous.length}`);
    console.log(`  · citation-libre (prose)   : ${r.proseOnly.length}`);
    if (!NO_REPORT) console.log(`Rapport : ${path.relative(ROOT, REPORT)}`);

    const hardDrifts = [...r.fileNotFound, ...r.lineOOR];

    if (UPDATE_BASELINE) {
        const payload = {
            _comment:
                "Known config-consumer drifts, frozen so the gate blocks only on NEW ones. Regenerate with --update-baseline after a legitimate triage. See the docblock of check-config-consumers.cjs.",
            generated: new Date().toISOString().slice(0, 10),
            count: hardDrifts.length,
            drifts: hardDrifts.map(driftId).sort(),
        };
        fs.writeFileSync(BASELINE, `${JSON.stringify(payload, null, 4)}\n`);
        console.log(`\n✓ Baseline régénérée : ${hardDrifts.length} dérive(s) franche(s) figée(s).`);
        return;
    }

    const baseline = loadBaseline();
    const regressions = hardDrifts.filter((d) => !baseline.has(driftId(d)));

    if (regressions.length) {
        console.error(
            `\n✗ ${regressions.length} dérive(s) franche(s) NOUVELLE(S) (hors baseline) :`
        );
        for (const d of regressions) console.error(`    - [${d.family}] ${d.key} → ${d.cite}`);
        console.error(
            "  Corriger la citation, ou régénérer la baseline si le déplacement est légitime :"
        );
        console.error("      npm run check:config-consumers:update-baseline");
        if (FAIL) process.exit(1);
    }

    const known = hard - regressions.length;
    console.log(
        hard === 0
            ? `\n✓ Aucune dérive franche${soft ? ` (${soft} avertissement[s] à revoir).` : "."}`
            : `\n✓ ${known} dérive(s) franche(s) connue(s) (baseline, non bloquantes)${soft ? ` · ${soft} avertissement(s)` : ""}.`
    );
}

function writeReport(r, nSources) {
    const date = new Date().toISOString().slice(0, 10);
    const list = (arr, fmt) => (arr.length ? arr.map(fmt).join("\n") : "_(aucune)_");
    const cite = (x) => `- [${x.family}] \`${x.key}\` → \`${x.cite}\``;
    const md = `---
type: rapport
title: "GeoLeaf-JS — Vérification de dérive des consommateurs de config (Archi S5 / 5.2)"
version: v1.0.0
date: ${date}
---

# Vérification de dérive — colonne « Consommateur (file:line) »

> Généré par \`scripts/check-config-consumers.cjs\` (Archi roadmap S5, tâche 5.2).
> **Non destructif** : l'inventaire n'est pas modifié. L'outil parse les citations
> \`file:line\` déjà inventoriées et vérifie qu'elles pointent toujours sur la clé
> (${nSources} fichiers source scannés sous \`packages/*/src\`).

## Pourquoi vérifier plutôt que régénérer

La colonne est **tracée à la main** (sémantique : suivi du type de config). Une
régénération automatique par grep est **infaisable** : seules ~23 clés sur 426 passent
par un accesseur littéral \`Config.get("clé")\` ; les autres sont lues en **accès
propriété typé** (\`cfg.debug\`, \`config.map.zoom\`) que le grep ne distingue pas du
code sans rapport (dry-run S5 : \`debug\` matchait 6 fichiers faux-positifs). L'outil
**garde donc la curation honnête** au lieu de la remplacer.

## Sévérité

- **Dérive franche** (citation cassée à coup sûr) : fichier introuvable, ligne hors bornes.
- **Avertissement** (à revoir, faux positif possible) : la ligne citée (±${WINDOW}) ne
  mentionne plus la clé (alias / déstructuration), ou le suffixe de chemin est ambigu.

## Compteurs

| Catégorie | Nombre |
| --- | --- |
| Lignes d'inventaire avec citation | ${r.rows - r.proseOnly.length} |
| Citations \`file:line\` vérifiées | ${r.cited} |
| ✓ Valides | ${r.ok} |
| ✗ Fichier introuvable (déplacé/renommé) | ${r.fileNotFound.length} |
| ✗ Ligne hors bornes | ${r.lineOOR.length} |
| ⚠ Ligne ne référence plus la clé | ${r.keyNotOnLine.length} |
| ⚠ Suffixe de chemin ambigu | ${r.ambiguous.length} |
| · Citation libre (prose, non vérifiable) | ${r.proseOnly.length} |

## ✗ Fichier introuvable (${r.fileNotFound.length})

${list(r.fileNotFound, cite)}

## ✗ Ligne hors bornes (${r.lineOOR.length})

${list(r.lineOOR, (x) => `- [${x.family}] \`${x.key}\` → \`${x.cite}\` (fichier : ${x.len} lignes)`)}

## ⚠ Ligne ne référence plus la clé (${r.keyNotOnLine.length})

${list(r.keyNotOnLine, cite)}

## ⚠ Suffixe de chemin ambigu (${r.ambiguous.length})

${list(r.ambiguous, (x) => `- [${x.family}] \`${x.key}\` → \`${x.cite}\` (${x.n} fichiers candidats)`)}

## · Lignes à citation libre (prose, non vérifiables — ${r.proseOnly.length})

${list(r.proseOnly, (x) => `- [${x.family}] \`${x.key}\``)}

## Intégration

Lançable manuellement (\`node scripts/check-config-consumers.cjs\`) ou en mode bloquant
(\`--fail\`, échoue sur dérive franche uniquement). Non câblé en pre-commit/CI à ce stade
(amorçage) : la dérive douce dépend des refactors et mérite une revue humaine.

_MP-i — Mattieu Pottier Indépendant_
`;
    fs.writeFileSync(REPORT, md, "utf8");
}

run();
