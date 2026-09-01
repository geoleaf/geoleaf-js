/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Legend capability — the runtime singleton behind `GeoLeaf.Legend`.
 *
 * Multi-layer cartographic legend manager: it holds the layer registry, generates each
 * layer's entries from its style file, and drives the accordion control.
 *
 * **This is the implementation, not the facade (B.28).** It used to BE
 * `capabilities/legend/public-api.ts` — 546 lines of module state (`_map`, `_control`,
 * three timers), `fetch()` and DOM manipulation, under a name that promised a thin
 * surface. That mislabelling had a structural consequence: `lifecycle.ts` had to import
 * `Legend` from `public-api.js`, making it the ONLY capability whose lifecycle depended
 * on its own public API instead of the other way round (verified by grep across
 * `capabilities/*\/lifecycle.ts`). The runtime now lives here, next to
 * `labels/labels.ts` and `geolocation/geolocation.ts`; `public-api.ts` is the thin
 * re-export `api/geoleaf.legend.ts` publishes, and `lifecycle.ts` imports THIS file.
 */

import { Log } from "../../utils/log/index.js";
import { styleDocumentStore } from "../../utils/loaders/style-cache.js";
import { ensureGeoLeaf } from "../../utils/general/geoleaf-global.js";
import {
    ensureProfileSpriteInjectedSync,
    isProfileSpriteReady,
} from "../../utils/loaders/profile-sprite-loader.js";
import { getLegendConfig } from "./config.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { LEGEND_TAXONOMY_REF } from "./constants.js";
import { dispatchGeoLeafEvent } from "../../kernel/events/index.js";
import {
    hideLoadingOverlay as _hideLoadingOverlay,
    resetOverlay as _resetOverlay,
    showLoadingOverlay as _showLoadingOverlay,
} from "./legend-overlay.js";
import type { LegendControlLike, LegendData } from "./types.js";
import { layerGeometry } from "../../kernel/config/index.js";

// The global `GeoLeaf` namespace shape is declared canonically in `src/global.d.ts`.
// `ensureGeoLeaf()` returns it (creating an empty namespace if boot has not yet
// populated it), preserving the previous `_getGeoLeaf()` non-null contract.
const _getGeoLeaf = ensureGeoLeaf;

interface LegendInitOptions {
    position?: string;
    collapsible?: boolean;
    collapsed?: boolean;
    title?: string;
}

interface ProfileConfig {
    id?: string;
    layers?: { id: string; configFile?: string }[];
}

interface LayerInfo {
    label: string;
    styleId: string | null;
    legendData: LegendData | null;
    visible: boolean;
    order: number;
    geometryType: string;
    configFile?: string;
}

let _map: unknown = null;
let _control: LegendControlLike | null = null;
let _options: LegendInitOptions = {};
let _profileConfig: ProfileConfig | null = null;
let _taxonomyData: Record<string, unknown> | null = null;

let _rebuildTimer: ReturnType<typeof setTimeout> | null = null;
const REBUILD_DEBOUNCE_MS = 150;

/**
 * Reads the legend control's live container for the overlay module. A resolver, not
 * the element: the overlay's auto-hide fires up to 12 s later, by which time
 * `_control` may have been replaced or nulled by `_reset()`.
 */
const _resolveContainer = (): HTMLElement | undefined => _control?._container;

/**
 * Pending "the sprite was missing, re-render once it lands" retry (see
 * {@link _updateLegendContent}). Held in a slot for the same reason as `_rebuildTimer`
 * above and the overlay's own deadline (`legend-overlay.ts`): `_reset()` must be able to
 * cancel every one of them. Left untracked, a destroy inside the
 * retry window let the callback rebuild a torn-down module — or, worse on the recreate
 * path, rebuild the NEXT instance from the previous one's closure.
 */
let _spriteRetryTimer: ReturnType<typeof setTimeout> | null = null;
const SPRITE_RETRY_MS = 2000;

/**
 * Cancellation handle for the style `fetch`es in flight (see {@link LegendModule.loadLayerLegend}).
 *
 * 🛑 FOURTH THING `_reset()` MUST CANCEL, AND FOR THE SAME MOTIVE AS THE OTHER THREE.
 * The three timers above are held in a slot because a `destroy` landing in their window
 * let the callback **rebuild a dismantled module** — or, worse on the recreation path,
 * rebuild the NEXT instance from the previous one's closure. A style request in flight
 * is exactly the same object: its continuation calls `_applyStyleToLegend`, **which
 * writes into the DOM**. The call site's `.catch()` covers network and HTTP failure; it
 * does not cover the target's disappearance.
 *
 * 🛑 ONE CONTROLLER FOR THE WHOLE MODULE, AND THAT IS NOT A SIMPLIFICATION. A
 * per-call controller would cancel the PREVIOUS request when the next one starts — yet
 * two different layers each load their style and both are wanted. What we want to
 * cancel is not "the request before", it is **everything in flight when the module
 * leaves**. Its scope is therefore the module's, like the three slots above.
 *
 * ⚠️ Created LAZILY: building it at import would set an object the first `_reset()`
 * abandons without any request ever having used it.
 */
let _styleFetchController: AbortController | null = null;

/** Returns the style-request signal, creating the controller on first need. */
function _styleFetchSignal(): AbortSignal | undefined {
    if (typeof AbortController !== "function") return undefined;
    _styleFetchController ??= new AbortController();
    return _styleFetchController.signal;
}

const _allLayers = new Map<string, LayerInfo>();

function _normalizeGeometryType(rawGeometry: string | undefined): string {
    const value = (rawGeometry || "").toLowerCase();
    if (value === "polyline" || value === "line") return "line";
    if (value === "polygon") return "polygon";
    return "point";
}

function _scheduleRebuild(): void {
    if (_rebuildTimer) {
        clearTimeout(_rebuildTimer);
    }
    _rebuildTimer = setTimeout(() => {
        _rebuildTimer = null;
        LegendModule._rebuildDisplay();
    }, REBUILD_DEBOUNCE_MS);
}

interface LayerConfigForLegend {
    label?: string;
    geometryType?: string;
    geometry?: string;
    _profileId?: string;
    _layerDirectory?: string;
    styles?: { directory?: string; available?: { id: string; file?: string }[]; default?: string };
    showIconsOnMap?: boolean;
}

function _resolveProfileConfig(Config: GeoLeafGlobal["Config"]): ProfileConfig | null {
    if (!Config) return null;
    if (typeof Config.getActiveProfile === "function") {
        return Config.getActiveProfile() as ProfileConfig | null;
    }
    const allConfig = Config.getAll() as { id?: string; layers?: unknown[] };
    return {
        id: allConfig.id ?? (Config.get("id") as string),
        layers: ((allConfig.layers ?? Config.get("layers")) as ProfileConfig["layers"]) ?? [],
    };
}

function _ensureLegendControl(): void {
    if (_control) return;
    const ControlFactory = _getGeoLeaf()._LegendControl?.create;
    if (ControlFactory) {
        _control = ControlFactory(_options) as LegendControlLike | null;
        // Use the control's own addTo(map) instead of map.addControl(ctrl)
        if (_control && typeof _control.addTo === "function") {
            _control.addTo(_map);
            // S10 F2: signal the legend control is mounted. Emitted once — this
            // function returns early when `_control` already exists.
            dispatchGeoLeafEvent("geoleaf:legend:ready", {
                ...(_options.position !== undefined && { position: _options.position }),
                layerCount: _allLayers.size,
            });
        }
    }
}

function _updateLegendContent(
    ctrl: NonNullable<typeof _control>,
    self: { _rebuildDisplay: () => void }
): void {
    const visibilityManager = _getGeoLeaf()._LayerVisibilityManager;
    const legendsArray: {
        layerId: string;
        label: string;
        collapsed: boolean;
        order: number;
        visible: boolean;
        sections: LegendData["sections"];
    }[] = [];

    _allLayers.forEach((data, layerId) => {
        if (!data.legendData) return;
        const visState =
            typeof visibilityManager?.getVisibilityState === "function"
                ? visibilityManager.getVisibilityState(layerId)
                : null;
        const isVisible = visState?.current ?? data.visible;
        if (!isVisible) return;
        legendsArray.push({
            layerId,
            label: data.label,
            collapsed: true,
            order: data.order,
            visible: true,
            sections: data.legendData.sections ?? [],
        });
    });

    legendsArray.sort((a, b) => a.order - b.order);
    ctrl.updateMultiLayerContent!(legendsArray);

    const hasIcons = legendsArray.some((legend) =>
        legend.sections.some((section) =>
            section.items?.some((item) => (item as { icon?: string }).icon)
        )
    );
    if (hasIcons && !isProfileSpriteReady()) {
        Log?.info("[Legend] Icons detected but sprite missing - scheduling retry");
        // One retry in flight at a time: a burst of content updates must not queue one
        // callback per update, and the slot is what `_reset()` cancels.
        if (_spriteRetryTimer) clearTimeout(_spriteRetryTimer);
        _spriteRetryTimer = setTimeout(() => {
            _spriteRetryTimer = null;
            if (isProfileSpriteReady()) {
                Log?.info("[Legend] Sprite available - re-rendering legend");
                self._rebuildDisplay();
            }
        }, SPRITE_RETRY_MS);
    }
}

function _resolveStyleFilePath(
    profileId: string | undefined,
    layerDir: string | undefined,
    layerConfig: LayerConfigForLegend,
    styleId: string
): string | null {
    if (!layerConfig.styles?.directory) return null;
    const stylesDir = layerConfig.styles.directory;
    const styleFile =
        layerConfig.styles.available?.find((s) => s.id === styleId)?.file ??
        layerConfig.styles.default;
    const Config = _getGeoLeaf().Config;
    const dataCfg = Config?.get
        ? (Config.get("data") as { profilesBasePath?: string } | null)
        : null;
    const profilesBasePath = dataCfg?.profilesBasePath ?? "profiles";
    return `${profilesBasePath}/${profileId}/${layerDir}/${stylesDir}/${styleFile}`;
}

function _resolveLayerGeometryType(
    layerConfig: LayerConfigForLegend,
    layerInfo: LayerInfo
): string {
    // `||` (not `??`): layerInfo.geometryType is initialised to "" (empty string, not
    // nullish), so `??` would stop there and yield "" → normalised to "point". `||`
    // falls through the empty string to the real geometry / the final "point" default.
    // ⚠️ The `geometry`/`geometryType` alias resolution now lives in `layerGeometry`,
    // no longer here: it was hand-written on 3 sites and ABSENT on 4 others.
    // Behaviour unchanged — the helper returns the same thing, in the same order.
    const raw = layerGeometry(layerConfig) || layerInfo.geometryType || "point";
    return _normalizeGeometryType(raw);
}

function _applyStyleToLegend(
    layerId: string,
    layerInfo: LayerInfo,
    styleData: Record<string, unknown>
): void {
    const GeoLeaf = _getGeoLeaf();
    const Generator = GeoLeaf._LegendGenerator;
    if (!Generator) {
        Log?.error("[Legend] LegendGenerator non disponible");
        return;
    }

    // D2: the former POI-shared style bridge here was inert (it reassigned a global
    // the generator's static import never observed) — so the legend used the
    // profile-global default. Call the generator directly (identical behaviour).
    const legendData = Generator.generateLegendFromStyle(
        styleData,
        layerInfo.geometryType,
        _taxonomyData
    ) as LegendData | null;

    if (legendData) {
        layerInfo.legendData = legendData;
        _allLayers.set(layerId, layerInfo);
        Log?.debug(`[Legend] Legend generated for ${layerId}`);
        _scheduleRebuild();
    }
}

const LegendModule = {
    /**
     * Mounts the legend control on a map.
     *
     * Options are layered: the defaults from `modules.legend` in the profile, then anything
     * passed here — explicit options always win. Without a core `Config` on the namespace
     * (a standalone or embedded boot) the defaults are used directly.
     *
     * @param mapInstance - The MapLibre map; a falsy value logs an error and returns `false`.
     * @param options - Position, title and collapsed state, overriding the profile config.
     * @returns `true` when the control was mounted.
     *
     * @example
     * ```js
     * import * as maplibregl from "maplibre-gl";
     * const map = new maplibregl.Map({ container: "map", style: "..." });
     * GeoLeaf.Legend.init(map);
     *
     * // With options
     * GeoLeaf.Legend.init(map, {
     *     position: "bottomright",
     *     collapsed: false,
     *     title: "Légende des couches",
     * });
     * ```
     */
    init(mapInstance: unknown, options?: LegendInitOptions): boolean {
        if (!mapInstance) {
            Log?.error("[Legend] MapLibre map instance required to initialize Legend");
            return false;
        }

        _map = mapInstance;

        const Config = _getGeoLeaf().Config;
        if (Config && typeof Config.get === "function") {
            // S10 F2: options read from `modules.legend` (merged over defaults by the
            // reader), replacing the former `legendConfig` block. `collapsible` stays a
            // fixed control constant. Explicit `options` (if any) still win.
            const legendCfg = getLegendConfig();
            _options = Object.assign(
                {
                    position: legendCfg.position,
                    collapsible: true,
                    collapsed: legendCfg.collapsedByDefault,
                    title: legendCfg.title,
                },
                options ?? {}
            );
            _profileConfig = _resolveProfileConfig(Config);
        } else {
            // No core Config on the namespace — a standalone/embedded boot. The defaults
            // are duplicated here on purpose (the reader lives behind Config), but the
            // TITLE must not be: it was the English literal "Legend" while the interface
            // is French, the same defect B.24/B.38 fixed on the Config path. Both paths
            // now ask the dictionary.
            _options = Object.assign(
                {
                    position: "bottomleft",
                    collapsible: true,
                    collapsed: false,
                    title: getLabel("ui.legend.title"),
                },
                options ?? {}
            );
        }

        this._loadTaxonomy();
        this._initializeAllLayers();

        Log?.info("[Legend] Legend module initialized with automatic generation from styles");
        return true;
    },

    _loadTaxonomy(): void {
        // F5: taxonomy read from the in-core taxonomy capability (`GeoLeaf.Taxonomy`,
        // the named taxonomy under `modules.taxonomy`) — no longer the
        // legacy core taxonomy carried on `_profileConfig.taxonomy`. `symbolPrefix`
        // comes from the same `modules.taxonomy.icons` block; the categories carry
        // their icon under `svgId`.
        const GeoLeaf = _getGeoLeaf();
        const Taxonomy = GeoLeaf.Taxonomy;
        if (!Taxonomy || typeof Taxonomy.getCategories !== "function") {
            _taxonomyData = null;
            return;
        }
        const taxoCfg = (GeoLeaf.Config?.get ? GeoLeaf.Config.get("modules.taxonomy") : {}) as {
            icons?: { symbolPrefix?: string };
        };
        _taxonomyData = {
            // B.36d — `LEGEND_TAXONOMY_REF` is still a constant, not the layer's own
            // `layers.<id>.use`. See the constant's TSDoc for why, and for the
            // measurement showing today's impact is nil.
            categories: Taxonomy.getCategories(LEGEND_TAXONOMY_REF),
            fieldMappings: Taxonomy.getFieldMappings?.(LEGEND_TAXONOMY_REF) ?? {},
            icons: { symbolPrefix: taxoCfg.icons?.symbolPrefix ?? "" },
        };
        if (Log) Log.debug(`[Legend] Taxonomy read from capability (${LEGEND_TAXONOMY_REF})`);
    },

    _initializeAllLayers(): void {
        if (!_profileConfig?.layers?.length) {
            if (Log) Log.warn("[Legend] No layer defined in the profile");
            return;
        }

        _profileConfig.layers.forEach((layerDef, index) => {
            const existing = _allLayers.get(layerDef.id);
            if (existing) {
                // Preserve entry already populated by the theme applier
                // (legendData, visible, label, etc.) — only refresh order.
                existing.order = index + 1;
                if (!existing.configFile && layerDef.configFile) {
                    existing.configFile = layerDef.configFile;
                }
                return;
            }
            _allLayers.set(layerDef.id, {
                label: layerDef.id,
                styleId: null,
                legendData: null,
                visible: false,
                order: index + 1,
                geometryType: "",
                ...(layerDef.configFile !== undefined && { configFile: layerDef.configFile }),
            });
        });

        if (Log) Log.debug(`[Legend] ${_allLayers.size} layer(s) initialized`);
    },

    /**
     * Loads and renders one layer's legend entries.
     *
     * Normally driven by the GeoJSON module as layers come up; calling it directly is the
     * advanced path, for a legend that must be refreshed outside the usual load.
     *
     * @param layerId - Layer whose legend is being loaded.
     * @param styleId - Style whose legend file to read, e.g. `"default"`.
     * @param layerConfig - The layer's config, source of the legend file location.
     *
     * @example
     * ```js
     * // Normally called internally by the GeoJSON module.
     * // For advanced manual use:
     * GeoLeaf.Legend.loadLayerLegend("parcs", "default", layerConfig);
     * ```
     */
    loadLayerLegend(layerId: string, styleId: string, layerConfig: LayerConfigForLegend): void {
        if (!_map) {
            // Silent when the legend is explicitly disabled — module is intentionally not initialized
            if (getLegendConfig().enabled !== false) {
                Log?.warn("[Legend] Module not initialized");
            }
            return;
        }

        const layerInfo = _allLayers.get(layerId);
        if (!layerInfo) {
            Log?.warn(`[Legend] Layer ${layerId} not found in profile`);
            return;
        }

        // Sprite injection goes through the neutral loader (utils/loaders/
        // profile-sprite-loader), never the MapLibre adapter: legend is fully
        // engine-decoupled and the boundary is ESLint-guarded (socle B.1).
        void ensureProfileSpriteInjectedSync();
        Log?.debug(`[Legend] SVG sprite requested for layer ${layerId}`);

        layerInfo.label = layerConfig.label ?? layerId;
        layerInfo.geometryType = _resolveLayerGeometryType(layerConfig, layerInfo);
        layerInfo.styleId = styleId;

        const profileId = layerConfig._profileId ?? _profileConfig?.id;
        const layerDir = layerConfig._layerDirectory ?? `layers/${layerId}`;
        const stylePath = _resolveStyleFilePath(profileId, layerDir, layerConfig, styleId);

        if (!stylePath) {
            Log?.warn(`[Legend] Configuration styles manquante pour ${layerId}`);
            return;
        }

        // Is the document already here? The profile bundle carries them, and this path
        // is the SECOND load of the same style at boot — the first goes through
        // `loadAndValidateStyle`. Consulting the store removes the request without
        // changing the lifecycle at all.
        //
        // 🛑 THE `fetch` STAYS, AND THAT IS NOT SOFT CAUTION. Converging onto
        // `loadAndValidateStyle` would lose two things this path carries and the other
        // does not: the `AbortSignal` (that signature accepts none) and the micro-task
        // guard below. The price would be a DOM write after teardown — invisible to
        // `ci:local`, and already guarded by a test. Converging first requires adding
        // an optional `signal` to the loader: that is a separate batch.
        const seededKey = `${profileId}:${layerId}:${styleId}`;
        if (styleDocumentStore.has(seededKey)) {
            Log?.debug(`[Legend] Style served from the profile bundle: ${seededKey}`);
            _applyStyleToLegend(
                layerId,
                layerInfo,
                styleDocumentStore.get(seededKey) as Record<string, unknown>
            );
            return;
        }

        Log?.debug(`[Legend] Loading style: ${stylePath}`);

        const signal = _styleFetchSignal();
        fetch(stylePath, signal ? { signal } : undefined)
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then((styleData: Record<string, unknown>) => {
                // 🛑 SECOND GUARD, AND IT IS NOT REDUNDANT WITH THE SIGNAL. `abort()`
                // rejects the request, but a response already received at teardown time
                // has its continuation ALREADY SCHEDULED: the micro-task will run after
                // `_reset()`, and write into a DOM that is no longer there. The signal
                // closes the network window, this test closes the micro-task window.
                if (signal?.aborted) return;
                _applyStyleToLegend(layerId, layerInfo, styleData);
            })
            .catch((err: Error) => {
                // A cancellation is not a load failure: logging it as one would show a
                // warning on every normal teardown.
                if (err?.name === "AbortError") return;
                Log?.warn(`[Legend] Failed to load style: ${err.message}`);
            });
    },

    /**
     * Shows or hides one layer's block **within the legend**.
     *
     * ⚠️ This is a legend-display concern only: it does not touch the map layer itself. Use
     * the layer manager to change what is actually drawn.
     *
     * @param layerId - Layer whose legend block is toggled.
     * @param visible - `true` to show the block.
     *
     * @example
     * ```js
     * // Hide the "parcs" layer in the legend
     * GeoLeaf.Legend.setLayerVisibility("parcs", false);
     *
     * // Show the "zones" layer in the legend
     * GeoLeaf.Legend.setLayerVisibility("zones", true);
     * ```
     */
    setLayerVisibility(layerId: string, visible: boolean): void {
        const layerInfo = _allLayers.get(layerId);
        if (layerInfo) {
            layerInfo.visible = visible;
            _allLayers.set(layerId, layerInfo);
            _scheduleRebuild();
            if (Log) Log.debug(`[Legend] Visibility of ${layerId}: ${visible}`);
        }
    },

    _rebuildDisplay(): void {
        if (!_map) return;

        if (_allLayers.size === 0) {
            if (_control && _map) {
                if (typeof _control.remove === "function") {
                    _control.remove();
                }
                _control = null;
            }
            return;
        }

        _ensureLegendControl();

        if (_control?.updateMultiLayerContent) {
            _updateLegendContent(_control, this);
        }
    },

    toggleAccordion(_layerId: string): void {
        // Managed visually by the renderer
    },

    /**
     * Every layer the legend currently tracks, keyed by layer id.
     *
     * @returns A `Map` — iterate with `forEach((info, layerId) => …)`, not as an array.
     *
     * @example
     * ```js
     * const layers = GeoLeaf.Legend.getAllLayers();
     * layers.forEach((info, layerId) => {
     *     console.log(layerId, info.visible, info.label);
     * });
     * ```
     */
    getAllLayers(): Map<string, LayerInfo> {
        return _allLayers;
    },

    /**
     * Hides the legend control, keeping it mounted and its state intact.
     *
     * The reversible counterpart of {@link LegendModule.removeLegend}.
     *
     * @example
     * ```js
     * GeoLeaf.Legend.hideLegend();
     * ```
     */
    hideLegend(): void {
        if (_control?.hide) {
            _control.hide();
        }
    },

    /**
     * Removes the legend control from the map entirely.
     *
     * ⚠️ Unlike {@link LegendModule.hideLegend}, this tears the control down —
     * {@link LegendModule.init} must run again to bring it back.
     *
     * @example
     * ```js
     * GeoLeaf.Legend.removeLegend();
     * ```
     */
    removeLegend(): void {
        _allLayers.forEach((layerInfo) => {
            layerInfo.legendData = null;
            layerInfo.visible = false;
        });

        if (_control && _map) {
            if (typeof _control.remove === "function") {
                _control.remove();
            }
            _control = null;
            if (Log) Log.debug("[Legend] All legends removed");
        }
    },

    /**
     * Whether the legend control is currently displayed.
     *
     * @returns `false` both when the legend is hidden and when it was never mounted.
     *
     * @example
     * ```js
     * if (GeoLeaf.Legend.isLegendVisible()) {
     *     console.log("The legend is displayed");
     * }
     * ```
     */
    isLegendVisible(): boolean {
        return _control !== null && _allLayers.size > 0;
    },

    /**
     * Covers the legend with a loading overlay while entries are being rebuilt.
     *
     * Always pair it with {@link LegendModule.hideLoadingOverlay} — nothing clears the
     * overlay on its own, including a failed load.
     *
     * @example
     * ```js
     * GeoLeaf.Legend.showLoadingOverlay();
     * // ... chargement
     * GeoLeaf.Legend.hideLoadingOverlay();
     * ```
     */
    showLoadingOverlay(): void {
        _showLoadingOverlay(_resolveContainer);
    },

    /**
     * Clears the overlay put up by {@link LegendModule.showLoadingOverlay}.
     */
    hideLoadingOverlay(): void {
        _hideLoadingOverlay(_resolveContainer);
    },

    /**
     * Full teardown for module destroy / lifecycle recreate. Unlike the public
     * `removeLegend()` (which only drops the control), this clears the three pending
     * timers (debounced rebuild, sprite retry, and the overlay's auto-hide deadline via
     * `resetOverlay()`), **cancels the style requests in flight** (see
     * {@link _styleFetchController}), empties the layer map and releases the map / profile /
     * taxonomy references so a subsequent `init()` starts from a clean slate.
     */
    _reset(): void {
        if (_rebuildTimer) {
            clearTimeout(_rebuildTimer);
            _rebuildTimer = null;
        }
        if (_spriteRetryTimer) {
            clearTimeout(_spriteRetryTimer);
            _spriteRetryTimer = null;
        }
        // The controller is SET BACK TO NULL, not reused: an already-aborted
        // `AbortController` stays aborted for life, so keeping it would fail every
        // request of a later instance outright — the recreation path, the very one the
        // timer slot above exists to protect.
        if (_styleFetchController) {
            _styleFetchController.abort();
            _styleFetchController = null;
        }
        _resetOverlay();
        if (_control && typeof _control.remove === "function") {
            _control.remove();
        }
        _control = null;
        _allLayers.clear();
        _map = null;
        _options = {};
        _profileConfig = null;
        _taxonomyData = null;
    },
};

/**
 * True once `init()` has bound a map — the seam's real readiness predicate.
 *
 * Exported for `legend-seam.ts`, which guards the kernel callers (style selector, theme
 * UI sync). They fire while the theme engine is applying its layers, i.e. BEFORE the
 * `geoleaf:app:ready` mount; without this predicate the seam let them through and each
 * one hit the `!_map` branch of `loadLayerLegend`. Nothing is lost by stopping them:
 * `LegendLifecycle` loads every configured layer's legend right after `init`.
 *
 * @returns `true` between a successful `init()` and the next `_reset()`.
 */
function isLegendInitialized(): boolean {
    return _map !== null;
}

const Legend = LegendModule;

export { Legend, isLegendInitialized };
