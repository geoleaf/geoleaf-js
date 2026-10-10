#!/usr/bin/env node
/**
 * PROBE — what IndexedDB accepts to store in a NON-PERSISTENT context, and what the editor's
 * photo path does about it. WebKit and Chromium, an ephemeral context against a persistent one.
 *
 * WHY IT EXISTS. The editor keeps a photo taken off-network as a `Blob` in IndexedDB
 * (`packages/plugins/editor/src/persistence/image-store.ts`, `storeImageLocally`). In a
 * non-persistent WebKit context that `put` is refused. WebKit's source says the refusal is
 * deliberate for an ephemeral session (`IDBTransaction::putOrAddOnServer`), which is what
 * Safari's private browsing is. The capture used to fall back to a data-URL written into the
 * feature's attribute — the very thing the `gl-img:` token exists to prevent. The core now
 * writes in two steps, the `Blob` and on its refusal the bytes: this probe is what read the
 * defect, and what reads that the second step is taken where — and only where — the first is
 * refused.
 *
 * WHAT IT MEASURES, in three parts:
 *   1. the raw store — `scripts/probe-idb-blob-ephemeral.html`, the page meant for a real
 *      device, loaded here as it is: a Blob, a File, an ArrayBuffer, a Uint8Array and
 *      `{ bytes, type }`, each `put` in its own transaction, with the FORM of every refusal;
 *   2. the core — `GeoLeaf.Storage.DB.storeImageLocally()` handed a Blob: resolved, rejected,
 *      or never settled — and, resolved, the SHAPE of the record read back, `blob` or `bytes`;
 *   3. the product — a photo attached in the capture form of `deploy-full` as shipped: whether
 *      its preview paints, then, saved, what the feature's attribute holds on the device and
 *      under which shape the file is kept.
 *
 * 🖐 WHAT IT CANNOT SAY: what a real Safari does in a private tab. The page of part 1 is the
 * instrument for that, opened on the device.
 *
 * WHY A STANDALONE SCRIPT AND NOT `playwright test`: the WebKit projects of
 * `playwright.config.js` are bounded to named specs, and this is a measure, not a guard — it
 * prints a table and asserts nothing about the product. Same shape as
 * `scripts/probe-boot-contract.mjs`.
 *
 * ⚠️ RUN THE FOUR-STEP REGENERATION FIRST: parts 2 and 3 read whatever nginx serves.
 *
 * Usage:  E2E_TARGET=nginx node scripts/probe-idb-blob-ephemeral.mjs
 * Exit:   0 = every part was measured · 1 = a part could not be measured (named in the output)
 *
 * ⚠️ `E2E_TARGET=nginx` is NOT optional: `baseURL()` defaults to the `ports` target, whose
 * servers this probe must never start.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL } from "../e2e/helpers/base-url.js";
import { readStore, GEOLEAF_DB } from "../e2e/helpers/idb.js";

const ORIGIN = process.env.GEOLEAF_PROBE_URL || baseURL("full");
const PROBE_PATH = "/__probe__/idb-blob-ephemeral.html";
const PROBE_PAGE = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "probe-idb-blob-ephemeral.html"),
    "utf8"
);
/** A one-pixel PNG, accepted by the photo field's MIME whitelist and size guard. */
const PNG_1PX = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
);
const CONTEXT_OPTIONS = { ignoreHTTPSErrors: true, serviceWorkers: /** @type {const} */ ("block") };

/** @type {string[]} */
const unmeasured = [];

/**
 * @typedef {object} Engine
 * @property {string} name
 * @property {import("@playwright/test").BrowserType} type
 * @property {import("@playwright/test").LaunchOptions} launch
 */

/** @type {Engine[]} */
const ENGINES = [
    // WebKit takes no Chromium flag: handed SwiftShader arguments it does not start.
    { name: "webkit", type: webkit, launch: {} },
    { name: "chromium", type: chromium, launch: { args: SOFTWARE_GL_ARGS } },
];

/**
 * Runs `measure` in an ephemeral context, then in a persistent one, of the same engine.
 *
 * @template T
 * @param {Engine} engine
 * @param {(context: import("@playwright/test").BrowserContext) => Promise<T>} measure
 * @returns {Promise<{ ephemeral: T, persistent: T }>}
 */
async function inBothContexts(engine, measure) {
    const browser = await engine.type.launch(engine.launch);
    /** @type {T} */
    let ephemeral;
    try {
        ephemeral = await measure(await browser.newContext(CONTEXT_OPTIONS));
    } finally {
        await browser.close();
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `gl-probe-${engine.name}-`));
    const context = await engine.type.launchPersistentContext(dir, {
        ...engine.launch,
        ...CONTEXT_OPTIONS,
    });
    try {
        return { ephemeral, persistent: await measure(context) };
    } finally {
        await context.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * Part 1 — the device page, served on the deploy's own origin so that IndexedDB has one.
 *
 * @param {import("@playwright/test").BrowserContext} context
 * @returns {Promise<{ verbatim: string, results: { label: string, outcome: string, detail: string, events: string[], readBack?: string }[] }>}
 */
async function rawStore(context) {
    const page = await context.newPage();
    await page.route(`**${PROBE_PATH}`, (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: PROBE_PAGE })
    );
    await page.goto(`${ORIGIN}${PROBE_PATH}`);
    await page.waitForFunction(() => Reflect.has(window, "__glProbeReport"), null, {
        timeout: 60_000,
    });
    const results = await page.evaluate(() => Reflect.get(window, "__glProbeReport").results);
    const verbatim = (await page.locator("#verbatim").textContent()) ?? "";
    await page.close();
    return { verbatim, results };
}

/**
 * Part 2 — the core's image store, handed a Blob.
 *
 * @param {import("@playwright/test").BrowserContext} context
 * @returns {Promise<string>}
 */
async function coreStore(context) {
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(
        () => typeof Reflect.get(window, "GeoLeaf")?.Storage?.DB?.storeImageLocally === "function",
        null,
        { timeout: 60_000 }
    );
    const outcome = await page.evaluate(async () => {
        const db = Reflect.get(window, "GeoLeaf").Storage.DB;
        const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
        const id = `image_probe_${Date.now()}`;
        // The shape is read from the record, never deduced from the context: it is the subject.
        const shapeOf = async () => {
            const record = await db.getLocalImage(id);
            if (record?.blob instanceof Blob) return `gardée en Blob (${record.blob.size} octets)`;
            if (record?.bytes instanceof ArrayBuffer) {
                return `gardée en OCTETS (${record.bytes.byteLength} octets, ${record.type})`;
            }
            return "ENREGISTREMENT SANS IMAGE";
        };
        const put = db
            .storeImageLocally({
                id,
                blob,
                filename: "probe.png",
                type: blob.type,
                size: blob.size,
                timestamp: Date.now(),
                endpoint: null,
                uploaded: 0,
                // What the editor passes. Without it the core rejects a refused Blob, and
                // this probe would measure the rejection, not the fallback.
                acceptBytes: true,
            })
            .then(
                async () => `résolue — ${await shapeOf()}`,
                (/** @type {unknown} */ e) =>
                    `REJETÉE — ${e instanceof Error ? `${e.name} : ${e.message}` : String(e)}`
            );
        const silent = new Promise((resolve) =>
            setTimeout(() => resolve("JAMAIS RÉSOLUE en 8 s — aucun repli possible"), 8000)
        );
        return Promise.race([put, silent]);
    });
    await page.close();
    return String(outcome);
}

/**
 * Part 3 — a photo attached in the capture form of the deploy as shipped, then saved.
 *
 * @param {import("@playwright/test").BrowserContext} context
 * @returns {Promise<string>}
 */
async function productPath(context) {
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/`);
    await page.locator("#geoleaf-map").waitFor({ state: "visible", timeout: 60_000 });
    await page.evaluate(() => Reflect.get(window, "GeoLeaf").plugins.load("editor"));
    await page.waitForFunction(
        () => typeof Reflect.get(window, "GeoLeaf")?.Editor === "object",
        null,
        { timeout: 30_000 }
    );
    const pointBtn = page.locator('button.gl-editor-tool-btn[data-tool="point"]');
    for (let i = 0; i < 3 && !(await pointBtn.isVisible()); i++) {
        await page.evaluate(() => Reflect.get(window, "GeoLeaf").Editor.toggleMenu());
        await page.waitForTimeout(300);
    }
    await pointBtn.click();
    await page.waitForFunction(
        () => {
            try {
                return !!Reflect.get(window, "GeoLeaf")
                    .Core.getMap()
                    .getNativeMap()
                    .getLayer("td-point");
            } catch {
                return false;
            }
        },
        null,
        { timeout: 30_000 }
    );
    await page.locator(".maplibregl-canvas").click({ position: { x: 250, y: 180 } });
    await page.locator(".gl-form-modal-panel").waitFor({ state: "visible", timeout: 15_000 });
    await page.locator(".gl-form-modal__layer select").selectOption("sites_rosario");
    await page.locator("#gl-field-title").fill("sonde photo");
    await page
        .locator("#gl-field-photo_principale-file")
        .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG_1PX });
    await page.locator(".gl-form-image__preview").first().waitFor({ timeout: 20_000 });
    // The reader's half: a token paints only if the stored image can be turned back into a
    // `Blob`, whichever shape the record carries.
    const preview = await page
        .waitForFunction(
            () => {
                const host = document.querySelector(".gl-form-image__preview");
                const img = host instanceof HTMLImageElement ? host : host?.querySelector("img");
                return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0
                    ? `aperçu peint (${img.src.slice(0, 5)})`
                    : null;
            },
            null,
            { timeout: 10_000 }
        )
        .then(
            (handle) => handle.jsonValue(),
            () => "APERÇU NON PEINT"
        );
    await page.evaluate(() => {
        document.addEventListener("geoleaf:editor:feature-sync-queued", () => {
            Reflect.set(window, "__probeQueued", true);
        });
    });
    await page.locator(".gl-form-modal__btn-save").click();
    await page.waitForFunction(() => Reflect.get(window, "__probeQueued") === true, null, {
        timeout: 30_000,
    });
    const features = await readStore(page, { db: GEOLEAF_DB, store: "features" });
    const images = await readStore(page, { db: GEOLEAF_DB, store: "local_images" });
    await page.close();
    // A `Blob` and an `ArrayBuffer` do not cross to Node: the KEY the record carries does.
    const shapes = images.map((/** @type {Record<string, unknown>} */ record) =>
        "blob" in record ? "Blob" : "bytes" in record ? "octets" : "sans image"
    );
    const record = features.find(
        (/** @type {{ layerId?: string }} */ f) => f.layerId === "sites_rosario"
    );
    const value = String(record?.feature?.properties?.photo_principale ?? "(absent)");
    const kind = value.startsWith("data:")
        ? `DATA-URL de ${value.length} caractères`
        : value.startsWith("gl-img:")
          ? "jeton gl-img:"
          : value.slice(0, 40);
    return `${preview} ; l'attribut porte ${kind} ; ${images.length} fichier(s) au magasin d'images [${shapes.join(", ")}]`;
}

/**
 * Runs one part on one engine, in both contexts, and prints it. A part that throws is named
 * and counted, never swallowed: the table must not look complete when it is not.
 *
 * @template T
 * @param {string} title
 * @param {Engine} engine
 * @param {(context: import("@playwright/test").BrowserContext) => Promise<T>} measure
 * @param {(kind: string, value: T) => void} print
 */
async function part(title, engine, measure, print) {
    console.log(`\n── ${title} — ${engine.name} ──`);
    try {
        const both = await inBothContexts(engine, measure);
        print("éphémère  ", both.ephemeral);
        print("persistant", both.persistent);
    } catch (e) {
        const reason = e instanceof Error ? e.message.split("\n")[0] : String(e);
        unmeasured.push(`${title} — ${engine.name} : ${reason}`);
        console.log(`  ✗ NON MESURÉ : ${reason}`);
    }
}

const [wk] = ENGINES;
for (const engine of ENGINES) {
    await part("1. le magasin brut (la page de sonde)", engine, rawStore, (kind, report) => {
        if (!report.verbatim.includes("userAgent")) {
            unmeasured.push(`la page de sonde n'affiche pas son relevé — ${engine.name}, ${kind}`);
        }
        for (const r of report.results) {
            const detail = r.outcome === "stockée" ? (r.readBack ?? "") : r.detail;
            console.log(`  ${kind} · ${r.label.padEnd(16)} ${r.outcome} — ${detail}`);
            console.log(
                `  ${" ".repeat(kind.length)}   ${" ".repeat(16)} [${r.events.join(" → ")}]`
            );
        }
    });
}
if (wk) {
    await part("2. le core : storeImageLocally(Blob)", wk, coreStore, (kind, outcome) =>
        console.log(`  ${kind} · ${outcome}`)
    );
    await part(
        "3. le produit : photo attachée, puis enregistrée",
        wk,
        productPath,
        (kind, outcome) => console.log(`  ${kind} · ${outcome}`)
    );
}

if (unmeasured.length > 0) {
    console.log(`\n✗ ${unmeasured.length} mesure(s) manquante(s) :`);
    for (const line of unmeasured) console.log(`  - ${line}`);
    process.exit(1);
}
console.log(
    "\n✓ Les trois parts sont mesurées. La lecture sur appareil reste à faire, par la page."
);
