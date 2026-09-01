/**
 * @geoleaf-plugins/position-share — receive side
 *
 * The whole receive path is one delegation to `realtime-layer`, which is declared `optional`.
 * Its absence must therefore be a NORMAL, named outcome — never a crash that takes the rest of
 * the plugin with it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import { showOthers, initReceive } from "../receive.js";

/** Installs a fake namespace with the given `Config` values and optional RealtimeLayer. */
function setHost(opts: {
    layerId?: string;
    receiveEnabled?: boolean;
    realtime?: { start?: unknown; stop?: unknown } | undefined;
}): void {
    (globalThis as Record<string, unknown>).GeoLeaf = {
        Config: {
            get: (key: string) =>
                key === "modules.position-share"
                    ? {
                          receive: {
                              enabled: opts.receiveEnabled ?? false,
                              ...(opts.layerId ? { layerId: opts.layerId } : {}),
                          },
                      }
                    : undefined,
        },
        ...(opts.realtime ? { RealtimeLayer: opts.realtime } : {}),
    };
}

afterEach(() => {
    delete (globalThis as Record<string, unknown>).GeoLeaf;
    vi.restoreAllMocks();
});

describe("showOthers", () => {
    it("starts the realtime layer on the configured layerId", () => {
        const start = vi.fn();
        const stop = vi.fn();
        setHost({ layerId: "fleet", realtime: { start, stop } });

        expect(showOthers(true)).toBe(true);
        expect(start).toHaveBeenCalledWith("fleet");
        expect(stop).not.toHaveBeenCalled();
    });

    it("stops it when asked to hide", () => {
        const start = vi.fn();
        const stop = vi.fn();
        setHost({ layerId: "fleet", realtime: { start, stop } });

        expect(showOthers(false)).toBe(true);
        expect(stop).toHaveBeenCalledWith("fleet");
    });

    it("reports and returns false when RealtimeLayer is absent", () => {
        setHost({ layerId: "fleet", realtime: undefined });
        expect(showOthers(true)).toBe(false);
    });

    it("reports and returns false when no layerId is configured", () => {
        const start = vi.fn();
        setHost({ realtime: { start, stop: vi.fn() } });

        expect(showOthers(true)).toBe(false);
        expect(start).not.toHaveBeenCalled();
    });
});

describe("initReceive", () => {
    it("does nothing when reception is not enabled", () => {
        const start = vi.fn();
        setHost({ layerId: "fleet", receiveEnabled: false, realtime: { start, stop: vi.fn() } });

        expect(initReceive()).toBe(false);
        expect(start).not.toHaveBeenCalled();
    });

    it("starts reception when the profile asks for it", () => {
        const start = vi.fn();
        setHost({ layerId: "fleet", receiveEnabled: true, realtime: { start, stop: vi.fn() } });

        expect(initReceive()).toBe(true);
        expect(start).toHaveBeenCalledWith("fleet");
    });
});
