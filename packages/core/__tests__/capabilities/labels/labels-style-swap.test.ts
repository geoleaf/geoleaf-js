/**
 * The labels capability rebuilds its label layers when the map's style is REPLACED.
 *
 * A label layer is not the adapter's: `label-renderer.ts` adds it to the engine directly, on its
 * layer's source. A basemap switch that replaces the style carries the source into the incoming
 * style and not the label layer, which the diff removes — and the capability's bookkeeping still
 * read "shown", so no zoom rebuilt it. The capability now listens to the native `style.load`,
 * which every replacement emits (the silent boot activation included, where
 * `geoleaf:basemap:change` is not), and rebuilds each labelled layer through `refreshLabels`.
 *
 * The kernel half — the real boot, the real transform, a fake engine's diff path — is
 * `__tests__/basemaps/vector-basemap-boot-keeps-layers.test.ts`. The cases marked 🔴 were seen red
 * on the code without the subscription.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const logMock = vi.hoisted(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
}));
const createSymbolLayer = vi.hoisted(() => vi.fn());
const getLayerById = vi.hoisted(() => vi.fn());

vi.mock("../../../src/utils/log/index.js", () => ({ Log: logMock }));
vi.mock("../../../src/capabilities/labels/label-renderer.ts", () => ({
    LabelRenderer: { createSymbolLayerForMapLibre: createSymbolLayer },
}));
vi.mock("../../../src/api/geoleaf.core.js", () => ({ Core: { getMap: vi.fn(() => null) } }));
vi.mock("../../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: { getLayerById: (id: string) => getLayerById(id) },
}));

const { Labels } = await import("../../../src/capabilities/labels/labels.js");
const { Core } = await import("../../../src/api/geoleaf.core.js");

type Handler = () => void;

/** A native engine that records its `style.load` subscriptions and can emit the event. */
function nativeMap() {
    const handlers = new Set<Handler>();
    return {
        on: vi.fn((event: string, handler: Handler) => {
            if (event === "style.load") handlers.add(handler);
        }),
        off: vi.fn((event: string, handler: Handler) => {
            if (event === "style.load") handlers.delete(handler);
        }),
        /** What a `setStyle` does once the incoming style is in place. */
        emitStyleLoad(): void {
            for (const handler of [...handlers]) handler();
        },
        subscribed(): number {
            return handlers.size;
        },
    };
}

type NativeMap = ReturnType<typeof nativeMap>;

/** An adapter handle whose native engine is `native`. */
function adapterOver(native: NativeMap) {
    return { getZoom: vi.fn(() => 12), on: vi.fn(), off: vi.fn(), getNativeMap: () => native };
}

const setMap = (map: unknown) =>
    (Core.getMap as unknown as { mockReturnValue(v: unknown): void }).mockReturnValue(map);

/** A visible layer whose style declares labels. */
function labelledLayer() {
    return {
        currentStyle: { label: { enabled: true, field: "name" } },
        _visibility: { current: true },
        features: [],
    };
}

beforeEach(() => {
    Labels.destroy();
    vi.clearAllMocks();
    getLayerById.mockImplementation(() => labelledLayer());
});

describe("étiquettes — reconstruites quand le style de la carte est remplacé", () => {
    it("🔴 s'abonne une seule fois à style.load sur la carte native, quel que soit le nombre de couches", async () => {
        const native = nativeMap();
        setMap(adapterOver(native));

        await Labels.enableLabels("ly-a", {}, true);
        await Labels.enableLabels("ly-b", {}, true);

        expect(native.subscribed()).toBe(1);
        setMap(null);
    });

    it("🔴 style.load reconstruit chaque couche étiquetée", async () => {
        const native = nativeMap();
        setMap(adapterOver(native));
        await Labels.enableLabels("ly-a", {}, true);
        await Labels.enableLabels("ly-b", {}, true);
        createSymbolLayer.mockClear();

        native.emitStyleLoad();

        const rebuilt = createSymbolLayer.mock.calls.map(([layerId]) => layerId);
        expect(rebuilt.sort()).toEqual(["ly-a", "ly-b"]);
        setMap(null);
    });

    it("une couche aux étiquettes éteintes n'est pas reconstruite", async () => {
        const native = nativeMap();
        setMap(adapterOver(native));
        await Labels.enableLabels("ly-a", {}, true);
        await Labels.enableLabels("ly-off", {}, true);
        Labels.disableLabels("ly-off");
        createSymbolLayer.mockClear();

        native.emitStyleLoad();

        expect(createSymbolLayer.mock.calls.map(([layerId]) => layerId)).toEqual(["ly-a"]);
        setMap(null);
    });

    it("🔴 destroy() relâche style.load sur la carte où il était posé", async () => {
        const native = nativeMap();
        setMap(adapterOver(native));
        await Labels.enableLabels("ly-a", {}, true);
        expect(native.subscribed()).toBe(1);

        Labels.destroy();

        expect(native.subscribed()).toBe(0);
        createSymbolLayer.mockClear();
        native.emitStyleLoad();
        expect(createSymbolLayer).not.toHaveBeenCalled();
        setMap(null);
    });

    it("🔴 une nouvelle carte (Core.destroy puis init) reçoit l'abonnement, l'ancienne le perd", async () => {
        const first = nativeMap();
        setMap(adapterOver(first));
        await Labels.enableLabels("ly-a", {}, true);

        const second = nativeMap();
        setMap(adapterOver(second));
        await Labels.enableLabels("ly-b", {}, true);

        expect(first.subscribed()).toBe(0);
        expect(second.subscribed()).toBe(1);
        setMap(null);
    });

    it("un adaptateur sans carte native ne fait pas échouer l'activation", async () => {
        setMap({ getZoom: vi.fn(() => 12), on: vi.fn(), off: vi.fn() });

        await expect(Labels.enableLabels("ly-a", {}, true)).resolves.toBeUndefined();
        expect(() => Labels.destroy()).not.toThrow();
        setMap(null);
    });
});
