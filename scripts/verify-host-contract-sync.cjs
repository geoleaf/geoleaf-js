#!/usr/bin/env node
/**
 * HOST-SYNC: the two descriptions of the `GeoLeaf` namespace must not drift (API publique S3.5).
 *
 * ## The two descriptions, and why there are two
 *
 * `GeoLeafGlobal` (`packages/core/src/global.d.ts`) is the core's own ambient view of
 * `window.GeoLeaf`. `GeoLeafHost` (`packages/libs/host-runtime/src/host.ts`) is the view
 * plugins consume. They describe the same runtime object and they are NOT linked by the
 * compiler — deliberately: `@geoleaf/host-runtime` is bundled into every plugin, and its
 * own barrel states the rule in capitals — *"do not import from `@geoleaf/core` here, **not
 * even a type**"*. That rule is load-bearing and this gate does not challenge it; it exists
 * precisely because the rule forbids the cheap solution.
 *
 * The drift was measured, not feared:
 *
 *   - `POI?: Record<string, unknown>` sat in `GeoLeafHost` after the POI subsystem was
 *     dissolved at S9. A contract member for a thing the runtime never mounts. (Removed at
 *     S1; HOST-01 below is what stops the next one.)
 *   - `GeoJSON`, the single most-called member of the host (87 call sites in the plugins),
 *     was in neither description — plugins reached it through the `[key: string]: unknown`
 *     tail and got `unknown` back.
 *   - `Core`, `plugins`, `registry`, `I18n`, `Storage` were named by `GeoLeafHost` and by
 *     nothing on the core side, although `GeoLeafHost`'s own docblock claims it is *"kept in
 *     sync (loosely) with the core source of truth `GeoLeafGlobal`"*.
 *
 * ## The three invariants
 *
 *   HOST-01  Every named member of `GeoLeafHost` exists in the post-boot namespace oracle.
 *            → this is the `POI` defect, mechanically. A contract may not promise a member
 *              the runtime does not mount.
 *   HOST-02  Every named member of `GeoLeafGlobal` exists in that same oracle.
 *            → the same rule applied to the core's own description, which has no more right
 *              to describe a phantom than the host does.
 *   HOST-03  Every named member of `GeoLeafHost` is also a named member of `GeoLeafGlobal`.
 *            → makes the "loosely kept in sync" claim checkable. The host is a VIEW of the
 *              core's description; it may be narrower, never wider.
 *
 * ## Why the oracle, and not a running browser
 *
 * `EXPECTED_FACADE_KEYS` in `scripts/lib/namespace-surface.mjs` is the frozen list of keys
 * present on `window.GeoLeaf` after boot — **92** of them, asserted by tests that fail if the
 * real namespace disagrees. Reading it here means this gate inherits a measurement instead of
 * taking one, and stays a sub-second static check.
 *
 * ⚠️ Two figures in this paragraph were wrong until API S4.2, and both in the direction that
 * flatters: the oracle left the test file for `lib/` at S4.1, and it holds 92 keys, not 103 —
 * 13 `_` keys with no reader were removed at S4.3b. A comment that names a file the gate no
 * longer reads is the failure mode this repo calls n°3; it survives precisely because it
 * never reddens.
 *
 * ⚠️ **And the same paragraph said 89 until the contrat inverse S1.1 (10/08/2026) — three
 * sites, not two.** The count is derived (`EXPECTED_FACADE_KEYS.length`), the prose was not,
 * and the drift is the very defect the paragraph above narrates. The third site is the
 * `FLOOR` comment below, which additionally claimed 28 members for `GeoLeafGlobal` when the
 * gate itself prints 102. **A figure written in prose next to the command that derives it is
 * a figure that will diverge** — the three now carry that command in one place, here:
 *
 *     node -e 'import("./scripts/lib/namespace-surface.mjs").then(m =>
 *       console.log(m.EXPECTED_FACADE_KEYS.length))'   → oracle
 *     node scripts/verify-host-contract-sync.cjs        → host / global, on its green line
 *
 * ⚠️ It also means the oracle is load-bearing for FOUR things now (this gate ×3,
 * `check-namespace-typing-coverage.cjs` for its corpus). If it is ever loosened, they loosen
 * with it silently — which is why HOST-01/02 also fail when the oracle cannot be parsed or
 * comes back short (see the floor below).
 *
 * ## What this gate does NOT check
 *
 * Member TYPES. It compares names. A member whose declared shape drifts on both sides stays
 * invisible here — that half is the compiler's, and it is asserted by
 * `packages/core/examples/consumer/extension-contract.ts`, which is type-checked through the
 * published `exports` map by `npm run typecheck:consumer`. Two instruments, same reason as
 * `verify-published-types.cjs` (structural, runs on a clean checkout) and
 * `published-types.ts` (compiler, cannot be fooled by a rule that turns out to be folklore).
 *
 * Usage: node scripts/verify-host-contract-sync.cjs
 */

"use strict";

const path = require("node:path");

const registry = require("./lib/packages.cjs");
// API S4.2 — les deux lecteurs d'AST sont sortis d'ici vers `lib/` le jour où
// `check-namespace-typing-coverage.cjs` en a eu besoin. Deux copies d'un lecteur dérivent, et
// la dérive reste invisible tant que les deux gates sortent vertes. Le motif de refus, lui,
// est écrit dans la lib : il porte le bug de regex de l'API S4 C0.
const { readInterfaceMembers, readExportedStringArray } = require("./lib/ts-decl-read.cjs");

const ROOT = registry.ROOT;

// Resolved through the registry — a hard-coded `packages/libs/host-runtime` would stop
// matching the day the package moves and this gate would report "no drift" having read
// nothing. `requireByDirName` throws instead. (cf. `probe-gate-visibility.cjs`.)
const CORE_DIR = registry.requireByDirName("core").absDir;
const HOST_DIR = registry.requireByDirName("host-runtime").absDir;

const GLOBAL_DTS = path.join(CORE_DIR, "src", "global.d.ts");
const HOST_TS = path.join(HOST_DIR, "src", "host.ts");
// API S4.1 — l'oracle a quitté le fichier de test pour la source unique. La gate n'a plus
// à parser un fichier dont la forme ne lui est pas destinée : elle lit un `export const`.
const ORACLE = path.join(ROOT, "scripts", "lib", "namespace-surface.mjs");

/**
 * Members `GeoLeafGlobal` may declare without the runtime mounting them under that exact
 * name. Every entry needs a reason; an unexplained exemption is indistinguishable from a
 * name someone got tired of chasing.
 *
 * ⚠️ **Renseignée le 27/07/2026 (B-13), et c'est une conséquence directe du retrait de la
 * traîne `[key: string]: unknown` de `GeoLeafGlobal`.** Tant que la traîne était là, ces
 * membres n'étaient PAS déclarés nommément — HOST-02 ne les voyait donc pas. Les déclarer
 * les a rendus visibles, et a révélé que l'invariant confondait deux choses : « déclaré » et
 * « toujours monté ». Un membre **optionnel** l'est par définition sous condition ; l'oracle,
 * lui, mesure **un boot core seul**.
 *
 * Deux familles, deux motifs distincts — à ne pas confondre en les relisant :
 */
const ORACLE_EXEMPT = new Map([
    // ── (1) Namespaces montés par un PLUGIN ──────────────────────────────────────────────
    // Absents d'un boot core seul PAR CONSTRUCTION : le core ne les référence jamais
    // (`no-plugin-in-core`). Ils sont déclarés dans `GeoLeafGlobal` parce que le namespace
    // est la route sanctionnée du plugin vers l'hôte (`MODULE_CONTRACT.md`), et optionnels
    // parce que leur présence dépend du plugin chargé.
    //
    // ⚠️ Les 5 dernières entrées sont arrivées avec **B-52** (27/07/2026), et ce contrat est
    // celui qui a exigé qu'on écrive leur motif. Elles complètent la liste : les 12 plugins qui
    // montent un namespace y sont désormais tous, ce qui rend la section (1) **exhaustive et
    // vérifiable** — `plugin-namespace-declared.guard.test.js` garde l'autre bout de la chaîne
    // (tout namespace monté est déclaré), celui-ci garde qu'un membre déclaré mais absent d'un
    // boot core seul porte sa raison. `offline-ui` n'y figure pas et n'y figurera pas : il ne
    // monte aucun namespace propre, il pilote `GeoLeaf.Storage`, façade du core.
    ["COG", "monté par @geoleaf-plugins/cog"],
    ["Connector", "monté par @geoleaf-plugins/connector"],
    ["Editor", "monté par @geoleaf-plugins/editor — déclaré à B-52"],
    ["FileImport", "monté par @geoleaf-plugins/file-import — déclaré à B-52"],
    ["FlatGeobuf", "monté par @geoleaf-plugins/flatgeobuf"],
    ["Geocoding", "monté par @geoleaf-plugins/geocoding"],
    [
        "Measure",
        "monté par @geoleaf-plugins/measure — déclaré à B-52 (⚠️ ne pas confondre avec `measure`, l'aide de mesure de performance, qui n'en diffère que par la casse)",
    ],
    ["Print", "monté par @geoleaf-plugins/print — déclaré à B-52"],
    ["RealtimeLayer", "monté par @geoleaf-plugins/realtime-layer"],
    ["Table", "monté par @geoleaf-plugins/table"],
    [
        "Ws",
        "monté par @geoleaf-plugins/websocket sous le nom `Ws`, pas `Websocket` — déclaré à B-52",
    ],

    // ── (2) Membres du core CONDITIONNELS au runtime ─────────────────────────────────────
    ["_beforeBootCallback", "écrit seulement si `boot({ beforeBoot })` reçoit un hook"],
    ["_perfCallback", "écrit seulement si `boot({ onPerformanceMetrics })` reçoit un rappel"],
    ["_debugPerf", "armé par `?perf=1` uniquement"],

    // ⚠️ Les trois suivants sont montés INCONDITIONNELLEMENT — mais par
    // `bundle-esm-entry.ts:36`, PAS par la chaîne `globals/` que l'oracle mesure. Ils sont
    // donc réellement présents dans l'artefact livré et absents du golden master, qui
    // importe la chaîne directement. **Ce n'est pas un défaut de ce contrat, c'est un écart
    // entre l'oracle et l'artefact** — couvert par le tier artefact
    // (`__tests__/bundle-boot-contract.test.js`), pas par celui-ci. Noté ici plutôt que tu.
    ["getPerformanceMetrics", "monté par bundle-esm-entry, hors périmètre de l'oracle globals/"],
    ["getRuntimeMetrics", "idem — alias de getPerformanceMetrics"],
    ["resetRuntimeMetrics", "idem"],
]);

const C = { r: "\x1b[31m", g: "\x1b[32m", d: "\x1b[2m", c: "\x1b[36m", x: "\x1b[0m" };

/**
 * Reads `EXPECTED_FACADE_KEYS` from the AST of the single source.
 *
 * The technique — and the five refusals that go with it — now live in
 * `lib/ts-decl-read.cjs`, which carries the full account of the regex bug this replaced
 * (API S4 C0: a lazy `[\s\S]*?` bounded on `];` ran past `].sort();` to the NEXT `];`,
 * so the gate read 104 keys for a 103-key array and any string written below the array —
 * inside a comment included — became a valid namespace key).
 */
function readOracle() {
    return readExportedStringArray(ORACLE, "EXPECTED_FACADE_KEYS", { tag: "HOST-SYNC" });
}

// ── Run ──────────────────────────────────────────────────────────────────────────────

const oracle = readOracle();
const host = readInterfaceMembers(HOST_TS, "GeoLeafHost", { tag: "HOST-SYNC" });
const globalD = readInterfaceMembers(GLOBAL_DTS, "GeoLeafGlobal", { tag: "HOST-SYNC" });

// ── Non-vacuity ──────────────────────────────────────────────────────────────────────
// A gate that compares three empty sets agrees with itself perfectly and proves nothing.
// The floors are deliberately well under today's values (92 / 15 / 102) — they catch an
// instrument that collapsed, not a surface that shrank legitimately.
// ⚠️ Ce triplet disait `89 / 15 / 28` jusqu'au 10/08/2026, et DEUX de ses trois nombres
// étaient faux — l'oracle (92) et `GeoLeafGlobal` (102, pas 28). Les trois sont imprimés à
// chaque run vert par la ligne de sortie tout en bas de ce fichier : c'est là qu'on les lit,
// jamais ici.
const FLOOR = { oracle: 50, host: 5, global: 10 };
for (const [label, set, min] of [
    ["oracle (EXPECTED_FACADE_KEYS)", oracle, FLOOR.oracle],
    ["GeoLeafHost", host, FLOOR.host],
    ["GeoLeafGlobal", globalD, FLOOR.global],
]) {
    if (set.size < min) {
        console.error(
            `ERROR [HOST-SYNC]: ${label} ne rend que ${set.size} membre(s) (plancher ${min}). ` +
                "Sous le plancher, la gate REFUSE de conclure — elle serait verte en n'ayant rien lu."
        );
        process.exit(2);
    }
}

const inOracle = (name) => oracle.has(name) || ORACLE_EXEMPT.has(name);

const host01 = [...host].filter((n) => !inOracle(n)).sort();
const host02 = [...globalD].filter((n) => !inOracle(n)).sort();
const host03 = [...host].filter((n) => !globalD.has(n)).sort();

let failed = false;

if (host01.length > 0) {
    failed = true;
    console.error(
        `${C.r}✗${C.x} [HOST-SYNC/HOST-01] ${host01.length} membre(s) de \`GeoLeafHost\` ` +
            "n'existent pas sur le namespace post-boot :"
    );
    for (const n of host01) console.error(`    ${n}`);
    console.error(
        `${C.d}    C'est le défaut \`POI\` : un contrat qui promet un membre que le runtime\n` +
            `    ne monte pas. Retirez-le de host.ts, ou montez-le et mettez l'oracle à jour.${C.x}`
    );
}

if (host02.length > 0) {
    failed = true;
    console.error(
        `${C.r}✗${C.x} [HOST-SYNC/HOST-02] ${host02.length} membre(s) de \`GeoLeafGlobal\` ` +
            "n'existent pas sur le namespace post-boot :"
    );
    for (const n of host02) console.error(`    ${n}`);
}

if (host03.length > 0) {
    failed = true;
    console.error(
        `${C.r}✗${C.x} [HOST-SYNC/HOST-03] ${host03.length} membre(s) de \`GeoLeafHost\` ` +
            "ne sont pas décrits par `GeoLeafGlobal` :"
    );
    for (const n of host03) console.error(`    ${n}`);
    console.error(
        `${C.d}    \`GeoLeafHost\` est une VUE de \`GeoLeafGlobal\` — plus étroite, jamais plus\n` +
            `    large. Déclarez le membre dans packages/core/src/global.d.ts.${C.x}`
    );
}

if (failed) process.exit(1);

console.log(`${C.c}── 🔗 Synchronisation des deux contrats du namespace ──${C.x}\n`);
console.log(
    `${C.g}✓${C.x}  \`GeoLeafHost\` ${host.size} membres ⊆ \`GeoLeafGlobal\` ${globalD.size} ` +
        `⊆ oracle post-boot ${oracle.size} ; aucune dérive.`
);
process.exit(0);
