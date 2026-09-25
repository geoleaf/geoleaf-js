// @ts-check
// A host embedding the map chooses its language, and the page's `<html lang>` stays the host's —
// measured on the delivered bundle, from the first byte of the page to the end of the boot.
//
// 🛑 THE DEFECT. A module-level label in the Rollup chunk `ui-controls` (the layer manager's
// default title) resolved the language when the chunk was IMPORTED. That froze the title in the
// default language, and it published `<html lang>` before any host could say
// `ui.syncDocumentLang: false`. A host embedding the map in its own page saw its page's locale
// rewritten, whatever it configured. Seen red on the bundle built before the fix: the trap below
// recorded one write, `fr`, before `geoleaf:profile:loaded`.
//
// ⚠️ WHERE THE HOST SPEAKS, AND WHY NOT BEFORE `boot()`. The boot loads the active profile, which
// REPLACES each top-level section it declares, `ui` among them. `tourism` declares
// `ui.language: "fr"`, like the embedding host whose report opened this spec. A `Config.set` made
// before `boot()` would therefore be overwritten, by design. The documented window is
// `beforeBoot`: the profile has loaded, and no module has read the configuration yet. The spec
// injects the host's two calls there, at the head of the app's own hook.
//
// The CONTROL case, without injection, is the standalone application. It writes `<html lang>`
// exactly once, `fr`, and only after the profile has loaded — so from the boot, never from an
// import. `25-language-switcher` asserts no attribute at all, hence this case.

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

/** The head of the application's `beforeBoot` hook in `init.js` — where the host speaks. */
const HOOK_ANCHOR = "beforeBoot: async ({ config }) => {";
const WAIT_MS = 30_000;

/** Labels resolved when their controls are built, per language — core and geocoding plugin. */
const LABELS = {
    fr: { toolbar: "Outils carte", fullscreen: "Plein écran", search: "Rechercher une adresse…" },
    en: { toolbar: "Map tools", fullscreen: "Fullscreen", search: "Search for an address…" },
    es: {
        toolbar: "Herramientas del mapa",
        fullscreen: "Pantalla completa",
        search: "Buscar una dirección…",
    },
};

/**
 * Records, from before any page script runs, every write of `<html lang>` and of the `gl-lang`
 * preference. Each lang write carries whether `geoleaf:profile:loaded` had fired: a write from
 * the boot comes after it, a write from an import cannot.
 */
function trapPageWrites() {
    const w = /** @type {any} */ (window);
    w.__glLangWrites = [];
    w.__glStoredLangWrites = [];
    w.__glProfileLoaded = false;
    document.addEventListener("geoleaf:profile:loaded", () => (w.__glProfileLoaded = true));
    const record = (/** @type {unknown} */ value) =>
        w.__glLangWrites.push({ value: String(value), afterProfile: w.__glProfileLoaded });

    const langDesc = /** @type {PropertyDescriptor} */ (
        Object.getOwnPropertyDescriptor(HTMLElement.prototype, "lang")
    );
    Object.defineProperty(HTMLElement.prototype, "lang", {
        ...langDesc,
        set(value) {
            if (this === document.documentElement) record(value);
            langDesc.set?.call(this, value);
        },
    });
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        if (this === document.documentElement && String(name).toLowerCase() === "lang") {
            record(value);
        }
        return setAttribute.call(this, name, value);
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
        if (key === "gl-lang") w.__glStoredLangWrites.push(value);
        return setItem.call(this, key, value);
    };
}

/**
 * Makes the application's `init.js` speak as the host: at the head of its `beforeBoot`, the
 * interface language and the opt-out of `<html lang>`.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} lang
 * @returns {Promise<() => boolean>} whether the rewrite reached the page
 */
async function actAsHost(context, lang) {
    let injected = false;
    await context.route(/\/init\.js(\?.*)?$/, async (route) => {
        const source = await (await route.fetch()).text();
        if (!source.includes(HOOK_ANCHOR)) {
            throw new Error(`init.js ne porte plus « ${HOOK_ANCHOR} » : la spec ne mord plus`);
        }
        const host =
            `GeoLeaf.Config.set("ui.language", ${JSON.stringify(lang)}); ` +
            `GeoLeaf.Config.set("ui.syncDocumentLang", false);`;
        injected = true;
        await route.fulfill({
            body: source.replace(HOOK_ANCHOR, `${HOOK_ANCHOR} ${host}`),
            contentType: "text/javascript",
        });
    });
    return () => injected;
}

/**
 * Loads the page and waits for the three controls whose labels are checked.
 *
 * @param {import('@playwright/test').Page} page
 */
async function loadMap(page) {
    await page.addInitScript(trapPageWrites);
    await page.goto("/");
    await expect(page.locator(".gl-map-toolbar")).toBeAttached({ timeout: WAIT_MS });
    await expect(page.locator('.gl-geocoding-ctrl input[role="combobox"]')).toBeAttached({
        timeout: WAIT_MS,
    });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ toolbar: string, fullscreen: string, search: string }} labels
 */
async function expectLabels(page, labels) {
    await expect(page.locator(".gl-map-toolbar")).toHaveAttribute("aria-label", labels.toolbar);
    await expect(
        page.locator('.gl-map-toolbar [data-gl-toolbar-action="fullscreen"]').first()
    ).toHaveAttribute("aria-label", labels.fullscreen);
    await expect(page.locator('.gl-geocoding-ctrl input[role="combobox"]')).toHaveAttribute(
        "placeholder",
        labels.search
    );
}

/** @param {import('@playwright/test').Page} page */
function pageWrites(page) {
    return page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return {
            lang: /** @type {{ value: string, afterProfile: boolean }[]} */ (w.__glLangWrites),
            stored: /** @type {string[]} */ (w.__glStoredLangWrites),
            htmlLang: document.documentElement.lang,
        };
    });
}

test.describe("62 — la langue de l'hôte, posée dans beforeBoot, et <html lang> intact", () => {
    for (const lang of /** @type {const} */ (["en", "es"])) {
        test(`hôte en « ${lang} » : libellés dans sa langue, aucune écriture de la page`, async ({
            page,
            context,
        }) => {
            const reached = await actAsHost(context, lang);
            await loadMap(page);
            expect(reached(), "init.js n'a pas été réécrit : la spec ne mord plus").toBe(true);

            await expectLabels(page, LABELS[lang]);

            const writes = await pageWrites(page);
            expect(writes.lang, "écritures de <html lang>").toEqual([]);
            expect(writes.htmlLang).toBe("fr"); // the delivered index.html's own value, untouched
            expect(writes.stored, "écritures de gl-lang").toEqual([]);
        });
    }

    test("témoin sans hôte : une écriture, « fr », venue du boot", async ({ page }) => {
        await loadMap(page);
        await expectLabels(page, LABELS.fr);

        const writes = await pageWrites(page);
        expect(writes.lang).toEqual([{ value: "fr", afterProfile: true }]);
        expect(writes.stored, "écritures de gl-lang").toEqual([]);
    });
});
