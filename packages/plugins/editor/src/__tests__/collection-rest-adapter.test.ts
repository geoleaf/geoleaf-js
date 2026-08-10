/**
 * Tests for the collection-dialect REST adapter (OGC/PostgREST `{nom,is_public,geom}` contract).
 * Mocks fetch via the injected `fetchImpl`; covers the flat body shape, URL building,
 * geometryProperty, optional Authorization, error mapping and create-only update/delete.
 */
import { describe, it, expect, vi } from "vitest";
import { createCollectionRestAdapter } from "../persistence/collection-rest-adapter.js";
import { PersistenceError, type EditorFeature } from "../persistence/adapter-interface.js";

const FEATURE: EditorFeature = {
    geometry: { type: "Point", coordinates: [-52.33, 4.92] },
    properties: { nom: "Point démo", is_public: true },
};

function res(status: number, body = ""): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(body),
    } as unknown as Response;
}

describe("createCollectionRestAdapter — save (POST)", () => {
    it("POSTs to {baseUrl}/{layerId} with a flat {...props, geom} body", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(res(201, JSON.stringify({ id: 42 })));
        const adapter = createCollectionRestAdapter({
            baseUrl: "https://ogc.example.org/",
            timeoutMs: 5000,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        const saved = await adapter.save(FEATURE, "demo_qgis");

        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://ogc.example.org/demo_qgis");
        expect(init.method).toBe("POST");
        expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
        expect(JSON.parse(init.body as string)).toEqual({
            nom: "Point démo",
            is_public: true,
            geom: { type: "Point", coordinates: [-52.33, 4.92] },
        });
        expect(saved.id).toBe("42");
        expect(saved.layerId).toBe("demo_qgis");
    });

    it("honours a custom geometryProperty", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(res(200, "{}"));
        const adapter = createCollectionRestAdapter({
            baseUrl: "https://ogc.example.org",
            geometryProperty: "geometry",
            timeoutMs: 5000,
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        await adapter.save(FEATURE, "demo_qgis");
        const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(init.body as string);
        expect(body.geometry).toEqual(FEATURE.geometry);
        expect(body.geom).toBeUndefined();
    });

    it("omits Authorization by default (Connector injects it) and sets it when provided", async () => {
        const f1 = vi.fn().mockResolvedValue(res(200, "{}"));
        await createCollectionRestAdapter({
            baseUrl: "https://ogc.example.org",
            timeoutMs: 5000,
            fetchImpl: f1 as unknown as typeof fetch,
        }).save(FEATURE, "demo_qgis");
        expect(
            (f1.mock.calls[0][1] as RequestInit).headers as Record<string, string>
        ).not.toHaveProperty("Authorization");

        const f2 = vi.fn().mockResolvedValue(res(200, "{}"));
        await createCollectionRestAdapter({
            baseUrl: "https://ogc.example.org",
            authHeader: "Bearer tok",
            timeoutMs: 5000,
            fetchImpl: f2 as unknown as typeof fetch,
        }).save(FEATURE, "demo_qgis");
        expect(
            (f2.mock.calls[0][1] as RequestInit).headers as Record<string, string>
        ).toMatchObject({ Authorization: "Bearer tok" });
    });
});

describe("createCollectionRestAdapter — errors & create-only", () => {
    it("maps 4xx → client, 5xx → network", async () => {
        const c = createCollectionRestAdapter({
            baseUrl: "https://ogc.example.org",
            timeoutMs: 5000,
            fetchImpl: vi.fn().mockResolvedValue(res(403)) as unknown as typeof fetch,
        });
        await expect(c.save(FEATURE, "L")).rejects.toMatchObject({ kind: "client", status: 403 });

        const n = createCollectionRestAdapter({
            baseUrl: "https://ogc.example.org",
            timeoutMs: 5000,
            fetchImpl: vi.fn().mockResolvedValue(res(500)) as unknown as typeof fetch,
        });
        await expect(n.save(FEATURE, "L")).rejects.toBeInstanceOf(PersistenceError);
    });

    it("rejects update() and delete() (create-only milestone)", async () => {
        const adapter = createCollectionRestAdapter({
            baseUrl: "https://ogc.example.org",
            timeoutMs: 5000,
            fetchImpl: vi.fn() as unknown as typeof fetch,
        });
        await expect(adapter.update(FEATURE, "L")).rejects.toBeInstanceOf(PersistenceError);
        await expect(adapter.delete("1", "L")).rejects.toBeInstanceOf(PersistenceError);
    });
});
