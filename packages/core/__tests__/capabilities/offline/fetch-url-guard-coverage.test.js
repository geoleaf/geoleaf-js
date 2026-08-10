import { StyleResolver } from "../../../src/capabilities/offline/cache/style-resolver.js";
import { CacheCalculator } from "../../../src/capabilities/offline/cache/calculator.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Unit tests — every fetch reachable from remote content is scheme-guarded (CAPACITÉS B.10).
 *
 * `validateFetchUrl` rejects any absolute URL that is not http(s) — `javascript:`,
 * `data:`, `blob:`, `file:`. It was wired into FetchManager, CacheStorage and
 * CacheMetrics but NOT into two sites that fetch URLs derived from REMOTE content:
 *
 *   - `cache/style-resolver.ts:_fetchJson` — fetches the basemap style URL AND, from
 *     inside that style document, `source.url` (a TileJSON reference). The second one
 *     is attacker-controlled the moment the style JSON is: a hostile `source.url` went
 *     straight to `fetch()`.
 *   - `cache/calculator.ts:calculateProfileBounds` — fetches `resource.url` off the
 *     enumerated resource list, which StyleResolver feeds from that same TileJSON.
 *
 * A blocked URL is NOT a network failure, but both call sites already degrade
 * gracefully on failure and the enumeration must not abort on one poisoned entry, so
 * the block is logged and skipped — the pattern `cache/metrics.ts:50` already uses.
 * What is asserted here is the security property: `fetch` is never reached.
 *
 * ⚠️ Two further fetch sites are deliberately NOT guarded — see the last describe.
 */

const BLOCKED = [
    "javascript:alert(1)",
    "data:text/html,<h1>x</h1>",
    "file:///etc/passwd",
    "blob:https://evil.test/1234",
];

describe("B.10 — scheme guard on the remaining fetch sites", () => {
    let realFetch;

    beforeAll(() => {
        realFetch = global.fetch;
    });

    afterAll(() => {
        global.fetch = realFetch;
    });

    beforeEach(() => {
        global.fetch = vi.fn();
    });

    describe("StyleResolver._fetchJson", () => {
        test.each(BLOCKED)("never fetches %s", async (url) => {
            const result = await StyleResolver._fetchJson(url);

            expect(global.fetch).not.toHaveBeenCalled();
            expect(result).toBeNull();
        });

        test("http(s) and relative URLs still go through", async () => {
            global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: 1 }) });

            await expect(
                StyleResolver._fetchJson("https://tiles.test/style.json")
            ).resolves.toEqual({ ok: 1 });
            await expect(StyleResolver._fetchJson("../profiles/p/style.json")).resolves.toEqual({
                ok: 1,
            });
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });

        test("a hostile TileJSON `source.url` inside a fetched style never reaches fetch", async () => {
            // First call returns the style; the source.url it declares is hostile.
            global.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    sources: { evil: { type: "vector", url: "javascript:alert(1)" } },
                }),
            });

            const resources = await StyleResolver.enumerate("https://tiles.test/style.json", {
                bounds: { north: 1, south: 0, east: 1, west: 0 },
                cacheMinZoom: 1,
                cacheMaxZoom: 1,
            });

            // Only the style itself was fetched — the TileJSON reference was refused.
            expect(global.fetch).toHaveBeenCalledTimes(1);
            // L'init porte un `signal` depuis 3.8 : ce test vérifie l'URL qui ATTEINT
            // `fetch` (garde de schéma B.10), pas la forme de l'init.
            expect(global.fetch).toHaveBeenCalledWith(
                "https://tiles.test/style.json",
                expect.anything()
            );
            // The style document itself is still enumerated; no tiles came out of it.
            expect(resources.map((r) => r.type)).toEqual(["style"]);
        });
    });

    describe("CacheCalculator.calculateProfileBounds", () => {
        test.each(BLOCKED)("never fetches %s", async (url) => {
            const bounds = await CacheCalculator.calculateProfileBounds({}, [
                { type: "layer", url },
            ]);

            expect(global.fetch).not.toHaveBeenCalled();
            expect(bounds).toBeNull();
        });

        test("a blocked entry does not abort the scan of the remaining layers", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                headers: { get: () => "application/json" },
                json: async () => ({
                    type: "FeatureCollection",
                    features: [{ geometry: { type: "Point", coordinates: [2, 48] } }],
                }),
            });

            const bounds = await CacheCalculator.calculateProfileBounds({}, [
                { type: "layer", url: "javascript:alert(1)" },
                { type: "layer", url: "https://ok.test/layer.geojson" },
            ]);

            expect(global.fetch).toHaveBeenCalledTimes(1);
            // L'init porte un `signal` depuis 3.8 : ce test vérifie l'URL qui ATTEINT
            // `fetch` (garde de schéma B.10), pas la forme de l'init.
            expect(global.fetch).toHaveBeenCalledWith(
                "https://ok.test/layer.geojson",
                expect.anything()
            );
            expect(bounds).not.toBeNull();
        });
    });

    /**
     * The two sites left unguarded, and why. These are assertions on the REASON, so the
     * verdict cannot quietly rot into an oversight.
     */
    describe("deliberately NOT guarded", () => {
        test("ResourceEnumerator's config fetch cannot carry a scheme at all", async () => {
            const { ResourceEnumerator } = await import(
                "../../../src/capabilities/offline/cache/resource-enumerator.js"
            );
            global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

            const resources = [];
            await ResourceEnumerator._addLayerResources(
                resources,
                { layers: [{ id: "l1", configFile: "javascript:alert(1)" }] },
                "tourism",
                "../profiles",
                null
            );

            // The URL is ALWAYS `${basePath}/${profileId}/${configFile}` — the field can
            // never occupy position 0, so it can never set the scheme. `validateFetchUrl`
            // only rejects schemes: a guard here could never fire. The one prefix that
            // could (`basePath`) is validated upstream, on this very code path, by
            // CacheStorage.loadProfileConfig — which builds the same string.
            // L'init porte un `signal` depuis 3.8 : ce test vérifie l'URL qui ATTEINT
            // `fetch` (garde de schéma B.10), pas la forme de l'init.
            expect(global.fetch).toHaveBeenCalledWith(
                "../profiles/tourism/javascript:alert(1)",
                expect.anything()
            );
        });

        test("profile-icons takes its guard by injection — the frontier forbids importing it", () => {
            const source = readFileSync(
                resolve(__dirname, "../../../src/capabilities/offline/cache/profile-icons.ts"),
                "utf8"
            );

            // `profile-icons.ts` sits at the offline capability ROOT, i.e. in the boot
            // closure, while `url-guard.ts` lives under `cache/` — an ENGINE module.
            // A static import would break frontier.guard.test.js. Hence the injected
            // `opts.validateUrl`, which the one production caller (cache/storage.ts)
            // supplies as validateFetchUrl. The site IS guarded on the download path.
            expect(source).not.toMatch(/from\s+["'].*url-guard\.js["']/);
            expect(source).toMatch(/opts\.validateUrl\?\.\(url\)/);

            const caller = readFileSync(
                resolve(__dirname, "../../../src/capabilities/offline/cache/storage.ts"),
                "utf8"
            );
            expect(caller).toMatch(/resolveProfileIcons\([\s\S]*?validateUrl:\s*validateFetchUrl/);
        });
    });
});
