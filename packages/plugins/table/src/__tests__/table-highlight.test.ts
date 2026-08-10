/**
 * PLUGINS S8 — highlight overlay mutualisation.
 *
 * `highlightSelection` must draw a single map overlay covering every selected
 * feature that has a geometry (one `addGeoJSONLayer` call), instead of one
 * layer per feature. Regression guard: features without geometry are filtered
 * out before the adapter call, so they no longer bring down the whole overlay.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { highlightSelection } from "../table-highlight.js";
import { tableState } from "../table-state.js";
import type { TableFeature, TableGeometry } from "../types.js";

function feat(id: string, geometry: TableGeometry | null): TableFeature {
    return { id, geometry, properties: {} };
}

function select(features: TableFeature[]): void {
    tableState._cachedData = features;
    features.forEach((f, i) => {
        tableState._selectedIds.add(String(f.id));
        tableState._featureIdMap.set(String(f.id), i);
    });
}

describe("table-highlight — single shared overlay layer", () => {
    let addGeoJSONLayer: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        addGeoJSONLayer = vi.fn();
        tableState._map = {
            addGeoJSONLayer,
            removeLayer: vi.fn(),
            fire: vi.fn(),
        } as unknown as typeof tableState._map;
        tableState._selectedIds.clear();
        tableState._cachedData = [];
        tableState._featureIdMap.clear();
        tableState._highlightLayers = [];
        tableState._highlightActive = false;
        tableState._currentLayerId = "layerA";
    });

    it("creates exactly one layer for N selected features", () => {
        select([
            feat("a", { type: "Point", coordinates: [0, 0] }),
            feat("b", { type: "Point", coordinates: [1, 1] }),
            feat("c", { type: "Point", coordinates: [2, 2] }),
        ]);
        highlightSelection(true);

        expect(addGeoJSONLayer).toHaveBeenCalledTimes(1);
        expect(tableState._highlightLayers).toHaveLength(1);
        const fc = addGeoJSONLayer.mock.calls[0][1] as { type: string; features: unknown[] };
        expect(fc.type).toBe("FeatureCollection");
        expect(fc.features).toHaveLength(3);
    });

    it("skips features without geometry but still overlays the rest", () => {
        select([
            feat("a", { type: "Point", coordinates: [0, 0] }),
            feat("b", null),
            feat("c", { type: "Point", coordinates: [2, 2] }),
        ]);
        highlightSelection(true);

        expect(addGeoJSONLayer).toHaveBeenCalledTimes(1);
        const fc = addGeoJSONLayer.mock.calls[0][1] as { features: unknown[] };
        expect(fc.features).toHaveLength(2);
    });

    it("creates no layer when every selected feature lacks geometry", () => {
        select([feat("a", null), feat("b", null)]);
        highlightSelection(true);

        expect(addGeoJSONLayer).not.toHaveBeenCalled();
        expect(tableState._highlightLayers).toHaveLength(0);
    });

    it("clears the overlay on deactivate", () => {
        select([feat("a", { type: "Point", coordinates: [0, 0] })]);
        highlightSelection(true);
        expect(tableState._highlightLayers).toHaveLength(1);

        highlightSelection(false);
        expect(tableState._highlightLayers).toHaveLength(0);
    });
});
