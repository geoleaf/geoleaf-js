/**
 * Tests for the Auto persistence adapter — Sprint S11 (EDT.11.2 / EDT.11.5).
 * Mocks navigator.onLine + the HEAD ping + the rest/queue adapters; covers
 * online→rest, offline→queue, transport-failure fallback, conflict propagation,
 * and the cached reachability probe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAutoAdapter } from "../persistence/auto-adapter.js";
import {
    PersistenceError,
    type EditorFeature,
    type EditorPersistenceAdapter,
    type SavedFeature,
} from "../persistence/adapter-interface.js";

const FEATURE: EditorFeature = {
    id: "f1",
    geometry: { type: "Point", coordinates: [2.35, 48.85] },
    properties: {},
};

function setOnline(v: boolean): void {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: v });
}

/** A stub adapter whose methods are spies returning a canned SavedFeature. */
function stubAdapter(tag: string): EditorPersistenceAdapter & Record<string, any> {
    const saved: SavedFeature = {
        id: tag,
        layerId: "L",
        geometry: FEATURE.geometry,
        properties: {},
    };
    return {
        save: vi.fn().mockResolvedValue(saved),
        update: vi.fn().mockResolvedValue(saved),
        delete: vi.fn().mockResolvedValue(undefined),
        isOnline: vi.fn().mockReturnValue(true),
    };
}

beforeEach(() => setOnline(true));

describe("createAutoAdapter — routing", () => {
    it("online + reachable → delegates to the REST adapter", async () => {
        const rest = stubAdapter("rest");
        const queue = stubAdapter("queue");
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
        const adapter = createAutoAdapter({
            rest,
            queue,
            baseUrl: "https://api.test",
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        const saved = await adapter.save(FEATURE, "L");
        expect(rest.save).toHaveBeenCalledOnce();
        expect(queue.save).not.toHaveBeenCalled();
        expect(saved.id).toBe("rest");
        // The reachability probe used a HEAD request on the base URL.
        expect(fetchImpl).toHaveBeenCalledWith(
            "https://api.test",
            expect.objectContaining({ method: "HEAD" })
        );
    });

    it("navigator offline → delegates to the queue without pinging", async () => {
        setOnline(false);
        const rest = stubAdapter("rest");
        const queue = stubAdapter("queue");
        const fetchImpl = vi.fn();
        const adapter = createAutoAdapter({
            rest,
            queue,
            baseUrl: "https://api.test",
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        const saved = await adapter.save(FEATURE, "L");
        expect(queue.save).toHaveBeenCalledOnce();
        expect(rest.save).not.toHaveBeenCalled();
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(saved.id).toBe("queue");
    });

    it("REST transport failure → transparent fallback to the queue", async () => {
        const rest = stubAdapter("rest");
        (rest.save as any).mockRejectedValueOnce(new PersistenceError("network", "down"));
        const queue = stubAdapter("queue");
        const adapter = createAutoAdapter({
            rest,
            queue,
            baseUrl: "https://api.test",
            fetchImpl: vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch,
        });

        const saved = await adapter.save(FEATURE, "L");
        expect(rest.save).toHaveBeenCalledOnce();
        expect(queue.save).toHaveBeenCalledOnce();
        expect(saved.id).toBe("queue");
    });

    it("REST conflict error → propagates (no queue fallback)", async () => {
        const rest = stubAdapter("rest");
        (rest.update as any).mockRejectedValueOnce(
            new PersistenceError("conflict", "409", { status: 409 })
        );
        const queue = stubAdapter("queue");
        const adapter = createAutoAdapter({
            rest,
            queue,
            baseUrl: "https://api.test",
            fetchImpl: vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch,
        });

        await expect(adapter.update(FEATURE, "L")).rejects.toMatchObject({ kind: "conflict" });
        expect(queue.update).not.toHaveBeenCalled();
    });

    it("caches the reachability probe within the TTL (one ping for two writes)", async () => {
        const rest = stubAdapter("rest");
        const queue = stubAdapter("queue");
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
        const adapter = createAutoAdapter({
            rest,
            queue,
            baseUrl: "https://api.test",
            fetchImpl: fetchImpl as unknown as typeof fetch,
            pingTtlMs: 60_000,
        });

        await adapter.save(FEATURE, "L");
        await adapter.save(FEATURE, "L");
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(rest.save).toHaveBeenCalledTimes(2);
    });
});
