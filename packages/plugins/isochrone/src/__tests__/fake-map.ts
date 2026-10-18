/**
 * @geoleaf-plugins/isochrone — a map adapter that keeps a drawing order
 *
 * Places a layer where the core's adapter does: under the lowest STRICTLY higher rank, above
 * its equals. `setLayerZIndex` moves it by the same rule, so the order a test reads is the order
 * a real map would draw — without an engine.
 */
import { vi } from "vitest";

import type { IsochroneMap } from "../map-binding.js";

/** A layer as the fake holds it. */
export interface FakeLayer {
    id: string;
    data: unknown;
    options: Record<string, unknown>;
    zIndex: number;
    visible: boolean;
    style: Record<string, unknown>;
}

/** The fake, and what a test reads from it. */
export interface FakeMap extends IsochroneMap {
    /** Layers, BOTTOM first — the order a renderer draws them in. */
    readonly layers: FakeLayer[];
    /** Markers on the map, by id. */
    readonly markers: Map<string, { lat: number; lng: number; options: object }>;
    /** The map's container. */
    readonly container: HTMLElement;
    /** Every call, in order, by member name. */
    readonly calls: string[];
    /** Ids top first — what the stack's order must equal. */
    topFirst(): string[];
    /** The native map behind the adapter — which the plugin must never write. */
    readonly native: { __geoleafExclusiveMode?: boolean };
    /** Whether a tool holds exclusive mode, as the core's adapter tracks it. */
    readonly exclusive: { held: boolean };
    /** Who listens to a click, through the adapter. */
    readonly clickHandlers: Set<(e: unknown) => void>;
    /** Clicks the map: the adapter hands its subscribers the event, `latlng` added. */
    click(lng: number, lat: number): void;
    on(event: string, handler: (e: unknown) => void): void;
    off(event: string, handler: (e: unknown) => void): void;
    getCanvas(): HTMLElement;
    getNativeMap(): { __geoleafExclusiveMode?: boolean };
    enterExclusiveMode?(cursor?: string): void;
    exitExclusiveMode?(): void;
}

/**
 * Inserts a layer at the place its rank gives it.
 *
 * @param layers Bottom first.
 * @param layer The layer to place.
 */
function place(layers: FakeLayer[], layer: FakeLayer): void {
    const above = layers.findIndex((l) => l.zIndex > layer.zIndex);
    layers.splice(above < 0 ? layers.length : above, 0, layer);
}

/**
 * Builds the fake.
 *
 * @param options `rerank: "absent"` for a core without `setLayerZIndex`, `"refuses"` for one
 *   that answers `false`; `exclusive: "absent"` for a core without exclusive mode (< 3.17.0).
 * @returns The fake adapter.
 */
export function createFakeMap(
    options: { rerank?: "works" | "absent" | "refuses"; exclusive?: "works" | "absent" } = {}
): FakeMap {
    const layers: FakeLayer[] = [];
    const markers = new Map<string, { lat: number; lng: number; options: object }>();
    const container = document.createElement("div");
    const calls: string[] = [];
    // Not placed in the container: what the plugin adds there is what a test counts.
    const canvas = document.createElement("canvas");
    const native: { __geoleafExclusiveMode?: boolean } = {};
    const clickHandlers = new Set<(e: unknown) => void>();
    const exclusive = { held: false };
    const find = (id: string): FakeLayer | undefined => layers.find((l) => l.id === id);

    const map: FakeMap = {
        layers,
        markers,
        container,
        calls,
        topFirst: () => layers.map((l) => l.id).reverse(),
        native,
        exclusive,
        clickHandlers,
        click: (lng: number, lat: number) => {
            for (const handler of [...clickHandlers])
                handler({ lngLat: { lng, lat }, latlng: { lat, lng } });
        },
        on: vi.fn((event: string, handler: (e: unknown) => void) => {
            if (event === "click") clickHandlers.add(handler);
        }),
        off: vi.fn((event: string, handler: (e: unknown) => void) => {
            if (event === "click") clickHandlers.delete(handler);
        }),
        getCanvas: vi.fn(() => canvas),
        getNativeMap: vi.fn(() => native),
        addGeoJSONLayer: vi.fn((id: string, data: unknown, opts: Record<string, unknown>) => {
            calls.push("addGeoJSONLayer");
            if (find(id)) throw new Error(`layer "${id}" already exists`);
            const { zIndex, visible, ...style } = opts;
            place(layers, {
                id,
                data,
                options: opts,
                zIndex: typeof zIndex === "number" ? zIndex : 0,
                visible: visible !== false,
                style,
            });
        }),
        removeLayer: vi.fn((id: string) => {
            calls.push("removeLayer");
            const index = layers.findIndex((l) => l.id === id);
            if (index >= 0) layers.splice(index, 1);
        }),
        hasLayer: vi.fn((id: string) => find(id) !== undefined),
        showLayer: vi.fn((id: string) => {
            calls.push("showLayer");
            const layer = find(id);
            if (layer) layer.visible = true;
        }),
        hideLayer: vi.fn((id: string) => {
            calls.push("hideLayer");
            const layer = find(id);
            if (layer) layer.visible = false;
        }),
        setLayerStyle: vi.fn((id: string, style: Record<string, unknown>) => {
            calls.push("setLayerStyle");
            const layer = find(id);
            // Like the adapter: the paint is rebuilt from what is given, nothing is merged.
            if (layer) layer.style = { ...style };
        }),
        createMarker: vi.fn((id: string, position: { lat: number; lng: number }, o: object) => {
            calls.push("createMarker");
            markers.set(id, { ...position, options: o });
        }),
        removeMarker: vi.fn((id: string) => {
            calls.push("removeMarker");
            markers.delete(id);
        }),
        getContainer: vi.fn(() => container),
    };
    if (options.exclusive !== "absent") {
        // As the core's adapter: the cursor found at the first entry is kept, a given cursor is
        // painted, and an exit puts back only what an entry painted.
        let saved: string | undefined;
        map.enterExclusiveMode = vi.fn((cursor?: string) => {
            if (cursor !== undefined) {
                if (saved === undefined) saved = canvas.style.cursor;
                canvas.style.cursor = cursor;
            }
            exclusive.held = true;
        });
        map.exitExclusiveMode = vi.fn(() => {
            if (saved !== undefined) canvas.style.cursor = saved;
            saved = undefined;
            exclusive.held = false;
        });
    }
    if (options.rerank !== "absent") {
        map.setLayerZIndex = vi.fn((id: string, zIndex: number) => {
            calls.push("setLayerZIndex");
            if (options.rerank === "refuses") return false;
            const index = layers.findIndex((l) => l.id === id);
            const layer = layers[index];
            if (!layer) return false;
            layers.splice(index, 1);
            layer.zIndex = zIndex;
            place(layers, layer);
            return true;
        });
    }
    return map;
}
