/**
 * @geoleaf-plugins/position-share — emission loop
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { startEmission, stopEmission, toggleEmission, isEmitting } from "../emitter.js";
import { registerTransport } from "../transports/registry.js";
import type { PluginConfig } from "../config.js";

/** Installs a fake `GeoLeaf.Geolocation` reporting the given state. */
function setGeolocation(
    active: boolean,
    userPosition: { lat: number; lng: number; timestamp?: number } | null
): void {
    (globalThis as Record<string, unknown>).GeoLeaf = {
        Geolocation: { getState: () => ({ active, userPosition }) },
    };
}

function cfg(over: Partial<PluginConfig> = {}): PluginConfig {
    return {
        enabled: true,
        mode: "manual",
        transport: "test-emit",
        endpoint: "https://example.test/positions",
        intervalMs: 1000,
        minDistanceM: 10,
        showButton: true,
        receive: { enabled: false },
        ...over,
    };
}

let sent: unknown[];
let sendMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    sendMock = vi.fn(async (p: unknown) => {
        sent.push(p);
    });
    registerTransport("test-emit", () => ({ send: sendMock as never }));
    setGeolocation(true, { lat: 48.85, lng: 2.35, timestamp: 1_700_000_000_000 });
});

afterEach(() => {
    stopEmission();
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).GeoLeaf;
    vi.restoreAllMocks();
});

describe("startEmission", () => {
    it("refuses to start when `enabled` is false", () => {
        expect(startEmission(cfg({ enabled: false }))).toBe(false);
        expect(isEmitting()).toBe(false);
    });

    it('refuses to start in mode "off"', () => {
        expect(startEmission(cfg({ mode: "off" }))).toBe(false);
    });

    it("refuses to start when the configuration cannot produce a transport", () => {
        expect(startEmission(cfg({ transport: "http", endpoint: undefined }))).toBe(false);
    });

    it("refuses to start when no factory answers to the transport key", () => {
        expect(startEmission(cfg({ transport: "nobody-registered-this" }))).toBe(false);
    });

    // Waiting a full period before the first sample makes the feature look broken at exactly
    // the moment someone switches it on to check that it works.
    it("emits once immediately, without waiting a period", async () => {
        startEmission(cfg());
        await vi.advanceTimersByTimeAsync(0);
        expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it("emits again on each interval when the user has moved", async () => {
        startEmission(cfg());
        await vi.advanceTimersByTimeAsync(0);

        setGeolocation(true, { lat: 48.86, lng: 2.35, timestamp: 1_700_000_060_000 });
        await vi.advanceTimersByTimeAsync(1000);

        expect(sendMock).toHaveBeenCalledTimes(2);
    });
});

describe("the guards that keep samples off the wire", () => {
    it("emits nothing while the GPS watch is inactive", async () => {
        setGeolocation(false, { lat: 48.85, lng: 2.35 });
        startEmission(cfg());
        await vi.advanceTimersByTimeAsync(2000);
        expect(sendMock).not.toHaveBeenCalled();
    });

    it("emits nothing when there is no fix yet", async () => {
        setGeolocation(true, null);
        startEmission(cfg());
        await vi.advanceTimersByTimeAsync(2000);
        expect(sendMock).not.toHaveBeenCalled();
    });

    it("does not re-emit a position that has not moved", async () => {
        startEmission(cfg());
        await vi.advanceTimersByTimeAsync(0);
        expect(sendMock).toHaveBeenCalledTimes(1);

        // Same coordinates, three more cycles.
        await vi.advanceTimersByTimeAsync(3000);
        expect(sendMock).toHaveBeenCalledTimes(1);
    });
});

describe("a rejected send", () => {
    // No queue, deliberately: a position is perishable, and replaying it later publishes a
    // false fact about where someone is.
    it("drops the sample instead of queueing it, and keeps the loop alive", async () => {
        sendMock.mockRejectedValue(new Error("backend down"));
        startEmission(cfg());
        await vi.advanceTimersByTimeAsync(0);

        setGeolocation(true, { lat: 48.87, lng: 2.35 });
        await vi.advanceTimersByTimeAsync(1000);

        // Two attempts, nothing accumulated, loop still running.
        expect(sendMock).toHaveBeenCalledTimes(2);
        expect(sent).toHaveLength(0);
        expect(isEmitting()).toBe(true);
    });
});

describe("stop and toggle", () => {
    it("stops the loop and is idempotent", async () => {
        startEmission(cfg());
        expect(isEmitting()).toBe(true);
        stopEmission();
        stopEmission();
        expect(isEmitting()).toBe(false);
    });

    it("calls close() on the transport when stopping", () => {
        const close = vi.fn();
        registerTransport("test-close", () => ({ send: async () => {}, close }));
        startEmission(cfg({ transport: "test-close" }));
        stopEmission();
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("toggling from a running loop stops it", () => {
        startEmission(cfg());
        expect(toggleEmission()).toBe(false);
        expect(isEmitting()).toBe(false);
    });
});
