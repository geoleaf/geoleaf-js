/*!
 * GeoLeaf Core (feature-info capability) — Popup surface (click)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Renders the click popup as a native `maplibregl.Popup` anchored to the
 * feature's geographic coordinate (`lngLat`), so it follows the map on pan/zoom
 * and auto-flips to stay in view. The popup CONTENT is the pre-extraction
 * `gl-poi-popup` DOM produced by the ported `buildPopupContent`, so the rendered
 * markup and theme CSS are identical to before. MapLibre is reached through the
 * runtime global (`globalThis.maplibregl`), never a static import.
 * https://geoleaf.dev
 */
import { buildPopupContent } from "../render/popup-content.js";
import type { RenderField } from "../render/dom.js";
import { hasFields, resolveSurfaceFields, toRenderFields } from "../convert.js";
import { openSidePanel } from "./sidepanel.js";
import type { GeoLeafFeatureClickDetail, SidePanelLayout } from "../types.js";

/** Structural view of the runtime `maplibregl.Popup` (never imported as a value). */
interface MaplibrePopupLike {
    setLngLat(lngLat: { lng: number; lat: number }): MaplibrePopupLike;
    setDOMContent(node: Node): MaplibrePopupLike;
    addTo(map: unknown): MaplibrePopupLike;
    remove(): MaplibrePopupLike;
    on(type: string, listener: () => void): MaplibrePopupLike;
}

interface MaplibreGlobal {
    Popup: new (opts?: Record<string, unknown>) => MaplibrePopupLike;
}

interface AdapterLike {
    getNativeMap?: () => Record<string, unknown> | null;
}

interface GeoLeafHost {
    GeoLeaf?: { Core?: { getMap?: () => AdapterLike | null | undefined } };
}

/** Returns the runtime `maplibregl` global when it exposes a `Popup` constructor. */
function getMaplibre(): MaplibreGlobal | null {
    const g = globalThis as { maplibregl?: MaplibreGlobal };
    return g.maplibregl && typeof g.maplibregl.Popup === "function" ? g.maplibregl : null;
}

/** Reads the native `maplibregl.Map` via `GeoLeaf.Core.getMap()` (with fallback), never `GeoLeaf.getMap()`. */
function getNativeMap(): Record<string, unknown> | null {
    const g = globalThis as unknown as GeoLeafHost;
    return g.GeoLeaf?.Core?.getMap?.()?.getNativeMap?.() ?? null;
}

let _popup: MaplibrePopupLike | null = null;
let _keyHandler: ((e: Event) => void) | null = null;

// Retained so "Voir plus" opens the side-panel for the originating feature after
// the popup DOM has been built, forwarding the same override layout if any.
let _currentDetail: GeoLeafFeatureClickDetail | null = null;
let _currentLayout: SidePanelLayout | undefined;

function _detachKeyHandler(): void {
    if (_keyHandler) {
        document.removeEventListener("keydown", _keyHandler);
        _keyHandler = null;
    }
}

/** Clears all popup state (no map/DOM side effects — the caller removes the popup). */
function _resetState(): void {
    _detachKeyHandler();
    _currentDetail = null;
    _currentLayout = undefined;
    _popup = null;
}

/** Closes the popup and clears its state. */
export function closePopup(): void {
    const p = _popup;
    _resetState();
    if (p) p.remove();
}

/**
 * Handles a `geoleaf:feature:click` event and opens / replaces the popup.
 * `layout` — when given — fully overrides the auto-resolved layer binding
 * (no merge). No-op when MapLibre or the map is unavailable.
 */
export function handleClick(detail: GeoLeafFeatureClickDetail, layout?: SidePanelLayout): void {
    const mgl = getMaplibre();
    const map = getNativeMap();
    if (!mgl || !map) return;

    // ⚠️ The former fallback — "no binding, so render every property" — is gone with
    // the `"all"` mode it duplicated. A layer that declares no reading paints nothing.
    let fields: readonly RenderField[];
    let hasSidepanel: boolean;

    if (layout) {
        fields = toRenderFields(layout.fields);
        hasSidepanel = true;
    } else {
        const resolved = resolveSurfaceFields(detail.layerId, "popup");
        if (!hasFields(resolved)) return;
        fields = resolved;
        hasSidepanel = hasFields(resolveSurfaceFields(detail.layerId, "sidepanel"));
    }

    const node = buildPopupContent(
        fields,
        detail.properties,
        {
            layerId: detail.layerId,
            featureId: detail.featureId,
            lngLat: detail.lngLat,
            // Closes THIS surface, not both — `FeatureInfo.close()` would also close the side
            // panel and emit a `geoleaf:poi:panel:close` nobody performed. Passed as a value
            // rather than imported by the renderer, which would close a cycle.
            onClose: closePopup,
        },
        {
            hasSidepanel,
        }
    );

    // "Voir plus" (an <a class="gl-poi-popup__link">) opens the side-panel.
    node.querySelector<HTMLElement>(".gl-poi-popup__link")?.addEventListener("click", (e) => {
        e.preventDefault();
        if (_currentDetail) openSidePanel(_currentDetail, _currentLayout);
        closePopup();
    });

    // Replace any existing popup, then anchor the new one to the feature.
    closePopup();
    _currentDetail = detail;
    _currentLayout = layout;
    _popup = new mgl.Popup({
        closeButton: false,
        closeOnClick: true,
        maxWidth: "320px",
        className: "gl-fi-popup-ml",
    })
        .setLngLat({ lng: detail.lngLat.lng, lat: detail.lngLat.lat })
        .setDOMContent(node)
        .addTo(map);
    _popup.on("close", _resetState);

    _keyHandler = (e: Event) => {
        if ((e as KeyboardEvent).key === "Escape") closePopup();
    };
    document.addEventListener("keydown", _keyHandler);
}

/** Removes the popup from the map. Called on plugin destroy / reset. */
export function destroyPopup(): void {
    closePopup();
}
