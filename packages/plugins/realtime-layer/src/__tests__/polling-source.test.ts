/**
 * polling-source.test.ts — tests for PollingSource, including fallbackUrl behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PollingSource } from "../sources/polling-source.js";

function okJson(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

function errResp(status: number): Response {
    return new Response("error", { status });
}

describe("PollingSource", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Silence expected warnings during failure-path tests
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "info").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // ── happy path ───────────────────────────────────────────────────────────

    it("emits primary payload on 200", async () => {
        const fetchMock = vi.fn().mockResolvedValue(okJson({ foo: 1 }));
        vi.stubGlobal("fetch", fetchMock);
        const handler = vi.fn();

        const src = new PollingSource("https://primary/data", 5000, "json");
        src.onData(handler);
        src.start();

        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith("https://primary/data");
        expect(handler).toHaveBeenCalledWith({ foo: 1 });

        src.stop();
    });

    // ── fallback: primary fails, fallback succeeds, snapshot emitted once ────

    it("falls back to fallbackUrl on HTTP error, emits snapshot once", async () => {
        const fetchMock = vi
            .fn()
            .mockImplementation((url: string) =>
                url === "https://primary/data"
                    ? Promise.resolve(errResp(500))
                    : Promise.resolve(okJson({ snapshot: true }))
            );
        vi.stubGlobal("fetch", fetchMock);
        const handler = vi.fn();

        const src = new PollingSource("https://primary/data", 5000, "json", "/data/snap.geojson");
        src.onData(handler);
        src.start();

        // First tick: primary 500 → fallback 200 → handler called once
        await vi.advanceTimersByTimeAsync(0);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({ snapshot: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        // Second tick: primary still 500 → fallback NOT re-emitted
        await vi.advanceTimersByTimeAsync(5000);
        expect(handler).toHaveBeenCalledTimes(1); // no additional call
        // primary was re-tried but fallback was not fetched again
        const calls = fetchMock.mock.calls.map((c) => c[0]);
        expect(calls.filter((u) => u === "/data/snap.geojson")).toHaveLength(1);

        src.stop();
    });

    // ── recovery: primary comes back, flag resets, fallback can serve again ──

    it("recovers to primary and allows fallback to serve again on next outage", async () => {
        let primaryStatus: "down" | "up" = "down";
        const fetchMock = vi.fn().mockImplementation((url: string) => {
            if (url === "https://primary/data") {
                return primaryStatus === "up"
                    ? Promise.resolve(okJson({ primary: true }))
                    : Promise.resolve(errResp(500));
            }
            return Promise.resolve(okJson({ snapshot: true }));
        });
        vi.stubGlobal("fetch", fetchMock);
        const handler = vi.fn();

        const src = new PollingSource("https://primary/data", 5000, "json", "/data/snap.geojson");
        src.onData(handler);
        src.start();

        await vi.advanceTimersByTimeAsync(0);
        expect(handler).toHaveBeenLastCalledWith({ snapshot: true });

        // Primary recovers
        primaryStatus = "up";
        await vi.advanceTimersByTimeAsync(5000);
        expect(handler).toHaveBeenLastCalledWith({ primary: true });

        // Primary goes down again → fallback should emit once more
        primaryStatus = "down";
        await vi.advanceTimersByTimeAsync(5000);
        expect(handler).toHaveBeenLastCalledWith({ snapshot: true });
        expect(handler).toHaveBeenCalledTimes(3);

        src.stop();
    });

    // ── no fallback configured ───────────────────────────────────────────────

    it("does not attempt fallback when fallbackUrl is undefined", async () => {
        const fetchMock = vi.fn().mockResolvedValue(errResp(500));
        vi.stubGlobal("fetch", fetchMock);
        const handler = vi.fn();

        const src = new PollingSource("https://primary/data", 5000, "json");
        src.onData(handler);
        src.start();

        await vi.advanceTimersByTimeAsync(0);
        expect(handler).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith("https://primary/data");

        src.stop();
    });

    // ── network throw triggers fallback ──────────────────────────────────────

    it("falls back when primary throws a network error", async () => {
        const fetchMock = vi.fn().mockImplementation((url: string) => {
            if (url === "https://primary/data") {
                return Promise.reject(new TypeError("network failure"));
            }
            return Promise.resolve(okJson({ snapshot: true }));
        });
        vi.stubGlobal("fetch", fetchMock);
        const handler = vi.fn();

        const src = new PollingSource("https://primary/data", 5000, "json", "/data/snap.geojson");
        src.onData(handler);
        src.start();

        await vi.advanceTimersByTimeAsync(0);
        expect(handler).toHaveBeenCalledWith({ snapshot: true });

        src.stop();
    });
});
