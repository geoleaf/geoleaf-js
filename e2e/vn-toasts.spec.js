// @ts-check
// BROWSER VERIFICATION — toast family. Scenarios C.4, C.5, D.3, D.4 of the
// internal browser-verification table.
//
// These four scenarios are in the table because `happy-dom` can decide none of
// them: it computes neither the effective CSS cascade (C.4, C.5), nor the exit
// animations (D.3), and it does not see a real map lifecycle (D.4).
//
// ⚠️ Each test carries its COUNTER-PROOF at its head: it is what says why the
// test exists and what to look at the day it reddens. All four are 🔴 —
// regressions that ALREADY happened in production, hence non-regression tests
// in the proper sense.
//
// DOM contract really emitted (code inspection, not docs):
//   - container → `#gl-notifications`            (renderer/notifications.ts)
//   - toast     → `.gl-toast` + `.gl-toast--{type}` (info|success|warning|error)
//   - exit      → `.gl-toast--removing`          (excluded from the visible count)
// API: `GeoLeaf.notify(msg, type)` (kernel primitive) and
// `GeoLeaf.Notifications.*` (rich facade, mounted by
// capabilities/toast-renderer/install.ts).

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { bootMap, waitMapLoaded, captureConsole } from "./helpers/boot.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

/** Toasts present and NOT on their way out — the count `maxVisible` bounds. */
const VISIBLE = ".gl-toast:not(.gl-toast--removing)";

/** The 4 types and the colour their CSS rule imposes on the border (notifications.css). */
const TYPES = [
    { type: "success", rgb: "rgb(16, 185, 129)" }, // #10b981
    { type: "error", rgb: "rgb(239, 68, 68)" }, //    #ef4444
    { type: "warning", rgb: "rgb(245, 158, 11)" }, // #f59e0b
    { type: "info", rgb: "rgb(59, 130, 246)" }, //    #3b82f6
];

test.describe("VN — toasts (C.4, C.5, D.3, D.4)", () => {
    test.beforeEach(async ({ page }) => {
        // Capture of a BEFORE state: `geoleaf:app:ready` fires DURING the boot,
        // so a subscription set after `goto` would miss it. `addInitScript` runs
        // before any script of the document, the only position from which the
        // event is observable. The flag serves C.5 (see its comment): it is the
        // only milestone after the boot's last `applyTheme()`, which rewrites
        // the `<body>`'s theme classes.
        await page.addInitScript(() => {
            document.addEventListener(
                "geoleaf:app:ready",
                () => {
                    /** @type {any} */ (window).__glAppReady = true;
                },
                { once: true }
            );
        });
        await page.goto("/");
        await bootMap(page);
    });

    // ── C.4 🔴 ────────────────────────────────────────────────────────────────────────
    // Counter-proof: the base rule was written
    // `border-left: 4px solid var(--gl-accent)`, and `--gl-accent` IS DEFINED
    // NOWHERE (the real token is `--gl-color-accent`). A nonexistent variable
    // makes the SHORTHAND declaration invalid at evaluation: `border-left-style`
    // fell back to `none`, which ALSO neutralised the `border-left-color` of the
    // 4 per-type rules. The toasts' colour coding thus NEVER displayed anything.
    // That is why the test asserts the `style` and the `width` as much as the
    // colour: a correct colour on a `none` border is exactly the original bug.
    test("C.4 — les 4 types de toast portent un liséré coloré effectivement peint", async ({
        page,
    }) => {
        for (const { type, rgb } of TYPES) {
            await page.evaluate(([t]) => window.GeoLeaf.notify(`vn-c4-${t}`, t), [type]);

            const toast = page.locator(`.gl-toast--${type}`).first();
            await expect(toast, `aucun toast rendu pour le type "${type}"`).toBeVisible({
                timeout: 5000,
            });

            const border = await toast.evaluate((el) => {
                const cs = getComputedStyle(el);
                return {
                    style: cs.borderLeftStyle,
                    width: cs.borderLeftWidth,
                    color: cs.borderLeftColor,
                };
            });

            // `none` ⇒ the token is undefined again: the border does not exist,
            // whatever the computed colour. THE original symptom.
            expect(border.style, `${type} : liséré non peint (jeton CSS indéfini ?)`).toBe("solid");
            expect(border.width, `${type} : liséré d'épaisseur nulle`).toBe("4px");
            expect(border.color, `${type} : mauvaise couleur de liséré`).toBe(rgb);

            await page.evaluate(() => window.GeoLeaf.Notifications.clearAll());
        }
    });

    // ── C.5 🟠 ────────────────────────────────────────────────────────────────────────
    // Counter-proof: an EQUAL-specificity duplicate (`body.gl-theme-dark
    // .gl-toast`, 0-2-1, duplicated) imposed a fixed grey on the toasts'
    // background, which thus stopped following the theme variables. No
    // hard-coded colour is asserted — it belongs to the theme — but the fact
    // that the background DIFFERS between the two themes: exactly what a fixed
    // grey made impossible.
    // ⚠️ The dark theme is driven by the CLASS `body.gl-theme-dark`
    // (notifications.css), NOT by `prefers-color-scheme`:
    // `emulateMedia` flips nothing here.
    test("C.5 — le fond des toasts suit le thème (clair ≠ sombre)", async ({ page }) => {
        // ⚠️ RACE (MapLibre 6.2.0) — the `beforeEach`'s `bootMap()` is a PROXY:
        // it hands back as soon as the native map carries a style, i.e. at the
        // registry's `core-map` module. The boot's theme applier lives TWO
        // modules further — `UIModule` #12 → `UI.init()` → `_initThemeControl()`
        // → `_UITheme.applyTheme()` — and `UIModule` declares
        // `dependencies = ["config","core-map","shared","geojson"]`, so it waits
        // for the layers to load. This whole test executed in that interval.
        // Yet `applyTheme()` STARTS with `body.classList.remove("gl-theme-light",
        // "gl-theme-dark")` (kernel/ui/theme.ts). If it lands between the
        // `toggle()` below and the background read, it ERASES the class the test
        // just set: the dark pass reads as light, the two measurements become
        // equal, and the test reddens on "the background does not change with
        // the theme" blaming a fixed grey that does not exist. The shipped
        // `<body>` starts `gl-theme-dark` (`deploy/*/index.html`), so the boot
        // ALWAYS rewrites that class: the window is structural, v6 only moved it
        // into ours by serialising two more module requests.
        // 🛑 A FIRST DRAFT OF THIS LOCK WAITED ON `#geoleaf-map.gl-theme-*`, AND
        // IT LOCKED NOTHING — adversarial re-read, then verified in the code:
        //   · `kernel/map/facade.ts` calls `applyThemeSafe()` at map
        //     CREATION, hence at the `core-map` module, TWO modules before the
        //     writer it claimed to wait for. The marker is already set when
        //     `bootMap()` hands back: the wait lasted ~0 ms.
        //   · and it is not latched: `kernel/ui/ui-api.ts` call
        //     `applyTheme` again via `initAutoTheme` then `initThemeToggle`,
        //     each starting with a
        //     `classList.remove("gl-theme-light","gl-theme-dark")` (theme.ts).
        //     The class is thus REWRITTEN afterwards — exactly the race to
        //     close.
        // A lock that waits zero milliseconds is worse than none: it makes the
        // race look closed, and the failure rate drops just enough to wrongly
        // confirm it.
        //
        // The only milestone AFTER the boot's last `applyTheme` is
        // `geoleaf:app:ready`: `setupReveal()` is called at line 149 of
        // `app/boot-modules/ui.module.ts`, after `initUIPanels` (l.113) and
        // after the `UI.init()` → `_initThemeControl()` that applies the theme
        // (l.67, l.77), and `app/init-reveal.ts` is its sole emitter.
        // ⚠️ Captured through `addInitScript` — hence BEFORE any page script: the
        // event fires during the boot, subscribing after `goto` would miss it.
        // It is a BEFORE state, it cannot be observed after the fact.
        await page.waitForFunction(() => window.__glAppReady === true, null, { timeout: 25000 });

        const bgFor = async (dark) => {
            // Distinct message per pass: the measured toast is identified by ITS
            // text, no longer by `.first()`. The boot emits its own toasts AFTER
            // `bootMap()` — the loading one on `geoleaf:theme:applying`
            // (persistent, dispatched by `ThemeEngineModule`, which runs after
            // `UIModule`) and the profile one on `geoleaf:profile:loaded` — and
            // `.first()` takes the container's OLDEST. So it is potentially a
            // toast born BEFORE the theme flip: its background is then mid
            // `all .3s` transition (toast-renderer.css) and reads at an
            // intermediate value, or even still at the other theme's. A toast
            // created AFTER the flip is born at its final colour — no transition
            // runs on the first style computation of a freshly inserted
            // element.
            const msg = dark ? "vn-c5-sombre" : "vn-c5-clair";
            await page.evaluate(
                ({ isDark, m }) => {
                    // Purge first: `clearAll()` sets `--removing`, which
                    // immediately frees the `maxVisible` budget — it counts on
                    // `.gl-toast:not(.gl-toast--removing)`
                    // (notifications.ts). Without it, boot toasts still
                    // on screen can get the one we want to measure QUEUED, never
                    // to display.
                    window.GeoLeaf.Notifications.clearAll();
                    document.body.classList.toggle("gl-theme-dark", isDark);
                    // Emitted in the SAME task as the flip: nothing can slot in
                    // between the class and the creation of the toast measuring
                    // it.
                    window.GeoLeaf.notify(m, "info");
                },
                { isDark: dark, m: msg }
            );
            const toast = page.locator(VISIBLE).filter({ hasText: msg }).first();
            await expect(toast).toBeVisible({ timeout: 5000 });
            const bg = await toast.evaluate((el) => getComputedStyle(el).backgroundColor);
            await page.evaluate(() => window.GeoLeaf.Notifications.clearAll());
            return bg;
        };

        const light = await bgFor(false);
        const dark = await bgFor(true);

        expect(light, "fond de toast transparent en thème clair").not.toBe("rgba(0, 0, 0, 0)");
        expect(dark, "fond de toast transparent en thème sombre").not.toBe("rgba(0, 0, 0, 0)");
        expect(dark, "le fond ne change pas avec le thème (gris fixe ?)").not.toBe(light);
    });

    // ── D.3 🔴 ────────────────────────────────────────────────────────────────────────
    // Counter-proof: a burst beyond the budget displayed MORE toasts than
    // `maxVisible` — 4 measured for a budget of 2. The invariant tested here is
    // the budget itself, at the profile default (`DEFAULT_MAX_VISIBLE = 3`,
    // constants.ts): a burst of 8 errors must never leave more than 3
    // non-exiting toasts on screen.
    // The budget is read from the page, not hard-coded here: a test that copies
    // the constant it verifies only verifies itself.
    test("D.3 — une rafale d'erreurs ne dépasse jamais maxVisible", async ({ page }) => {
        const status = await page.evaluate(() => window.GeoLeaf.Notifications.getStatus());

        // ⚠️ `maxVisible` DOES NOT SUFFICE as a guard, proven by the failure: it
        // is `DEFAULT_MAX_VISIBLE` (3) from module evaluation
        // (notifications.ts), hence ALSO on a never-mounted renderer. The
        // only field distinguishing a live renderer from an inert one is
        // `initialized` (= `!!this.container`). Without it, the burst below went
        // to the console fallback and the test yielded `shown = 0` unable to say
        // why — exactly what made a boot-sequence defect pass for a renderer
        // mystery.
        expect(status.initialized, "renderer de toasts NON monté (#gl-notifications absent)").toBe(
            true
        );
        const budget = status.maxVisible;
        expect(budget, "maxVisible illisible depuis la façade").toBeGreaterThan(0);

        await page.evaluate(() => {
            for (let i = 0; i < 8; i++) window.GeoLeaf.notify(`vn-d3-${i}`, "error");
        });

        // The peak is measured after the entry animations settle: counting too
        // early would let a transient overshoot through, which is exactly the
        // original defect.
        await page.waitForTimeout(1200);
        const shown = await page.locator(VISIBLE).count();

        expect(shown, `${shown} toasts affichés pour un budget de ${budget}`).toBeLessThanOrEqual(
            budget
        );
        expect(shown, "la rafale n'a rien affiché du tout").toBeGreaterThan(0);
    });

    // ── D.4 🔴 ────────────────────────────────────────────────────────────────────────
    // Counter-proof: after a `destroy()` (an SPA host unmounting then remounting
    // the map), notifications were LOST — not merely undisplayed: the console
    // fallback did not fire either, so the message vanished IN SILENCE. That
    // silence is what the fix targeted, and it is what this test guards.
    //
    // ⚠️ The browser pass measured the fix's exact boundary, and it is not where
    // the table placed it. Two cases, two behaviours:
    //   · a toast was emitted BEFORE the cycle → the container survives → the
    //     toast re-displays;
    //   · no toast before the cycle (pure SPA case: mount, unmount, remount) →
    //     the container is not recreated, `notify()` returns `undefined` and
    //     the message goes to the console fallback.
    // ⚠️ Corrected on 2026-07-28: these lines said the container is created
    // "LAZILY at the first `notify()`". FALSE, and that premise masked D.3's
    // mechanism through the whole diagnosis. The sole creator of
    // `#gl-notifications` is `capabilities/toast-renderer/lifecycle.ts`
    // (`init()`), called once by the registry; `destroy()` removes it and
    // nothing remounts it afterwards.
    // This test thus asserts the contract really held — **nothing is lost** —
    // and the `D.4b` test below carries the stronger observable the table
    // asked, left open.
    test("D.4 — une notification émise après destroy → recreate n'est jamais perdue", async ({
        page,
    }) => {
        // Wait for the map LOADED, not merely styled: destroying too early would
        // measure an initialisation race, not the SPA scenario D.4 describes.
        await waitMapLoaded(page);
        const console_ = captureConsole(page);

        const state = await page.evaluate(() => {
            const api = window.GeoLeaf.Core.getMap();
            const native = api.getNativeMap();
            const c = native.getCenter();
            return {
                id: window.GeoLeaf.Core.listMaps()[0],
                center: [c.lng, c.lat],
                zoom: native.getZoom(),
            };
        });

        await page.evaluate((id) => window.GeoLeaf.Core.destroy(id), state.id);
        const recreated = await page.evaluate(
            (s) => !!window.GeoLeaf.Core.init({ mapId: s.id, center: s.center, zoom: s.zoom }),
            state
        );
        expect(recreated, "la carte n'a pas pu être recréée").toBe(true);
        await bootMap(page);

        const MSG = "vn-d4-apres-recreate";
        await page.evaluate((m) => window.GeoLeaf.notify(m, "success"), MSG);

        // The message must land somewhere: on screen, OR in the console. Both
        // channels mute at once is the original defect — a swallowed message.
        await expect
            .poll(
                async () => {
                    const shown = await page.locator(VISIBLE).filter({ hasText: MSG }).count();
                    const logged = console_.all.some((l) => l.includes(MSG));
                    return shown > 0 || logged;
                },
                {
                    timeout: 10000,
                    message:
                        "message avalé : ni toast affiché, ni repli console (défaut B.19/B.27)",
                }
            )
            .toBe(true);

        // ⚠️ NO "0 console errors during the cycle" assertion here, deliberately.
        // Measured at the browser pass: on a SETTLED map the cycle is clean
        // (0 errors, dedicated probe), but if asynchronous work is still IN
        // FLIGHT at `destroy()`, it lands on a vanished adapter and logs —
        // `[Labels] Error preparing labels` (`_ensureZoomListener` → `off()`) or
        // `[GeoJSON] MapLibre adapter not available` (layer load in progress),
        // depending on what lingered. That cleanliness is scenario **D.5**
        // (teardown asymmetries), not D.4; asserting it here would make D.4
        // intermittent for a reason foreign to what it proves — and a blinking
        // suite is exactly what got it suspended on 07-20.
        expect(console_.errors.filter((e) => e.includes(MSG))).toEqual([]);
    });

    // ── D.4b 🔴 — OPEN, measured on 07-24 at the browser pass ────────────────────────
    // The observable the table really asks: "The toast displays; nothing is
    // lost". The second half is held (test D.4 above); the FIRST is not in the
    // pure SPA case. Measurement: fresh page → `destroy()` → `Core.init()` →
    // `notify()` returns `undefined`, `#gl-notifications` stays absent, no
    // toast — only the console fallback speaks. The container is only created at
    // the first `notify()`, and `destroy()` disarms that lazy creation without
    // re-arming it: same family as the four known teardown asymmetries
    // (scenario D.5), on a path they had not covered.
    // `fixme` and not `skip`: this test describes a KNOWN, OPEN defect. Removing
    // it the day the renderer re-arms is the fix's completeness criterion.
    test.fixme("D.4b — le toast se réaffiche après un cycle destroy → recreate à froid", async ({
        page,
    }) => {
        const state = await page.evaluate(() => {
            const native = window.GeoLeaf.Core.getMap().getNativeMap();
            const c = native.getCenter();
            return {
                id: window.GeoLeaf.Core.listMaps()[0],
                center: [c.lng, c.lat],
                zoom: native.getZoom(),
            };
        });

        // No `notify()` before the cycle: the condition distinguishing the two cases.
        await page.evaluate((id) => window.GeoLeaf.Core.destroy(id), state.id);
        await page.evaluate(
            (s) => window.GeoLeaf.Core.init({ mapId: s.id, center: s.center, zoom: s.zoom }),
            state
        );
        await bootMap(page);

        await page.evaluate(() => window.GeoLeaf.notify("vn-d4b-a-froid", "success"));

        const toast = page.locator(VISIBLE).filter({ hasText: "vn-d4b-a-froid" });
        await expect(toast, "le renderer de toasts ne se réarme pas après destroy()").toBeVisible({
            timeout: 10000,
        });
    });
});
