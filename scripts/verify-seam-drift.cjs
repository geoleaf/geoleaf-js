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
                // STRUCT S6 — re-pin. Ce seam a rougi sur un déplacement qui ne le VISAIT pas :
                // `pill-search.ts` est l'un des importeurs de `dom-security.ts`, et son chemin
                // d'import a changé. Diff normalisé mesuré = UNE chaîne, la ligne d'import
                // (`../../utils/general/dom-security.js` → `../security/dom-security.js`).
                // La copie jumelle n'a rien reçu, et c'est correct : geocoding n'importe pas
                // `dom-security` — elle INLINE son propre équivalent de `createSVGIcon`
                // (`geocoding/src/ui/pill-search.ts:80`), ce qui est précisément la raison
                // d'être d'INV-NS. Il n'y avait donc aucun changement à propager, seulement
                // un hash à reprendre. Re-pin ciblé, pas `SEAM_PIN=1` global — celui-ci
                // aurait aussi absorbé une dérive réelle ailleurs sans la montrer.
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
    // ── `storage-contract (core ↔ storage)` — seam RETIRÉ à l'API publique S4.4 ──────────
    //
    // Il enregistrait une COPIE délibérée : le plugin détenait sa propre vue du contrat, avec
    // pour justification « the plugin owns its copy of the contract shape ».
    //
    // Ce n'était pas une copie de FORME, c'était une seconde INSTANCE. `StorageContract` porte
    // son état dans un `let` de portée module, initialisé par le core ; un plugin chargé en
    // `<script type="module">` a son propre graphe et ne peut pas le partager. La copie n'était
    // donc jamais initialisée — `isAvailable()` rendait `false` pour toujours et `whenReady()`
    // ne résolvait jamais, dans le bundle publié.
    //
    // Le plugin ADAPTE désormais `globalThis.GeoLeaf.Storage`, la façade du core : il n'y a
    // plus deux copies à tenir synchrones, donc plus rien à épingler. Un seam qui survivrait à
    // la disparition de sa paire épinglerait un fichier contre lui-même.
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
                // qualite Q5.4 — re-pin CIBLÉ après que la gate a vu la dérive. La lecture
                // `url.split(",")[0]` du parseur de MIME `data:` passe en déstructuration avec
                // défaut des DEUX côtés du seam ; le pendant core est
                // `kernel/security/validators.ts extractDataUrlMimeType`, corrigé à l'identique
                // au lot précédent. Les deux copies ne diffèrent toujours que par leur sortie
                // (l'une rend `null`, l'autre jette), ce qui est la différence documentée.
                rel: "src/sanitize.ts",
                hash: "c158d801e921a12505a66f7795a97212c184a619aa8423769d8821eb78b19bfc",
            },
        ],
    },

    // ── Les 3 seams ajoutés à STRUCT S2 (F9) — la moitié « G2 » du sprint ────────────────
    //
    // ⚠️ Ils comblent un trou que S2 n'a PAS créé : il préexistait. `verify-plugin-shared-fork`
    // exempte les DEUX côtés d'une paire core ↔ host-runtime (`CANONICAL_HOME:46` et
    // `PEER_SOURCE:57`), parce que le core possède ces symboles en propre — il n'est pas un
    // consommateur de fork. Résultat : rien ne confrontait ces paires, et PSF affichait du vert
    // dessus. Mesuré à S2 : les 2 premières existaient déjà avant le sprint.
    //
    // ⚠️ Ce que S2 a écarté, et pourquoi : les familles `log`, `i18n`, `download` et
    // `map-access` n'ont AUCUN jumeau core. Leurs seams sont des ACCESSEURS délégants
    // (`getGeoLeaf()?.Log?.warn(…)`), pas des copies — `core/src/utils/log/logger.ts` fait
    // 260 L de moteur là où `log-seam.ts` en fait 4 de délégation. Les épingler ensemble
    // sonnerait à chaque édition du moteur sans jamais rien avoir à réconcilier. La cible
    // « 1 famille = 1 seam » de la roadmap était donc inatteignable, et c'est tant mieux.
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
                // STRUCT S6 — ex-`src/utils/general/dom-security.ts` (verdict E3). Le hash change
                // avec le déplacement : ses 2 lignes d'import ont bougé (`sanitizeHTML` pris sur la
                // feuille `./sanitizers.js` au lieu du baril, pour ne pas fermer le cycle
                // `index.ts → dom-security.ts → index.ts`). `createSVGIcon`, le corps que ce seam
                // existe pour re-confronter à host-runtime, est INCHANGÉ — vérifié au diff.
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
            "soit chargé (B-138). Elles restent ré-exportées ici sous leurs noms d'origine, " +
            "donc les 6 sites appelants du moteur ne bougent pas. RELU avant ré-épinglage, et " +
            "le verdict est le même dans l'autre sens : `host.ts` n'a AUCUN diff, et " +
            "`coreConfigGet` — la seule des trois appariées qui vive dans ce fichier — est " +
            "inchangée, corps compris. Ce qui a bougé est, une fois de plus, du code NON " +
            "APPARIÉ. Le seam lui-même n'a pas dérivé.",
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
                hash: "f25a48c94cb43a7bc5763bda0455b15d8db91fbfe42126b0419609f50edef975",
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
                // ⚠️ RÉ-ÉPINGLÉ à la tâche 5.1c (05/08/2026), après relecture de la copie
                // appariée : le changement porte sur `_getLabel` seul — la résolution
                // hôte → catalogue intégré → clé — et `dom-seam.ts` n'a AUCUNE occurrence de
                // `_getLabel`. Les deux copies restent donc appariées sur ce qu'elles
                // partagent réellement (`_el` / `applyCssText`).
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
 * this very file: the `storage-contract` seam was REMOVED at S4.4 and the counter simply
 * went from 4 to 3 without a word. That is the class `probe-gate-visibility.cjs` exists to
 * catch, and this gate claimed its protection in its own docblock without ever having it.
 *
 * The floor is DERIVED at STRUCT S2 (F9) from the register as it stood — never a number
 * typed into a comment. `probe-gate-visibility.cjs:541-543` reproaches itself for exactly
 * that mistake ("Compte DÉRIVÉ … il était écrit 4/4 en dur, et a menti").
 *
 * Raising it is a deliberate act: add seams first, then raise. LOWERING it means a pair
 * genuinely stopped existing — say so in a comment, as the `storage-contract` block does.
 */
// 5.1-f — ABAISSÉ de 6/15 à 5/13, et le motif est écrit comme ce bloc l'exige : la paire
// `poi-to-feature (core ↔ addpoi)` a CESSÉ D'EXISTER, son second fichier
// (`addpoi/src/utils/core-utils.ts`) étant parti avec le paquet fusionné.
// ⚠️ La moitié CORE, elle, SURVIT : `poi-to-feature.ts` est monté sur `GeoLeaf.Utils`, couvert
// par 10 tests et appelé par `e2e/18-security.spec.js` sur `deploy-full` — la variante qui
// n'a jamais eu addpoi. C'est le seam qui disparaît, pas la fonction.
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

// ── Plancher du registre, AVANT toute lecture de fichier ──────────────────────────────
// Vérifié même en mode pin : un registre qui a rétréci ne doit pas pouvoir être re-épinglé
// silencieusement. C'est la seule panne MUETTE que cette gate avait — tout le reste jette.
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
            `bloc \`storage-contract\` le fait pour son retrait au S4.4.`
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

// Le compte de FICHIERS est affiché, pas seulement celui des seams : c'est la grandeur que
// le plancher protège, et un chiffre qu'on ne voit pas est un chiffre qu'on ne relit pas.
console.log(
    `✅ [seam-drift] ${SEAMS.length} seams / ${fileCount} fichiers épinglés, aucun n'a dérivé ` +
        `(plancher ${FLOOR.seams} / ${FLOOR.files}).`
);
