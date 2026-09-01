/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * UMD/ESM bridge — B5 — GeoJSON layers and Route module initialization.
 *
 * This runtime initialization module registers all GeoJSON and Route internals
 * on `globalThis.GeoLeaf`. It is imported as a side-effect by `globals.ts`.
 *
 * Registers:
 *   - `GeoJSON` core (`GeoJSONCore`, clustering, shared, feature validator)
 *   - Style utilities (`_GeoJSONStyleResolver`, `_StyleRules`)
 *   - Visibility manager, worker manager
 *   - Layer config manager, popup/tooltip, layer manager sub-modules (store,
 *     visibility, style, integration), loader sub-modules (config, data, profile, single-layer)
 *
 * Sprint S2 (boot-di-lifecycle): the imperative body is extracted into the
 * re-callable {@link setupGeoJSONKernel} and registered under the `geojson` id. It runs
 * once at import time (golden master unchanged); `GeoJSONModule.init()` re-invokes
 * it via the registry (guarded no-op until S3/S4).
 *
 * Presets build (S5, S7): this file is 100 % kernel — **no capability is imported here,
 * directly or transitively**. `VectorTiles` used to be a direct static import (S5); the
 * GeoJSON loader (`loader/{single-layer,adapter-options}.ts`, imported by this file) used
 * to statically import `cluster/{strategy,options}.js` too (S7) — both are now reached
 * through the service locator, like `Labels`, `Taxonomy` and `_DataConverter` already were.
 *
 * @see globals for the orchestrator and import order
 */

// B5 : geojson, route
import { FeatureValidator } from "../kernel/geojson/feature-validator.js";
import { VisibilityManager as LayerVisibilityManager } from "../kernel/geojson/visibility-manager.js";
import { WorkerManager } from "../kernel/geojson/worker-manager.js";
import { getAllLayerConfigs, setAllLayerConfigs } from "../kernel/shared/layer-configs-state.js";
import { LayerConfigManager } from "../kernel/geojson/layer-config-manager.js";
import { LayerManagerStore } from "../kernel/geojson/layers/store.js";
import { LayerManagerVisibility } from "../kernel/geojson/layers/visibility.js";
import { LayerManagerStyle } from "../kernel/geojson/layers/style.js";
import { LayerManagerIntegration } from "../kernel/geojson/layers/integration.js";
import { LoaderProfile, setupProfileDeps } from "../kernel/geojson/loader/profile.js";
import { LoaderSingleLayer, setupSingleLayerDeps } from "../kernel/geojson/loader/single-layer.js";
import type {
    LoaderDependencies,
    ValidatorModule,
    GeoJSONLoaderLike,
    GeoJSONLayerManagerLike,
    ConfigModule,
    UtilsModuleLike,
    CoreModuleLike,
    LabelsLike,
    DataConverterLike,
    TaxonomySymbolResolver,
    VectorTilesLike,
    ClusterResolversLike,
} from "../kernel/geojson/loader/loader-types.js";
import { GeoJSONCore } from "../kernel/geojson/core.js";
import { ensureGeoLeaf } from "../utils/general/geoleaf-global.js";

/** Plugin registry surface read for declarative `plugin:` layer loaders. */
interface PluginLayerLoaderRegistry {
    getLayerLoader?: (
        id: string
    ) => ((def: Record<string, unknown>) => Promise<string>) | undefined;
    /** True when `id` has a lazy resolver registered and is not loaded yet. */
    isLazyAvailable?: (id: string) => boolean;
    /** Runs the lazy resolver registered for `id`. Throws on an unknown id — hence the guard. */
    load?: (id: string) => Promise<void>;
}

/**
 * B5 — GeoJSON core, styles, clustering, workers and layer/loader sub-modules,
 * plus the loader service-locator wiring. Re-callable; bound to the `geojson`
 * module lifecycle. Idempotent: the `setupXyzDeps()` calls re-inject the same
 * getter-based dependencies.
 */
export function setupGeoJSONKernel(): void {
    // Dynamic namespace registration: write through a bag view (see globals.ui).
    const _gl = ensureGeoLeaf() as unknown as Record<string, unknown>;
    // ── B5 assignations ────────────────────────────────────────────────────
    // `Object.assign` past 3 sources falls back to its `: any` overload — cast
    // back to the structural manager view (matches the loader cast below).
    const _GeoJSONLayerManager = Object.assign(
        {},
        LayerManagerStore,
        LayerManagerVisibility,
        LayerManagerStyle,
        LayerManagerIntegration
    ) as unknown as GeoJSONLayerManagerLike & Record<string, unknown>;
    const _GeoJSONLoader = Object.assign(
        {},
        LoaderProfile,
        LoaderSingleLayer
    ) as unknown as GeoJSONLoaderLike & Record<string, unknown>;
    // Missing delegation: _resolveDataFilePath is not defined in any Loader sub-module.
    // LayerConfigManager.resolveDataFilePath resolves the path of a GeoJSON data file.
    _GeoJSONLoader._resolveDataFilePath =
        LayerConfigManager.resolveDataFilePath?.bind(LayerConfigManager);
    // Five `_` keys left the namespace here: `_GeoJSONShared`,
    // `_GeoJSONFeatureValidator`, `_GeoJSONStyleResolver`, `_StyleRules` and
    // `_WorkerManager`. None had a reader — not in the core, not in the 13
    // plugins, not in the app. Nor were they typed in `global.d.ts`, so HOST-02 is
    // indifferent.
    _gl._LayerVisibilityManager = LayerVisibilityManager;
    _gl._GeoJSONLayerConfig = LayerConfigManager;
    _gl._GeoJSONLayerManager = _GeoJSONLayerManager;
    _gl._GeoJSONLoader = _GeoJSONLoader;
    _gl.GeoJSON = GeoJSONCore;

    // ── Phase 10-F — Service locator wiring for GeoJSON loaders ──────────────
    const _loaderDeps: LoaderDependencies = {
        getLayerManager: () => _GeoJSONLayerManager,
        getLoader: () => _GeoJSONLoader,
        getConfig: () => _gl.Config as ConfigModule | undefined,
        getFeatureValidator: () => FeatureValidator as ValidatorModule,
        getLayerConfig: () => LayerConfigManager,
        // Capability, not kernel (S5): the `vector-tiles` installer writes `_VectorTiles`.
        // Read it back lazily — an entry that leaves the capability out simply has no writer,
        // and `single-layer.ts` falls through to the plain-GeoJSON path (`if (VT && …)`).
        getVectorTiles: () => _gl._VectorTiles as VectorTilesLike | undefined,
        // Capability, not kernel (S7): the `cluster` installer writes `_Cluster` (the two
        // pure resolvers). Read it back lazily — an entry that leaves the capability out
        // simply has no writer, and the loader falls back to `{ shouldCluster: false }`.
        getCluster: () => _gl._Cluster as ClusterResolversLike | undefined,
        getUtils: () => _gl.Utils as UtilsModuleLike | undefined,
        getCore: () => _gl.Core as CoreModuleLike | undefined,
        getLabels: () => _gl.Labels as LabelsLike | undefined,
        getWorkerManager: () => WorkerManager,
        getDataConverter: () => _gl._DataConverter as DataConverterLike | undefined,
        // The seam goes through `kernel/shared/layer-configs-state`, no longer
        // through `_gl._allLayerConfigs`. That state was not a facade: nothing
        // public exposed it, no plugin read it, no type declared it — and it was
        // OUTSIDE the three oracles, hence renamable with no gate flinching.
        getAllLayerConfigs,
        setAllLayerConfigs,
        getPluginLayerLoader: (pluginId: string) =>
            (_gl.plugins as PluginLayerLoaderRegistry | undefined)?.getLayerLoader?.(pluginId),
        // The ASYNCHRONOUS counterpart of the getter above. A lazily-registered
        // plugin has not yet run its `registerLayerLoader()`, so the getter yields
        // `undefined` and the layer is skipped at 0 features. This seam lets both
        // dispatchers load it first, without the core ever naming a plugin:
        // resolution stays by ID, `isLazyAvailable` decides, and an id nobody
        // provides is not an error here — the caller's `warn` says it.
        ensurePluginLoaded: async (pluginId: string) => {
            const reg = _gl.plugins as PluginLayerLoaderRegistry | undefined;
            if (reg?.isLazyAvailable?.(pluginId)) await reg.load?.(pluginId);
        },
        getTaxonomyResolvePoiIcon: () =>
            (_gl.Taxonomy as { resolvePoiIcon?: TaxonomySymbolResolver } | undefined)
                ?.resolvePoiIcon,
    };
    setupProfileDeps(_loaderDeps);
    setupSingleLayerDeps(_loaderDeps);
}

// ── PHASE A — see the rationale in `globals.config.ts`. ──────────────────────────────────────
//
// Safe to run eagerly despite the loader wiring above: `_loaderDeps` is entirely getter-based
// (it resolves `GeoLeaf.*` lazily, on access), so posting it at import reads nothing yet — it
// only installs the indirection that `GeoJSONModule.init()` will exercise later, with a real map.
setupGeoJSONKernel();
