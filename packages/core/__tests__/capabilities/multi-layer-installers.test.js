/**
 * Unit tests — S2 Lot 4 multi-layer capability installers (legend, toast-renderer).
 *
 * These two are the first installers whose layer-B writes were split across TWO files:
 *   - legend         → globals.ui.ts (`_Legend*`) + globals.api.ts (`Legend`) ;
 *   - toast-renderer → globals.ui.ts (`_UINotifications` / `NotificationSystem` / `Notifications`).
 *
 * Covers: declaration wiring (layer C), the reunited registerGlobals writes (layer B),
 * the createModule factory, and a deterministic read-API over each capability's config
 * reader — without a live Config each falls back to its built-in DEFAULTS. That read
 * block anchors the coverage of capabilities/{legend,toast-renderer}/config.ts, which
 * used to ride on the fragile incidental coverage of a full boot (non-deterministic
 * under pool:forks). Loaded via ESM `await import()` — never `require(".ts")`, which
 * would create a second, non-merged V8 instance under forks + tsx + V8 coverage.
 *
 * NB: `GeoLeaf.UI.notify` (the lossy `notify()` kernel primitive's adapter) deliberately
 * stays in globals.ui.ts — it is asserted there, in globals/ui.test.js.
 */

import { describe, expect, it } from "vitest";

const legend = await import("../../src/capabilities/legend/install.ts");
const legendCap = await import("../../src/capabilities/legend/legend-capability.ts");
const legendMod = await import("../../src/capabilities/legend/module.ts");
const legendControl = await import("../../src/capabilities/legend/legend-control.ts");
const legendGenerator = await import("../../src/capabilities/legend/legend-generator.ts");
const legendFacade = await import("../../src/api/geoleaf.legend.ts");
const legendConfig = await import("../../src/capabilities/legend/config.ts");

const toast = await import("../../src/capabilities/toast-renderer/install.ts");
const toastCap = await import("../../src/capabilities/toast-renderer/toast-renderer-capability.ts");
const toastMod = await import("../../src/capabilities/toast-renderer/module.ts");
const toastNotifs = await import("../../src/capabilities/toast-renderer/notifications.ts");
const toastFacade = await import("../../src/capabilities/toast-renderer/public-api.ts");
const toastConfig = await import("../../src/capabilities/toast-renderer/config.ts");

const cases = [
    {
        id: "legend",
        installer: legend.LEGEND_INSTALLER,
        declaration: legendCap.LEGEND_CAPABILITY,
        Module: legendMod.LegendModule,
        // Layer B: 2 internals (ex-globals.ui.ts) + the public facade (ex-globals.api.ts).
        // `_LegendRenderer` was write-only (never read via the global) — removed,
        // roadmap nettoyage Sprint 3 / PB-14.
        globals: {
            _LegendControl: legendControl.LegendControl,
            _LegendGenerator: legendGenerator.LegendGenerator,
            Legend: legendFacade.Legend,
        },
        readApi: () => {
            const cfg = legendConfig.getLegendConfig();
            // B.29: the opt-out gate is read off this same accessor — legend no longer
            // exports a second, boolean one.
            expect(typeof (cfg.enabled !== false)).toBe("boolean");
            expect(cfg).toBeTypeOf("object");
            // DEFAULTS fallback (no live Config in this test).
            expect(cfg.enabled).toBe(true);
            expect(cfg.position).toBe("bottomleft");
        },
    },
    {
        id: "toast-renderer",
        installer: toast.TOAST_RENDERER_INSTALLER,
        declaration: toastCap.TOAST_RENDERER_CAPABILITY,
        Module: toastMod.ToastRendererModule,
        globals: {
            _UINotifications: toastNotifs._UINotifications,
            NotificationSystem: toastNotifs.NotificationSystem,
            Notifications: toastFacade.Notifications,
        },
        readApi: () => {
            const cfg = toastConfig.getToastRendererConfig();
            expect(cfg).toBeTypeOf("object");
            // Opt-out capability → enabled unless a profile sets it to false.
            expect(cfg.enabled).not.toBe(false);
        },
    },
];

describe.each(cases)("$id installer (capabilities/$id/install)", (c) => {
    it("exposes its capability declaration", () => {
        expect(c.installer.declaration).toBe(c.declaration);
        expect(c.installer.declaration.id).toBe(c.id);
    });

    it("registerGlobals assigns every facade key it owns and is additive", () => {
        const gl = { existing: 1 };
        c.installer.registerGlobals(gl);
        for (const [key, expected] of Object.entries(c.globals)) {
            expect(gl[key]).toBe(expected);
        }
        expect(gl.existing).toBe(1);
    });

    it("createModule returns a fresh module instance with the right id", () => {
        const m = c.installer.createModule();
        expect(m).toBeInstanceOf(c.Module);
        expect(m.id).toBe(c.id);
        expect(c.installer.createModule()).not.toBe(m);
    });

    // Deterministic read-API coverage of the capability's config reader (DEFAULTS
    // fallback). Replaces the fragile incidental coverage from a full boot.
    it("capability config reader works without a live config", () => {
        c.readApi();
    });
});

describe("legend installer — module UI slot", () => {
    it("carries the mobile toolbar icon on the module (not the declaration)", () => {
        const m = legend.LEGEND_INSTALLER.createModule();
        expect(m.ui?.mobileIcon).toBeDefined();
        expect(m.ui.mobileIcon.profileKey).toBe("modules.legend.enabled");
        expect(legendCap.LEGEND_CAPABILITY.ui).toBeUndefined();
    });
});
