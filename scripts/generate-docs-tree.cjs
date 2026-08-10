#!/usr/bin/env node
/**
 * DOCS-TREE: generates the qualified source tree — `docs/reference/ARBORESCENCE_QUALIFIEE.md`
 * and its interactive twin `ARBORESCENCE_QUALIFIEE.html` (ARCHI S11, requalified S15).
 *
 * ## The files are GENERATED — never hand-edit them
 *
 * Everything in the output comes from one of two places:
 *   • measured from the source — path, LOC, real exports, module header, subtree counts
 *   • read from `docs-tree-verdicts/` — the judgement (name / location / existence /
 *     description), written once per artefact by an inspection pass and versioned as data
 *
 * That split is the whole design, and it is the same one the S11 inventory used, extended
 * from "prose per directory" to "verdict per artefact". A 900-line audit maintained by hand
 * is stale at the first commit; the six stale trees this document replaces are the proof.
 *
 * ## Why a dead key THROWS (S15)
 *
 * The S11 generator did `annotations[node.full]` and silently ignored a key matching nothing.
 * When `modules/` became `kernel/` + `utils/`, **31 of 129 hand-written annotations died in
 * one commit** — 24 % of the prose vanished from the document and `--check` stayed GREEN,
 * because it compares the RENDER and the render simply no longer contained those sentences.
 * A judgement corpus is far more perishable than an inventory: a verdict survives the letter
 * of a rename while describing nothing. So a key that resolves to no real artefact is now a
 * hard error, in the same spirit as `packages.cjs` throwing rather than skipping.
 *
 * ## Modes
 *
 *   node scripts/generate-docs-tree.cjs           # write both renderings
 *   node scripts/generate-docs-tree.cjs --check   # exit 1 if the committed files are stale
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const inventory = require("./lib/source-inventory.cjs");
const registry = require("./lib/packages.cjs");
const docsPaths = require("./lib/docs-paths.cjs");

const ROOT = registry.ROOT;
// Destination = `reference/` : « régénéré ou lu par un programme » (refonte documentaire V3,
// §2.2 — un répertoire = un régime de maintenance). L'ancien `ref/` n'existe plus.
// La RACINE, elle, vient de `lib/docs-paths.cjs` : écrite en dur, elle cesserait de matcher
// à la scission de la doc et ce générateur écrirait où plus personne ne lit, en sortant 0.
const OUT_MD = docsPaths.reference("ARBORESCENCE_QUALIFIEE.md");
const OUT_HTML = docsPaths.reference("ARBORESCENCE_QUALIFIEE.html");
const VERDICT_DIR = path.join(ROOT, "scripts", "docs-tree-verdicts");
const LEGACY_ANNOTATIONS = path.join(ROOT, "scripts", "docs-tree-annotations.json");
const CHECK = process.argv.includes("--check");

/** Max lines inside one fenced block before the tree is cut at a directory boundary. */
const MAX_BLOCK = 60;
const ELEMENT_CAP = 56;
const DESC_CAP = 74;

const EXISTENCE = {
    justifie: "justifié",
    renommer: "renommer",
    deplacer: "déplacer",
    fusionner: "fusionner",
    supprimer: "supprimer",
    "?": "?",
};
const ACTIONABLE = ["supprimer", "fusionner", "deplacer", "renommer"];
const SEVERITY_ORDER = { bloquant: 0, majeur: 1, mineur: 2, null: 3, undefined: 3 };

/* -------------------------------------------------------------------- utils */

const pad = (s, n) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const padStart = (s, n) => (s.length >= n ? s : " ".repeat(n - s.length) + s);

/** Visible width, cutting on a word boundary and marking the cut. */
function clamp(text, max) {
    const s = String(text == null ? "" : text)
        .replace(/\s*\n\s*/g, " ")
        .trim();
    return s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

/**
 * The anchor a markdown renderer derives from a heading.
 *
 * NOT `replace(/[^a-z0-9]+/g, "-")`: GitHub, VS Code and marked all **drop** punctuation
 * rather than substituting it, so `packages/core/src/` anchors as `packagescoresrc`, not
 * `packages-core-src`. Getting this wrong yields a table of contents whose every link is
 * dead — and a dead anchor fails silently, which is why `assertAnchorsResolve` exists.
 */
function anchorFor(heading) {
    return heading
        .toLowerCase()
        .replace(/[^\w\- ]+/g, "")
        .replace(/ /g, "-");
}

function escHtml(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/* --------------------------------------------------------------- input load */

/**
 * Merge every verdict shard. Shards have disjoint scopes by construction, so a key
 * present twice means two lots claimed the same artefact — a scope overlap that would
 * otherwise resolve by whichever file happened to sort last.
 */
function loadVerdicts() {
    if (!fs.existsSync(VERDICT_DIR)) return { verdicts: {}, shards: [] };
    const shards = fs
        .readdirSync(VERDICT_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort();
    const verdicts = {};
    const owner = {};
    for (const shard of shards) {
        const abs = path.join(VERDICT_DIR, shard);
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
        } catch (err) {
            throw new Error(`docs-tree: cannot parse ${shard} — ${err.message}`);
        }
        for (const [key, value] of Object.entries(parsed.verdicts || {})) {
            if (owner[key]) {
                throw new Error(
                    `docs-tree: "${key}" is claimed by two shards (${owner[key]} and ${shard}). ` +
                        `Lot scopes must be disjoint — fix the scope, do not let sort order decide.`
                );
            }
            owner[key] = shard;
            verdicts[key] = value;
        }
    }
    return { verdicts, shards };
}

/** The S11 per-directory prose, kept as a description fallback. */
function loadLegacyAnnotations() {
    if (!fs.existsSync(LEGACY_ANNOTATIONS)) return {};
    return JSON.parse(fs.readFileSync(LEGACY_ANNOTATIONS, "utf8")).directories || {};
}

/* ---------------------------------------------------------------- validation */

/**
 * Reject a verdict corpus that has drifted from the tree, or that contradicts itself.
 *
 * Two classes, deliberately treated differently:
 *   • a key pointing at nothing  → THROW. The corpus has drifted; silence is how 31
 *     annotations died unnoticed.
 *   • an artefact with no verdict → rendered `?`. Visible, counted, never fatal — a new
 *     file must not be able to break the build, only to show up as unqualified.
 */
function validateVerdicts(verdicts, knownPaths, dirPaths) {
    const errors = [];
    const all = new Set([...knownPaths, ...dirPaths]);

    for (const [key, v] of Object.entries(verdicts)) {
        if (!all.has(key)) {
            errors.push(`clé morte : "${key}" ne correspond à aucun fichier ni répertoire réel`);
            continue;
        }
        const ex = v.existence;
        if (ex && !(ex in EXISTENCE)) errors.push(`${key} : existence inconnue "${ex}"`);

        if (v.name === "KO" && !v.nameTarget) {
            errors.push(`${key} : name "KO" sans nameTarget — le nouveau nom doit être proposé`);
        }
        if (v.location === "KO" && !v.locationTarget) {
            errors.push(
                `${key} : location "KO" sans locationTarget — la destination doit être nommée`
            );
        }
        if (
            ["renommer", "deplacer", "fusionner"].includes(ex) &&
            !v.existenceTarget &&
            !v.nameTarget &&
            !v.locationTarget
        ) {
            errors.push(`${key} : existence "${ex}" sans cible`);
        }
        if (ex && ex !== "justifie" && ex !== "?" && !v.rule) {
            errors.push(`${key} : verdict "${ex}" sans identifiant de règle (cf. RUBRIC.md)`);
        }
        // The complacent verdict, made impossible: a name judged wrong cannot coexist
        // with an existence judged fine — one of the two assessments is not real.
        if (v.name === "KO" && !["renommer", "fusionner", "supprimer"].includes(ex)) {
            errors.push(`${key} : name "KO" mais existence "${ex}" — contradiction`);
        }
        if (v.location === "KO" && !["deplacer", "fusionner", "supprimer"].includes(ex)) {
            errors.push(`${key} : location "KO" mais existence "${ex}" — contradiction`);
        }
        if (v.locationTarget && !String(v.locationTarget).startsWith("new:")) {
            const target = String(v.locationTarget).replace(/\/$/, "");
            if (!dirPaths.has(target) && !all.has(target)) {
                errors.push(
                    `${key} : locationTarget "${v.locationTarget}" n'existe pas — ` +
                        `préfixer "new:" si la destination est à créer`
                );
            }
        }
        if (v.confidence === "basse" && !v.rationale) {
            errors.push(`${key} : confiance basse sans rationale`);
        }
    }

    if (errors.length) {
        console.error(`ERROR [DOCS-TREE]: ${errors.length} verdict(s) invalide(s).`);
        for (const e of errors.slice(0, 40)) console.error("  • " + e);
        if (errors.length > 40) console.error(`  … et ${errors.length - 40} autres.`);
        process.exit(1);
    }
}

/**
 * Slug fixtures with a KNOWN answer — the oracle for {@link anchorFor}.
 *
 * These values are what GitHub, VS Code and marked actually produce: punctuation is
 * DROPPED, not substituted. They are written out rather than computed precisely because
 * a self-consistency check here proves nothing.
 */
const ANCHOR_FIXTURES = [
    ["packages/core/src/", "packagescoresrc"],
    ["packages/plugins/table/src/lang/", "packagespluginstablesrclang"],
    ["scripts/", "scripts"],
    ["Plan d'action", "plan-daction"],
];

/**
 * Every `](#…)` in the document must land on a real heading.
 *
 * A dead anchor is the archetypal silent failure: the link renders, it is clickable, and
 * it does nothing. With ~60 sections cut mechanically from directory boundaries, one
 * slug-rule mistake kills the whole table of contents at once — as it did on the first
 * pass, where `/` was substituted rather than dropped.
 *
 * ## Why the fixtures, and not just a cross-check
 *
 * The obvious form of this assertion — slug the headings, slug the links, compare — is
 * **tautological**: both sides call the same function, so a wrong rule is wrong on both
 * sides and they still agree. Verified by mutation: substituting punctuation instead of
 * dropping it left that version green. The fixtures are the witness with a known answer
 * (same shape as `verify-coverage-attribution.cjs`), and they are what actually fails.
 */
function assertAnchorsResolve(md) {
    for (const [input, expected] of ANCHOR_FIXTURES) {
        const got = anchorFor(input);
        if (got !== expected) {
            console.error(
                `ERROR [DOCS-TREE]: règle d'ancre incorrecte — anchorFor(${JSON.stringify(input)}) ` +
                    `= ${JSON.stringify(got)}, attendu ${JSON.stringify(expected)}.`
            );
            console.error(
                "  Les renderers markdown SUPPRIMENT la ponctuation, ils ne la substituent pas."
            );
            process.exit(1);
        }
    }

    const headings = new Set();
    for (const m of md.matchAll(/^#{2,6} (.+)$/gm)) headings.add(anchorFor(m[1].trim()));
    const dead = [...md.matchAll(/\]\(#([^)]+)\)/g)]
        .map((m) => m[1])
        .filter((a) => !headings.has(a));
    if (dead.length) {
        console.error(`ERROR [DOCS-TREE]: ${dead.length} ancre(s) de sommaire ne résolvent pas.`);
        for (const a of dead.slice(0, 10)) console.error("  • #" + a);
        process.exit(1);
    }
}

/* --------------------------------------------------------------- tree build */

function buildModel() {
    // ⚠️ `fromIndex` — B-102, et c'est la condition pour que `--check` soit tenable.
    //
    // Ce générateur produit un artefact que `--check` compare ensuite AU FICHIER COMMITÉ,
    // octet à octet. Tant que l'inventaire lisait le DISQUE, l'artefact reflétait le worktree
    // au moment de sa génération — modifications non commitées comprises — donc il ne pouvait
    // pas correspondre à un clone frais de HEAD. Mesuré le 01/08/2026 : **+251 lignes**
    // d'écart sur 6 fichiers modifiés par des sessions concurrentes, ce qui faisait rougir
    // `docs:tree:check` dans la chambre de `ci:push` sans qu'aucune régénération n'y change
    // quoi que ce soit.
    //
    // L'index est la référence juste : il est « ce qui va être commité ». On stage, on
    // régénère, on commite les deux. Les GATES qui lisent le même inventaire gardent le
    // disque, elles — voir le bandeau de `lib/source-inventory.cjs`.
    const { files } = inventory.collect({
        extensions: [".ts", ".css"],
        includeScripts: true,
        fromIndex: true,
    });
    files.sort((a, b) => a.rel.localeCompare(b.rel));

    const dirSet = new Set();
    for (const f of files) {
        const parts = f.dir.split("/");
        for (let i = 1; i <= parts.length; i++) dirSet.add(parts.slice(0, i).join("/"));
    }

    const filesByDir = new Map();
    for (const f of files) {
        if (!filesByDir.has(f.dir)) filesByDir.set(f.dir, []);
        filesByDir.get(f.dir).push(f);
    }

    const childDirs = new Map();
    for (const d of dirSet) {
        if (!d.includes("/")) continue;
        const parent = d.slice(0, d.lastIndexOf("/"));
        if (!childDirs.has(parent)) childDirs.set(parent, []);
        childDirs.get(parent).push(d);
    }
    for (const list of childDirs.values()) list.sort();

    const subtree = new Map();
    for (const d of dirSet) {
        const inside = files.filter((f) => f.rel.startsWith(d + "/"));
        subtree.set(d, { files: inside.length, loc: inside.reduce((n, f) => n + f.loc, 0) });
    }

    const byPath = new Map(files.map((f) => [f.rel, f]));
    const roots = [...dirSet].filter((d) => !d.includes("/")).sort();
    return { files, byPath, dirSet, filesByDir, childDirs, subtree, roots };
}

/* -------------------------------------------------------------------- rows */

function rowFor(model, verdicts, legacy, key, kind, displayName) {
    const v = verdicts[key] || {};
    const ex = v.existence || "?";
    const sz =
        kind === "dir"
            ? (model.subtree.get(key) || { files: 0 }).files + "f"
            : String((model.byPath.get(key) || { loc: 0 }).loc);

    let desc = v.description;
    if (!desc && kind === "dir") desc = legacy[key] || null;
    if (!desc && kind === "file") {
        const f = model.byPath.get(key);
        desc = f && f.summary ? f.summary : null;
    }
    // The target belongs in the description, not in a seventh column that would be empty
    // on ~85 % of rows: `grep 'déplacer'` must yield destination and motive in one pass.
    const target = v.existenceTarget || v.nameTarget || v.locationTarget;
    const full = target && ex !== "justifie" && ex !== "?" ? `→ ${target} — ${desc || ""}` : desc;

    return {
        key,
        kind,
        display: displayName,
        sz,
        name: v.name === "KO" ? "KO" : v.name === "ok" ? "ok" : "?",
        location: v.location === "KO" ? "KO" : v.location === "ok" ? "ok" : "?",
        existence: ex,
        rule: v.rule || null,
        severity: v.severity || null,
        description: full ? full.replace(/\s+—\s*$/, "") : null,
        rationale: v.rationale || null,
        confidence: v.confidence || null,
    };
}

/**
 * Depth-first walk producing tree-prefixed rows.
 * Directories first, then files — the convention every tree tool uses.
 */
function walkRows(model, verdicts, legacy, dir, prefix, out, stopAt) {
    const kids = model.childDirs.get(dir) || [];
    const own = model.filesByDir.get(dir) || [];
    const entries = [
        ...kids.map((d) => ({ kind: "dir", key: d, label: d.slice(dir.length + 1) + "/" })),
        ...own.map((f) => ({ kind: "file", key: f.rel, label: f.name })),
    ];

    entries.forEach((entry, i) => {
        const last = i === entries.length - 1;
        const branch = last ? "└── " : "├── ";
        out.push(
            rowFor(model, verdicts, legacy, entry.key, entry.kind, prefix + branch + entry.label)
        );
        if (entry.kind === "dir" && !(stopAt && stopAt.has(entry.key))) {
            walkRows(
                model,
                verdicts,
                legacy,
                entry.key,
                prefix + (last ? "    " : "│   "),
                out,
                stopAt
            );
        }
    });
    return out;
}

/** Count the rows a full subtree would emit, to decide whether it needs cutting. */
function subtreeRowCount(model, dir) {
    const kids = model.childDirs.get(dir) || [];
    const own = model.filesByDir.get(dir) || [];
    return kids.length + own.length + kids.reduce((n, k) => n + subtreeRowCount(model, k), 0);
}

/**
 * Cut the tree into sections no longer than MAX_BLOCK lines.
 *
 * A directory whose subtree fits becomes one section. A directory that does not becomes a
 * MAP of its children (one qualified row each, subtree elided) plus one section per child.
 * Anchors cannot target a line inside a fenced block, so the cut is what makes the document
 * navigable at all — and each level then reads as "where do I go next".
 */
function planSections(model, dir, depth, out) {
    if (subtreeRowCount(model, dir) <= MAX_BLOCK) {
        out.push({ dir, depth, elide: null });
        return out;
    }
    const kids = model.childDirs.get(dir) || [];
    out.push({ dir, depth, elide: new Set(kids) });
    for (const k of kids) planSections(model, k, depth + 1, out);
    return out;
}

/* ---------------------------------------------------------------- markdown */

function renderBlock(rows) {
    const elW = Math.min(ELEMENT_CAP, Math.max(8, ...rows.map((r) => r.display.length)));
    const szW = Math.max(3, ...rows.map((r) => r.sz.length));
    const exW = 9;
    const head =
        pad("Élément", elW) +
        " | " +
        padStart("sz", szW) +
        " | nom | emp | " +
        pad("existence", exW) +
        " | description";
    const lines = [head, "-".repeat(head.length)];
    for (const r of rows) {
        lines.push(
            pad(clamp(r.display, elW), elW) +
                " | " +
                padStart(r.sz, szW) +
                " | " +
                padStart(r.name, 3) +
                " | " +
                padStart(r.location, 3) +
                " | " +
                pad(EXISTENCE[r.existence] || r.existence, exW) +
                " | " +
                clamp(r.description || "(à qualifier)", DESC_CAP)
        );
    }
    return lines;
}

/**
 * Extrait les lignes d'entité d'un rendu Markdown, en `nom → [métriques]`.
 *
 * Une ligne d'entité ressemble à `├── sync.contract.ts | 357 | ok | ok | justifié | prose…`,
 * la métrique étant un nombre de lignes pour un fichier ou `553f` pour un répertoire. Le même
 * nom de base pouvant vivre dans plusieurs répertoires, la valeur est une LISTE : on compare
 * des multiensembles, jamais une position.
 *
 * @param {string} md Le rendu Markdown.
 * @returns {Map<string, string[]>} Nom → métriques, dans l'ordre de rencontre.
 */
function entityRows(md) {
    const out = new Map();
    for (const line of md.split("\n")) {
        const m = /^[│├└─\s]*[├└]──\s+(\S+)\s*\|\s*([^|]+?)\s*\|/.exec(line);
        if (!m) continue;
        const list = out.get(m[1]) || [];
        list.push(m[2]);
        out.set(m[1], list);
    }
    return out;
}

/**
 * Dit CE QUI a bougé entre l'artefact commité et le rendu courant.
 *
 * ⚠️ Pourquoi cette fonction existe. Le message d'échec disait « Le code source ou les verdicts
 * ont bougé depuis la dernière génération » — vrai, et inutilisable. Le 02/08/2026 le run CI
 * 30749750097 est tombé dessus ; il a fallu un `git log` sur chaque source pour découvrir que
 * `sync.contract.ts` avait pris 11 lignes dans un commit étiqueté `docs(offline)`. Une gate qui
 * sait exactement ce qui diffère et n'en dit rien fait payer ce travail à chaque échec.
 *
 * ⚠️ Elle REFUSE de conclure plutôt que de deviner. Une différence peut porter sur la prose d'un
 * verdict ou sur une ligne de synthèse, pas sur un décompte : dans ce cas elle le dit et montre
 * la première ligne divergente, au lieu d'inventer un coupable. Un diagnostic faux coûterait
 * plus cher que pas de diagnostic — c'est exactement ce qui vient de se produire à l'échelle
 * de la session.
 *
 * @param {string} committed Contenu du fichier sur le disque.
 * @param {string} fresh Contenu régénéré.
 * @returns {string[]} Lignes explicatives, prêtes à imprimer.
 */
function explainStale(committed, fresh) {
    const before = entityRows(committed);
    const after = entityRows(fresh);
    const out = [];

    for (const [name, list] of after) {
        const old = before.get(name);
        if (!old) {
            out.push(`  + ${name} — entré dans l'arbre`);
        } else if (old.join(",") !== list.join(",")) {
            out.push(`  ~ ${name} — ${old.join("/")} → ${list.join("/")}`);
        }
    }
    for (const name of before.keys()) {
        if (!after.has(name)) out.push(`  − ${name} — sorti de l'arbre`);
    }

    if (out.length) return out;

    // Aucune entité ne diffère : la cause est ailleurs (prose d'un verdict, ligne de synthèse).
    // On montre la première ligne divergente PLUTÔT que d'affirmer une cause qu'on n'a pas.
    const a = committed.split("\n");
    const b = fresh.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
            out.push("  Aucune entité ne change de décompte — la différence est ailleurs");
            out.push(
                `  (verdict, prose ou ligne de synthèse). Première divergence, ligne ${i + 1} :`
            );
            out.push(`    commité : ${String(a[i] ?? "(absente)").slice(0, 100)}`);
            out.push(`    courant : ${String(b[i] ?? "(absente)").slice(0, 100)}`);
            return out;
        }
    }
    return ["  (contenu identique — divergence hors Markdown, probablement le rendu HTML)"];
}

/**
 * Groupe les milliers avec une espace fine insécable (U+202F), SANS passer par ICU.
 *
 * ⚠️ Ceci était `stats.loc.toLocaleString("fr-FR")`, et c'était un « vert local / rouge CI »
 * armé — mesuré le 01/08/2026. Le mode `--check` de ce générateur compare le fichier
 * **octet à octet** (`readFileSync(file) !== content`), et le séparateur de groupe du
 * français a changé de U+00A0 à U+202F au fil des versions d'ICU. Or les données ICU sont
 * embarquées dans le binaire Node, et `.nvmrc` ne pin qu'une **majeure** (`22`) : GitHub
 * résout vers le dernier 22.x de son tool cache, qui n'est pas forcément celui du poste.
 *
 * Deux mineures de Node = deux octets = `docs:tree:check` ROUGE en CI et VERT en local,
 * sans qu'une seule ligne de code ait bougé, et sans rien à quoi rattacher l'échec.
 *
 * Le séparateur est donc figé ici. Il reste typographiquement juste pour le français, et il
 * produit les mêmes octets sur toute machine — ce qui est la seule propriété qui compte pour
 * un artefact comparé à l'octet.
 *
 * @param {number} n Entier positif.
 * @returns {string} Le nombre, milliers groupés par U+202F.
 */
function groupThousands(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function renderMarkdown(model, verdicts, legacy, stats) {
    const out = [];
    out.push("# GeoLeaf-JS — Arborescence qualifiée");
    out.push("");
    out.push(
        "> ⚠️ **Fichier GÉNÉRÉ — ne pas éditer à la main.** Produit par `npm run docs:tree` " +
            "(`scripts/generate-docs-tree.cjs`), vérifié à chaque `ci:local`. Les jugements vivent " +
            "dans `scripts/docs-tree-verdicts/` ; toute édition de ce `.md` sera écrasée."
    );
    out.push("");
    out.push(
        "Arbre unique du code source livré, où **chaque dossier et chaque fichier** porte quatre " +
            "qualifications : le nom est-il bon, l'emplacement est-il pertinent, l'existence est-elle " +
            "justifiée, et que fait l'élément. Vue interactive (repli, filtres, recherche) : " +
            "[`ARBORESCENCE_QUALIFIEE.html`](ARBORESCENCE_QUALIFIEE.html)."
    );
    out.push("");

    out.push("## Légende");
    out.push("");
    out.push("| Colonne | Sens |");
    out.push("| --- | --- |");
    out.push(
        "| `sz` | fichier → lignes de code · dossier → nombre de fichiers du sous-arbre (`31f`) |"
    );
    out.push("| `nom` | `ok` / `KO` — le nom permet-il de prédire le contenu ? |");
    out.push("| `emp` | `ok` / `KO` — l'emplacement est-il celui qu'on irait chercher ? |");
    out.push(
        "| `existence` | `justifié` · `renommer` · `déplacer` · `fusionner` · `supprimer` · `?` non qualifié |"
    );
    out.push(
        "| `description` | ce que l'élément **est**. Préfixée `→ cible —` quand un geste est proposé |"
    );
    out.push("");
    out.push(
        "Les verdicts citent une règle de [`RUBRIC.md`](../../scripts/docs-tree-verdicts/RUBRIC.md). " +
            "`justifié` est le défaut : la charge de la preuve pèse sur le verdict actionnable."
    );
    out.push("");
    out.push("```bash");
    out.push("# tous les gestes proposés, avec destination et motif");
    out.push("grep -E '\\| (supprimer|fusionner|déplacer|renommer) \\|' ARBORESCENCE_QUALIFIEE.md");
    out.push("# les déplacements seuls, chemin + description");
    out.push("awk -F'|' '$5 ~ /déplacer/ {print $1, $6}' ARBORESCENCE_QUALIFIEE.md");
    out.push("```");
    out.push("");

    out.push("## Synthèse");
    out.push("");
    out.push("| Mesure | Valeur |");
    out.push("| --- | --- |");
    out.push(`| Packages | ${stats.packages} |`);
    out.push(`| Répertoires | ${stats.dirs} |`);
    out.push(
        `| Fichiers | **${stats.files}** — ${stats.ts} \`.ts\` · ${stats.css} \`.css\` · ${stats.scripts} \`scripts/\` |`
    );
    out.push(`| Lignes de code | ${groupThousands(stats.loc)} |`);
    out.push(`| Artefacts qualifiés | **${stats.qualified} / ${stats.total}** (${stats.pct} %) |`);
    out.push("");
    out.push("| Verdict | Artefacts |");
    out.push("| --- | ---: |");
    for (const k of ["justifie", "renommer", "deplacer", "fusionner", "supprimer", "?"]) {
        out.push(`| ${EXISTENCE[k]} | ${stats.byVerdict[k] || 0} |`);
    }
    out.push("");

    const sections = [];
    for (const root of model.roots) planSections(model, root, 2, sections);

    const sectionRows = new Map();
    for (const s of sections) {
        sectionRows.set(s.dir, walkRows(model, verdicts, legacy, s.dir, "", [], s.elide));
    }

    out.push("## Sommaire");
    out.push("");
    out.push("| Section | Fichiers | À traiter |");
    out.push("| --- | ---: | ---: |");
    for (const s of sections) {
        const todo = sectionRows.get(s.dir).filter((r) => ACTIONABLE.includes(r.existence)).length;
        out.push(
            `| ${"&nbsp;".repeat((s.depth - 2) * 2)}[\`${s.dir}/\`](#${anchorFor(s.dir + "/")}) ` +
                `| ${(model.subtree.get(s.dir) || {}).files || 0} | ${todo || ""} |`
        );
    }
    out.push("");

    for (const s of sections) {
        const rows = sectionRows.get(s.dir);
        out.push("#".repeat(Math.min(6, s.depth)) + ` ${s.dir}/`);
        out.push("");
        const self = rowFor(model, verdicts, legacy, s.dir, "dir", s.dir + "/");
        if (self.description) {
            out.push(self.description);
            out.push("");
        }
        if (s.elide && s.elide.size) {
            out.push(
                `> Sous-arbre trop large pour un seul bloc : les ${s.elide.size} répertoires ` +
                    `enfants sont qualifiés ici et détaillés dans leur propre section.`
            );
            out.push("");
        }
        out.push("```");
        if (rows.length) renderBlock(rows).forEach((l) => out.push(l));
        else out.push("(aucun fichier direct)");
        out.push("```");
        out.push("");
    }

    out.push("## Plan d'action");
    out.push("");
    out.push(
        "Extrait des mêmes données — aucune duplication de jugement. Trié par sévérité " +
            "(`bloquant` → `majeur` → `mineur`), puis par chemin."
    );
    out.push("");
    const allRows = [
        ...[...model.dirSet].sort().map((d) => rowFor(model, verdicts, legacy, d, "dir", d)),
        ...model.files.map((f) => rowFor(model, verdicts, legacy, f.rel, "file", f.rel)),
    ];

    for (const verdict of ACTIONABLE) {
        const list = allRows
            .filter((r) => r.existence === verdict)
            .sort(
                (a, b) =>
                    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
                    a.key.localeCompare(b.key)
            );
        out.push(`### ${EXISTENCE[verdict]} — ${list.length}`);
        out.push("");
        if (!list.length) {
            out.push("_Aucun._");
            out.push("");
            continue;
        }
        out.push("| Élément | Règle | Sévérité | Action |");
        out.push("| --- | --- | --- | --- |");
        for (const r of list) {
            out.push(
                `| \`${r.key}\` | ${r.rule || "—"} | ${r.severity || "—"} | ` +
                    `${clamp(r.description, 150).replace(/\|/g, "\\|")} |`
            );
        }
        out.push("");
    }

    out.push("---");
    out.push("");
    out.push("_MP-i — Mattieu Pottier Indépendant_");
    return out.join("\n") + "\n";
}

/* -------------------------------------------------------------------- html */

function renderHtml(model, verdicts, legacy, stats) {
    const nodes = [];
    const emit = (dir) => {
        for (const k of model.childDirs.get(dir) || []) {
            const r = rowFor(model, verdicts, legacy, k, "dir", k.slice(dir.length + 1));
            nodes.push({ ...r, parent: dir, depth: k.split("/").length });
            emit(k);
        }
        for (const f of model.filesByDir.get(dir) || []) {
            const r = rowFor(model, verdicts, legacy, f.rel, "file", f.name);
            nodes.push({ ...r, parent: dir, depth: f.rel.split("/").length });
        }
    };
    for (const root of model.roots) {
        nodes.push({
            ...rowFor(model, verdicts, legacy, root, "dir", root),
            parent: null,
            depth: 1,
        });
        emit(root);
    }

    return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GeoLeaf-JS — Arborescence qualifiée</title>
<style>
:root{--bg:#fbfbfa;--fg:#1a1a18;--mut:#6b6b66;--line:#e3e3df;--card:#fff;
--ok:#3f8f5f;--ko:#c2461f;--warn:#b8860b;--acc:#2b6cb0}
@media(prefers-color-scheme:dark){:root{--bg:#16171a;--fg:#e8e8e4;--mut:#9a9a94;
--line:#2c2e33;--card:#1d1f23;--ok:#6fbf8f;--ko:#e87a55;--warn:#d9ae4a;--acc:#7ab0e8}}
:root[data-theme=dark]{--bg:#16171a;--fg:#e8e8e4;--mut:#9a9a94;--line:#2c2e33;--card:#1d1f23;
--ok:#6fbf8f;--ko:#e87a55;--warn:#d9ae4a;--acc:#7ab0e8}
:root[data-theme=light]{--bg:#fbfbfa;--fg:#1a1a18;--mut:#6b6b66;--line:#e3e3df;--card:#fff;
--ok:#3f8f5f;--ko:#c2461f;--warn:#b8860b;--acc:#2b6cb0}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);
padding:14px 20px}
h1{margin:0 0 10px;font-size:16px;font-weight:650;letter-spacing:-.01em}
.sub{color:var(--mut);font-weight:400;font-size:13px}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
input[type=search]{flex:1 1 240px;min-width:180px;padding:7px 11px;border:1px solid var(--line);
border-radius:7px;background:var(--bg);color:var(--fg);font:inherit}
label.f{display:inline-flex;gap:5px;align-items:center;padding:5px 10px;border:1px solid var(--line);
border-radius:99px;cursor:pointer;font-size:12.5px;user-select:none;background:var(--bg)}
label.f input{margin:0;accent-color:var(--acc)}
button{padding:5px 10px;border:1px solid var(--line);border-radius:7px;background:var(--bg);
color:var(--fg);font:inherit;font-size:12.5px;cursor:pointer}
button:hover{background:var(--card)}
.count{color:var(--mut);font-size:12.5px;font-variant-numeric:tabular-nums;margin-left:auto}
main{padding:8px 20px 80px}
.row{display:grid;grid-template-columns:1fr 62px 40px 40px 92px;gap:8px;align-items:baseline;
padding:2px 6px;border-radius:5px}
.row:hover{background:var(--card)}
.el{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;
white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dir>.el{font-weight:640}
.tw{display:inline-block;width:14px;color:var(--mut);cursor:pointer}
.num{text-align:right;color:var(--mut);font-size:12px;font-variant-numeric:tabular-nums}
.v{font-size:11.5px;text-align:center}
.ok{color:var(--ok)}.ko{color:var(--ko);font-weight:650}.qm{color:var(--mut);opacity:.55}
.ex-justifie{color:var(--mut)}
.ex-renommer,.ex-fusionner{color:var(--warn)}
.ex-deplacer{color:var(--acc)}
.ex-supprimer{color:var(--ko);font-weight:650}
.desc{grid-column:1/-1;color:var(--mut);font-size:12.5px;padding-bottom:3px}
.desc em{font-style:normal;opacity:.75}
footer{padding:20px;color:var(--mut);font-size:12px;border-top:1px solid var(--line)}
@media(max-width:720px){.row{grid-template-columns:1fr 52px 34px 34px 78px}}
</style></head><body>
<header>
<h1>GeoLeaf-JS — Arborescence qualifiée
<span class="sub">${stats.files} fichiers · ${stats.dirs} répertoires · ${stats.qualified}/${stats.total} qualifiés</span></h1>
<div class="bar">
<input type="search" id="q" placeholder="Rechercher un fichier, un dossier, une description…">
<label class="f"><input type="checkbox" class="vf" value="supprimer" checked>supprimer</label>
<label class="f"><input type="checkbox" class="vf" value="fusionner" checked>fusionner</label>
<label class="f"><input type="checkbox" class="vf" value="deplacer" checked>déplacer</label>
<label class="f"><input type="checkbox" class="vf" value="renommer" checked>renommer</label>
<label class="f"><input type="checkbox" class="vf" value="justifie" checked>justifié</label>
<label class="f"><input type="checkbox" class="vf" value="?" checked>non qualifié</label>
<button id="expand">tout déplier</button><button id="collapse">tout replier</button>
<span class="count" id="shown"></span>
</div></header>
<main id="tree"></main>
<footer>Généré par <code>npm run docs:tree</code> — les jugements vivent dans <code>scripts/docs-tree-verdicts/</code>. MP-i</footer>
<script>
const NODES=${JSON.stringify(nodes)};
const LABEL={justifie:"justifié",renommer:"renommer",deplacer:"déplacer",
fusionner:"fusionner",supprimer:"supprimer","?":"?"};
const collapsed=new Set();
const tree=document.getElementById("tree"),q=document.getElementById("q"),
      shown=document.getElementById("shown");

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,
  c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function cls(v){return v==="ok"?"ok":v==="KO"?"ko":"qm"}

// A directory survives the filter when any descendant matches: hiding the parent would
// orphan its matching children and make the filter look like it dropped rows.
function keptSet(){
  const vs=new Set([...document.querySelectorAll(".vf")].filter(c=>c.checked).map(c=>c.value));
  const term=q.value.trim().toLowerCase();
  const keep=new Set();
  for(let i=NODES.length-1;i>=0;i--){
    const n=NODES[i];
    const hit=vs.has(n.existence) &&
      (!term||(n.key+" "+(n.description||"")).toLowerCase().includes(term));
    if(hit||keep.has(n.key)){keep.add(n.key); if(n.parent)keep.add(n.parent);}
  }
  return keep;
}
function render(){
  const keep=keptSet();
  let skipUnder=null,out="",visible=0;
  for(const n of NODES){
    if(!keep.has(n.key))continue;
    if(skipUnder&&n.key.startsWith(skipUnder+"/"))continue;
    skipUnder=(n.kind==="dir"&&collapsed.has(n.key))?n.key:null;
    visible++;
    const ind=(n.depth-1)*13;
    const tw=n.kind==="dir"
      ?'<span class="tw" data-k="'+esc(n.key)+'">'+(collapsed.has(n.key)?"▸":"▾")+'</span>'
      :'<span class="tw"></span>';
    out+='<div class="row '+n.kind+'">'
      +'<span class="el" style="padding-left:'+ind+'px" title="'+esc(n.key)+'">'+tw+esc(n.display)+'</span>'
      +'<span class="num">'+esc(n.sz)+'</span>'
      +'<span class="v '+cls(n.name)+'">'+esc(n.name)+'</span>'
      +'<span class="v '+cls(n.location)+'">'+esc(n.location)+'</span>'
      +'<span class="v ex-'+esc(n.existence)+'">'+esc(LABEL[n.existence]||n.existence)+'</span>'
      +(n.description
        ?'<span class="desc" style="padding-left:'+(ind+26)+'px">'+esc(n.description)
          +(n.rule?' <em>['+esc(n.rule)+(n.severity?" · "+esc(n.severity):"")+']</em>':'')+'</span>'
        :'')
      +'</div>';
  }
  tree.innerHTML=out;
  shown.textContent=visible+" lignes";
}
tree.addEventListener("click",e=>{
  const t=e.target.closest(".tw[data-k]"); if(!t)return;
  const k=t.dataset.k; collapsed.has(k)?collapsed.delete(k):collapsed.add(k); render();
});
q.addEventListener("input",render);
document.querySelectorAll(".vf").forEach(c=>c.addEventListener("change",render));
document.getElementById("expand").onclick=()=>{collapsed.clear();render()};
document.getElementById("collapse").onclick=()=>{
  for(const n of NODES) if(n.kind==="dir"&&n.depth>=3) collapsed.add(n.key); render()};
// 900 rows expanded is a wall, not a view: open to package level, deeper stays folded.
for(const n of NODES) if(n.kind==="dir"&&n.depth>=4) collapsed.add(n.key);
render();
</script></body></html>
`;
}

/* -------------------------------------------------------------------- main */

function main() {
    const model = buildModel();
    const { verdicts, shards } = loadVerdicts();
    const legacy = loadLegacyAnnotations();

    validateVerdicts(verdicts, new Set(model.files.map((f) => f.rel)), model.dirSet);

    const allKeys = [...model.dirSet, ...model.files.map((f) => f.rel)];
    const byVerdict = {};
    let qualified = 0;
    for (const k of allKeys) {
        const ex = (verdicts[k] && verdicts[k].existence) || "?";
        byVerdict[ex] = (byVerdict[ex] || 0) + 1;
        if (ex !== "?") qualified++;
    }

    const stats = {
        packages: registry.all().length,
        dirs: model.dirSet.size,
        files: model.files.length,
        ts: model.files.filter((f) => f.kind === "ts").length,
        css: model.files.filter((f) => f.kind === "css").length,
        scripts: model.files.filter((f) => f.kind === "script").length,
        loc: model.files.reduce((n, f) => n + f.loc, 0),
        total: allKeys.length,
        qualified,
        pct: ((qualified / allKeys.length) * 100).toFixed(1),
        byVerdict,
    };

    const md = renderMarkdown(model, verdicts, legacy, stats);
    const html = renderHtml(model, verdicts, legacy, stats);
    assertAnchorsResolve(md);

    if (CHECK) {
        const stale = [];
        for (const [file, content] of [
            [OUT_MD, md],
            [OUT_HTML, html],
        ]) {
            if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
                stale.push(path.relative(ROOT, file));
            }
        }
        if (stale.length) {
            console.error(`ERROR [DOCS-TREE]: ${stale.join(", ")} — STALE.`);
            console.error("Ce qui a bougé depuis la dernière génération :");
            const onDisk = fs.existsSync(OUT_MD) ? fs.readFileSync(OUT_MD, "utf8") : "";
            for (const line of explainStale(onDisk, md)) console.error(line);
            console.error("Run: npm run docs:tree — puis commiter le résultat.");
            process.exit(1);
        }
        console.log(
            `✅ [DOCS-TREE] à jour — ${stats.files} fichiers, ${stats.dirs} répertoires, ` +
                `${qualified}/${stats.total} qualifiés (${stats.pct} %), ${shards.length} shards.`
        );
        process.exit(0);
    }

    fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
    fs.writeFileSync(OUT_MD, md);
    fs.writeFileSync(OUT_HTML, html);
    const todo = ACTIONABLE.reduce((n, v) => n + (byVerdict[v] || 0), 0);
    console.log(
        `✅ [DOCS-TREE] ${path.relative(ROOT, OUT_MD)} + .html — ${stats.files} fichiers, ` +
            `${stats.dirs} répertoires, ${qualified}/${stats.total} qualifiés (${stats.pct} %).`
    );
    console.log(
        `   ${byVerdict.justifie || 0} justifiés · ${todo} gestes proposés · ` +
            `${byVerdict["?"] || 0} non qualifiés · ${shards.length} shards lus.`
    );
}

main();
