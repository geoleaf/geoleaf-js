/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Performance Profiler – DevTools Export
 * Pure DevTools trace builder extracted from performance-profiler.js (Phase 8.2.5)
 */

/** A single Chrome DevTools trace event (subset of the full schema we emit). */
interface DevToolsTraceEvent {
    name: string;
    cat: string;
    ph: "I" | "B" | "E";
    ts: number;
    pid: number;
    tid: number;
}

/**
 * Builds a Chrome DevTools trace object (profile JSON) from the marks and measures
 * collected by `PerformanceProfiler`.
 *
 * Loadable in the Chrome DevTools Performance tab:
 * `DevTools → Performance → Load Profile → select the JSON file`
 *
 * @param data - The profiler's collected `marks` and `measures`.
 * @returns The DevTools trace object.
 */
export function buildDevToolsTrace({
    marks,
    measures,
}: {
    marks: Map<string, number>;
    measures: Map<string, number>;
}) {
    const devToolsData = {
        traceEvents: [] as DevToolsTraceEvent[],
        metadata: {
            "cpu-family": 6,
            "cpu-model": 70,
            "cpu-stepping": 1,
            "field-name-mappings": {},
            "os-name": navigator.platform,
            "trace-capture-datetime": new Date().toISOString(),
            "user-agent": navigator.userAgent,
        },
    };

    // Convert marks → Instant trace events
    marks.forEach((timestamp: number, name: string) => {
        devToolsData.traceEvents.push({
            name,
            cat: "blink.user_timing",
            ph: "I", // Instant event
            ts: timestamp * 1000, // µs
            pid: 1,
            tid: 1,
        });
    });

    // Convert measures → Begin/End trace event pairs
    measures.forEach((duration: number, name: string) => {
        const startTime = performance.now() - duration;
        devToolsData.traceEvents.push(
            {
                name,
                cat: "blink.user_timing",
                ph: "B", // Begin
                ts: startTime * 1000,
                pid: 1,
                tid: 1,
            },
            {
                name,
                cat: "blink.user_timing",
                ph: "E", // End
                ts: (startTime + duration) * 1000,
                pid: 1,
                tid: 1,
            }
        );
    });

    return devToolsData;
}
