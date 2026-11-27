// @ts-check
// Arming the editor — the gesture three specs need, written once.
//
// 🛑 IT WAS COPIED TWICE BEFORE BEING EXTRACTED, and the second copy already carried a
// comment pointing at the first ("see spec 38"). A third would have made it the shape this
// repository has paid for elsewhere: several inline copies of one gesture, drifting apart
// until a fix lands in one of them.

/**
 * Loads the lazy editor plugin and arms the select tool THROUGH THE MENU.
 *
 * 🛑 THROUGH THE MENU, not `Editor.setActiveTool`. That API sets the pill's active tool and
 * nothing else: the Terra Draw adapter is loaded by the menu's `onToolSelect`, so calling the
 * API directly leaves it unloaded and every later gesture lands on nothing.
 *
 * ⚠️ `td-point` in the style is the proof that `start()` has run — the adapter arms
 * asynchronously, and a spec that clicks before it does selects nothing, silently.
 *
 * @param {import("@playwright/test").Page} page
 */
async function armEditor(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("editor"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Editor) === "object",
        null,
        { timeout: 15000 }
    );
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Editor.toggleMenu());
    await page.locator('button.gl-editor-tool-btn[data-tool="select"]').click();
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
        { timeout: 20000 }
    );
}

/**
 * Makes the profile's editable layers accept points, lines AND polygons, for a spec whose
 * subject is the drawing engine rather than the profile.
 *
 * 🛑 A creation tool that no editable layer accepts is offered DISABLED (editor 1.6.5): drawn
 * anyway, it opened a form with no layer to file the shape in. The demo profile's only
 * editable layer takes points, so the line and polygon tools are greyed there — rightly — and
 * a spec tracing a line must first give the line somewhere to go.
 *
 * ⚠️ On `profile-bundle.json`, not on the layer's own config: the deploy inlines every layer
 * config into the bundle (see spec 38). Laid on the CONTEXT, before the page loads.
 *
 * @param {import("@playwright/test").BrowserContext} context
 * @returns {Promise<{ widened: number }>} Live count of layers widened — the witness the
 *   route bit; a spec reads it after the page has loaded.
 */
async function acceptEveryGeometry(context) {
    const witness = { widened: 0 };
    await context.route("**/profile-bundle.json**", async (route) => {
        let bundle;
        try {
            bundle = await (await route.fetch()).json();
        } catch {
            // The test ended while the bundle was in flight (a spec that never waits for the
            // profile): the context is closing, and there is no page left to serve.
            return;
        }
        for (const cfg of Object.values(bundle.layerConfigs ?? {})) {
            const c = /** @type {any} */ (cfg);
            if (c?.edition?.create === true || c?.edition?.update === true) {
                c.editableGeometryTypes = ["Point", "LineString", "Polygon"];
                witness.widened += 1;
            }
        }
        if (witness.widened === 0) throw new Error("le bundle ne porte aucune couche éditable");
        await route.fulfill({ json: bundle });
    });
    return witness;
}

export { armEditor, acceptEveryGeometry };
