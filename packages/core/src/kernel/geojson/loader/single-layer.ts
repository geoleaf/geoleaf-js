/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Loader - Single Layer
 * Complete loading pipeline for a single layer
 * Sprint 7 : Web Worker fetch+parse + chunked addData via requestIdleCallback
 * Sprint 8 : Vector tiles — early-exit to VectorTiles module when configured
 */

import { GeoJSONShared } from "../shared.js";
import { getLog } from "../../../utils/general/di-accessors.js";
import { StorageContract } from "../../shared/index.js";
import { fetchOgcApiFeatures, setupAutoRefresh } from "./ogc-api-loader.js";
import type {
    DefLike,
    GeoJSONLoaderLog,
    GeoJSONState,
    LoaderDependencies,
    WorkerManagerLike,
    DataConverterLike,
    MapAdapterLike,
    OgcApiConfig,
    LayerDataConfig,
    ClusterResolversLike,
} from "./loader-types.js";
import type { GeoJSONNativeMap } from "../core-types.js";
import { applyDataMapping } from "./data-mapping.js";
import { injectSymbolIds } from "./symbol-injector.js";
import { buildSingleLayerAdapterOptions } from "./adapter-options.js";
import { bindFeatureInteractionEvents } from "../feature-interaction.js";
import { notifyPrimitive } from "../../../utils/notify/notify.primitive.js";

const getState = () => GeoJSONShared.state;

// ─── Phase 10-F service locator ───────────────────────────────────────────────

let _deps: LoaderDependencies | null = null;

/**
 * Injects loader dependencies (Phase 10-F — service locator pattern).
 * Called once at boot by globals.geojson.ts after GeoLeaf modules are registered.
 */
export function setupSingleLayerDeps(deps: LoaderDependencies): void {
    _deps = deps;
}

const getVectorTiles = () => _deps?.getVectorTiles();
const getCluster = () => _deps?.getCluster();

/** Reads the `window.__GEOLEAF_PERF__` opt-in flag (perf instrumentation toggle). */
function _isPerfEnabled(): boolean {
    return !!(window as unknown as { __GEOLEAF_PERF__?: boolean }).__GEOLEAF_PERF__;
}

/**
 * La couche déclare-t-elle vouloir être servie depuis le magasin hors-ligne ? (tâche 4.3)
 *
 * ⚠️ **DÉCLARÉ, jamais deviné.** Lire le store dès qu'il porte des entités — l'option écartée
 * à l'arbitrage — ferait dépendre la source de vérité d'un ACCIDENT DE PEUPLEMENT : une couche
 * partiellement rapatriée servirait du partiel en silence, et l'écriture optimiste de 4.4
 * n'aurait aucun moyen de savoir si sa saisie sera relue.
 *
 * ⚠️ Et ce drapeau **ne dit rien de l'éditabilité** — invariant S6 du contrat. Il ouvre une
 * LECTURE locale ; ce qui décide d'une outbox est l'éditabilité EN LIGNE, et rien d'autre.
 * Dériver l'une de l'autre ferait du « télécharger » un moyen d'écrire là où le bloc `edition`
 * l'interdit.
 */
function _readsOffline(def: DefLike): boolean {
    const off = (def as { offline?: { enabled?: unknown } }).offline;
    return !!off && typeof off === "object" && off.enabled === true;
}

/**
 * Lit la couche depuis le magasin par entité, ou rend `null` pour laisser le réseau faire.
 *
 * Passe par `StorageContract.DB` et **jamais** par un import de `capabilities/` : le kernel
 * n'en importe aucun, et cette frontière est la raison d'être du seam. La façade est narrowée
 * ici, localement, comme le fait déjà `poi-restore`.
 */
/**
 * Délai au bout duquel on renonce à attendre le moteur hors-ligne et on prend le réseau.
 *
 * 🛑 CE NOMBRE EXISTE PARCE QUE `whenReady()` PEUT NE JAMAIS RÉSOUDRE. Son propre TSDoc le
 * dit : « While `modules.offline` is disabled the engine never loads and this never
 * resolves ». Attendre sans borne ferait qu'une couche déclarée `offline` sur une variante
 * SANS moteur ne se chargerait **jamais** — un profil portable rendrait la carte vide selon
 * la variante qui le sert.
 *
 * 3 s : le moteur est un chunk différé, mesuré à **157 ms** sur rechargement chaud et
 * **905 ms** au premier boot sur cette machine. La borne laisse donc trois fois la mesure la
 * plus lente, et ne coûte ce délai que sur une variante où le moteur ne viendra pas.
 */
const OFFLINE_ENGINE_WAIT_MS = 3000;

/**
 * Attend que le moteur de stockage soit câblé, sans risquer d'attendre pour rien.
 *
 * 🛑 SANS CETTE ATTENTE, LA BRANCHE 4.3 NE TIRAIT JAMAIS — et c'est le défaut qui a coûté le
 * plus long diagnostic du sprint. `globals.storage.ts` l'annonce pourtant : « the engine
 * (DB/CacheManager/Cache) is injected LATER via `Storage.wireModules(...)` ». Le moteur est un
 * chunk **différé**, les couches GeoJSON chargent au boot (premier lot à ~85 ms) :
 * `StorageContract.DB` valait donc `null` à l'instant précis où la lecture le consultait, et
 * le repli réseau s'exécutait **en silence**. Tout était juste — la clé dans le `def`, le code
 * dans le chunk servi, la lecture elle-même — sauf l'ordre.
 *
 * @returns `true` si le moteur est utilisable, `false` s'il faut prendre le réseau.
 */
async function _awaitOfflineEngine(layerId: string): Promise<boolean> {
    if (StorageContract.DB) return true;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), OFFLINE_ENGINE_WAIT_MS);
    });
    const ready = StorageContract.whenReady().then(() => true as const);

    const won = await Promise.race([ready, timedOut]);
    if (timer) clearTimeout(timer);

    if (!won) {
        // ⚠️ Le repli se DIT. C'est un repli muet qui a rendu ce défaut si long à trouver :
        // la couche s'affichait, remplie par le réseau, et rien ne distinguait « le store
        // était vide » de « le moteur n'était pas là ».
        getLog()?.warn?.(
            `[GeoLeaf.GeoJSON] Layer "${layerId}" declares an offline read but the storage ` +
                `engine did not wire within ${OFFLINE_ENGINE_WAIT_MS} ms — loading from network.`
        );
        return false;
    }
    return !!StorageContract.DB;
}

async function _readFromOfflineStore(layerId: string): Promise<unknown | null> {
    try {
        if (!(await _awaitOfflineEngine(layerId))) return null;
        // `StorageContract.DB` est un getter : il rend `null` tant que `wireModules()` n'a pas
        // eu lieu, d'où l'attente ci-dessus.
        const db = StorageContract.DB as {
            getLayerFeatureCollection?: (id: string) => Promise<unknown | null>;
        } | null;
        if (!db?.getLayerFeatureCollection) return null;
        return (await db.getLayerFeatureCollection(layerId)) ?? null;
    } catch (err) {
        // Une lecture locale qui échoue ne doit pas empêcher la couche de se charger : on
        // retombe sur le réseau. Mais on le DIT — un repli muet rendrait indiscernable
        // « le store est vide » de « le store est cassé ».
        getLog()?.warn?.(
            `[GeoLeaf.GeoJSON] Offline read failed for ${layerId}, falling back to network:`,
            err
        );
        return null;
    }
}

function _getDataPromise(
    fromCache: boolean,
    useWorker: boolean,
    def: DefLike,
    WorkerMgr: WorkerManagerLike | undefined,
    layerId: string
): Promise<unknown> {
    if (fromCache) return Promise.resolve(def._cachedData);

    // 🛑 TÂCHE 4.3 — LA LECTURE LOCALE PRÉCÈDE LE RÉSEAU, et c'est tout son sujet.
    //
    // Placée APRÈS le fetch en repli (l'option « réseau d'abord, store ensuite »), elle
    // n'aurait pas répondu à l'énoncé : en ligne on refetcherait, le store ne serait jamais
    // la source de vérité, et l'écriture optimiste de 4.4 serait écrasée au chargement
    // suivant. Une saisie de terrain qui disparaît au rechargement est exactement le défaut
    // que ce sprint existe pour fermer.
    //
    // ⚠️ Le repli réseau reste là quand le store est VIDE — `getLayerFeatureCollection` rend
    // `null` et non une collection vide, précisément pour que les deux cas se distinguent.
    if (_readsOffline(def)) {
        return _readFromOfflineStore(layerId).then((local) => {
            if (local) return local;
            return _fetchLayerData(useWorker, def, WorkerMgr, layerId);
        });
    }

    return _fetchLayerData(useWorker, def, WorkerMgr, layerId);
}

function _fetchLayerData(
    useWorker: boolean,
    def: DefLike,
    WorkerMgr: WorkerManagerLike | undefined,
    layerId: string
): Promise<unknown> {
    const dataCfg = def.data as LayerDataConfig | undefined;
    // Custom per-layer request headers (e.g. content negotiation for a PostgREST/PostGIS
    // GeoJSON endpoint). The worker fetch path does not forward these headers, so when
    // they are set we fall back to a direct main-thread fetch. The Connector plugin's
    // global fetch patch still adds Authorization on top for the configured baseUrl.
    const headers = dataCfg?.headers;
    // B.6 / ANO-083 — a layer declaring `data.mapping` fetches a FOREIGN payload (e.g. the
    // GBIF Occurrence API `{ results: [...] }`), not GeoJSON. The worker's job is to chunk a
    // FeatureCollection: `_normalizeFeatures` keeps only `.features` / a top-level array and
    // DISCARDS everything else, so the envelope `applyDataMapping` needs is destroyed before
    // it ever reaches the main thread — the worker resolves `{FeatureCollection, features:[]}`
    // and the mapping then logs "no items array found at itemsPath" and renders 0 feature.
    // That made the whole per-source mapping pipeline dead in the browser (it only ever
    // worked in unit tests, which call the loader without a worker). Non-GeoJSON sources
    // therefore take the main-thread fetch, which hands the raw response over untouched.
    const usesMapping = typeof dataCfg?.mapping === "string" && dataCfg.mapping.length > 0;
    if (useWorker && WorkerMgr && !headers && !usesMapping)
        return WorkerMgr.fetchGeoJSON(def.url!, layerId);
    return fetch(def.url!, headers ? { headers } : undefined).then((response) => {
        if (!response.ok) throw new Error("HTTP " + response.status + " for " + def.url);
        return response.json();
    });
}

function _convertRawData(
    rawData: unknown,
    DataConverter: DataConverterLike | undefined
): { type?: string; features?: unknown[] } {
    return DataConverter
        ? DataConverter.autoConvert(rawData)
        : (rawData as { type?: string; features?: unknown[] });
}

/** Resolves the active mapping config and applies any declared per-source `data.mapping`. */
function _mapRawData(
    rawData: unknown,
    def: DefLike,
    layerId: string,
    Log: GeoJSONLoaderLog
): unknown {
    const mappingConfig = _deps?.getConfig()?.getActiveProfileMapping?.() ?? null;
    return applyDataMapping(
        rawData,
        def.data as LayerDataConfig | undefined,
        layerId,
        Log,
        mappingConfig
    );
}

function _notifyStyleFail(layerLabel: string): void {
    // S7: emit via the kernel notify primitive (anchor B2, always present). The
    // former `_deps.getNotifications()` read `GeoLeaf.Notifications`, which was
    // never mounted → this warning was dead. The primitive buffers + console-falls
    // back, and the toast-renderer capability renders it when present.
    notifyPrimitive.notify(
        `Default style not found for « ${layerLabel} ». Displaying with neutral style.`,
        "warning"
    );
}

function _applyPreloadedStyle(def: DefLike, psd: Record<string, unknown>): void {
    const resolvedDefault = psd.defaultStyle || psd.style;
    if (resolvedDefault) def.style = Object.assign({}, def.style || {}, resolvedDefault);
    if (Array.isArray(psd.styleRules) && (psd.styleRules as unknown[]).length)
        def.styleRules = psd.styleRules as unknown[];
}

async function _preloadStyle(
    def: DefLike,
    layerId: string,
    layerLabel: string,
    Log: GeoJSONLoaderLog
): Promise<Record<string, unknown> | null> {
    if (!(def.styles && def.styles.default)) return null;
    try {
        const psd = await _deps?.getLayerConfig()?.loadDefaultStyle(layerId, def);
        if (psd) {
            _applyPreloadedStyle(def, psd);
            Log.debug("[GeoLeaf.GeoJSON] Style preloaded for:", layerId);
        }
        return psd as Record<string, unknown> | null;
    } catch (err) {
        Log.warn("[GeoLeaf.GeoJSON] Failed to preload style for:", layerId, (err as Error).message);
        _notifyStyleFail(layerLabel);
        return null;
    }
}

const Loader: {
    _loadSingleLayer: (
        layerId: string,
        layerLabel: string,
        def: DefLike,
        baseOptions: Record<string, unknown>
    ) => Promise<{ id: string; label: string; featureCount: number }>;
} = {} as {
    _loadSingleLayer: (
        layerId: string,
        layerLabel: string,
        def: DefLike,
        baseOptions: Record<string, unknown>
    ) => Promise<{ id: string; label: string; featureCount: number }>;
};

/** Emits feature interaction events (click/hover) for the attribute-rendering capability. */
function _bindSingleLayerInteractions(
    layerId: string,
    def: DefLike,
    nativeMap: GeoJSONNativeMap,
    subLayerIds: string[]
): void {
    bindFeatureInteractionEvents(layerId, def, nativeMap, subLayerIds);
}

/** Resolves the profile-relative base path and inferred geometry type for a layer. */
function _resolveSingleLayerMeta(
    def: DefLike,
    geojsonData: { type?: string; features?: unknown[] }
): { layerBasePath: string; inferredGeometry: string } {
    const Config = _deps?.getConfig();
    const dataCfg = Config?.get ? Config.get("data") : null;
    const profilesBasePath =
        (dataCfg as { profilesBasePath?: string })?.profilesBasePath || "profiles";
    const layerBasePath = `${profilesBasePath}/${def._profileId}/${def._layerDirectory}`;
    const inferredGeometry =
        _deps?.getLayerConfig()?.inferGeometryType?.(def, geojsonData) || "mixed";
    return { layerBasePath, inferredGeometry };
}

/** Assembles the shared-state layer-data record for a freshly loaded MapLibre layer. */
function _buildSingleLayerData(args: {
    layerId: string;
    layerLabel: string;
    def: DefLike;
    clusterResult: { shouldCluster: boolean; useSharedCluster?: boolean };
    features: unknown[];
    layerBasePath: string;
    inferredGeometry: string;
    preloadedStyleData: Record<string, unknown> | null;
    subLayerIds: string[];
}): Record<string, unknown> {
    const {
        layerId,
        layerLabel,
        def,
        clusterResult,
        features,
        layerBasePath,
        inferredGeometry,
        preloadedStyleData,
        subLayerIds,
    } = args;
    return {
        id: layerId,
        label: layerLabel,
        layer: null, // No layer object (MapLibre)
        visible: true,
        config: def,
        clusterGroup: clusterResult.shouldCluster ? layerId : null,
        legendsConfig: def.legends,
        basePath: layerBasePath,
        useSharedCluster: clusterResult.useSharedCluster,
        features,
        geometryType: def.geometryType || inferredGeometry,
        currentStyle: preloadedStyleData,
        _maplibreLayerId: layerId,
        _maplibreSubLayerIds: subLayerIds,
        _visibility: {
            current: true,
            logicalState: true,
            source: "system",
            userOverride: false,
            themeOverride: false,
            themeDesired: null,
            zoomConstrained: false,
        },
    };
}

/** Initialises labels for the layer when a style was preloaded or labels are enabled. */
function _maybeInitSingleLayerLabels(
    layerId: string,
    def: DefLike,
    preloadedStyleData: Record<string, unknown> | null
): void {
    const Labels = _deps?.getLabels();
    if (Labels && typeof Labels.initializeLayerLabels === "function") {
        if (preloadedStyleData || (def.labels && def.labels.enabled)) {
            Labels.initializeLayerLabels(layerId);
        }
    }
}

/**
 * Resolves the active map adapter (shared state or core fallback), throwing when
 * unavailable. Extracted to keep `_doLoadSingleLayerMapLibre` ≤ 20 complexity.
 */
/**
 * Point count above which rendering unclustered starts to strain the WebGL layer budget.
 * Matches the threshold the POI-era warning used, before it was purged with that module.
 */
const UNCLUSTERED_POINTS_WARN_THRESHOLD = 1000;

/**
 * Warns when a layer renders many points WITHOUT clustering — the case where a heavy
 * profile degrades the browser silently.
 *
 * Rebuilt from scratch on the GeoJSON pipeline: the original warning lived in the POI
 * monolith (`poi/core.ts`, dissolved in S9) and went with it, and nothing replaced it.
 * It was nearly mute anyway — it required `clustering === false`, a STRICT equality,
 * while the default is `undefined`: it only ever fired for profiles that explicitly
 * turned clustering off. This one keys off the resolved strategy, so it speaks whenever
 * points actually render unclustered, whatever the reason.
 *
 * Warning only: forcing clustering here would change the rendering without the
 * integrator asking for it.
 */
function _warnOnUnclusteredPointVolume(
    features: unknown[],
    clusterResult: { shouldCluster: boolean },
    layerId: string,
    layerLabel: string,
    Log: GeoJSONLoaderLog
): void {
    if (clusterResult.shouldCluster) return;
    if (features.length <= UNCLUSTERED_POINTS_WARN_THRESHOLD) return;

    // Clustering only ever applies to points: a heavy polygon layer is not this warning's
    // business. Same probe as `getClusteringStrategy`, so the two agree on what a point is.
    const hasPoints = features.some(
        (f) => (f as { geometry?: { type?: string } })?.geometry?.type?.includes("Point") ?? false
    );
    if (!hasPoints) return;

    Log.warn(
        `[GeoLeaf.GeoJSON] ${layerLabel || layerId}: ${features.length} points rendered ` +
            `unclustered (threshold ${UNCLUSTERED_POINTS_WARN_THRESHOLD}). This strains the ` +
            `WebGL layer budget and can degrade the browser. Enable clustering for this layer ` +
            `(\`clustering: { enabled: true }\` in its config) or globally ` +
            `(\`modules.cluster.clustering: true\`).`
    );
}

function _resolveSingleLayerAdapter(state: GeoJSONState): MapAdapterLike {
    const adapter = (state.adapter || _deps?.getCore()?.getMap?.()) as MapAdapterLike;
    if (!adapter) throw new Error("[GeoLeaf.GeoJSON] MapLibre adapter not available");
    return adapter;
}

/**
 * Latitude the style's scale bounds are converted at — the map's current centre.
 *
 * A scale denominator maps to a zoom level THROUGH the latitude, so the bounds have to be
 * anchored somewhere. The centre at load time is the closest thing to "where the user is
 * looking"; `ZoomRangeSync` re-pushes the range when the map travels far enough in
 * latitude for the conversion to drift.
 *
 * Returns `undefined` when no map is available (headless/tests) — the caller then simply
 * posts no zoom bounds rather than guessing a latitude.
 */
function _resolveReferenceLat(state: GeoJSONState): number | undefined {
    const map = state.map as GeoJSONNativeMap | undefined;
    const center = map?.getCenter?.();
    return typeof center?.lat === "number" ? center.lat : undefined;
}

async function _doLoadSingleLayerMapLibre(
    rawData: unknown,
    fromCache: boolean,
    def: DefLike,
    layerId: string,
    layerLabel: string,
    state: GeoJSONState,
    Log: GeoJSONLoaderLog,
    stylePromise?: Promise<Record<string, unknown> | null>
): Promise<{ id: string; label: string; featureCount: number }> {
    if (fromCache) delete def._cachedData;
    // R-perf S1 (refinement) — break `post` into CPU (convert) vs network (style
    // fetch) vs addSource, to tell apart main-thread work from awaited I/O.
    const _perf = _isPerfEnabled();
    const _mark = () => (_perf ? performance.now() : 0);
    const _tConvert = _mark();
    const DataConverter = _deps?.getDataConverter();
    // B.6 — normalize raw external-source data via mapping.json when the layer declares
    // `data.mapping` (per-source block id); otherwise passes the data through unchanged.
    const mappedData = _mapRawData(rawData, def, layerId, Log);
    const geojsonData = _convertRawData(mappedData, DataConverter);

    // Inject symbolId into Point features for SVG icon rendering via the taxonomy
    // capability (resolvePoiIcon, per-layer `modules.taxonomy` binding); the
    // resolver getter is absent in the Lite bundle → no icons injected.
    if (def.showIconsOnMap)
        injectSymbolIds(geojsonData, layerId, _deps?.getTaxonomyResolvePoiIcon?.());

    const features = Array.isArray(geojsonData.features) ? geojsonData.features : [];
    const _convertMs = _perf ? performance.now() - _tConvert : 0;
    Log.debug("[GeoLeaf.GeoJSON] MapLibre layer data converted", {
        layerId,
        features: features.length,
    });

    // Style — normally already in flight since before the data was requested (S5.3), so this
    // await is what is LEFT of a fetch that overlapped the data, not the fetch itself.
    // `stylePromise` is absent only for callers that resolve their data before reaching here.
    const _tStyle = _mark();
    const preloadedStyleData =
        (await (stylePromise ?? _preloadStyle(def, layerId, layerLabel, Log))) ?? null;
    const _styleMs = _perf ? performance.now() - _tStyle : 0;

    // Resolve adapter and add source+layers via IMapAdapter
    const adapter = _resolveSingleLayerAdapter(state);

    // Resolve clustering strategy from profile/layer config (cluster capability, S7 —
    // resolved through the service locator; absent capability behaves exactly like a
    // present-but-disabled `modules.cluster.enabled: false` config: no clustering).
    const cluster: ClusterResolversLike | undefined = getCluster();
    const clusterResult = cluster
        ? cluster.getClusteringStrategy(def, geojsonData)
        : { shouldCluster: false, useSharedCluster: false };
    _warnOnUnclusteredPointVolume(features, clusterResult, layerId, layerLabel, Log);
    const adapterOptions = buildSingleLayerAdapterOptions(
        def,
        preloadedStyleData,
        clusterResult,
        layerId,
        Log,
        cluster?.applyGeoJSONClusterOptions,
        _resolveReferenceLat(state)
    );

    const _tAdd = _mark();
    adapter.addGeoJSONLayer(layerId, geojsonData, adapterOptions);
    if (_perf) {
        const _addMs = performance.now() - _tAdd;
        // ⚠️ `styleWait`, not `styleFetch`. Since S5.3 the style is requested alongside the
        // data instead of after it, so this measures the RESIDUAL wait once the data has
        // landed — near zero when the overlap worked. Reading it as the fetch duration would
        // suggest the style became free, when what changed is that it stopped being serial.
        Log.info(
            "[Perf][detail] " +
                layerId +
                ": convert=" +
                _convertMs.toFixed(1) +
                "ms styleWait=" +
                _styleMs.toFixed(1) +
                "ms addSource=" +
                _addMs.toFixed(1) +
                "ms feats=" +
                features.length
        );
    }

    // Bind popups & tooltips via event-driven MapLibre pattern
    const nativeMap = adapter.getNativeMap() as GeoJSONNativeMap;
    const registry = adapter.getLayerRegistry?.();
    const subLayerIds = registry?.getSubLayerIds(layerId) ?? [];

    _bindSingleLayerInteractions(layerId, def, nativeMap, subLayerIds);

    // Build and register layer data in shared state
    const { layerBasePath, inferredGeometry } = _resolveSingleLayerMeta(def, geojsonData);
    const layerData = _buildSingleLayerData({
        layerId,
        layerLabel,
        def,
        clusterResult,
        features,
        layerBasePath,
        inferredGeometry,
        preloadedStyleData,
        subLayerIds,
    });

    state.layers.set(layerId, layerData);

    // Trigger visibility recalculation
    if (_deps?.getLayerManager()) {
        _deps.getLayerManager()?.updateLayerVisibilityByZoom();
    }

    // Labels
    _maybeInitSingleLayerLabels(layerId, def, preloadedStyleData);

    Log.debug(
        "[GeoLeaf.GeoJSON] MapLibre layer loaded:",
        layerId,
        "(" + features.length + " features)"
    );
    return { id: layerId, label: layerLabel, featureCount: features.length };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

// ─── OGC API Features early-exit ────────────────────────────────────────────

/**
 * Applies an OGC autoRefresh result to the live layer source via the adapter.
 *
 * The adapter exposes `updateLayerData` (see `map-adapter.contract.ts`); the
 * former name `updateGeoJSONSource` never existed on the adapter, so the
 * optional call silently no-op'd and every autoRefresh result was discarded —
 * the OGC layer never updated on `moveend`. Resolving the correct method here
 * (covered by a unit test) prevents that regression.
 */
export function applyOgcRefreshedData(state: GeoJSONState, layerId: string, fc: unknown): void {
    const adapter = (state.adapter || _deps?.getCore()?.getMap?.()) as {
        updateLayerData?: (id: string, data: unknown) => void;
    } | null;
    adapter?.updateLayerData?.(layerId, fc);
}

async function _loadFromOgcApi(
    layerId: string,
    layerLabel: string,
    def: DefLike,
    ogcConfig: OgcApiConfig,
    state: GeoJSONState,
    Log: GeoJSONLoaderLog
): Promise<{ id: string; label: string; featureCount: number }> {
    // 🛑 LA LECTURE LOCALE PASSE DEVANT, ICI AUSSI (tâche 4.1).
    //
    // Cette branche est un early-exit de `_loadSingleLayer` : elle rend la main AVANT
    // `_getDataPromise`, où vit la lecture locale de 4.3. Une couche déclarant à la fois
    // `data.ogcApi` et `offline.enabled` voyait donc son store COURT-CIRCUITÉ en silence —
    // elle refetchait le réseau en se croyant hors-ligne. Aucune couche du dépôt ne portait
    // les deux au moment où c'est écrit ; 4.1 est la tâche qui rend la combinaison possible,
    // donc elle la ferme plutôt que de la laisser à découvrir.
    // S5.3 — same overlap as the main path. This branch is the SECOND caller of
    // `_doLoadSingleLayerMapLibre`, and treating only the first would have left OGC layers
    // fetching their style strictly after their features, for no reason anyone would find later.
    const stylePromise = _preloadStyle(def, layerId, layerLabel, Log);

    const controller = new AbortController();
    const local = _readsOffline(def) ? await _readFromOfflineStore(layerId) : null;
    const featureCollection: unknown =
        local ?? (await fetchOgcApiFeatures(ogcConfig, controller.signal));

    const result = await _doLoadSingleLayerMapLibre(
        featureCollection,
        false,
        def,
        layerId,
        layerLabel,
        state,
        Log,
        stylePromise
    );

    // Register autoRefresh listener if requested.
    // ⚠️ Jamais quand la couche lit hors-ligne : le rafraîchissement au `moveend` refetche le
    // réseau et écrase la donnée locale — il défairait, au premier déplacement de carte, la
    // lecture que la garde ci-dessus vient d'établir.
    if (ogcConfig.autoRefresh && !_readsOffline(def)) {
        const adapter = (state.adapter || _deps?.getCore()?.getMap?.()) as {
            getNativeMap?: () => unknown;
        } | null;
        const nativeMap = adapter?.getNativeMap?.();
        if (nativeMap) {
            const cleanup = setupAutoRefresh(
                nativeMap as Parameters<typeof setupAutoRefresh>[0],
                ogcConfig,
                (bbox) => {
                    fetchOgcApiFeatures(ogcConfig, undefined, bbox)
                        .then((fc) => {
                            Log.debug(
                                `[OgcApiLoader] autoRefresh: ${fc.features.length} features for layer "${layerId}"`
                            );
                            // Update layer data in-place via adapter.
                            applyOgcRefreshedData(state, layerId, fc);
                        })
                        .catch((err: Error) =>
                            Log.warn(
                                `[OgcApiLoader] autoRefresh error for "${layerId}":`,
                                err.message
                            )
                        );
                }
            );
            // Store cleanup on state so it can be called on layer removal
            const layerData = state.layers.get(layerId) as Record<string, unknown> | undefined;
            if (layerData) layerData._ogcAutoRefreshCleanup = cleanup;
        }
    }

    return result;
}

/**
 * Renders a plugin-backed layer (e.g. flatgeobuf) by delegating to the loader the
 * plugin registered via `GeoLeaf.plugins.registerLayerLoader`. Returns a
 * `LoadedLayerResult` shape so theme / LayerManager callers treat it like any loaded
 * layer. On failure (or no registered loader) the layer is reported with 0 features.
 */
function _dispatchPluginLayer(
    pluginId: string,
    def: DefLike,
    layerId: string,
    layerLabel: string,
    Log: GeoJSONLoaderLog
): Promise<{ id: string; label: string; featureCount: number }> {
    const fallback = { id: layerId, label: layerLabel, featureCount: 0 };
    // S4.5 — la résolution est SYNCHRONE, or un plugin enregistré paresseusement n'a pas encore
    // exécuté son `registerLayerLoader()`. Sans ce préalable, rendre une couche `plugin:` en
    // paresseux revient toujours à la sauter à 0 feature. Le seam charge d'abord si un résolveur
    // existe pour cet id, et ne fait rien sinon — le core continue de ne nommer aucun plugin.
    return Promise.resolve(_deps?.ensurePluginLoaded?.(pluginId))
        .then(() => {
            const loader = _deps?.getPluginLayerLoader?.(pluginId);
            if (!loader) {
                Log.warn(
                    `[GeoLeaf.GeoJSON] Layer "${layerId}" declares plugin "${pluginId}" but no loader is registered; skipped.`
                );
                return fallback;
            }
            // `def` already carries `_profileId` (set by the theme/profile loader) — the plugin
            // uses it to resolve a profile-relative data URL.
            return loader({ ...(def as Record<string, unknown>) }).then((id: string) => ({
                id: id || layerId,
                label: layerLabel,
                featureCount: 0,
            }));
        })
        .catch((err: unknown) => {
            Log.error("[GeoLeaf.GeoJSON] Plugin layer load failed :", {
                plugin: pluginId,
                id: layerId,
                error: err,
            });
            return fallback;
        });
}

Loader._loadSingleLayer = function (
    layerId: string,
    layerLabel: string,
    def: DefLike,
    baseOptions: Record<string, unknown>
): Promise<{ id: string; label: string; featureCount: number }> {
    const state = getState();
    const Log = getLog();

    // Plugin-backed layer (e.g. flatgeobuf): dispatch to the loader the plugin
    // registered via GeoLeaf.plugins.registerLayerLoader. This is the universal
    // convergence point — covers boot, theme activation and LayerManager on-demand
    // loads. The core stays plugin-agnostic (lookup by id, never by name).
    const pluginId = (def as Record<string, unknown>).plugin;
    if (typeof pluginId === "string" && pluginId) {
        return _dispatchPluginLayer(pluginId, def, layerId, layerLabel, Log);
    }

    // Vector tiles early exit
    const VT = getVectorTiles();
    if (VT && VT.shouldUseVectorTiles(def)) {
        Log.info(`[GeoLeaf.GeoJSON] Layer "${layerId}" → vector tiles`);
        return VT.loadVectorTileLayer(layerId, layerLabel, def, baseOptions);
    }

    // OGC API Features early exit
    const defData = (def as Record<string, unknown>).data as LayerDataConfig | undefined;
    if (defData?.ogcApi) {
        Log.info(`[GeoLeaf.GeoJSON] Layer "${layerId}" → OGC API Features`);
        return _loadFromOgcApi(layerId, layerLabel, def, defData.ogcApi, state, Log);
    }

    const fromCache = !!def._cachedData;
    const WorkerMgr = _deps?.getWorkerManager();
    const useWorker = !!(!fromCache && WorkerMgr && WorkerMgr.isAvailable());

    // R-perf S1 — split off-thread (worker fetch+parse) vs main-thread post-worker
    // work (normalisation, clustering, addSource, labels, visibility).
    // Active only when window.__GEOLEAF_PERF__ === true — zero footprint otherwise.
    const _perf = _isPerfEnabled();
    const _t0 = _perf ? performance.now() : 0;

    // S5.3 — the style and the data are independent resources, and the style used to be
    // fetched only once the data had landed: one extra round-trip per layer, serialised
    // behind a body up to ~1,1 Mo for a file of a few hundred bytes. Start both here.
    //
    // ⚠️ It has to be started AFTER the three early exits above. Plugin-backed, vector-tile
    // and OGC layers never reach this code, and prefetching for them would request styles
    // for layers that resolve their own (vector-tiles calls `loadDefaultStyle` itself).
    //
    // ⚠️ No rejection can escape: `_preloadStyle` catches internally and resolves to `null`.
    // That matters here specifically — a promise created now but awaited only after the data
    // would otherwise be an unhandled rejection whenever the data settles first.
    const stylePromise = _preloadStyle(def, layerId, layerLabel, Log);
    const dataPromise = _getDataPromise(fromCache, useWorker, def, WorkerMgr, layerId);

    if (!_perf) {
        return dataPromise.then((rawData: unknown) =>
            _doLoadSingleLayerMapLibre(
                rawData,
                fromCache,
                def,
                layerId,
                layerLabel,
                state,
                Log,
                stylePromise
            )
        );
    }

    let _tWorker = 0;
    return dataPromise
        .then((rawData: unknown) => {
            _tWorker = performance.now() - _t0;
            return _doLoadSingleLayerMapLibre(
                rawData,
                fromCache,
                def,
                layerId,
                layerLabel,
                state,
                Log,
                stylePromise
            );
        })
        .then((result) => {
            const _tPost = performance.now() - _t0 - _tWorker;
            Log.info(
                "[Perf][layer] " +
                    layerId +
                    ": worker=" +
                    _tWorker.toFixed(1) +
                    "ms post=" +
                    _tPost.toFixed(1) +
                    "ms feats=" +
                    result.featureCount +
                    " useWorker=" +
                    useWorker +
                    " fromCache=" +
                    fromCache
            );
            return result;
        });
};

export { Loader as LoaderSingleLayer };
