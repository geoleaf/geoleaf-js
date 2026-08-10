/*!
 * Tests — `selection/layer-picker.ts`, couverture des branches (backlog COUVERTURE).
 *
 * Le fichier était à ~59 % de branches : `selection.test.ts` couvre le câblage
 * (`initLayerPicker` / `destroyLayerPicker`) mais aucun des CHEMINS de `_handleClick` et
 * `_handleMove` — outil non-select, géométrie non supportée, feature Terra Draw ignorée,
 * feature rejetée par l'adaptateur, survol dedans/dehors, résolution d'id brute vs préfixée.
 * On rejoue ces handlers en les capturant sur une fausse carte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("terra-draw", () => ({
    TerraDraw: vi.fn(),
    TerraDrawPointMode: vi.fn(),
    TerraDrawLineStringMode: vi.fn(),
    TerraDrawPolygonMode: vi.fn(),
    TerraDrawSelectMode: vi.fn(),
}));
vi.mock("terra-draw-maplibre-gl-adapter", () => ({ TerraDrawMapLibreGLAdapter: vi.fn() }));

// Contrôle des couches éditables — le picker les lit via getEditableLayers().
vi.mock("../config.js", async (importActual) => ({
    ...(await importActual()),
    getEditableLayers: vi.fn(() => [{ id: "roads" }]),
}));

import { initLayerPicker, destroyLayerPicker } from "../selection/layer-picker.js";
import { getSelection, clearSelection } from "../selection/selection-state.js";
import type { TerraDrawAdapterInstance } from "../drawing/terra-draw-adapter.js";
import type { EditorTool } from "../types.js";

function adapter(over: Partial<TerraDrawAdapterInstance> = {}): TerraDrawAdapterInstance {
    return {
        getActiveTool: vi.fn((): EditorTool | null => "select"),
        addFeature: vi.fn(() => "td-new"),
        selectFeature: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        setMode: vi.fn(),
        destroy: vi.fn(),
        ...over,
    } as unknown as TerraDrawAdapterInstance;
}

/** Fausse carte qui CAPTURE les handlers `on(type, fn)` pour les rejouer. */
function mapCapture(features: unknown[] = []) {
    const canvas = document.createElement("canvas");
    const h: Record<string, (e: unknown) => void> = {};
    const map = {
        getCanvas: () => canvas,
        on: vi.fn((type: string, fn: (e: unknown) => void) => (h[type] = fn)),
        off: vi.fn(),
        queryRenderedFeatures: vi.fn(() => features),
        _canvas: canvas,
        click: (pt = { x: 1, y: 2 }) => h.click({ point: pt }),
        move: (pt = { x: 1, y: 2 }) => h.mousemove({ point: pt }),
        _h: h,
    };
    return map;
}

function feat(over: Record<string, unknown> = {}) {
    return {
        layer: { id: "gl-roads-fill" },
        geometry: { type: "Point", coordinates: [2.352, 48.857] },
        id: "f1",
        properties: { name: "x" },
        ...over,
    };
}

beforeEach(() => clearSelection());
afterEach(() => destroyLayerPicker());

describe("_handleClick — les gardes", () => {
    it("ignore le clic quand l'outil actif n'est pas `select`", () => {
        const a = adapter({ getActiveTool: vi.fn((): EditorTool | null => "point") });
        const map = mapCapture([feat()]);
        initLayerPicker(a, map as never);
        map.click();
        expect(a.addFeature).not.toHaveBeenCalled();
    });

    it("ne fait rien après destroy — la carte est nulle (`if (!map) return`)", () => {
        const a = adapter();
        const map = mapCapture([feat()]);
        initLayerPicker(a, map as never);
        const fire = map._h.click;
        destroyLayerPicker();
        expect(() => fire({ point: { x: 1, y: 2 } })).not.toThrow();
        expect(a.addFeature).not.toHaveBeenCalled();
    });

    it("ignore une feature d'une couche Terra Draw (préfixe `td-`)", () => {
        const a = adapter();
        const map = mapCapture([feat({ layer: { id: "td-abc" } })]);
        initLayerPicker(a, map as never);
        map.click();
        expect(a.addFeature).not.toHaveBeenCalled();
    });

    it("ignore une feature d'une couche non éditable", () => {
        const a = adapter();
        const map = mapCapture([feat({ layer: { id: "gl-rivers-fill" } })]);
        initLayerPicker(a, map as never);
        map.click();
        expect(a.addFeature).not.toHaveBeenCalled();
    });

    it("ignore une géométrie non supportée (MultiPolygon) — `if (!modeName) return`", () => {
        const a = adapter();
        const map = mapCapture([feat({ geometry: { type: "MultiPolygon", coordinates: [] } })]);
        initLayerPicker(a, map as never);
        map.click();
        expect(a.addFeature).not.toHaveBeenCalled();
    });

    it("abandonne quand l'adaptateur rejette la feature (`addFeature` → null)", () => {
        const a = adapter({ addFeature: vi.fn(() => null) });
        const map = mapCapture([feat()]);
        initLayerPicker(a, map as never);
        map.click();
        expect(a.selectFeature).not.toHaveBeenCalled();
        expect(getSelection()).toBeNull();
    });
});

describe("_handleClick — le chemin nominal", () => {
    it("charge la feature, mémorise la sélection, notifie le hook et la sélectionne", () => {
        const a = adapter();
        const onHostFeatureSelected = vi.fn();
        const map = mapCapture([feat()]);
        initLayerPicker(a, map as never, { onHostFeatureSelected });
        map.click();

        expect(a.addFeature).toHaveBeenCalledTimes(1);
        expect(a.selectFeature).toHaveBeenCalledWith("td-new");
        expect(onHostFeatureSelected).toHaveBeenCalledWith("roads", "f1");
        const snap = getSelection();
        expect(snap).toMatchObject({ terradrawId: "td-new", featureId: "f1", layerId: "roads" });
        // les coordonnées ont été arrondies à 9 décimales
        expect(
            (a.addFeature as ReturnType<typeof vi.fn>).mock.calls[0][0].geometry.coordinates
        ).toEqual([2.352, 48.857]);
    });

    it("une feature sans id donne un featureId vide (`hit.id != null` faux)", () => {
        const a = adapter();
        const map = mapCapture([feat({ id: undefined })]);
        initLayerPicker(a, map as never);
        map.click();
        expect(getSelection()?.featureId).toBe("");
    });

    it("résout aussi une couche éditable à id BRUT (sans préfixe `gl-`)", () => {
        const a = adapter();
        const map = mapCapture([feat({ layer: { id: "roads" } })]);
        initLayerPicker(a, map as never);
        map.click();
        expect(getSelection()?.layerId).toBe("roads");
    });

    it("charge une LineString (arrondi récursif des coordonnées imbriquées)", () => {
        const a = adapter();
        const map = mapCapture([
            feat({
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [1.123456789012, 2],
                        [3, 4],
                    ],
                },
            }),
        ]);
        initLayerPicker(a, map as never);
        map.click();
        const coords = (a.addFeature as ReturnType<typeof vi.fn>).mock.calls[0][0].geometry
            .coordinates;
        expect(coords[0][0]).toBe(1.123456789); // arrondi à 9 décimales
    });
});

describe("_handleMove — le curseur", () => {
    it("passe le curseur en pointeur au survol d'une couche éditable", () => {
        const a = adapter({ getActiveTool: vi.fn((): EditorTool | null => null) });
        const map = mapCapture([feat()]);
        initLayerPicker(a, map as never);
        map.move();
        expect(map._canvas.style.cursor).toBe("pointer");
    });

    it("remet le curseur par défaut hors d'une couche éditable", () => {
        const a = adapter({ getActiveTool: vi.fn((): EditorTool | null => null) });
        const map = mapCapture([feat({ layer: { id: "gl-rivers-fill" } })]);
        initLayerPicker(a, map as never);
        map.move();
        expect(map._canvas.style.cursor).toBe("");
    });

    it("ne touche pas au curseur quand un outil de dessin est armé", () => {
        const a = adapter({ getActiveTool: vi.fn((): EditorTool | null => "point") });
        const map = mapCapture([feat()]);
        initLayerPicker(a, map as never);
        map._canvas.style.cursor = "crosshair";
        map.move();
        expect(map._canvas.style.cursor).toBe("crosshair");
    });

    it("une feature Terra Draw ne compte pas comme survol éditable", () => {
        const a = adapter({ getActiveTool: vi.fn((): EditorTool | null => "select") });
        const map = mapCapture([feat({ layer: { id: "td-abc" } })]);
        initLayerPicker(a, map as never);
        map.move();
        expect(map._canvas.style.cursor).toBe("");
    });

    it("ne fait rien après destroy (`if (!map) return`)", () => {
        const a = adapter();
        const map = mapCapture([feat()]);
        initLayerPicker(a, map as never);
        const fire = map._h.mousemove;
        destroyLayerPicker();
        expect(() => fire({ point: { x: 1, y: 2 } })).not.toThrow();
    });
});
