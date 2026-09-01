/**
 * Tests for the persistence adapter factory — Sprint S11 (EDT.11.4 / EDT.11.5).
 * Verifies `persistence.mode` maps to the right backend by behaviour: offline →
 * Storage queue, online → REST (fetch), auto → REST when reachable, collection
 * dialect → online regardless of mode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPersistenceAdapter, createOnlineAdapter } from "../persistence/adapter-factory.js";
import type { EditorConfig } from "../types.js";
import type { EditorFeature } from "../persistence/adapter-interface.js";

const FEATURE: EditorFeature = {
    id: "f1",
    geometry: { type: "Point", coordinates: [2.35, 48.85] },
    properties: {},
};

const API = { baseUrl: "https://api.test", timeoutMs: 5000 };

let applyEdit: ReturnType<typeof vi.fn>;
let mayEdit: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    // The `offline` mode writes through the core's write point, no longer the database.
    applyEdit = vi.fn().mockResolvedValue({ entryId: "op-1", refused: null });
    // ⚠️ `mayEdit` IS PART OF THE DOUBLE, and its absence was not neutral. The
    // factory now wraps every mode in a permission guard (`permission-gate.ts`)
    // that REFUSES when it cannot query the facade — "absent means refused",
    // the very rule of `LayerEditionPermissions`. A double omitting the member
    // is thus not a lightweight double: it is a fiction of the global, this
    // work's root cause no. 1, and these 4 cases came out red while it was one.
    //
    // It grants EVERYTHING here on purpose: these cases exercise the per-mode
    // ROUTING, not the permission — that has its own suite (`permission-gate.test.ts`).
    mayEdit = vi.fn(() => true);
    (globalThis as any).GeoLeaf.Storage = { applyEdit, mayEdit };
    (globalThis as any).GeoLeaf.Config = { getActiveProfile: vi.fn(() => ({ id: "p" })) };
    fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("{}"),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).GeoLeaf.Storage;
});

function cfg(mode: "online" | "offline" | "auto", dialect?: "rest" | "collection"): EditorConfig {
    return { api: API, persistence: { mode, dialect } };
}

describe("createPersistenceAdapter — mode routing", () => {
    it("offline → Storage queue (no fetch)", async () => {
        const adapter = createPersistenceAdapter(cfg("offline"));
        expect(adapter.isOnline()).toBe(false);
        await adapter.save(FEATURE, "L");
        expect(applyEdit).toHaveBeenCalledOnce();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("online → REST (fetch, no queue)", async () => {
        const adapter = createPersistenceAdapter(cfg("online"));
        await adapter.save(FEATURE, "L");
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(applyEdit).not.toHaveBeenCalled();
    });

    it("auto + reachable → REST (no queue)", async () => {
        const adapter = createPersistenceAdapter(cfg("auto"));
        await adapter.save(FEATURE, "L");
        // One HEAD probe + one POST, all via fetch; queue untouched.
        expect(fetchMock).toHaveBeenCalled();
        expect(applyEdit).not.toHaveBeenCalled();
    });

    it("collection dialect → online adapter even with mode offline", async () => {
        const adapter = createPersistenceAdapter(cfg("offline", "collection"));
        await adapter.save(FEATURE, "L");
        expect(fetchMock).toHaveBeenCalled();
        expect(applyEdit).not.toHaveBeenCalled();
    });
});

describe("createOnlineAdapter", () => {
    it("builds a REST adapter for the default dialect", async () => {
        const adapter = createOnlineAdapter(cfg("auto"));
        await adapter.save(FEATURE, "L");
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain("/features");
        expect(init.method).toBe("POST");
    });
});
