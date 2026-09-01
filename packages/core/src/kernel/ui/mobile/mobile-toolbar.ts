/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI – Mobile toolbar: orchestrator and public API.
 * Wires together pill, search bar, proximity bar and sheet modal sub-modules.
 */

import { domState, _g } from "./mobile-toolbar-state.js";
import type { MobileToolbarOptions } from "./mobile-toolbar-state.js";
import { getLabel } from "../../../utils/i18n/i18n.js";
import { dispatchToolbarAction } from "../toolbar-dispatch.js";
import { registerLifecycleTeardown } from "../../shared/lifecycle.js";
import {
    createToolbarDom,
    createTooltipDom,
    attachTooltipHandlers,
    updateNavVisibility,
    refreshFilterButtonState,
    createSvgIcon,
} from "./mobile-toolbar-pill.js";
import {
    createProximityBarDom,
    openProximityBar,
    closeProximityBar,
    proximityDefaultRadiusKm,
} from "./mobile-toolbar-proximity.js";
import { createSheetDom, markPillsWithPane, openSheet } from "./mobile-toolbar-sheet.js";

export type { MobileToolbarOptions };

// ── Local structural types ──────────────────────────────────────────────

/**
 * Map members probed by the toolbar. `setView`/`getCenter`/`getZoom` come from
 * the `IMapAdapter` contract (mapped to MapLibre's `jumpTo`/`getCenter`/`getZoom`
 * by the adapter); `zoomIn`/`zoomOut` is a fallback for map-like objects that
 * don't implement the full adapter surface.
 */
interface ToolbarMapLike {
    getZoom?: () => number;
    getCenter?: () => unknown;
    setView?: (center: unknown, zoom: number) => void;
    zoomIn?: () => void;
    zoomOut?: () => void;
    getContainer?: () => HTMLElement | null;
}

/** Subset of `GeoLeaf.Filter` consumed by the toolbar (S13). */
interface FilterLike {
    proximity?: {
        toggle?: (
            map: ToolbarMapLike,
            radiusKm?: number,
            options?: { onPointPlaced?: () => void }
        ) => boolean;
    };
}

// ── Toolbar click dispatcher ──────────────────────────────────────────────────

function _handleResetFilters(e: Event): void {
    e.preventDefault();
    domState.options?.onResetFilters?.();
    refreshFilterButtonState();
}

function _handleZoom(action: string): void {
    const map = domState.options?.map as ToolbarMapLike | null | undefined;
    if (!map) return;
    const zoom = typeof map.getZoom === "function" ? map.getZoom() : 0;
    const delta = action === "zoom-in" ? 1 : -1;
    if (typeof map.setView === "function" && typeof map.getCenter === "function") {
        map.setView(map.getCenter(), zoom + delta);
    } else if (typeof map.zoomIn === "function") {
        action === "zoom-in" ? map.zoomIn() : map.zoomOut!();
    }
}

function _isZoomAction(action: string | null): boolean {
    if (action === "zoom-in") return true;
    if (action === "zoom-out") return true;
    return false;
}

function _handleFullscreen(): void {
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {
            /* already out of fullscreen, or the exit was refused */
        });
    } else {
        domState.options!.glMain.requestFullscreen().catch(() => {
            /* fullscreen not supported or denied */
        });
    }
}

function _handleThemes(target: HTMLElement): void {
    const secondaryCtr = document.getElementById("gl-theme-secondary-container");
    if (!secondaryCtr) return;
    const isVisible = secondaryCtr.classList.contains("gl-mobile-secondary-visible");
    if (isVisible) {
        secondaryCtr.classList.remove("gl-mobile-secondary-visible");
        target.classList.remove("gl-map-toolbar__btn--active");
        target.setAttribute("aria-expanded", "false");
    } else {
        secondaryCtr.classList.add("gl-mobile-secondary-visible");
        target.classList.add("gl-map-toolbar__btn--active");
        target.setAttribute("aria-expanded", "true");
    }
}

function _buildProximityCallback(): () => void {
    return () => {
        if (domState.proximityValidateBtn) domState.proximityValidateBtn.disabled = false;
        if (domState.proximityInstruction) {
            domState.proximityInstruction.textContent = getLabel("ui.proximity.point_placed");
            domState.proximityInstruction.classList.add("point-placed");
        }
    };
}

function _handleProximity(target: HTMLElement): void {
    const filter = _g.GeoLeaf?.Filter as FilterLike | undefined;
    const toggle = filter?.proximity?.toggle;
    const map = domState.options?.map as ToolbarMapLike | null | undefined;
    if (!toggle || !map) return;
    if (domState.proximityActive) {
        const wrapper = document.getElementById("gl-proximity-toolbar-wrapper");
        const wasFiltering = wrapper?.getAttribute("data-proximity-active") === "true";
        toggle(map, proximityDefaultRadiusKm());
        domState.proximityActive = false;
        target.classList.remove("gl-map-toolbar__btn--active");
        closeProximityBar(false, !wasFiltering);
        return;
    }
    domState.proximityActive = toggle(map, proximityDefaultRadiusKm(), {
        onPointPlaced: _buildProximityCallback(),
    });
    target.classList.toggle("gl-map-toolbar__btn--active", domState.proximityActive);
    if (domState.proximityActive) openProximityBar();
}

function _handleGeoloc(): void {
    const geolocLink = document.querySelector(
        ".geoleaf-ctrl-geolocation a"
    ) as HTMLAnchorElement | null;
    if (geolocLink) geolocLink.click();
    const btn = domState.toolbar?.querySelector('[data-gl-sheet="geoloc"]');
    if (btn instanceof HTMLElement) btn.setAttribute("aria-expanded", "false");
}

function _dispatchSheetAction(sheetId: string | null, target: HTMLElement): void {
    if (sheetId === "proximity") {
        _handleProximity(target);
        return;
    }
    if (sheetId === "geoloc") {
        _handleGeoloc();
        return;
    }
    if (sheetId) openSheet(sheetId);
}

function onToolbarClick(e: Event): void {
    const target = (e.target as HTMLElement).closest("button");
    if (!target) return;
    const action = target.getAttribute("data-gl-toolbar-action");
    const sheetId = target.getAttribute("data-gl-sheet");
    if (action === "reset-filters") {
        _handleResetFilters(e);
        return;
    }
    if (_isZoomAction(action)) {
        _handleZoom(action!);
        return;
    }
    if (action === "fullscreen") {
        _handleFullscreen();
        return;
    }
    if (action === "themes") {
        _handleThemes(target);
        return;
    }
    // `poi-add` no longer has a branch here: it deliberately falls into the
    // generic dispatch below, which loads the lazy plugin BEFORE dispatching. The
    // dedicated branch called `_handlePoiAdd`, which probed `GeoLeaf.AddPOI` — the
    // kernel opened the form of a plugin it named. `editor` listens to the action
    // now.
    // Generic dispatch for plugin-registered actions (e.g. "print").
    // For lazy plugins: load the bundle first, then dispatch so the listener is ready.
    if (action) {
        dispatchToolbarAction(action, target);
        // Must return: the helper is fire-and-forget, and falling through would
        // also run the sheet branch for a button carrying both attributes.
        return;
    }
    _dispatchSheetAction(sheetId, target);
}

// ── Public API ────────────────────────────────────────────────────────────────

function _setupDocumentListeners(): void {
    if (typeof document === "undefined") return;
    document.addEventListener("fullscreenchange", () => {
        const isFullscreen = !!document.fullscreenElement;
        const fsBtn = domState.toolbar?.querySelector(
            '[data-gl-toolbar-action="fullscreen"]'
        ) as HTMLElement | null;
        if (fsBtn) {
            fsBtn.classList.toggle("gl-map-toolbar__btn--active", isFullscreen);
            fsBtn.innerHTML = ""; // SAFE: empty string — clears before SVG append via DOM API
            const exitPath =
                "M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3";
            const enterPath = "M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6";
            fsBtn.appendChild(createSvgIcon(isFullscreen ? exitPath : enterPath));
        }
        domState.toolbar?.classList.toggle("gl-map-toolbar--fullscreen", isFullscreen);
        updateNavVisibility();
    });
}

function _setupGeolocListener(): void {
    const geolocMapContainer = (
        domState.options?.map as ToolbarMapLike | null | undefined
    )?.getContainer?.() as HTMLElement | null;
    if (geolocMapContainer) {
        geolocMapContainer.addEventListener("geoleaf:geolocation:statechange", (e: Event) => {
            const detail = (e as CustomEvent<{ active?: boolean }>).detail;
            const btn = domState.toolbar?.querySelector('[data-gl-sheet="geoloc"]');
            if (btn instanceof HTMLElement) {
                btn.classList.toggle("gl-map-toolbar__btn--active", !!detail?.active);
            }
        });
    }
}

/**
 * Clears the filter-state polling interval. Registered as a lifecycle teardown
 * (run on `Core.destroy()`) and called before each re-init, so the 2s poll never
 * leaks across a destroy → recreate cycle (RM-P2 #6a — previously never cleared).
 */
function clearFilterCheckInterval(): void {
    if (domState.filterCheckInterval != null) {
        clearInterval(domState.filterCheckInterval);
        domState.filterCheckInterval = null;
    }
}
registerLifecycleTeardown(clearFilterCheckInterval);

/**
 * Initializes the mobile utility pill toolbar and sheet modal.
 * Must be called after the map and .gl-main DOM are ready.
 */
export function initMobileToolbar(options: MobileToolbarOptions): void {
    domState.options = options;
    const { glMain } = options;

    const toolbarWrapper = createToolbarDom();
    domState.toolbar!.addEventListener("click", onToolbarClick);
    glMain.appendChild(toolbarWrapper);

    const tooltipEl = createTooltipDom();
    tooltipEl.style.display = "none";
    glMain.appendChild(tooltipEl);
    attachTooltipHandlers(toolbarWrapper, glMain);

    const proximityBar = createProximityBarDom();
    glMain.appendChild(proximityBar);
    if (glMain.style.position === "" || glMain.style.position === "static") {
        glMain.style.position = "relative";
    }

    domState.overlay = createSheetDom();
    glMain.appendChild(domState.overlay);

    // A pane may have been registered before this toolbar existed, in which case the registry
    // marked nothing. Marking here covers that order; `registerPaneHost({ sync })` covers the
    // other one. ⚠️ Both are needed — neither side controls which runs first.
    markPillsWithPane();

    requestAnimationFrame(() => {
        updateNavVisibility();
    });

    _setupDocumentListeners();

    _setupGeolocListener();

    refreshFilterButtonState();
    // Clear any prior interval before (re)creating it — idempotent re-init. The
    // lifecycle teardown also clears it on destroy so it never leaks on recreate.
    clearFilterCheckInterval();
    domState.filterCheckInterval = window.setInterval(
        () => refreshFilterButtonState(),
        2000
    ) as unknown as number;
}
