/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview GeoLeaf Performance Profiler
 * @version 1.2.0
 */

import { Log } from "../log/index.js";
import { loadBaselineFromStorage, saveBaselineToStorage } from "./baseline-storage.js";
import { buildDevToolsTrace } from "./devtools-export.js";
import { getDebugMode } from "../../kernel/config/debug-flag.js";

const _RE_IMAGE_EXT = /\.(jpg|jpeg|png|gif|svg|webp)$/i;

interface MonitoringConfig {
    enabled: boolean;
    interval: number;
    maxDataPoints: number;
}

interface MemoryConfig {
    enabled: boolean;
    threshold: number;
    leakDetection: boolean;
}

interface MarksConfig {
    enabled: boolean;
    autoMark: string[];
}

interface BaselineConfig {
    enabled: boolean;
    storage: "sessionStorage" | "localStorage";
}

interface PerformanceProfilerConfig {
    monitoring: MonitoringConfig;
    memory: MemoryConfig;
    marks: MarksConfig;
    baseline: BaselineConfig;
}

const DEFAULT_CONFIG: PerformanceProfilerConfig = {
    monitoring: {
        enabled: false,
        interval: 5000,
        maxDataPoints: 60,
    },
    memory: {
        enabled: true,
        threshold: 200 * 1024 * 1024,
        leakDetection: true,
    },
    marks: {
        enabled: true,
        autoMark: ["init", "ready", "firstLoad"],
    },
    baseline: {
        enabled: true,
        storage: "sessionStorage",
    },
};

interface MemorySnapshot {
    timestamp: number;
    used: number;
    total: number;
    available: number;
}

interface PerformanceDataStore {
    marks: Map<string, number>;
    measures: Map<string, number>;
    memory: MemorySnapshot[];
    timeline: unknown[];
    baseline: Record<string, unknown> | null;
}

const performanceData: PerformanceDataStore = {
    marks: new Map(),
    measures: new Map(),
    memory: [],
    timeline: [],
    baseline: null,
};

/**
 * Collects timing marks and reports them, for diagnosing slow boots and renders.
 *
 * Reached through {@link getPerformanceProfiler} rather than constructed — the marks are only
 * meaningful when they all land on one instance.
 */
export class PerformanceProfiler {
    config: PerformanceProfilerConfig;
    monitoringInterval: ReturnType<typeof setInterval> | null = null;
    baselineEstablished = false;

    constructor(config: Partial<PerformanceProfilerConfig> = {}) {
        this.config = this._mergeConfig(DEFAULT_CONFIG, config);
    }

    init(): void {
        (this.config.monitoring as { enabled: boolean }).enabled = this._isDevelopmentMode();
        this._initPerformanceObserver();
        this._loadBaseline();
        if (this.config.monitoring.enabled) this._startMonitoring();
        if (Log) Log.info("[GeoLeaf.Utils.PerformanceProfiler] Performance profiler initialized");
    }

    startMonitoring(): void {
        if (this.monitoringInterval) this.stopMonitoring();
        this._startMonitoring();
        if (Log) Log.info("[PerformanceProfiler] Monitoring started");
    }

    stopMonitoring(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            if (Log) Log.info("[PerformanceProfiler] Monitoring stopped");
        }
    }

    mark(name: string): void {
        if (!this.config.marks.enabled) return;
        const timestamp = performance.now();
        try {
            performance.mark(name);
            performanceData.marks.set(name, timestamp);
            if (Log) Log.debug(`[PerformanceProfiler] Mark: ${name} at ${timestamp.toFixed(2)}ms`);
        } catch (error) {
            if (Log) Log.warn(`[PerformanceProfiler] Failed to create mark ${name}:`, error);
        }
    }

    measure(name: string, startMark: string, endMark?: string): number {
        try {
            performance.measure(name, startMark, endMark ?? undefined);
            const entries = performance.getEntriesByName(name, "measure");
            const latestEntry = entries[entries.length - 1];
            const duration = latestEntry ? latestEntry.duration : 0;
            performanceData.measures.set(name, duration);
            if (Log) Log.debug(`[PerformanceProfiler] Measure: ${name} = ${duration.toFixed(2)}ms`);
            return duration;
        } catch (error) {
            if (Log) Log.warn(`[PerformanceProfiler] Failed to create measure ${name}:`, error);
            return 0;
        }
    }

    /**
     * Reads the browser's JS heap counters at this instant.
     *
     * ⚠️ The only source is the non-standard `performance.memory`, which **Chrome
     * quantises and then caches for the lifetime of the page** unless the browser was
     * started with `--enable-precise-memory-info`. Two consequences a caller must know
     * before trusting the numbers:
     *
     * - Two snapshots taken seconds apart from the same page are normally **identical to
     *   the byte**, whatever the page did in between. Measured on 13 fresh pages against
     *   the demo build: equal at five instants of a page and at 0, 10 000 and 30 000
     *   features added (`scripts/probe-heap-metrics.mjs`).
     * - Where `performance.memory` is absent (every non-Chromium browser), every field
     *   stays `0` — an *absent* measurement, not an empty heap.
     *
     * A caller that needs a real figure must measure from outside the page (DevTools,
     * or CDP `Runtime.getHeapUsage` after `HeapProfiler.collectGarbage`, which is what
     * the repository's own heap gate does).
     *
     * @returns A snapshot whose `used`/`total`/`available` are bytes, or `0` when the
     *          browser exposes no heap counters.
     */
    getMemoryUsage(): MemorySnapshot {
        const memory: MemorySnapshot = {
            timestamp: performance.now(),
            used: 0,
            total: 0,
            available: 0,
        };
        try {
            const perf = performance as Performance & {
                memory?: {
                    usedJSHeapSize: number;
                    totalJSHeapSize: number;
                    jsHeapSizeLimit: number;
                };
            };
            if (perf.memory) {
                memory.used = perf.memory.usedJSHeapSize;
                memory.total = perf.memory.totalJSHeapSize;
                memory.available = perf.memory.jsHeapSizeLimit;
            }
        } catch {
            // Memory API not available
        }
        return memory;
    }

    /**
     * Judges the sampled heap history for abnormal growth.
     *
     * Samples come from {@link getMemoryUsage} while monitoring is running, so the
     * verdict is only as good as that instrument — and on stock Chrome that instrument
     * does not move. **The method therefore refuses to answer when its own input carries
     * no information**, instead of returning a reassuring `"normal"`.
     *
     * `status` is one of:
     *
     * | value               | meaning                                                              |
     * | ------------------- | -------------------------------------------------------------------- |
     * | `insufficient_data` | fewer than 10 samples collected — start monitoring for longer         |
     * | `unavailable`       | **no verdict is computable**; see `reason`                            |
     * | `normal`            | the heap moved, and grew by 20 % or less over the window              |
     * | `warning`           | growth above 20 %                                                     |
     * | `critical`          | growth above 50 %                                                     |
     *
     * `reason` accompanies `unavailable` only, and is either `"heap-api-unavailable"`
     * (the window opens on a zero reading, so no growth *rate* is defined — the usual
     * case outside Chromium) or `"heap-readings-constant"` (every sample in the window
     * is identical to the byte, which is what Chrome's cached `performance.memory`
     * produces — see {@link getMemoryUsage}).
     *
     * ⚠️ **`unavailable` is not a failure and it is not `normal`.** It says the browser
     * gave nothing to judge. Treating it as "no leak" reinstates the defect this
     * distinction exists to remove: a diagnosis that cannot come out bad closes the
     * question instead of answering it.
     *
     * 📌 A window that ends where it started is *not* the same thing: if the readings
     * varied and simply came back, `status` is `normal` with `growthRate` at 0. The
     * difference between the two is whether the input moved at all.
     *
     * @returns The verdict; `growthRate`, `memoryTrend` and `recommendation` are present
     *          only when a growth figure was actually computed.
     */
    analyzeMemoryLeaks(): {
        status: string;
        growthRate?: number;
        memoryTrend?: string;
        recommendation?: string;
        reason?: string;
    } {
        if (performanceData.memory.length < 10) return { status: "insufficient_data" };
        const recentData = performanceData.memory.slice(-30);
        const first = recentData[0];
        const last = recentData[recentData.length - 1];
        // Unreachable given the length guard above, but the guard is on a different array:
        // it establishes the invariant for a reader, not for the compiler (qualite Q5).
        if (!first || !last) return { status: "insufficient_data" };
        const firstUsed = first.used;
        const lastUsed = last.used;

        // ── B-219 — refuse to certify on an input that carries no information ──────
        // Both tests below are arithmetic facts about the window, not heuristics, and
        // neither needs a tolerance. They exist because the verdict used to be a
        // constant: `performance.memory` is frozen for the page's lifetime on stock
        // Chrome, so `lastUsed === firstUsed` always held, `growthRate` was always 0,
        // and `warning`/`critical` were unreachable — measured identical over 8 runs.
        if (firstUsed <= 0) {
            return {
                status: "unavailable",
                reason: "heap-api-unavailable",
                recommendation:
                    "This browser reports no JS heap size (performance.memory is a Chromium-only API), " +
                    "so no growth rate is defined. Measure from the browser's own devtools instead.",
            };
        }
        if (recentData.every((sample) => sample.used === firstUsed)) {
            return {
                status: "unavailable",
                reason: "heap-readings-constant",
                recommendation:
                    "Every heap reading in the window is identical, so growth can be neither shown nor ruled out. " +
                    "Chrome caches performance.memory for the lifetime of the page unless started with " +
                    "--enable-precise-memory-info; sample over a window long enough to span a refresh, or " +
                    "measure from the browser's own devtools instead.",
            };
        }

        const growthRate = (lastUsed - firstUsed) / firstUsed;
        const analysis: {
            status: string;
            growthRate: number;
            memoryTrend: string;
            recommendation: string;
        } = {
            status: "normal",
            growthRate,
            memoryTrend: lastUsed > firstUsed ? "increasing" : "decreasing",
            recommendation: "No action needed",
        };
        if (growthRate > 0.2) {
            analysis.status = "warning";
            analysis.recommendation = "Monitor memory usage - potential leak detected";
        }
        if (growthRate > 0.5) {
            analysis.status = "critical";
            analysis.recommendation = "Investigate memory leak - significant growth detected";
        }
        return analysis;
    }

    generateReport(): Record<string, unknown> {
        const currentMemory = this.getMemoryUsage();
        const memoryAnalysis = this.analyzeMemoryLeaks();
        return {
            timestamp: new Date().toISOString(),
            session: {
                duration: performance.now(),
                marks: Object.fromEntries(performanceData.marks),
                measures: Object.fromEntries(performanceData.measures),
            },
            memory: {
                current: currentMemory,
                peak: this._getPeakMemory(),
                analysis: memoryAnalysis,
                history: performanceData.memory.slice(-10),
            },
            performance: {
                navigation: this._getNavigationTiming(),
                paint: this._getPaintTiming(),
                resources: this._getResourceTiming(),
                longTasks: this._getLongTasks(),
            },
            baseline: this._compareWithBaseline(),
            recommendations: this._generateRecommendations(),
        };
    }

    establishBaseline(): Record<string, unknown> {
        const baseline: Record<string, unknown> = {
            timestamp: new Date().toISOString(),
            navigation: this._getNavigationTiming(),
            paint: this._getPaintTiming(),
            memory: this.getMemoryUsage(),
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
            viewport:
                typeof window !== "undefined"
                    ? { width: window.innerWidth, height: window.innerHeight }
                    : {},
        };
        performanceData.baseline = baseline;
        this.baselineEstablished = true;
        if (this.config.baseline.enabled) this._saveBaseline(baseline);
        if (Log) Log.info("[PerformanceProfiler] Performance baseline established");
        return baseline;
    }

    exportForDevTools(): ReturnType<typeof buildDevToolsTrace> {
        return buildDevToolsTrace(performanceData);
    }

    private _initPerformanceObserver(): void {
        if (typeof window === "undefined" || !("PerformanceObserver" in window)) return;
        try {
            const observer = new PerformanceObserver((list) => {
                this._processPerformanceEntries(list.getEntries());
            });
            observer.observe({
                entryTypes: ["navigation", "paint", "measure", "mark", "longtask"],
            });
        } catch (error) {
            if (Log)
                Log.warn("[PerformanceProfiler] PerformanceObserver initialization failed:", error);
        }
    }

    private _processPerformanceEntries(entries: PerformanceEntryList): void {
        entries.forEach((entry) => {
            switch (entry.entryType) {
                case "longtask":
                    if (Log)
                        Log.warn(
                            `[PerformanceProfiler] Long task detected: ${(entry as PerformanceEntry & { duration: number }).duration?.toFixed(2)}ms`
                        );
                    break;
                case "measure":
                    performanceData.measures.set(
                        entry.name,
                        (entry as PerformanceEntry & { duration: number }).duration
                    );
                    break;
                case "mark":
                    performanceData.marks.set(entry.name, entry.startTime);
                    break;
                default:
                    break;
            }
        });
    }

    private _startMonitoring(): void {
        this.monitoringInterval = setInterval(
            () => this._collectPerformanceData(),
            this.config.monitoring.interval
        );
    }

    private _collectPerformanceData(): void {
        const memory = this.getMemoryUsage();
        performanceData.memory.push(memory);
        if (performanceData.memory.length > this.config.monitoring.maxDataPoints)
            performanceData.memory.shift();
        if (this.config.memory.enabled && memory.used > this.config.memory.threshold) {
            if (Log)
                Log.warn(
                    `[PerformanceProfiler] Memory usage high: ${(memory.used / 1024 / 1024).toFixed(2)}MB`
                );
        }
    }

    private _getNavigationTiming(): Record<string, number> | null {
        try {
            const timing = performance.getEntriesByType("navigation")[0] as
                | PerformanceNavigationTiming
                | undefined;
            if (!timing) return null;
            return {
                domContentLoaded:
                    timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart,
                load: timing.loadEventEnd - timing.loadEventStart,
                domComplete: timing.domComplete - timing.startTime,
                firstByte: timing.responseStart - timing.requestStart,
                dns: timing.domainLookupEnd - timing.domainLookupStart,
                tcp: timing.connectEnd - timing.connectStart,
            };
        } catch {
            return null;
        }
    }

    private _getPaintTiming(): Record<string, number> {
        try {
            const paintEntries = performance.getEntriesByType("paint");
            const result: Record<string, number> = {};
            paintEntries.forEach((entry) => {
                result[entry.name] = entry.startTime;
            });
            return result;
        } catch {
            return {};
        }
    }

    private _getResourceTiming(): {
        total: number;
        scripts?: number;
        stylesheets?: number;
        images?: number;
        totalSize?: number;
        totalDuration?: number;
    } {
        try {
            const resources = performance.getEntriesByType("resource");
            const summary = {
                total: resources.length,
                scripts: 0,
                stylesheets: 0,
                images: 0,
                totalSize: 0,
                totalDuration: 0,
            };
            resources.forEach((resource) => {
                if (resource.name.includes(".js")) summary.scripts!++;
                else if (resource.name.includes(".css")) summary.stylesheets!++;
                else if (_RE_IMAGE_EXT.test(resource.name)) summary.images!++;
                if ((resource as PerformanceResourceTiming).transferSize)
                    summary.totalSize! += (resource as PerformanceResourceTiming).transferSize;
                summary.totalDuration! += resource.duration;
            });
            return summary;
        } catch {
            return { total: 0 };
        }
    }

    private _getLongTasks(): Array<{ duration: number; startTime: number }> {
        try {
            return performance.getEntriesByType("longtask").map((task) => ({
                duration: (task as PerformanceEntry & { duration: number }).duration,
                startTime: task.startTime,
            }));
        } catch {
            return [];
        }
    }

    private _getPeakMemory(): MemorySnapshot {
        if (performanceData.memory.length === 0) return this.getMemoryUsage();
        return performanceData.memory.reduce((peak, current) =>
            current.used > peak.used ? current : peak
        );
    }

    private _compareNavigation(
        baseline: Record<string, number>,
        current: Record<string, number>
    ): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        Object.keys(baseline).forEach((key) => {
            const baselineValue = baseline[key];
            const currentValue = current[key];
            const diff =
                baselineValue && currentValue !== undefined
                    ? ((currentValue - baselineValue) / baselineValue) * 100
                    : 0;
            result[key] = {
                baseline: baselineValue,
                current: currentValue,
                difference: diff,
                status: Math.abs(diff) > 20 ? (diff > 0 ? "worse" : "better") : "similar",
            };
        });
        return result;
    }

    private _comparePaint(
        baselinePaint: Record<string, number>,
        currentPaint: Record<string, number>
    ): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        Object.keys(baselinePaint).forEach((key) => {
            if (currentPaint[key] !== undefined) {
                const baseVal = baselinePaint[key];
                const currVal = currentPaint[key];
                const diff = baseVal ? ((currVal - baseVal) / baseVal) * 100 : 0;
                result[key] = {
                    baseline: baseVal,
                    current: currVal,
                    difference: diff,
                    status: Math.abs(diff) > 20 ? (diff > 0 ? "worse" : "better") : "similar",
                };
            }
        });
        return result;
    }

    private _compareWithBaseline(): Record<string, unknown> {
        if (!performanceData.baseline) return { status: "no_baseline" };
        const current = {
            navigation: this._getNavigationTiming(),
            paint: this._getPaintTiming(),
            memory: this.getMemoryUsage(),
        };
        const baseline = performanceData.baseline as {
            navigation?: Record<string, number>;
            paint?: Record<string, number>;
            memory?: { used: number };
        };
        const comparison: Record<string, unknown> = {
            navigation: {},
            paint: {},
            memory: {},
            overall: "similar",
        };
        if (current.navigation && baseline.navigation)
            comparison.navigation = this._compareNavigation(
                baseline.navigation,
                current.navigation
            );
        if (baseline.paint && typeof baseline.paint === "object")
            comparison.paint = this._comparePaint(baseline.paint, current.paint);
        if (baseline.memory && baseline.memory.used > 0) {
            const memDiff =
                ((current.memory.used - baseline.memory.used) / baseline.memory.used) * 100;
            comparison.memory = {
                baseline: baseline.memory.used,
                current: current.memory.used,
                difference: memDiff,
                status: Math.abs(memDiff) > 30 ? (memDiff > 0 ? "worse" : "better") : "similar",
            };
        }
        return comparison;
    }

    private _generateRecommendations(): Array<{
        type: string;
        priority: string;
        message: string;
        action: string;
    }> {
        const recommendations: Array<{
            type: string;
            priority: string;
            message: string;
            action: string;
        }> = [];
        const memoryAnalysis = this.analyzeMemoryLeaks();
        const resources = this._getResourceTiming();
        const longTasks = this._getLongTasks();

        if (memoryAnalysis.status === "warning") {
            recommendations.push({
                type: "memory",
                priority: "medium",
                message: "Monitor memory usage - potential leak detected",
                action: "Check for event listener cleanup and object references",
            });
        } else if (memoryAnalysis.status === "critical") {
            recommendations.push({
                type: "memory",
                priority: "high",
                message: "Critical memory usage detected",
                action: "Immediate investigation required - check for memory leaks",
            });
        } else if (memoryAnalysis.status === "unavailable") {
            // B-219 — the report must not read as "all clear" when the browser gave
            // nothing to judge. Silence here is what let a blind verdict pass as health.
            recommendations.push({
                type: "memory",
                priority: "low",
                message: `Memory-leak diagnosis unavailable (${memoryAnalysis.reason ?? "unknown"})`,
                action:
                    memoryAnalysis.recommendation ?? "Measure the heap from the browser devtools.",
            });
        }

        if (longTasks.length > 0) {
            const avgLongTask =
                longTasks.reduce((sum, task) => sum + task.duration, 0) / longTasks.length;
            recommendations.push({
                type: "performance",
                priority: "medium",
                message: `${longTasks.length} long tasks detected (avg: ${avgLongTask.toFixed(2)}ms)`,
                action: "Consider breaking up long-running operations with setTimeout or requestIdleCallback",
            });
        }

        if (resources.total > 50) {
            recommendations.push({
                type: "resources",
                priority: "low",
                message: `High number of resources loaded (${resources.total})`,
                action: "Consider bundling or lazy loading resources",
            });
        }

        return recommendations;
    }

    private _isDevelopmentMode(): boolean {
        const loc =
            typeof globalThis !== "undefined" && "location" in globalThis
                ? (globalThis as { location: { hostname?: string; port?: string } }).location
                : null;
        return (
            loc?.hostname === "localhost" ||
            loc?.hostname === "127.0.0.1" ||
            !!loc?.port ||
            getDebugMode()
        );
    }

    private _loadBaseline(): void {
        if (!this.config.baseline.enabled) return;
        const saved = loadBaselineFromStorage(this.config.baseline.storage);
        if (saved) {
            performanceData.baseline = saved as Record<string, unknown>;
            this.baselineEstablished = true;
        }
    }

    private _saveBaseline(baseline: Record<string, unknown>): void {
        saveBaselineToStorage(baseline, this.config.baseline.storage);
    }

    private _mergeConfig(
        defaultConfig: PerformanceProfilerConfig,
        userConfig: Partial<PerformanceProfilerConfig>
    ): PerformanceProfilerConfig {
        const merged = { ...defaultConfig };
        for (const key of Object.keys(userConfig) as (keyof PerformanceProfilerConfig)[]) {
            const userVal = userConfig[key];
            if (typeof userVal === "object" && userVal !== null && !Array.isArray(userVal)) {
                (merged as Record<string, unknown>)[key] = {
                    ...(defaultConfig[key] as object),
                    ...userVal,
                };
            } else if (userVal !== undefined) {
                (merged as Record<string, unknown>)[key] = userVal;
            }
        }
        return merged;
    }
}

let _performanceProfilerInstance: PerformanceProfiler | null = null;

/**
 * The shared {@link PerformanceProfiler}, created on first use.
 *
 * @returns The singleton instance.
 */
export function getPerformanceProfiler(): PerformanceProfiler {
    if (!_performanceProfilerInstance) {
        _performanceProfilerInstance = new PerformanceProfiler();
        _performanceProfilerInstance.init();
    }
    return _performanceProfilerInstance;
}

if (typeof window !== "undefined") {
    window.addEventListener(
        "load",
        () => {
            if (_performanceProfilerInstance) _performanceProfilerInstance.establishBaseline();
        },
        { once: true }
    );
}
