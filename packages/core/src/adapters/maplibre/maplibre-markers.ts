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
 * Builds the marker's custom DOM element from an icon string and/or a CSS class.
 *
 * Extracted from {@link buildMarker} to keep that function under the complexity ceiling — the
 * element's construction is a self-contained concern with five independent branches, and folding
 * it back in is what pushed the caller over.
 *
 * @param options - The marker display options, if any.
 * @returns The element, or `null` when nothing asks for a custom one (the engine then draws its
 *          own default pin).
 *
 * @security Defence-in-depth: the icon is sanitised against an SVG allow-list even though the
 * contract already requires it to be a static, hard-coded string.
 */
function buildMarkerElement(options?: GeoLeafMarkerOptions): HTMLElement | null {
    const iconHtml = options?.icon;
    const markerClass = options?.className;
    if (!iconHtml && !markerClass) return null;

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
    return el;
}

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

    const el = buildMarkerElement(options);
    if (el) markerOpts.element = el;

    if (options?.draggable) markerOpts.draggable = true;
    if (options?.iconAnchor) {
        markerOpts.offset = [options.iconAnchor[0], options.iconAnchor[1]];
    }
    // ⚠️ Relayed at CREATION, not applied afterwards: `rotationAlignment` decides which formula
    // `Marker._update` uses, and that method is subscribed to the map's `move` event — so
    // passing "map" here is what makes the engine re-derive `rotation − bearing` every frame.
    if (typeof options?.rotation === "number") markerOpts.rotation = options.rotation;
    if (options?.rotationAlignment) markerOpts.rotationAlignment = options.rotationAlignment;

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

/** Rotates an existing marker's icon, in degrees clockwise (no-op if unknown). */
export function turnMarker(markers: MarkerRegistry, id: string, degrees: number): void {
    const marker = markers.get(id);
    if (!marker) return;
    marker.setRotation(degrees);
}
