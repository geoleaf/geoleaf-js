/*!
 * @geoleaf-plugins/realtime-layer
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * RealtimeManager — orchestrates realtime layer sources.
 *
 * - Scans all loaded GeoLeaf layer configs for `data.realtime.enabled: true`
 *   at boot time.
 * - Instantiates sources and decoders via the factories.
 * - Manages `start()` / `stop()` lifecycle per layer.
 * - Reports status via `getStatus()`.
 */

import type { IDecoder } from "./decoders/i-decoder.js";
import type { IRealtimeSource } from "./sources/i-realtime-source.js";
import type { RealtimeConfig } from "./config.js";
import { validateRealtimeConfig, resolveTargetLayerId } from "./config.js";
import { createSource } from "./source-factory.js";
import { JsonDecoder } from "./decoders/json-decoder.js";
// NB: GtfsRtDecoder is NOT imported statically — it pulls in
// `gtfs-realtime-bindings` → `protobufjs` → `long`, whose module-init probes
// WebAssembly (a benign, fully-caught CSP `wasm-eval` violation under a strict
// `script-src`). A static import would run that probe at boot for every page,
// even those with no GTFS-RT layer. It is loaded on demand in `_startEntry`.
import { applyUpdates } from "./layer-updater.js";
import { startTracking, stopTracking, getStaleCount } from "./stale-tracking.js";
import { resolveProfileUrl } from "./url-resolver.js";

// ── GeoLeaf API surface used by this module ───────────────────────────────────

interface GeoLeafAPI {
    GeoJSON?: {
        getAllLayers(): Array<{ id: string }>;
        getLayerData(id: string): { config?: Record<string, unknown> } | null;
    };
    Config?: {
        get(key: string): unknown;
    };
}

const _g = globalThis as { GeoLeaf?: GeoLeafAPI };

/** Active profile id carried on the layer config by the core loader. */
function _profileIdOf(layerConfig: unknown): string | undefined {
    if (layerConfig && typeof layerConfig === "object") {
        const v = (layerConfig as Record<string, unknown>)["_profileId"];
        if (typeof v === "string") return v;
    }
    return undefined;
}

/**
 * Return a copy of the config with `url` / `fallbackUrl` resolved against the
 * active profile base path. Profile-relative URLs (`data/…`) would otherwise be
 * fetched relative to the page and 404 in deployment (the snapshot lives under
 * `/profiles/<id>/data/`). Absolute URLs are left untouched.
 */
function _resolveConfigUrls(config: RealtimeConfig, profileId: string | undefined): RealtimeConfig {
    const dataCfg = _g.GeoLeaf?.Config?.get?.("data") as { profilesBasePath?: string } | undefined;
    const profilesBasePath = dataCfg?.profilesBasePath ?? "profiles";
    // Reecriture conditionnelle PAR-DESSUS le spread : ici les cles intersectent bien celles
    // de la cible, donc reposer `url: config.url` quand elle est absente rajouterait une cle
    // valant `undefined` la ou `...config` n'en avait mis aucune.
    return {
        ...config,
        ...(config.url && { url: resolveProfileUrl(config.url, profileId, profilesBasePath) }),
        ...(config.fallbackUrl && {
            fallbackUrl: resolveProfileUrl(config.fallbackUrl, profileId, profilesBasePath),
        }),
    };
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * What one layer's realtime feed is currently doing.
 *
 * ⚠️ `active` means a source is running, **not** that data is arriving: a polling source with
 * an unreachable endpoint stays active with `lastUpdateAt` frozen. Read the two together.
 */
export interface RealtimeStatus {
    /** A source is started for this layer. Says nothing about data actually arriving. */
    active: boolean;
    /** Transport in use — `"polling"`, `"sse"` or `"websocket"`. */
    source: string;
    /** Epoch ms of the last decoded update, or `null` if none has arrived yet. */
    lastUpdateAt: number | null;
    /** Features currently past their stale timeout. */
    staleCount: number;
}

interface ActiveEntry {
    source: IRealtimeSource;
    decoder: IDecoder;
    config: RealtimeConfig;
    lastUpdateAt: number | null;
}

// ── Decoder registry ──────────────────────────────────────────────────────────

const _decoderRegistry = new Map<string, IDecoder>();
_decoderRegistry.set("json", new JsonDecoder());
// gtfs-rt is instantiated on first use — it needs the layer's mapping hints

// ── Active layer entries ──────────────────────────────────────────────────────

const _active = new Map<string, ActiveEntry>();

/**
 * Extract the `realtime` block from a layer config, supporting both the
 * canonical profile schema (`config.data.realtime`) and the legacy/flat
 * test schema (`config.realtime`). Returns `undefined` when neither is set.
 */
function _extractRealtime(config: unknown): unknown {
    if (!config || typeof config !== "object") return undefined;
    const c = config as Record<string, unknown>;
    const data = c["data"];
    if (data && typeof data === "object") {
        const fromData = (data as Record<string, unknown>)["realtime"];
        if (fromData !== undefined) return fromData;
    }
    return c["realtime"];
}

// ── Public manager API ────────────────────────────────────────────────────────

/** Register a custom decoder by name. Must be called before `GeoLeaf.boot()`. */
export function registerDecoder(name: string, decoder: IDecoder): void {
    _decoderRegistry.set(name, decoder);
}

/**
 * Start real-time updates for a single layer.
 * If already active, this is a no-op.
 */
export function start(layerId: string): void {
    if (_active.has(layerId)) return;

    const GeoJSON = _g.GeoLeaf?.GeoJSON;
    if (!GeoJSON) {
        console.warn(`[realtime-layer] GeoLeaf.GeoJSON not available — cannot start "${layerId}"`);
        return;
    }

    const layerData = GeoJSON.getLayerData(layerId);
    const rawConfig = _extractRealtime(layerData?.config);
    if (!rawConfig) {
        console.warn(`[realtime-layer] No data.realtime config found for layer "${layerId}"`);
        return;
    }

    let config: RealtimeConfig;
    try {
        config = validateRealtimeConfig(rawConfig, layerId);
    } catch (err) {
        console.error(String(err));
        return;
    }

    config = _resolveConfigUrls(config, _profileIdOf(layerData?.config));
    _startEntry(layerId, config);
}

/** Stop real-time updates for a single layer. */
export function stop(layerId: string): void {
    const entry = _active.get(layerId);
    if (!entry) return;
    entry.source.stop();
    // Stale state is keyed on the TARGET layer (where features land), not the
    // config's own layer — release it under the same key startTracking used, or
    // the timestamp map for the target leaks after stop.
    stopTracking(resolveTargetLayerId(entry.config, layerId));
    _active.delete(layerId);
}

/** Stop all active realtime layers. */
export function stopAll(): void {
    for (const layerId of Array.from(_active.keys())) {
        stop(layerId);
    }
}

/** Current status of a realtime layer. */
export function getStatus(layerId: string): RealtimeStatus {
    const entry = _active.get(layerId);
    if (!entry) {
        return { active: false, source: "none", lastUpdateAt: null, staleCount: 0 };
    }
    return {
        active: true,
        source: entry.config.source,
        lastUpdateAt: entry.lastUpdateAt,
        staleCount: getStaleCount(resolveTargetLayerId(entry.config, layerId)),
    };
}

/**
 * Called at boot — scans all layers for `data.realtime.enabled: true` and
 * starts sources automatically.
 */
export function bootFromProfile(): void {
    const GeoJSON = _g.GeoLeaf?.GeoJSON;
    if (!GeoJSON) return;

    const layers = GeoJSON.getAllLayers();
    for (const { id } of layers) {
        const layerData = GeoJSON.getLayerData(id);
        const rawRealtime = _extractRealtime(layerData?.config);
        if (!rawRealtime || typeof rawRealtime !== "object") continue;
        const rt = rawRealtime as Record<string, unknown>;
        if (rt["enabled"] !== true) continue;

        let config: RealtimeConfig;
        try {
            config = validateRealtimeConfig(rawRealtime, id);
        } catch (err) {
            console.error(String(err));
            continue;
        }
        config = _resolveConfigUrls(config, _profileIdOf(layerData?.config));
        _startEntry(id, config);
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _startEntry(layerId: string, config: RealtimeConfig): void {
    const cached = _decoderRegistry.get(config.decoder);
    if (cached) {
        _wire(layerId, config, cached);
        return;
    }
    // Lazily pull in the GTFS-RT decoder (and its protobufjs/long graph) only
    // when a layer actually uses it — keeps the WebAssembly probe, and the
    // resulting CSP `wasm-eval` violation, off the boot path. The decoder is
    // cached under "gtfs-rt" so subsequent layers reuse it (existing behaviour).
    if (config.decoder === "gtfs-rt") {
        void _loadGtfsRtDecoder(config).then((decoder) => {
            _decoderRegistry.set("gtfs-rt", decoder);
            _wire(layerId, config, decoder);
        });
        return;
    }
    console.error(
        `[realtime-layer] "${layerId}": unknown decoder "${config.decoder}". ` +
            `Register it with GeoLeaf.RealtimeLayer.registerDecoder() before boot.`
    );
}

/**
 * Dynamically import the GTFS-RT decoder. The dynamic `import()` is what keeps
 * `gtfs-realtime-bindings`/`protobufjs`/`long` out of the boot bundle's eager
 * evaluation (Rollup inlines the chunk but defers its module-init side effects).
 */
async function _loadGtfsRtDecoder(config: RealtimeConfig): Promise<IDecoder> {
    const { GtfsRtDecoder } = await import("./decoders/gtfs-rt-decoder.js");
    return new GtfsRtDecoder(config.mapping);
}

/** Wire a resolved source + decoder into the active registry and start streaming. */
function _wire(layerId: string, config: RealtimeConfig, decoder: IDecoder): void {
    let source: IRealtimeSource;
    try {
        source = createSource(config, layerId);
    } catch (err) {
        console.error(String(err));
        return;
    }

    const entry: ActiveEntry = {
        source,
        decoder,
        config,
        lastUpdateAt: null,
    };
    _active.set(layerId, entry);

    // Determine target layer (gtfs-rt may target a different layer). Feature writes
    // AND stale tracking both key on this — see resolveTargetLayerId. Keying the two
    // on different ids (target for writes, source for tracking) makes stale eviction
    // a silent no-op whenever a mapping redirects to another layer.
    const targetLayerId = resolveTargetLayerId(config, layerId);

    source.onData((rawData) => {
        const updates = decoder.decode(rawData);
        if (!updates.length) return;
        entry.lastUpdateAt = Date.now();
        applyUpdates(layerId, updates, config, targetLayerId);
    });

    if (config.staleTimeoutMs) {
        startTracking(targetLayerId, config);
    }

    source.start();
}
