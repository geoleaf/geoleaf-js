/**
 * A MapLibre map whose STYLE half follows the engine — for the kernel tests that must prove an
 * ORDER or a LIFECYCLE. The shared mock cannot: it ignores `beforeId`, accepts any removal, and
 * its `setStyle` does nothing, so a layer in the wrong place and a layer in the right one read
 * the same there.
 *
 * Read in MapLibre GL JS 6.7.0 (`Map._diffStyle`, `Style.setState`, `addSource`, `removeSource`,
 * `addLayer`, `removeLayer`):
 * - a style given by URL stays PENDING until delivered, and a newer `setStyle` aborts it;
 * - at delivery `transformStyle` runs on the live style. When what it returns EQUALS the live
 *   style, the diff holds no operation and NOTHING is emitted — no `style.load`;
 * - otherwise the style becomes what the transform returned, then `style.load` fires;
 * - a style the validation refuses has been through the transform all the same; it fires an
 *   `error`, is not applied, and nothing else is emitted (`deliverRefused`);
 * - `addSource` throws on a known id; `removeSource` throws on an unknown one and refuses, with
 *   an `error` event, while a layer reads the source;
 * - `addLayer` refuses a known id and a missing `beforeId` with an `error` event, adding nothing;
 * - `removeLayer` and `setLayoutProperty` report an unknown id with an `error` event.
 *
 * And of the TERRAIN half (`Map.setTerrain`, `Style._load`, `Map._contextRestored`):
 * - `setTerrain` throws while a style is being REBUILT, and on a source the style does not have;
 *   every call that goes through fires `terrain`, the map as its `target`;
 * - a style the engine rebuilds resets the terrain to `null` by itself, then fires `style.load`.
 *   A style it diffs (`setStyle` above) leaves the terrain alone;
 * - a lost WebGL context is restored with its terrain: `style.load` fires, nothing was reset.
 *
 * The CAMERA half is driven by hand (`move`, `rest`, `stop`): `jumpTo` and `easeTo` stay spies
 * that move nothing, so a test says exactly which tilt the kernel reads and when a movement ends.
 *
 * It is not the engine: nothing renders, and a source exposes its `tiles` at once where the
 * engine sets them a tick later. The real one is judged by the E2E suite.
 */

import { vi } from "vitest";

/** A style layer as the fake engine stores it. */
export interface LayerSpec {
    id: string;
    type: string;
    source?: string;
    metadata?: Record<string, unknown>;
    paint?: Record<string, unknown>;
    layout?: Record<string, unknown>;
    [key: string]: unknown;
}

/** A style as `getStyle()` returns it. */
export interface StyleJSON {
    version: number;
    name?: string;
    sources: Record<string, Record<string, unknown>>;
    layers: LayerSpec[];
    [key: string]: unknown;
}

/** The `setStyle` options the kernel passes. */
export interface SetStyleOptions {
    diff?: boolean;
    transformStyle?: (previous: StyleJSON | undefined, next: StyleJSON) => StyleJSON;
}

interface MockMapBase {
    fire: (event: string, data?: unknown) => unknown;
    on: (event: string, handler: (data: unknown) => void) => unknown;
    [key: string]: unknown;
}

const g = globalThis as unknown as {
    maplibregl: { __createMockMap: () => MockMapBase };
};

/** The fake engine: the shared mock's surface, with a style half that behaves. */
export type StyleEngine = ReturnType<typeof createStyleEngine>;

/**
 * Builds a fake engine. The events, controls, camera and images come from the shared mock.
 *
 * @returns The map, plus the handles a test drives it with.
 */
export function createStyleEngine() {
    const map = g.maplibregl.__createMockMap();
    let style: StyleJSON = { version: 8, sources: {}, layers: [] };
    let loaded = true;
    let pending: { url: string; options: SetStyleOptions | undefined } | null = null;
    let terrain: { source: string; exaggeration?: number } | null = null;
    /** A style is being rebuilt: the engine refuses every write to it. */
    let rebuilding = false;
    let pitch = 0;
    let moving = false;
    const errors: string[] = [];

    const clone = <T>(value: T): T => structuredClone(value);
    const findLayer = (id: string): LayerSpec | undefined => style.layers.find((l) => l.id === id);
    const refuse = (message: string): void => {
        errors.push(message);
        map.fire("error", { error: new Error(message) });
    };

    /** `Style.setState`: the transform runs NOW, on the style as it stands NOW. */
    function apply(json: StyleJSON, options: SetStyleOptions | undefined): void {
        const previous = clone(style);
        const next = options?.transformStyle
            ? options.transformStyle(previous, clone(json))
            : clone(json);
        // No operation to perform: `setState` returns false before it fires anything.
        if (JSON.stringify(next) === JSON.stringify(style)) return;
        style = clone(next);
        map.fire("styledata", { dataType: "style" });
        map.fire("style.load");
    }

    const styled = Object.assign(map, {
        isStyleLoaded: vi.fn(() => loaded),
        loaded: vi.fn(() => loaded),
        getStyle: vi.fn(() => clone(style)),
        getLayersOrder: vi.fn(() => style.layers.map((l) => l.id)),
        addSource: vi.fn((id: string, spec: Record<string, unknown>) => {
            if (rebuilding) throw new Error("Style is not done loading.");
            if (style.sources[id]) throw new Error(`Source "${id}" already exists.`);
            style.sources[id] = clone(spec);
            return map;
        }),
        getSource: vi.fn((id: string) => {
            const spec = style.sources[id];
            if (!spec) return undefined;
            return {
                ...clone(spec),
                setData: (data: unknown) => {
                    const live = style.sources[id];
                    if (live) live.data = clone(data);
                },
                setTiles: (tiles: string[]) => {
                    const live = style.sources[id];
                    if (live) live.tiles = clone(tiles);
                },
            };
        }),
        removeSource: vi.fn((id: string) => {
            if (!style.sources[id]) throw new Error(`There is no source with this ID=${id}`);
            const user = style.layers.find((l) => l.source === id);
            if (user) {
                refuse(`Source "${id}" cannot be removed while layer "${user.id}" is using it.`);
                return map;
            }
            delete style.sources[id];
            return map;
        }),
        addLayer: vi.fn((spec: LayerSpec, beforeId?: string) => {
            if (findLayer(spec.id)) {
                refuse(`Layer "${spec.id}" already exists on this map.`);
                return map;
            }
            if (beforeId === undefined) {
                style.layers.push(clone(spec));
                return map;
            }
            const at = style.layers.findIndex((l) => l.id === beforeId);
            if (at < 0) {
                refuse(`Cannot add layer "${spec.id}" before non-existing layer "${beforeId}".`);
                return map;
            }
            style.layers.splice(at, 0, clone(spec));
            return map;
        }),
        getLayer: vi.fn((id: string) => {
            const layer = findLayer(id);
            return layer ? clone(layer) : undefined;
        }),
        removeLayer: vi.fn((id: string) => {
            if (!findLayer(id)) {
                refuse(`Cannot remove non-existing layer "${id}".`);
                return map;
            }
            style.layers = style.layers.filter((l) => l.id !== id);
            return map;
        }),
        setLayoutProperty: vi.fn((id: string, name: string, value: unknown) => {
            const layer = style.layers.find((l) => l.id === id);
            if (!layer) {
                refuse(`Cannot style non-existing layer "${id}".`);
                return map;
            }
            layer.layout = { ...(layer.layout ?? {}), [name]: value };
            return map;
        }),
        getFilter: vi.fn((id: string) => findLayer(id)?.filter),
        setFilter: vi.fn((id: string, filter: unknown) => {
            const layer = style.layers.find((l) => l.id === id);
            if (layer) layer.filter = filter ?? undefined;
            return map;
        }),
        setTerrain: vi.fn((options: { source: string; exaggeration?: number } | null) => {
            if (rebuilding) throw new Error("Style is not done loading.");
            if (options && !style.sources[options.source]) {
                throw new Error(
                    `cannot load terrain, because there exists no source with ID: ${options.source}`
                );
            }
            terrain = options ? clone(options) : null;
            map.fire("terrain", { terrain: options, target: map });
            return map;
        }),
        getTerrain: vi.fn(() => (terrain ? clone(terrain) : null)),
        getPitch: vi.fn(() => pitch),
        getMaxPitch: vi.fn(() => 60),
        isMoving: vi.fn(() => moving),
        setStyle: vi.fn((target: StyleJSON | string, options?: SetStyleOptions) => {
            // A newer request aborts the one still downloading, inline or not.
            pending = null;
            if (typeof target === "string") pending = { url: target, options };
            // An inline style needs no download: MapLibre diffs it synchronously.
            else apply(target, options);
            return map;
        }),
    });

    return Object.assign(styled, {
        /** Flips `isStyleLoaded()`, as the sources in flight settle. */
        setLoaded(value: boolean): void {
            loaded = value;
        },
        /** The URL `setStyle` is downloading, or `null`. */
        pendingUrl(): string | null {
            return pending?.url ?? null;
        },
        /** The download completes: MapLibre runs the transform and applies what it returned. */
        deliver(json: StyleJSON): void {
            const request = pending;
            if (!request) throw new Error("aucun style en attente de téléchargement");
            pending = null;
            apply(json, request.options);
        },
        /**
         * The download completes with a style the validation refuses: the transform has run, an
         * `error` fires, and the live style is left as it was — no `style.load`.
         */
        deliverRefused(json: StyleJSON): void {
            const request = pending;
            if (!request) throw new Error("aucun style en attente de téléchargement");
            pending = null;
            request.options?.transformStyle?.(clone(style), clone(json));
            refuse("style refusé par la validation");
        },
        /** The live style, as `getStyle()` serializes it. */
        style(): StyleJSON {
            return clone(style);
        },
        /** Ids of the live layers, bottom to top. */
        order(): string[] {
            return style.layers.map((l) => l.id);
        },
        /** Every refusal the engine reported through an `error` event, oldest first. */
        refusals(): string[] {
            return [...errors];
        },
        /** A movement in progress reaches `value` degrees of tilt: `pitch` fires, not `moveend`. */
        move(value: number): void {
            moving = true;
            pitch = value;
            map.fire("pitch", { target: map });
        },
        /** The movement in progress ends where it is: `moveend` fires. */
        stop(): void {
            moving = false;
            map.fire("moveend", { target: map });
        },
        /** A whole movement that ends at `value` degrees of tilt. */
        rest(value: number): void {
            this.move(value);
            this.stop();
        },
        /** Sets the tilt and the moving flag with NO event — a camera a test finds as it is. */
        setCamera(value: number, isMoving = false): void {
            pitch = value;
            moving = isMoving;
        },
        /** The engine starts REBUILDING its style: until it lands, every style write throws. */
        startRebuild(): void {
            rebuilding = true;
        },
        /**
         * The rebuilt style lands: it holds `json` and nothing else, the terrain is reset by the
         * engine itself — `terrain` fires —, then `style.load`.
         */
        landRebuild(json: StyleJSON = { version: 8, sources: {}, layers: [] }): void {
            style = clone(json);
            rebuilding = false;
            terrain = null;
            map.fire("terrain", { terrain: null, target: map });
            map.fire("styledata", { dataType: "style" });
            map.fire("style.load");
        },
        /** The WebGL context is lost: the style is gone until `restoreContext`. */
        loseContext(): void {
            rebuilding = true;
            map.fire("webglcontextlost", { target: map });
        },
        /** The context is back, the style replayed as it was — its terrain included. */
        restoreContext(): void {
            rebuilding = false;
            map.fire("styledata", { dataType: "style" });
            map.fire("style.load");
        },
    });
}
