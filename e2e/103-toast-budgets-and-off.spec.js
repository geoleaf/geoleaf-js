/**
 * Toasts on the shipped bundle: each budget served on its own, and a switched-off renderer
 * falls back to the console.
 *
 * ## The defects
 *
 * 1. Five `info` then a persistent toast: the persistent one appeared only when the temporaries
 *    faded, about 3 s later, although its own budget was free — the queue stopped at its head.
 * 2. With `modules.toast-renderer.enabled: false`, `GeoLeaf.Notifications.warning()` returned
 *    `null` — the value that means « refused » — and piled the message in a queue nothing would
 *    drain, with no console trace. `GeoLeaf.notify` already fell back to the console.
 *
 * ## What the spec demands
 *
 * On: the persistent toast is on screen at once, its element returned. Off (the profile's bundle
 * rewritten, rewrites counted): `warning()` returns `undefined`, the message reaches the console,
 * and the status shows nothing queued.
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootPage, installSignals } from "./helpers/mount.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

test("cinq temporaires puis un persistant : le persistant s'affiche aussitôt", async ({ page }) => {
    await installSignals(page);
    await bootPage(page);
    await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 15_000 });
    const shown = await page.evaluate(() => {
        const n = /** @type {any} */ (window).GeoLeaf.Notifications;
        for (let i = 0; i < 5; i++) n.info(`temporaire ${i}`);
        const el = n.show("Synchronisation en cours", { type: "info", persistent: true });
        return {
            element: el instanceof HTMLElement,
            onScreen: !!el?.isConnected,
            text: el?.textContent ?? null,
        };
    });
    expect(shown.element, "le persistant n'a pas été rendu au premier passage").toBe(true);
    expect(shown.onScreen).toBe(true);
    expect(shown.text).toContain("Synchronisation en cours");
});

test("renderer éteint : undefined, repli console, rien en file", async ({ page, context }) => {
    let routed = 0;
    await context.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        bundle.modules = bundle.modules ?? {};
        bundle.modules["toast-renderer"] = { enabled: false };
        routed++;
        await route.fulfill({ json: bundle });
    });
    /** @type {string[]} */
    const warnings = [];
    page.on("console", (m) => {
        if (m.type() === "warning") warnings.push(m.text());
    });
    await installSignals(page);
    await bootPage(page);
    await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 15_000 });
    expect(routed, "la retouche du profil n'a pas mordu").toBeGreaterThan(0);

    const result = await page.evaluate(() => {
        const n = /** @type {any} */ (window).GeoLeaf.Notifications;
        const returned = n.warning("Sonde du renderer éteint");
        return { isUndefined: returned === undefined, queued: n.getStatus().queued };
    });
    expect(result.isUndefined, "l'appel ne rend pas undefined").toBe(true);
    expect(result.queued).toBe(0);
    await expect
        .poll(() => warnings.some((w) => w.includes("Sonde du renderer éteint")))
        .toBe(true);
});
