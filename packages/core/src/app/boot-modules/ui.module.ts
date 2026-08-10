/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * UIModule — `ICoreModule` wrapper for the UI subsystem.
 *
 * S1.2: owns full UI + feature orchestration (#10→#23) including
 * initBasemaps, initGeoJSON (kept here to guarantee
 * they precede setupReveal / `geoleaf:app:ready`). To be split into dedicated
 * feature modules once RevealModule is added in S1.3+.
 */
"use strict";

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter, GeoLeafBounds } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { LayerManager } from "../../kernel/layer-manager/layer-manager-api.js";
import { ensureGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { initBasemaps, initGeoJSON, initUIPanels } from "../init-features.js";
import { setupDeferredUIPanels } from "../init-deferred-ui.js";
import { setupReveal } from "../init-reveal.js";
import {
    asFn,
    asGeoLeafConfig,
    member,
    perfWindow,
    type AppNamespace,
    type PermalinkRuntimeConfig,
    type RevealPadding,
} from "../app-types.js";

/**
 * Represents the GeoLeaf UI subsystem plus all feature module orchestration.
 * Runs after `config`, `core-map` (map available), `shared` (i18n ready) and `geojson`
 * (F0/S8: layers loaded by GeoJSONModule.init() before the theme applier at #20 runs —
 * makes the registry-order guarantee explicit rather than relying on registration order).
 */
export class UIModule implements ILifecycleModule {
    readonly id = "ui" as const;
    readonly dependencies = ["config", "core-map", "shared", "geojson"] as const;

    async init(_adapter: IMapAdapter, config: IGeoLeafConfig): Promise<void> {
        // (Phase A posts the UI facades at import — `globals.ui.ts`. What follows builds the
        // actual DOM and wires the features: it needs the map, so it stays here.)
        const GeoLeaf = ensureGeoLeaf();
        const _app = (GeoLeaf._app ?? {}) as AppNamespace;
        const AppLog = _app.AppLog;
        const cfg = asGeoLeafConfig(config);
        const _pm = (name: string) =>
            perfWindow().__GEOLEAF_PERF__ ? performance?.mark?.(name) : undefined;

        // Recover cross-module state stored by CoreMapModule.init().
        const map = (_app._currentMap ?? null) as IMapAdapter | null;
        if (!map) {
            AppLog.error("[UIModule] Map not available — skipping UI init.");
            return;
        }
        const profileBounds = (_app._profileBounds ?? null) as GeoLeafBounds | null;
        const profilePadding = (_app._profilePadding ?? null) as RevealPadding | null;
        const _permalinkCfg = (_app._permalinkCfg ?? {}) as PermalinkRuntimeConfig;

        const mapTarget = (cfg.map && (cfg.map.target || cfg.map.id)) || "geoleaf-map";
        // `cfg.ui.theme` is read by `UI.init()` → `_initThemeControl()`, not here — see #11.

        // #10 — Notification system: relocated to the in-core `toast-renderer`
        //        capability (S7). Its lifecycle (container + registerRenderer + boot
        //        toasts) is driven by `ToastRendererModule` via the registry.

        // #11 — Theme: nothing to do here.
        //
        // This step used to call `GeoLeaf.setTheme(cfg.ui.theme)`. That was BOTH redundant
        // and destructive (backlog B.18):
        //  · redundant — `UI.init()` at #12 runs `_initThemeControl()`, which applies the
        //    theme with the right precedence (stored user choice → profile `ui.theme` →
        //    system `prefers-color-scheme`);
        //  · destructive — `GeoLeaf.setTheme()` is the PUBLIC, explicit entry point, so it
        //    persists to `localStorage`. Calling it at boot rewrote `geoleaf_theme` with
        //    the profile's theme on every load, wiping the user's chosen theme. No theme
        //    ever survived a reload.
        //
        // The boot applies a theme, it never chooses one. `GeoLeaf.setTheme()` keeps
        // persisting — that is correct for an explicit integrator/user call.

        // #12 — UI subsystem init.
        const uiInit = asFn(member(GeoLeaf.UI, "init"));
        if (uiInit) {
            try {
                const mapContainer =
                    document.querySelector(".gl-main") || document.getElementById(mapTarget);
                uiInit.call(GeoLeaf.UI, { map, mapContainer, config: cfg });
            } catch (e) {
                AppLog.warn("GeoLeaf.UI.init() threw an error:", e);
            }
        }

        // #13 — Filter panel. Owned by the in-core `filter` capability, which mounts
        // and wires the panel on `geoleaf:app:ready` (capabilities/filter/lifecycle.ts).
        // Here we only hide the structural toggle/panel when the filter is disabled.
        const _mf = (cfg as unknown as { modules?: { filter?: { enabled?: boolean } } }).modules
            ?.filter;
        if (_mf?.enabled === false) {
            const _toggleBtn = document.getElementById("gl-filter-toggle");
            if (_toggleBtn) _toggleBtn.style.display = "none";
            const _filterPanel = document.getElementById("gl-filter-panel");
            if (_filterPanel) _filterPanel.style.display = "none";
        }

        // #14 — Mobile toolbar + desktop side-panel.
        initUIPanels({ GeoLeaf, cfg, map, AppLog });

        // #15 — (removed, S5) Await of the secondary-module chunks. See CoreMapModule #6:
        // the chunk it waited on was EMPTY, so this awaited nothing at every boot.

        // #16 — Offline cache button (Storage plugin).
        const cacheButtonTarget = member(GeoLeaf.UI, "CacheButton");
        const cacheButtonInit = asFn(member(cacheButtonTarget, "init"));
        if (cacheButtonInit) {
            try {
                cacheButtonInit.call(cacheButtonTarget, map, cfg);
                AppLog.log("Cache button initialized.");
            } catch (e) {
                AppLog.warn("Error during cache button initialization:", e);
            }
        }

        // #17 — Basemaps.
        _pm("geoleaf:init:basemaps:start");
        initBasemaps({ GeoLeaf, cfg, map, AppLog });
        _pm("geoleaf:init:basemaps:end");

        // #20 — GeoJSON layers + ThemeSelector.
        // Kept in UIModule (S1.2) — same ordering constraint as #18.
        _pm("geoleaf:init:geojson:start");
        initGeoJSON({ GeoLeaf, cfg, map, AppLog, _app });
        _pm("geoleaf:init:geojson:end");

        // #21 — Branding overlay: relocated to the in-core `branding` capability
        //        (`BrandingModule`, gated on `modules.branding.enabled`). Its lifecycle
        //        mounts the overlay via the registry with the boot-created map adapter.

        // #22 — Non-critical panels deferred to post-reveal.
        setupDeferredUIPanels({ GeoLeaf, cfg, map, AppLog, _pm });

        // #23 — Loader reveal + permalink apply + `geoleaf:app:ready`.
        setupReveal({
            GeoLeaf,
            map,
            AppLog,
            profileBounds,
            profilePadding,
            permalinkCfg: _permalinkCfg,
        });

        AppLog.info("Application initialized, loading layers in the background.");
    }

    destroy(): void {
        LayerManager._reset();
    }
}
