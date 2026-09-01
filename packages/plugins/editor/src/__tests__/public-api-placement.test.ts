/*!
 * Tests — the facade exposes the placement, and passes it the SETTING
 *
 * 🛑 This file exists because measurement found the module ABSORBED BUT INERT —
 * zero production importers, exactly the state two earlier deliveries had
 * already shipped in ("delivered, proven, and inert"). A module no facade
 * exposes is indistinguishable from a dead module, and no gate tells the
 * difference.
 *
 * It guards two properties the unit tests of `placement-mode.ts` cannot see,
 * because they live in the wiring and not in the module:
 *   1. the `PlacementMode` key is present on `GeoLeaf.Editor` with the shape
 *      the core's seam already reads (which makes the later hand-over a
 *      repointing, not a rewrite);
 *   2. the guard radius comes from `modules.editor.poiSnapMeters` — without
 *      that wire, the new setting would be documented, gated, and ineffective.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const _activate = vi.fn();
const _config: { poiSnapMeters?: number } = {};

vi.mock("../drawing/placement-mode.js", () => ({
    DEFAULT_SNAP_METERS: 50,
    PlacementMode: {
        activate: (...a: unknown[]) => _activate(...a),
        deactivate: vi.fn(),
        isActive: () => false,
        clearMarker: vi.fn(),
    },
}));

vi.mock("../config.js", () => ({ getEditorConfig: () => _config }));
vi.mock("../sub-menu/floating-menu.js", () => ({
    setEditorActiveTool: vi.fn(),
    getEditorActiveTool: vi.fn(),
    updateUndoRedoState: vi.fn(),
}));
vi.mock("../editor-api.js", () => ({
    toggleEditorMenu: vi.fn(),
    destroyEditor: vi.fn(),
    setDestroyHook: vi.fn(),
}));

const { buildPublicApi } = await import("../public-api.js");

/** The facade slice under test, narrowed from the untyped façade bag. */
function placement() {
    return buildPublicApi().PlacementMode as {
        activate(m: unknown, cb: unknown, o?: unknown): void;
        deactivate(): void;
        isActive(): boolean;
        clearMarker(): void;
    };
}

beforeEach(() => {
    _activate.mockReset();
    delete _config.poiSnapMeters;
});

describe("GeoLeaf.Editor.PlacementMode — la surface", () => {
    it("🛑 est exposée par la façade — le module n'est pas inerte", () => {
        const api = buildPublicApi();
        expect(api.PlacementMode).toBeDefined();
    });

    it("porte les quatre membres, tous appelables", () => {
        const p = placement();
        for (const k of ["activate", "deactivate", "isActive", "clearMarker"] as const) {
            expect(typeof p[k]).toBe("function");
        }
    });

    it("garde la signature (map, callback) que lit le seam du core", () => {
        const cb = vi.fn();
        const map = { id: "map" };
        placement().activate(map, cb);
        expect(_activate).toHaveBeenCalledTimes(1);
        expect(_activate.mock.calls[0][0]).toBe(map);
        expect(_activate.mock.calls[0][1]).toBe(cb);
    });
});

describe("GeoLeaf.Editor.PlacementMode — le rayon du garde-fou", () => {
    it("🛑 vient de modules.editor.poiSnapMeters", () => {
        _config.poiSnapMeters = 12;
        placement().activate(null, vi.fn());
        expect(_activate.mock.calls[0][2]).toEqual({ snapMeters: 12 });
    });

    it("retombe sur le défaut quand la config n'en porte pas", () => {
        placement().activate(null, vi.fn());
        expect(_activate.mock.calls[0][2]).toEqual({ snapMeters: 50 });
    });

    it("un 0 configuré DÉSACTIVE le garde-fou, il ne retombe pas sur 50", () => {
        _config.poiSnapMeters = 0;
        placement().activate(null, vi.fn());
        expect(_activate.mock.calls[0][2]).toEqual({ snapMeters: 0 });
    });

    it("l'appelant peut surcharger le rayon", () => {
        _config.poiSnapMeters = 12;
        placement().activate(null, vi.fn(), { snapMeters: 200 });
        expect(_activate.mock.calls[0][2]).toEqual({ snapMeters: 200 });
    });

    it("🛑 n'injecte PAS disableDrag quand l'appelant ne le passe pas", () => {
        placement().activate(null, vi.fn(), {});
        expect(_activate.mock.calls[0][2]).not.toHaveProperty("disableDrag");
    });

    it("🛑 un snapMeters EXPLICITEMENT undefined n'écrase pas la config", () => {
        // The case that separates a spread from an explicit assembly: under
        // `exactOptionalPropertyTypes`, `{...options}` injects
        // `snapMeters: undefined`, which is NOT "absent" and would erase the
        // setting. Without this test, the mutation "replace the assembly with
        // `...options`" came out GREEN — measured.
        _config.poiSnapMeters = 12;
        placement().activate(null, vi.fn(), { snapMeters: undefined });
        expect(_activate.mock.calls[0][2]).toEqual({ snapMeters: 12 });
    });

    it("🛑 un disableDrag EXPLICITEMENT undefined ne crée pas la clé", () => {
        placement().activate(null, vi.fn(), { disableDrag: undefined });
        expect(_activate.mock.calls[0][2]).not.toHaveProperty("disableDrag");
    });

    it("transmet disableDrag quand il est passé", () => {
        placement().activate(null, vi.fn(), { disableDrag: true });
        expect(_activate.mock.calls[0][2]).toEqual({ snapMeters: 50, disableDrag: true });
    });
});
