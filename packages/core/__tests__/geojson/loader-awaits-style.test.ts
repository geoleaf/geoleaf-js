/**
 * THE WAIT ON THE STYLE — a GeoJSON layer the engine refused on a loading style is created once
 * the style is loaded.
 *
 * MapLibre throws "Style is not done loading" on `addSource` while the style itself is loading.
 * On a first boot the requests in front of the creation (the layer's default style, its data
 * file) usually give the style time to finish; on a remount (`mount` / `unmount` / `mount` in one
 * page) everything is cached, and a layer whose data is written inline reached the adapter
 * first: the error was swallowed by the profile loader, the layer was never registered, and
 * `ready` resolved on a map without it.
 *
 * What is proven here, through the loader's single-layer path:
 *
 *   1. the engine refuses on a loading style → the load stays pending, nothing is registered;
 *      the style flips loaded and the engine says so (`sourcedata`, the emission that most often
 *      carries the flip) → the layer is created, and the load resolves;
 *   2. `isStyleLoaded()` is false but the engine ACCEPTS (sources or tiles in flight — a state
 *      `addSource` does not refuse) → the layer is created at once, without waiting: waiting
 *      there would queue every layer behind the sources and tiles in flight;
 *   3. a refusal on a loaded style is not the style window → it propagates, nothing waits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    LoaderSingleLayer,
    setupSingleLayerDeps,
} from "../../src/kernel/geojson/loader/single-layer.js";

const state = vi.hoisted(() => ({
    layers: new Map(),
    options: {},
    adapter: null as unknown,
}));

vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: { state, setLayerCollection: () => {} },
}));

vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

type Listener = () => void;

/** A native map whose style readiness the test drives, with a real listener table. */
function makeNativeMap(loaded: boolean) {
    const listeners = new Map<string, Set<Listener>>();
    const native = {
        loaded,
        isStyleLoaded: () => native.loaded,
        on: vi.fn((type: string, fn: Listener) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)?.add(fn);
        }),
        off: vi.fn((type: string, fn: Listener) => {
            listeners.get(type)?.delete(fn);
        }),
        emit(type: string) {
            for (const fn of [...(listeners.get(type) ?? [])]) fn();
        },
        listenerCount(): number {
            let n = 0;
            for (const set of listeners.values()) n += set.size;
            return n;
        },
    };
    return native;
}

function makeDeps() {
    return {
        getLayerManager: () => ({ updateLayerVisibilityByZoom: vi.fn(), setLayerStyle: vi.fn() }),
        getLoader: () => undefined,
        getConfig: () => ({ getActiveProfileId: () => null, get: () => null }),
        getFeatureValidator: () => undefined,
        getLayerConfig: () => ({
            buildLayerOptions: () => ({}),
            inferGeometryType: () => "point",
            loadDefaultStyle: vi.fn().mockResolvedValue(null),
        }),
        getVectorTiles: () => null,
        getCluster: () => undefined,
        getUtils: () => undefined,
        getNotifications: () => null,
        getCore: () => undefined,
        getPopupTooltip: () => undefined,
        getLabels: () => null,
        getWorkerManager: () => ({ isAvailable: () => false }),
        getDataConverter: () => ({ autoConvert: (x: unknown) => x }),
        getNormalizer: () => undefined,
        getAllLayerConfigs: () => [],
        setAllLayerConfigs: () => {},
    } as unknown as Parameters<typeof setupSingleLayerDeps>[0];
}

/** Lets every pending microtask and timer-free continuation run. */
async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

function inlineDef() {
    return { id: "sites", _cachedData: { type: "FeatureCollection", features: [] } };
}

describe("geojson loader — a layer the engine refused waits for the map's style", () => {
    let native: ReturnType<typeof makeNativeMap>;
    let addGeoJSONLayer: ReturnType<typeof vi.fn>;

    /**
     * @param loaded - What `isStyleLoaded()` answers at first.
     * @param refuse - When the engine refuses `addSource`: while the style loads (`"loading"`,
     *   as MapLibre does), never (`"never"`: sources in flight), or always (`"always"`).
     */
    function mountAdapter(
        loaded: boolean,
        refuse: "loading" | "never" | "always" = "loading"
    ): void {
        native = makeNativeMap(loaded);
        addGeoJSONLayer = vi.fn(() => {
            if (refuse === "always") throw new Error("Source already exists.");
            if (refuse === "loading" && !native.isStyleLoaded()) {
                throw new Error("Style is not done loading.");
            }
        });
        state.adapter = {
            addGeoJSONLayer,
            getNativeMap: () => native,
            getLayerRegistry: () => ({ getSubLayerIds: () => [] }),
        };
    }

    beforeEach(() => {
        state.layers = new Map();
        setupSingleLayerDeps(makeDeps());
    });

    afterEach(() => {
        state.adapter = null;
    });

    it("waits for the style when the engine refuses on a loading one, then creates the layer", async () => {
        mountAdapter(false);
        let settled = false;
        const load = LoaderSingleLayer._loadSingleLayer("sites", "Sites", inlineDef(), {}).then(
            (r) => {
                settled = true;
                return r;
            }
        );
        await flush();

        expect(addGeoJSONLayer, "the creation is tried at once").toHaveBeenCalledTimes(1);
        expect(settled).toBe(false);
        expect(state.layers.has("sites")).toBe(false);

        native.loaded = true;
        native.emit("sourcedata");
        const result = await load;

        expect(addGeoJSONLayer, "tried again once the style is loaded").toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ id: "sites" });
        expect(state.layers.has("sites")).toBe(true);
        // Nothing left listening once the wait is over.
        expect(native.listenerCount()).toBe(0);
    });

    it("does not wait when the engine accepts, even while sources are in flight", async () => {
        mountAdapter(false, "never");
        const result = await LoaderSingleLayer._loadSingleLayer("sites", "Sites", inlineDef(), {});

        expect(addGeoJSONLayer).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ id: "sites" });
        expect(native.listenerCount(), "a wait was armed").toBe(0);
    });

    it("propagates a refusal on a loaded style, without waiting", async () => {
        mountAdapter(true, "always");
        await expect(
            LoaderSingleLayer._loadSingleLayer("sites", "Sites", inlineDef(), {})
        ).rejects.toThrow("Source already exists.");
        expect(addGeoJSONLayer).toHaveBeenCalledTimes(1);
        expect(native.listenerCount()).toBe(0);
    });

    it("creates the layer at once when the style is already loaded", async () => {
        mountAdapter(true);
        const result = await LoaderSingleLayer._loadSingleLayer("sites", "Sites", inlineDef(), {});

        expect(addGeoJSONLayer).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ id: "sites" });
    });
});
