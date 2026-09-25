/**
 * measure's sources and layers survive a basemap switch that replaces the map's style.
 *
 * They are placed on the engine directly, outside the GeoLeaf adapter's registry: the transform a
 * style replacement runs carries only what the adapter owns, so the diff removed them — and every
 * finished measure with them, the plugin's writes then landing on sources that were gone.
 * `initLayers` now declares them to the adapter driving the map, which carries them natively.
 *
 * The declaration crosses `@geoleaf/host-runtime`'s seam for real: only the host is faked — a
 * `GeoLeaf.Core` whose adapter records what it is told. The case marked 🔴 was seen red on the
 * code without the declaration. The browser half is `e2e/58-style-swap-keeps-foreign-layers`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { makeMockMaplibreMap } from "./setup.js";
import { initLayers } from "../draw-layers.js";

const LAYERS = [
    "gl-measure-polygons-fill",
    "gl-measure-polygons-line",
    "gl-measure-lines-layer",
    "gl-measure-preview-layer",
    "gl-measure-vertices-layer",
    "gl-measure-labels-layer",
];
const SOURCES = [
    "gl-measure-lines",
    "gl-measure-polygons",
    "gl-measure-vertices",
    "gl-measure-labels",
    "gl-measure-preview",
];

/**
 * Installs a host whose one GeoLeaf map drives `native`, and returns its adapter's recorder.
 *
 * @param native - The engine the adapter drives.
 */
function hostDriving(native: unknown) {
    const declare = vi.fn();
    const adapter = { getNativeMap: () => native, declareOwnedStyleIds: declare };
    (globalThis as { GeoLeaf?: unknown }).GeoLeaf = {
        Core: { listMaps: () => ["map"], getMap: () => adapter },
    };
    return declare;
}

afterEach(() => {
    delete (globalThis as { GeoLeaf?: unknown }).GeoLeaf;
});

describe("measure — ses couches sont déclarées à l'adaptateur qui pilote la carte", () => {
    it("🔴 initLayers déclare ses cinq sources et ses six couches, celles-là mêmes qu'il pose", () => {
        const map = makeMockMaplibreMap();
        const declare = hostDriving(map);

        initLayers(map);

        expect(declare).toHaveBeenCalledWith("measure", { layerIds: LAYERS, sourceIds: SOURCES });
        for (const id of LAYERS) expect(map.getLayer(id), `${id} non posée`).toBeDefined();
        for (const id of SOURCES) expect(map.getSource(id), `${id} non posée`).toBeTruthy();
    });

    it("une carte qu'aucun adaptateur GeoLeaf ne pilote : rien n'est déclaré, rien ne lève", () => {
        const map = makeMockMaplibreMap();
        const declare = hostDriving(makeMockMaplibreMap());

        expect(() => initLayers(map)).not.toThrow();
        expect(declare).not.toHaveBeenCalled();
        expect(map.getLayer("gl-measure-lines-layer")).toBeDefined();
    });

    it("sans cœur chargé, les couches sont posées et rien ne lève", () => {
        const map = makeMockMaplibreMap();

        expect(() => initLayers(map)).not.toThrow();
        expect(map.getLayer("gl-measure-lines-layer")).toBeDefined();
    });
});
