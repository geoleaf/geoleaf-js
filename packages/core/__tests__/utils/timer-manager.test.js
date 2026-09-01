/**
 * @file timer-manager.test.js
 * @description Tests for the real TimerManager class (imports actual module)
 */

const mockLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

let TimerManager;

// LOAD-BEARING deferral: the module installs a singleton at load
// (`globalTimerManager = new TimerManager("global")`), so the load MOMENT
// counts. `await import()` preserves it while still running the module
// through Vite.
beforeAll(async () => {
    const mod = await import("../../src/utils/general/timer-manager.js");
    TimerManager = mod.TimerManager;
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("GeoLeaf.Utils.TimerManager", () => {
    let manager;

    beforeEach(() => {
        manager = new TimerManager("test");
    });

    afterEach(() => {
        manager.clearAll();
    });

    // --- constructor -----------------------------------------------------------

    describe("constructor", () => {
        test("creates with default name", () => {
            const m = new TimerManager();
            expect(m.name).toBe("default");
        });

        test("accepts a custom name", () => {
            expect(manager.name).toBe("test");
        });
    });

    // --- setTimeout ------------------------------------------------------------

    describe("setTimeout", () => {
        test("returns a numeric id", () => {
            const id = manager.setTimeout(vi.fn(), 100);
            expect(typeof id).toBe("number");
        });

        test("calls callback after delay", () => {
            const cb = vi.fn();
            manager.setTimeout(cb, 200, "delay-test");
            expect(cb).not.toHaveBeenCalled();
            vi.advanceTimersByTime(200);
            expect(cb).toHaveBeenCalledTimes(1);
        });

        test("removes timer from tracking after callback fires", () => {
            manager.setTimeout(vi.fn(), 100);
            vi.advanceTimersByTime(100);
            const stats = manager.getStats();
            expect(stats.timeouts).toBe(0);
        });

        test("stores timer metadata", () => {
            manager.setTimeout(vi.fn(), 100, "my-timer");
            const list = manager.listActiveTimers();
            expect(list).toHaveLength(1);
            expect(list[0].type).toBe("timeout");
            expect(list[0].label).toBe("my-timer");
            expect(list[0].delay).toBe(100);
        });

        test("increments id on each call", () => {
            const id1 = manager.setTimeout(vi.fn(), 100);
            const id2 = manager.setTimeout(vi.fn(), 200);
            expect(id2).toBe(id1 + 1);
        });
    });

    // --- setInterval -----------------------------------------------------------

    describe("setInterval", () => {
        test("returns a numeric id", () => {
            const id = manager.setInterval(vi.fn(), 100);
            expect(typeof id).toBe("number");
        });

        test("calls callback on each tick", () => {
            const cb = vi.fn();
            manager.setInterval(cb, 200, "ticker");
            vi.advanceTimersByTime(600);
            expect(cb).toHaveBeenCalledTimes(3);
        });

        test("stores interval metadata", () => {
            manager.setInterval(vi.fn(), 150, "my-interval");
            const list = manager.listActiveTimers();
            const entry = list.find((e) => e.type === "interval");
            expect(entry).toBeDefined();
            expect(entry.label).toBe("my-interval");
            expect(entry.interval).toBe(150);
        });

        test("logs error when callback throws", () => {
            manager.setInterval(() => {
                throw new Error("boom");
            }, 100);
            vi.advanceTimersByTime(100);
            expect(mockLog.error).toHaveBeenCalled();
        });
    });

    // --- clearTimeout ----------------------------------------------------------

    describe("clearTimeout", () => {
        test("returns true and removes timer", () => {
            const id = manager.setTimeout(vi.fn(), 500);
            expect(manager.clearTimeout(id)).toBe(true);
            expect(manager.getStats().timeouts).toBe(0);
        });

        test("returns false for unknown id", () => {
            expect(manager.clearTimeout(9999)).toBe(false);
        });

        test("prevents callback from firing", () => {
            const cb = vi.fn();
            const id = manager.setTimeout(cb, 300);
            manager.clearTimeout(id);
            vi.advanceTimersByTime(300);
            expect(cb).not.toHaveBeenCalled();
        });
    });

    // --- clearInterval ---------------------------------------------------------

    describe("clearInterval", () => {
        test("returns true and removes interval", () => {
            const id = manager.setInterval(vi.fn(), 200);
            expect(manager.clearInterval(id)).toBe(true);
            expect(manager.getStats().intervals).toBe(0);
        });

        test("returns false for unknown id", () => {
            expect(manager.clearInterval(9999)).toBe(false);
        });

        test("stops further callbacks", () => {
            const cb = vi.fn();
            const id = manager.setInterval(cb, 100);
            vi.advanceTimersByTime(100);
            manager.clearInterval(id);
            vi.advanceTimersByTime(500);
            expect(cb).toHaveBeenCalledTimes(1);
        });
    });

    // --- clearAll --------------------------------------------------------------

    describe("clearAll", () => {
        test("clears all timers and intervals", () => {
            manager.setTimeout(vi.fn(), 100);
            manager.setInterval(vi.fn(), 200);
            manager.clearAll();
            const stats = manager.getStats();
            expect(stats.total).toBe(0);
        });

        test("logs when items were cleared", () => {
            manager.setTimeout(vi.fn(), 100);
            manager.clearAll();
            expect(mockLog.info).toHaveBeenCalled();
        });

        test("does not log when nothing to clear", () => {
            manager.clearAll();
            expect(mockLog.info).not.toHaveBeenCalled();
        });
    });

    // --- getStats --------------------------------------------------------------

    describe("getStats", () => {
        test("returns initial zero stats", () => {
            const stats = manager.getStats();
            expect(stats).toMatchObject({ timeouts: 0, intervals: 0, total: 0 });
        });

        test("returns correct counts after adds", () => {
            manager.setTimeout(vi.fn(), 100);
            manager.setInterval(vi.fn(), 200);
            const stats = manager.getStats();
            expect(stats.timeouts).toBe(1);
            expect(stats.intervals).toBe(1);
            expect(stats.total).toBe(2);
        });
    });

    // --- listActiveTimers ------------------------------------------------------

    describe("listActiveTimers", () => {
        test("returns empty array initially", () => {
            expect(manager.listActiveTimers()).toHaveLength(0);
        });

        test("includes timeout entry with id, type, label, age, delay", () => {
            manager.setTimeout(vi.fn(), 100, "t1");
            const list = manager.listActiveTimers();
            expect(list[0]).toMatchObject({ type: "timeout", label: "t1", delay: 100 });
            expect(typeof list[0].id).toBe("number");
            expect(typeof list[0].age).toBe("number");
        });

        test("includes interval entry with interval property", () => {
            manager.setInterval(vi.fn(), 200, "i1");
            const list = manager.listActiveTimers();
            expect(list[0]).toMatchObject({ type: "interval", label: "i1", interval: 200 });
        });
    });

    // --- destroy ---------------------------------------------------------------

    describe("destroy", () => {
        test("calls clearAll and logs", () => {
            manager.setTimeout(vi.fn(), 100);
            manager.destroy();
            expect(manager.getStats().total).toBe(0);
            expect(mockLog.info).toHaveBeenCalled();
        });
    });
});
