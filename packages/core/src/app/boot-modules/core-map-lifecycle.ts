/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * CoreMapLifecycle — the runtime behaviour behind {@link CoreMapModule}.
 *
 * Extraction of `CoreMapModule.init()`, which orchestrated seven responsibilities in
 * ~148 lines under `/* eslint-disable complexity, max-lines-per-function *\/` — the only
 * one of the 19 `ICoreModule` wrappers not following the thin pattern (R.42, backlog
 * résiduel S5; plan: `archives/rapport_extraction-core-map-module.md`, archived once
 * executed).
 *
 * **Graph-preserving (approach 3.A).** `CoreMapModule` keeps `id = "core-map"` and
 * `dependencies = ["config"]` unchanged, so the boot graph (6 nodes, same edges) does
 * not move and `boot-sequence-order` stays green without edits. Approach 3.B (splitting
 * into several feature modules) was rejected by the plan: it adds nodes and edges and
 * would force the B1→B11 order to be re-validated.
 *
 * ⚠️ **Location deviates from the plan, deliberately.** §3.A targets
 * `built-in/map/core-map-lifecycle.ts` — a directory that no longer exists (R.9/R.11
 * renamed `modules/built-in/` to `kernel/`), and its successor `kernel/map/` **cannot**
 * host this file: ESLint block 6ter (a) forbids `kernel/**` from importing `app/`, and
 * the lifecycle needs `AppNamespace`, `RevealPadding`, `PermalinkRuntimeConfig`,
 * `asFn`, `member`, `perfWindow`, `buildFitBoundsOptions` and `asGeoLeafConfig` — all
 * from `app/app-types.ts`. Moving those into `kernel/` was rejected in turn: they are
 * the **app layer's own vocabulary** (boot contexts, `RevealDeps`, `DeferredUIDeps`),
 * used by 12 files under `app/`. Extracting here reaches the actual objective — a thin
 * wrapper, seven named pure helpers, no `eslint-disable` — without inverting a boundary
 * that is deliberately enforced.
 *
 * **The five hard constraints (plan §2) are preserved verbatim**: boot edges; the
 * `_app.*` state contract (same keys, written at the same point — end of init, before
 * `UIModule.init()` reads it); permalink hook 1 running before `GeoLeaf.init()`; the
 * `geoleaf:init:mapCreate:start|end` perf marks bracketing map creation and nothing
 * else; and adapter DI through the internal `_adapter` option (no module-level seam).
 */
"use strict";

import type { IMapAdapter, GeoLeafBounds } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import type { MapConfig } from "../../kernel/config/geoleaf-config/config-types.js";
import { events } from "../../utils/general/event-listener-manager.js";
import { padBounds } from "../../kernel/map/map-container.js";
import { ensureGeoLeaf } from "../../utils/general/geoleaf-global.js";
import {
    asFn,
    asGeoLeafConfig,
    buildFitBoundsOptions,
    member,
    perfWindow,
    type AppNamespace,
    type PermalinkRuntimeConfig,
    type RevealPadding,
} from "../app-types.js";

/** Production logger surface, as carried on `GeoLeaf._app.AppLog`. */
type AppLog = AppNamespace["AppLog"];

/** Records a perf mark only when the `__GEOLEAF_PERF__` opt-in is set. */
type PerfMark = (name: string) => void;

/** Map extent resolved from the active profile — bounds, or center+zoom. */
interface ProfileExtent {
    /** Non-null only in the `map.bounds` branch; drives fitBounds and maxBounds. */
    profileBounds: GeoLeafBounds | null;
    profilePadding: RevealPadding | null;
    mapCenter: [number, number];
    profileMaxZoom: number;
}

/** Default padding, in pixels, when the profile declares none. */
const DEFAULT_PADDING_PX = 50;
/** Default extra room around `map.bounds` when `positionFixed` is on. */
const DEFAULT_BOUNDS_MARGIN = 0.3;
/** Floor applied to `minZoom` under `positionFixed` when the profile sets none. */
const POSITION_FIXED_MIN_ZOOM = 3;

/**
 * Permalink hook 1 — read URL state **before** the map exists.
 *
 * Must run before `GeoLeaf.init()`: hook 2 (in `setupReveal`) consumes the state this
 * one stores. S13 migrated the config from `ui.permalink` to `modules.permalink`,
 * opt-out.
 *
 * @returns The resolved permalink config, later published on `_app._permalinkCfg`.
 */
function runPermalinkHook1(
    GeoLeaf: ReturnType<typeof ensureGeoLeaf>,
    cfg: ReturnType<typeof asGeoLeafConfig>,
    AppLog: AppLog
): PermalinkRuntimeConfig {
    const permalinkCfg = (cfg.modules?.permalink ?? {}) as PermalinkRuntimeConfig;
    if (permalinkCfg.enabled !== false && GeoLeaf.Permalink) {
        try {
            const permalink = GeoLeaf.Permalink;
            asFn(member(permalink, "init"))?.call(permalink, permalinkCfg);
            asFn(member(permalink, "readAndStore"))?.call(permalink);
        } catch (e) {
            AppLog.warn("[Permalink] readAndStore failed:", e);
        }
    }
    return permalinkCfg;
}

/**
 * Resolve the profile's map extent from `map.bounds`, or `map.center` + `map.zoom`.
 *
 * @returns `null` when the profile declares neither — the caller must abort the boot of
 * this module, which is the original early-return.
 */
function resolveProfileExtent(cfgMap: MapConfig, AppLog: AppLog): ProfileExtent | null {
    const hasBounds = Array.isArray(cfgMap.bounds) && cfgMap.bounds.length === 2;
    const hasCenterZoom =
        Array.isArray(cfgMap.center) &&
        cfgMap.center.length === 2 &&
        typeof cfgMap.zoom === "number";

    if (!hasBounds && !hasCenterZoom) {
        AppLog.error(
            "[GeoLeaf] Active profile does not define valid map.bounds or map.center+zoom. " +
                "Either map.bounds or map.center+map.zoom is required in profile.json. " +
                'Example: "bounds": [[43.0, 1.0], [44.0, 2.0]]  or  "center": [20, 10], "zoom": 2'
        );
        return null;
    }

    if (!hasBounds) {
        AppLog.log("[GeoLeaf] Profile uses center+zoom positioning (no bounds).");
        return {
            profileBounds: null,
            profilePadding: null,
            mapCenter: cfgMap.center as [number, number],
            profileMaxZoom: cfgMap.zoom as number,
        };
    }

    const raw = cfgMap.bounds as [[number, number], [number, number]];
    const rawPadding = cfgMap.padding || [DEFAULT_PADDING_PX, DEFAULT_PADDING_PX];
    return {
        profileBounds: {
            south: raw[0][0],
            west: raw[0][1],
            north: raw[1][0],
            east: raw[1][1],
        },
        profilePadding: Array.isArray(rawPadding)
            ? {
                  top: rawPadding[1] ?? DEFAULT_PADDING_PX,
                  bottom: rawPadding[1] ?? DEFAULT_PADDING_PX,
                  left: rawPadding[0] ?? DEFAULT_PADDING_PX,
                  right: rawPadding[0] ?? DEFAULT_PADDING_PX,
              }
            : rawPadding,
        mapCenter: [(raw[0][0] + raw[1][0]) / 2, (raw[0][1] + raw[1][1]) / 2],
        profileMaxZoom: cfgMap.initialMaxZoom || cfgMap.maxZoom || 12,
    };
}

/** Build the MapLibre construction options from the profile's map block. */
function buildMapOptions(
    cfgMap: MapConfig,
    profileBounds: GeoLeafBounds | null,
    boundsMargin: number
): Record<string, unknown> {
    const mapOptions: Record<string, unknown> = {};
    const pitch = member(cfgMap, "pitch");
    if (cfgMap.positionFixed === true && profileBounds) {
        mapOptions.maxBounds = padBounds(profileBounds, boundsMargin);
        mapOptions.minZoom =
            typeof cfgMap.minZoom === "number" ? cfgMap.minZoom : POSITION_FIXED_MIN_ZOOM;
    }
    if (typeof cfgMap.minZoom === "number" && !mapOptions.minZoom)
        mapOptions.minZoom = cfgMap.minZoom;
    if (typeof cfgMap.maxZoom === "number") mapOptions.maxZoom = cfgMap.maxZoom;
    if (typeof member(cfgMap, "maxPitch") === "number")
        mapOptions.maxPitch = member(cfgMap, "maxPitch");
    if (typeof pitch === "number") mapOptions.pitch = pitch;
    return mapOptions;
}

/**
 * Create the map through `GeoLeaf.init()`, bracketed by the `mapCreate` perf marks.
 *
 * ⚠️ The boot-created adapter arrives via `module.init(adapter)` and is forwarded
 * through the **internal** `_adapter` option so `_createInstance()` reuses it — one
 * adapter, no double-create, and no module-level seam.
 *
 * ⚠️ The two marks bracket this call and nothing else. They are invisible to the vitest
 * golden-master (no real map); only the browser probe asserts them.
 */
function createMap(
    GeoLeaf: ReturnType<typeof ensureGeoLeaf>,
    adapter: IMapAdapter,
    initOptions: Record<string, unknown>,
    AppLog: AppLog,
    mark: PerfMark
): IMapAdapter | null {
    mark("geoleaf:init:mapCreate:start");
    let map: IMapAdapter | null;
    try {
        const init = asFn(GeoLeaf.init);
        map = (init?.call(GeoLeaf, { ...initOptions, _adapter: adapter }) ??
            null) as IMapAdapter | null;
    } catch (e) {
        AppLog.error("GeoLeaf.init() threw an error:", e);
        return null;
    }
    mark("geoleaf:init:mapCreate:end");

    if (!map) {
        AppLog.error("GeoLeaf.init() did not return a valid map.");
        return null;
    }
    return map;
}

/** Position the fresh map on the profile extent, and report how it was positioned. */
function positionMap(
    map: IMapAdapter,
    extent: ProfileExtent,
    cfgMap: MapConfig,
    boundsMargin: number,
    AppLog: AppLog
): void {
    const { profileBounds, profilePadding } = extent;
    if (profileBounds) {
        try {
            if (typeof map.fitBounds === "function") {
                map.fitBounds(profileBounds, buildFitBoundsOptions(profilePadding));
            }
            AppLog.log("Map positioned via profile map.bounds.");
        } catch (e) {
            AppLog.warn("Error during fitBounds from profile map.bounds:", e);
        }
    } else {
        AppLog.log("Map positioned via profile center+zoom.");
    }

    if (cfgMap.positionFixed === true && profileBounds) {
        AppLog.log(
            "[GeoLeaf] positionFixed enabled — movement restricted to profile extent (margin: " +
                boundsMargin * 100 +
                "%)."
        );
    }
}

/**
 * Publish the cross-module state on `GeoLeaf._app`.
 *
 * ⚠️ Timing is part of the contract, not an implementation detail: these four keys are
 * read by `UIModule.init()` (`_currentMap`) and by `setupReveal` through `RevealDeps`
 * (`_profileBounds`, `_profilePadding`, `_permalinkCfg`). They must be written at the
 * END of this module's init, before the `ui` module runs.
 */
function storeCrossModuleState(
    app: AppNamespace,
    map: IMapAdapter,
    extent: ProfileExtent,
    permalinkCfg: PermalinkRuntimeConfig
): void {
    app._currentMap = map;
    app._profileBounds = extent.profileBounds;
    app._profilePadding = extent.profilePadding;
    app._permalinkCfg = permalinkCfg;
}

/** Runtime lifecycle of the `core-map` boot module. */
export const CoreMapLifecycle = {
    /**
     * Create and position the map from the merged config, then publish the state the
     * downstream boot modules consume.
     *
     * @param adapter - The boot-created map adapter (DI, see {@link createMap}).
     * @param config - The merged runtime config.
     */
    init(adapter: IMapAdapter, config: IGeoLeafConfig): void {
        // (Phase A posts this module's facades at import — `globals.core.ts`. What follows is
        // the real runtime: it needs the adapter and the merged config, so it belongs here.)
        const GeoLeaf = ensureGeoLeaf();
        const app = (GeoLeaf._app ?? {}) as AppNamespace;
        const AppLog = app.AppLog;
        const cfg = asGeoLeafConfig(config);
        const mark: PerfMark = (name) => {
            if (perfWindow().__GEOLEAF_PERF__) performance?.mark?.(name);
        };

        // #3 — before map creation, by contract.
        const permalinkCfg = runPermalinkHook1(GeoLeaf, cfg, AppLog);

        // #5 — resolve extent, build options, create.
        const cfgMap: MapConfig = cfg.map ?? {};
        const extent = resolveProfileExtent(cfgMap, AppLog);
        if (!extent) return;

        const boundsMargin =
            typeof cfgMap.boundsMargin === "number" ? cfgMap.boundsMargin : DEFAULT_BOUNDS_MARGIN;
        const mapOptions = buildMapOptions(cfgMap, extent.profileBounds, boundsMargin);
        const map = createMap(
            GeoLeaf,
            adapter,
            {
                map: {
                    target: cfgMap.target || cfgMap.id || "geoleaf-map",
                    center: extent.mapCenter,
                    zoom: extent.profileMaxZoom,
                    mapOptions,
                },
                ui: { theme: (cfg.ui && cfg.ui.theme) || "light" },
            },
            AppLog,
            mark
        );
        if (!map) return;

        // #6 — (removed, S5) Secondary-module preload. This used to fire
        // `GeoLeaf._loadAllSecondaryModules()` here and await it in `UIModule.init()`.
        // Every module it named is now either deleted or in the eager closure, so Rollup
        // emitted the chunk EMPTY: the round-trip fetched nothing and made the log lie.

        positionMap(map, extent, cfgMap, boundsMargin, AppLog);
        storeCrossModuleState(app, map, extent, permalinkCfg);
    },

    /** Tear down the listeners this module registered. */
    _reset(): void {
        events.offAll();
    },
};
