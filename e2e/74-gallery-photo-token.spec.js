// @ts-check
/**
 * 74 — A GALLERY'S PHOTOS FOLLOW THE SAME ROAD AS A SINGLE PHOTO
 *
 * 🛑 THE DEFECT THIS SPEC EXISTS FOR. The single-photo field keeps a capture under a short token
 * (`gl-img:<id>`), stores the file with its return address, and writes the server's URL back onto
 * the entity once the upload has happened (`e2e/39`, `e2e/53`). The GALLERY field was left out of
 * that road, on three counts — each read red here on the bundle shipped before the fix:
 *
 *   1. with an upload endpoint, its photos were stored WITHOUT the field they belong to. The
 *      upload happened, the URL came back, and nothing wrote it onto the entity: the tokens left
 *      for the server as they were, and the stored files were purged as delivered;
 *   2. a token in a gallery had no preview — an empty thumbnail;
 *   3. with NO endpoint — what `deploy-full` ships — the gallery wrote a `blob:` object URL into
 *      the attribute, a value that dies with the document.
 *
 * ⚠️ THE ENDPOINTS ARE INJECTED, in the bundle, never in `profiles/` (see `e2e/53`): `deploy-full`
 * ships `sites_rosario` with no upload endpoint and its write target disabled.
 *
 * ⚠️ A ROUTE ANSWERS EVEN OFF-NETWORK: the write route refuses while the test holds the cut, as a
 * real network would. `context.route`, so a request the Service Worker issues is seen too.
 *
 * ⚠️ THE ORDER OF THE URLS IS NOT ASSERTED HERE. The waiting photos are uploaded in the order
 * of their store keys, which are random: which file gets which URL is not this spec's to say. A
 * token being replaced IN PLACE is pinned by the unit suite of the image store.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { layerConfigPath } from "./helpers/profiles.js";
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
const PHOTOS = ["galerie-a.png", "galerie-b.png"].map((name) => ({
    name,
    mimeType: "image/png",
    buffer: PNG_1PX,
}));

/** Where the drain is told to write. Fulfilled here, so every request is readable. */
const ENDPOINT = "https://backend.test/rows";
/** What the upload endpoint answers, by call: the address each file landed at. */
const uploadedUrl = (n) => `https://backend.test/uploads/galerie-74-${n}.png`;
const TITLE = "E2E 74";

/**
 * Gives `sites_rosario` a write target and, on request, an upload endpoint on its gallery.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ uploadEndpoint: boolean }} options
 */
async function armLayer(page, { uploadEndpoint }) {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.sites_rosario;
        const gallery = (cfg?.attributes?.fields ?? []).find(
            (/** @type {any} */ f) => f.field === "properties.galerie"
        );
        if (!gallery) throw new Error("le bundle ne porte plus le champ `galerie`");
        if (uploadEndpoint) {
            gallery.options = { ...(gallery.options ?? {}), uploadEndpoint: "/api/upload" };
        }
        cfg.write = { ...cfg.write, enabled: true, endpoint: ENDPOINT };
        await route.fulfill({ json: bundle });
    });
}

/**
 * Opens the capture form on a new point of `sites_rosario`, title filled.
 *
 * @param {import("@playwright/test").Page} page
 */
async function openCaptureForm(page) {
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
}

/**
 * Attaches the photos to the gallery field and waits for one thumbnail each.
 *
 * ⚠️ The field id is the LEAF (`galerie`), as for the single photo — see spec 39.
 *
 * @param {import("@playwright/test").Page} page
 */
async function attachToGallery(page) {
    await page.locator("#gl-field-galerie-file").setInputFiles(PHOTOS);
    await expect(page.locator(".gl-form-gallery__item")).toHaveCount(PHOTOS.length, {
        timeout: 15000,
    });
}

/** Saves the form and waits for the capture to be queued. */
async function saveAndWaitQueued(page) {
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

/** The gallery attribute of the entity the device holds, or `null`. */
async function galleryOnDevice(page) {
    const features = await readStore(page, { db: GEOLEAF_DB, store: "features" });
    const record = features.find((f) => f.layerId === "sites_rosario");
    return record?.feature?.properties?.galerie ?? null;
}

test("[editor] les photos d'une galerie envoyées après coup arrivent à leur entité, par leur URL", async ({
    page,
    context,
}) => {
    // An off-network capture, the return of the network, two uploads and a drain.
    test.setTimeout(150_000);
    /** @type {{ method: string, url: string, body: any }[]} */
    const written = [];
    let uploads = 0;
    // Whether the TEST holds the network cut — a route answers regardless.
    let offline = false;
    // How many writes the route refused while it did.
    let refused = 0;
    await armLayer(page, { uploadEndpoint: true });
    await context.route("**/api/upload**", async (route) => {
        uploads += 1;
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ url: uploadedUrl(uploads) }),
        });
    });
    await context.route(`${ENDPOINT}**`, async (route) => {
        if (offline) {
            refused += 1;
            await route.abort("internetdisconnected");
            return;
        }
        const request = route.request();
        const raw = request.postData();
        written.push({
            method: request.method(),
            url: request.url(),
            body: raw ? JSON.parse(raw) : null,
        });
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([{ id: 7401, updated_at: "2026-10-03T12:00:00+00:00" }]),
        });
    });

    await openCaptureForm(page);
    // 🛑 OFFLINE BEFORE THE PHOTOS: the upload strategy reads `navigator.onLine` and only then
    // decides to keep the files for later.
    await context.setOffline(true);
    offline = true;
    await attachToGallery(page);
    await saveAndWaitQueued(page);

    // The scenario, before the network comes back: two tokens on the entity, two files waiting.
    const waiting = await galleryOnDevice(page);
    expect(waiting, "la galerie n'a pas été enregistrée avec l'entité").toHaveLength(2);
    for (const value of waiting) expect(String(value)).toMatch(/^gl-img:/);
    expect(uploads, "une photo est partie pendant la coupure").toBe(0);

    // 🛑 THE CUT IS HELD UNTIL THE SAVE'S OWN ATTEMPT HAS BEEN REFUSED. A save asks for a drain
    // at once, network or not, and that create is on its way to the route above — which answers
    // even off-network. Released a few milliseconds early, the flag let it THROUGH: the create
    // "reached the server" during the cut, with its two tokens, and the spec read red on a
    // corrected bundle. Measured: one run in two.
    await expect
        .poll(() => refused, {
            timeout: 15000,
            message: "la création n'a pas été tentée, puis refusée, pendant la coupure",
        })
        .toBeGreaterThan(0);

    offline = false;
    await context.setOffline(false);

    // --- the witness: both uploads happened ----------------------------------------------------
    // Without it, what follows would be read before there is anything to reconcile.
    await expect
        .poll(() => uploads, {
            timeout: 60000,
            intervals: [500],
            message: "les photos de la galerie n'ont pas été envoyées au retour du réseau",
        })
        .toBe(2);

    // --- the subject, on the device -------------------------------------------------------------
    // 🛑 THE HEADLINE. Read red on the bundle shipped before the fix: the files had left and
    // their records were purged, and the entity still held the two tokens — designating nothing.
    const expected = [uploadedUrl(1), uploadedUrl(2)];
    await expect
        .poll(async () => [...((await galleryOnDevice(page)) ?? [])].sort(), {
            timeout: 15000,
            intervals: [300],
            message: "l'appareil garde des jetons dont les fichiers sont partis",
        })
        .toEqual(expected);

    // --- the subject, on the wire ---------------------------------------------------------------
    // ⚠️ The create failed once while the network was cut, so it waits for its retry delay —
    // unless an edit coalesces into it, which re-arms it: that is what the reconciliation does,
    // and why the create leaves at once. Measured before the fix: it left a minute later, with
    // its two tokens.
    await expect
        .poll(() => written.some((w) => w.method === "POST"), {
            timeout: 30000,
            intervals: [500],
            message: "la création n'est pas partie avec la réconciliation",
        })
        .toBe(true);
    for (const write of written) {
        expect(
            JSON.stringify(write.body?.galerie ?? null),
            `un jeton est parti sur le fil (${write.method})`
        ).not.toContain("gl-img:");
    }
    const create = written.find((w) => w.method === "POST");
    expect([...(create?.body?.galerie ?? [])].sort(), "la création ne porte pas les URL").toEqual(
        expected
    );
    expect(create?.body?.title).toBe(TITLE);
});

test("[editor] une photo de galerie en attente d'envoi a un aperçu", async ({ page, context }) => {
    await armLayer(page, { uploadEndpoint: true });
    await openCaptureForm(page);
    await context.setOffline(true);
    await attachToGallery(page);

    // What the user sees: a thumbnail that DISPLAYS. A token is not an address the browser can
    // load, so an unresolved one leaves an image with nothing in it.
    await expect
        .poll(
            () =>
                page
                    .locator("img.gl-form-gallery__thumb")
                    .evaluateAll((imgs) =>
                        imgs.map((img) => /** @type {HTMLImageElement} */ (img).naturalWidth > 0)
                    ),
            { timeout: 15000, message: "les vignettes de la galerie sont vides" }
        )
        .toEqual([true, true]);
});

test("[editor] la configuration LIVRÉE — sans endpoint — garde les photos d'une galerie", async ({
    page,
    context,
    request,
}) => {
    // Same declared precondition as spec 39: under a build made with GEOLEAF_BACKEND_BASE_URL
    // the upload endpoint is re-hosted, not stripped, and this case's subject does not exist.
    const served = await request.get(
        `${baseURL("full")}${layerConfigPath("tourism", "sites_rosario")}`,
        { timeout: 8000 }
    );
    const declared = served.ok()
        ? ((await served.json())?.attributes?.fields ?? []).some(
              (/** @type {any} */ f) => f?.options?.uploadEndpoint
          )
        : false;
    test.skip(
        declared,
        "la variante servie a été bâtie avec GEOLEAF_BACKEND_BASE_URL : son `uploadEndpoint` " +
            "est RÉ-HÉBERGÉ, pas retiré, donc le sujet de ce cas — la configuration livrée SANS " +
            "endpoint — n'existe pas sur cet artefact. Reconstruire avec `npm run build:deploy` nu."
    );

    // No `armLayer` here: the subject IS what the deploy ships.
    await openCaptureForm(page);
    await context.setOffline(true);
    await attachToGallery(page);
    await saveAndWaitQueued(page);

    const gallery = await galleryOnDevice(page);
    expect(gallery, "la galerie n'a pas été enregistrée avec l'entité").toHaveLength(2);
    for (const value of gallery) {
        // 🛑 The defect in its exact form: an object URL, dead the moment the document goes.
        expect(String(value)).not.toMatch(/^blob:/);
        expect(String(value)).toMatch(/^gl-img:/);
    }

    const images = await readStore(page, { db: GEOLEAF_DB, store: "local_images" });
    expect(images, "les photos n'ont pas été gardées").toHaveLength(2);
    for (const img of images) {
        // `null`, NOT missing — see spec 39: "no endpoint declared" and "endpoint lost" are two
        // states the retry must keep telling apart.
        expect(img.endpoint).toBeNull();
        expect(img.fieldPath).toBe("galerie");
    }
});
