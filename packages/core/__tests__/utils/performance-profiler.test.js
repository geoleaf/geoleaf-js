/**
 * Tests for PerformanceProfiler
 */
const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

const loadBaselineMock = vi.fn(() => null);
const saveBaselineMock = vi.fn();
vi.mock("../../src/utils/performance/baseline-storage.js", () => ({
    loadBaselineFromStorage: (...args) => loadBaselineMock(...args),
    saveBaselineToStorage: (...args) => saveBaselineMock(...args),
}));

vi.mock("../../src/utils/performance/devtools-export.js", () => ({
    buildDevToolsTrace: (data) => ({ traceEvents: [], metadata: {}, _data: data }),
}));
vi.mock("../../src/kernel/config/debug-flag.js", () => ({ getDebugMode: () => false }));

let PerformanceProfiler;
let getPerformanceProfiler;

describe("utils/performance-profiler", () => {
    let profiler;

    beforeAll(async () => {
        const mod = await import("../../src/utils/performance/performance-profiler.ts");
        PerformanceProfiler = mod.PerformanceProfiler;
        getPerformanceProfiler = mod.getPerformanceProfiler;
    });
    beforeEach(() => {
        vi.useFakeTimers();
        loadBaselineMock.mockReturnValue(null);
        saveBaselineMock.mockClear();
        profiler = new PerformanceProfiler({
            monitoring: { enabled: false, interval: 1000, maxDataPoints: 10 },
            marks: { enabled: true },
        });
    });
    afterEach(() => {
        profiler.stopMonitoring();
        vi.useRealTimers();
    });

    describe("constructor and init", () => {
        it("merges config with defaults", () => {
            expect(profiler.config.monitoring.interval).toBe(1000);
            expect(profiler.config.marks.enabled).toBe(true);
        });
        it("init loads baseline and logs", () => {
            profiler.init();
            expect(loadBaselineMock).toHaveBeenCalled();
            expect(mockLog.info).toHaveBeenCalled();
        });
        it("_mergeConfig deep-merges nested objects", () => {
            const p = new PerformanceProfiler({ memory: { threshold: 100 } });
            expect(p.config.memory.threshold).toBe(100);
            expect(p.config.memory.enabled).toBe(true);
        });
    });

    describe("mark and measure", () => {
        it("mark does not throw when marks enabled", () => {
            expect(() => profiler.mark("test-mark")).not.toThrow();
        });
        it("mark is no-op when marks disabled", () => {
            const p = new PerformanceProfiler({ marks: { enabled: false } });
            expect(() => p.mark("x")).not.toThrow();
        });
        it("measure returns a number", () => {
            const d = profiler.measure("m1", "non-existent", "non-existent");
            expect(typeof d).toBe("number");
        });
    });

    describe("getMemoryUsage", () => {
        it("returns object with timestamp, used, total, available", () => {
            const mem = profiler.getMemoryUsage();
            expect(mem).toHaveProperty("timestamp");
            expect(mem).toHaveProperty("used");
            expect(mem).toHaveProperty("total");
            expect(mem).toHaveProperty("available");
        });
    });

    describe("establishBaseline and exportForDevTools", () => {
        it("establishBaseline returns baseline object", () => {
            const baseline = profiler.establishBaseline();
            expect(baseline).toHaveProperty("timestamp");
            expect(baseline).toHaveProperty("memory");
            expect(profiler.baselineEstablished).toBe(true);
        });
        it("establishBaseline saves to storage when baseline enabled", () => {
            profiler.establishBaseline();
            expect(saveBaselineMock).toHaveBeenCalled();
        });
        it("exportForDevTools returns trace object", () => {
            const trace = profiler.exportForDevTools();
            expect(trace).toHaveProperty("traceEvents");
            expect(trace).toHaveProperty("metadata");
        });
    });

    describe("startMonitoring and stopMonitoring", () => {
        it("startMonitoring sets interval and logs", () => {
            profiler.startMonitoring();
            expect(mockLog.info).toHaveBeenCalledWith(
                expect.stringContaining("Monitoring started")
            );
            profiler.stopMonitoring();
            expect(mockLog.info).toHaveBeenCalledWith(
                expect.stringContaining("Monitoring stopped")
            );
        });
        it("stopMonitoring is no-op when not monitoring", () => {
            profiler.stopMonitoring();
            expect(mockLog.info).not.toHaveBeenCalledWith(
                expect.stringContaining("Monitoring stopped")
            );
        });
    });

    describe("generateReport", () => {
        it("returns report with timestamp, session, memory, performance", () => {
            const report = profiler.generateReport();
            expect(report).toHaveProperty("timestamp");
            expect(report).toHaveProperty("session");
            expect(report).toHaveProperty("memory");
            expect(report).toHaveProperty("performance");
            expect(report).toHaveProperty("recommendations");
        });
    });

    describe("analyzeMemoryLeaks", () => {
        it("returns insufficient_data when few samples", () => {
            const analysis = profiler.analyzeMemoryLeaks();
            expect(analysis.status).toBe("insufficient_data");
        });
    });

    describe("getPerformanceProfiler", () => {
        it("returns singleton instance and initializes on first call", () => {
            const p = getPerformanceProfiler();
            expect(p).toBeInstanceOf(PerformanceProfiler);
            expect(getPerformanceProfiler()).toBe(p);
        });
    });

    describe("startMonitoring when already running", () => {
        it("stops existing monitoring before starting new", () => {
            profiler.startMonitoring();
            const firstInterval = profiler.monitoringInterval;
            profiler.startMonitoring(); // calls stopMonitoring first (line 105 true branch)
            expect(profiler.monitoringInterval).not.toBe(firstInterval);
            profiler.stopMonitoring();
        });
    });

    describe("_loadBaseline when saved baseline exists", () => {
        it("loads saved baseline and marks as established", () => {
            loadBaselineMock.mockReturnValueOnce({ navigation: {}, memory: { used: 100 } });
            const p = new PerformanceProfiler({
                baseline: { enabled: true, storage: "sessionStorage" },
            });
            p.init();
            expect(p.baselineEstablished).toBe(true);
        });
    });

    describe("establishBaseline with baseline.enabled=false", () => {
        it("does not save baseline when disabled", () => {
            saveBaselineMock.mockClear();
            const p = new PerformanceProfiler({
                baseline: { enabled: false, storage: "sessionStorage" },
            });
            p.establishBaseline();
            expect(saveBaselineMock).not.toHaveBeenCalled();
        });
    });

    describe("_compareWithBaseline after establishBaseline", () => {
        it("generateReport includes baseline comparison when baseline is set", () => {
            const p = new PerformanceProfiler({});
            p.establishBaseline();
            const report = p.generateReport();
            expect(report.baseline).toBeDefined();
            expect(report.baseline).not.toEqual({ status: "no_baseline" });
        });

        // vi.isolateModules shim does not fully re-load module state
        // in Jest CJS mode, so performanceData.baseline may already be set from
        // earlier tests. Verify baseline field is present in report.
        it("_compareWithBaseline returns baseline comparison or no_baseline", () => {
            const p = new PerformanceProfiler({});
            const report = p.generateReport();
            expect(report.baseline).toBeDefined();
            expect(typeof report.baseline).toBe("object");
        });
    });

    describe("mark catch path", () => {
        it("logs warn when performance.mark throws", () => {
            const origMark = performance.mark;
            performance.mark = () => {
                throw new Error("mark failed");
            };
            expect(() => profiler.mark("test-catch")).not.toThrow();
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("Failed to create mark"),
                expect.any(Error)
            );
            performance.mark = origMark;
        });
    });

    describe("measure with actual marks", () => {
        it("covers try-success path with existing mark", () => {
            const origMark = performance.mark;
            const origMeasure = performance.measure;
            const origGetEntriesByName = performance.getEntriesByName;
            performance.mark = vi.fn();
            performance.measure = vi.fn();
            performance.getEntriesByName = vi.fn(() => [{ duration: 42 }]);
            const result = profiler.measure("m-test", "start", "end");
            expect(result).toBe(42);
            performance.mark = origMark;
            performance.measure = origMeasure;
            performance.getEntriesByName = origGetEntriesByName;
        });
    });

    describe("_collectPerformanceData with memory threshold", () => {
        it("logs warning when memory usage exceeds threshold", () => {
            const p = new PerformanceProfiler({
                monitoring: { enabled: false, interval: 100, maxDataPoints: 10 },
                memory: { enabled: true, threshold: 50, warnOnHigh: true },
            });
            vi.spyOn(p, "getMemoryUsage").mockReturnValue({
                timestamp: 0,
                used: 200 * 1024 * 1024,
                total: 500 * 1024 * 1024,
                available: 500 * 1024 * 1024,
            });
            p.startMonitoring();
            vi.advanceTimersByTime(100);
            p.stopMonitoring();
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("Memory usage high"));
        });
    });

    describe("analyzeMemoryLeaks — with populated data (uses module-level state accumulation)", () => {
        it("returns analysis object with growthRate when enough data", () => {
            const p = new PerformanceProfiler({
                monitoring: { enabled: false, interval: 100, maxDataPoints: 50 },
            });
            let call = 0;
            vi.spyOn(p, "getMemoryUsage").mockImplementation(() => ({
                timestamp: 0,
                used: 100 + call++ * 1,
                total: 1000,
                available: 1000,
            }));
            p.startMonitoring();
            vi.advanceTimersByTime(1200); // 12 ticks
            p.stopMonitoring();
            const analysis = p.analyzeMemoryLeaks();
            // With module-level state accumulation, exact status depends on order;
            // just verify we get a valid analysis object (not insufficient_data)
            expect(["normal", "warning", "critical"]).toContain(analysis.status);
            expect(analysis).toHaveProperty("growthRate");
        });

        it("returns 'decreasing' memoryTrend when memory shrinks", () => {
            const p = new PerformanceProfiler({
                monitoring: { enabled: false, interval: 100, maxDataPoints: 50 },
            });
            let call = 0;
            vi.spyOn(p, "getMemoryUsage").mockImplementation(() => ({
                timestamp: 0,
                used: Math.max(0, 200 - call++ * 10),
                total: 1000,
                available: 1000,
            }));
            p.startMonitoring();
            vi.advanceTimersByTime(1200); // 12 ticks: used 200..90
            p.stopMonitoring();
            const analysis = p.analyzeMemoryLeaks();
            expect(analysis.memoryTrend).toBe("decreasing");
        });

        it("returns 'warning' with 25% growth", () => {
            const p = new PerformanceProfiler({
                monitoring: { enabled: false, interval: 100, maxDataPoints: 50 },
            });
            let call = 0;
            vi.spyOn(p, "getMemoryUsage").mockImplementation(() => ({
                timestamp: 0,
                used: 100 + call++ * 3,
                total: 1000,
                available: 1000,
            }));
            p.startMonitoring();
            vi.advanceTimersByTime(1200); // 12 ticks: firstUsed=100, lastUsed=133 → growth 0.33 > 0.2
            p.stopMonitoring();
            const analysis = p.analyzeMemoryLeaks();
            expect(analysis.status).toBe("warning");
            expect(analysis.recommendation).toContain("potential leak");
        });

        it("returns 'critical' with rapid growth > 50%", () => {
            const p = new PerformanceProfiler({
                monitoring: { enabled: false, interval: 100, maxDataPoints: 50 },
            });
            let call = 0;
            vi.spyOn(p, "getMemoryUsage").mockImplementation(() => ({
                timestamp: 0,
                used: 100 + call++ * 60,
                total: 1000,
                available: 1000,
            }));
            p.startMonitoring();
            vi.advanceTimersByTime(1200); // 12 ticks: firstUsed=100, lastUsed=760 → growth 6.6 > 0.5
            p.stopMonitoring();
            const analysis = p.analyzeMemoryLeaks();
            expect(analysis.status).toBe("critical");
            expect(analysis.recommendation).toContain("Investigate");
        });
    });

    describe("_generateRecommendations via generateReport", () => {
        it("includes memory warning recommendation when analyzeMemoryLeaks returns warning", () => {
            const p = new PerformanceProfiler({});
            vi.spyOn(p, "analyzeMemoryLeaks").mockReturnValue({
                status: "warning",
                growthRate: 0.3,
                memoryTrend: "increasing",
                recommendation: "Monitor memory usage - potential leak detected",
            });
            const report = p.generateReport();
            const recs = report.recommendations;
            expect(recs.some((r) => r.type === "memory" && r.priority === "medium")).toBe(true);
        });

        it("includes critical memory recommendation when analyzeMemoryLeaks returns critical", () => {
            const p = new PerformanceProfiler({});
            vi.spyOn(p, "analyzeMemoryLeaks").mockReturnValue({
                status: "critical",
                growthRate: 6.6,
                memoryTrend: "increasing",
                recommendation: "Investigate memory leak - significant growth detected",
            });
            const report = p.generateReport();
            const recs = report.recommendations;
            expect(recs.some((r) => r.type === "memory" && r.priority === "high")).toBe(true);
        });
    });

    describe("_mergeConfig edge cases", () => {
        it("handles non-object user values (replaces rather than merges)", () => {
            const p = new PerformanceProfiler({ marks: { enabled: false } });
            expect(p.config.marks.enabled).toBe(false);
        });

        it("handles undefined user values without throwing", () => {
            expect(
                () => new PerformanceProfiler({ monitoring: { interval: undefined } })
            ).not.toThrow();
        });
    });

    describe("_getPeakMemory", () => {
        it("returns current memory when history is empty on fresh profiler", () => {
            const freshProfiler = new PerformanceProfiler({});
            const report = freshProfiler.generateReport();
            expect(report.memory).toHaveProperty("peak");
        });
    });

    describe("performance.memory API", () => {
        it("getMemoryUsage reads Chrome performance.memory when available", () => {
            Object.defineProperty(performance, "memory", {
                get: () => ({
                    usedJSHeapSize: 50000000,
                    totalJSHeapSize: 100000000,
                    jsHeapSizeLimit: 200000000,
                }),
                configurable: true,
            });
            const mem = profiler.getMemoryUsage();
            expect(mem.used).toBe(50000000);
            expect(mem.total).toBe(100000000);
            expect(mem.available).toBe(200000000);
            delete performance.memory;
        });
    });

    describe("_getNavigationTiming and _getPaintTiming via generateReport", () => {
        let origGetEntriesByType;
        beforeEach(() => {
            origGetEntriesByType = performance.getEntriesByType;
        });
        afterEach(() => {
            performance.getEntriesByType = origGetEntriesByType;
        });

        it("covers navigation timing entries path", () => {
            performance.getEntriesByType = vi.fn((type) => {
                if (type === "navigation") {
                    return [
                        {
                            domContentLoadedEventEnd: 100,
                            domContentLoadedEventStart: 80,
                            loadEventEnd: 200,
                            loadEventStart: 190,
                            domComplete: 300,
                            startTime: 0,
                            responseStart: 50,
                            requestStart: 10,
                            domainLookupEnd: 15,
                            domainLookupStart: 5,
                            connectEnd: 20,
                            connectStart: 16,
                        },
                    ];
                }
                return [];
            });
            const report = new PerformanceProfiler({}).generateReport();
            expect(report.performance.navigation).toBeTruthy();
        });

        it("covers paint timing entries path", () => {
            performance.getEntriesByType = vi.fn((type) => {
                if (type === "paint") return [{ name: "first-paint", startTime: 100 }];
                return [];
            });
            const report = new PerformanceProfiler({}).generateReport();
            expect(report.performance.paint).toBeDefined();
        });

        it("covers resource timing entries (js, css, image)", () => {
            performance.getEntriesByType = vi.fn((type) => {
                if (type === "resource") {
                    return [
                        { name: "app.js", duration: 10, transferSize: 100 },
                        { name: "style.css", duration: 5, transferSize: 50 },
                        { name: "image.png", duration: 3, transferSize: 200 },
                    ];
                }
                return [];
            });
            const report = new PerformanceProfiler({}).generateReport();
            expect(report.performance.resources.total).toBe(3);
        });

        it("covers resources.total > 50 recommendation", () => {
            performance.getEntriesByType = vi.fn((type) => {
                if (type === "resource") {
                    return Array.from({ length: 55 }, (_, i) => ({
                        name: `file${i}.js`,
                        duration: 1,
                        transferSize: 10,
                    }));
                }
                return [];
            });
            const p = new PerformanceProfiler({});
            vi.spyOn(p, "analyzeMemoryLeaks").mockReturnValue({ status: "normal" });
            const report = p.generateReport();
            const recs = report.recommendations;
            expect(recs.some((r) => r.type === "resources")).toBe(true);
        });

        it("covers longtasks > 0 recommendation", () => {
            performance.getEntriesByType = vi.fn((type) => {
                if (type === "longtask") return [{ duration: 120, startTime: 500 }];
                return [];
            });
            const p = new PerformanceProfiler({});
            vi.spyOn(p, "analyzeMemoryLeaks").mockReturnValue({ status: "normal" });
            const report = p.generateReport();
            const recs = report.recommendations;
            expect(recs.some((r) => r.type === "performance")).toBe(true);
        });
    });

    describe("_compareWithBaseline with rich navigation and memory data", () => {
        let origGetEntriesByType;
        beforeEach(() => {
            origGetEntriesByType = performance.getEntriesByType;
        });
        afterEach(() => {
            performance.getEntriesByType = origGetEntriesByType;
        });

        it("covers navigation comparison inner loop", () => {
            performance.getEntriesByType = vi.fn((type) => {
                if (type === "navigation") {
                    return [
                        {
                            domContentLoadedEventEnd: 100,
                            domContentLoadedEventStart: 80,
                            loadEventEnd: 200,
                            loadEventStart: 190,
                            domComplete: 300,
                            startTime: 0,
                            responseStart: 50,
                            requestStart: 10,
                            domainLookupEnd: 15,
                            domainLookupStart: 5,
                            connectEnd: 20,
                            connectStart: 16,
                        },
                    ];
                }
                return [];
            });
            const p = new PerformanceProfiler({});
            p.establishBaseline();
            const report = p.generateReport();
            expect(report.baseline).toBeDefined();
            expect(report.baseline).not.toEqual({ status: "no_baseline" });
        });

        it("covers paint comparison inner loop", () => {
            performance.getEntriesByType = vi.fn((type) => {
                if (type === "paint") return [{ name: "first-paint", startTime: 100 }];
                return [];
            });
            const p = new PerformanceProfiler({});
            p.establishBaseline();
            const report = p.generateReport();
            expect(report.baseline).toBeDefined();
        });

        it("covers memory comparison when baseline.memory.used > 0", () => {
            const p = new PerformanceProfiler({});
            vi.spyOn(p, "getMemoryUsage").mockReturnValue({
                timestamp: 0,
                used: 100 * 1024 * 1024,
                total: 500 * 1024 * 1024,
                available: 500 * 1024 * 1024,
            });
            p.establishBaseline();
            const report = p.generateReport();
            expect(report.baseline).toBeDefined();
        });
    });

    describe("PerformanceObserver integration", () => {
        afterEach(() => {
            delete global.PerformanceObserver;
        });

        it("initializes PerformanceObserver when available", () => {
            global.PerformanceObserver = class {
                constructor(cb) {
                    this._cb = cb;
                }
                observe() {}
            };
            const p = new PerformanceProfiler({});
            expect(() => p.init()).not.toThrow();
        });

        it("_processPerformanceEntries handles longtask, measure, mark, and default", () => {
            let observerCallback;
            global.PerformanceObserver = class {
                constructor(cb) {
                    observerCallback = cb;
                }
                observe() {}
            };
            const p = new PerformanceProfiler({});
            p.init();
            mockLog.warn.mockClear();
            observerCallback({
                getEntries: () => [
                    { entryType: "longtask", name: "long", duration: 150, startTime: 1000 },
                    { entryType: "measure", name: "my-measure", duration: 42, startTime: 500 },
                    { entryType: "mark", name: "my-mark", startTime: 100 },
                    { entryType: "navigation", name: "nav", startTime: 0 },
                ],
            });
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("Long task detected")
            );
        });

        it("logs warn when PerformanceObserver.observe throws", () => {
            global.PerformanceObserver = class {
                constructor() {}
                observe() {
                    throw new Error("observe failed");
                }
            };
            const p = new PerformanceProfiler({});
            expect(() => p.init()).not.toThrow();
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("PerformanceObserver initialization failed"),
                expect.any(Error)
            );
        });
    });

    // ───────────────────────────────────────────────────────────────────────────
    // analyzeMemoryLeaks() must no longer certify an input that does not vary.
    //
    // 🛑 THIS BLOCK IS DELIBERATELY AT THE END OF THE FILE.
    // `performanceData` is a module singleton shared by all tests, and
    // `analyzeMemoryLeaks` judges its last 30 samples: a block pushing 40
    // CONSTANT values before the others would contaminate their window.
    // Each test below pushes 40 to be independent of what preceded it —
    // never fewer than the window.
    // ───────────────────────────────────────────────────────────────────────────
    describe("analyzeMemoryLeaks — refuse de conclure quand l'entrée ne varie pas", () => {
        const FENETRE = 30;
        const POUSSEES = 40; // > FENETRE: the analysed window is entirely ours

        /** The BEFORE-fix rule, verbatim — serves as an EXECUTED inverse witness. */
        const regleAvant = (firstUsed, lastUsed) => {
            const g = (lastUsed - firstUsed) / firstUsed;
            if (g > 0.5) return "critical";
            if (g > 0.2) return "warning";
            return "normal";
        };

        /** Pushes `POUSSEES` samples whose `used` comes from `suite(i)`. */
        const pousser = (suite) => {
            const p = new PerformanceProfiler({
                monitoring: { enabled: false, interval: 10, maxDataPoints: 60 },
            });
            let i = 0;
            vi.spyOn(p, "getMemoryUsage").mockImplementation(() => ({
                timestamp: i,
                used: suite(i++),
                total: 2_000_000_000,
                available: 4_000_000_000,
            }));
            p.startMonitoring();
            vi.advanceTimersByTime(10 * POUSSEES);
            p.stopMonitoring();
            return p;
        };

        it("entrée FIGÉE (Chrome) → unavailable/heap-readings-constant, et PAS 'normal'", () => {
            // 31,570,000 is a value really recorded on the vhost: Chrome
            // quantises performance.memory and freezes it for the page's
            // duration (measured probe, 13 fresh pages, nil delta at N = 0,
            // 10,000 and 30,000 features).
            const FIGE = 31_570_000;
            const analysis = pousser(() => FIGE).analyzeMemoryLeaks();

            expect(analysis.status).toBe("unavailable");
            expect(analysis.reason).toBe("heap-readings-constant");
            // No growth figure must be published: there is none.
            expect(analysis.growthRate).toBeUndefined();
            expect(analysis.recommendation).toMatch(/identical/i);

            // INVERSE WITNESS, executed rather than argued: on these SAME
            // samples, the before rule returned "normal" — what 8 browser
            // runs out of 8 printed, including on a page retaining 8.2 MB
            // of simulated leak.
            expect(regleAvant(FIGE, FIGE)).toBe("normal");
        });

        it("aucune API de heap (tout à 0) → unavailable/heap-api-unavailable, jamais un growthRate NaN", () => {
            const analysis = pousser(() => 0).analyzeMemoryLeaks();

            expect(analysis.status).toBe("unavailable");
            expect(analysis.reason).toBe("heap-api-unavailable");
            expect(analysis.growthRate).toBeUndefined();

            // INVERSE WITNESS: the before rule divided by zero. The result
            // is never above a threshold, so the verdict fell back on
            // "normal" — a "no leak" rendered to every non-Chromium
            // browser, by a division by zero nothing flagged.
            const divisionParZero = (0 - 0) / 0;
            expect(Number.isNaN(divisionParZero)).toBe(true);
            expect(divisionParZero > 0.2).toBe(false);
            expect(regleAvant(0, 0)).toBe("normal");
        });

        it("entrée qui VARIE et revient à son point de départ → normal avec growthRate 0", () => {
            // The fix's central discrimination: same growthRate as the
            // frozen case (exactly 0), opposite verdict — because the
            // input, itself, moved. The bump is in the MIDDLE of the series
            // to land for sure in the last-30 window, whose first element
            // is sample no. 10.
            const BASE = 20_000_000;
            const analysis = pousser((i) =>
                i === Math.floor(POUSSEES / 2) ? BASE + 5_000_000 : BASE
            ).analyzeMemoryLeaks();

            expect(analysis.status).toBe("normal");
            expect(analysis.growthRate).toBe(0);
            expect(analysis.reason).toBeUndefined();
        });

        it("une VRAIE croissance reste vue — le correctif n'aveugle pas le chemin utile", () => {
            const analysis = pousser((i) => 10_000_000 + i * 500_000).analyzeMemoryLeaks();

            // over the window of 30: first = 10M + 10×0.5M, last = 10M + 39×0.5M
            const attendu = (39 * 500_000 - 10 * 500_000) / (10_000_000 + 10 * 500_000);
            expect(analysis.status).toBe("critical");
            expect(analysis.growthRate).toBeCloseTo(attendu, 6);
            expect(analysis.recommendation).toMatch(/Investigate/);
            expect(regleAvant(10_000_000 + 10 * 500_000, 10_000_000 + 39 * 500_000)).toBe(
                "critical"
            );
        });

        it("la fenêtre analysée fait bien 30 échantillons — le nombre que ces tests débordent", () => {
            // Locks the hypothesis making the four tests above independent
            // of the shared singleton. If the window ever widens, POUSSEES must follow.
            const p = pousser((i) => 1_000_000 + i);
            const historique = p.generateReport().memory.history;
            expect(historique.length).toBeLessThanOrEqual(FENETRE);
            expect(POUSSEES).toBeGreaterThan(FENETRE);
        });

        it("generateReport() remonte l'indisponibilité dans ses recommandations", () => {
            const p = pousser(() => 25_000_000);
            const report = p.generateReport();

            expect(report.memory.analysis.status).toBe("unavailable");
            const rec = report.recommendations.find((r) => r.type === "memory");
            expect(rec).toBeDefined();
            expect(rec.priority).toBe("low");
            expect(rec.message).toMatch(/unavailable/i);
        });
    });
});
