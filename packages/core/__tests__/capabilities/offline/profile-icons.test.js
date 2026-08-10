/**
 * Regression tests for C-7 — the profile sprite was NEVER cached for offline use.
 *
 * The bug: `resource-enumerator._addSpriteResources` read `profile.icons?.spriteUrl`,
 * a key of the PRE-taxonomy-v3 profile layout. Since the v2 layout the sprite lives at
 * the root of the file behind `Files.modules.taxonomy` (`config/plugins/taxonomy.json`),
 * so `profile.icons` was always `undefined` → early-return → no icon resource, on all 9
 * profiles, silently, with zero test coverage. Same motif as the already-fixed
 * `profile.layers` bug (cf. plugin-storage cache-modal-import.test.js).
 *
 * These tests must FAIL without the fix. The one that matters is
 * "regression: a v2 profile yields the sprite" — it is the exact production shape.
 *
 * Loaded via ESM `await import()` — never `require(".ts")` (non-merged V8 coverage).
 * The specifiers end in `.js`, NOT `.ts`: the source imports each other through `.js`
 * (ESM/NodeNext), and V8 keys coverage by resolved path — importing `.ts` here would
 * register a SECOND module instance, splitting the report (profile-icons showed 0%
 * functions while its 13 tests were green) and dragging the global threshold under.
 */
"use strict";

// CacheStorage pulls in the IndexedDB layer (~530 lines) purely as an import; nothing
// here touches a database — loadProfileConfig only fetches and reconciles JSON. Mocking
// it at the boundary keeps the unit honest AND keeps 500 untested lines out of this
// file's coverage footprint, which is not what these tests are about.
vi.mock("../../../src/capabilities/offline/db/indexeddb.js", () => ({
    IndexedDB: {
        init: vi.fn(async () => undefined),
        get: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        getAll: vi.fn(async () => []),
    },
}));

const { resolveProfileIcons } = await import(
    "../../../src/capabilities/offline/cache/profile-icons.js"
);
const { ResourceEnumerator } = await import(
    "../../../src/capabilities/offline/cache/resource-enumerator.js"
);

/** The real shape of profiles/tourism/profile.json (v2 layout): pointers, no data. */
const V2_PROFILE = Object.freeze({
    id: "tourism",
    Files: {
        layersFile: "config/core/layers.json",
        modules: {
            taxonomy: "config/plugins/taxonomy.json",
            cluster: "config/plugins/cluster.json",
        },
    },
});

/** The real shape of profiles/tourism/config/plugins/taxonomy.json. */
const TAXONOMY_FILE = Object.freeze({
    enabled: true,
    icons: { spriteUrl: "../profiles/tourism/icons/sprite_tourism.svg", symbolPrefix: "poi-" },
    taxonomies: {},
});

function mockFetchOnce(body, ok = true, status = 200) {
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok,
        status,
        json: async () => body,
    });
}

afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.fetch;
});

describe("resolveProfileIcons — reconciles the v2 layout", () => {
    test("regression (C-7): resolves the sprite from Files.modules.taxonomy", async () => {
        mockFetchOnce(TAXONOMY_FILE);

        const icons = await resolveProfileIcons(V2_PROFILE, "tourism", "../profiles");

        expect(icons).not.toBeNull();
        expect(icons.spriteUrl).toBe("../profiles/tourism/icons/sprite_tourism.svg");
        // Second argument depuis 3.8 : la requête est bornée.
        expect(globalThis.fetch).toHaveBeenCalledWith(
            "../profiles/tourism/config/plugins/taxonomy.json",
            expect.anything()
        );
    });

    test("returns an already-inlined icons block without fetching (forward-compat)", async () => {
        globalThis.fetch = vi.fn();
        const inlined = {
            icons: { spriteUrl: "./x.svg" },
            Files: { modules: { taxonomy: "t.json" } },
        };

        const icons = await resolveProfileIcons(inlined, "p", "../profiles");

        expect(icons).toEqual({ spriteUrl: "./x.svg" });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test("honours the runtime gate: enabled:false loads no sprite, so caches none", async () => {
        // Mirrors Taxonomy.getIcons() → `cfg.enabled === false ? null : cfg.icons`.
        mockFetchOnce({ ...TAXONOMY_FILE, enabled: false });

        expect(await resolveProfileIcons(V2_PROFILE, "tourism", "../profiles")).toBeNull();
    });

    test("enabled absent means enabled (opt-out), like getTaxonomyConfig defaults", async () => {
        mockFetchOnce({ icons: { spriteUrl: "../profiles/p/s.svg" } });

        const icons = await resolveProfileIcons(V2_PROFILE, "p", "../profiles");

        expect(icons?.spriteUrl).toBe("../profiles/p/s.svg");
    });

    test("no taxonomy entry in the manifest → null, no fetch", async () => {
        globalThis.fetch = vi.fn();

        expect(
            await resolveProfileIcons({ Files: { modules: {} } }, "p", "../profiles")
        ).toBeNull();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test("never throws: an HTTP error resolves to null", async () => {
        mockFetchOnce(null, false, 404);

        expect(await resolveProfileIcons(V2_PROFILE, "tourism", "../profiles")).toBeNull();
    });

    test("never throws: a network failure resolves to null", async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));

        expect(await resolveProfileIcons(V2_PROFILE, "tourism", "../profiles")).toBeNull();
    });

    test("runs the caller's URL guard before fetching", async () => {
        mockFetchOnce(TAXONOMY_FILE);
        const validateUrl = vi.fn();

        await resolveProfileIcons(V2_PROFILE, "tourism", "../profiles", { validateUrl });

        expect(validateUrl).toHaveBeenCalledWith(
            "../profiles/tourism/config/plugins/taxonomy.json"
        );
    });

    test("a rejecting URL guard resolves to null instead of throwing", async () => {
        mockFetchOnce(TAXONOMY_FILE);
        const validateUrl = vi.fn(() => {
            throw new Error("blocked");
        });

        expect(
            await resolveProfileIcons(V2_PROFILE, "tourism", "../profiles", { validateUrl })
        ).toBeNull();
    });
});

describe("_addSpriteResources — requests the same URL as the runtime", () => {
    test("regression (C-7): a resolved icons block yields an icon resource", () => {
        const resources = [];

        ResourceEnumerator._addSpriteResources(resources, {
            icons: { spriteUrl: "../profiles/tourism/icons/sprite_tourism.svg" },
        });

        expect(resources).toEqual([
            {
                url: "../profiles/tourism/icons/sprite_tourism.svg",
                type: "icon",
                priority: 2,
            },
        ]);
    });

    test("takes the URL VERBATIM — no basePath rewriting", () => {
        // The runtime loader (_getSpriteUrl → _fetchAndInjectSprite) fetches spriteUrl
        // as-is. france-urbanisme-btp declares a non-"../" path; prefixing it would cache
        // a key the runtime never requests → a cache that never hits.
        const resources = [];

        ResourceEnumerator._addSpriteResources(resources, {
            icons: { spriteUrl: "profiles/france-urbanisme-btp/icons/sprite_urbanisme.svg" },
        });

        expect(resources[0].url).toBe("profiles/france-urbanisme-btp/icons/sprite_urbanisme.svg");
    });

    test("no icons block → no resource (the pre-fix state, now unreachable in prod)", () => {
        const resources = [];

        ResourceEnumerator._addSpriteResources(resources, { id: "tourism" });

        expect(resources).toEqual([]);
    });

    test("ignores a non-string spriteUrl", () => {
        const resources = [];

        ResourceEnumerator._addSpriteResources(resources, { icons: { spriteUrl: 42 } });

        expect(resources).toEqual([]);
    });
});

describe("loadProfileConfig — hydrates icons onto the profile (the fixed seam)", () => {
    // THE test of this fix. _addSpriteResources always read `profile.icons`; what was
    // broken is that NOBODY ever put it there. This asserts the seam that feeds it —
    // remove the hydration in storage.ts and this goes red, while the tests above stay
    // green. That asymmetry is exactly why the bug survived.
    test("regression (C-7): a served v2 profile.json comes back WITH icons", async () => {
        const { CacheStorage } = await import("../../../src/capabilities/offline/cache/storage.js");

        globalThis.fetch = vi.fn(async (url) => {
            if (String(url).endsWith("profile.json")) {
                return { ok: true, status: 200, json: async () => structuredClone(V2_PROFILE) };
            }
            if (String(url).endsWith("config/plugins/taxonomy.json")) {
                return { ok: true, status: 200, json: async () => TAXONOMY_FILE };
            }
            // layers.json — resolved by the sibling `layers` seam, not under test here.
            return { ok: true, status: 200, json: async () => ({ layers: [] }) };
        });

        const profile = await CacheStorage.loadProfileConfig("tourism");

        expect(profile.icons).toBeDefined();
        expect(profile.icons.spriteUrl).toBe("../profiles/tourism/icons/sprite_tourism.svg");
    });

    test("a taxonomy-less profile still loads (icons simply absent)", async () => {
        const { CacheStorage } = await import("../../../src/capabilities/offline/cache/storage.js");

        globalThis.fetch = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ id: "bare", Files: { layersFile: "config/core/layers.json" } }),
        }));

        const profile = await CacheStorage.loadProfileConfig("bare");

        expect(profile.id).toBe("bare");
        expect(profile.icons).toBeUndefined();
    });
});
