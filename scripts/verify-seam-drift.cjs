#!/usr/bin/env node
/**
 * Guards the DELIBERATE seams — files intentionally copied across the plugin↔core
 * boundary rather than shared through an import (PLUGINS S9).
 *
 * ## Why a gate for a copy
 *
 * A handful of helpers are duplicated on purpose. `pill-search.ts` lives in both the
 * core and `plugin-geocoding` because a plugin must not import core sources (INV-NS,
 * gated by `verify-plugin-core-boundary.cjs`); `storage-contract.ts` and
 * `field-renderer/sanitize.ts` are the same kind of documented seam. They are meant to
 * stay close, but may legitimately diverge in spots (geocoding's `_createIcon` is a
 * local re-implementation of a core helper).
 *
 * The failure mode this exists to prevent is the one PLUGINS S1 found the hard way:
 * `coreConfigGet` drifted from its nine live copies precisely because it was dead and
 * nothing ever confronted it with them. A copy that no one re-reads drifts in silence.
 *
 * ## What it asserts — and what it deliberately does NOT
 *
 * It does NOT assert the two copies are equal (they aren't, and can't be). It pins a
 * normalized hash of EACH side and fails when either changes. A red gate is not "these
 * files must match" — it is "you edited one half of a seam; go look at the other half,
 * decide whether it needs the same change, then re-pin." The re-confrontation is the
 * whole point.
 *
 * Normalization strips comments and collapses whitespace, so re-wording a comment or
 * reformatting never trips it — only a change to the code does.
 *
 * ## Re-pinning
 *
 * After a deliberate, reconciled change, refresh the pinned hashes:
 *
 *     SEAM_PIN=1 node scripts/verify-seam-drift.cjs
 *
 * paste the printed `hash` values into SEAMS below, and commit them alongside the
 * code change so the pin and the code move together.
 *
 * Paths resolve through the workspace registry (`requireByDirName` THROWS if a package
 * moves) so a relocation fails loudly instead of scanning nothing and passing green —
 * the blindness class `probe-gate-visibility.cjs` watches for.
 *
 * Usage: node scripts/verify-seam-drift.cjs (from repo root)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const registry = require("./lib/packages.cjs");
const ROOT = registry.ROOT;

/**
 * The registered seams. Each `files` entry is one side of a deliberate copy, pinned
 * by its normalized hash. `pkg` is a directory basename resolved via the workspace
 * registry; `rel` is the path within that package.
 */
const SEAMS = [
    {
        label: "pill-search (core ↔ geocoding)",
        why: "INV-NS: geocoding must not import core sources — see ADR-11 / CDC_technique seam register.",
        files: [
            {
                pkg: "core",
                // Re-pin after the security-directory move. This seam reddened on a move
                // that did not TARGET it: `pill-search.ts` is one of `dom-security.ts`'s
                // importers, and its import path changed. Measured normalized diff = ONE
                // string, the import line
                // (`../../utils/general/dom-security.js` → `../security/dom-security.js`).
                // The twin copy received nothing, and that is correct: geocoding does not
                // import `dom-security` — it INLINES its own equivalent of `createSVGIcon`
                // (`geocoding/src/ui/pill-search.ts`), which is precisely INV-NS's
                // reason to exist. There was thus no change to propagate, only a hash to
                // re-take. Targeted re-pin, not a global `SEAM_PIN=1` — the latter would
                // also have absorbed a real drift elsewhere without showing it.
                rel: "src/kernel/ui/pill-search.ts",
                hash: "1f5647fb085868302d3f0442b5eed7fa353a84e3b198ca347473902352976932",
            },
            {
                pkg: "geocoding",
                rel: "src/ui/pill-search.ts",
                hash: "ce78cae5276868e728c35d3552d2576587330bcee6f119a65cc4f24c581bb886",
            },
        ],
    },
    // ── `storage-contract (core ↔ storage)` — seam REMOVED ──────────
    //
    // It recorded a deliberate COPY: the plugin held its own view of the contract, with
    // the justification "the plugin owns its copy of the contract shape".
    //
    // It was not a copy of SHAPE, it was a second INSTANCE. `StorageContract` carries
    // its state in a module-scoped `let`, initialized by the core; a plugin loaded as
    // `<script type="module">` has its own graph and cannot share it. The copy was thus
    // never initialized — `isAvailable()` returned `false` forever and `whenReady()`
    // never resolved, in the published bundle.
    //
    // The plugin now ADAPTS `globalThis.GeoLeaf.Storage`, the core's facade: there are
    // no longer two copies to keep in sync, hence nothing left to pin. A seam that
    // outlived its pair's disappearance would pin a file against itself.
    {
        label: "sanitize (core ↔ field-renderer)",
        why: "field-renderer/sanitize.ts is a documented copy of the core sanitizers.",
        files: [
            {
                pkg: "core",
                rel: "src/kernel/security/sanitizers.ts",
                hash: "8a9045b9ffbbea954f7658a68b26cb99779d8bcdc7407eb9c9a05effbc2ada8f",
            },
            {
                pkg: "field-renderer",
                // TARGETED re-pin after the gate saw the drift. The `data:` MIME
                // parser's `url.split(",")[0]` read moves to destructuring-with-default
                // on BOTH sides of the seam; the core counterpart is
                // `kernel/security/validators.ts extractDataUrlMimeType`, fixed
                // identically in the previous batch. The two copies still differ only in
                // their output (one returns `null`, the other throws), which is the
                // documented difference.
                rel: "src/sanitize.ts",
                hash: "c158d801e921a12505a66f7795a97212c184a619aa8423769d8821eb78b19bfc",
            },
        ],
    },

    // ── The 3 seams added when the shared-fork blind spot was measured ───────────────────
    //
    // ⚠️ They fill a hole that work did NOT create: it pre-existed.
    // `verify-plugin-shared-fork` exempts BOTH sides of a core ↔ host-runtime pair
    // (`CANONICAL_HOME:46` and `PEER_SOURCE:57`), because the core owns those symbols
    // outright — it is not a fork consumer. Result: nothing confronted these pairs, and
    // PSF showed green on them. Measured at the time: the first 2 already predated the
    // work.
    //
    // ⚠️ What was set aside, and why: the `log`, `i18n`, `download` and `map-access`
    // families have NO core twin. Their seams are delegating ACCESSORS
    // (`getGeoLeaf()?.Log?.warn(…)`), not copies — `core/src/utils/log/logger.ts` is
    // 260 L of engine where `log-seam.ts` is 4 L of delegation. Pinning them together
    // would ring at every engine edit without ever having anything to reconcile. The
    // "1 family = 1 seam" target was therefore unreachable, and that is for the best.
    {
        label: "core-utils (core ↔ host-runtime)",
        why:
            "core-utils-seam.ts carries REAL implementations, not accessors: getNestedValue and " +
            "createSVGIcon were measured byte-identical to the core's after normalization " +
            "(2510699d7a / a397088b6f). host-runtime cannot import the core (bundle contract), " +
            "so nothing but this pin re-confronts the two sides when one changes.",
        files: [
            {
                pkg: "core",
                rel: "src/utils/general/object-utils.ts",
                hash: "9b1e009b237a395ce7bcdbacb72aaabe7c2fcb79672940ed2977aa514531454f",
            },
            {
                pkg: "core",
                // Formerly `src/utils/general/dom-security.ts`, moved under
                // `kernel/security/`. The hash changes with the move: its 2 import lines
                // moved (`sanitizeHTML` taken from the `./sanitizers.js` leaf instead of
                // the barrel, to avoid closing the `index.ts → dom-security.ts →
                // index.ts` cycle). `createSVGIcon`, the body this seam exists to
                // re-confront with host-runtime, is UNCHANGED — verified on the diff.
                rel: "src/kernel/security/dom-security.ts",
                hash: "461cba5b577ecc37405097835e8ca2ee9648f589fd1270de2e2dd1422f76c99c",
            },
            {
                pkg: "host-runtime",
                rel: "src/core-utils-seam.ts",
                hash: "593246fd92307b75e7d76f54adf7eb007a501c77bc64c9efa3b1db580bb94f73",
            },
        ],
    },
    {
        label: "host-global (core ↔ host-runtime)",
        why:
            "host.ts MIRRORS the core's getGeoLeaf / ensureGeoLeaf / coreConfigGet — its own " +
            "docblock says so. The bodies are structurally identical and already DIVERGENT in " +
            "detail (host adds a `typeof cfg.get === 'function'` guard). coreConfigGet is the " +
            "very function whose drift motivated verify-plugin-shared-fork; this pair had never " +
            "been pinned. " +
            "⚠️ Tâche 4.1 (04/08/2026) — `config-seam.ts` a gagné `coreProfileLayerConfig()`, et " +
            "la copie de host-runtime N'A PAS ÉTÉ SUIVIE, délibérément : le seam n'apparie que " +
            "getGeoLeaf / ensureGeoLeaf / coreConfigGet, et aucun plugin n'a besoin de lire la " +
            "config AUTORÉE d'une couche. La porter côté hôte élargirait GeoLeafHost, ce que " +
            "HOST-03 n'autorise que dans le sens inverse. Le pair a été relu avant d'être " +
            "ré-épinglé. " +
            "⚠️ Tâche 4.8 (04/08/2026) — MÊME CAS, même verdict : `coreProfileLayers()` est " +
            "l'extraction de la boucle de `coreProfileLayerConfig()`, que le rapport de " +
            "synchronisation parcourt couche par couche. Elle lit la même source non " +
            "appariée, donc elle ne se mirroite pas davantage. RELU avant ré-épinglage : " +
            "`host.ts` porte toujours exactement getGeoLeaf / ensureGeoLeaf / coreConfigGet, " +
            "et AUCUNE des trois n'a été touchée par 4.8 — seul du code non apparié s'est " +
            "ajouté au fichier. C'est ce que le hachage a vu bouger, pas le seam lui-même. " +
            "⚠️ Tâche 8.7 (07/08/2026) — TROISIÈME fois, et cette fois par SOUSTRACTION : " +
            "`coreProfileLayerConfig()` et `coreProfileLayers()` ont QUITTÉ ce fichier pour " +
            "`kernel/shared/edition-permissions.ts` (graphe de boot), parce que la façade " +
            "`GeoLeaf.Storage` doit lire une permission de couche sans que le chunk hors-ligne " +
            "soit chargé. Elles restent ré-exportées ici sous leurs noms d'origine, " +
            "donc les 6 sites appelants du moteur ne bougent pas. RELU avant ré-épinglage, et " +
            "le verdict est le même dans l'autre sens : `host.ts` n'a AUCUN diff, et " +
            "`coreConfigGet` — la seule des trois appariées qui vive dans ce fichier — est " +
            "inchangée, corps compris. Ce qui a bougé est, une fois de plus, du code NON " +
            "APPARIÉ. Le seam lui-même n'a pas dérivé. " +
            "⚠️ 20/08/2026 — QUATRIÈME fois, et pour la première fois sur un TYPE et non sur du " +
            "code : `GeoLeafHost.registry` gagne `isInitialized?(): boolean`. Sous la traîne " +
            "`[key: string]: unknown` le membre typait `unknown`, donc l'appeler rendait un " +
            "TS2349 — le seam décrivait un membre qu'un plugin pouvait lire et pas utiliser, " +
            "alors que six d'entre eux ont une décision réelle à en tirer (un créneau de barre " +
            "d'outils est honoré avant `boot()` et inerte après). RELU avant ré-épinglage : " +
            "aucune des TROIS fonctions appariées n'est touchée, `git diff` ne rend que ce " +
            "membre et son commentaire. Et le sens est celui que HOST-03 autorise — le core " +
            "déclare déjà `registry?: IModuleRegistry`, qui porte `isInitialized()` ; l'hôte " +
            "était plus ÉTROIT et le devient moins, il ne devient pas plus large.",
        files: [
            {
                pkg: "core",
                rel: "src/utils/general/geoleaf-global.ts",
                hash: "4e09d8c60523edf7cfcb74fc8f7a6b895e9a0b8ee2924c4dc812998fbc753ec9",
            },
            {
                pkg: "core",
                rel: "src/capabilities/offline/config-seam.ts",
                hash: "56513e7dd005997dbc12c220362a2ecaaad9c7c33df47e27c4a87b1f172abc9b",
            },
            {
                pkg: "host-runtime",
                rel: "src/host.ts",
                // ⚠️ Re-pinned on 2026-08-19, AFTER re-reading the paired copy — fourth
                // time, and the first where the change touches one of the three paired
                // functions. `ensureGeoLeaf` lost one type assertion per branch
                // (`{} as HostCarrier`) that the useless-assertion rule flagged.
                //
                // 🔺 The re-read's verdict is that the core copy ALREADY CARRIES the
                // targeted shape: it asserts once on the whole ternary and leaves the
                // empty literal bare. The two halves therefore CONVERGE instead of
                // diverging — the direction this seam exists to preserve, and there was
                // nothing to carry to the other side. No behaviour changes, on either
                // side.
                // ⚠️ 2026-08-20 — re-pinned for a TYPE member, not for code:
                // `GeoLeafHost.registry` now names `isInitialized?(): boolean`. None of
                // the three paired functions moved (`git diff` renders only that
                // member), and the direction is the one HOST-03 allows — the host was
                // narrower than the core, it now is less so. TARGETED re-pin on this one
                // hash, never a global `SEAM_PIN=1`.
                hash: "bd9a10374e3c7f8f10a4308e81c5059a0e51c6547b142a580060d32cf3bb7e1e",
            },
        ],
    },
    {
        label: "dom-primitives (host-runtime ↔ field-renderer)",
        why:
            "STRUCT S2 (F4) canonised _el/applyCssText into dom-seam.ts under non-colliding " +
            "names (createEl/applyStyleText) because field-renderer DEFINES the underscore " +
            "names and IS scanned by verify-plugin-shared-fork. field-renderer keeps its copies " +
            "— it has no dependency on host-runtime, and adding one to share seven lines would " +
            "pull a second library into every consumer's type graph. Four un-confronted copies " +
            "therefore became ONE pinned pair, which is this seam. applyCssText was measured " +
            "byte-identical between the two sides.",
        files: [
            {
                pkg: "host-runtime",
                rel: "src/dom-seam.ts",
                hash: "bd37156260b76f14e2c7eec0a47942430fdf7c5600e77f4cd48396cb053c0f4d",
            },
            {
                pkg: "field-renderer",
                // ⚠️ RE-PINNED on 2026-08-05, after re-reading the paired copy: the
                // change bears on `_getLabel` alone — the host → built-in catalogue →
                // key resolution — and `dom-seam.ts` has NO occurrence of `_getLabel`.
                // The two copies thus stay paired on what they really share
                // (`_el` / `applyCssText`).
                rel: "src/helpers.ts",
                hash: "26f8efdd63e914f9cc132b94774ed06d103f95922fa6121e959bc5e1d4f7b7ca",
            },
            {
                pkg: "field-renderer",
                rel: "src/dom.ts",
                hash: "ee79b96662a9763e9fe537900f7185fe00c7af652505bda11dee6a0e1da9fbb7",
            },
        ],
    },
];

/**
 * Derived floor on the seam register — the gate's own anti-blindness guard.
 *
 * ⚠️ The success line prints `SEAMS.length` and NOTHING about files. A seam losing one of
 * its `files[]` entries was therefore completely silent, and the historical proof is in
 * this very file: the `storage-contract` seam was REMOVED and the counter simply
 * went from 4 to 3 without a word. That is the class `probe-gate-visibility.cjs` exists to
 * catch, and this gate claimed its protection in its own docblock without ever having it.
 *
 * The floor is DERIVED from the register as it stood when it was laid — never a number
 * typed into a comment. `probe-gate-visibility.cjs` reproaches itself for exactly that
 * mistake ('DERIVED count. It was written "4/4" hardcoded, and lied').
 *
 * Raising it is a deliberate act: add seams first, then raise. LOWERING it means a pair
 * genuinely stopped existing — say so in a comment, as the `storage-contract` block does.
 */
// LOWERED from 6/15 to 5/13, with the reason written as this block demands: the
// `poi-to-feature (core ↔ addpoi)` pair CEASED TO EXIST, its second file
// (`addpoi/src/utils/core-utils.ts`) having left with the merged package.
// ⚠️ The CORE half SURVIVES: `poi-to-feature.ts` is mounted on `GeoLeaf.Utils`, covered
// by 10 tests and called by `e2e/18-security.spec.js` on `deploy-full` — the variant
// that never had addpoi. The seam disappears, not the function.
const FLOOR = { seams: 5, files: 13 };

/**
 * Strip comments and collapse whitespace so cosmetic edits do not trip the gate.
 * Line comments preceded by `:` are preserved to leave `http://`-style URLs intact.
 * Applied identically when pinning and when checking, so any imperfection is at least
 * deterministic.
 *
 * @param {string} src
 * @returns {string}
 */
function normalize(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, "") // block comments (incl. the /*! banner */)
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1") // line comments, but not URL "://"
        .replace(/\s+/g, " ")
        .trim();
}

/** @param {string} s @returns {string} */
function sha256(s) {
    return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Resolve a seam file to its absolute path, failing loudly if the package moved or
 * the file is gone.
 * @param {{pkg: string, rel: string}} file
 * @returns {string}
 */
function resolveFile(file) {
    const abs = path.join(registry.requireByDirName(file.pkg).absDir, file.rel);
    if (!fs.existsSync(abs)) {
        throw new Error(
            `verify-seam-drift: seam file not found — ${path.relative(ROOT, abs)}. ` +
                `A registered seam vanished; update SEAMS or restore the file.`
        );
    }
    return abs;
}

const pinMode = process.env.SEAM_PIN === "1";
let failed = false;

// ── Registry floor, BEFORE any file read ──────────────────────────────────────────────
// Checked even in pin mode: a registry that has shrunk must not be re-pinnable
// silently. It is the only MUTE failure this gate had — everything else throws.
const fileCount = SEAMS.reduce((n, s) => n + s.files.length, 0);
if (SEAMS.length < FLOOR.seams || fileCount < FLOOR.files) {
    console.error(
        `\n❌ [seam-drift] le registre a RÉTRÉCI : ${SEAMS.length} seams / ${fileCount} fichiers, ` +
            `plancher ${FLOOR.seams} / ${FLOOR.files}.`
    );
    console.error(
        `   Retirer un seam, ou un fichier de son \`files[]\`, réduit la couverture SANS ` +
            `qu'aucune ligne ne rougisse : le message de succès ne compte que les seams.\n` +
            `   Si une paire a réellement cessé d'exister, baissez FLOOR en le DISANT — comme le ` +
            `bloc \`storage-contract\` le fait pour son retrait.`
    );
    process.exit(1);
}

if (pinMode) {
    console.log("# SEAM_PIN — computed normalized hashes (paste into SEAMS):\n");
}

for (const seam of SEAMS) {
    for (const file of seam.files) {
        const abs = resolveFile(file);
        const actual = sha256(normalize(fs.readFileSync(abs, "utf8")));
        const rel = path.relative(ROOT, abs);

        if (pinMode) {
            console.log(`# ${seam.label}\n${rel}\n  hash: "${actual}",\n`);
            continue;
        }

        if (file.hash !== actual) {
            failed = true;
            console.error(`\n❌ [SEAM] ${seam.label}`);
            console.error(`   ${rel}`);
            console.error(`   expected ${file.hash}`);
            console.error(`   actual   ${actual}`);
            console.error(`   → This seam file's code changed. It is a DELIBERATE copy`);
            console.error(`     (${seam.why})`);
            console.error(`     Re-read its paired copy, apply the same change if it needs it,`);
            console.error(`     then re-pin:  SEAM_PIN=1 node scripts/verify-seam-drift.cjs`);
        }
    }
}

if (pinMode) process.exit(0);

if (failed) {
    console.error("\n[seam-drift] ❌ A registered seam drifted — see above.");
    process.exit(1);
}

// The FILE count is shown, not only the seam count: it is the quantity the floor
// protects, and a number one does not see is a number one does not re-read.
console.log(
    `✅ [seam-drift] ${SEAMS.length} seams / ${fileCount} fichiers épinglés, aucun n'a dérivé ` +
        `(plancher ${FLOOR.seams} / ${FLOOR.files}).`
);
