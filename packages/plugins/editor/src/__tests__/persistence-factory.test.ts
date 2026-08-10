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
    // 4.9 — le mode `offline` écrit par le point d'écriture du core, plus par la base.
    applyEdit = vi.fn().mockResolvedValue({ entryId: "op-1", refused: null });
    // ⚠️ `mayEdit` FAIT PARTIE DU DOUBLE DEPUIS LA TÂCHE 8.7, et son absence n'était pas
    // neutre. La fabrique enveloppe désormais chaque mode d'une garde de permission
    // (`permission-gate.ts`) qui REFUSE quand elle ne peut pas interroger la façade — « absent
    // vaut refusé », la règle même de `LayerEditionPermissions`. Un double qui omet le membre
    // n'est donc pas un double allégé : c'est une fiction du global, la cause racine n° 1 de
    // cette roadmap, et ces 4 cas sont sortis rouges tant qu'il l'était.
    //
    // Il accorde TOUT ici volontairement : ces cas éprouvent le ROUTAGE par mode, pas la
    // permission — celle-ci a sa suite dédiée (`permission-gate.test.ts`).
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
