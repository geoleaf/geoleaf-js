// @ts-check
// E2E: 09-editor (@geoleaf-plugins/editor) — deploy-full (port 8768), the only
// variant bundling the editor (Core + Connector + Storage + Cog + Editor; Editor
// supersedes AddPOI).
//
// Sprint S3 (plugin-validation) rewrite. The previous spec assumed the editor was
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
//   7.2 disarmament (06/08/2026) `sites_rosario` is the ONLY editable Point layer of the
//   profile — it is the only one declaring a `write` target, and A15/A16 forbid a layer
//   from advertising an editability it cannot honour. `hebergements` lost its `edition`
//   block, so `layer-dropdown.ts:59` now takes the `layers.length === 1` branch and
//   PRE-SELECTS sites_rosario instead of showing the disabled placeholder of the
//   `length > 1` branch (:40). 🛑 **That pre-selection makes the schema render IMMEDIATELY**,
//   and it is what broke this spec on the first run — not the selectOption() calls, which
//   still resolve. With the form already rendered, `.gl-form-modal-panel select` matched
//   TWO elements (the layer dropdown + the `statut` dropdown of sites_rosario's schema) and
//   Playwright refused it in strict mode. The locator is now scoped to
//   `.gl-form-modal__layer`; the calls below are effectively no-ops that still assert the
//   option exists. ⚠️ The multi-layer placeholder path is consequently NO LONGER covered in
//   a real browser — it survives only in
//   `packages/plugins/editor/src/__tests__/modal.test.ts:216`. Restoring browser coverage
//   means a second layer with a real write target, not re-arming a demo.
//   Saving routes through the REST persistence adapter →
//   POST `…/features`; against the static test host (no backend) that returns 405,
//   surfaced as an error toast — the feature is NOT persisted/queued for this demo
//   profile (a 405 client error is not a transport error, so the AutoAdapter does not
//   fall back to the queue; see CDC §Validation S3). This spec validates the create
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
    // (entry.ts:324), i.e. lazy import() → createTerraDrawAdapter → (await map idle) →
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
 * 🛑 TÂCHE 5.1-b — LE TROU QUE CETTE TÂCHE FERME, PROUVÉ EN NAVIGATEUR.
 *
 * Les variantes livrées étaient EXCLUSIVES (`build-deploy.cjs`) : `deploy-addpoi` portait
 * addpoi sans editor, `deploy-full` editor sans addpoi. Or le seul `registerHandler("poi")`
 * de production du dépôt vivait dans `addpoi/src/entry.ts` — donc sur CETTE variante,
 * `GeoLeaf.Sync.getHandler("poi")` rendait `undefined` et le bouton de rejeu d'`offline-ui`
 * (qui lit ce handler via `sync-seam.ts`) était mort, en silence.
 *
 * ⚠️ La première assertion n'est pas décorative : elle établit que le trou EXISTE avant que
 * l'éditeur ne soit chargé. Sans elle, la seconde passerait aussi bien sur une variante qui
 * aurait toujours eu un handler, et ne prouverait donc rien de ce que 5.1-b fait.
 */
test("[editor] 5.1-b — le handler de synchronisation `poi` est absent au boot, et POSÉ au chargement", async ({
    page,
}) => {
    const before = await page.evaluate(() => ({
        addpoi: typeof (/** @type {any} */ (window).GeoLeaf?.AddPOI),
        handler: typeof (/** @type {any} */ (window).GeoLeaf?.Sync?.getHandler?.("poi")),
    }));
    // La variante ne porte pas addpoi — c'est ce qui rend le trou possible.
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
    // Les DEUX méthodes qu'`offline-ui` consomme, nommées — un handler qui n'en porte
    // qu'une laisserait la moitié du bouton morte.
    expect(after.summary).toBe("function");
    expect(after.replay).toBe("function");

    // Et il répond vraiment : un décompte sur une outbox vide vaut zéro, pas une erreur.
    const summary = await page.evaluate(async () => {
        const h = /** @type {any} */ (window).GeoLeaf.Sync.getHandler("poi");
        return await h.getSyncSummary();
    });
    expect(summary).toMatchObject({ total: 0, add: 0, update: 0, delete: 0 });
});

/**
 * 🛑 **CES TROIS TESTS TOURNENT EN VIEWPORT MOBILE, ET CE N'EST PAS UN CONFORT.**
 * `poi-add` est un créneau de la **pilule mobile** (`kernel/ui/mobile/`). À la largeur par
 * défaut de la suite (1280×720) le bouton est bien **dans le DOM** — le premier test le
 * montrait — mais il n'est pas **interactable** : le clic expirait. Mesuré à la première
 * exécution. Tester la pilule en desktop, c'est tester une surface qui n'y est pas rendue.
 */
test.describe("[editor] 5.1-f — la capture de POI (pilule MOBILE)", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    /**
     * 5.1-f — LE BOUTON « AJOUTER UN POI », ET C'EST LE SEUL FILET QU'IL AIT.
     *
     * 🛑 Ce test remplace `10-addpoi.spec.js`, qui portait l'unique couverture E2E du bouton
     * `poi-add` et tournait sur `deploy-addpoi` — la variante que 5.5 supprime. Le parcours,
     * lui, n'est PAS mort : il a changé de propriétaire. Le supprimer sans le porter aurait
     * retiré la seule preuve qu'un bouton arrive à l'écran.
     *
     * ⚠️ **Et c'est exactement le mécanisme de casse que 5.1-f devait éviter.** Le core le
     * dessinait en sondant `GeoLeaf.AddPOI.AddForm` AU BOOT, ce qui ne tenait que parce
     * qu'`addpoi` était chargé en balise `<script>` eager. `editor` est PARESSEUX : la même
     * sonde rendrait `false` pour toujours. La première assertion établit donc que le bouton
     * est là AVANT tout chargement — sans elle, la suite passerait sur un bouton qui n'apparaît
     * qu'après coup, et ne prouverait rien.
     *
     * ⚠️ Aucune gate ne voit ça : `ci:local` et l'E2E étaient verts dans les deux états quand
     * le bouton d'export de 5.1-e était enregistré et invisible.
     */
    test("[editor] 5.1-f — le bouton `poi-add` est là AU BOOT, plugin non chargé", async ({
        page,
    }) => {
        const before = await page.evaluate(() => ({
            editor: typeof (/** @type {any} */ (window).GeoLeaf?.Editor),
            addpoi: typeof (/** @type {any} */ (window).GeoLeaf?.AddPOI),
        }));
        // Le plugin n'est pas chargé, et l'ancien namespace n'existe plus (V2 — sans alias).
        expect(before.editor).toBe("undefined");
        expect(before.addpoi).toBe("undefined");

        const btn = page.locator('[data-gl-toolbar-action="poi-add"]').first();
        await expect(btn).toBeAttached({ timeout: 10000 });

        // Le nom accessible doit être un LIBELLÉ, jamais la clé brute : `getLabel` rend la clé
        // quand il ne connaît pas, et le dictionnaire du plugin n'est pas chargé à cet instant.
        // C'est ce qui oblige `init.js` à enregistrer le libellé lui-même.
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
        // V2 — aucun alias ne survit au retrait.
        expect(api.legacy).toBe("undefined");
    });

    test("[editor] 5.1-f — cliquer `poi-add` charge le plugin et ouvre le formulaire", async ({
        page,
    }) => {
        // 🛑 PAS DE `force: true`, ET C'EST MESURÉ. La barre d'outils est bâtie avant que son
        // écouteur de clic soit posé : un clic forcé tombe dans cet intervalle et n'est
        // JAMAIS dispatché — silencieusement, sans erreur en console. Vérifié en sonde, trois
        // fois : clic forcé → `GeoLeaf.Editor` reste `undefined` ; clic actionnable → chargé.
        // `force` court-circuite précisément l'attente qui rend ce test déterministe, et un
        // `waitForTimeout` ne ferait que masquer la course derrière un chiffre.
        const btn = page.locator('.gl-map-toolbar [data-gl-toolbar-action="poi-add"]').first();
        await expect(btn).toBeVisible({ timeout: 15000 });
        await btn.click({ timeout: 15000 });

        // Le clic passe par `ensureLoadedForAction` : le bundle se télécharge AVANT le dispatch.
        await page.waitForFunction(
            () => typeof (/** @type {any} */ (window).GeoLeaf?.Editor) === "object",
            null,
            { timeout: 15000 }
        );

        // Le flux arme le mode placement ; on court-circuite le tap en appelant le formulaire
        // directement, ce que fait le rappel de placement.
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
    // `waitForFunction(fn, arg, options)` — le timeout doit être en 3e position ;
    // en 2e il est reçu comme `arg` et silencieusement ignoré (défaut appliqué).
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
    // ⚠️ Défaut PRODUIT ouvert (à traiter dans PLUGINS S1→S12, pas ici) :
    // `persistence/storage-queue-adapter.ts:89` appelle
    // `GeoLeaf.Storage.DB.addToSyncQueue({ type, layerId, payload, profileId })` —
    // un seul argument — alors que la seule implémentation runtime,
    // `core/src/capabilities/offline/db/indexeddb.ts:303`, a la signature
    // `addToSyncQueue(operation, profileId)` et lit `operation.data` (pas `payload`).
    // L'entrée écrite part donc avec `profileId: undefined` / `poiData: undefined`.
    // Les tests unitaires de l'éditeur mockent `addToSyncQueue`, donc ils ne voient pas
    // l'écart de forme. NE PAS relâcher l'assertion : c'est elle qui l'expose.
    await context.setOffline(true);
    await page.locator(".gl-form-modal__btn-save").click();
    // ⚠️ B-99 — 8 000 ms était un budget SANS AUCUNE MARGE, et c'est mesuré : ce test entier
    // dure **8 678 ms** sur une machine à 24 cœurs, soit plus que le budget de sa propre
    // attente. Sur le runner GitHub (2-4 cœurs, suite E2E mesurée à 1,0 h contre 12,5 min
    // ici, soit ~5×), il ne pouvait pas tenir — il a échoué TROIS fois de suite, `retries: 2`
    // n'existant qu'en CI.
    //
    // L'attente porte déjà sur le bon signal (`__edQueued`, posé par un écouteur armé plus
    // haut) : il n'y a rien à mieux synchroniser, seulement un budget calibré sur une machine
    // rapide. Et un budget généreux ne coûte RIEN dans le cas passant — une attente qui
    // réussit tôt rend la main tôt ; le délai n'est payé que lorsque la chose échoue vraiment.
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
