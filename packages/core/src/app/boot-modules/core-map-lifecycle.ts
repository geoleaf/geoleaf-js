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
 * one of the 19 `ICoreModule` wrappers not following the thin pattern.
 *
 * **Graph-preserving (approach 3.A).** `CoreMapModule` keeps `id = "core-map"` and
 * `dependencies = ["config"]` unchanged, so the boot graph (6 nodes, same edges) does
 * not move and `boot-sequence-order` stays green without edits. Approach 3.B (splitting
 * into several feature modules) was rejected by the plan: it adds nodes and edges and
 * would force the B1→B11 order to be re-validated.
 *
 * ⚠️ **Location deviates from the plan, deliberately.** §3.A targets
 * `built-in/map/core-map-lifecycle.ts` — a directory that no longer exists (a later move
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
 * `UIModule.init()` reads it — but for `_startBounds`, which was `_profileBounds` until the
 * start theme could declare the view the map starts on); permalink hook 1 running before
 * `GeoLeaf.init()`; the
 * `geoleaf:init:mapCreate:start|end` perf marks bracketing map creation and nothing
 * else; and adapter DI through the internal `_adapter` option (no module-level seam).
 */

import type { IMapAdapter, GeoLeafBounds } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import type { MapConfig } from "../../kernel/config/geoleaf-config/config-types.js";
import { events } from "../../utils/general/event-listener-manager.js";
import { padBounds } from "../../kernel/map/map-container.js";
import {
    readStartThemeView,
    resolveThemeView,
    resolveViewPadding,
    themeViewsOutside,
    type ThemeViewDeclaration,
} from "../../kernel/config/view-extent.js";
import { ensureGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { MaplibreAdapter } from "../../adapters/maplibre/maplibre-adapter.js";
import { failBoot } from "../boot-failure.js";
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
    /**
     * Non-null only in the `map.bounds` branch. It bounds the navigation (`maxBounds`), and it
     * is where the map starts unless the start theme declares a view — see {@link StartView}.
     */
    profileBounds: GeoLeafBounds | null;
    profilePadding: RevealPadding | null;
    mapCenter: [number, number];
    profileMaxZoom: number;
}

/** Where the fresh map starts: the profile extent, or the view of the theme it starts on. */
interface StartView {
    /** Fitted at creation and again at reveal; `null` when the map starts on a centre. */
    bounds: GeoLeafBounds | null;
    /** Room kept around `bounds` — the profile's, whichever declared the bounds. */
    padding: RevealPadding | null;
    center: [number, number];
    /** Zoom the map is created at; a fit on `bounds` replaces it at once. */
    zoom: number;
    /**
     * Ceiling on the zoom a fit on `bounds` may reach: the profile's `map.initialMaxZoom` when
     * it DECLARES one, `null` otherwise — whichever block declared the bounds.
     */
    maxZoom: number | null;
}

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
    // ONE reader for `map.padding`, the one a theme view uses: an array reads
    // `[horizontal, vertical]`, an object gives each edge it names and 0 for the others. Until
    // 3.16.3 an object was handed through as declared, and the adapter reads four edges only when
    // `top` or `bottom` is a number: `{ left, right }` started the map with no padding at all,
    // while a theme view kept the two edges. The symmetric `x`/`y` it also returns is dropped —
    // the reveal is handed the four edges, as before.
    const { top, bottom, left, right } = resolveViewPadding(cfgMap.padding);
    return {
        profileBounds: {
            south: raw[0][0],
            west: raw[0][1],
            north: raw[1][0],
            east: raw[1][1],
        },
        profilePadding: { top, bottom, left, right },
        mapCenter: [(raw[0][0] + raw[1][0]) / 2, (raw[0][1] + raw[1][1]) / 2],
        profileMaxZoom: cfgMap.initialMaxZoom || cfgMap.maxZoom || 12,
    };
}

/**
 * Read the `themes` block off the active profile — where a modular profile carries its themes.
 *
 * @returns The block, or `undefined` when the profile carries none. A legacy `themes.json` is
 * fetched once the map exists, so its themes cannot decide where the map starts.
 */
function readProfileThemes(GeoLeaf: ReturnType<typeof ensureGeoLeaf>): unknown {
    const getActiveProfile = asFn(member(GeoLeaf.Config, "getActiveProfile"));
    return member(getActiveProfile?.call(GeoLeaf.Config), "themes");
}

/**
 * Resolve the view the map starts on: the start theme's when it declares one, the profile
 * extent otherwise.
 *
 * A theme view replaces the framing alone. The padding stays the profile's, and so does the
 * navigation limit, which {@link buildMapOptions} reads off the profile extent.
 */
/**
 * The ceiling `map.initialMaxZoom` puts on the start framing, or `null`.
 *
 * 🛑 **Only a DECLARED key caps.** Absent, the key still yields a zoom the map is created at
 * (`resolveProfileExtent` falls back on `maxZoom`, then 12) — and that fallback must not
 * become a ceiling: every profile with a small extent and no such key would start further
 * out than it does today, having asked for nothing.
 */
function declaredInitialMaxZoom(cfgMap: MapConfig): number | null {
    const declared = cfgMap.initialMaxZoom;
    return typeof declared === "number" && Number.isFinite(declared) ? declared : null;
}

function resolveStartView(
    extent: ProfileExtent,
    themeView: ThemeViewDeclaration | null,
    cfgMap: MapConfig
): StartView {
    const maxZoom = declaredInitialMaxZoom(cfgMap);
    if (!themeView) {
        return {
            bounds: extent.profileBounds,
            padding: extent.profilePadding,
            center: extent.mapCenter,
            zoom: extent.profileMaxZoom,
            maxZoom,
        };
    }
    const target = resolveThemeView(themeView);
    if ("bounds" in target) {
        const { north, south, east, west } = target.bounds;
        return {
            bounds: target.bounds,
            // A profile positioned by center+zoom resolved no padding of its own.
            padding: extent.profilePadding ?? resolveViewPadding(cfgMap.padding),
            center: [(south + north) / 2, (west + east) / 2],
            zoom: extent.profileMaxZoom,
            maxZoom,
        };
    }
    return {
        bounds: null,
        padding: null,
        center: [target.center.lat, target.center.lng],
        zoom: target.zoom,
        maxZoom: null,
    };
}

/**
 * Build the map construction options from the profile: its `map` block, and the root
 * `mapOptions` block (the profile's core features file, merged at the profile root).
 *
 * Of the root block, `preserveDrawingBuffer` alone is read — the one key its schema admits.
 * It was declared, validated and read by nobody: a profile asking for a canvas that can be
 * captured got one only when the print plugin happened to be registered first.
 */
function buildMapOptions(
    cfgMap: MapConfig,
    profileBounds: GeoLeafBounds | null,
    boundsMargin: number,
    rootMapOptions: unknown
): Record<string, unknown> {
    const mapOptions: Record<string, unknown> = {};
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
    if (member(rootMapOptions, "preserveDrawingBuffer") === true)
        mapOptions.preserveDrawingBuffer = true;
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

/**
 * Position the fresh map on its start view, and report how it was positioned.
 *
 * `source` is the block that declared the view, as the log names it: `profile map`, or
 * `start theme view`.
 */
function positionMap(map: IMapAdapter, start: StartView, source: string, AppLog: AppLog): void {
    if (!start.bounds) {
        AppLog.log("Map positioned via " + source + ".center + zoom.");
        return;
    }
    try {
        if (typeof map.fitBounds === "function") {
            map.fitBounds(start.bounds, buildFitBoundsOptions(start.padding, start.maxZoom));
        }
        AppLog.log("Map positioned via " + source + ".bounds.");
    } catch (e) {
        AppLog.warn("Error during fitBounds from " + source + ".bounds:", e);
    }
}

/**
 * Report the navigation limit, and the theme views it would cut short.
 *
 * Under `positionFixed` the engine keeps the camera inside the profile extent widened by the
 * margin. A theme view reaching outside it is pulled back in, so it is named here rather than
 * left to be noticed on screen.
 */
function reportNavigationLimit(
    limit: { profileBounds: GeoLeafBounds | null; positionFixed: boolean; boundsMargin: number },
    themes: unknown,
    AppLog: AppLog
): void {
    if (!limit.positionFixed || !limit.profileBounds) return;
    AppLog.log(
        "[GeoLeaf] positionFixed enabled — movement restricted to profile extent (margin: " +
            limit.boundsMargin * 100 +
            "%)."
    );
    const outside = themeViewsOutside(themes, padBounds(limit.profileBounds, limit.boundsMargin));
    if (outside.length > 0) {
        AppLog.warn(
            "[GeoLeaf] Theme view outside the profile extent — positionFixed pulls the camera " +
                "back inside it. Themes: " +
                outside.join(", ")
        );
    }
}

/**
 * Publish the cross-module state on `GeoLeaf._app`.
 *
 * ⚠️ Timing is part of the contract, not an implementation detail: these four keys are
 * read by `UIModule.init()` (`_currentMap`) and by `setupReveal` through `RevealDeps`
 * (`_startBounds`, `_profilePadding`, `_startMaxZoom`, `_permalinkCfg`). They must be written at the
 * END of this module's init, before the `ui` module runs.
 */
function storeCrossModuleState(
    app: AppNamespace,
    map: IMapAdapter,
    start: StartView,
    permalinkCfg: PermalinkRuntimeConfig
): void {
    app._currentMap = map;
    app._startBounds = start.bounds;
    app._profilePadding = start.padding;
    app._startMaxZoom = start.maxZoom;
    app._permalinkCfg = permalinkCfg;
}

/** The container `GeoLeaf.mount(el)` named for the boot in progress — see `app/mount.ts`. */
export interface MountTarget {
    /** The key the map is registered under in `GeoLeaf.Core`. */
    mapId: string;
    /** The container element, when `mount()` was handed one rather than an id. */
    element: HTMLElement | null;
}

/**
 * Reads the mount target of the boot in progress, if a `mount()` started it.
 *
 * @param app - The `GeoLeaf._app` namespace.
 * @returns The target, or `null` for a boot started by `boot()`.
 */
function readMountTarget(app: AppNamespace): MountTarget | null {
    const target = app._mountTarget as MountTarget | null | undefined;
    return target && typeof target.mapId === "string" ? target : null;
}

/**
 * The `geoleaf:boot:failed` reason of a map the adapter could not build.
 *
 * @param cause - What the adapter's `init()` threw, kept on `initError`.
 * @returns `"engine"` for a missing MapLibre, `"webgl"` for a missing WebGL2 context, `"map"`
 *   otherwise.
 */
function _mapFailureReason(cause: unknown): "engine" | "webgl" | "map" {
    if (MaplibreAdapter.isEngineMissingError(cause)) return "engine";
    return MaplibreAdapter.isGpuInitializationError(cause) ? "webgl" : "map";
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
        if (!extent) {
            // Signalled, NOT thrown: a throw would skip every module after this one, and the
            // boot golden master — which boots with no extent on purpose — pins the clean stop.
            failBoot({
                reason: "map",
                phase: "map",
                message:
                    "The active profile defines no valid map extent (map.bounds, or map.center with map.zoom).",
            });
            return;
        }

        const boundsMargin =
            typeof cfgMap.boundsMargin === "number" ? cfgMap.boundsMargin : DEFAULT_BOUNDS_MARGIN;
        const mapOptions = buildMapOptions(
            cfgMap,
            extent.profileBounds,
            boundsMargin,
            member(cfg, "mapOptions")
        );
        // The start theme may declare where the map starts. The profile extent keeps bounding
        // the navigation either way: `mapOptions` above was built from it, not from the view.
        const themes = readProfileThemes(GeoLeaf);
        const themeView = readStartThemeView(themes);
        const start = resolveStartView(extent, themeView, cfgMap);
        // `GeoLeaf.mount(el)` names the container itself (`_app._mountTarget`, set for its boot
        // alone): it wins over the profile's `map.target`, which stays the rule for `boot()`.
        const mountTarget = readMountTarget(app);
        const map = createMap(
            GeoLeaf,
            adapter,
            {
                map: {
                    target: mountTarget?.mapId ?? (cfgMap.target || cfgMap.id || "geoleaf-map"),
                    center: start.center,
                    zoom: start.zoom,
                    mapOptions,
                },
                // The declared theme, or none: the UI orchestrator resolves an absent one
                // (`ui.theme ?? "auto"`, `kernel/ui/ui-api.ts`). This line used to invent
                // "light", which that resolution overwrote before anyone saw it.
                ui: { theme: cfg.ui?.theme },
                ...(mountTarget?.element && { _container: mountTarget.element }),
            },
            AppLog,
            mark
        );
        if (!map) {
            // The facade reduces a failed construction to `null`; the adapter kept the cause.
            // WebGL2 is named apart because it is the one failure the user can act on; a missing
            // engine, because it is the one the integrator must fix — the page never loaded it.
            const cause = adapter instanceof MaplibreAdapter ? adapter.initError : null;
            failBoot({
                reason: _mapFailureReason(cause),
                phase: "map",
                message:
                    cause instanceof Error
                        ? cause.message
                        : "GeoLeaf.init() did not return a valid map.",
            });
            return;
        }

        // #6 — (removed, S5) Secondary-module preload. This used to fire
        // `GeoLeaf._loadAllSecondaryModules()` here and await it in `UIModule.init()`.
        // Every module it named is now either deleted or in the eager closure, so Rollup
        // emitted the chunk EMPTY: the round-trip fetched nothing and made the log lie.

        positionMap(map, start, themeView ? "start theme view" : "profile map", AppLog);
        reportNavigationLimit(
            {
                profileBounds: extent.profileBounds,
                positionFixed: cfgMap.positionFixed === true,
                boundsMargin,
            },
            themes,
            AppLog
        );
        storeCrossModuleState(app, map, start, permalinkCfg);
    },

    /**
     * Tears down what the boot left on the shared listener manager, and the cross-module state
     * this module published. Runs when the application is unmounted.
     *
     * Only the listeners registered since the boot started (`_app._eventsMark`, taken by
     * `bootWithPreset`): what a host registered through `GeoLeaf.Utils.events` before the boot
     * stays. It used to be `offAll()` — harmless while nothing called it, since no production
     * path did. Without a mark, everything goes, as before.
     */
    _reset(): void {
        const app = (ensureGeoLeaf()._app ?? {}) as AppNamespace;
        const mark = app._eventsMark;
        if (typeof mark === "number") events.offSince(mark);
        else events.offAll();
        app._currentMap = null;
        app._startBounds = null;
        app._profilePadding = null;
        app._startMaxZoom = null;
        app._permalinkCfg = null;
    },
};
