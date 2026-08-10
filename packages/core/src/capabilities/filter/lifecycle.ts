/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter capability — lifecycle / event wiring (S5, F4).
 *
 * Mounts the mapping-driven panel and wires it to the sources. The data-dependent
 * mount is deferred to `geoleaf:app:ready` (POI / GeoJSON loaded — so `tag: "auto"`
 * options and the initial apply see the data), mirroring the taxonomy/labels
 * pattern of registering the listener during the synchronous `registry.init()` and
 * catching the async event.
 *
 * When the resolved config carries no `fields` (an un-migrated profile, still on
 * the legacy `searchConfig` panel), the lifecycle is inert — nothing mounts, so the
 * legacy panel stays untouched (additive).
 *
 * Invoked by `FilterModule` (registered in `boot.ts` only when
 * `modules.filter.enabled`).
 */
"use strict";

import { getFilterConfig } from "./config.js";
import { renderFilterPanel } from "./panel/render.js";
import { applyFilterFromPanel, resolveOptionsWithData } from "./apply.js";
import { resetPanelControls } from "./panel/write.js";
import { Core } from "../../api/geoleaf.core.js";
import { FilterPanelProximity } from "./panel/proximity/proximity.js";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.js";
import type { FilterConfig } from "./types.js";

/** Debounce for auto-apply on control changes (kept from the legacy panel). */
const DEBOUNCE_MS = 300;

let _started = false;
let _panel: HTMLElement | null = null;
let _cleanups: Array<() => void> = [];
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Mounts + wires the panel once the app (data) is ready, if the profile is migrated. */
function _onAppReady(): void {
    const config = getFilterConfig();
    if (config.enabled === false || !config.fields?.length) return; // inert (un-migrated)
    _mountPanel(config);
}

/** Renders the panel from the config, mounts it and wires every interaction. */
function _mountPanel(config: FilterConfig): void {
    if (typeof document === "undefined") return;
    // Drop any pre-existing container (legacy panel / retry) to avoid a duplicate id.
    document.getElementById("gl-filter-panel")?.remove();

    const panel = renderFilterPanel(config, resolveOptionsWithData(config));
    const host = document.querySelector(".gl-main") ?? document.body;
    host.appendChild(panel);
    _panel = panel;

    _wirePanel(panel, config);
    _wireToggle(panel);
    _initProximity();
}

/** Wires Apply / Reset / Close actions + debounced auto-apply on control changes. */
function _wirePanel(panel: HTMLElement, config: FilterConfig): void {
    const apply = (): void => applyFilterFromPanel(_panel, config);
    const debouncedApply = (): void => {
        if (_debounceTimer) clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(apply, DEBOUNCE_MS);
    };
    const onClick = (e: Event): void => {
        const target = e.target as HTMLElement | null;
        const action = target?.closest?.("[data-gl-action]")?.getAttribute("data-gl-action");
        if (action === "filter-apply") apply();
        else if (action === "filter-reset") {
            resetPanelControls(panel);
            apply();
        } else if (action === "filter-close") panel.classList.remove("gl-is-open");
    };

    panel.addEventListener("click", onClick);
    panel.addEventListener("input", debouncedApply);
    panel.addEventListener("change", debouncedApply);
    _cleanups.push(() => panel.removeEventListener("click", onClick));
    _cleanups.push(() => panel.removeEventListener("input", debouncedApply));
    _cleanups.push(() => panel.removeEventListener("change", debouncedApply));
}

/** Wires the structural toolbar toggle button (`#gl-filter-toggle`) to the panel. */
function _wireToggle(panel: HTMLElement): void {
    const toggle = document.getElementById("gl-filter-toggle");
    if (!toggle) return;
    const onToggle = (): void => {
        panel.classList.toggle("gl-is-open");
    };
    toggle.addEventListener("click", onToggle);
    _cleanups.push(() => toggle.removeEventListener("click", onToggle));
}

/** Initialises the reused (in-place) proximity module with the active map adapter. */
function _initProximity(): void {
    const adapter = Core.getMap() as unknown as IMapAdapter | null;
    if (adapter && typeof FilterPanelProximity?.initProximityFilter === "function") {
        FilterPanelProximity.initProximityFilter(adapter);
        // Teardown mirrors the mount. `initProximityFilter` attaches DOCUMENT-level
        // listeners (plus a circle and a draggable marker) that only `destroy()` releases,
        // and `_cleanups` is the sole path `_reset()` walks. Registering the cleanup here
        // — rather than calling `destroy()` from `_reset` — keeps it paired with the setup
        // that created the state, so it never fires for a proximity that never mounted.
        _cleanups.push(() => FilterPanelProximity.destroy?.());
    }
}

/** Idempotent event wiring for the Filter capability. Safe to call multiple times. */
export const FilterLifecycle = {
    init(): void {
        if (_started || typeof document === "undefined") return;
        _started = true;
        // Data-dependent mount deferred to app:ready (POI/GeoJSON loaded). The event
        // is async relative to registry.init(), so registering here catches it.
        document.addEventListener("geoleaf:app:ready", _onAppReady, { once: true });
    },

    /** Detaches listeners, unmounts the panel and removes the shims (module destroy / test). */
    _reset(): void {
        if (_debounceTimer) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }
        _cleanups.forEach((fn) => fn());
        _cleanups = [];
        _panel?.remove();
        _panel = null;
        if (typeof document !== "undefined") {
            document.removeEventListener("geoleaf:app:ready", _onAppReady);
        }
        _started = false;
    },
};
