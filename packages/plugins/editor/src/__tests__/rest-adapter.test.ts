/**
 * Tests for the REST persistence adapter — Sprint S10 (EDT.10.2 / EDT.10.6).
 * Mocks fetch via the injected `fetchImpl`; covers success, timeout (AbortController),
 * 4xx, 409 → conflict, 5xx, parse failure, and isOnline().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRestAdapter } from "../persistence/rest-adapter.js";
import { PersistenceError, type EditorFeature } from "../persistence/adapter-interface.js";

const FEATURE: EditorFeature = {
    id: "f1",
    geometry: { type: "Point", coordinates: [2.35, 48.85] },
    properties: { name: "Tour Eiffel" },
};

/** Builds a Response-like stub good enough for the adapter (ok/status/text). */
function res(status: number, body = ""): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(body),
    } as unknown as Response;
}

describe("createRestAdapter — save (POST)", () => {
    it("POSTs to /features with layerId, Authorization and JSON body", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(res(201, JSON.stringify({ id: "srv-9" })));
        const adapter = createRestAdapter({
            baseUrl: "https://api.test/",
            authHeader: "Bearer tok",
            timeoutMs: 5000,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        const saved = await adapter.save(FEATURE, "layerA");

        expect(fetchImpl).toHaveBeenCalledOnce();
        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.test/features?layerId=layerA");
        expect(init.method).toBe("POST");
        expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
        expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
        expect(JSON.parse(init.body as string)).toEqual({ feature: FEATURE, layerId: "layerA" });
        expect(saved.id).toBe("srv-9");
        expect(saved.layerId).toBe("layerA");
    });

    it("omits Authorization when authHeader is null", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(res(200, "{}"));
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            authHeader: null,
            timeoutMs: 5000,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        await adapter.save(FEATURE, "layerA");
        const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
    });
});

describe("createRestAdapter — update (PUT)", () => {
    it("PUTs to /features/:id and sends X-Force-Update when force is set", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(res(200, JSON.stringify({ id: "f1" })));
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            timeoutMs: 5000,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        await adapter.update(FEATURE, "layerA", { force: true });

        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.test/features/f1?layerId=layerA");
        expect(init.method).toBe("PUT");
        expect((init.headers as Record<string, string>)["X-Force-Update"]).toBe("true");
        expect(JSON.parse(init.body as string).force).toBe(true);
    });
});

describe("createRestAdapter — delete (DELETE)", () => {
    it("DELETEs /features/:id and tolerates an empty body", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(res(204, ""));
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            timeoutMs: 5000,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        await expect(adapter.delete("f1", "layerA")).resolves.toBeUndefined();
        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.test/features/f1?layerId=layerA");
        expect(init.method).toBe("DELETE");
    });
});

describe("createRestAdapter — error mapping", () => {
    it("maps 400 to a 'client' PersistenceError with the status", async () => {
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            timeoutMs: 5000,
            fetchImpl: vi.fn().mockResolvedValue(res(400, "bad")) as unknown as typeof fetch,
        });
        await expect(adapter.save(FEATURE, "L")).rejects.toMatchObject({
            kind: "client",
            status: 400,
        });
    });

    it("maps 401 to a 'client' PersistenceError", async () => {
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            timeoutMs: 5000,
            fetchImpl: vi.fn().mockResolvedValue(res(401)) as unknown as typeof fetch,
        });
        await expect(adapter.save(FEATURE, "L")).rejects.toMatchObject({
            kind: "client",
            status: 401,
        });
    });

    // 🛑 B-199 — un 501 n'est PAS une panne de réseau. Le serveur déclare ne pas connaître le
    // verbe : c'est définitif, donc non réessayable, donc la file ne doit jamais le reprendre
    // (voir `auto-adapter.test.ts`). Avant ce sprint il sortait en `"network"` par la branche
    // fourre-tout, dans CE dialecte comme dans l'autre.
    it("maps 501 to a 'capability' PersistenceError — jamais 'network'", async () => {
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            timeoutMs: 5000,
            fetchImpl: vi.fn().mockResolvedValue(res(501)) as unknown as typeof fetch,
        });
        await expect(adapter.save(FEATURE, "L")).rejects.toMatchObject({
            kind: "capability",
            status: 501,
        });
    });

    it("maps 500 to 'network' — le voisin transitoire reste réessayable", async () => {
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            timeoutMs: 5000,
            fetchImpl: vi.fn().mockResolvedValue(res(500)) as unknown as typeof fetch,
        });
        await expect(adapter.save(FEATURE, "L")).rejects.toMatchObject({
            kind: "network",
            status: 500,
        });
    });

    it("maps 409 to a 'conflict' error, parses serverData and fires onConflict once", async () => {
        const onConflict = vi.fn();
        const serverBody = { id: "f1", version: 7 };
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            timeoutMs: 5000,
            fetchImpl: vi
                .fn()
                .mockResolvedValue(res(409, JSON.stringify(serverBody))) as unknown as typeof fetch,
            onConflict,
        });

        await expect(adapter.update(FEATURE, "layerA")).rejects.toMatchObject({
            kind: "conflict",
            status: 409,
            serverData: serverBody,
        });
        expect(onConflict).toHaveBeenCalledOnce();
        expect(onConflict).toHaveBeenCalledWith({
            featureId: "f1",
            layerId: "layerA",
            localFeature: FEATURE,
            serverData: serverBody,
        });
    });

    it("maps 500 to a 'network' PersistenceError", async () => {
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            timeoutMs: 5000,
            fetchImpl: vi.fn().mockResolvedValue(res(500)) as unknown as typeof fetch,
        });
        await expect(adapter.save(FEATURE, "L")).rejects.toMatchObject({ kind: "network" });
    });

    it("maps a fetch rejection to a 'network' PersistenceError", async () => {
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            timeoutMs: 5000,
            fetchImpl: vi
                .fn()
                .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch,
        });
        await expect(adapter.save(FEATURE, "L")).rejects.toMatchObject({ kind: "network" });
    });

    it("maps an unparseable 2xx body to a 'parse' PersistenceError", async () => {
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            timeoutMs: 5000,
            fetchImpl: vi.fn().mockResolvedValue(res(200, "not-json{")) as unknown as typeof fetch,
        });
        await expect(adapter.save(FEATURE, "L")).rejects.toMatchObject({ kind: "parse" });
    });

    it("throws a PersistenceError instance (instanceof preserved)", async () => {
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            timeoutMs: 5000,
            fetchImpl: vi.fn().mockResolvedValue(res(500)) as unknown as typeof fetch,
        });
        await adapter.save(FEATURE, "L").catch((e) => {
            expect(e).toBeInstanceOf(PersistenceError);
        });
        expect.assertions(1);
    });
});

describe("createRestAdapter — timeout", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("aborts after timeoutMs and maps to a 'timeout' error", async () => {
        // fetch that rejects with an AbortError when the signal aborts.
        const fetchImpl = vi.fn(
            (_url: string, init: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    const signal = init.signal as AbortSignal;
                    signal.addEventListener("abort", () => {
                        const err = new Error("Aborted");
                        err.name = "AbortError";
                        reject(err);
                    });
                })
        );
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            timeoutMs: 1000,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        const promise = adapter.save(FEATURE, "L");
        const assertion = expect(promise).rejects.toMatchObject({ kind: "timeout" });
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
    });
});

describe("createRestAdapter — isOnline", () => {
    it("reflects navigator.onLine", () => {
        const adapter = createRestAdapter({
            baseUrl: "https://api.test",
            timeoutMs: 5000,
            fetchImpl: vi.fn() as unknown as typeof fetch,
        });
        const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
        expect(adapter.isOnline()).toBe(false);
        spy.mockReturnValue(true);
        expect(adapter.isOnline()).toBe(true);
        spy.mockRestore();
    });
});
