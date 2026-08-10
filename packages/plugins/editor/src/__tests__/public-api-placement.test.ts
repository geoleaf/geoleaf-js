/*!
 * Tests — tâche 5.1-a : la façade expose le placement, et elle lui passe le RÉGLAGE
 *
 * 🛑 Ce fichier existe parce que la mesure a trouvé le module ABSORBÉ MAIS INERTE — zéro
 * importeur de production, exactement l'état dans lequel 4.4 et 4.5 avaient été livrées au
 * Sprint 4 (« livrées, prouvées, et inertes »). Un module qu'aucune façade n'expose ne se
 * distingue pas d'un module mort, et aucune gate ne fait la différence.
 *
 * Il garde deux propriétés que les tests d'unité de `placement-mode.ts` ne peuvent pas voir,
 * parce qu'elles vivent dans le câblage et non dans le module :
 *   1. la clé `PlacementMode` est présente sur `GeoLeaf.Editor` avec la forme que le seam du
 *      core lit déjà (ce qui fait de 5.1-f un repointage, pas une refonte) ;
 *   2. le rayon du garde-fou vient de `modules.editor.poiSnapMeters` — sans ce fil, le
 *      réglage neuf serait documenté, gaté, et sans effet.
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
        // Le cas qui sépare un spread d'un assemblage explicite : sous
        // `exactOptionalPropertyTypes`, `{...options}` injecte `snapMeters: undefined`,
        // ce qui n'est PAS « absent » et effacerait le réglage. Sans ce test, la mutation
        // « remplacer l'assemblage par `...options` » sortait VERTE — mesuré.
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
