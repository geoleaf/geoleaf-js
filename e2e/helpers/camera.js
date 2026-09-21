// @ts-check
// The camera must be POSED before a gesture is played on it.
//
// 🛑 A BASEMAP APPLIED MID-GESTURE COSTS THE GESTURE, AND IT IS MEASURED. On the public
// nightly run 35580569108 (21/09/2026, `tourism`), the boot's `setBaseLayer` found the style
// unloaded and deferred. Its wake-up came ~20 s later — during the drag of
// `e2e/43-editor-polygon-edit.spec.js` — and applying the basemap then ran
// `terrain.default3D` → `map.easeTo({ pitch: 60 })`. The camera tilted under the pointer, the
// screen→map projection taken just before went stale, Terra Draw lost the drag, and the write
// persisted the UNMOVED geometry. The spec failed 3 times out of 3 on
// `expect(ring[0]).not.toEqual(shippedRing[0])`, with nothing wrong in what it tests.
//
// The deferral itself was the defect and is fixed in the core (`basemaps/registry.ts`, which
// now waits on `styledata` rather than on the far stronger `idle`). THIS HELPER IS NOT THAT
// FIX AND DOES NOT REPLACE IT: `easeTo` is an ANIMATION, and any drag overlapping one is
// false no matter when it starts. The four specs that drag (38, 43, 44, 45) state the
// precondition here rather than each discovering it again.
//
// ⚠️ Call it AFTER `goOffline` and BEFORE projecting the point to click. Cutting the network
// is itself what makes the DEM tiles fail, and the terrain applies its pitch regardless of
// them — so the camera can still move after the cut.

/**
 * Waits until the camera is posed: a basemap is ACTIVE, the style is loaded, and no animation
 * is in flight.
 *
 * Checking all three in ONE evaluation is deliberate — a basemap that becomes active between
 * two round trips restarts an animation the previous check had just declared over.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number }} [opts]
 * @returns {Promise<void>} resolves once the camera is settled.
 * @example
 * await goOffline(context, page);
 * await awaitSettledCamera(page);
 * const inside = await projectInteriorPoint(page, target);
 */
async function awaitSettledCamera(page, opts = {}) {
    const timeout = opts.timeout ?? 20000;
    /** Reads the three conditions in ONE evaluation — see above. */
    const readState = () =>
        page.evaluate(() => {
            const g = /** @type {any} */ (window).GeoLeaf;
            const map = g?.Core?.getMap?.()?.getNativeMap?.();
            return {
                activeKey: g?.Baselayers?.getActiveKey?.() ?? null,
                hasMap: !!map,
                styleLoaded: typeof map?.isStyleLoaded === "function" ? map.isStyleLoaded() : "n/a",
                moving: typeof map?.isMoving === "function" ? map.isMoving() : "n/a",
                wants3D: !!g?.Baselayers?.getActiveLayer?.()?.terrain?.default3D,
                terrain: !!map?.getTerrain?.(),
                pitch: typeof map?.getPitch === "function" ? Math.round(map.getPitch()) : "n/a",
            };
        });

    try {
        await page.waitForFunction(
            () => {
                const g = /** @type {any} */ (window).GeoLeaf;
                // An active key witnesses that the deferred activation has RUN.
                if (!g?.Baselayers?.getActiveKey?.()) return false;
                const map = g?.Core?.getMap?.()?.getNativeMap?.();
                if (!map) return false;
                if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded()) return false;
                // 🛑 AND THE TERRAIN MUST BE POSTED, NOT MERELY DUE. `terrain.default3D` posts
                // `setTerrain()` and then `easeTo({ pitch })`, both AFTER the active key is set,
                // so waiting on the key alone returns while the camera work is still owed.
                //
                // ⚠️ THIS DELIBERATELY DOES NOT WAIT FOR THE ANGLE ITSELF, and the reason is a
                // product defect, not a preference: measured on a plain boot with no test acting
                // on the page, a basemap asking for `pitch: 60` settled at 60 ONCE in six runs
                // and at 6–9° the other five — the tilt animation is cut after some 50–80 ms by
                // whatever posts the camera next. Waiting for 60 would hang this helper five
                // times out of six. Waiting for the terrain is what can be honoured today.
                const def = g.Baselayers?.getActiveLayer?.();
                if (def?.terrain?.default3D && !map.getTerrain?.()) return false;
                return typeof map.isMoving !== "function" || !map.isMoving();
            },
            null,
            { timeout }
        );
    } catch (err) {
        // 🛑 A BARE TIMEOUT HERE NAMES THE HELPER, NOT THE CAUSE — and the three conditions fail
        // for three unrelated reasons. Saying which one held is the difference between a
        // diagnosis and another round trip.
        const state = await readState().catch(() => null);
        throw new Error(
            `la caméra ne s'est pas posée en ${timeout} ms — ${JSON.stringify(state)}\n` +
                `  activeKey null = le fond n'est jamais appliqué · styleLoaded false = le style ` +
                `n'a jamais fini · moving true = une animation ne s'arrête pas.`,
            { cause: err }
        );
    }
}

export { awaitSettledCamera };
