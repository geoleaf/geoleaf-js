/**
 * Boot golden master — the 0-regression oracle.
 *
 * Captures the boot's observable state:
 *   (a) the exact order of the `geoleaf:boot:*` perf markers emitted by boot-core.ts;
 *   (b) the surface of `GeoLeaf.*` facades present after a full boot.
 *
 * ⚠️ REFORGED — it was ACTOR AND ORACLE, hence blind.
 *
 * Before, this file did two things that cancelled its own power:
 *   1. it **stubbed `registry.init()`** — i.e. precisely the orchestrator the
 *      "boot → registry convergence" work rewrites. It validated a world that does not exist;
 *   2. it **replayed the 8 `runModuleSetup(id)` itself**, then checked the facades
 *      were populated. It thus tested its own call, not the code's. Commenting out
 *      `runModuleSetup` in any `*.module.ts` left it GREEN.
 *   (Its list included `"poi"`, an id long dissolved — without effect, but telling.)
 *
 * The reforge's principle: **the stub goes UNDER the object under test, never ABOVE.** MapLibre
 * is mocked globally (`__tests__/setup.js`), so `registry.init()` runs FOR REAL and the
 * real `XModule.init()`s call their setup. Without a real map, the modules
 * set their facades then stop cleanly ("Map not available — skipping UI init"):
 * exactly what a SURFACE master must observe.
 *
 * What it now catches: any module that stops setting its facades (the surface drops).
 * What it does NOT catch, by construction — and belongs to the other tiers:
 *   - the PRE-boot anchors (`GeoLeaf.I18n`/`notify`): here, `CoreMapModule.init()` replants them
 *     during boot, so the post-boot surface stays intact even if the import no longer sets
 *     them → that is the contract frozen by `__tests__/bundle-boot-contract.test.js` (artefact tier);
 *   - the `_APIController` getter's body: `Object.keys()` does not invoke getters, this master
 *     only sees its NAME → `__tests__/api/api-controller-getter.test.js`;
 *   - Rollup DCE and rendering → artefact tier and browser probe.
 *
 * The baselines are hardcoded arrays, NOT snapshots: `vitest -u` must not be able to
 * stamp a regression. Updated by hand, after reading the diff.
 *
 * NB: this file imports the REAL globals chain — it does not mock `globals.js`
 * (unlike boot.test.js) — so the facades are really populated.
 */
"use strict";

// helpers/boot no longer import the globals chain as a side effect (they
// read the pure accessor `ensureGeoLeaf()`). The REAL globals chain is
// loaded explicitly to populate `globalThis.GeoLeaf` (B1→B11) before requiring the boot.
// ⚠️ The ORDER of these three lines is load-bearing (B1→B11) and ESM
// `import`s run in source order, exactly like the `require`s they replace.
import "../../src/globals/globals.js";
// Load helpers (populates _app) then the real boot.
import "../../src/app/app-namespace.js";
import * as bootModule from "../../src/app/boot.js";
import {
    walkNamespace,
    diffSurface,
    EXPECTED_FACADE_KEYS,
    EXPECTED_FACADE_MEMBERS,
    DEPTH2_FACADES,
} from "../../../../scripts/lib/namespace-surface.mjs";

const _app = bootModule._app;
const GeoLeaf = globalThis.GeoLeaf;
// NO setup is triggered by this test any more. The facades are set by phase A
// (at the import of the globals chain above), exactly as in the shipped
// bundle. The `runModuleSetup("config")` an earlier pass had to add here —
// because `geoleaf.*.js` is aliased under vitest, so the shim did not pull —
// fell away on its own, as announced.

// ── Frozen baselines (updated 2026-06-28) ──
// New order: profileResources loads BEFORE registry.init()
// (modules receive the full profile config at their init()).

const EXPECTED_BOOT_MARKS = [
    "geoleaf:boot:loadConfig:start",
    "geoleaf:boot:loadConfig:end",
    "geoleaf:boot:profileResources:start",
    "geoleaf:boot:profileResources:end",
    "geoleaf:boot:registry:start",
    "geoleaf:boot:registry:end",
];

// EXPECTED_FACADE_KEYS now lives in `scripts/lib/namespace-surface.mjs`:
// one walk, one list, four readers — including the HOST-SYNC gate, which
// reads it from the AST instead of parsing it as text.

describe("boot — golden master (oracle 0-régression S1→S4)", () => {
    let captured;

    beforeAll(async () => {
        const marks = [];
        const origMark = performance.mark;
        // Spy performance.mark — more robust than getEntriesByName under happy-dom.
        performance.mark = (name) => {
            marks.push(name);
            return undefined;
        };
        window.__GEOLEAF_PERF__ = true;

        // I/O only — network reads are out of this master's scope. We replace the METHOD, not
        // the whole `GeoLeaf.Config` façade: overwriting the object would hand the real modules
        // a Config without `.get()` during registry.init().
        GeoLeaf.loadConfig = (opts) => setTimeout(() => opts.onLoaded({}), 0);
        GeoLeaf.Config.loadActiveProfileResources = () => Promise.resolve({});

        _app._appStarted = false;
        // S6 Lot 1: public API instead of forcing the private `_initialized = false`. Harmless
        // here (the registry has never been init'd at this point, so `_initOrder` is empty and
        // destroy() only re-arms), but the crutch had no reason to outlive the bug it hid.
        if (GeoLeaf._registry) GeoLeaf._registry.destroy();

        await _app.startApp();
        await new Promise((r) => setTimeout(r, 30));

        performance.mark = origMark;
        captured = {
            // `geoleaf:boot:*` only — CALIBRATED, not assumed. 16 marks exist in the codebase,
            // but the 10 `geoleaf:init:*` ones are emitted from INSIDE the module init()s that
            // need a real map (`core-map.module.ts`, `ui.module.ts/134`,
            // `init-deferred-ui.ts`). Under a mocked MapLibre the map is never created,
            // UIModule logs "Map not available — skipping UI init", and those marks never fire.
            // Freezing them here would freeze a fiction. The browser probe (FILET 4) is what
            // asserts their real order.
            marks: marks.filter((m) => String(m).startsWith("geoleaf:boot:")),
            facades: walkNamespace(GeoLeaf).keys,
            members: walkNamespace(GeoLeaf, { descend: DEPTH2_FACADES }).members,
            // Second snapshot 30 ms later: at depth 2 the surface depends on
            // the `init()`s' progress, not only phase A. A divergence
            // between the two is the start of a flaky test — and a flaky
            // test always ends up `skip`ped.
            membersAgain: null,
        };
        await new Promise((r) => setTimeout(r, 30));
        captured.membersAgain = walkNamespace(GeoLeaf, { descend: DEPTH2_FACADES }).members;
    });

    it("émet les marqueurs `geoleaf:boot:*` dans l'ordre figé", () => {
        expect(captured.marks).toEqual(EXPECTED_BOOT_MARKS);
    });

    it("expose exactement les MEMBRES figés des façades contractuelles", () => {
        // Depth 2. Without it, commenting out `on` in
        // `kernel/events/facade.ts` left ALL the surface tests green: the
        // `Events` key was still there, on an object having lost the only
        // method plugins call.
        // ⚠️ This title said "the 8 facades" until 10/08/2026; they are 22
        // since the inverse contract's widening. The number is removed from
        // the title rather than corrected: it reads in `DEPTH2_FACADES`,
        // which this loop iterates, and a test title is the last place
        // anyone thinks of updating a counter.
        for (const facade of DEPTH2_FACADES) {
            const d = diffSurface(EXPECTED_FACADE_MEMBERS[facade], captured.members[facade] ?? []);
            expect(
                d.missing,
                `GeoLeaf.${facade} — membres DISPARUS : ${d.missing.join(", ")}`
            ).toEqual([]);
            expect(d.extra, `GeoLeaf.${facade} — membres APPARUS : ${d.extra.join(", ")}`).toEqual(
                []
            );
        }
    });

    it("la surface de profondeur 2 est stable entre deux mesures", () => {
        // A snapshot that moves between two reads 30 ms apart is a flaky
        // test in the making, and a flaky test ends up `skip`ped — hence
        // guarding nothing. Better to know it here than in six months.
        expect(captured.membersAgain).toEqual(captured.members);
    });

    it("expose exactement la surface de façades `GeoLeaf.*` figée", () => {
        // The named diff first: on ~90 keys, `toEqual` alone says "array differs at index 11".
        const d = diffSurface(EXPECTED_FACADE_KEYS, captured.facades);
        expect(d.missing, `clés DISPARUES du namespace : ${d.missing.join(", ")}`).toEqual([]);
        expect(d.extra, `clés APPARUES sur le namespace : ${d.extra.join(", ")}`).toEqual([]);
        // Final net: the strict equality stays, it is not replaced.
        expect(captured.facades).toEqual([...EXPECTED_FACADE_KEYS].sort());
    });
});
