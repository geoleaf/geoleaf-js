// @ts-check
// E2E: 14-print (@geoleaf-plugins/print) — deploy-core (port 8766), LAZY.
//
// Plugin-validation suite. print is registered LAZY in init.js
// (`registerLazy('print')` + `registerLazyForAction('print','print')`):
// `GeoLeaf.Print`, the toolbar action and the lazy bundle only exist once the
// plugin is loaded (toolbar action, or `GeoLeaf.plugins.load('print')`).
//
// DOM contract:
//   - emprise overlay   .gl-emprise-overlay  (emprise-selector.ts — DOM events on
//                        an overlay div + document, NOT MapLibre map events, so a
//                        real Playwright drag CAN draw the rectangle)
//   - drawn rect / OK   .gl-emprise-rect / .gl-emprise-ok
//   - preview modal      #gl-print-modal  (+ body.gl-print-modal-open)
//   - title input        #gl-print-title
//   - checkboxes         #gl-print-chk-scale | #gl-print-chk-north | #gl-print-chk-legend
//   - format select      .gl-print-format-select   (A4 / A3)
//   - scale locked       .gl-print-scale-locked    (🔒 1:n)
//   - export buttons     .gl-print-btn--pdf | .gl-print-btn--jpg
//
// jsPDF lazy chunk (lazy-chunk refactor): pdf-exporter.ts loads jsPDF via a dynamic
// `import("jspdf")`, so it lands in a separate chunk `geoleaf-print.jspdf-<hash>.js`
// (+ its optional html2canvas/dompurify deps as their own chunks) that the browser
// only fetches on the FIRST PDF export — never at plugin load. This is asserted via
// performance resource timing. The jsPDF import precedes any canvas.toDataURL(), so
// it loads even when the offscreen basemap canvas is CORS-tainted (the SecurityError
// is then caught → console.warn, never an uncaught pageerror).
//
// Blob + MIME are asserted deterministically via GeoLeaf.Print._getExporter(fmt) on
// a synthetic (never-tainted) canvas — this proves the exporter wiring + the jsPDF
// dynamic import produce a valid Blob, independent of the offscreen map render.
//
// NOTE: deploy-core ships a PWA service worker → serviceWorkers:'block' for
// deterministic chunk loading. Run after `npm run build:deploy:all`.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanComponent } from "./helpers/axe-config.js";

const PRINT_CHUNK = /geoleaf-print\.plugin\.js/;
const JSPDF_CHUNK = /geoleaf-print\.jspdf-/;
const HTML2CANVAS_CHUNK = /geoleaf-print\.html2canvas/;

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

/** Navigates, waits for the map, and returns the collected page errors. */
async function boot(page) {
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    // The tourism profile loads 100+ layer styles/tiles → the default 250-entry
    // resource-timing buffer overflows and drops the late jsPDF chunk request.
    // Enlarge it so resourceLoaded() reliably sees on-demand chunks.
    await page.addInitScript(() => performance.setResourceTimingBufferSize(20000));
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
    // Wait until the native MapLibre map is loaded (emprise unproject relies on it).
    await page.waitForFunction(
        () => {
            const m = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            return !!m && typeof m.loaded === "function" && m.loaded();
        },
        null,
        { timeout: 15000 }
    );
    // The boot loader overlay intercepts pointer events until it clears.
    await page
        .locator("#gl-loader")
        .waitFor({ state: "hidden", timeout: 10000 })
        .catch(() => {});
    return errors;
}

/** Loads the lazy print plugin (what the toolbar action does) and waits for its API. */
async function armPrint(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("print"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Print) === "object",
        null,
        { timeout: 10000 }
    );
}

/** Returns whether a resource matching `re` has been requested by the page. */
function resourceLoaded(page, re) {
    return page.evaluate(
        (src) => performance.getEntriesByType("resource").some((e) => new RegExp(src).test(e.name)),
        re.source
    );
}

/**
 * Runs `fn`, then waits for the print re-render it triggers to finish.
 *
 * ⚠️ WHY THIS IS NOT A FLAKE, AND WHY A LONGER TIMEOUT DOES NOT SUFFICE.
 *
 * Changing the format debounces 150 ms, then launches an off-screen map
 * capture + a composition. On a 2-4 core runner that work SATURATES THE MAIN
 * THREAD for several seconds, and the next interaction expires on
 * `actionTimeout` WITHOUT THE ELEMENT HAVING MOVED.
 *
 * Measured on 2026-08-01, and both measurements count:
 *   • the checkbox does NOT move after the format change (0 movement over
 *     6 s, sampled every 80 ms) — the "layout shift" hypothesis is FALSE;
 *   • under ×8 CPU throttling, `uncheck()` fails at **10,005 ms**, exactly
 *     the CI signature; with this wait, the recomposition settles in ~7.5 s
 *     then the interaction passes.
 *
 * ⚠️ At WHICH STAGE it blocks exactly: this entry first claimed the
 * actionability check could not confirm "stable", `requestAnimationFrame`
 * being starved. **That explanation was never verified on a call log, and
 * the evidence contradicts it**: the 5 clicks that fell in CI on 08-01 (run
 * 30703087739) all print
 *
 *     - element is visible, enabled and stable      ← the stability check PASSES
 *     - performing click action                     ← the block is HERE
 *
 * — so the latency is in the renderer's DISPATCH ack, not in actionability.
 * No call log of the `uncheck` above survived, so its own stage stays **not
 * established**; it is not assumed identical. What is measured holds (the
 * two bullets), the internal mechanics do not.
 *
 * ⚠️ And "A LONGER TIMEOUT DOES NOT SUFFICE" stays true for a reason
 * independent of the stage: waiting for the real signal
 * (`geoleaf:print:render:end`) is correct by construction, where a wider
 * budget only bets on a duration. `actionTimeout` was moreover raised to
 * 30 s the same day — complementary, not redundant.
 *
 * The listener is armed BEFORE the action: arming it after would run after
 * the event, and on a fast machine it would already have passed.
 *
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<unknown>} fn Action triggering the recomposition.
 */
async function withRenderSettled(page, fn) {
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__glRenderEnded = false;
        document.addEventListener(
            "geoleaf:print:render:end",
            () => {
                w.__glRenderEnded = true;
            },
            { once: true }
        );
    });
    await fn();
    // ⚠️ 240 s, and this budget MUST stay STRICTLY ABOVE the print plugin's
    // `IDLE_TIMEOUT_MS` (180 s today) — the two are IN SERIES, not an
    // independent setting. `geoleaf:print:render:end` is emitted from a
    // `finally`: it thus only fires AFTER the plugin has exhausted its own
    // budget. Setting them equal (both at 90 s, 2026-08-01) makes the event
    // unobservable and has the suite return an opaque "wait timeout" INSTEAD
    // of the console error which does say what really happened.
    //
    // ⚠️ The real durations, measured under `taskset -c 0,1`, and the FIRST
    // switch dominates:
    //     A4→A3 (1st) 109,280 ms · A3→A4 28,062 ms · A4→A3 (2nd) 34,819 ms
    // A budget set on a warm sample (~36 s) was already laid here, then
    // disproven by the cold measurement. Calibrate on the COLD switch, never
    // on an average.
    await page.waitForFunction(() => /** @type {any} */ (window).__glRenderEnded === true, null, {
        timeout: 240000,
    });
}

/** Returns the bounding box of the map canvas. */
async function canvasBox(page) {
    const cv = page.locator("#geoleaf-map canvas.maplibregl-canvas").first();
    await expect(cv).toBeVisible({ timeout: 10000 });
    const box = await cv.boundingBox();
    if (!box) throw new Error("canvas has no bounding box");
    return box;
}

/** Absolute viewport point at fractional (fx,fy) inside the canvas. */
function at(box, fx, fy) {
    return { x: Math.round(box.x + fx * box.width), y: Math.round(box.y + fy * box.height) };
}

/**
 * Opens the emprise selector deterministically: load the plugin (entry.ts registers
 * the `geoleaf:toolbar:action` listener — the same event the real pill button fires),
 * then dispatch the print action exactly once → a single emprise overlay. Dispatching
 * AND clicking the button would call openPrintFlow twice (two overlays).
 */
async function openEmprise(page) {
    await armPrint(page);
    await page.evaluate(() =>
        document.dispatchEvent(
            new CustomEvent("geoleaf:toolbar:action", { detail: { action: "print" } })
        )
    );
    await expect(page.locator(".gl-emprise-overlay")).toBeVisible({ timeout: 8000 });
}

/** Draws the emprise rectangle with a real drag and validates → opens the modal. */
async function drawEmpriseAndOpenModal(page) {
    const box = await canvasBox(page);
    const start = at(box, 0.3, 0.32);
    const mid = at(box, 0.5, 0.5);
    const end = at(box, 0.7, 0.68);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.move(end.x, end.y);
    await page.mouse.up();
    const ok = page.locator(".gl-emprise-ok");
    await expect(ok).toBeVisible({ timeout: 5000 });
    await ok.click();
    await expect(page.locator("#gl-print-modal")).toBeVisible({ timeout: 8000 });
}

// ---------------------------------------------------------------------------

test.describe("[print] lazy boundary & API", () => {
    test("the namespace and the lazy bundle are both absent at boot", async ({ page }) => {
        await boot(page);
        const ns = await page.evaluate(() => typeof (/** @type {any} */ (window).GeoLeaf?.Print));
        expect(ns).toBe("undefined");
        expect(await resourceLoaded(page, PRINT_CHUNK)).toBe(false);
    });

    test("the print toolbar button is rendered at boot (lazy action)", async ({ page }) => {
        await boot(page);
        // registerLazyForAction shows the pill immediately; profileKey ui.showPrint
        // is absent in tourism → defaultVisible (true).
        await expect(page.locator('[data-gl-toolbar-action="print"]').first()).toBeVisible({
            timeout: 10000,
        });
    });

    test("loading the plugin fetches the bundle and mounts the documented API", async ({
        page,
    }) => {
        await boot(page);
        await armPrint(page);
        expect(await resourceLoaded(page, PRINT_CHUNK)).toBe(true);
        const api = await page.evaluate(() => {
            const P = /** @type {any} */ (window).GeoLeaf.Print;
            return [
                "openPrintFlow",
                "captureExtent",
                "captureViewport",
                "exportImage",
                "exportPDF",
                "registerExporter",
                "registerPageFormat",
            ].map((k) => typeof P[k]);
        });
        expect(api.every((t) => t === "function")).toBe(true);
    });
});

// ---------------------------------------------------------------------------

test.describe("[print] emprise → modal (real pointer)", () => {
    test("toolbar action opens the emprise selector; a real drag opens the modal", async ({
        page,
    }) => {
        const errors = await boot(page);
        await openEmprise(page);
        await drawEmpriseAndOpenModal(page);

        await expect(page.locator("body")).toHaveClass(/gl-print-modal-open/);
        // Scale is locked (🔒) and the A4/A3 format selector is present.
        await expect(page.locator(".gl-print-scale-locked")).toBeVisible();
        const formats = await page.locator(".gl-print-format-select option").allTextContents();
        expect(formats).toContain("A4");
        expect(formats).toContain("A3");
        // Composition checkboxes (scale + north arrow always present).
        await expect(page.locator("#gl-print-chk-scale")).toBeAttached();
        await expect(page.locator("#gl-print-chk-north")).toBeAttached();

        expect(errors.filter((e) => !/favicon|chrome-extension/.test(e))).toHaveLength(0);
    });

    test("format A4→A3 switch and checkbox toggles drive the modal without errors", async ({
        page,
    }) => {
        // ⚠️ Budget SPECIFIC to this test, like the PDF journey's below. This
        // test does ONE A4→A3 switch, i.e. the COLD one: 109,280 ms on its own
        // under `taskset -c 0,1` (measurement at `withRenderSettled`'s
        // docblock), plus boot, extent and modal. The global 60 s of
        // `playwright.config.js` cannot contain that, and the other 38 specs
        // need not pay this ceiling.
        test.setTimeout(300000);

        const errors = await boot(page);
        await openEmprise(page);
        await drawEmpriseAndOpenModal(page);

        // ⚠️ The recomposition the format change triggers must be AWAITED: it
        // saturates the main thread, and the next interaction would expire
        // without the element having moved. See `withRenderSettled` for the
        // measurement.
        await withRenderSettled(page, () =>
            page.locator(".gl-print-format-select").selectOption("A3")
        );
        await expect(page.locator(".gl-print-format-select")).toHaveValue("A3");
        // Toggle the north-arrow checkbox (recompose, no throw).
        const north = page.locator("#gl-print-chk-north");
        await north.uncheck();
        await expect(north).not.toBeChecked();
        await page.locator("#gl-print-title").fill("Zone d’étude — secteur Nord");

        expect(errors.filter((e) => !/favicon|chrome-extension/.test(e))).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------

test.describe("[print] jsPDF lazy chunk & export", () => {
    test("jsPDF is NOT loaded at plugin load and IS loaded on the first PDF export", async ({
        page,
    }) => {
        const errors = await boot(page);
        await armPrint(page);
        // Plugin loaded, but jsPDF must still be absent (dynamic import not yet run).
        expect(await resourceLoaded(page, JSPDF_CHUNK)).toBe(false);

        // First PDF export → pdfExporterFn runs `await import("jspdf")`.
        const ok = await page.evaluate(async () => {
            const c = document.createElement("canvas");
            c.width = 32;
            c.height = 32;
            const exporter = /** @type {any} */ (window).GeoLeaf.Print._getExporter("pdf");
            const blob = await exporter(c, {
                format: "pdf",
                orientation: "portrait",
                widthMm: 210,
                heightMm: 297,
                quality: 0.9,
            });
            return blob instanceof Blob;
        });
        expect(ok).toBe(true);
        expect(await resourceLoaded(page, JSPDF_CHUNK)).toBe(true);
        // The optional html2canvas/dompurify deps are only used by jsPDF.html() —
        // never pulled by addImage(), so they stay out of the export path.
        expect(await resourceLoaded(page, HTML2CANVAS_CHUNK)).toBe(false);

        expect(errors.filter((e) => !/favicon|chrome-extension/.test(e))).toHaveLength(0);
    });

    test("the pdf and jpg exporters produce valid typed Blobs (synthetic canvas)", async ({
        page,
    }) => {
        await boot(page);
        await armPrint(page);
        const out = await page.evaluate(async () => {
            const mk = () => {
                const c = document.createElement("canvas");
                c.width = 48;
                c.height = 32;
                const ctx = c.getContext("2d");
                if (ctx) {
                    ctx.fillStyle = "#3388ff";
                    ctx.fillRect(0, 0, 48, 32);
                }
                return c;
            };
            const P = /** @type {any} */ (window).GeoLeaf.Print;
            const pdf = await P._getExporter("pdf")(mk(), {
                format: "pdf",
                orientation: "portrait",
                widthMm: 210,
                heightMm: 297,
                quality: 0.9,
            });
            const jpg = await P._getExporter("jpg")(mk(), {
                format: "jpg",
                orientation: "portrait",
                widthMm: 210,
                heightMm: 297,
                quality: 0.9,
            });
            return {
                pdfType: pdf.type,
                pdfSize: pdf.size,
                jpgType: jpg.type,
                jpgSize: jpg.size,
            };
        });
        expect(out.pdfType).toBe("application/pdf");
        expect(out.pdfSize).toBeGreaterThan(0);
        expect(out.jpgType).toBe("image/jpeg");
        expect(out.jpgSize).toBeGreaterThan(0);
    });

    test("the real PDF button (full parcours) produces a .pdf download + loads jsPDF", async ({
        page,
    }) => {
        // ⚠️ This one failed on NO action: it overran the test's TOTAL budget
        // (60 s, `playwright.config.js`). It chains an off-screen render in
        // software WebGL, an A4@300dpi composition and a dynamic jsPDF
        // import — its own comment already says "heavy in software
        // rendering". On the runner (~5× slower than this host) 60 s do not
        // suffice. Budget carried by the test, not globally: the other 38
        // have no reason to pay for this one.
        test.setTimeout(180000);
        const errors = await boot(page);
        await openEmprise(page);
        await drawEmpriseAndOpenModal(page);

        // Wait for the off-screen render to populate the preview (export needs the
        // cached map canvas). A data: preview src also proves the canvas is NOT
        // CORS-tainted → the export's toDataURL will succeed too. Bounded long —
        // headless software-WebGL renders the off-screen map slowly.
        await expect
            .poll(
                () =>
                    page.evaluate(() => {
                        const img = /** @type {HTMLImageElement|null} */ (
                            document.querySelector(".gl-print-preview-img")
                        );
                        return !!img && typeof img.src === "string" && img.src.startsWith("data:");
                    }),
                { timeout: 45000 }
            )
            .toBe(true);

        expect(await resourceLoaded(page, JSPDF_CHUNK)).toBe(false);

        // Click PDF → compose the A4@300dpi plate (heavy in software rendering),
        // then pdfExporterFn → import('jspdf') → downloadBlob fires a real download.
        const [download] = await Promise.all([
            page.waitForEvent("download", { timeout: 90000 }),
            page.locator(".gl-print-btn--pdf").click(),
        ]);
        expect(download.suggestedFilename()).toMatch(/\.pdf$/);
        expect(await resourceLoaded(page, JSPDF_CHUNK)).toBe(true);

        // The tainted-canvas branch surfaces as a caught console.warn, never an
        // uncaught error — the page must stay clean throughout.
        expect(errors.filter((e) => !/favicon|chrome-extension/.test(e))).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------

test.describe("[print] a11y", () => {
    test("the open print modal passes a WCAG 2.1 AA axe scan", async ({ page }) => {
        const errors = await boot(page);
        await openEmprise(page);
        await drawEmpriseAndOpenModal(page);
        const results = await scanComponent(page, ".gl-print-modal");
        // The former SYSTEMIC theme-token contrast issue is fixed: components sitting
        // on an --gl-color-accent background (here .gl-print-btn--pdf) now use
        // --gl-color-accent-contrast (dark on the light-theme peach accent) instead of
        // --gl-color-text-inverse (near-white). The scan is strict again — any
        // color-contrast regression on the print surface must fail.
        expect(results.violations).toEqual([]);
        expect(errors.filter((e) => !/favicon|chrome-extension/.test(e))).toHaveLength(0);
    });
});
