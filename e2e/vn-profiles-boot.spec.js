// @ts-check
// BROWSER VERIFICATION — boot matrix of the shipped profiles, scenario F.3
// of the internal browser-verification table.
//
// F.3 is the only scenario requiring EACH shipped profile to boot with its
// real embedded config — which no unit test does, and happy-dom cannot do
// (no engine, no real MapLibre boot).
//
// Counter-proof: `pwa` and `offline` were **dead on every shipped profile**.
//
// ⚠️ WHAT THIS TEST VERIFIES, AND WHAT IT DOES NOT — arbitrated at the
// 2026-07-24 pre-flight:
//
//   • **Verified (browser-only, per-profile, discriminating)**: each shipped
//     profile really BOOTS — native map loaded, right profile active, no
//     boot error. No unit test does that; F.3's real browser contribution.
//
//   • **NOT verified here**: the FUNCTIONAL activation of pwa/offline. Two
//     reasons, both measured. (1) `registerGlobals` mounts `gl.PWA` and
//     `gl._OfflineDetector` UNCONDITIONALLY (`pwa/install.ts`) —
//     asserting their presence would be a self-fulfilling guard, true
//     whether the capability is alive or dead. (2) The PWA's real
//     activation is the service worker's registration, and the suite runs
//     with `serviceWorkers: 'block'`:
//     `navigator.serviceWorker.controller` is `false` by construction.
//     Verifying it takes an SW-enabled run — outside this pass, like the
//     original E2E pass (Mattieu's call).
//
// ⚠️ Why NOT a raw "no console error": several profiles reference EXTERNAL
// data (layers on remote servers, `qgis.geoleaf.dev`) unreachable from the
// local deploy → `Failed to load layer` / CORS. Those errors are
// ENVIRONMENTAL; counting them would make the test hostage to third-party
// servers. Only the boot errors that are NOT environmental are kept — the
// ones that would betray a real regression of a profile's boot.

import { deliverableProfiles } from "./helpers/profiles.js";
import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

/**
 * The profiles really shipped — READ FROM DISK, never written here.
 *
 * ⚠️ This list used to be hard-coded (8 names, 2026-07-24 pre-flight). On
 * 07-27, Mattieu brought `profiles/` down to 2 business profiles: the other
 * 6 were demos, and this test looked for them all in a deploy that no
 * longer contained them. A test that hard-codes what a directory contains
 * does not break when the directory changes — it breaks **later**, and it
 * blames the wrong culprit.
 *
 * The filter reproduces EXACTLY `scripts/build-deploy.cjs`'s: neither
 * `schemas/` nor the `_`-prefixed directories (`_reference` is the
 * exhaustive sample of config shapes, not a shippable demo). If the two
 * filters diverged, this test would look for a profile absent from the
 * deploy — today's breakdown, under another name.
 */
// Derivation + anti-empty guard now live in `helpers/profiles.js` — this file proved the
// pattern and the suite shares it instead of re-spelling the build filter per spec.
const PROFILES = deliverableProfiles();

// Environmental errors expected on the local deploy (external data absent) —
// to distinguish from a boot/capability regression.
const DATA_LOAD_NOISE = [
    /\[GeoLeaf\.GeoJSON\] Failed to load layer/i,
    /Access to fetch at .* has been blocked by CORS/i,
    /Failed to (load resource|fetch)/i,
    /net::ERR_/i,
    /\[SWRegister\] Registration failed/i,
];
const isEnvironmental = (t) => DATA_LOAD_NOISE.some((re) => re.test(t));

test.describe("VN — boot de chaque profil livré (F.3)", () => {
    for (const profile of PROFILES) {
        test(`F.3 — ${profile} : boot complet sans erreur`, async ({ page }) => {
            const bootErrors = [];
            const record = (t) => {
                if (!isEnvironmental(t)) bootErrors.push(t.split("\n")[0].slice(0, 120));
            };
            page.on("console", (m) => m.type() === "error" && record(m.text()));
            page.on("pageerror", (e) => record(String(e)));

            // Profile selection BEFORE boot, like the demo's selector does.
            await page.addInitScript((id) => {
                try {
                    sessionStorage.setItem("gl-selected-profile", id);
                } catch (e) {
                    void e;
                }
            }, profile);

            await page.goto("/");

            // 1 — full boot: the native map is loaded.
            await page.waitForFunction(
                () => {
                    const n = window.GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
                    return !!(n && typeof n.loaded === "function" && n.loaded());
                },
                null,
                { timeout: 25000 }
            );
            await page.waitForTimeout(1200); // let the deferred capabilities install

            // 2 — the right profile was loaded (the selector took effect).
            const active = await page.evaluate(() =>
                window.GeoLeaf?.Config?.getActiveProfileId?.()
            );
            expect(active, "profil actif inattendu").toBe(profile);

            // 3 — no BOOT error (external-data failures excluded, see header).
            // A capability throwing at install — the shape a "dead" profile
            // would take — would surface here; a silent no-op would not, and
            // that one stays with the SW-enabled run.
            expect(
                bootErrors,
                `erreurs de boot non environnementales sur ${profile} : ${bootErrors.join(" | ")}`
            ).toEqual([]);
        });
    }
});
