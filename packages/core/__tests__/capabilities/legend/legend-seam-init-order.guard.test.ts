/**
 * GUARD — the seam's readiness guard, against the REAL Legend module.
 *
 * `__tests__/contracts/legend-seam-esm.test.js` mocks the readiness predicate to cover the
 * seam's branches. It therefore cannot catch the defect this file exists for: the predicate
 * being wired to something that is already true at boot. Here nothing is mocked away from
 * `legend.ts` — `isAvailable()` is asked against the module's actual `_map`.
 *
 * ── THE DEFECT, MEASURED ON THE DEPLOYED APP BEFORE 26/08/2026 ─────────────────────────────
 *
 * `LegendContract.isAvailable()` only tested that the facade CARRIED `loadLayerLegend`. The
 * facade carries it from `registerGlobals` onward, so the theme engine's per-layer calls —
 * which run strictly BEFORE the `geoleaf:app:ready` mount, because that event is CAUSED by
 * the end of the theme apply — were all waved through onto the `!_map` branch. Nine layers in
 * the default theme, nine "[Legend] Module not initialized" warnings, every boot, on all four
 * deploy variants.
 *
 * ⚠️ **What this file guards that the E2E net cannot.** `e2e/07-boot-sequence.spec.js` asserts
 * the warning is absent from a real boot console — the defect's observable form, but it needs
 * a built deploy and a browser. This file pins the CAUSE, in milliseconds, and it is the one
 * that turns red if the predicate is rewired to something trivially true.
 *
 * ✅ Seen turning red by mutation (predicate reverted to the presence-only test): the first
 * three tests fail, the fourth stays green — it does not depend on the seam.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../src/utils/loaders/profile-sprite-loader.js", () => ({
    ensureProfileSpriteInjectedSync: vi.fn(() => Promise.resolve()),
    isProfileSpriteReady: () => false,
    registerSpriteIcons: vi.fn(() => Promise.resolve()),
    hasProfileSprite: vi.fn(() => false),
}));

/**
 * The namespace pieces `Legend.init` reads. Installed BEFORE the dynamic imports below:
 * the modules read the global at import time, so the order is load-bearing.
 */
const g = globalThis as unknown as Record<string, unknown>;
g.GeoLeaf = {
    Config: { get: vi.fn(), getActiveProfile: vi.fn(), getAll: vi.fn(() => ({})) },
    _LegendControl: {
        create: vi.fn(() => ({
            _container: document.createElement("div"),
            hide: vi.fn(),
            addTo: vi.fn(),
            remove: vi.fn(),
            updateMultiLayerContent: vi.fn(),
        })),
    },
};
g.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

const { Legend } = await import("../../../src/capabilities/legend/legend.js");
const { LegendContract } = await import("../../../src/capabilities/legend/legend-seam.js");
const { Log } = await import("../../../src/utils/log/index.js");

/** The mocked `Log.warn`, typed so its call list is readable. */
const warn = Log.warn as unknown as ReturnType<typeof vi.fn>;

/** A map stub carrying only what `Legend.init` touches. */
const carteFactice = { addControl: vi.fn(), removeControl: vi.fn() } as never;

/** True when the readiness warning was logged since the last reset. */
function aAverti(): boolean {
    return warn.mock.calls.some((args: unknown[]) =>
        String(args[0]).includes("[Legend] Module not initialized")
    );
}

describe("legend seam — readiness guard against the real module", () => {
    beforeAll(() => {
        Legend._reset();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        Legend._reset();
    });

    afterAll(() => {
        Legend._reset();
    });

    it("is NOT available before init, even though every facade method is present", () => {
        expect(typeof Legend.loadLayerLegend).toBe("function");
        expect(typeof Legend.setLayerVisibility).toBe("function");
        expect(LegendContract.isAvailable()).toBe(false);
    });

    it("becomes available once init has bound a map, and falls back on _reset", () => {
        expect(Legend.init(carteFactice)).toBe(true);
        expect(LegendContract.isAvailable()).toBe(true);
        Legend._reset();
        expect(LegendContract.isAvailable()).toBe(false);
    });

    it("does not log '[Legend] Module not initialized' on the guarded path", () => {
        // The exact shape of the boot-time kernel call: consult the guard, forward only if
        // it says yes. This is what `theme-applier/ui-sync._loadLegendForStyle` does.
        if (LegendContract.isAvailable()) {
            LegendContract.loadLayerLegend("aires_protegees_nationales_sib", "defaut", {});
        }
        expect(aAverti()).toBe(false);
    });

    it("STILL warns when the facade is called directly before init — LG-19 is unchanged", () => {
        // The guard protects the kernel callers, not an integrator reaching past it. That
        // warning must survive: it is the only signal a too-early integrator call leaves.
        Legend.loadLayerLegend("aires_protegees_nationales_sib", "defaut", {} as never);
        expect(aAverti()).toBe(true);
    });
});
