/**
 * Unit tests — ProgressTracker
 * Covers: init, recordSuccess, recordFailure, getSummary, reset, emitProgress
 */

import { ProgressTracker } from "../../../src/capabilities/offline/cache/progress-tracker.js";

describe("ProgressTracker", () => {
    beforeEach(() => {
        ProgressTracker.reset();
    });

    // ----- init -----

    describe("init", () => {
        test("sets total from options", () => {
            ProgressTracker.init({ total: 50 });
            const summary = ProgressTracker.getSummary();
            expect(summary.total).toBe(50);
        });

        test("sets alreadyCached as completed offset", () => {
            ProgressTracker.init({ total: 100, alreadyCached: 20 });
            const summary = ProgressTracker.getSummary();
            expect(summary.completed).toBe(20);
        });

        test("defaults to 0 when no options provided", () => {
            ProgressTracker.init();
            const summary = ProgressTracker.getSummary();
            expect(summary.total).toBe(0);
            expect(summary.completed).toBe(0);
        });

        test("sets downloadedSize from alreadyCachedSize", () => {
            ProgressTracker.init({ alreadyCachedSize: 4096 });
            const summary = ProgressTracker.getSummary();
            expect(summary.totalSize).toBe(4096);
        });
    });

    // ----- recordSuccess -----

    describe("recordSuccess", () => {
        test("increments completed count", () => {
            ProgressTracker.init({ total: 10 });
            ProgressTracker.recordSuccess({ url: "https://example.com/a.json", size: 1024 });
            const summary = ProgressTracker.getSummary();
            expect(summary.completed).toBe(1);
        });

        test("adds resource size to downloadedSize", () => {
            ProgressTracker.init({ total: 10 });
            ProgressTracker.recordSuccess({ url: "https://example.com/a.json", size: 2048 });
            ProgressTracker.recordSuccess({ url: "https://example.com/b.json", size: 1024 });
            const summary = ProgressTracker.getSummary();
            expect(summary.totalSize).toBe(3072);
        });

        test("pushes URL to successfulDownloads", () => {
            ProgressTracker.init({ total: 10 });
            ProgressTracker.recordSuccess({ url: "https://example.com/tile.png", size: 500 });
            const summary = ProgressTracker.getSummary();
            expect(summary.successfulDownloads).toContain("https://example.com/tile.png");
        });

        test("treats missing size as 0", () => {
            ProgressTracker.init({ total: 10 });
            ProgressTracker.recordSuccess({ url: "https://example.com/no-size.json" });
            const summary = ProgressTracker.getSummary();
            expect(summary.totalSize).toBe(0);
            expect(summary.completed).toBe(1);
        });
    });

    // ----- recordFailure -----

    describe("recordFailure", () => {
        test("increments completed count", () => {
            ProgressTracker.init({ total: 5 });
            ProgressTracker.recordFailure({ url: "https://example.com/bad.json" }, "Network error");
            expect(ProgressTracker.getSummary().completed).toBe(1);
        });

        test("does not add to successfulDownloads", () => {
            ProgressTracker.init({ total: 5 });
            ProgressTracker.recordFailure({ url: "https://example.com/bad.json" }, "404");
            expect(ProgressTracker.getSummary().successful).toBe(0);
        });

        test("pushes to failedDownloads with url and error", () => {
            ProgressTracker.init({ total: 5 });
            ProgressTracker.recordFailure({ url: "https://example.com/fail.json" }, "Timeout");
            const summary = ProgressTracker.getSummary();
            expect(summary.failed).toBe(1);
            expect(summary.failedDownloads[0]).toMatchObject({
                url: "https://example.com/fail.json",
                error: "Timeout",
            });
        });

        test("failedUrls is derived from failedDownloads", () => {
            ProgressTracker.init({ total: 5 });
            ProgressTracker.recordFailure({ url: "https://example.com/x.json" }, "err");
            const summary = ProgressTracker.getSummary();
            expect(summary.failedUrls).toContain("https://example.com/x.json");
        });
    });

    // ----- getSummary -----

    describe("getSummary", () => {
        // CAPACITÉS S1 regression: `averageSpeed` divided by the elapsed duration with no
        // guard, while the sibling `_calculateProgress` guarded the identical computation.
        // A summary taken in the same millisecond as init() therefore shipped Infinity —
        // or NaN with nothing downloaded — inside the `geoleaf:cache:completed` event.
        // Time is frozen rather than raced: letting the clock advance by 1 ms makes the
        // division finite again, so an unfrozen test would pass even unpatched.
        test("averageSpeed stays finite when no time has elapsed", () => {
            const realNow = Date.now;
            Date.now = () => 1_000_000;
            try {
                ProgressTracker.init({ total: 3 });
                // Non-zero payload: 0/0 gives NaN, but n/0 gives Infinity — pin the
                // branch that actually reached the completion event.
                ProgressTracker.recordSuccess("https://example.org/a.json", 4096);
                const summary = ProgressTracker.getSummary();
                expect(summary.duration).toBe(0);
                expect(Number.isFinite(summary.averageSpeed)).toBe(true);
                expect(summary.averageSpeed).toBe(0);
            } finally {
                Date.now = realNow;
            }
        });

        test("returns all required fields", () => {
            ProgressTracker.init({ total: 3 });
            const summary = ProgressTracker.getSummary();
            expect(summary).toHaveProperty("duration");
            expect(summary).toHaveProperty("completed");
            expect(summary).toHaveProperty("total");
            expect(summary).toHaveProperty("successful");
            expect(summary).toHaveProperty("failed");
            expect(summary).toHaveProperty("totalSize");
            expect(summary).toHaveProperty("averageSpeed");
            expect(summary).toHaveProperty("successfulDownloads");
            expect(summary).toHaveProperty("failedDownloads");
            expect(summary).toHaveProperty("failedUrls");
        });

        test("duration is a non-negative number", () => {
            ProgressTracker.init({ total: 0 });
            const { duration } = ProgressTracker.getSummary();
            expect(typeof duration).toBe("number");
            expect(duration).toBeGreaterThanOrEqual(0);
        });

        test("successful + failed equals completed", () => {
            ProgressTracker.init({ total: 4 });
            ProgressTracker.recordSuccess({ url: "https://a.com/1.json", size: 100 });
            ProgressTracker.recordSuccess({ url: "https://a.com/2.json", size: 100 });
            ProgressTracker.recordFailure({ url: "https://a.com/3.json" }, "err");
            const s = ProgressTracker.getSummary();
            expect(s.successful + s.failed).toBe(s.completed);
        });
    });

    // ----- reset -----

    describe("reset", () => {
        test("clears all state after records", () => {
            ProgressTracker.init({ total: 5 });
            ProgressTracker.recordSuccess({ url: "https://example.com/a", size: 1000 });
            ProgressTracker.recordFailure({ url: "https://example.com/b" }, "err");
            ProgressTracker.reset();
            const summary = ProgressTracker.getSummary();
            expect(summary.completed).toBe(0);
            expect(summary.successful).toBe(0);
            expect(summary.failed).toBe(0);
            expect(summary.totalSize).toBe(0);
            expect(summary.successfulDownloads).toHaveLength(0);
            expect(summary.failedDownloads).toHaveLength(0);
        });
    });

    // ----- emitProgress -----

    describe("emitProgress", () => {
        test("returns ProgressData with all required fields", () => {
            ProgressTracker.init({ total: 10, estimatedTotalSize: 102400 });
            const data = ProgressTracker.emitProgress();
            expect(data).toHaveProperty("current");
            expect(data).toHaveProperty("total");
            expect(data).toHaveProperty("percentage");
            expect(data).toHaveProperty("downloadedSize");
            expect(data).toHaveProperty("estimatedTotalSize");
            expect(data).toHaveProperty("currentSpeed");
            expect(data).toHaveProperty("averageSpeed");
            expect(data).toHaveProperty("eta");
            expect(data).toHaveProperty("successful");
            expect(data).toHaveProperty("failed");
            expect(data).toHaveProperty("elapsedTime");
        });

        test("dispatches geoleaf:cache:progress DOM event", () => {
            ProgressTracker.init({ total: 5 });
            let eventDetail = null;
            const handler = (e) => {
                eventDetail = e.detail;
            };
            document.addEventListener("geoleaf:cache:progress", handler);
            ProgressTracker.emitProgress();
            document.removeEventListener("geoleaf:cache:progress", handler);
            expect(eventDetail).not.toBeNull();
            expect(eventDetail).toHaveProperty("current");
        });

        test("calls user callback with ProgressData", () => {
            ProgressTracker.init({ total: 5 });
            const cb = vi.fn();
            ProgressTracker.emitProgress(cb);
            expect(cb).toHaveBeenCalledTimes(1);
            expect(cb.mock.calls[0][0]).toHaveProperty("percentage");
        });

        test("percentage is 0 when nothing downloaded yet", () => {
            ProgressTracker.init({ total: 10 });
            const data = ProgressTracker.emitProgress();
            expect(data.percentage).toBe(0);
        });

        test("percentage reflects completed/total ratio", () => {
            ProgressTracker.init({ total: 4 });
            // Record 2 successes: completed=2, total=4 → 50%
            ProgressTracker.recordSuccess({ url: "https://a/1", size: 100 });
            ProgressTracker.recordSuccess({ url: "https://a/2", size: 100 });
            const data = ProgressTracker.emitProgress();
            expect(data.percentage).toBe(50);
        });

        test("swallows callback error without throwing (line 228)", () => {
            ProgressTracker.init({ total: 5 });
            const throwingCb = () => {
                throw new Error("callback failed");
            };
            expect(() => ProgressTracker.emitProgress(throwingCb)).not.toThrow();
        });
    });

    // T23 — _emitProgressIfNeeded with callback (lines 140-161)
    describe("_emitProgressIfNeeded with callback", () => {
        test("calls callback when shouldUpdate is true (completed === total)", () => {
            ProgressTracker.init({ total: 1 });
            const cb = vi.fn();
            // completed(1) === total(1) → shouldUpdate=true → callback executed
            ProgressTracker.recordSuccess({ url: "https://example.com/last.json", size: 100 }, cb);
            expect(cb).toHaveBeenCalledTimes(1);
            expect(cb.mock.calls[0][0]).toHaveProperty("percentage");
        });

        test("swallows callback error in _emitProgressIfNeeded (lines 152-154)", () => {
            ProgressTracker.init({ total: 1 });
            const throwingCb = () => {
                throw new Error("cb error");
            };
            // Should not propagate the error
            expect(() =>
                ProgressTracker.recordSuccess(
                    { url: "https://example.com/x.json", size: 0 },
                    throwingCb
                )
            ).not.toThrow();
        });

        test("calls failure callback when shouldUpdate is true", () => {
            ProgressTracker.init({ total: 1 });
            const cb = vi.fn();
            ProgressTracker.recordFailure({ url: "https://example.com/fail.json" }, "err", cb);
            expect(cb).toHaveBeenCalledTimes(1);
        });
    });

    // ── Percentage bounds (CAPACITÉS B.12) ──────────────────────────────────────
    //
    // `_calculateProgress` computes `completed / total * 100` with NO clamp, while the
    // `CacheMetrics.calculateProgress` it superseded did clamp to [0,100]. The dead code
    // was right on this axis: `completed` is incremented unconditionally by recordSuccess
    // and recordFailure, so any resource counted twice — a retry recorded as both, an
    // enumeration that yields duplicates — drives the emitted percentage past 100 and the
    // download UI shows "127 %".
    describe("percentage stays within [0, 100] (B.12)", () => {
        test("more completions than the announced total does not exceed 100 %", () => {
            ProgressTracker.init({ total: 2 });

            ProgressTracker.recordSuccess({ url: "a", size: 10 });
            ProgressTracker.recordSuccess({ url: "b", size: 10 });
            // Third completion against a total of 2 — the double-count case.
            const progress = ProgressTracker.emitProgress();

            ProgressTracker.recordSuccess({ url: "c", size: 10 });
            const overshoot = ProgressTracker.emitProgress();

            expect(progress.percentage).toBe(100);
            expect(overshoot.percentage).toBeLessThanOrEqual(100);
        });

        test("a failure counted after the total is reached does not exceed 100 % either", () => {
            ProgressTracker.init({ total: 1 });
            ProgressTracker.recordSuccess({ url: "a", size: 5 });
            ProgressTracker.recordFailure({ url: "b" }, "boom");

            expect(ProgressTracker.emitProgress().percentage).toBeLessThanOrEqual(100);
        });

        test("percentage is never negative", () => {
            ProgressTracker.init({ total: 10 });
            expect(ProgressTracker.emitProgress().percentage).toBeGreaterThanOrEqual(0);
        });
    });
});
