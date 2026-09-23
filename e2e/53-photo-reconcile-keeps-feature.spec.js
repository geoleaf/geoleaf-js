// @ts-check
/**
 * 53 — A PHOTO SENT AFTER THE FACT DOES NOT ERASE THE ENTITY THAT OWNS IT
 *
 * 🛑 THE DEFECT THIS SPEC EXISTS FOR. A photo taken off-network waits in `local_images` with its
 * return address. When the network comes back, the editor uploads it and writes the URL onto the
 * owning entity with an `update` whose `feature` carries that ONE attribute
 * (`packages/plugins/editor/src/persistence/image-store.ts`, `_reconcile`). The core's store kept
 * `input.feature ?? current.feature`: a partial `feature` REPLACED the entity, so the local record
 * lost its position and every other attribute — the point vanished from the offline map, and the
 * next edit would have been built from a feature with nothing left in it.
 *
 * 🛑 THE ORDER IS THE FIELD'S, AND THE FIRST DRAFT OF THIS SPEC DID NOT HAVE IT. On reconnection
 * the drain runs its pre-drain hooks first, and the editor's uploads the waiting photos there: the
 * reconciliation lands while the create is STILL QUEUED, coalesces into it, and the create left
 * with the URL and the client identity alone — no position, no attribute. The first draft
 * measured the opposite order (create first, complete; then the upload and a `PATCH`), and it was
 * the instrument's: a context route answers a request even while `setOffline(true)` holds, so the
 * create "reached" the server off-network. The write route now refuses while the test holds the
 * network cut, as a real network would.
 *
 * ⚠️ THE ENDPOINTS ARE INJECTED. `deploy-full` ships `sites_rosario` with no upload endpoint and
 * its write target disabled (`scripts/lib/dev-backend.cjs`, gated `DNS-05`): both are set here, in
 * the bundle, rather than in `profiles/` — a shop window is not a fixture.
 *
 * ⚠️ `context.route`, not `page.route`: a request the Service Worker issues never reaches a page
 * route, and one routed on the context is seen whoever sends it.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { readStore, GEOLEAF_DB } from "./helpers/idb.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("full") });

// The basemap is not this spec's subject: its third-party latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/** A one-pixel PNG, so the field's MIME whitelist and size guard both accept it. */
const PNG_1PX = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
);

/** Where the drain is told to write. Fulfilled here, so every request is readable. */
const ENDPOINT = "https://backend.test/rows";
/** What the upload endpoint answers: the address the file landed at. */
const UPLOADED = "https://backend.test/uploads/photo-53.png";
/** The title typed into the form — the attribute the partial edit must not take away. */
const TITLE = "E2E 53";

/**
 * Gives `sites_rosario` an upload endpoint and a write target, in the served bundle.
 *
 * ⚠️ The intercept is on `profile-bundle.json`: the deploy INLINES every layer config at build
 * time, so `sites_rosario_config.json` is never fetched at runtime.
 *
 * @param {import("@playwright/test").Page} page
 */
async function armEndpoints(page) {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.sites_rosario;
        const photo = (cfg?.attributes?.fields ?? []).find(
            (/** @type {any} */ f) => f.field === "properties.photo_principale"
        );
        if (!photo) throw new Error("le bundle ne porte plus le champ `photo_principale`");
        photo.options = { ...(photo.options ?? {}), uploadEndpoint: "/api/upload" };
        cfg.write = { ...cfg.write, enabled: true, endpoint: ENDPOINT };
        await route.fulfill({ json: bundle });
    });
}

/**
 * Places a point, fills its title, and attaches a photo OFF-NETWORK — then saves.
 *
 * 🛑 OFFLINE BEFORE THE PHOTO: the upload strategy reads `navigator.onLine` and only then decides
 * to keep the file for later. Cutting the network after the capture would take the online path,
 * where no reconciliation ever happens.
 *
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").BrowserContext} context
 * @param {(cut: boolean) => void} markOffline - Told when the network is cut, so the routes
 *   can refuse as a real network would.
 */
async function captureAPhotoOffNetwork(page, context, markOffline) {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("editor"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Editor) === "object",
        null,
        { timeout: 15000 }
    );

    // `toggleMenu()` TOGGLES: toggling until the tool is reachable asserts the intent instead of
    // assuming the starting state (see spec 39).
    const pointBtn = page.locator('button.gl-editor-tool-btn[data-tool="point"]');
    for (let i = 0; i < 3 && !(await pointBtn.isVisible()); i++) {
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Editor.toggleMenu());
        await page.waitForTimeout(300);
    }
    await expect(pointBtn).toBeVisible({ timeout: 10000 });
    await pointBtn.click();
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

    await page.locator(".maplibregl-canvas").click({ position: { x: 250, y: 180 } });
    await expect(page.locator(".gl-form-modal-panel")).toBeVisible({ timeout: 10000 });
    await page.locator(".gl-form-modal__layer select").selectOption("sites_rosario");
    await expect(page.locator("#gl-field-title")).toBeVisible({ timeout: 8000 });
    await page.locator("#gl-field-title").fill(TITLE);

    await context.setOffline(true);
    markOffline(true);
    await page
        .locator("#gl-field-photo_principale-file")
        .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG_1PX });
    await expect(page.locator(".gl-form-image__preview").first()).toBeVisible({ timeout: 15000 });

    await page.evaluate(() => {
        /** @type {any} */ (window).__edQueued = false;
        document.addEventListener("geoleaf:editor:feature-sync-queued", () => {
            /** @type {any} */ (window).__edQueued = true;
        });
    });
    await page.locator(".gl-form-modal__btn-save").click();
    await page.waitForFunction(() => /** @type {any} */ (window).__edQueued === true, null, {
        timeout: 30000,
    });
}

test("[editor] la photo envoyée après coup garde l'entité : position et attributs restent", async ({
    page,
    context,
}) => {
    /** @type {{ method: string, url: string, body: any }[]} */
    const sent = [];
    // Whether the TEST holds the network cut — see the header: a route answers regardless.
    let offline = false;
    await armEndpoints(page);
    await context.route("**/api/upload**", async (route) => {
        sent.push({ method: route.request().method(), url: route.request().url(), body: null });
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ url: UPLOADED }),
        });
    });
    await context.route(`${ENDPOINT}**`, async (route) => {
        if (offline) {
            await route.abort("internetdisconnected");
            return;
        }
        const request = route.request();
        const raw = request.postData();
        sent.push({
            method: request.method(),
            url: request.url(),
            body: raw ? JSON.parse(raw) : null,
        });
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([{ id: 5301, updated_at: "2026-09-19T12:00:00+00:00" }]),
        });
    });

    await captureAPhotoOffNetwork(page, context, (cut) => {
        offline = cut;
    });
    offline = false;
    await context.setOffline(false);

    // --- the witness: the reconciliation really ran --------------------------------------------
    // The upload reached its endpoint, and an edit carrying the URL it answered left for the row.
    // Without both, the store below would be read before the partial edit exists — and a green
    // result would say nothing.
    await expect
        .poll(() => sent.some((s) => s.body?.photo_principale === UPLOADED), {
            timeout: 60000,
            intervals: [500],
            message:
                "aucune écriture n'a porté l'URL de la photo : la réconciliation n'a pas eu lieu",
        })
        .toBe(true);
    expect(
        sent.some((s) => s.url.includes("/api/upload")),
        "l'envoi de la photo n'a pas eu lieu"
    ).toBe(true);

    // 🛑 On the wire: no create may leave without the position and the title — in the field's
    // order, the create carries the URL too, since the two entries coalesced.
    for (const create of sent.filter((s) => s.method === "POST" && s.url.startsWith(ENDPOINT))) {
        expect(create.body?.geom?.type, "une création est partie sans position").toBe("Point");
        expect(create.body?.title).toBe(TITLE);
    }

    // --- the subject: what the DEVICE holds once the URL is written back ------------------------
    await expect
        .poll(
            async () => {
                const features = await readStore(page, { db: GEOLEAF_DB, store: "features" });
                const record = features.find((f) => f.layerId === "sites_rosario");
                return record?.feature?.properties?.photo_principale ?? null;
            },
            { timeout: 15000, intervals: [300] }
        )
        .toBe(UPLOADED);

    const features = await readStore(page, { db: GEOLEAF_DB, store: "features" });
    const record = features.find((f) => f.layerId === "sites_rosario");
    // 🛑 THE HEADLINE. Read red on the shipped bundle before the fix: the record held
    // `{ properties: { photo_principale } }` and nothing else.
    expect(record?.feature?.geometry?.type, "l'entité a perdu sa position").toBe("Point");
    expect(record?.feature?.properties?.title, "l'entité a perdu ses attributs").toBe(TITLE);
});
