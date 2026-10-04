/**
 * `persistence/storage-seam.ts` — the entity read.
 *
 * The seam resolves `GeoLeaf.Storage` at CALL time and copes with its absence. What is pinned
 * here is the one reader that crosses into a database module: every way the store can fail to
 * answer must come back as `null`, never as a throw — its caller reads `null` as "nothing to
 * reconcile" and moves on.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

import { readStoredEntity } from "../persistence/storage-seam.js";

function mountDb(db: unknown): void {
    (globalThis as Record<string, unknown>).GeoLeaf = { Storage: { DB: db } };
}

afterEach(() => {
    delete (globalThis as Record<string, unknown>).GeoLeaf;
});

describe("readStoredEntity", () => {
    it("rend l'entité que le module `Features` tient sous cette clé", async () => {
        const record = { feature: { properties: { galerie: ["gl-img:a"] } } };
        const get = vi.fn(() => Promise.resolve(record));
        const ensure = vi.fn((name: string) => (name === "Features" ? { get } : null));
        mountDb({ _ensureModule: ensure });

        await expect(readStoredEntity("sites", "loc:g1")).resolves.toBe(record);
        expect(ensure).toHaveBeenCalledWith("Features");
        expect(get).toHaveBeenCalledWith("sites", "loc:g1");
    });

    it("rend `null` quand l'entité n'est plus dans le magasin", async () => {
        mountDb({ _ensureModule: () => ({ get: () => Promise.resolve(null) }) });
        await expect(readStoredEntity("sites", "loc:gone")).resolves.toBeNull();
    });

    it("rend `null` sans `GeoLeaf.Storage`, sans module, ou sans lecture", async () => {
        await expect(readStoredEntity("sites", "loc:g1")).resolves.toBeNull();
        mountDb({});
        await expect(readStoredEntity("sites", "loc:g1")).resolves.toBeNull();
        mountDb({ _ensureModule: () => null });
        await expect(readStoredEntity("sites", "loc:g1")).resolves.toBeNull();
        mountDb({ _ensureModule: () => ({}) });
        await expect(readStoredEntity("sites", "loc:g1")).resolves.toBeNull();
    });
});
