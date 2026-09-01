// @ts-check
// Config-contract Phase C / C2 — targeted E2E (real presence/visibility) for
// the B3 config family (ui.json).
//
// The exhaustive PER-VALUE coverage of every `ui.*` flag lives in Vitest
// (__tests__/config/s11-*), which patches the config at the unit level
// against the real code paths. Here we only confirm, in a real browser
// (deploy-core, PWA + service worker, tourism profile), that the
// `ui.show* → DOM control` chain holds end to end — limited to CORE controls
// with a stable selector and a clean DOM effect.
//
// Patch mechanism (validated by DOM probe, 2026-06-14): a `window.fetch`
// monkeypatch — it intercepts BEFORE the service worker (like cfg-c1, unlike
// page.route which does not capture SW-mediated requests). The target is
// `profile-bundle.json`: `build-deploy` bundles a profile's WHOLE config in
// that single file (there is NO separately served `config/core/ui.json`) —
// UI flags at `bundle.ui.ui.<flag>`, capability gates at
// `bundle.modules.<id>.enabled`. Arguments are passed as an addInitScript
// ARGUMENT — not via closure (serialising a closure to a string loses its
// variables → the patch would never apply).
//
// ⚠️ Two gate systems coexist, and `ui.show*` is no longer the right one for
// everyone: `ui.showScale` / `ui.showCoordinates` are read by NO code
// (migrated to `modules.scale.enabled` / `modules.coordinates.enabled`),
// while `ui.showBaseLayerControls` is still read. Hence the two helpers
// below.
//
// The `cfg-` prefix marks the config-contract spec family (collision-proof
// against the 10,11,12… plugin-validation numbering).
//
// OUT OF E2E SCOPE (covered by Vitest s11): showFilterPanel / showLegend /
// showLayerManager / showThemeSelector / showTable — plugin-defined controls
// without a stable core selector, deferred and dependent on
// data/themes/plugins, not cleanly assertable here (e.g. the filter toggle
// is `display:none` even with flag=true).

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") }); // deploy-core (profil tourism)

/**
 * Forces `bundle.ui.ui[flag] = value` by intercepting `profile-bundle.json`
 * through a self-contained `window.fetch` monkeypatch ({flag,value} passed as
 * argument).
 */
async function patchUiFlag(page, flag, value) {
    await page.addInitScript(
        ({ flag, value }) => {
            const origFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === "string" ? input : input && input.url;
                const res = await origFetch(input, init);
                if (url && url.includes("profile-bundle.json")) {
                    try {
                        const cfg = await res.clone().json();
                        if (cfg.ui && cfg.ui.ui) cfg.ui.ui[flag] = value;
                        return new Response(JSON.stringify(cfg), {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        });
                    } catch {
                        return res;
                    }
                }
                return res;
            };
        },
        { flag, value }
    );
}

/**
 * Forces `bundle.modules[capId].enabled = value`, same vehicle
 * (profile-bundle.json).
 *
 * The scale and coordinates controls are no longer driven by `ui.showScale` /
 * `ui.showCoordinates`: those two keys are read NOWHERE in
 * `packages/core/src` (grep = 0 hits outside "migrated from" comments). Each
 * capability carries its own gate — `modules.scale.enabled` and
 * `modules.coordinates.enabled` — tested `=== false` at the deferred mount
 * (capabilities/{scale,coordinates}/lifecycle.ts, on `geoleaf:app:ready`).
 *
 * The target stays `profile-bundle.json`: the bundle's `modules` block is
 * merged key by key into the effective config (config/profile.ts →
 * `mergeModulesBag`), and those two gates are re-read AFTER the merge — so
 * the patch is honoured.
 */
async function patchModuleGate(page, capId, value) {
    await page.addInitScript(
        ({ capId, value }) => {
            const origFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === "string" ? input : input && input.url;
                const res = await origFetch(input, init);
                if (url && url.includes("profile-bundle.json")) {
                    try {
                        const cfg = await res.clone().json();
                        cfg.modules = Object.assign({}, cfg.modules);
                        cfg.modules[capId] = Object.assign({}, cfg.modules[capId], {
                            enabled: value,
                        });
                        return new Response(JSON.stringify(cfg), {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        });
                    } catch {
                        return res;
                    }
                }
                return res;
            };
        },
        { capId, value }
    );
}

// Contract: container visible ONLY — these tests assert on chrome that exists pre-map.
async function bootMapVisibleOnly(page) {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
}

// CORE controls with a stable selector + a clean flag→DOM effect, confirmed
// by probe on deploy-core (tourism). Gate = `=== false` for all three
// (absent ⇒ displayed).
//
// `key` = the config key the code REALLY reads, and `patch` the matching
// vehicle. The two no longer coincide: `showBaseLayerControls` stays a
// `ui.*` flag (basemaps/ui.ts), while scale and coordinates migrated to
// their capability's gate (`modules.<id>.enabled`).
const CORE_CONTROLS = [
    // basemaps/ui.ts (eager, `showBaseLayerControls === false`) — tourism default false
    {
        key: "ui.showBaseLayerControls",
        id: "showBaseLayerControls",
        patch: patchUiFlag,
        selector: "#gl-left-panel",
    },
    // capabilities/scale/lifecycle.ts (deferred geoleaf:app:ready, `enabled === false`)
    {
        key: "modules.scale.enabled",
        id: "scale",
        patch: patchModuleGate,
        selector: ".gl-scale-main-wrapper",
    },
    // capabilities/coordinates/lifecycle.ts (deferred, readout anchored on the scale wrapper)
    {
        key: "modules.coordinates.enabled",
        id: "coordinates",
        patch: patchModuleGate,
        selector: ".gl-scale-coordinates",
    },
];

test.describe("cfg-c2 — ui.show* → contrôles DOM (contrôles core)", () => {
    for (const { key, id, patch, selector } of CORE_CONTROLS) {
        test(`${key}:true → ${selector} visible`, async ({ page }) => {
            await patch(page, id, true);
            await bootMapVisibleOnly(page);
            await expect(page.locator(selector).first()).toBeVisible({ timeout: 10000 });
        });

        test(`${key}:false → ${selector} absent`, async ({ page }) => {
            await patch(page, id, false);
            await bootMapVisibleOnly(page);
            // Let the deferred UI run (geoleaf:app:ready): if the control were
            // to appear, it would have — then assert it stays absent.
            await page.waitForTimeout(4000);
            await expect(page.locator(selector)).toHaveCount(0);
        });
    }
});
