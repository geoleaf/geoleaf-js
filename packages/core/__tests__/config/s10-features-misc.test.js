/**
 * Config-contract Phase C / C1 — B2 features family: mapOptions.preserveDrawingBuffer.
 *
 * Verifies the consumer end of the chain (maplibre-adapter.ts:113): a truthy
 * MapInitOptions.preserveDrawingBuffer makes the adapter construct the MapLibre
 * map with `preserveDrawingBuffer: true` (needed for canvas capture/print). The
 * upstream mapping is map/facade.ts:98 (`=== true ? true : undefined`).
 *
 * Consumer: src/adapters/maplibre/maplibre-adapter.ts. Inventory B2.
 * (MapLibre GL mock pattern mirrors __tests__/adapters/maplibre-adapter.test.js.)
 */

vi.mock("../../src/kernel/events/event-bus.js", () => ({
    dispatchGeoLeafEvent: vi.fn(),
}));

import { MaplibreAdapter } from "../../src/adapters/maplibre/maplibre-adapter.js";

describe("config B2 — mapOptions.preserveDrawingBuffer (maplibre-adapter)", () => {
    let captured;
    let mockMapInstance;

    beforeEach(() => {
        captured = null;
        mockMapInstance = {
            on: vi.fn(),
            off: vi.fn(),
            once: vi.fn(),
            remove: vi.fn(),
            getCenter: vi.fn().mockReturnValue({ lat: 45, lng: -73 }),
            getZoom: vi.fn().mockReturnValue(10),
            getBounds: vi.fn().mockReturnValue({
                getSouthWest: () => ({ lat: 44, lng: -74 }),
                getNorthEast: () => ({ lat: 46, lng: -72 }),
            }),
            jumpTo: vi.fn(),
            easeTo: vi.fn(),
            flyTo: vi.fn(),
            fitBounds: vi.fn(),
            getContainer: vi.fn().mockReturnValue(document.createElement("div")),
            getCanvas: vi.fn().mockReturnValue({ style: { cursor: "" } }),
            project: vi.fn().mockReturnValue({ x: 100, y: 200 }),
            unproject: vi.fn().mockReturnValue({ lat: 45, lng: -73 }),
            resize: vi.fn(),
            addControl: vi.fn(),
            removeControl: vi.fn(),
            addSource: vi.fn(),
            addLayer: vi.fn(),
            getLayer: vi.fn(() => null),
        };
        globalThis.maplibregl = {
            Map: vi.fn().mockImplementation(
                class {
                    constructor(opts) {
                        captured = opts;
                        return mockMapInstance;
                    }
                }
            ),
        };
    });

    afterEach(() => {
        delete globalThis.maplibregl;
    });

    function init(mapInitOptions) {
        const adapter = new MaplibreAdapter();
        adapter.init({
            container: "map",
            center: { lat: 45, lng: -73 },
            zoom: 10,
            ...mapInitOptions,
        });
        return captured;
    }

    it("preserveDrawingBuffer:true → MapLibre map built with preserveDrawingBuffer:true", () => {
        expect(init({ preserveDrawingBuffer: true }).preserveDrawingBuffer).toBe(true);
    });

    it("preserveDrawingBuffer:false → option omitted (MapLibre default)", () => {
        expect(init({ preserveDrawingBuffer: false }).preserveDrawingBuffer).toBeUndefined();
    });

    it("preserveDrawingBuffer absent → option omitted", () => {
        expect(init({}).preserveDrawingBuffer).toBeUndefined();
    });
});
