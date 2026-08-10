/**
 * Coverage for utils/general/performance — baseline-storage + devtools-export
 * T10.1 — direct await import() without mocking to instrument real branches.
 *
 * NOTE: performance-profiler.test.js mocks these modules, so they need a
 * dedicated file to cover their own branches/functions.
 */

describe("utils/general/performance/baseline-storage", () => {
    let loadBaselineFromStorage;
    let saveBaselineToStorage;
    const STORAGE_KEY = "geoleaf_performance_baseline";

    beforeAll(async () => {
        const mod = await import("../../src/utils/performance/baseline-storage.ts");
        loadBaselineFromStorage = mod.loadBaselineFromStorage;
        saveBaselineToStorage = mod.saveBaselineToStorage;
    });

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    // ── loadBaselineFromStorage ──────────────────────────────────────────────

    it("branch storageType=localStorage — uses localStorage (true branch)", () => {
        const baseline = { timestamp: 1000, memory: { used: 50 } };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(baseline));

        const result = loadBaselineFromStorage("localStorage");
        expect(result).toEqual(baseline);
    });

    it("branch storageType default — uses sessionStorage (false branch)", () => {
        const baseline = { timestamp: 2000, memory: { used: 80 } };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(baseline));

        const result = loadBaselineFromStorage("sessionStorage");
        expect(result).toEqual(baseline);
    });

    it("branch saved=null — returns null (false branch of if(saved))", () => {
        const result = loadBaselineFromStorage("localStorage");
        expect(result).toBeNull();
    });

    it("branch saved=valid — returns parsed baseline (true branch of if(saved))", () => {
        const baseline = { timestamp: 3000 };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(baseline));

        const result = loadBaselineFromStorage("localStorage");
        expect(result).not.toBeNull();
        expect(result.timestamp).toBe(3000);
    });

    it("catch path — returns null on invalid JSON", () => {
        localStorage.setItem(STORAGE_KEY, "{ invalid json }");
        const result = loadBaselineFromStorage("localStorage");
        expect(result).toBeNull();
    });

    // ── saveBaselineToStorage ────────────────────────────────────────────────

    it("saves baseline to localStorage (true branch)", () => {
        const baseline = { timestamp: 4000, memory: { used: 60 } };
        saveBaselineToStorage(baseline, "localStorage");

        const saved = localStorage.getItem(STORAGE_KEY);
        expect(saved).not.toBeNull();
        expect(JSON.parse(saved)).toEqual(baseline);
    });

    it("saves baseline to sessionStorage (false branch)", () => {
        const baseline = { timestamp: 5000, memory: { used: 70 } };
        saveBaselineToStorage(baseline, "sessionStorage");

        const saved = sessionStorage.getItem(STORAGE_KEY);
        expect(saved).not.toBeNull();
        expect(JSON.parse(saved)).toEqual(baseline);
    });

    it("catch path in save — does not throw when storage throws", () => {
        const origSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = () => {
            throw new Error("QuotaExceededError");
        };
        expect(() => saveBaselineToStorage({ timestamp: 0 }, "localStorage")).not.toThrow();
        Storage.prototype.setItem = origSetItem;
    });

    it("roundtrip: save then load returns same baseline", () => {
        const baseline = { timestamp: 9000, session: { id: "test" } };
        saveBaselineToStorage(baseline, "localStorage");

        const loaded = loadBaselineFromStorage("localStorage");
        expect(loaded).toEqual(baseline);
    });
});

describe("utils/general/performance/devtools-export", () => {
    let buildDevToolsTrace;

    beforeAll(async () => {
        const mod = await import("../../src/utils/performance/devtools-export.ts");
        buildDevToolsTrace = mod.buildDevToolsTrace;
    });

    it("returns trace with empty traceEvents for empty maps", () => {
        const result = buildDevToolsTrace({
            marks: new Map(),
            measures: new Map(),
        });
        expect(result).toHaveProperty("traceEvents");
        expect(result.traceEvents).toHaveLength(0);
        expect(result).toHaveProperty("metadata");
    });

    it("adds instant event per mark (name→timestamp Map)", () => {
        // marks: Map<name: string, timestamp: number>
        const marks = new Map([
            ["init", 10],
            ["loaded", 50],
        ]);
        const result = buildDevToolsTrace({ marks, measures: new Map() });

        const instantEvents = result.traceEvents.filter((e) => e.ph === "I");
        expect(instantEvents).toHaveLength(2);
        expect(instantEvents[0].name).toBe("init");
        expect(instantEvents[0].ts).toBe(10000);
    });

    it("adds begin/end pair per measure (name→duration Map)", () => {
        // measures: Map<name: string, duration: number>
        const measures = new Map([["render", 50]]);
        const result = buildDevToolsTrace({ marks: new Map(), measures });

        const begin = result.traceEvents.find((e) => e.ph === "B");
        const end = result.traceEvents.find((e) => e.ph === "E");
        expect(begin).toBeDefined();
        expect(end).toBeDefined();
        expect(begin.name).toBe("render");
    });

    it("populates metadata with os-name and user-agent", () => {
        const result = buildDevToolsTrace({ marks: new Map(), measures: new Map() });
        // Metadata keys from the actual implementation
        expect(result.metadata).toHaveProperty("os-name");
        expect(result.metadata).toHaveProperty("user-agent");
    });
});
