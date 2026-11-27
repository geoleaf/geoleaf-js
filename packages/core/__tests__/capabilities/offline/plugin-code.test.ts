/**
 * @tests capabilities/offline/cache/plugin-code — the preparation asks the worker to keep the
 * plugins loaded on demand, and never fails the preparation when it cannot.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { keepPluginCode } from "../../../src/capabilities/offline/cache/plugin-code.js";

/** Installs a controlling worker that answers `report` on the message's port. */
function stubController(report: unknown) {
    const postMessage = vi.fn((_msg: unknown, ports: MessagePort[]) => {
        if (report !== undefined) ports[0]!.postMessage(report);
    });
    Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: { controller: { postMessage } },
    });
    return postMessage;
}

afterEach(() => {
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    vi.useRealTimers();
});

describe("keepPluginCode", () => {
    it("answers null without a controlling worker — the zone is still prepared", async () => {
        Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
        await expect(keepPluginCode()).resolves.toBeNull();
    });

    it("sends PRECACHE_LAZY_PLUGINS and returns the worker's report", async () => {
        const post = stubController({ cached: 4, failed: [] });
        await expect(keepPluginCode()).resolves.toEqual({ cached: 4, failed: [] });
        expect(post.mock.calls[0]![0]).toEqual({ type: "PRECACHE_LAZY_PLUGINS" });
    });

    it("answers null when the worker never replies, past its bound", async () => {
        vi.useFakeTimers();
        stubController(undefined);
        const pending = keepPluginCode();
        await vi.advanceTimersByTimeAsync(30_000);
        await expect(pending).resolves.toBeNull();
    });
});
