// @ts-check
/**
 * 41 — THE SYNC BANNER EXISTS, AND IT BELONGS TO THE CORE (R7, task 1.13)
 *
 * 🛑 RUN ON THE `core` VARIANT, FOR THE SAME REASON AS SPEC 40. A live queue counter existed
 * before this lot — in the editor plugin's floating menu — so it left with the plugin.
 * `deploy-core` does not ship that plugin: what is measured here is therefore the CORE's own
 * chrome, and there is no other way to prove it.
 *
 * ⚠️ The audit said "no permanent indicator of the write queue"; the claim was too broad and
 * is requalified in the module itself. What was true: nothing permanent in the CORE's chrome.
 * That is what this file checks, on the shipped bundle.
 */
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { wipeOnOrigin } from "./helpers/db-seed.js";

const ORIGIN = baseURL("core");
const LAYER = "sites_rosario";

/** @param {import('@playwright/test').Page} page */
async function boot(page) {
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
        () =>
            typeof (/** @type {any} */ (globalThis).GeoLeaf?.Storage?.DB?.listPendingEdits) ===
            "function",
        null,
        { timeout: 25000 }
    );
    await page.waitForSelector(".gl-sync-banner", { timeout: 15000 });
}

/** @param {import('@playwright/test').Page} page */
async function ensureWriteTarget(page) {
    const posed = await page.evaluate((layer) => {
        const gl = /** @type {any} */ (globalThis).GeoLeaf;
        const cfg = gl?.Config?.getActiveProfile?.()?.layers?.find(
            (/** @type {any} */ l) => l.id === layer
        );
        if (!cfg) return false;
        cfg.write = {
            enabled: true,
            endpoint: `https://e2e-banner.invalid/${layer}`,
            dialect: "collection",
            geometryProperty: "geom",
            properties: ["nom"],
        };
        return true;
    }, LAYER);
    expect(posed).toBe(true);
}

test.describe("41 — le bandeau de synchronisation", () => {
    test.beforeEach(async ({ page }) => {
        await wipeOnOrigin(page, ORIGIN);
        await boot(page);
    });

    test("🛑 il est monté en tête de la coquille, sans aucun plugin d'édition", async ({
        page,
    }) => {
        const editor = await page.evaluate(
            () => typeof (/** @type {any} */ (globalThis).GeoLeaf?.Editor)
        );
        expect(editor).toBe("undefined");

        const banner = page.locator(".gl-sync-banner");
        await expect(banner).toBeVisible();
        // Created at runtime: nothing was added to `apps/geoleaf-app/index.html`, which
        // `build-deploy.cjs` patches with regexes and APP-04/05/08 guard.
        const first = await page.evaluate(
            () => document.querySelector(".gl-main")?.firstElementChild?.className
        );
        expect(first).toContain("gl-sync-banner");
    });

    test("il dit l'état du réseau, et il le dit tout le temps", async ({ page }) => {
        await expect(page.locator(".gl-sync-banner")).toHaveAttribute("data-network", "online");
        await expect(page.locator(".gl-sync-banner__pending")).not.toBeEmpty();

        await page.evaluate(() => {
            Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
            window.dispatchEvent(new Event("offline"));
        });

        await expect(page.locator(".gl-sync-banner")).toHaveAttribute("data-network", "offline");
    });

    test("🛑 une écriture fait monter le compteur, un drain le fait redescendre", async ({
        page,
    }) => {
        await ensureWriteTarget(page);
        await page.route("**/e2e-banner.invalid/**", (route) =>
            route.fulfill({ status: 201, contentType: "application/json", body: '[{"id":7}]' })
        );

        // NO plugin tells the banner anything: it listens to the core's two events,
        // `geoleaf:offline:outbox-queued` and `…:outbox-drained`. Before this lot, the only
        // signal that a queue had moved was emitted by the editor plugin.
        await page.evaluate(async (layer) => {
            const gl = /** @type {any} */ (globalThis).GeoLeaf;
            await gl.Storage.applyEdit({
                layerId: layer,
                kind: "create",
                feature: {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [-60.64, -32.94] },
                    properties: { nom: "bandeau" },
                },
            });
        }, LAYER);

        await expect(page.locator(".gl-sync-banner__pending")).toContainText("1", {
            timeout: 8000,
        });

        await page.evaluate(() => window.dispatchEvent(new Event("online")));

        await expect
            .poll(async () => page.locator(".gl-sync-banner__pending").textContent(), {
                timeout: 12000,
            })
            .not.toContain("1");
    });
});
