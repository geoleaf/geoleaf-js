/**
 * The persistence adapter factory — and the reversal of its rule (R7).
 *
 * 🛑 THIS FILE ASSERTED "auto + reachable → REST" AND "collection dialect → online WHATEVER
 * the mode". Both were faithful to the code, and the second described a silent defect: a
 * layer declared in the `collection` dialect had NO offline capability at all, with nothing
 * saying so. A test faithful to a wrong behaviour is indistinguishable from a right one —
 * and it occupies the place.
 *
 * The rule is now a CAPABILITY question asked before the write:
 * `Storage.canQueueWrites(layerId)` — "can this device HOLD the write?". Yes → the queue,
 * online or not. No → the direct path, because there is nowhere to hold anything.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPersistenceAdapter } from "../persistence/adapter-factory.js";
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

describe("createPersistenceAdapter — le routage se décide sur la CAPACITÉ", () => {
    /** Declares whether the core can (or cannot) hold the layer's writes. */
    const coreCanQueue = (can: boolean) => {
        (globalThis as any).GeoLeaf.Storage.canQueueWrites = () => can;
    };

    it("offline → la file, sans réseau", async () => {
        const adapter = createPersistenceAdapter(cfg("offline"));
        expect(adapter.isOnline()).toBe(false);
        await adapter.save(FEATURE, "L");
        expect(applyEdit).toHaveBeenCalledOnce();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("online → le chemin direct : l'intégrateur déclare n'avoir pas de magasin local", async () => {
        const adapter = createPersistenceAdapter(cfg("online"));
        await adapter.save(FEATURE, "L");
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(applyEdit).not.toHaveBeenCalled();
    });

    it("🛑 auto + le core sait porter → la FILE, alors même que le réseau est là", async () => {
        // THE REVERSAL. The old rule probed reachability and went straight out: that is the
        // path which put no client identity on the wire, and which — on a lost response —
        // fell back into the queue with an identity the first request never carried. The
        // server had no key with which to recognise the duplicate.
        coreCanQueue(true);
        const adapter = createPersistenceAdapter(cfg("auto"));
        await adapter.save(FEATURE, "L");

        expect(applyEdit).toHaveBeenCalledOnce();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("auto + le core ne sait PAS porter → le chemin direct", async () => {
        coreCanQueue(false);
        const adapter = createPersistenceAdapter(cfg("auto"));
        await adapter.save(FEATURE, "L");

        expect(fetchMock).toHaveBeenCalled();
        expect(applyEdit).not.toHaveBeenCalled();
    });

    it("🛑 le dialecte `collection` ne force PLUS le direct — il n'en avait pas le droit", async () => {
        // A layer so declared had no offline capability at all, IN SILENCE: the routing
        // returned the online adapter whatever the mode. A dialect describes a wire format,
        // not the presence of a local store.
        coreCanQueue(true);
        const adapter = createPersistenceAdapter(cfg("auto", "collection"));
        await adapter.save(FEATURE, "L");

        expect(applyEdit).toHaveBeenCalledOnce();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("après une mise en file, un drain est DEMANDÉ — sinon la saisie attend un tic", async () => {
        coreCanQueue(true);
        const requested: string[] = [];
        (globalThis as any).GeoLeaf.Storage._requestOutboxDrain = (c: string) => requested.push(c);
        const adapter = createPersistenceAdapter(cfg("auto"));

        await adapter.save(FEATURE, "L");

        expect(requested).toEqual(["write"]);
    });
});

describe("l'adaptateur en ligne, par la porte publique", () => {
    // ⚠️ Went through `createOnlineAdapter` directly until 2026-09-05. It is no longer an
    // export: its last production importer (`entry.ts`, for a replay collaborator that was
    // never read) left with the in-core drain. The property under test is the same — the
    // default dialect wires REST — and it now goes through the factory, which is the door
    // production uses.
    it("le dialecte par défaut câble bien REST", async () => {
        const adapter = createPersistenceAdapter(cfg("online"));
        await adapter.save(FEATURE, "L");
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain("/features");
        expect(init.method).toBe("POST");
    });
});
