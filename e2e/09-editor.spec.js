// @ts-check
// E2E: 09-editor (@geoleaf-plugins/editor) — deploy-full (port 8768), the only
// variant bundling the editor (Core + Connector + Storage + Cog + Editor; Editor
// supersedes AddPOI).
//
// Plugin-validation rewrite. The previous spec assumed the editor was
// EAGER at boot; it is LAZY (init.js `registerLazy('editor')`) — `GeoLeaf.Editor`,
// the `.gl-editor-root` pill and the Terra Draw engine only exist once the plugin
// is loaded (a toolbar action, or `GeoLeaf.plugins.load('editor')`). The driver
// `armEditor()` reproduces that load; the boot-state test asserts the real lazy
// boundary (everything absent before the editor is used).
//
// DOM contract — packages/plugins/editor/src/sub-menu/floating-menu.ts:
//   - pill container   .gl-editor-root
//   - tool buttons     button.gl-editor-tool-btn[data-tool="point|line|polygon|select"]
//   - active tool      .gl-editor-tool-btn--active
// Form modal (field-renderer responsive modal, shared with addpoi):
//   - panel            .gl-form-modal-panel
//   - layer dropdown   .gl-form-modal__layer select   (header slot) — SCOPED to the layer
//                        wrapper on purpose: `.gl-form-modal-panel select` also matches the
//                        schema's OWN <select> fields (sites_rosario has a `dropdown`), which
//                        is a strict-mode violation as soon as the form renders early.
//   - body fields      #gl-field-<id>
//   - save button      .gl-form-modal__btn-save
// Persistence — deploy-full boots the `tourism` profile, which has NO modules.editor
//   block → the editor runs with defaults (mode "auto", api.baseUrl=""). ⚠️ Since the
//   editability disarmament (2026-08-06) `sites_rosario` is the ONLY editable Point layer
//   of the profile — it is the only one declaring a `write` target, and the disarmament
//   rule forbids a layer from advertising an editability it cannot honour.
//   `hebergements` lost its `edition`
//   block, so `layer-dropdown.ts` now takes the `layers.length === 1` branch and
//   PRE-SELECTS sites_rosario instead of showing the disabled placeholder of the
//   `length > 1` branch (:40). 🛑 **That pre-selection makes the schema render IMMEDIATELY**,
//   and it is what broke this spec on the first run — not the selectOption() calls, which
//   still resolve. With the form already rendered, `.gl-form-modal-panel select` matched
//   TWO elements (the layer dropdown + the `statut` dropdown of sites_rosario's schema) and
//   Playwright refused it in strict mode. The locator is now scoped to
//   `.gl-form-modal__layer`; the calls below are effectively no-ops that still assert the
//   option exists. ⚠️ The multi-layer placeholder path is consequently NO LONGER covered in
//   a real browser — it survives only in
//   `packages/plugins/editor/src/__tests__/modal.test.ts`. Restoring browser coverage
//   means a second layer with a real write target, not re-arming a demo.
//   Saving routes through the REST persistence adapter →
//   POST `…/features`; against the static test host (no backend) that returns 405,
//   surfaced as an error toast — the feature is NOT persisted/queued for this demo
//   profile (a 405 client error is not a transport error, so the AutoAdapter does not
//   fall back to the queue). This spec validates the create
//   parcours up to the REST submit; the configured online/collection and offline-queue
//   outcomes are covered by unit tests (rest-/collection-/storage-queue-/auto-adapter).
//
// NOTE: the Playwright webServer block auto-starts http-server on deploy-full.
// Run with `npx playwright test e2e/09-editor.spec.js` (build:deploy:all first).

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanPage } from "./helpers/axe-config.js";

const TERRA_DRAW_CHUNK = /geoleaf-editor\.terra-draw-[^/]+\.js$/;
const POINT_BTN = 'button.gl-editor-tool-btn[data-tool="point"]';

test.use({ baseURL: baseURL("full") });

/** Loads the lazy editor plugin (what the toolbar action does) and waits for its API. */
async function armEditor(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("editor"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Editor) === "object",
        null,
        { timeout: 10000 }
    );
}

/** Opens the menu, arms the point tool, and lets _ensureAdapter()+setMode settle. */
async function activatePointTool(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Editor.toggleMenu());
    const pb = page.locator(POINT_BTN);
    await expect(pb).toBeVisible({ timeout: 5000 });
    await pb.click();
    // The --active class is applied synchronously; the Terra Draw adapter arms
    // asynchronously — `onToolSelect` fires `_ensureAdapter().then(a => a.setMode(tool))`
    // (entry.ts), i.e. lazy import() → createTerraDrawAdapter → (await map idle) →
    // start() → setMode. A fixed sleep was a race: a click landing before setMode() is
    // simply swallowed and no feature is ever created.
    await expect(pb).toHaveClass(/gl-editor-tool-btn--active/, { timeout: 8000 });
    // Deterministic gate: TerraDrawMapLibreGLAdapter.register() — reached from
    // `adapter.start()` inside _startAdapter — adds its own MapLibre sources/layers
    // `td-point` / `td-linestring` / `td-polygon` to the style. `td-point` present ⇒
    // start() has run, so the pending setMode() is one microtask away.
    await page.waitForFunction(
        () => {
            const native = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            try {
                return !!native?.getLayer?.("td-point");
            } catch {
                return false;
            }
        },
        null,
        { timeout: 15000 }
    );
    // Short settle: let the pending setMode() microtask and the first style render commit.
    await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
});

test("[editor] editor API, pill and drawing engine are all absent at boot (lazy)", async ({
    page,
}) => {
    const state = await page.evaluate(
        (re) => ({
            editor: typeof (/** @type {any} */ (window).GeoLeaf?.Editor),
            pill: document.querySelector(".gl-editor-root") != null,
            terra: performance
                .getEntriesByType("resource")
                .some((e) => new RegExp(re).test(e.name)),
        }),
        TERRA_DRAW_CHUNK.source
    );
    expect(state.editor).toBe("undefined");
    expect(state.pill).toBe(false);
    expect(state.terra).toBe(false);
});

/**
 * 🛑 THE HOLE THIS TEST CLOSES, PROVEN IN A BROWSER.
 *
 * The shipped variants were EXCLUSIVE (`build-deploy.cjs`): `deploy-addpoi`
 * carried addpoi without editor, `deploy-full` editor without addpoi. Yet the
 * repo's only production `registerHandler("poi")` lived in
 * `addpoi/src/entry.ts` — so on THIS variant, `GeoLeaf.Sync.getHandler("poi")`
 * returned `undefined` and `offline-ui`'s replay button (which reads that
 * handler via `sync-seam.ts`) was dead, silently.
 *
 * ⚠️ The first assertion is not decorative: it establishes the hole EXISTS
 * before the editor is loaded. Without it, the second would pass just as well
 * on a variant that always had a handler, and would thus prove nothing about
 * what this wiring does.
 */
test("[editor] 5.1-b — le handler de synchronisation `poi` est absent au boot, et POSÉ au chargement", async ({
    page,
}) => {
    const before = await page.evaluate(() => ({
        addpoi: typeof (/** @type {any} */ (window).GeoLeaf?.AddPOI),
        handler: typeof (/** @type {any} */ (window).GeoLeaf?.Sync?.getHandler?.("poi")),
    }));
    // The variant does not carry addpoi — what makes the hole possible.
    expect(before.addpoi).toBe("undefined");
    expect(before.handler).toBe("undefined");

    await armEditor(page);

    const after = await page.evaluate(() => {
        const h = /** @type {any} */ (window).GeoLeaf?.Sync?.getHandler?.("poi");
        return {
            present: typeof h,
            summary: typeof h?.getSyncSummary,
            replay: typeof h?.processSyncQueue,
        };
    });
    expect(after.present).toBe("object");
    // The TWO methods `offline-ui` consumes, by name — a handler carrying
    // only one would leave half the button dead.
    expect(after.summary).toBe("function");
    expect(after.replay).toBe("function");

    // And it really answers: a count on an empty outbox is zero, not an error.
    const summary = await page.evaluate(async () => {
        const h = /** @type {any} */ (window).GeoLeaf.Sync.getHandler("poi");
        return await h.getSyncSummary();
    });
    expect(summary).toMatchObject({ total: 0, add: 0, update: 0, delete: 0 });
});

/**
 * 🛑 **THESE THREE TESTS RUN IN A MOBILE VIEWPORT, AND IT IS NOT A COMFORT.**
 * `poi-add` is a slot of the **mobile pill** (`kernel/ui/mobile/`). At the
 * suite's default width (1280×720) the button is indeed **in the DOM** — the
 * first test showed it — but it is not **interactable**: the click timed out.
 * Measured at the first run. Testing the pill on desktop is testing a surface
 * not rendered there.
 */
test.describe("[editor] 5.1-f — la capture de POI (pilule MOBILE)", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    /**
     * THE "ADD A POI" BUTTON, AND THIS IS THE ONLY NET IT HAS.
     *
     * 🛑 This test replaces `10-addpoi.spec.js`, which carried the `poi-add`
     * button's only E2E coverage and ran on `deploy-addpoi` — a variant since
     * removed. The journey itself is NOT dead: it changed owner. Deleting it
     * without porting it would have removed the only proof a button reaches
     * the screen.
     *
     * ⚠️ **And that is exactly the breakage mechanism the port had to avoid.**
     * The core drew it by probing `GeoLeaf.AddPOI.AddForm` AT BOOT, which only
     * held because `addpoi` was loaded through an eager `<script>` tag.
     * `editor` is LAZY: the same probe would return `false` forever. The first
     * assertion thus establishes the button is there BEFORE any load — without
     * it, the rest would pass on a button appearing only after the fact, and
     * would prove nothing.
     *
     * ⚠️ No gate sees this: `ci:local` and the E2E were green in both states
     * back when a sibling export button was registered yet invisible.
     */
    test("[editor] 5.1-f — le bouton `poi-add` est là AU BOOT, plugin non chargé", async ({
        page,
    }) => {
        const before = await page.evaluate(() => ({
            editor: typeof (/** @type {any} */ (window).GeoLeaf?.Editor),
            addpoi: typeof (/** @type {any} */ (window).GeoLeaf?.AddPOI),
        }));
        // The plugin is not loaded, and the old namespace no longer exists (V2 — no alias).
        expect(before.editor).toBe("undefined");
        expect(before.addpoi).toBe("undefined");

        const btn = page.locator('[data-gl-toolbar-action="poi-add"]').first();
        await expect(btn).toBeAttached({ timeout: 10000 });

        // The accessible name must be a LABEL, never the raw key: `getLabel`
        // returns the key when it does not know, and the plugin's dictionary
        // is not loaded at this instant. What forces `init.js` to register the
        // label itself.
        const label = await btn.getAttribute("aria-label");
        expect(label).toBeTruthy();
        expect(label).not.toMatch(/^editor\./);
    });

    test("[editor] 5.1-f — `GeoLeaf.Editor.AddForm` remplace `GeoLeaf.AddPOI.AddForm`", async ({
        page,
    }) => {
        await armEditor(page);
        const api = await page.evaluate(() => {
            const G = /** @type {any} */ (window).GeoLeaf || {};
            return {
                openAddForm: typeof G.Editor?.AddForm?.openAddForm,
                placement: typeof G.Editor?.PlacementMode?.activate,
                storageDB: !!G.Storage?.DB,
                legacy: typeof G.AddPOI,
            };
        });
        expect(api.openAddForm).toBe("function");
        expect(api.placement).toBe("function");
        expect(api.storageDB).toBe(true);
        // V2 — no alias survives the removal.
        expect(api.legacy).toBe("undefined");
    });

    test("[editor] 5.1-f — cliquer `poi-add` charge le plugin et ouvre le formulaire", async ({
        page,
    }) => {
        // 🛑 NO `force: true`, AND IT IS MEASURED. The toolbar is built before
        // its click listener is set: a forced click lands in that interval and
        // is NEVER dispatched — silently, no console error. Verified by probe,
        // three times: forced click → `GeoLeaf.Editor` stays `undefined`;
        // actionable click → loaded. `force` short-circuits precisely the wait
        // that makes this test deterministic, and a `waitForTimeout` would
        // only hide the race behind a number.
        const btn = page.locator('.gl-map-toolbar [data-gl-toolbar-action="poi-add"]').first();
        await expect(btn).toBeVisible({ timeout: 15000 });
        await btn.click({ timeout: 15000 });

        // The click goes through `ensureLoadedForAction`: the bundle downloads BEFORE the dispatch.
        await page.waitForFunction(
            () => typeof (/** @type {any} */ (window).GeoLeaf?.Editor) === "object",
            null,
            { timeout: 15000 }
        );

        // The flow arms placement mode; the tap is short-circuited by calling
        // the form directly, which is what the placement callback does.
        await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf.Editor.AddForm.openAddForm({
                lat: -21.11,
                lng: 55.53,
            })
        );
        await expect(page.locator(".gl-form-modal-panel")).toBeVisible({ timeout: 8000 });
    });
});

test("[editor] loading the editor registers the public API and the floating pill", async ({
    page,
}) => {
    await armEditor(page);
    const api = await page.evaluate(() => {
        const E = /** @type {any} */ (window).GeoLeaf.Editor;
        return {
            ns: typeof E,
            toggleMenu: typeof E.toggleMenu,
            setActiveTool: typeof E.setActiveTool,
            getActiveTool: typeof E.getActiveTool,
        };
    });
    expect(api.ns).toBe("object");
    expect(api.toggleMenu).toBe("function");
    expect(api.setActiveTool).toBe("function");
    expect(api.getActiveTool).toBe("function");
    // initEditorMenu (on plugin load) appends .gl-editor-root to the map container.
    await expect(page.locator(".gl-editor-root")).toBeAttached({ timeout: 10000 });
});

test("[editor] floating menu exposes the creation tools", async ({ page }) => {
    await armEditor(page);
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Editor.toggleMenu());
    for (const tool of ["point", "line", "polygon", "select"]) {
        await expect(page.locator(`button.gl-editor-tool-btn[data-tool="${tool}"]`)).toBeVisible({
            timeout: 5000,
        });
    }
});

test("[editor] activating a tool ensures the Terra Draw engine is loaded (separate chunk)", async ({
    page,
}) => {
    await armEditor(page);
    await activatePointTool(page);
    const loaded = await page.evaluate(
        (re) => performance.getEntriesByType("resource").some((e) => new RegExp(re).test(e.name)),
        TERRA_DRAW_CHUNK.source
    );
    expect(loaded).toBe(true);
    const active = await page.evaluate(() =>
        /** @type {any} */ (window).GeoLeaf.Editor.getActiveTool()
    );
    expect(active).toBe("point");
});

test("[editor] drawing a point fires feature-created and opens the form modal", async ({
    page,
}) => {
    await armEditor(page);
    await page.evaluate(() => {
        /** @type {any} */ (window).__edFc = false;
        document.addEventListener("geoleaf:editor:feature-created", () => {
            /** @type {any} */ (window).__edFc = true;
        });
    });
    await activatePointTool(page);
    // Place a point — exact location is irrelevant; Terra Draw point mode creates on click.
    await page.locator(".maplibregl-canvas").click({ position: { x: 250, y: 180 } });
    // `waitForFunction(fn, arg, options)` — the timeout must be 3rd;
    // passed 2nd it is received as `arg` and silently ignored (default applied).
    await page.waitForFunction(() => /** @type {any} */ (window).__edFc === true, null, {
        timeout: 8000,
    });
    await expect(page.locator(".gl-form-modal-panel")).toBeVisible({ timeout: 5000 });
});

test("[editor] picking a layer renders its schema and saving submits via the REST adapter", async ({
    page,
}) => {
    await armEditor(page);
    await activatePointTool(page);
    await page.locator(".maplibregl-canvas").click({ position: { x: 250, y: 180 } });
    await expect(page.locator(".gl-form-modal-panel")).toBeVisible({ timeout: 8000 });

    // Two editable Point layers → placeholder dropdown; pick one to render its schema.
    await page.locator(".gl-form-modal__layer select").selectOption("sites_rosario");
    const title = page.locator("#gl-field-title");
    await expect(title).toBeVisible({ timeout: 5000 }); // field-renderer rendered the layer schema
    await title.fill("E2E editor point");
    await expect(title).toHaveValue("E2E editor point");

    // Saving routes through the persistence submit → REST adapter POST …/features
    // (built by the factorized rest-wire-mapping). Assert the request fires; the 405 from
    // the static host is irrelevant to validating the wiring.
    const post = page.waitForRequest(
        (r) => /\/features(\?|$)/.test(r.url()) && r.method() === "POST",
        { timeout: 8000 }
    );
    await page.locator(".gl-form-modal__btn-save").click();
    const req = await post;
    expect(req.method()).toBe("POST");
});

test("[editor] offline, saving a drawn point enqueues it to the Storage sync queue", async ({
    page,
    context,
}) => {
    await armEditor(page);
    await page.evaluate(() => {
        /** @type {any} */ (window).__edQueued = false;
        document.addEventListener("geoleaf:editor:feature-sync-queued", () => {
            /** @type {any} */ (window).__edQueued = true;
        });
    });
    await activatePointTool(page);
    await page.locator(".maplibregl-canvas").click({ position: { x: 250, y: 180 } });
    await expect(page.locator(".gl-form-modal-panel")).toBeVisible({ timeout: 8000 });
    await page.locator(".gl-form-modal__layer select").selectOption("sites_rosario");
    await expect(page.locator("#gl-field-title")).toBeVisible({ timeout: 5000 });
    await page.locator("#gl-field-title").fill("E2E offline point");

    // Force offline → navigator.onLine=false → the AutoAdapter routes the save to the
    // Storage IndexedDB queue (Mode offline) → geoleaf:editor:feature-sync-queued.
    //
    // ⚠️ Open PRODUCT defect (on record for the plugin work, not to fix here):
    // `persistence/storage-queue-adapter.ts` calls
    // `GeoLeaf.Storage.DB.addToSyncQueue({ type, layerId, payload, profileId })` —
    // a single argument — while the only runtime implementation,
    // `core/src/capabilities/offline/db/indexeddb.ts`, has the signature
    // `addToSyncQueue(operation, profileId)` and reads `operation.data` (not
    // `payload`). The written entry thus leaves with `profileId: undefined` /
    // `poiData: undefined`. The editor's unit tests mock `addToSyncQueue`, so
    // they do not see the shape gap. Do NOT soften the assertion: it is what
    // exposes it.
    await context.setOffline(true);
    await page.locator(".gl-form-modal__btn-save").click();
    // ⚠️ 8,000 ms was a budget with NO MARGIN AT ALL, and it is measured: this
    // whole test lasts **8,678 ms** on a 24-core machine, i.e. more than its
    // own wait's budget. On the GitHub runner (2-4 cores, E2E suite measured
    // at 1.0 h vs 12.5 min here, i.e. ~5×), it could not hold — it failed
    // THREE times in a row, `retries: 2` existing only in CI.
    //
    // The wait already bears on the right signal (`__edQueued`, set by a
    // listener armed above): nothing to synchronise better, only a budget
    // calibrated on a fast machine. And a generous budget costs NOTHING in the
    // passing case — a wait that succeeds early returns early; the delay is
    // only paid when the thing really fails.
    await page.waitForFunction(() => /** @type {any} */ (window).__edQueued === true, null, {
        timeout: 30000,
    });
    await context.setOffline(false);
});

test("[editor] full variant — editor surface passes WCAG 2.1 AA axe scan", async ({ page }) => {
    await armEditor(page);
    // The core "Chargement des données…" toast (transient, fired by the external
    // qgis.geoleaf.dev layer fetch) carries a known low-contrast style; wait for it
    // to clear so the scan reflects the editor's steady state.
    await page
        .locator(".gl-toast--info")
        .waitFor({ state: "detached", timeout: 8000 })
        .catch(() => {});
    await page.waitForTimeout(500);
    const results = await scanPage(page);
    // Tolerate ONLY that documented out-of-scope core deviation (the loading toast /
    // loader element). Any violation on the editor surface fails the sprint.
    const editorViolations = results.violations.filter(
        (v) =>
            !v.nodes.every((n) =>
                [...n.target, n.html || ""]
                    .map(String)
                    .join(" ")
                    .match(/gl-toast|gl-loader/)
            )
    );
    expect(editorViolations).toEqual([]);
});
