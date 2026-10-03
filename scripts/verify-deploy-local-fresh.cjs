#!/usr/bin/env node
"use strict";
/**
 * verify-deploy-local-fresh.cjs — the workstation variant is the SAME BUILD as `deploy-full`.
 *
 * ## The hole this gate closes
 *
 * `deploy-local` is the variant a workstation keeps open: its dev URL is where a change is
 * looked at, and where demo and editing data get exercised. Nothing rebuilt it and nothing
 * could see it age — the conjunction of two decisions, each of them right:
 *
 *   • `verify-deploy-no-secrets.cjs` excludes it BY NAME, because it is the only place a
 *     secret is allowed to be;
 *   • `ci:local` never builds it: `--plugins=all` yields the two shippable variants, and
 *     the `local` mode must be typed by hand, never reached from a CI script.
 *
 * Meanwhile `ci:local` rebuilds `deploy-core` and `deploy-full` at EVERY run. The runner
 * itself therefore widens the gap, silently, each time a source changed. The failure is
 * not "the demo is broken": it is "the demo answers correctly FOR THE PREVIOUS BUNDLE",
 * so a verdict rendered on it is false without saying so. Measured at laying — the
 * workstation served a service worker one core release behind the shippable variant built
 * the day after, and its entry chunk carried another hash.
 *
 * ## The oracle is BYTES — not an age, not a commit, not a list of inputs
 *
 * `deploy-local` carries the same plugin set as `deploy-full`: `build-deploy.cjs` makes
 * them differ by `includeDevConnector` alone. The workstation variant must therefore EQUAL
 * the shippable one up to a finite difference, and that equality is the whole gate.
 *
 *   • Not a file age: a `git clone` or a `touch` rewrites every one of them.
 *   • Not a commit sha stamped at build: building on an uncommitted tree, then committing,
 *     reddens on identical content — and a sha of the core's sources is blind to the
 *     plugins, the profiles and the app shell.
 *   • Not a fingerprint of the sources: it needs a hand-kept list of the build's inputs,
 *     and one forgotten root exits green on a stale deploy.
 *
 * Comparing two OUTPUTS of one build uses the build itself as the model of its own inputs:
 * whatever changes what gets deployed — core, plugin, profile, app shell, dependency — is
 * seen, with no list to keep.
 *
 * ⚠️ **Each admitted difference is RE-DERIVED with the function that produces it**
 * (`stripDevConnectorScript`, `stripDevBackendBindings`, `vetoTileDownload`, all imported
 * from the build), never described a second time here. A file is not "allowed to differ":
 * it must be exactly what the build would have made of its twin.
 *
 * ## What is verified
 *
 *   DLF-00  the subject exists. `deploy-local` absent → SKIPPED, by name, exit 0: no
 *           workstation variant on this clone, so nothing there can serve a previous
 *           bundle. `deploy-local` present WITHOUT `deploy-full` → red: there is a subject
 *           and no reference, and a verdict cannot be rendered on half a comparison.
 *   DLF-01  every file outside the admitted difference exists on both sides and is
 *           byte-identical. Pre-compressed forms (`.gz`, `.br`) are left out, for the
 *           motive `check-build-determinism.cjs` gives: their header can carry a
 *           timestamp, and they are derived from files this rule already holds.
 *   DLF-02  the files living on ONE side are exactly the workstation bootstrap
 *           (workstation side) and the server contract (shippable side). Anything else —
 *           a hashed chunk from the previous build, first of all — is the staleness itself.
 *   DLF-03  the workstation `index.html`, once its DEV-CONNECTOR block is removed by the
 *           build's own function, is the shippable one. Blank lines aside: the build
 *           collapses them after its removals, and they carry nothing.
 *   DLF-04  each `.json` file under the workstation's `profiles/`, passed through the
 *           build's two removals (proof-backend bindings, tile download), is the
 *           shippable one.
 *   DLF-05  `sw-core.js` is the same file but for its two DERIVED constants: the
 *           pre-cache list differs by the workstation bootstrap alone, the cache name by
 *           its content fingerprint alone. An unrecognised shape is a red, never a skip.
 *   DLF-06  the comparison is not empty: it covered the bundle entry and at least one
 *           chunk. Otherwise a `dist/` rename would make this gate green and mute.
 *
 * ## Where it runs, and where it can only skip
 *
 * In `ci:local`'s product path, right behind the gates that read the freshly built
 * `deploy/`. ⚠️ **The position is the wiring's reason for being**: `deploy-full` is the
 * REFERENCE, and it is known fresh only just after the "Build deploy variants" step.
 * Run standalone the verdict is RELATIVE — "both variants are one build" — and says
 * nothing of that build against the sources.
 *
 *   • Not in `atelier:check`. Its subset is DERIVED from the scripts that condition
 *     themselves on the workshop root, which this one does not; and a runner launched
 *     while `ci:local` rebuilds `deploy/` would read a half-empty tree.
 *   • Not in `ci.yml`. A runner never builds the workstation variant, so the gate could
 *     only ever skip there.
 *
 * ## `deploy-coverage` is NOT judged, deliberately
 *
 * It has the same blind spot and nobody opens it daily. Under `--e2e` it is rebuilt just
 * before the suite that reads it; outside `--e2e` judging it would redden at every run
 * after a source change, for a variant no one is looking at — a gate that cries for
 * nothing gets disabled, and takes the workstation half with it.
 *
 * ⚠️ Standalone, `GEOLEAF_BACKEND_BASE_URL` must hold the value `deploy-full` was built
 * with: DLF-04 re-applies the removal with the origin read from the environment, exactly
 * as the build does.
 *
 * Usage: node scripts/verify-deploy-local-fresh.cjs
 * Exit: 0 if the workstation variant is the build `deploy-full` is (or is absent),
 *       1 otherwise.
 */

const fs = require("node:fs");
const path = require("node:path");

const {
    stripDevConnectorScript,
    vetoTileDownload,
    BACKEND_BASE_URL,
    FULL_VARIANT_NAME,
    WORKSTATION_VARIANT_NAME,
} = require("./build-deploy.cjs");
const { stripDevBackendBindings } = require("./lib/dev-backend.cjs");
const { SERVER_CONTRACT_FILES } = require("./lib/server-contract.cjs");

const ROOT = path.resolve(__dirname, "..");
const DEPLOY = path.join(ROOT, "deploy");

const C = {
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    x: "\x1b[0m",
};

/**
 * Paths this gate names by itself, relative to a variant's root.
 *
 * ⚠️ They are literals HERE rather than imports, and the direction of failure is what
 * allows it: a rename on the build's side makes each of them stop matching into a RED
 * (an unexpected one-sided file, an uncovered witness), never into a skip. The variant
 * NAMES are imported for the opposite reason — they fail green.
 */
const DEV_CONNECTOR_FILE = "connector.local.js";
const APP_SHELL = "index.html";
const SERVICE_WORKER = "sw-core.js";
const BUNDLE_ENTRY = "dist/geoleaf.esm.js";
const CHUNKS_PREFIX = "dist/chunks/";
const PROFILES_PREFIX = "profiles/";

const PRECOMPRESSED = /\.(?:gz|br)$/;

/**
 * The two lines of the deployed service worker that the build DERIVES per variant.
 *
 * `CACHE_VERSION` ends with a 12-hex fingerprint of the pre-cached assets' content;
 * `STATIC_ASSETS` is the pre-cache list itself, written as a JSON array on one line.
 */
const CACHE_VERSION_LINE = /^(\s*const CACHE_VERSION\s*=\s*"geoleaf-v[^"]*)-[0-9a-f]{12}(".*)$/;
const STATIC_ASSETS_LINE = /^\s*const STATIC_ASSETS\s*=\s*(\[.*\]);?\s*$/;

/** How many defects are printed before the rest is summarised. */
const MAX_SHOWN = 25;

/**
 * Lists a variant's files, pre-compressed forms aside.
 *
 * @param {string} root Absolute path of the variant directory.
 * @returns {{files: Map<string, string>, precompressed: number}} Relative POSIX path →
 *   absolute path, and how many `.gz`/`.br` were left out.
 */
function listFiles(root) {
    /** @type {Map<string, string>} */
    const files = new Map();
    let precompressed = 0;
    const stack = [root];
    while (stack.length) {
        const dir = /** @type {string} */ (stack.pop());
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) stack.push(abs);
            else if (!entry.isFile()) continue;
            else if (PRECOMPRESSED.test(entry.name)) precompressed++;
            else files.set(path.relative(root, abs).split(path.sep).join("/"), abs);
        }
    }
    return { files, precompressed };
}

/** @param {string} text @returns {string[]} the lines that carry something */
function nonBlankLines(text) {
    return text.split("\n").filter((line) => line.trim() !== "");
}

/**
 * DLF-03 — the workstation shell minus its DEV-CONNECTOR block is the shippable shell.
 *
 * @param {string} localHtml Workstation `index.html`.
 * @param {string} fullHtml Shippable `index.html`.
 * @returns {string | null} The defect, or `null`.
 */
function compareAppShell(localHtml, fullHtml) {
    let stripped;
    try {
        stripped = stripDevConnectorScript(localHtml, WORKSTATION_VARIANT_NAME);
    } catch {
        // The build's function throws when the marker pair is missing. Here that means
        // the directory is not what the `local` mode produces — said in this gate's
        // terms, the function's own message speaks of the source shell.
        return (
            `le bloc DEV-CONNECTOR est absent ou incomplet : ce répertoire n'est pas ce que ` +
            `produit \`build:deploy:local\`.`
        );
    }
    const mine = nonBlankLines(stripped);
    const theirs = nonBlankLines(fullHtml);
    const at = mine.findIndex((line, i) => line !== theirs[i]);
    if (at === -1 && mine.length === theirs.length) return null;
    const n = at === -1 ? Math.min(mine.length, theirs.length) : at;
    return (
        `diffère hors du bloc DEV-CONNECTOR, à la ligne non vide ${n + 1} :\n` +
        `          poste    : ${(mine[n] ?? "(fin de fichier)").trim().slice(0, 110)}\n` +
        `          livrable : ${(theirs[n] ?? "(fin de fichier)").trim().slice(0, 110)}`
    );
}

/**
 * DLF-04 — a workstation profile JSON, passed through the build's removals, is the
 * shippable one.
 *
 * Mirrors the build's own rule to the letter: a file the two passes do not touch is
 * copied as-is, hence byte-identical; a file they touch is REWRITTEN with
 * `JSON.stringify(json, null, 2)`.
 *
 * 🛑 **Byte equality is NOT a shortcut to green here**, and it was one in this function's
 * first draft: found by mutation, on a shippable profile left carrying its proof-backend
 * bindings. The two files were then identical, and identical is precisely what they must
 * NOT be when a removal applies. The expected twin is computed first, always; equality
 * is the verdict only where the build changes nothing.
 *
 * @param {Buffer} localBuf Workstation file.
 * @param {Buffer} fullBuf Shippable file.
 * @param {string | null} backendBaseUrl Origin the shippable variant was built with.
 * @returns {{defect: string | null, derived: boolean}} The defect, or `null`; and whether
 *   the build's removals apply to this file at all.
 */
function compareProfileJson(localBuf, fullBuf, backendBaseUrl) {
    let json;
    try {
        json = JSON.parse(localBuf.toString("utf-8"));
    } catch (e) {
        // The build parses every shippable profile JSON: an unreadable one cannot have a
        // built twin, whatever the bytes say.
        return { defect: `JSON illisible côté poste (${String(e).slice(0, 80)}).`, derived: false };
    }
    const touched = stripDevBackendBindings(json, backendBaseUrl) + vetoTileDownload(json);
    if (touched === 0) {
        return {
            defect: localBuf.equals(fullBuf)
                ? null
                : `diffère du livrable alors qu'aucun des deux retraits du build ne s'y ` +
                  `applique.`,
            derived: false,
        };
    }
    return {
        defect:
            JSON.stringify(json, null, 2) === fullBuf.toString("utf-8")
                ? null
                : `le livrable n'est pas ce que les deux retraits du build (liaisons au backend ` +
                  `de preuve, téléchargement de tuiles) font du fichier de poste.`,
        derived: true,
    };
}

/**
 * DLF-05 — the service worker is the same file but for its two derived constants.
 *
 * @param {string} localText Workstation `sw-core.js`.
 * @param {string} fullText Shippable `sw-core.js`.
 * @returns {string[]} The defects — empty when the two agree.
 */
function compareServiceWorker(localText, fullText) {
    const mine = localText.split("\n");
    const theirs = fullText.split("\n");
    if (mine.length !== theirs.length) {
        return [`${mine.length} ligne(s) côté poste, ${theirs.length} côté livrable.`];
    }
    /** @type {string[]} */
    const defects = [];
    for (let i = 0; i < mine.length; i++) {
        if (mine[i] === theirs[i]) continue;

        const versionMine = mine[i].match(CACHE_VERSION_LINE);
        const versionTheirs = theirs[i].match(CACHE_VERSION_LINE);
        if (versionMine && versionTheirs) {
            // The fingerprint is a function of the pre-cached CONTENT, which differs by
            // construction (the shell, the bootstrap). What precedes it is the version.
            if (versionMine[1] !== versionTheirs[1] || versionMine[2] !== versionTheirs[2]) {
                defects.push(
                    `ligne ${i + 1} — CACHE_VERSION diffère hors de son empreinte :\n` +
                        `          poste    : ${mine[i].trim()}\n` +
                        `          livrable : ${theirs[i].trim()}`
                );
            }
            continue;
        }

        const assetsMine = mine[i].match(STATIC_ASSETS_LINE);
        const assetsTheirs = theirs[i].match(STATIC_ASSETS_LINE);
        if (assetsMine && assetsTheirs) {
            /** @type {string[]} */
            let listMine;
            /** @type {string[]} */
            let listTheirs;
            try {
                listMine = JSON.parse(assetsMine[1]);
                listTheirs = JSON.parse(assetsTheirs[1]);
            } catch {
                defects.push(`ligne ${i + 1} — STATIC_ASSETS n'est pas un tableau JSON lisible.`);
                continue;
            }
            const extra = listMine.filter((u) => !listTheirs.includes(u));
            const missing = listTheirs.filter((u) => !listMine.includes(u));
            const onlyBootstrap = extra.length === 1 && extra[0] === DEV_CONNECTOR_FILE;
            if (!onlyBootstrap || missing.length > 0) {
                defects.push(
                    `ligne ${i + 1} — STATIC_ASSETS diffère au-delà du bootstrap de poste :\n` +
                        `          poste seulement    : ${extra.join(", ") || "—"}\n` +
                        `          livrable seulement : ${missing.join(", ") || "—"}`
                );
            }
            continue;
        }

        defects.push(
            `ligne ${i + 1} diffère hors des deux constantes dérivées :\n` +
                `          poste    : ${mine[i].trim().slice(0, 110)}\n` +
                `          livrable : ${theirs[i].trim().slice(0, 110)}`
        );
    }
    return defects;
}

/**
 * Compares a workstation variant to the shippable variant built from the same sources.
 *
 * PURE with respect to the process: reads the two trees, writes nothing, prints nothing
 * and never exits — so a mutation can be played on COPIES, without touching the deploy a
 * dev URL is serving.
 *
 * @param {string} localDir Absolute path of the workstation variant.
 * @param {string} fullDir Absolute path of the shippable variant it must equal.
 * @param {{backendBaseUrl?: string | null}} [options] `backendBaseUrl` — the origin the
 *   shippable variant was built with. Defaults to the build's own reading of the
 *   environment.
 * @returns {{errors: string[], stats: {identical: number, derived: number, bytes: number, precompressed: number}}}
 *   The defects, each prefixed by its rule, and the perimeter actually compared.
 */
function compareVariants(localDir, fullDir, options = {}) {
    const backendBaseUrl =
        options.backendBaseUrl === undefined ? BACKEND_BASE_URL : options.backendBaseUrl;
    const local = listFiles(localDir);
    const full = listFiles(fullDir);
    /** @type {string[]} */
    const errors = [];
    const stats = {
        identical: 0,
        derived: 0,
        bytes: 0,
        precompressed: local.precompressed + full.precompressed,
    };

    // DLF-02 — what lives on one side only.
    const contract = new Set(SERVER_CONTRACT_FILES);
    for (const rel of [...full.files.keys()].sort()) {
        if (local.files.has(rel) || contract.has(rel)) continue;
        errors.push(`DLF-02 ${rel} — dans le livrable, absent de la variante de poste.`);
    }
    for (const rel of [...local.files.keys()].sort()) {
        if (full.files.has(rel) || rel === DEV_CONNECTOR_FILE) continue;
        errors.push(`DLF-02 ${rel} — dans la variante de poste, absent du livrable.`);
    }
    if (!local.files.has(DEV_CONNECTOR_FILE)) {
        errors.push(
            `DLF-02 ${DEV_CONNECTOR_FILE} — absent de la variante de poste, qui existe pour le ` +
                `porter : ce répertoire n'est pas ce que produit \`build:deploy:local\`.`
        );
    }

    // DLF-01 / 03 / 04 / 05 — what lives on both.
    /** @type {Set<string>} */
    const covered = new Set();
    for (const rel of [...local.files.keys()].sort()) {
        const fullAbs = full.files.get(rel);
        if (fullAbs === undefined) continue;
        const mine = fs.readFileSync(/** @type {string} */ (local.files.get(rel)));
        const theirs = fs.readFileSync(fullAbs);
        covered.add(rel);
        stats.bytes += theirs.length;

        if (rel === APP_SHELL) {
            const defect = compareAppShell(mine.toString("utf-8"), theirs.toString("utf-8"));
            if (defect) errors.push(`DLF-03 ${rel} — ${defect}`);
            else stats.derived++;
        } else if (rel === SERVICE_WORKER) {
            const defects = compareServiceWorker(mine.toString("utf-8"), theirs.toString("utf-8"));
            for (const defect of defects) errors.push(`DLF-05 ${rel} — ${defect}`);
            if (defects.length === 0) stats.derived++;
        } else if (rel.startsWith(PROFILES_PREFIX) && rel.endsWith(".json")) {
            const { defect, derived } = compareProfileJson(mine, theirs, backendBaseUrl);
            if (defect) errors.push(`DLF-04 ${rel} — ${defect}`);
            else if (derived) stats.derived++;
            else stats.identical++;
        } else if (mine.equals(theirs)) {
            stats.identical++;
        } else {
            errors.push(`DLF-01 ${rel} — diffère du livrable.`);
        }
    }

    // DLF-06 — the comparison is not empty.
    //
    // 🛑 WITHOUT THIS BLOCK, TWO EMPTY TREES ARE EQUAL. A `dist/` rename, a walk that no
    // longer descends: zero file compared, zero difference, a green. The witnesses are
    // named by ROLE — the bundle entry, a chunk — rather than by a count nobody could
    // justify.
    if (!covered.has(BUNDLE_ENTRY) || ![...covered].some((rel) => rel.startsWith(CHUNKS_PREFIX))) {
        errors.push(
            `DLF-06 — la comparaison n'a couvert ni \`${BUNDLE_ENTRY}\` ni un fichier sous ` +
                `\`${CHUNKS_PREFIX}\` des deux côtés (${covered.size} fichier(s) comparé(s)). ` +
                `REFUSE DE CONCLURE : deux arbres vides sont égaux.`
        );
    }

    return { errors, stats };
}

function main() {
    const localDir = path.join(DEPLOY, WORKSTATION_VARIANT_NAME);
    const fullDir = path.join(DEPLOY, FULL_VARIANT_NAME);
    const localRel = path.relative(ROOT, localDir);
    const fullRel = path.relative(ROOT, fullDir);

    // ── DLF-00 — the subject, then the reference ─────────────────────────────
    if (!fs.existsSync(localDir)) {
        console.log(
            `${C.yellow}↷ DEPLOY-LOCAL-FRESH${C.x} DLF-00 — SAUTÉ : ${localRel}/ est absent.\n` +
                `  ${C.dim}Aucune variante de poste sur ce clone, donc rien qui puisse y servir un ` +
                `ancien bundle. Elle n'existe que là où \`npm run build:deploy:local\` a tourné.${C.x}`
        );
        return;
    }
    if (!fs.existsSync(fullDir)) {
        console.error(
            `${C.red}✖ DEPLOY-LOCAL-FRESH${C.x} DLF-00 — ${localRel}/ existe, sa référence ` +
                `${fullRel}/ non.\n` +
                `  ${C.dim}Construire d'abord : npm run build:deploy. Cette gate lit le déployé ` +
                `que l'étape « Build deploy variants » de ci:local vient de produire.${C.x}`
        );
        process.exit(1);
    }
    console.log(`${C.dim}DLF-00 — ${localRel}/ comparé à ${fullRel}/${C.x}`);

    const { errors, stats } = compareVariants(localDir, fullDir);

    const compared =
        `${stats.identical} fichier(s) identique(s) à l'octet, ${stats.derived} re-dérivé(s) ` +
        `(coquille, service worker, profils), ${(stats.bytes / (1024 * 1024)).toFixed(1)} Mo ` +
        `lus côté livrable ; ${stats.precompressed} pré-compressé(s) hors comparaison`;

    if (errors.length) {
        console.error(
            `\n${C.red}${C.bold}✖ DEPLOY-LOCAL-FRESH — ${errors.length} défaut(s)${C.x} : ` +
                `${localRel}/ n'est pas le build de ${fullRel}/\n`
        );
        for (const e of errors.slice(0, MAX_SHOWN)) console.error(`  ${C.red}•${C.x} ${e}`);
        if (errors.length > MAX_SHOWN) {
            console.error(`  ${C.dim}… et ${errors.length - MAX_SHOWN} autre(s).${C.x}`);
        }
        console.error(
            `\n  ${C.dim}Comparé : ${compared}${C.x}\n\n` +
                `  ${C.bold}Remède : npm run build:deploy:local${C.x}\n` +
                `  ${C.dim}\`ci:local\` rebâtit ${FULL_VARIANT_NAME} à chaque run et jamais ` +
                `${WORKSTATION_VARIANT_NAME} : la régénérer avant de le lancer. Tant qu'elle ne ` +
                `l'est pas, son URL de dev répond pour un build antérieur.${C.x}\n`
        );
        process.exit(1);
    }

    console.log(
        `${C.green}✔ DEPLOY-LOCAL-FRESH${C.x} : ${localRel}/ est le build de ${fullRel}/ — ` +
            `à ce que \`includeDevConnector\` produit près.\n` +
            `  ${C.dim}Comparé : ${compared}${C.x}`
    );
}

module.exports = { compareVariants };

if (require.main === module) {
    main();
}
