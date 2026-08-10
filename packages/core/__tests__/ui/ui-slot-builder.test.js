/**
 * @tests built-in/ui/ui-slot-builder — profileKey + requiresPlugin visibility guards
 *
 * Extracted in KERNEL S8 from two identical blocks (desktop-panel-slots +
 * mobile-toolbar-pill). The callers' tests only ever exercised slot defs WITHOUT
 * `profileKey`/`requiresPlugin`, so both guard bodies were dead to coverage —
 * visible only once extracted (28 % file). These tests drive both guards directly.
 */
import { resolveUISlotVisibility } from "../../src/kernel/ui/ui-slot-builder.js";

const BOTH = { checkRequiresPlugin: true, useDefaultVisible: true };

/** Installs a minimal `GeoLeaf` global with the Config / plugins surfaces read by the guards. */
function stubGeoLeaf({ configGet, isLoaded, isLazyAvailable } = {}) {
    globalThis.GeoLeaf = {
        Config: configGet ? { get: configGet } : undefined,
        plugins: { isLoaded, isLazyAvailable },
    };
}

describe("resolveUISlotVisibility", () => {
    afterEach(() => {
        delete globalThis.GeoLeaf;
    });

    it("shows a slot that declares neither guard", () => {
        stubGeoLeaf();
        expect(resolveUISlotVisibility({}, BOTH)).toBe(true);
    });

    describe("guard 1 — profileKey", () => {
        it("hides the slot when the profile says false", () => {
            stubGeoLeaf({ configGet: () => false });
            expect(resolveUISlotVisibility({ profileKey: "modules.legend.enabled" }, BOTH)).toBe(
                false
            );
        });

        it("shows the slot when the profile says true", () => {
            stubGeoLeaf({ configGet: () => true });
            expect(resolveUISlotVisibility({ profileKey: "modules.legend.enabled" }, BOTH)).toBe(
                true
            );
        });

        it("only `false` hides — a missing key resolves to the fallback", () => {
            const get = vi.fn((_key, fallback) => fallback);
            stubGeoLeaf({ configGet: get });
            expect(resolveUISlotVisibility({ profileKey: "absent" }, BOTH)).toBe(true);
        });

        it("passes defaultVisible as the fallback when useDefaultVisible is set", () => {
            const get = vi.fn((_key, fallback) => fallback);
            stubGeoLeaf({ configGet: get });
            const def = { profileKey: "k", defaultVisible: false };
            expect(resolveUISlotVisibility(def, BOTH)).toBe(false);
            expect(get).toHaveBeenCalledWith("k", false);
        });

        it("ignores defaultVisible for lazy slots (useDefaultVisible false → fallback true)", () => {
            const get = vi.fn((_key, fallback) => fallback);
            stubGeoLeaf({ configGet: get });
            const def = { profileKey: "k", defaultVisible: false };
            const opts = { checkRequiresPlugin: false, useDefaultVisible: false };
            expect(resolveUISlotVisibility(def, opts)).toBe(true);
            expect(get).toHaveBeenCalledWith("k", true);
        });

        it("shows the slot when Config is absent entirely", () => {
            stubGeoLeaf();
            expect(resolveUISlotVisibility({ profileKey: "k" }, BOTH)).toBe(true);
        });
    });

    describe("guard 2 — requiresPlugin", () => {
        it("shows the slot when the plugin is loaded", () => {
            stubGeoLeaf({ isLoaded: () => true, isLazyAvailable: () => false });
            expect(resolveUISlotVisibility({ requiresPlugin: "print" }, BOTH)).toBe(true);
        });

        it("shows the slot when the plugin is lazy-available but not yet loaded", () => {
            stubGeoLeaf({ isLoaded: () => false, isLazyAvailable: () => true });
            expect(resolveUISlotVisibility({ requiresPlugin: "print" }, BOTH)).toBe(true);
        });

        it("hides the slot when the plugin is neither loaded nor lazy-available", () => {
            stubGeoLeaf({ isLoaded: () => false, isLazyAvailable: () => false });
            expect(resolveUISlotVisibility({ requiresPlugin: "print" }, BOTH)).toBe(false);
        });

        it("skips the guard for lazy slots — they ARE the plugin", () => {
            stubGeoLeaf({ isLoaded: () => false, isLazyAvailable: () => false });
            const opts = { checkRequiresPlugin: false, useDefaultVisible: false };
            expect(resolveUISlotVisibility({ requiresPlugin: "print" }, opts)).toBe(true);
        });
    });

    it("applies profileKey before requiresPlugin — a hidden slot never probes the registry", () => {
        const isLoaded = vi.fn(() => true);
        stubGeoLeaf({ configGet: () => false, isLoaded, isLazyAvailable: () => true });
        expect(resolveUISlotVisibility({ profileKey: "k", requiresPlugin: "print" }, BOTH)).toBe(
            false
        );
        expect(isLoaded).not.toHaveBeenCalled();
    });
});
