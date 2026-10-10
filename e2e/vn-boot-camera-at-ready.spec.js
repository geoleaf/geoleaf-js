// @ts-check
/**
 * A CAMERA GESTURE MADE AT `geoleaf:app:ready` HOLDS
 *
 * 🛑 THE DEFECT, MEASURED ON 06/10/2026. The reveal announced the application ready, then
 * re-fitted the profile bounds 120 ms LATER (`packages/core/src/app/init-reveal.ts`). A host
 * setting its view at `geoleaf:app:ready` — the event that says "ready" — saw the view it asked
 * for, then saw it jump back to the profile's framing. Nothing announced it, and a slow style
 * load hid it: it surfaced as a flaky spec whose zoom was read back at the framing's value.
 *
 * The framing now precedes the announcement. Seen red on the bundle built before that order:
 * the zoom set at the announcement was read back at the profile's framing.
 *
 * The unit half — the order of the reveal's steps — is
 * `packages/core/__tests__/app/init-reveal.test.js`.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("core") });

// The basemap is not this spec's subject: its third-party latency must not decide it — and a
// fast style is exactly the condition under which the defect showed.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/** A zoom no profile of the demo frames at: reading it back means the gesture held. */
const HOST_ZOOM = 9.5;

test("[boot] un zoom posé à `geoleaf:app:ready` n'est pas défait par le recadrage du boot", async ({
    page,
}) => {
    // Before any script of the page: the listener must be there when the reveal announces.
    await page.addInitScript((zoom) => {
        document.addEventListener(
            "geoleaf:app:ready",
            () => {
                const w = /** @type {any} */ (window);
                w.GeoLeaf.Core.getMap().getNativeMap().setZoom(zoom);
                w.__hostZoomSetAt = performance.now();
            },
            { once: true }
        );
    }, HOST_ZOOM);

    await page.goto("/");

    // Well past the 120 ms the re-fit used to wait: what is read is what stays.
    await page.waitForFunction(
        () => {
            const setAt = /** @type {any} */ (window).__hostZoomSetAt;
            return typeof setAt === "number" && performance.now() - setAt > 600;
        },
        null,
        { timeout: 30_000 }
    );
    const zoom = await page.evaluate(() =>
        /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap().getZoom()
    );
    expect(zoom, "le zoom demandé à l'annonce est celui qui reste").toBeCloseTo(HOST_ZOOM, 3);
});
