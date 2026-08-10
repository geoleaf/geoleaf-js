/**
 * Tests pour devtools-export — Phase 1 step 1.9 (12% → 60%)
 */
import { buildDevToolsTrace } from "../../src/utils/performance/devtools-export.js";

describe("utils/performance/devtools-export", () => {
    describe("buildDevToolsTrace", () => {
        it("returns object with traceEvents and metadata", () => {
            const data = { marks: new Map(), measures: new Map() };
            const out = buildDevToolsTrace(data);
            expect(out).toHaveProperty("traceEvents");
            expect(out).toHaveProperty("metadata");
            expect(Array.isArray(out.traceEvents)).toBe(true);
            expect(out.metadata["cpu-family"]).toBe(6);
            expect(out.metadata["os-name"]).toBeDefined();
            expect(out.metadata["trace-capture-datetime"]).toBeDefined();
        });
        it("converts marks to Instant (ph: I) trace events", () => {
            const marks = new Map([
                ["init", 100],
                ["ready", 200],
            ]);
            const out = buildDevToolsTrace({ marks, measures: new Map() });
            const instantEvents = out.traceEvents.filter((e) => e.ph === "I");
            expect(instantEvents).toHaveLength(2);
            expect(instantEvents.map((e) => e.name)).toEqual(
                expect.arrayContaining(["init", "ready"])
            );
            expect(instantEvents[0].ts).toBe(100 * 1000);
        });
        it("converts measures to Begin/End trace event pairs", () => {
            const measures = new Map([["load", 50]]);
            const out = buildDevToolsTrace({ marks: new Map(), measures });
            const beginEvents = out.traceEvents.filter((e) => e.ph === "B");
            const endEvents = out.traceEvents.filter((e) => e.ph === "E");
            expect(beginEvents).toHaveLength(1);
            expect(endEvents).toHaveLength(1);
            expect(beginEvents[0].name).toBe("load");
            expect(endEvents[0].name).toBe("load");
        });
    });
});
