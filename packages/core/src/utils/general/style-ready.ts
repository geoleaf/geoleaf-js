/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Waiting for a map's style to be ready — the one reliable wake-up, in one place.
 *
 * MapLibre refuses `addSource` / `addLayer` while `isStyleLoaded()` is false, by THROWING
 * "Style is not done loading". The map is born on an inline empty style that loads
 * asynchronously, and every `setStyle` opens the same window again — so anything that builds
 * a source early, at boot or during a basemap switch, has to wait.
 *
 * 🛑 WAITING FOR ONE `styledata` IS NOT WAITING FOR THE STYLE. Measured on `deploy-full` /
 * `tourism` at boot (the reasoning is written out in `kernel/basemaps/registry.ts`, where it was
 * paid for): the last `styledata` lands ~140 ms BEFORE `isStyleLoaded()` flips, and none
 * follows — the flip is carried by a `sourcedata`, and `idle` may never come on a rich profile.
 * A single `once("styledata")` therefore resumes on a style still loading. The predicate is
 * re-tested on each of the three events, and the listener leaves as soon as it holds.
 *
 * @version 3.12.0
 */

/**
 * The events on which the style's readiness is re-tested. Their union is what makes the
 * wake-up reliable: `styledata` for the style, `sourcedata` for the flip that is most often
 * carried by a source, `idle` as a net for a map that settles without either.
 */
export const STYLE_READY_EVENTS = ["styledata", "sourcedata", "idle"] as const;

/** The members of a map this reads — a structural view, so no engine type is imported. */
export interface StyleReadyMap {
    isStyleLoaded(): boolean | void;
    on(type: string, listener: () => void): unknown;
    off?(type: string, listener: () => void): unknown;
}

/**
 * Resolves once the map reports its style — and the style's sources — loaded.
 *
 * Resolves at once when it already is. Otherwise it listens on {@link STYLE_READY_EVENTS},
 * re-tests `isStyleLoaded()` on each emission, and detaches from all three when it holds. It
 * never rejects and has no deadline: a map whose style never loads can build nothing anyway,
 * and a timeout would only turn that into a second, later failure.
 *
 * @param map - The native map (or any object with its `isStyleLoaded` / `on` / `off`).
 * @returns A promise settled when `addSource` / `addLayer` may be called.
 * @example
 * await whenStyleReady(map);
 * map.addSource("gl-src-roads", spec);
 */
export function whenStyleReady(map: StyleReadyMap): Promise<void> {
    if (map.isStyleLoaded()) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const onEvent = () => {
            if (!map.isStyleLoaded()) return;
            for (const evt of STYLE_READY_EVENTS) map.off?.(evt, onEvent);
            resolve();
        };
        for (const evt of STYLE_READY_EVENTS) map.on(evt, onEvent);
    });
}
