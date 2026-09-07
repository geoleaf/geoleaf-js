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
import {
    createSheetDom,
    markPillsWithPane,
    openSheet,
    closeSheet,
} from "./mobile-toolbar-sheet.js";

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

// ⚠️ The two handlers below are module-level NAMED functions, not the inline closures
// they used to be, and the name buys two things at once. It is the only handle a
// teardown can pass to `removeEventListener` — a closure is unremovable for the life
// of the page. And `addEventListener` de-duplicates on (type, callback, capture), so a
// second init now re-registers the SAME function instead of stacking another listener.
// No boolean flag is needed for that; adding one would be redundant.

function _onFullscreenChange(): void {
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
}

function _onGeolocStateChange(e: Event): void {
    const detail = (e as CustomEvent<{ active?: boolean }>).detail;
    const btn = domState.toolbar?.querySelector('[data-gl-sheet="geoloc"]');
    if (btn instanceof HTMLElement) {
        btn.classList.toggle("gl-map-toolbar__btn--active", !!detail?.active);
    }
}

function _setupDocumentListeners(): void {
    if (typeof document === "undefined") return;
    document.addEventListener("fullscreenchange", _onFullscreenChange);
}

function _setupGeolocListener(): void {
    const geolocMapContainer = (
        domState.options?.map as ToolbarMapLike | null | undefined
    )?.getContainer?.() as HTMLElement | null;
    if (geolocMapContainer) {
        // 🛑 Held, not re-derived at teardown time. `Core.destroy()` destroys the adapter
        // BEFORE running the teardowns, and `getContainer()` throws past that point —
        // `runLifecycleTeardowns()` would swallow the throw as a warning, leaking this
        // listener and aborting the rest of the teardown with nothing going red.
        domState.geolocTarget = geolocMapContainer;
        geolocMapContainer.addEventListener(
            "geoleaf:geolocation:statechange",
            _onGeolocStateChange
        );
    }
}

/**
 * Clears the filter-state polling interval.
 *
 * Called before each re-init and from `destroyMobileToolbar()`, so the 2s poll never
 * leaks across a destroy → recreate cycle. ⚠️ No longer a lifecycle teardown of its
 * own: it is now reached THROUGH `destroyMobileToolbar`, which is the registrant. Two
 * registrants would have run it twice, and one of them would have torn down nothing else.
 */
function clearFilterCheckInterval(): void {
    if (domState.filterCheckInterval != null) {
        clearInterval(domState.filterCheckInterval);
        domState.filterCheckInterval = null;
    }
}

/**
 * Initializes the mobile utility pill toolbar and sheet modal.
 *
 * Must be called after the map and `.gl-main` DOM are ready. Safe to call again: a
 * toolbar already mounted in the same `glMain` is left alone, and one left over from a
 * previous shell is torn down first.
 *
 * ⚠️ On the no-op branch `options` is NOT refreshed — a new map handle or new `show*`
 * flags passed to a redundant call are ignored. `initDesktopPanel` behaves the same way.
 * Pass through `destroyMobileToolbar()` to change them.
 *
 * @param options - Host element, map handles and which controls to show.
 *
 * @example
 * ```ts
 * GeoLeaf?.UI?.initMobileToolbar({ glMain: document.querySelector(".gl-main")! });
 * ```
 */
export function initMobileToolbar(options: MobileToolbarOptions): void {
    // Idempotence in THREE states, not two. Testing presence in the document — what the
    // desktop panel does — cannot separate "already ours" from "ours, but the host just
    // detached the shell", and those two must not behave alike: the second one has to
    // rebuild, or the host is left with no toolbar at all. Ownership separates them.
    // ⚠️ `parentElement ===` rather than `contains()`: the wrapper is appended directly
    // to `glMain`, so the equality is exact — and it stays right when a host mounts a new
    // view before unmounting the old, where the wrapper is still connected, but to the
    // WRONG shell. `isConnected` answers "true" there and would wrongly no-op.
    const mounted = domState.toolbarWrapper;
    if (mounted && mounted.parentElement === options.glMain) return;
    // 🛑 Both lines run BEFORE `domState.options` is assigned — the teardown clears it,
    // so setting it first would have it wiped a statement later.
    if (mounted) destroyMobileToolbar();

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

/**
 * Tears the mobile toolbar down: removes the four nodes it appended to `glMain`,
 * disconnects its observer and drops its listeners.
 *
 * Registered as a lifecycle teardown, so `Core.destroy()` runs it. Also called by
 * `initMobileToolbar()` when it finds a toolbar left over from a previous shell.
 *
 * ⚠️ **Call it BEFORE the shell is destroyed, not after.** The sheet moves shared nodes
 * (filter panel, legend, layer manager) into its body; this function gives them back,
 * but it can only give them back to a parent that still exists. A host that drops
 * `.gl-main` first has already lost them.
 *
 * ⚠️ Proximity mode is NOT cancelled. Clearing it would mean calling back into the
 * filter capability — a business effect on a teardown path — so the engine keeps
 * whatever filter was applied while the pill's own flag resets. A host that tears down
 * mid-proximity should cancel it itself first.
 *
 * @example
 * ```ts
 * GeoLeaf?.UI?.destroyMobileToolbar();
 * ```
 */
export function destroyMobileToolbar(): void {
    // FIRST, and it is the whole reason this order is written down: the sheet MOVES the
    // filter panel, the legend and the layer manager into its body rather than cloning
    // them. Removing the overlay with them still inside takes them out of the app for
    // good. ⚠️ What matters is that the restore happens AT ALL, and before
    // `restoreOnClose` is emptied — NOT that it precedes the `remove()` calls below:
    // `insertBefore` pulls a node out of whatever parent it currently has, detached or
    // not. Swapping this line with the removals is therefore a mutation that stays green.
    if (domState.overlay?.classList.contains("open")) closeSheet();

    clearFilterCheckInterval();
    domState.resizeObserver?.disconnect();
    // Same guard `_setupDocumentListeners` carries, and for a reason that is not
    // symmetry: this teardown is REGISTERED when the module loads, whether or not
    // anything was ever mounted. Without a document it would throw here, and
    // `runLifecycleTeardowns()` swallows the throw — the rest of the teardown would be
    // skipped and nothing would say so.
    if (typeof document !== "undefined") {
        document.removeEventListener("fullscreenchange", _onFullscreenChange);
    }
    domState.geolocTarget?.removeEventListener(
        "geoleaf:geolocation:statechange",
        _onGeolocStateChange
    );

    // Read `glMain` while `options` still holds it. `position: relative` is deliberately
    // NOT restored: init only sets it when it was empty or `static`, and nothing records
    // whether the value found there was ours or the host's. Restoring "" on a shell the
    // host had positioned itself would break its layout — the safe direction is to leave
    // a property we may not own alone.
    const glMain = domState.options?.glMain;
    if (glMain) {
        glMain.style.removeProperty("--gl-proximity-bar-height");
        glMain.style.removeProperty("--gl-proximity-bar-gap");
    }

    domState.toolbarWrapper?.remove();
    domState.tooltipEl?.remove();
    domState.proximityBar?.remove();
    domState.overlay?.remove();

    // Bare assignments below, never guarded ones: there is nothing to guard, and every
    // `?.` counts against this file's complexity ceiling.
    domState.toolbarWrapper = null;
    domState.toolbar = null;
    domState.tooltipEl = null;
    domState.proximityBar = null;
    domState.proximitySlider = null;
    domState.proximityValidateBtn = null;
    domState.proximityInstruction = null;
    domState.proximityRadiusLabel = null;
    domState.proximityActive = false;
    domState.filterGroup = null;
    domState.filterBtn = null;
    domState.resetBtn = null;
    domState.scrollEl = null;
    domState.navUp = null;
    domState.navDown = null;
    domState.panelTitle = null;
    domState.panelBody = null;
    domState.activeSheetId = null;
    domState.lastFocusedElement = null;
    domState.restoreOnClose = [];
    domState.resizeObserver = null;
    domState.geolocTarget = null;
    // 🛑 `overlay` LAST among the nodes, and it is not housekeeping: the sheet registers
    // itself as a pane host with `isActive: () => domState.overlay !== null`. Leave it
    // set and the host keeps claiming a dead overlay — `openPane()` routes to it,
    // `openSheet()` reports success, and the pane appears nowhere. A silent failure.
    domState.overlay = null;
    domState.options = null;
    // ⚠️ `_escapeListenerAdded` in `mobile-toolbar-sheet.ts` is deliberately NOT reset.
    // Its listener reads `domState.overlay` dynamically, so it applies to whatever
    // overlay exists next; clearing the flag would add a SECOND one on re-init.
}

// Self-register so `Core.destroy()` actually tears the mobile toolbar down — the same
// gesture `desktop-panel.ts` carries, and the mobile half was the one still missing it.
//
// 🛑 A test that calls `destroyMobileToolbar()` directly comes out green and proves
// nothing: it exercises the function, not its caller. The proof has to go through
// `Core.destroy()`, the only path that runs `runLifecycleTeardowns()`. The witness
// mutation is putting `clearFilterCheckInterval` back on this line — the interval test
// stays green, the four-node test goes red.
registerLifecycleTeardown(destroyMobileToolbar);
