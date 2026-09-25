/**
 * The editor's drawing engine survives a basemap switch that replaces the map's style.
 *
 * terra-draw places its own sources and layers on the engine when it starts, outside the GeoLeaf
 * adapter's registry: the transform a style replacement runs carries only what the adapter owns,
 * so the diff removed them — and terra-draw's next render, which writes through
 * `getSource(id).setData` in a frame callback, THREW on the missing source, uncaught. The
 * adapter's `start()` now declares what terra-draw placed, MEASURED around the call rather than
 * listed (terra-draw names its ids itself, and nothing promises the names); `stop()` and
 * `destroy()` withdraw it.
 *
 * Only terra-draw and the host are faked; the declaration crosses `@geoleaf/host-runtime`'s seam
 * for real. The cases marked 🔴 were seen red on the code without the declaration. The browser
 * half is `e2e/58-style-swap-keeps-foreign-layers`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The layers terra-draw 1.4.1 registers, with the source each reads. */
const TD_LAYERS = [
    { id: "td-polygon", source: "td-polygon" },
    { id: "td-polygon-outline", source: "td-polygon" },
    { id: "td-linestring", source: "td-linestring" },
    { id: "td-point", source: "td-point" },
    { id: "td-point-marker", source: "td-point" },
];

type LayerRow = { id: string; source?: string };

/** The engine, as far as the editor and the fake terra-draw touch it. */
function fakeMap(existing: LayerRow[] = []) {
    const layers: LayerRow[] = [...existing];
    const canvas = document.createElement("canvas");
    return {
        layers,
        getCanvas: vi.fn(() => canvas),
        getContainer: vi.fn(() => document.createElement("div")),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        queryRenderedFeatures: vi.fn(() => []),
        loaded: vi.fn(() => true),
        getLayersOrder: vi.fn(() => layers.map((l) => l.id)),
        getLayer: vi.fn((id: string) => layers.find((l) => l.id === id)),
    };
}

type FakeMap = ReturnType<typeof fakeMap>;

/** The map the current `new TerraDraw()` draws on — terra-draw's `register` writes into it. */
let drawnOn: FakeMap | null = null;

const draw = vi.hoisted(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    setMode: vi.fn(),
    on: vi.fn(),
    updateModeOptions: vi.fn(),
}));

vi.mock("terra-draw", () => ({
    TerraDraw: vi.fn(function () {
        return draw;
    }),
    TerraDrawPointMode: vi.fn(function () {}),
    TerraDrawLineStringMode: vi.fn(function () {}),
    TerraDrawPolygonMode: vi.fn(function () {}),
    TerraDrawSelectMode: vi.fn(function () {}),
}));

vi.mock("terra-draw-maplibre-gl-adapter", () => ({
    TerraDrawMapLibreGLAdapter: vi.fn(function () {
        return { __adapter: true };
    }),
}));

const { createTerraDrawAdapter } = await import("../drawing/terra-draw-adapter.js");

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

const CALLBACKS = { onFinish: vi.fn(), onChange: vi.fn(), onSelect: vi.fn(), onDeselect: vi.fn() };

async function adapterOn(map: FakeMap) {
    drawnOn = map;
    return createTerraDrawAdapter(map as never, { enabled: true } as never, CALLBACKS);
}

beforeEach(() => {
    vi.clearAllMocks();
    // What terra-draw's MapLibre adapter does in `register()`: its sources and layers, on top.
    draw.start.mockImplementation(() => {
        drawnOn?.layers.push(...TD_LAYERS);
    });
    draw.stop.mockImplementation(() => {
        if (!drawnOn) return;
        const own = new Set(TD_LAYERS.map((l) => l.id));
        drawnOn.layers.splice(
            0,
            drawnOn.layers.length,
            ...drawnOn.layers.filter((l) => !own.has(l.id))
        );
    });
});

afterEach(() => {
    delete (globalThis as { GeoLeaf?: unknown }).GeoLeaf;
    drawnOn = null;
});

describe("éditeur — ce que terra-draw pose est déclaré à l'adaptateur qui pilote la carte", () => {
    it("🔴 start() déclare les couches que terra-draw a posées et les sources qu'elles lisent — et rien d'autre", async () => {
        const map = fakeMap([{ id: "gl-candelabres-circle", source: "gl-src-candelabres" }]);
        const declare = hostDriving(map);
        const adapter = await adapterOn(map);

        adapter.start();

        expect(declare).toHaveBeenCalledTimes(1);
        const [owner, ids] = declare.mock.calls[0] ?? [];
        expect(owner).toBe("editor");
        expect(ids.layerIds).toEqual(TD_LAYERS.map((l) => l.id));
        expect([...ids.sourceIds].sort()).toEqual(["td-linestring", "td-point", "td-polygon"]);
    });

    it("🔴 stop() retire la déclaration", async () => {
        const map = fakeMap();
        const declare = hostDriving(map);
        const adapter = await adapterOn(map);
        adapter.start();
        declare.mockClear();

        adapter.stop();

        expect(declare).toHaveBeenCalledWith("editor", null);
    });

    it("🔴 destroy() retire la déclaration", async () => {
        const map = fakeMap();
        const declare = hostDriving(map);
        const adapter = await adapterOn(map);
        adapter.start();
        declare.mockClear();

        adapter.destroy();

        expect(declare).toHaveBeenCalledWith("editor", null);
    });

    it("une carte sans getLayersOrder (double partiel) : start() démarre terra-draw sans rien déclarer", async () => {
        const map = fakeMap();
        const partial = { ...map, getLayersOrder: undefined };
        const declare = hostDriving(partial);
        drawnOn = map;
        const adapter = await createTerraDrawAdapter(
            partial as never,
            { enabled: true } as never,
            CALLBACKS
        );

        expect(() => adapter.start()).not.toThrow();
        expect(draw.start).toHaveBeenCalled();
        expect(declare).not.toHaveBeenCalled();
    });
});
