#!/usr/bin/env node
/**
 * PROBE — a toolbar slot is declared on the EAGER path and skipped on the LAZY one.
 *
 * Six `entry.ts` call `registry.register({ id, ui })`. Whether that call is USEFUL or INERT
 * depends entirely on WHO loaded the bundle, and the plugin cannot know:
 *
 *   • EAGER — an integrator loads it with `<script type="module">` before `GeoLeaf.boot()`,
 *     which is what all six published READMEs prescribe. There is no `init.js` on that path, so
 *     the call is the ONLY declaration of the slot, it runs before `init()`, and it draws the
 *     button. Removing it deletes the button for every npm consumer.
 *
 *   • LAZY — the deployable app declares the slot before boot with `registerLazyForAction()`,
 *     then loads the bundle on demand. The call would land after `init()`: stored, never drawn
 *     (`_appendRegistryIcons()` ran once, at boot), and one warning logged per load.
 *
 * The plugins now ask `registry.isInitialized()` and skip the registration on the lazy path.
 *
 * 🛑 WHY THIS FILE EXISTS AT ALL. The unit tests can assert the DECISION (they mock the
 * registry), but not its CONSEQUENCE — that the button is still on screen. The eager path in
 * particular was exercised by nothing in this repository, and that hole is precisely what made
 * simply deleting the call look safe. `geocoding` is the real eager case here: `beforeBoot`
 * preloads it, so its `registry.register()` runs before `init()` and IS its only declaration.
 *
 * ⚠️ Run the four-step regeneration first — this probe grades whatever nginx serves.
 *
 * Usage:  E2E_TARGET=nginx node scripts/probe-slot-timing.mjs
 * Exit:   0 = all assertions passed · 1 = at least one failed
 */

import { chromium } from "@playwright/test";
import { SOFTWARE_GL_ARGS } from "../e2e/helpers/launch-options.js";
import { baseURL } from "../e2e/helpers/base-url.js";

const URL = process.env.GEOLEAF_PROBE_URL || `${baseURL("core")}/`;

/** The warning `module-registry.ts` logs when a module registers after `init()`. */
const LATE_WARNING = /registered AFTER init\(\)/i;

/** Plugins the app loads lazily AND that declare a toolbar slot in their `entry.ts`. */
const LAZY_WITH_SLOT = ["table", "print", "measure", "position-share"];

const results = [];
const check = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !detail ? "" : `\n      → ${detail}`}`);
};

const run = async () => {
    const browser = await chromium.launch({ args: SOFTWARE_GL_ARGS });
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        serviceWorkers: "block",
    });
    const page = await context.newPage();

    const lateWarnings = [];
    page.on("console", (m) => {
        if (LATE_WARNING.test(m.text())) lateWarnings.push(m.text());
    });

    console.log(`\n▸ ${URL}\n`);
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(
        () => {
            const native = /** @type {any} */ (
                globalThis
            ).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            const style = native?.getStyle?.();
            if (!style) return false;
            const layers = (style.layers || []).filter(
                (l) => l.id.startsWith("gl-") && l.id !== "gl-sentinel-poi"
            );
            return layers.length > 0 && !!(style.sources || {})["__geoleaf_basemap__"];
        },
        { timeout: 30000 }
    );

    /** Every toolbar affordance drawn by the core registry, mobile and desktop. */
    const countButtons = () =>
        page.evaluate(() => document.querySelectorAll("[data-gl-toolbar-action]").length);

    const atBoot = await countButtons();
    check(
        "des créneaux de barre d'outils sont dessinés au boot",
        atBoot > 0,
        `${atBoot} bouton(s)`
    );

    // ── EAGER — `geocoding` is preloaded by `beforeBoot`, so it registers BEFORE `init()` ────
    //
    // This is the assertion that would have caught the naive deletion: on this path the call in
    // `entry.ts` is the only declaration, and skipping it would leave the button out.
    const geocodingLoaded = await page.evaluate(
        () => typeof (/** @type {any} */ (globalThis).GeoLeaf?.Geocoding) === "object"
    );
    check("geocoding est chargé EAGER (préchargé par beforeBoot)", geocodingLoaded);

    const geocodingButton = await page.evaluate(
        () => document.querySelectorAll('[data-gl-toolbar-action="geocoding"]').length
    );
    check(
        "son créneau EST dessiné — la déclaration d'`entry.ts` a été honorée",
        geocodingButton > 0,
        `${geocodingButton} bouton(s) geocoding`
    );

    check(
        "aucun avertissement de retard au boot",
        lateWarnings.length === 0,
        lateWarnings.slice(0, 2).join(" | ")
    );

    // ── LAZY — load each slot-bearing plugin by hand, after `init()` ─────────────────────────

    for (const id of LAZY_WITH_SLOT) {
        lateWarnings.length = 0;
        const before = await countButtons();
        await page.evaluate(
            async (name) => await /** @type {any} */ (globalThis).GeoLeaf.plugins.load(name),
            id
        );
        await page.waitForTimeout(150);
        const after = await countButtons();

        check(
            `${id} : chargement paresseux SANS avertissement de retard`,
            lateWarnings.length === 0,
            lateWarnings.slice(0, 1).join(" | ")
        );
        check(
            `${id} : le nombre de créneaux dessinés est inchangé`,
            after === before,
            `${before} → ${after}`
        );
    }

    await browser.close();

    const failed = results.filter((r) => !r.ok);
    console.log(
        `\n${failed.length === 0 ? "✅" : "❌"} ${results.length - failed.length}/${results.length} assertions\n`
    );
    return failed.length === 0 ? 0 : 1;
};

run().then(
    (code) => process.exit(code),
    (err) => {
        console.error("\n❌ Sonde en erreur :", err?.message || err);
        process.exit(1);
    }
);
