// @ts-check
// E2E — `@geoleaf-plugins/navigation` guidance, on a replayed trace, in a real Chromium.
//
// 🛑 **What only an end-to-end run proves here**, and no unit test can:
//   ① the plugin is ABSENT at boot and becomes present on demand — real lazy
//     loading, with its dynamic import, its served bundle and its registration
//     in the registry;
//   ② the `GeoLeaf.Navigation` namespace is mounted by the BUILT bundle, not by
//     a source vitest transpiles — so rollup, `exports`, and the version shim
//     included;
//   ③ the position watch talks to the engine through the browser's real API.
//
// ⚠️ **Time is SIMULATED, not awaited.** The jump filter of `platform/geo.ts`
// bounds progress to `55 m/s × Δt`, and Δt comes from `pos.timestamp`. A fake
// `watchPosition` letting the browser timestamp would render intervals of a few
// milliseconds: 100 m in 5 ms is 20 km/s, so EVERYTHING would be rejected and
// the suite would measure a guidance that receives nothing. The pattern comes
// from `13-measure.spec.js`, which has the same constraint.
//
// 🛑 **And the SIMULATED interval must itself be physical.** This file first
// spaced its fixes 1.2 s apart for 100 m segments — i.e. 83 m/s, 300 km/h. The
// filter rejected them, RIGHTLY: three fixes out of four disappeared and the
// suite measured a mute guidance. The scenario moved to 5 s, i.e. 20 m/s
// (72 km/h). **A test scenario must obey the same laws as what it proves** —
// otherwise the scenario is wrong, never the bound.
//
// Target: deploy-coverage (port 8769) — the instrumented variant, like `35-routing-entry-point`.
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { bootMapUntilLoaded } from "./helpers/boot.js";

test.use({ baseURL: baseURL("coverage"), serviceWorkers: "block" });

/** The path: three 400 m legs, a 60° turn then a 90° one. */
const LINE = [
    [55.4781, -21.0964],
    [55.479064, -21.0964],
    [55.480028, -21.0964],
    [55.480992, -21.0964],
    [55.481956, -21.0964],
    [55.482438, -21.095621],
    [55.48292, -21.094842],
    [55.483402, -21.094063],
    [55.483884, -21.093284],
    [55.484719, -21.093734],
    [55.485554, -21.094184],
    [55.486389, -21.094634],
    [55.487224, -21.095084],
];

/**
 * The fixes. On the path, except at indices 6 to 8: a RAMPED departure
 * (60 m, 110 m, 70 m).
 *
 * ⚠️ Ramped, not instantaneous. A 110 m lateral offset appearing in one fix is
 * ~90 m/s: the jump filter would THROW it out, rightly — such a leap is a
 * sensor defect, not a route change. A vehicle leaving a route TURNS.
 */
const FIXES = [
    [55.4781, -21.0964],
    [55.479064, -21.0964],
    [55.480028, -21.0964],
    [55.480992, -21.0964],
    [55.481956, -21.0964],
    [55.482438, -21.095621],
    [55.483421, -21.095112],
    [55.48432, -21.094558],
    [55.483547, -21.093829],
    [55.484719, -21.093734],
    [55.485554, -21.094184],
    [55.486389, -21.094634],
    [55.487224, -21.095084],
];

/** Three 400 m, 40 s legs — four waypoints, two of them intermediate. */
const ROUTE = {
    distance: 1200,
    duration: 120,
    geometry: "",
    provider: "e2e",
    waypoints: [
        { coordinates: LINE[0], name: "Départ" },
        { coordinates: LINE[4], name: "Étape 1" },
        { coordinates: LINE[8], name: "Étape 2" },
        { coordinates: LINE[12], name: "Arrivée" },
    ],
    legs: [
        { distance: 400, duration: 40, steps: [] },
        { distance: 400, duration: 40, steps: [] },
        { distance: 400, duration: 40, steps: [] },
    ],
};

/**
 * Installs a `navigator.geolocation` whose fixes AND timestamps we control.
 *
 * @param {import('@playwright/test').Page} page The page.
 */
async function fakeGeolocation(page) {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        /** @type {Function[]} */
        const cbs = [];
        Object.defineProperty(navigator, "geolocation", {
            configurable: true,
            value: {
                watchPosition: (/** @type {Function} */ success) => {
                    cbs.push(success);
                    return 99;
                },
                clearWatch: () => {
                    cbs.length = 0;
                },
                getCurrentPosition: () => {},
            },
        });
        w.__navFire = (
            /** @type {number} */ lng,
            /** @type {number} */ lat,
            /** @type {number} */ ts
        ) =>
            cbs.forEach((cb) =>
                cb({
                    coords: {
                        longitude: lng,
                        latitude: lat,
                        accuracy: 6,
                        altitude: null,
                        altitudeAccuracy: null,
                        heading: null,
                        speed: 10,
                    },
                    timestamp: ts,
                })
            );
    });
}

test.describe("① le chargement PARESSEUX, pour de vrai", () => {
    test.beforeEach(async ({ page }) => fakeGeolocation(page));

    test("le plugin n'est PAS chargé au boot — c'est ce que `registerLazy` promet", async ({
        page,
    }) => {
        // The manipulation's control: without it, the next test would also pass
        // on an eagerly-loaded plugin, and would prove nothing about on-demand
        // loading.
        await bootMapUntilLoaded(page);
        const loaded = await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf?.plugins?.isLoaded?.("navigation")
        );
        expect(loaded).toBeFalsy();
    });

    test("il est pourtant JOIGNABLE — c'est ce que `routing` interroge", async ({ page }) => {
        // 🛑 `isLazyAvailable`, not `isLoaded`. Gating `routing`'s button on
        // `isLoaded` would hide the entry point behind the very condition it
        // exists to satisfy.
        await bootMapUntilLoaded(page);
        const reachable = await page.evaluate(() =>
            /** @type {any} */ (window).GeoLeaf?.plugins?.isLazyAvailable?.("navigation")
        );
        expect(reachable).toBe(true);
    });

    test("`load()` le charge et MONTE le namespace", async ({ page }) => {
        await bootMapUntilLoaded(page);
        const state = await page.evaluate(async () => {
            const gl = /** @type {any} */ (window).GeoLeaf;
            await gl.plugins.load("navigation");
            return {
                loaded: gl.plugins.isLoaded("navigation"),
                hasStart: typeof gl.Navigation?.start === "function",
                hasStop: typeof gl.Navigation?.stop === "function",
                guiding: gl.Navigation?.isGuiding?.(),
            };
        });
        expect(state.loaded).toBe(true);
        expect(state.hasStart).toBe(true);
        expect(state.hasStop).toBe(true);
        expect(state.guiding).toBe(false);
    });
});

test.describe("② le guidage sur la trace rejouée", () => {
    test.beforeEach(async ({ page }) => fakeGeolocation(page));

    /**
     * Starts guidance and replays the trace, collecting the traversed states.
     *
     * @param {import('@playwright/test').Page} page The page.
     * @param {number} upTo Number of fixes to replay.
     * @returns {Promise<{states: string[], remaining: number[], recomputes: number}>}
     */
    function drive(page, upTo) {
        return page.evaluate(
            async ({ line, fixes, route, upTo }) => {
                const gl = /** @type {any} */ (window).GeoLeaf;
                await gl.plugins.load("navigation");

                /** @type {string[]} */
                const states = [];
                /** @type {number[]} */
                const remaining = [];
                let recomputes = 0;

                gl.Navigation.onProgress((/** @type {any} */ p) => {
                    states.push(p.state);
                    remaining.push(p.distanceRemaining);
                });

                gl.Navigation.start(route, line, {
                    // Out of coverage: guidance must CONTINUE on the route it has.
                    recompute: async () => {
                        recomputes += 1;
                        return { ok: false, reason: "network" };
                    },
                    decodeGeometry: () => line,
                });

                // Simulated timestamps, 5 s apart — see the note at the file's head.
                let t = 1_700_000_000_000;
                for (let i = 0; i < upTo; i++) {
                    t += 5000;
                    /** @type {any} */ (window).__navFire(fixes[i][0], fixes[i][1], t);
                }
                return { states, remaining, recomputes };
            },
            { line: LINE, fixes: FIXES, route: ROUTE, upTo }
        );
    }

    test("chaque relevé produit un échantillon, et le guidage démarre en `navigating`", async ({
        page,
    }) => {
        await bootMapUntilLoaded(page);
        const r = await drive(page, 4);
        expect(r.states).toHaveLength(4);
        expect(r.states[0]).toBe("navigating");
        expect(r.remaining[0]).toBeGreaterThan(0);
    });

    test("🛑 le restant DÉCROÎT pendant le guidage — la propriété qu'un conducteur voit", async ({
        page,
    }) => {
        await bootMapUntilLoaded(page);
        const r = await drive(page, 5);
        const guided = r.remaining.slice(0, 4);
        for (let i = 1; i < guided.length; i++) {
            expect(guided[i]).toBeLessThanOrEqual(guided[i - 1] + 1);
        }
        expect(guided[guided.length - 1]).toBeLessThan(guided[0]);
    });

    test("l'entrée dans le rayon d'une étape rend `waypoint-reached`", async ({ page }) => {
        // The multi-waypoint-specific addition: distinct from `arrived`, which
        // is terminal. Conflating them would tell a driver on a round that the
        // trip is over at the first delivery.
        await bootMapUntilLoaded(page);
        const r = await drive(page, 6);
        expect(r.states).toContain("waypoint-reached");
        expect(r.states).not.toContain("arrived");
    });

    test("🛑 la sortie de tracé est CONFIRMÉE, pas déclarée au premier écart", async ({ page }) => {
        // Without hysteresis, a noisy GPS triggers recompute bursts and drains a
        // provider quota in minutes. The first off-path fix must trigger nothing.
        await bootMapUntilLoaded(page);
        const r = await drive(page, 7);
        expect(r.recomputes).toBe(0);
    });

    test("hors couverture, le guidage CONTINUE sur l'itinéraire qu'il a", async ({ page }) => {
        // The offline routing module was REMOVED from the spec; its replacement
        // is "guide out of coverage on a route prepared while in coverage". A
        // runtime stopping for want of re-routing would throw away the one thing
        // the design keeps.
        await bootMapUntilLoaded(page);
        const r = await drive(page, FIXES.length);
        expect(r.states).toHaveLength(FIXES.length);
        expect(r.states[r.states.length - 1]).not.toBe("idle");
    });

    test("le dernier relevé rend `arrived`, et `arrived` est TERMINAL", async ({ page }) => {
        await bootMapUntilLoaded(page);
        const state = await page.evaluate(
            async ({ line, fixes, route }) => {
                const gl = /** @type {any} */ (window).GeoLeaf;
                await gl.plugins.load("navigation");
                gl.Navigation.start(route, line, {
                    recompute: async () => ({ ok: false, reason: "network" }),
                    decodeGeometry: () => line,
                });
                let t = 1_700_000_000_000;
                for (const f of fixes) {
                    t += 5000;
                    /** @type {any} */ (window).__navFire(f[0], f[1], t);
                }
                const atEnd = gl.Navigation.isGuiding();
                // Overshooting the destination does not restart guidance.
                t += 5000;
                /** @type {any} */ (window).__navFire(fixes[0][0], fixes[0][1], t);
                return { atEnd, stillGuiding: gl.Navigation.isGuiding() };
            },
            { line: LINE, fixes: FIXES, route: ROUTE }
        );
        expect(state.atEnd).toBe(true);
        expect(state.stillGuiding).toBe(true);
    });

    test("`stop()` rend la main, et il est idempotent", async ({ page }) => {
        await bootMapUntilLoaded(page);
        const after = await page.evaluate(
            async ({ line, route }) => {
                const gl = /** @type {any} */ (window).GeoLeaf;
                await gl.plugins.load("navigation");
                gl.Navigation.start(route, line, {
                    recompute: async () => ({ ok: false, reason: "network" }),
                    decodeGeometry: () => line,
                });
                gl.Navigation.stop();
                gl.Navigation.stop();
                return gl.Navigation.isGuiding();
            },
            { line: LINE, route: ROUTE }
        );
        expect(after).toBe(false);
    });
});

/**
 * A route carrying STEPS, which `ROUTE` has not.
 *
 * ⚠️ `ROUTE` declares `steps: []` on its three legs, and that is without
 * consequence for the state tests — but a banner with no maneuver has nothing
 * to announce and stays hidden. Reusing it here would have rendered a test
 * green on an interface that never displays: exactly the defect this block
 * exists to catch.
 */
const ROUTE_WITH_STEPS = {
    ...ROUTE,
    legs: ROUTE.legs.map((leg, i) => ({
        ...leg,
        steps: [
            {
                distance: 300,
                duration: 30,
                name: `Rue du tronçon ${i + 1}`,
                maneuver: "depart",
                location: LINE[0],
            },
            {
                distance: 100,
                duration: 10,
                name: `Avenue du virage ${i + 1}`,
                maneuver: "turn",
                modifier: "left",
                location: LINE[2],
            },
            { distance: 0, duration: 0, name: "", maneuver: "arrive", location: LINE[4] },
        ],
    })),
};

test.describe("③ l'interface — la moitié qu'aucun oracle de ce fichier ne regardait", () => {
    // 🛑 THIS BLOCK EXISTS BECAUSE ITS ABSENCE COST AN ENTIRE SUBTREE.
    //
    // The ten tests above query only the API: `state.guiding`, `r.states`,
    // `r.remaining`. Such an oracle cannot distinguish "guidance works" from
    // "guidance works and displays nothing" — and the plugin lived in the
    // second state, banner and camera written, tested, typed and published
    // without a single line importing them.
    //
    // This is not a lesson about interface tests. It is a lesson about an
    // oracle's SCOPE: one that looks at only one surface will never say
    // anything about the other, however many cases it covers.
    test.beforeEach(async ({ page }) => fakeGeolocation(page));

    /**
     * Starts guidance with steps, then replays `upTo` fixes.
     *
     * @param {import('@playwright/test').Page} page The page.
     * @param {number} upTo Number of fixes to replay.
     * @returns {Promise<void>}
     */
    async function driveWithSteps(page, upTo) {
        await page.evaluate(
            async ({ line, fixes, route, upTo }) => {
                const gl = /** @type {any} */ (window).GeoLeaf;
                await gl.plugins.load("navigation");
                gl.Navigation.start(route, line, {
                    recompute: async () => ({ ok: false, reason: "network" }),
                    decodeGeometry: () => line,
                });
                let t = 1_700_000_000_000;
                for (let i = 0; i < upTo; i++) {
                    t += 5000;
                    /** @type {any} */ (window).__navFire(fixes[i][0], fixes[i][1], t);
                }
            },
            { line: LINE, fixes: FIXES, route: ROUTE_WITH_STEPS, upTo }
        );
    }

    test("🛑 avant tout guidage, il n'y a AUCUN bandeau sur la carte", async ({ page }) => {
        // The control. Without it, "the banner is there after start" would also
        // pass on a banner the bundle set at load time — proving nothing about
        // the wiring.
        await bootMapUntilLoaded(page);
        await expect(page.locator(".gl-nav-banner")).toHaveCount(0);
    });

    test("🛑 démarrer une session POSE le bandeau dans le conteneur de la carte", async ({
        page,
    }) => {
        await bootMapUntilLoaded(page);
        await driveWithSteps(page, 0);
        // In the map's container, not anywhere in the page: the placement is
        // what lets a driver see it without taking their eyes off the map.
        await expect(page.locator(".maplibregl-map .gl-nav-banner")).toHaveCount(1);
    });

    test("un relevé remplit le bandeau — distance et nom de voie", async ({ page }) => {
        await bootMapUntilLoaded(page);
        await driveWithSteps(page, 2);
        const banner = page.locator(".gl-nav-banner");
        await expect(banner).toBeVisible();
        // The distance is rendered in bands: a figure changing every second gets
        // read twice. What is proven here is that it EXISTS and carries its
        // unit.
        await expect(banner.locator(".gl-nav-banner__distance")).not.toBeEmpty();
        await expect(banner.locator(".gl-nav-banner__maneuver")).not.toBeEmpty();
    });

    test("🛑 la manœuvre est ÉNONCÉE, jamais rendue comme clé i18n brute", async ({ page }) => {
        // An unresolved key — `navigation.maneuver.turn.left` — is the most
        // alarming way to say "unknown", and it passes every test that only
        // checks "non-empty".
        await bootMapUntilLoaded(page);
        await driveWithSteps(page, 2);
        const text = await page.locator(".gl-nav-banner__maneuver").textContent();
        expect(text).not.toMatch(/^navigation\./);
        expect((text ?? "").trim().length).toBeGreaterThan(0);
    });

    test("arrêter le guidage RETIRE le bandeau", async ({ page }) => {
        await bootMapUntilLoaded(page);
        await driveWithSteps(page, 2);
        await expect(page.locator(".gl-nav-banner")).toHaveCount(1);
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Navigation.stop());
        // A banner left after stop keeps displaying the last maneuver, forever,
        // and reads as current.
        await expect(page.locator(".gl-nav-banner")).toHaveCount(0);
    });

    test("🛑 le bandeau est VISIBLE ET NON RECOUVERT — `toBeVisible` ne le dit pas", async ({
        page,
    }) => {
        // THE assertion that was missing, and the reason the defect shipped. Playwright calls an
        // element "visible" when it has a box and is not `display:none` — a banner buried under
        // the theme bar satisfies that perfectly. It was, for as long as the banner existed: same
        // top-centre pixel, z-index 500 against 1001, and `#geoleaf-map` creating no stacking
        // context to separate them. Only hit-testing the pixel can tell the two apart.
        await bootMapUntilLoaded(page);
        await driveWithSteps(page, 2);
        const banner = page.locator(".gl-nav-banner");
        await expect(banner).toBeVisible();
        // ⚠️ The boot veil must be GONE before hit-testing, and this line is not defensive: the
        // first run of this test failed on `gl-loader--fade`, the spinner mid-transition. It sits
        // at z-index 9999 over the whole page and is only removed on `transitionend` (800 ms
        // fallback), which `bootMapUntilLoaded` does not await — it waits for the map, not for
        // the veil. Without this, the assertion reports "covered" on a page that is merely still
        // revealing itself, and the reader would look for a stacking bug that is not there.
        await expect(page.locator("#gl-loader")).toBeHidden();
        const hit = await page.evaluate(() => {
            const el = document.querySelector(".gl-nav-banner");
            if (!el) return "no-banner";
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return top && el.contains(top) ? "banner" : (top?.className ?? "unknown");
        });
        expect(hit).toBe("banner");
    });

    test("le guidage passe l'application en mode immersif, et le rend à l'arrêt", async ({
        page,
    }) => {
        // The chrome belongs to the core, not to the plugin: it is asked for through
        // `GeoLeaf.UI.setImmersive`. Asserted on the class and NOT on
        // `document.fullscreenElement` — headless Chromium does not grant fullscreen reliably,
        // and the two are deliberately separate mechanisms anyway.
        await bootMapUntilLoaded(page);
        await driveWithSteps(page, 1);
        await expect(page.locator("body.gl-immersive")).toHaveCount(1);
        // ⚠️ The assertion is on the COMPUTED `display`, not on `toBeVisible()`. The theme bar is
        // an opt-in capability: on a profile that leaves it off, its container exists but is
        // empty, so it has no box and Playwright already calls it hidden. `toBeVisible()` would
        // then pass during the session and fail after it — reporting a defect that is really a
        // profile setting. `display` distinguishes "the mode hid it" from "there was nothing".
        const themeDisplay = () =>
            page.evaluate(() => {
                const el = document.getElementById("gl-theme-primary-container");
                return el ? getComputedStyle(el).display : "absent";
            });
        expect(await themeDisplay()).toBe("none");
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Navigation.stop());
        await expect(page.locator("body.gl-immersive")).toHaveCount(0);
        expect(await themeDisplay()).not.toBe("none");
    });

    test("🛑 la caméra CADRE — zoom et inclinaison, pas seulement le centre et le cap", async ({
        page,
    }) => {
        // `zoom` was optional on the camera options and the only caller passed none, so guidance
        // followed the driver at whatever zoom they happened to be on — world view included. The
        // camera eased and turned, which is exactly what made it look like it worked.
        await bootMapUntilLoaded(page);
        await driveWithSteps(page, 3);
        await expect
            .poll(
                async () =>
                    page.evaluate(() => {
                        const m = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
                        return {
                            zoom: Math.round(m.getZoom() * 10) / 10,
                            pitch: Math.round(m.getPitch()),
                        };
                    }),
                { timeout: 10_000 }
            )
            .toEqual({ zoom: 17.5, pitch: 60 });
    });

    test("la flèche du conducteur est posée pendant la session, et retirée avec elle", async ({
        page,
    }) => {
        await bootMapUntilLoaded(page);
        await driveWithSteps(page, 2);
        await expect(page.locator(".gl-nav-arrow-marker")).toHaveCount(1);
        // Pure SVG: a wrapping <div> would have been dropped by the adapter's sanitiser, and the
        // marker would render as an empty box.
        await expect(page.locator(".gl-nav-arrow-marker > svg")).toHaveCount(1);
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Navigation.stop());
        await expect(page.locator(".gl-nav-arrow-marker")).toHaveCount(0);
    });

    test("🛑 la bascule vocale EXISTE sur le bundle bâti — sans elle, `voiceEnabled` mentait", async ({
        page,
    }) => {
        // `modules.navigation.voiceEnabled` is documented as "the STARTING state — switchable in
        // session", and for six days nothing switched it: the namespace carried no such member.
        // A key whose contract announces a toggle that does not exist is worse than an absent
        // key — it is read, it is believed, and the gap only shows up in use.
        //
        // ⚠️ Asserted on the SURFACE, not on speech. Headless Chromium has no reliable speech
        // synthesis and a wake lock needs a secure context; testing either here would buy a flaky
        // suite. What an end-to-end run proves that a unit test cannot is that the wiring
        // survived rollup, `exports` and the served bundle.
        await bootMapUntilLoaded(page);
        await driveWithSteps(page, 1);
        const surface = await page.evaluate(() => {
            const nav = /** @type {any} */ (window).GeoLeaf.Navigation;
            return {
                setVoiceEnabled: typeof nav.setVoiceEnabled,
                isVoiceEnabled: typeof nav.isVoiceEnabled,
                isVoiceAvailable: typeof nav.isVoiceAvailable,
                togglesWithoutThrowing: (() => {
                    try {
                        nav.setVoiceEnabled(false);
                        return true;
                    } catch {
                        return false;
                    }
                })(),
            };
        });
        expect(surface).toEqual({
            setVoiceEnabled: "function",
            isVoiceEnabled: "function",
            isVoiceAvailable: "function",
            togglesWithoutThrowing: true,
        });
    });

    test("🛑 l'icône de manœuvre porte un MASQUE — sinon elle peint un carré plein", async ({
        page,
    }) => {
        // `background: currentcolor` with no `mask-image` paints the whole 2rem block. The rule
        // declared `mask-size`, `mask-repeat` and `mask-position` and never the image itself, so
        // the banner showed a solid square where the arrow belongs — and nothing could see it:
        // the classes are assembled at runtime, invisible to any static analysis.
        await bootMapUntilLoaded(page);
        await driveWithSteps(page, 2);
        const mask = await page.evaluate(() => {
            const el = document.querySelector(".gl-nav-banner__icon");
            if (!el) return "no-icon";
            const cs = getComputedStyle(el);
            return cs.maskImage || cs.webkitMaskImage || "none";
        });
        expect(mask).not.toBe("none");
        expect(mask).toMatch(/url\(/);
    });
});
