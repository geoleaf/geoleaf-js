/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * MapLibre DOM-marker helpers — the marker lifecycle (create / remove / move),
 * extracted from `MaplibreAdapter` to keep the adapter within the file-size budget.
 *
 * Free functions operating on the adapter-owned marker registry; behaviour is
 * identical to the former inline methods (same DOM construction, same security
 * sanitisation, same reuse-on-duplicate-id semantics). `maplibregl` is the runtime
 * global (loaded via <script>, typed in `src/global.d.ts`), used the same way as in
 * the sibling `maplibre-*.ts` builders.
 */
import type { GeoLeafLatLng, GeoLeafMarkerOptions } from "../../contracts/map-adapter.contract.ts";
import { DOMSecurity } from "../../kernel/security/dom-security.js";
import { toMapLibreLngLat, SVG_ALLOWED_TAGS } from "./maplibre-primitives.js";
import type { MaplibreMap, MaplibreMarker } from "./maplibre-adapter-types.ts";

/** Live markers keyed by GeoLeaf marker id — owned by the adapter, mutated in place. */
type MarkerRegistry = Map<string, MaplibreMarker>;

/**
 * Creates a DOM marker at the given position and adds it to the map. Reuses an
 * existing marker (updates its position) instead of throwing, which lets popup
 * anchors reuse ids.
 */
export function buildMarker(
    map: MaplibreMap,
    markers: MarkerRegistry,
    id: string,
    position: GeoLeafLatLng,
    options?: GeoLeafMarkerOptions
): void {
    if (markers.has(id)) {
        // Update position instead of throwing — allows reuse for popup anchors
        moveMarker(markers, id, position);
        return;
    }

    const markerOpts: Record<string, unknown> = {};

    // Custom DOM element from icon SVG string and/or a CSS class.
    // @security Defence-in-depth: sanitise SVG even though icons should be static.
    const iconHtml = options?.icon;
    const markerClass = options?.className;
    if (iconHtml || markerClass) {
        const el = document.createElement("div");
        if (iconHtml) {
            DOMSecurity.setSafeHTML(el, iconHtml, SVG_ALLOWED_TAGS);
        }
        // CSP-safe styling hook: class set via the DOM API is not subject to style-src.
        if (markerClass) {
            for (const cls of String(markerClass).split(/\s+/)) {
                if (cls) el.classList.add(cls);
            }
        }
        el.style.cursor = "pointer";
        if (options?.iconSize) {
            el.style.width = options.iconSize[0] + "px";
            el.style.height = options.iconSize[1] + "px";
        }
        // Accessibility: expose marker to screen readers via aria-label (WCAG 1.1.1)
        if (options?.title) {
            el.setAttribute("aria-label", String(options.title));
            el.setAttribute("role", "img");
        }
        markerOpts.element = el;
    }

    if (options?.draggable) markerOpts.draggable = true;
    if (options?.iconAnchor) {
        markerOpts.offset = [options.iconAnchor[0], options.iconAnchor[1]];
    }

    const marker = new maplibregl.Marker(markerOpts);
    marker.setLngLat(toMapLibreLngLat(position)).addTo(map);
    markers.set(id, marker);
}

/** Removes the marker with the given id from the map and the registry (no-op if unknown). */
export function dropMarker(markers: MarkerRegistry, id: string): void {
    const marker = markers.get(id);
    if (!marker) return;
    marker.remove();
    markers.delete(id);
}

/** Moves an existing marker to a new position (no-op if unknown). */
export function moveMarker(markers: MarkerRegistry, id: string, position: GeoLeafLatLng): void {
    const marker = markers.get(id);
    if (!marker) return;
    marker.setLngLat(toMapLibreLngLat(position));
}
