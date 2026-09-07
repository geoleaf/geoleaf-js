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
 *
 * 🛑 **REWRITTEN 06/09/2026: MOUNTING IS NOT SHOWING, and this file asserted the two as one.**
 * The strip used to be rendered unconditionally, so `waitForSelector(".gl-sync-banner")` —
 * whose default state is *visible* — served as the mounting proof. Since `96519fa3e` the strip
 * is still mounted and subscribed at all times but **displayed only when it carries
 * information**: on a consultation profile it repeated "everything is sent" for a whole
 * session, on top of the theme pills, and on a deliverable that is the ONLY reachable state
 * (`build-deploy` strips the write targets). The module says it in its own words — "Mounting is
 * not showing: the strip stays hidden while it has nothing to say".
 *
 * That commit changed `sync-banner.ts` and its unit suite and **did not touch this file**,
 * which no run executes routinely. The three cases below reddened for a day without anyone
 * seeing it: a product change whose browser proof was never replayed — the same class, and on
 * the same day, as the drain race `30-sync-cycle.spec.js` carries the account of. Every wait is now on `state: "attached"`, and the visibility became a
 * SUBJECT instead of a precondition.
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
    // ⚠️ `attached`, NOT the default `visible`. The strip is mounted from boot and hidden
    // while idle; waiting on visibility here would wait for a state the core deliberately
    // does not enter with an empty queue — and would report it as a mounting failure.
    await page.waitForSelector(".gl-sync-banner", { state: "attached", timeout: 15000 });
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
        await expect(banner).toBeAttached();
        // Created at runtime: nothing was added to `apps/geoleaf-app/index.html`, which
        // `build-deploy.cjs` patches with regexes and APP-04/05/08 guard.
        const first = await page.evaluate(
            () => document.querySelector(".gl-main")?.firstElementChild?.className
        );
        expect(first).toContain("gl-sync-banner");

        // 🛑 AND IT IS HIDDEN, which is the other half of the same fact. `deploy-core` ships
        // no write target, so the queue can only ever be empty here: a strip that showed
        // itself would be repeating "everything is sent" over the theme pills for the whole
        // session. Asserting the motive (`data-idle`) and not merely the effect is what tells
        // "it had nothing to say" from "someone closed it" — the two attributes the module
        // spells out separately for exactly this question.
        await expect(banner).toHaveAttribute("data-idle", "true");
        await expect(banner).toBeHidden();
    });

    test("il SAIT l'état du réseau tout le temps, et il le MONTRE quand ça compte", async ({
        page,
    }) => {
        // ⚠️ The title used to read "et il le dit tout le temps". Measured false since
        // `96519fa3e`, and the distinction it lost is the whole point of that lot: the strip
        // KNOWS at every instant — it stays subscribed — and it SPEAKS when the fact is worth
        // a line of chrome. Losing the network is such a fact; being online with an empty
        // queue is not.
        const banner = page.locator(".gl-sync-banner");
        await expect(banner).toHaveAttribute("data-network", "online");
        await expect(banner).toBeHidden();
        // The counter is populated even while hidden: the strip is not rebuilt when it
        // appears, it is revealed. A strip that filled itself on show would flash its
        // previous session's numbers.
        await expect(page.locator(".gl-sync-banner__pending")).not.toBeEmpty();

        await page.evaluate(() => {
            Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
            window.dispatchEvent(new Event("offline"));
        });

        await expect(banner).toHaveAttribute("data-network", "offline");
        // 🛑 Losing coverage is exactly the situation the strip exists for, so here it must
        // SHOW. This is the assertion that would have caught a lot silencing it too broadly.
        await expect(banner).toHaveAttribute("data-idle", "false");
        await expect(banner).toBeVisible();
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
        // One owed write is information: the strip comes out of hiding on its own, with no
        // one asking it to.
        await expect(page.locator(".gl-sync-banner")).toBeVisible();

        await page.evaluate(() => window.dispatchEvent(new Event("online")));

        await expect
            .poll(async () => page.locator(".gl-sync-banner__pending").textContent(), {
                timeout: 12000,
            })
            .not.toContain("1");
        // ⚠️ And it goes quiet again by itself. `textContent()` above reads through
        // `display: none` — which is why the counter assertion still holds — but the
        // disappearance is a separate fact and deserves its own line.
        await expect(page.locator(".gl-sync-banner")).toBeHidden();
    });
});
