#!/usr/bin/env node
/**
 * HOST-SYNC: the two descriptions of the `GeoLeaf` namespace must not drift.
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
 * ⚠️ Two figures in this paragraph were wrong, and both in the direction that
 * flatters: the oracle left the test file for `lib/`, and it holds 92 keys, not 103 —
 * 13 `_` keys with no reader were removed since. A comment that names a file the gate no
 * longer reads is the failure mode this repo calls n°3; it survives precisely because it
 * never reddens.
 *
 * ⚠️ **And the same paragraph said 89 until 10/08/2026 — three
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
// Both AST readers left this file for `lib/` the day
// `check-namespace-typing-coverage.cjs` needed them. Two copies of a reader drift, and
// the drift stays invisible as long as both gates come out green. The refusal
// rationale, for its part, is written in the lib: it carries the regex bug story.
const { readInterfaceMembers, readExportedStringArray } = require("./lib/ts-decl-read.cjs");

const ROOT = registry.ROOT;

// Resolved through the registry — a hard-coded `packages/libs/host-runtime` would stop
// matching the day the package moves and this gate would report "no drift" having read
// nothing. `requireByDirName` throws instead. (cf. `probe-gate-visibility.cjs`.)
const CORE_DIR = registry.requireByDirName("core").absDir;
const HOST_DIR = registry.requireByDirName("host-runtime").absDir;

const GLOBAL_DTS = path.join(CORE_DIR, "src", "global.d.ts");
const HOST_TS = path.join(HOST_DIR, "src", "host.ts");
// The oracle left the test file for the single source. The gate no longer has to
// parse a file whose shape was not meant for it: it reads an `export const`.
const ORACLE = path.join(ROOT, "scripts", "lib", "namespace-surface.mjs");

/**
 * Members `GeoLeafGlobal` may declare without the runtime mounting them under that exact
 * name. Every entry needs a reason; an unexplained exemption is indistinguishable from a
 * name someone got tired of chasing.
 *
 * ⚠️ **Filled in on 2026-07-27, a direct consequence of removing the
 * `[key: string]: unknown` tail from `GeoLeafGlobal`.** While the tail was there, these
 * members were NOT declared by name — HOST-02 thus did not see them. Declaring them
 * made them visible, and revealed that the invariant conflated two things: "declared"
 * and "always mounted". An **optional** member is by definition conditional; the
 * oracle, for its part, measures **a core-only boot**.
 *
 * Two families, two distinct rationales — not to be conflated when re-reading:
 */
const ORACLE_EXEMPT = new Map([
    // ── (1) Namespaces mounted by a PLUGIN ───────────────────────────────────────────────
    // Absent from a core-only boot BY CONSTRUCTION: the core never references them
    // (`no-plugin-in-core`). They are declared in `GeoLeafGlobal` because the namespace
    // is the plugin's sanctioned route to the host (`MODULE_CONTRACT.md`), and optional
    // because their presence depends on the loaded plugin.
    //
    // ⚠️ The 5 entries that arrived on 2026-07-27 completed the list, and this contract
    // is what demanded their rationale be written. EVERY plugin mounting a namespace is
    // here, which makes section (1) **exhaustive and verifiable**
    // — `plugin-namespace-declared.guard.test.js` guards the other end of the chain
    //
    // ⚠️ This sentence said "the 12 plugins" until 2026-08-21, and the number went stale
    // twice before being removed: the fleet grew to 13 with `position-share`, then to 15
    // with `routing` and `navigation`. A count copied next to a growing list goes stale
    // at every addition, and nothing reddens — the DEFENDED property is exhaustiveness,
    // not the cardinal. It derives: `node -e "const p=require('./scripts/lib/packages.cjs');
    // console.log(p.plugins().length)"`.
    // (every mounted namespace is declared); this one guards that a member declared yet
    // absent from a core-only boot carries its reason. `offline-ui` is not here and will
    // not be: it mounts no namespace of its own, it drives `GeoLeaf.Storage`, a core
    // facade.
    ["COG", "monté par @geoleaf-plugins/cog"],
    ["Connector", "monté par @geoleaf-plugins/connector"],
    ["Editor", "monté par @geoleaf-plugins/editor"],
    ["FileImport", "monté par @geoleaf-plugins/file-import"],
    ["FlatGeobuf", "monté par @geoleaf-plugins/flatgeobuf"],
    ["Geocoding", "monté par @geoleaf-plugins/geocoding"],
    [
        "Measure",
        "monté par @geoleaf-plugins/measure (⚠️ ne pas confondre avec `measure`, l'aide de mesure de performance, qui n'en diffère que par la casse)",
    ],
    ["Print", "monté par @geoleaf-plugins/print"],
    [
        "PositionShare",
        "monté par @geoleaf-plugins/position-share — et il est chargé PARESSEUSEMENT par l'app (`registerLazy`), donc absent d'un boot core seul à double titre",
    ],
    ["RealtimeLayer", "monté par @geoleaf-plugins/realtime-layer"],
    [
        "Routing",
        "monté par @geoleaf-plugins/routing — chargé EAGER par sa balise `<script>` d'index.html, mais l'oracle mesure un boot CORE SEUL, où aucune balise de plugin n'est jouée : l'exemption tient donc pour la même raison que les paresseux, et non parce qu'il le serait",
    ],
    [
        "Navigation",
        "monté par @geoleaf-plugins/navigation — paresseux (`registerLazy`), donc absent d'un boot core seul à double titre, comme PositionShare",
    ],
    ["Table", "monté par @geoleaf-plugins/table"],
    ["Ws", "monté par @geoleaf-plugins/websocket sous le nom `Ws`, pas `Websocket`"],

    // ── (2) Core members CONDITIONAL at runtime ──────────────────────────────────────────
    //
    // 🛑 `DEBUG` is of a THIRD nature, worth distinguishing from the other two sections:
    // it is neither a member the core sometimes mounts, nor a namespace a plugin mounts
    // — it is a member the **INTEGRATOR** sets (`window.GeoLeaf.DEBUG = true`) and the
    // library only READS (`kernel/config/debug-flag.ts`, at every call, so the toggle
    // takes effect without a reload). It will thus NEVER be on the post-boot namespace
    // of an oracle measuring what the code writes, and that is correct.
    // ⚠️ It was declared on 2026-08-19 because its absence was a PUBLIC API defect: the
    // `[key: string]: unknown` tail that absorbed it was removed on purpose, and an
    // integrator following the instruction written in the accessor got TS2339. The hole
    // was invisible from the inside — no gate tracks what the code READS from the
    // namespace; `namespace-local-views.guard.test.ts` is what found it, and now guards
    // that class.
    ["DEBUG", "posé par l'intégrateur, jamais par la bibliothèque — lu par getDebugMode()"],
    ["_beforeBootCallback", "écrit seulement si `boot({ beforeBoot })` reçoit un hook"],
    ["_perfCallback", "écrit seulement si `boot({ onPerformanceMetrics })` reçoit un rappel"],
    ["_debugPerf", "armé par `?perf=1` uniquement"],

    // ⚠️ The next three are mounted UNCONDITIONALLY — but by `bundle-esm-entry.ts`,
    // NOT by the `globals/` chain the oracle measures. They are thus genuinely present
    // in the shipped artifact and absent from the golden master, which imports the
    // chain directly. **Not a defect of this contract, but a gap between the oracle and
    // the artifact** — covered by the artifact tier
    // (`__tests__/bundle-boot-contract.test.js`), not by this one. Noted here rather
    // than silenced.
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
// ⚠️ This triplet said `89 / 15 / 28` until 2026-08-10, and TWO of its three numbers
// were wrong — the oracle (92) and `GeoLeafGlobal` (102, not 28). All three are printed
// at every green run by the output line at the very bottom of this file: that is where
// they are read, never here.
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
