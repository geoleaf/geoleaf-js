// @ts-check
/**
 * 39 — AN OFF-NETWORK PHOTO DOES NOT TRAVEL AS BASE64 INSIDE THE FEATURE
 *
 * 🛑 THE DEFECT THIS SPEC EXISTS FOR. Off-network, the image field wrote the photo's
 * `data:image/...;base64,…` straight into the feature's attribute. That string then travelled
 * to the server INSIDE the create — a multi-megabyte value in a text column — while the real
 * upload's URL, obtained later, was thrown away. The attribute now holds a short, stable
 * token; the file itself waits in `local_images` with its return address.
 *
 * ⚠️ WHY THIS CANNOT BE A UNIT TEST. The chain crosses three packages and two stores: the
 * field component (`@geoleaf/field-renderer`), the plugin's upload strategy, the core's
 * IndexedDB, and the outbox. What the unit suites prove is each link; what only a browser
 * proves is that the bytes which LAND carry no base64 — and the store is where that shows.
 *
 * ⚠️ The assertion is on the OUTBOX and the `features` store, never on an event. That is the
 * lesson `e2e/helpers/idb.js` was written for: an event fires just as happily when the
 * payload it carries is wrong.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { readStore, GEOLEAF_DB } from "./helpers/idb.js";

test.use({ baseURL: baseURL("full") });

/** A one-pixel PNG, so the field's MIME whitelist and size guard both accept it. */
const PNG_1PX = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
);

/**
 * Gives the photo field an upload endpoint.
 *
 * 🛑 THE DELIVERED PROFILE HAS NONE, and that is not an oversight of this test: `build-deploy`
 * strips the dev backend's bindings from every deliverable (`lib/dev-backend.cjs`, gated
 * `DNS-05`), `uploadEndpoint` included. So `deploy-full` ships a photo field that is
 * display-only — a real case, covered by the unit suites. The scenario the audit describes is
 * the OTHER one: a field that has somewhere to send the file, off-network. It is injected
 * here, into the bundle, rather than by editing `profiles/` — a shop window is not a fixture.
 *
 * ⚠️ The intercept is on `profile-bundle.json`: the deploy INLINES every layer config at build
 * time, so `sites_rosario_config.json` is never fetched at runtime.
 */
async function armUploadEndpoint(page) {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const fields = bundle.layerConfigs?.sites_rosario?.attributes?.fields ?? [];
        const photo = fields.find((f) => f.field === "properties.photo_principale");
        if (!photo) throw new Error("le bundle ne porte plus le champ `photo_principale`");
        photo.options = { ...(photo.options ?? {}), uploadEndpoint: "/api/upload" };
        await route.fulfill({ json: bundle });
    });
}

async function armEditor(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("editor"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Editor) === "object",
        null,
        { timeout: 15000 }
    );
}

/**
 * Drives the whole field gesture: open the capture form, cut the network, attach the photo,
 * save. Shared by the two configurations this file compares — an endpoint, or none.
 *
 * @param page    - The page.
 * @param context - Its browser context, for the network cut.
 */
async function captureAPhotoOffNetwork(page, context) {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await armEditor(page);

    // ⚠️ `toggleMenu()` TOGGLES, so calling it blind depends on a state this test does not
    // own — measured here: the button was present and hidden, i.e. the call had CLOSED an
    // already-open menu. Toggling until the tool is reachable asserts the intent ("the menu
    // is open") instead of assuming the starting point.
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
    await page.locator("#gl-field-title").fill("E2E photo");

    // 🛑 OFFLINE BEFORE THE PHOTO, and that order is the scenario: the upload strategy checks
    // `navigator.onLine` and only then decides to keep the file. Cutting the network after the
    // capture would exercise the online path and prove nothing.
    await context.setOffline(true);

    // ⚠️ THE FIELD ID IS THE LEAF, NOT THE DOTTED PATH. `attributes-to-form` projects
    // `properties.photo_principale` onto the id `photo_principale`, and that is also the key
    // the form's value map — hence the feature's `properties` — is written under. Naming the
    // input by the schema path finds nothing. `input[type=file]` alone would not do either:
    // `sites_rosario` declares BOTH `photo_principale` and `galerie`.
    await page
        .locator("#gl-field-photo_principale-file")
        .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG_1PX });

    // The strategy runs asynchronously; the preview appearing is what says it settled.
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

test("[editor] hors réseau, l'outbox porte un JETON — jamais la base64 de la photo", async ({
    page,
    context,
}) => {
    await armUploadEndpoint(page);
    await captureAPhotoOffNetwork(page, context);

    // --- what LANDED ------------------------------------------------------
    const features = await readStore(page, { db: GEOLEAF_DB, store: "features" });
    const record = features.find((f) => f.layerId === "sites_rosario");
    expect(record, "aucune entité enregistrée localement").toBeTruthy();

    const serialised = JSON.stringify(record.feature.properties ?? {});
    // 🛑 THE HEADLINE. A single `data:` anywhere in the attributes means the photo is back
    // inside the entity, and on its way to the server that way.
    expect(serialised).not.toContain("data:image");
    expect(serialised).toContain("gl-img:");

    // The file itself is kept, WITH its return address — without which the upload that
    // eventually succeeds has nowhere to send the resulting URL back to.
    const images = await readStore(page, { db: GEOLEAF_DB, store: "local_images" });
    expect(images.length).toBeGreaterThan(0);
    const img = images[images.length - 1];
    expect(img.endpoint, "l'endpoint n'a pas été persisté — la reprise serait un no-op").toBe(
        "/api/upload"
    );
    // The leaf key, which is what the feature's `properties` is keyed by.
    expect(img.fieldPath).toBe("photo_principale");
    expect(img.layerId).toBe("sites_rosario");
    expect(img.localId, "la photo n'a pas été liée à son entité").toBeTruthy();
    expect(img.uploaded).toBe(0);
});

/**
 * 🛑 THE SHIPPED CONFIGURATION, AND NOTHING WAS EXERCISING IT.
 *
 * `build-deploy` strips a layer's upload endpoint when that layer is bound to the proof
 * backend — deliberately, and with a NARROW predicate: the layer is dev-bound because its
 * `offline.source.url` or its `write.endpoint` names a proof host, never because it happens
 * to declare an `uploadEndpoint` (`scripts/lib/dev-backend.cjs`). A client profile's upload is
 * therefore untouched. The consequence is that `deploy-full` ships a photo field with **no**
 * endpoint at all, which is the exact case four other shipped layers are in by declaration.
 *
 * ⚠️ THAT BRANCH USED TO LOSE THE PHOTO. With no endpoint the library fell back to
 * `URL.createObjectURL` and wrote the result into the attribute — a value that dies with the
 * document, so the capture was gone at the next reload and whatever reached a server
 * designated nothing. The unit suites cover the branch; only a run against the ARTEFACT says
 * the host's strategy was registered before the capture, which is what makes it work.
 */
test("[editor] la configuration LIVRÉE — sans endpoint — garde quand même la photo", async ({
    page,
    context,
}) => {
    // No `armUploadEndpoint` here: the subject IS what the deploy ships.
    await captureAPhotoOffNetwork(page, context);

    const features = await readStore(page, { db: GEOLEAF_DB, store: "features" });
    const record = features.find((f) => f.layerId === "sites_rosario");
    expect(record, "aucune entité enregistrée localement").toBeTruthy();

    const photo = record.feature.properties?.photo_principale;
    // 🛑 The defect in its exact form: an object URL, dead the moment the document goes.
    expect(String(photo)).not.toMatch(/^blob:/);
    expect(String(photo)).toMatch(/^gl-img:/);

    const images = await readStore(page, { db: GEOLEAF_DB, store: "local_images" });
    const img = images[images.length - 1];
    expect(img, "la photo n'a pas été gardée").toBeTruthy();
    // 🛑 `null`, NOT missing. "The field declared no endpoint" and "the endpoint was lost" are
    // two different states, and the retry must stay able to tell them apart — the second is a
    // defect that has to keep being loud.
    expect(img.endpoint).toBeNull();
    expect(img.fieldPath).toBe("photo_principale");
});
