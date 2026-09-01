/*!
 * @geoleaf-plugins/routing — Geometry publication
 *
 * Turns a computed route into GeoJSON features and hands them to the core's layer store. This is
 * the ONLY place this plugin puts anything on the map.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { Feature } from "geojson";
import { showRouteAttribution, removeRouteAttribution } from "./ui/attribution.js";
import { showStepLabels, hideStepLabels } from "./labels-seam.js";
import type { RouteResult } from "./model.js";
import { decodePolyline } from "./polyline.js";
import { roleAt } from "./composition.js";
import { getPluginConfig } from "./config.js";

/**
 * ## 🛑 This plugin does NOT draw
 *
 * It publishes features through the core's layer seam and stops there. It creates no MapLibre
 * source, adds no layer, touches no style. A second rendering pipeline alongside the core's is
 * precisely the debt the `route` capability was built to dissolve, and re-growing one inside a
 * plugin would put it back where it is harder to see.
 *
 * ## One layer, roles on the features — not one layer per role
 *
 * Every feature goes to the SAME layer and is told apart by `properties.role`:
 * `route`, `origin`, `via` (carrying its index), `destination`. The alternative — a sub-layer per
 * role — doubles the MapLibre sources per itinerary, which is the state this replaced.
 *
 * ## Why it refuses rather than writing into nothing
 *
 * `setData` on an unknown layer id is not an error the store reports: it simply has nowhere to
 * put the features. An integrator whose profile does not declare the layer would then see a
 * plugin that computes a route, says nothing, and draws nothing — with no way to tell which of
 * the three steps failed. `hasLayer` is what makes the answer say so.
 */

/** The layer id used when the profile names none. */
export const DEFAULT_LAYER_ID = "routing-route";

/** What publication answers. */
export type PublishOutcome =
    | { readonly ok: true; readonly layerId: string; readonly features: number }
    | {
          readonly ok: false;
          readonly reason: "no-layer-store" | "no-such-layer";
          readonly layerId: string;
      };

/** The minimum of the core's layer surface this module uses. */
interface LayerStore {
    hasLayer(layerId: string): boolean;
    setData(layerId: string, features: Feature[]): void;
    clear(layerId: string): void;
}

/**
 * The layer this plugin writes to.
 *
 * ⚠️ NOT exported: nothing outside this module needs it. A caller already learns which layer was
 * written — `PublishOutcome` carries `layerId` in every case, success and refusal alike, which is
 * what lets a message name it. Exporting the getter as well would be a second way to ask the same
 * question, and the two would drift the day the resolution stops being a plain config read.
 *
 * @returns The configured id, or the default.
 */
function routeLayerId(): string {
    const v = getPluginConfig().layerId;
    return typeof v === "string" && v.length > 0 ? v : DEFAULT_LAYER_ID;
}

/**
 * The core's layer store, or `null` when the host is not there.
 *
 * @returns The store.
 */
function layerStore(): LayerStore | null {
    const gl = (globalThis as { GeoLeaf?: { Layers?: unknown } }).GeoLeaf;
    const layers = gl?.Layers as LayerStore | undefined;
    return typeof layers?.setData === "function" && typeof layers?.hasLayer === "function"
        ? layers
        : null;
}

/**
 * Builds the GeoJSON a route renders as.
 *
 * Exported for its own sake: the features are worth testing without a host, and a caller that
 * wants the geometry for something other than the map (an export, a bounds computation) should
 * not have to publish it to get it.
 *
 * @param route A computed route.
 * @returns The line, then one point per waypoint, in travel order.
 */
export function routeFeatures(route: RouteResult): Feature[] {
    const coordinates = decodePolyline(route.geometry, 5);
    const features: Feature[] = [];

    // The line first: a renderer that paints in source order draws the markers ON the line
    // rather than under it, which is the order a reader expects.
    if (coordinates.length >= 2) {
        features.push({
            type: "Feature",
            id: "route",
            geometry: { type: "LineString", coordinates },
            properties: {
                role: "route",
                provider: route.provider,
                distance: route.distance,
                duration: route.duration,
            },
        });
    }

    route.waypoints.forEach((wp, i) => {
        const role = roleAt(i, route.waypoints.length);
        features.push({
            type: "Feature",
            id: `waypoint-${i}`,
            geometry: { type: "Point", coordinates: [...wp.coordinates] },
            properties: {
                role,
                // The index travels with the role rather than being read back from the feature
                // order: a style that labels the stops needs "which via is this", and feature
                // order is not something a style expression can see.
                index: i,
                // Derived, never stored on the waypoint — same reason as everywhere else here.
                step: i + 1,
                ...(wp.name ? { name: wp.name } : {}),
            },
        });
    });

    return features;
}

/**
 * Publishes a route to the configured layer.
 *
 * @param route A computed route.
 * @param layerId Layer to write to. Defaults to the configured one.
 * @returns What happened, with the layer id in every case so a message can name it.
 */
export function publishRoute(route: RouteResult, layerId: string = routeLayerId()): PublishOutcome {
    const store = layerStore();
    if (!store) return { ok: false, reason: "no-layer-store", layerId };
    if (!store.hasLayer(layerId)) return { ok: false, reason: "no-such-layer", layerId };

    const features = routeFeatures(route);
    store.setData(layerId, features);
    // 🛑 The credit goes up with the geometry and comes down with it, in the same two functions.
    // Any other pairing — the panel, a lifecycle hook, the caller's discipline — has a path where
    // the route is on screen and the notice is not, and ODbL does not have a grace period for
    // "the panel was closed". The route is what requires crediting, so the route is what carries
    // the credit: `route.attribution` and never the configured provider, which may have changed.
    showRouteAttribution(route.attribution);
    // The stops already carry `properties.step`; all that remained was asking
    // the core's capability to draw it. ⚠️ After `setData`: the capability
    // reads the layer, and calling it before would hand it the previous
    // route's entities to label.
    showStepLabels(layerId);
    return { ok: true, layerId, features: features.length };
}

/**
 * Empties the route layer.
 *
 * ⚠️ `clear` and not `setData(layerId, [])`, although the contract says they are equivalent: the
 * intent is readable at the call site, and if the two ever stop being equivalent this is the one
 * that keeps meaning "empty it".
 *
 * @param layerId Layer to empty. Defaults to the configured one.
 * @returns What happened.
 */
export function clearRoute(layerId: string = routeLayerId()): PublishOutcome {
    const store = layerStore();
    if (!store) return { ok: false, reason: "no-layer-store", layerId };
    if (!store.hasLayer(layerId)) return { ok: false, reason: "no-such-layer", layerId };

    store.clear(layerId);
    removeRouteAttribution();
    hideStepLabels(layerId);
    return { ok: true, layerId, features: 0 };
}
