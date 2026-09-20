// @ts-check
/**
 * 55 — « STOP » STOPS THE DOWNLOAD, THE ENTITIES INCLUDED — AND ITS CONFIRMATION IS REACHABLE
 *
 * 🛑 TWO DEFECTS OF ONE GESTURE, both measured on the shipped bundle before this spec was
 * written, and neither visible to any other test:
 *
 * 1. **The confirmation opened UNDER the download window.** It is a modal-shell dialog at
 *    `z-index: 10000`, the window sat at `10002`: « Confirmer » was covered by the window's own
 *    rows — measured, `document.elementFromPoint` returning `.gl-cache-zone__row-label`. Focus
 *    lands on « Annuler », so a keyboard could still confirm, blind; a mouse or a finger could
 *    not. The same held for the window's « Clear cache ».
 * 2. **The stop did not reach the entities.** `cancelDownload()` raised the resource
 *    downloader's controller, which no longer exists once the pull runs. Measured on the bundle,
 *    stopping during the pull: the source was asked for the NEXT page after the stop, the pull
 *    ran to its end and, being complete, removed the two entities the server had dropped — while
 *    the panel showed « Download stopped », then a success notice.
 *
 * WHAT THIS SPEC ADDS TO `cache-manager-orchestration.test.js`: the gesture, with the mouse, on
 * the bundle. The stop is confirmed by CLICKING, so the stacking above is part of what it holds.
 *
 * ⚠️ THE SOURCE IS A ROUTE, NOT A BACKEND — `deploy-full` ships `sites_rosario` without its
 * `offline.source` (gated `DNS-05`), so it is injected into the served bundle, and the
 * collection is served here, in pages, one of which is HELD while the stop is pressed.
 * `context.route`, not `page.route`: once the worker controls the page, a request it issues
 * never reaches a page route.
 *
 * ⚠️ THE HELD PAGE IS RELEASED WITHIN SECONDS: the service worker bounds every fetch at 10 s
 * (`fetchBounded`), and a page held past that comes back as a network error — which would make
 * the pull report `sourceUnreachable` and hide what this spec measures.
 */

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { readStore, readRecord, GEOLEAF_DB } from "./helpers/idb.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("full") });

// The basemap is not this spec's subject: its third-party latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/** Where the injected pull source lives. Fulfilled here, so every request is readable. */
const OGC = "https://backend.test/ogc";
/** Small pages, so the pull is still walking when the stop is pressed. */
const PAGE_SIZE = 2;

/** An entity as an OGC API Features server returns it, inside the declared extent. */
function row(id) {
    return {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [-60.64 + id / 100, -32.94] },
        properties: {
            id,
            local_id: null,
            title: `Site 55-${id}`,
            updated_at: "2026-09-01T08:00:00+00:00",
        },
    };
}

/**
 * Gives `sites_rosario` its pull source, in the served bundle.
 *
 * ⚠️ Only a `200` to a `GET` is rewritten: the window asks for the bundle again with `HEAD` while
 * it downloads, and a conditional request may answer `304` — neither carries a body to parse.
 *
 * @param {import("@playwright/test").Page} page
 */
async function armPullSource(page) {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const response = await route.fetch();
        if (route.request().method() !== "GET" || response.status() !== 200) {
            await route.fulfill({ response });
            return;
        }
        const bundle = await response.json();
        const cfg = bundle.layerConfigs?.sites_rosario;
        if (!cfg) throw new Error("le bundle ne porte plus la couche `sites_rosario`");
        cfg.offline = {
            ...(cfg.offline ?? {}),
            enabled: true,
            maxFeatures: 5000,
            source: { url: OGC },
        };
        await route.fulfill({ response, json: bundle });
    });
}

/**
 * Serves the collection page by page, `offset` by `offset`, and can HOLD one page.
 *
 * @param {import("@playwright/test").BrowserContext} context
 * @param {ReturnType<typeof row>[]} initial
 */
async function servePagedCollection(context, initial) {
    const rows = new Map(initial.map((f) => [f.id, f]));
    /** @type {{ at: number, offset: number }[]} */
    const asked = [];
    /** @type {null | { offset: number, reached: () => void, gate: Promise<void> }} */
    let held = null;
    await context.route(`${OGC}/**`, async (route) => {
        const url = new URL(route.request().url());
        const offset = Number(url.searchParams.get("offset") ?? 0);
        asked.push({ at: Date.now(), offset });
        if (held && held.offset === offset) {
            const waiting = held;
            held = null;
            waiting.reached();
            await waiting.gate;
        }
        const all = [...rows.values()];
        const slice = all.slice(offset, offset + PAGE_SIZE);
        const next = new URL(url);
        next.searchParams.set("offset", String(offset + PAGE_SIZE));
        // The stopped run leaves a request the page no longer awaits: fulfilling it then throws,
        // and that throw is not this spec's subject.
        await route
            .fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    type: "FeatureCollection",
                    numberMatched: all.length,
                    numberReturned: slice.length,
                    features: slice,
                    links:
                        offset + PAGE_SIZE < all.length
                            ? [{ rel: "next", href: next.toString() }]
                            : [],
                }),
            })
            .catch(() => {});
    });
    return {
        rows,
        asked,
        /** Holds the page at `offset` until the returned `release` is called. */
        hold(offset) {
            let reached = () => {};
            const reachedAt = new Promise(
                (resolve) => (reached = /** @type {() => void} */ (resolve))
            );
            let release = () => {};
            const gate = new Promise((resolve) => (release = /** @type {() => void} */ (resolve)));
            held = { offset, reached, gate: /** @type {Promise<void>} */ (gate) };
            return { reachedAt, release };
        },
    };
}

/**
 * Opens the download window, sets the zone with its "profile area" button, and downloads.
 *
 * @param {import("@playwright/test").Page} page
 */
async function downloadWithProfileZone(page) {
    const modal = page.locator("#gl-cache-modal");
    if ((await modal.count()) === 0 || !(await modal.isVisible())) {
        await page.locator('[data-gl-toolbar-action="offline-ui"]').first().click();
        await expect(modal).toHaveCount(1, { timeout: 5000 });
    }
    await page.locator(".gl-cache-zone__buttons .gl-btn").nth(1).click();
    // The witness that the zone EXISTS before the download reads it: the button persists it
    // asynchronously, and a download started on the next tick loads a selection without it.
    await expect
        .poll(
            async () => {
                const saved = await readRecord(page, {
                    db: GEOLEAF_DB,
                    store: "preferences",
                    key: "cache_layer_selection_tourism",
                });
                return saved?.value?.vectorZone?.source ?? null;
            },
            { timeout: 10000, message: "la zone n'est pas enregistrée avant le téléchargement" }
        )
        .toBe("profile");
    const download = page.locator("#gl-cache-download");
    await expect(download).toBeEnabled({ timeout: 30000 });
    await download.click();
}

/** The server identities of `sites_rosario` held on the device. */
async function storedIds(page) {
    const records = await readStore(page, { db: GEOLEAF_DB, store: "features" });
    return records
        .filter((r) => r.layerId === "sites_rosario")
        .map((r) => String(r.serverId))
        .sort();
}

test("[offline] « Arrêter » pendant le rapatriement l'arrête, et rien ne quitte l'appareil", async ({
    page,
    context,
}) => {
    test.setTimeout(150000);
    await armPullSource(page);
    const source = await servePagedCollection(
        context,
        [1, 2, 3, 4, 5, 6, 7, 8].map((id) => row(id))
    );

    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    // Every toast as it is born: the success notice that follows a stop is one of the subjects,
    // and toasts remove themselves after a few seconds.
    await page.evaluate(() => {
        const seen = [];
        /** @type {any} */ (window).__glToasts = seen;
        new MutationObserver((records) =>
            records.forEach((record) =>
                record.addedNodes.forEach((node) => {
                    const el = /** @type {HTMLElement} */ (node);
                    if (el.classList?.contains("gl-toast"))
                        seen.push(`${el.className}|${el.textContent}`);
                })
            )
        ).observe(document.body, { childList: true, subtree: true });
    });

    // --- first download: the reference state ------------------------------------------------
    await downloadWithProfileZone(page);
    await expect(page.locator("#gl-cache-download")).toBeEnabled({ timeout: 60000 });
    await expect
        .poll(() => storedIds(page), { timeout: 30000 })
        .toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);

    // ⚠️ INSTRUMENT, measured: the notice of the download that just succeeded sits at the bottom
    // of the viewport, over the window's own stop button, for its four seconds — and a click on
    // a covered button is not what this spec is about. It goes BEFORE the page is held, since
    // the worker bounds a held request at 10 s.
    await expect(page.locator("#gl-notifications .gl-toast")).toHaveCount(0, { timeout: 20000 });

    // --- the server drops two entities: a COMPLETE pull would remove them from the device ----
    source.rows.delete(7);
    source.rows.delete(8);
    const held = source.hold(PAGE_SIZE);

    await downloadWithProfileZone(page);

    // --- the witness: the pull is walking, and the worker is the one asking ------------------
    await held.reachedAt;
    expect(
        await page.evaluate(() => !!navigator.serviceWorker.controller),
        "le worker ne contrôle pas la page : la route de contexte n'est pas éprouvée"
    ).toBe(true);
    const toastsBefore =
        (await page.evaluate(() => /** @type {any} */ (window).__glToasts.length)) ?? 0;

    // --- the subject, first half: the confirmation is REACHABLE with the mouse ---------------
    await page.locator("#gl-cache-stop").click();
    const confirm = page.locator(".gl-form-modal-confirm");
    await expect(confirm).toBeVisible({ timeout: 5000 });
    // 🛑 Not `force`, and not the keyboard: a click is what a defect of stacking stops. Under
    // the window, this one times out on the covering element.
    await confirm.locator(".gl-form-modal__btn-delete").click({ timeout: 10000 });

    const askedAtStop = source.asked.length;
    held.release();

    // The gesture is over when the button comes back.
    await expect(page.locator("#gl-cache-download")).toBeEnabled({ timeout: 60000 });

    // --- the subject, second half ------------------------------------------------------------
    // Soft, so a red run on a bundle that predates the fix names EVERY link that is missing.
    expect
        .soft(
            source.asked.slice(askedAtStop).map((a) => a.offset),
            "la source a été redemandée après l'arrêt"
        )
        .toEqual([]);
    expect
        .soft(await storedIds(page), "un rapatriement arrêté a retiré des entités")
        .toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    const toasts = await page.evaluate(() => /** @type {any} */ (window).__glToasts.slice(0));
    expect
        .soft(
            toasts.slice(toastsBefore).filter((t) => t.includes("gl-toast--success")),
            "un téléchargement arrêté s'est annoncé réussi"
        )
        .toEqual([]);
    const state = await readRecord(page, {
        db: GEOLEAF_DB,
        store: "preferences",
        key: "offline.pullState",
    });
    expect
        .soft(state?.value?.sites_rosario?.outcome, "le rapatriement arrêté se dit complet")
        .toBe("partial");
});
