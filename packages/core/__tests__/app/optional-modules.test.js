/**
 * Tests unitaires — optional ICoreModule wrappers
 *
 * Covers: RouteModule, LabelsModule, LegendModule.
 * Each module is verified for correct id, dependencies, init/destroy behavior,
 * and UI slot declaration (when applicable).
 */
"use strict";

import { RouteModule } from "../../src/capabilities/route/module.js";
import { LabelsModule } from "../../src/capabilities/labels/module.js";
import { LegendModule } from "../../src/capabilities/legend/module.js";

// ── RouteModule ──────────────────────────────────────────────────────────────

describe("RouteModule", () => {
    let mod;
    beforeEach(() => {
        mod = new RouteModule();
    });

    it("has id 'route'", () => {
        expect(mod.id).toBe("route");
    });

    it("depends on geojson", () => {
        expect([...mod.dependencies]).toEqual(["geojson"]);
    });

    it("does not declare a UI slot", () => {
        expect(mod.ui).toBeUndefined();
    });

    it("init() does not throw", () => {
        expect(() => mod.init(null, { get: vi.fn() })).not.toThrow();
    });

    it("destroy() does not throw", () => {
        expect(() => mod.destroy()).not.toThrow();
    });
});

// ── LabelsModule ─────────────────────────────────────────────────────────────

describe("LabelsModule", () => {
    let mod;
    beforeEach(() => {
        mod = new LabelsModule();
    });

    it("has id 'labels'", () => {
        expect(mod.id).toBe("labels");
    });

    it("depends on geojson", () => {
        expect([...mod.dependencies]).toEqual(["geojson"]);
    });

    it("does not declare a UI slot", () => {
        expect(mod.ui).toBeUndefined();
    });

    it("init() does not throw", () => {
        expect(() => mod.init(null, { get: vi.fn() })).not.toThrow();
    });

    it("destroy() does not throw", () => {
        expect(() => mod.destroy()).not.toThrow();
    });
});

// ── LegendModule ─────────────────────────────────────────────────────────────

describe("LegendModule", () => {
    let mod;
    beforeEach(() => {
        mod = new LegendModule();
    });

    it("has id 'legend'", () => {
        expect(mod.id).toBe("legend");
    });

    it("depends on geojson", () => {
        expect([...mod.dependencies]).toEqual(["geojson"]);
    });

    it("declares a mobileIcon UI slot", () => {
        expect(mod.ui).toBeDefined();
        expect(mod.ui.mobileIcon).toBeDefined();
        expect(mod.ui.mobileIcon.profileKey).toBe("modules.legend.enabled");
        expect(mod.ui.mobileIcon.labelKey).toBe("aria.toolbar.legend");
        expect(mod.ui.mobileIcon.icon).toContain("<svg");
    });

    it("init() does not throw", () => {
        expect(() => mod.init(null, { get: vi.fn() })).not.toThrow();
    });

    it("destroy() does not throw", () => {
        expect(() => mod.destroy()).not.toThrow();
    });
});
