/*!
 * GeoLeaf Core – Runtime performance metrics
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 *
 * Collects custom metrics (time to first layer, time to interactivity) and
 * exposes them for dev (console) or prod (callback/beacon).
 * @see docs/PERFORMANCE_METRICS.md
 */

export {};

/** Structural view of the runtime global host used by this module. */
interface PerfGlobalHost {
    GeoLeaf?: GeoLeafGlobal;
    __GEOLEAF_PERF_DEBUG__?: unknown;
    [key: string]: unknown;
}

const _g: PerfGlobalHost = (
    typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {}
) as PerfGlobalHost;
const GeoLeaf: GeoLeafGlobal = _g.GeoLeaf || {};

interface RuntimeMetrics {
    /** Time from navigation start to map ready (first layer displayed), in ms */
    timeToMapReadyMs: number | null;
    /** Time from navigation start to app ready (interactive), in ms */
    timeToAppReadyMs: number | null;
    /** Duration of initApp (from init start to ready), in ms */
    startupTotalMs: number | null;
    /** When the metrics were captured (ISO string) */
    capturedAt: string;
}

let cachedMetrics: RuntimeMetrics | null = null;

function getNavigationStart(): number {
    if (typeof performance === "undefined") return 0;
    if (
        "timeOrigin" in performance &&
        typeof (performance as Performance & { timeOrigin?: number }).timeOrigin === "number"
    ) {
        return (performance as Performance & { timeOrigin: number }).timeOrigin;
    }
    return 0;
}

function collectMetrics(): RuntimeMetrics {
    if (cachedMetrics) return cachedMetrics;

    const navStart = getNavigationStart();
    let timeToMapReadyMs: number | null = null;
    let timeToAppReadyMs: number | null = null;
    let startupTotalMs: number | null = null;

    if (typeof performance !== "undefined" && performance.getEntriesByName) {
        const measures = performance.getEntriesByName("geoleaf:startup-total", "measure");
        if (measures.length > 0) {
            startupTotalMs = (measures[measures.length - 1] as PerformanceEntry).duration;
        }
    }

    const mapReadyMark =
        typeof performance !== "undefined" && performance.getEntriesByName
            ? performance.getEntriesByName("geoleaf:initApp:ready", "mark")
            : [];
    const entry = mapReadyMark.at(-1);
    if (entry) {
        timeToMapReadyMs = Math.round(
            "startTime" in entry ? (entry as PerformanceEntry).startTime : 0
        );
    }

    if (navStart) {
        timeToAppReadyMs = Math.round(Date.now() - navStart);
    }

    cachedMetrics = {
        timeToMapReadyMs,
        timeToAppReadyMs,
        startupTotalMs,
        capturedAt: new Date().toISOString(),
    };
    return cachedMetrics;
}

function logToConsole(metrics: RuntimeMetrics): void {
    const parts: string[] = ["[GeoLeaf Perf]"];
    if (metrics.timeToMapReadyMs != null) {
        parts.push(`map ready: ${metrics.timeToMapReadyMs}ms`);
    }
    if (metrics.timeToAppReadyMs != null) {
        parts.push(`app ready: ${metrics.timeToAppReadyMs}ms`);
    }
    if (metrics.startupTotalMs != null) {
        parts.push(`startup: ${metrics.startupTotalMs.toFixed(1)}ms`);
    }
    if (typeof console !== "undefined" && console.info) {
        console.info(parts.join(" | "));
    }
}

function onAppReady(): void {
    const metrics = collectMetrics();
    const gl = _g.GeoLeaf || GeoLeaf;

    // Call through the member access (not a detached local) to preserve `this`.
    if (gl._perfCallback && typeof gl._perfCallback === "function") {
        try {
            (gl._perfCallback as (metrics: unknown) => void)(metrics);
        } catch (e) {
            if (typeof console !== "undefined" && console.warn) {
                console.warn("[GeoLeaf Perf] Callback error:", e);
            }
        }
    }

    const debugPerf =
        gl._debugPerf === true ||
        (typeof _g.__GEOLEAF_PERF_DEBUG__ !== "undefined" && _g.__GEOLEAF_PERF_DEBUG__);
    if (debugPerf) {
        logToConsole(metrics);
    }
}

if (typeof document !== "undefined") {
    document.addEventListener("geoleaf:app:ready", onAppReady, { once: true });
}

/**
 * Returns the last collected runtime metrics (or collects now if not yet done).
 * Use after geoleaf:app:ready has fired for full data.
 */
function getRuntimeMetrics(): RuntimeMetrics {
    return collectMetrics();
}

/**
 * Resets cached metrics (e.g. for tests or SPA navigation).
 */
function resetRuntimeMetrics(): void {
    cachedMetrics = null;
}

if (_g.GeoLeaf) {
    _g.GeoLeaf.getPerformanceMetrics = getRuntimeMetrics;
    _g.GeoLeaf.getRuntimeMetrics = getRuntimeMetrics;
    _g.GeoLeaf.resetRuntimeMetrics = resetRuntimeMetrics;
}
