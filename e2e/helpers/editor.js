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

export { armEditor };
