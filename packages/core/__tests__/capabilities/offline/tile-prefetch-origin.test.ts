/**
 * Witness — the offline preparation only downloads what an origin allows to be downloaded
 * AHEAD of use.
 *
 * ## What this file pins
 *
 * The deliberate download (`CacheManager.cacheProfile` → `ResourceEnumerator` → `Downloader`)
 * fetched every tile of every basemap flagged `offline: true`, whatever its origin: the only
 * check on that path was the URL scheme. A profile following the published guides — an
 * OpenStreetMap raster at `offline: true` — therefore offered a "download for offline" button
 * over `tile.openstreetmap.org`, whose usage policy says, verbatim, "Offline use is not
 * permitted on tile.openstreetmap.org".
 *
 * The rule: a resource of a basemap or of a tiled layer enters the download when its URL is
 * on the page's own origin, or when its origin is declared in `modules.offline.dataOrigins`
 * with `cacheable: true` AND `prefetch: true`. The two flags are distinct on purpose —
 * caching what was already served is what tile providers ask for, downloading ahead of use is
 * what some of them forbid — and the second case below is the one that holds them apart.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));

vi.mock("../../../src/capabilities/offline/config-seam.js", () => ({
    coreConfigGet: vi.fn((key: string, fallback: unknown) =>
        key in config.values ? config.values[key] : fallback
    ),
}));
vi.mock("../../../src/capabilities/offline/cache/storage.js", () => ({
    CacheStorage: { loadLayerSelection: vi.fn(async () => null) },
}));
// The calculator builds a CONCRETE tile URL from the template, as the real one does (`{s}` → a).
vi.mock("../../../src/capabilities/offline/cache/calculator.js", () => ({
    CacheCalculator: {
        enumerateTiles: vi.fn(async (cfg: { url?: string }) => [
            {
                url: String(cfg.url)
                    .replace("{s}", "a")
                    .replace("{z}", "1")
                    .replace("{x}", "2")
                    .replace("{y}", "3"),
                type: "tile",
            },
        ]),
    },
}));
vi.mock("../../../src/capabilities/offline/cache/style-resolver.js", () => ({
    StyleResolver: {
        enumerate: vi.fn(async (styleUrl: string) => [
            { url: styleUrl, type: "style" },
            { url: "https://tiles.vendor.test/1/2/3.pbf", type: "tile" },
            { url: "https://fonts.other.test/Noto/0-255.pbf", type: "glyph" },
        ]),
    },
}));
vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { ResourceEnumerator } =
    await import("../../../src/capabilities/offline/cache/resource-enumerator.ts");
const { StyleResolver } = await import("../../../src/capabilities/offline/cache/style-resolver.js");
const { Log } = await import("../../../src/utils/log/index.js");

type Resource = { url: string; type: string };

const OSM = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ORIGIN = "https://a.tile.openstreetmap.org";

/** Declares a profile: its basemaps, its tile flag and its origin declarations. */
function profile(basemaps: Record<string, unknown>, dataOrigins?: unknown[]): void {
    config.values = {
        basemaps,
        "modules.offline.cache.enableTileCache": true,
        ...(dataOrigins ? { "modules.offline.dataOrigins": dataOrigins } : {}),
    };
}

async function basemapResources(): Promise<Resource[]> {
    const resources: Resource[] = [];
    await ResourceEnumerator._addBasemapResources(resources, "p", null);
    return resources;
}

/** Every warning line, joined — the assertions read what an integrator reads. */
function warnings(): string {
    return vi
        .mocked(Log.warn)
        .mock.calls.map((call) => call.join(" "))
        .join("\n");
}

beforeEach(() => {
    vi.clearAllMocks();
    config.values = {};
});

describe("a raster basemap on a third-party origin", () => {
    it("is not downloaded when its origin is undeclared, and the refusal names the origin", async () => {
        profile({ osm: { id: "osm", offline: true, url: OSM } });

        const resources = await basemapResources();

        expect(resources.map((r) => r.url)).not.toContain(`${OSM_ORIGIN}/1/2/3.png`);
        expect(warnings()).toContain(OSM_ORIGIN);
        expect(warnings()).toContain("prefetch");
    });

    it("is not downloaded when declared `cacheable` only — caching is not preparing", async () => {
        profile({ osm: { id: "osm", offline: true, url: OSM } }, [
            { origin: OSM_ORIGIN, roles: ["tiles"], cacheable: true },
        ]);

        const resources = await basemapResources();

        expect(resources).toEqual([]);
    });

    it("is downloaded when its origin is declared `prefetch: true`", async () => {
        profile(
            {
                own: {
                    id: "own",
                    offline: true,
                    url: "https://tiles.example.test/{z}/{x}/{y}.png",
                },
            },
            [
                {
                    origin: "https://tiles.example.test",
                    roles: ["tiles"],
                    cacheable: true,
                    prefetch: true,
                },
            ]
        );

        const resources = await basemapResources();

        expect(resources.map((r) => r.url)).toEqual(["https://tiles.example.test/1/2/3.png"]);
    });

    it("is not downloaded when the declaration is `authenticated`, whatever it says", async () => {
        profile(
            {
                own: {
                    id: "own",
                    offline: true,
                    url: "https://tiles.example.test/{z}/{x}/{y}.png",
                },
            },
            [
                {
                    origin: "https://tiles.example.test",
                    roles: ["tiles"],
                    cacheable: true,
                    prefetch: true,
                    authenticated: true,
                },
            ]
        );

        expect(await basemapResources()).toEqual([]);
    });
});

describe("a basemap served by the application's own origin", () => {
    it("is downloaded without any declaration — no third party is involved", async () => {
        profile({ own: { id: "own", offline: true, url: "tiles/{z}/{x}/{y}.png" } });

        const resources = await basemapResources();

        expect(resources.map((r) => r.url)).toEqual(["tiles/1/2/3.png"]);
    });
});

describe("a vector basemap", () => {
    it("on an undeclared origin: its style is not even fetched", async () => {
        profile({
            v: {
                id: "v",
                offline: true,
                type: "maplibre",
                style: "https://styles.vendor.test/s.json",
            },
        });

        const resources = await basemapResources();

        expect(StyleResolver.enumerate).not.toHaveBeenCalled();
        expect(resources).toEqual([]);
        expect(warnings()).toContain("https://styles.vendor.test");
    });

    it("on a declared origin: only the resources of prefetchable origins are kept", async () => {
        profile(
            {
                v: {
                    id: "v",
                    offline: true,
                    type: "maplibre",
                    style: "https://tiles.vendor.test/s.json",
                },
            },
            [
                {
                    origin: "https://tiles.vendor.test",
                    roles: ["tiles"],
                    cacheable: true,
                    prefetch: true,
                },
            ]
        );

        const resources = await basemapResources();

        expect(resources.map((r) => r.url)).toEqual([
            "https://tiles.vendor.test/s.json",
            "https://tiles.vendor.test/1/2/3.pbf",
        ]);
        expect(warnings()).toContain("https://fonts.other.test");
    });
});

describe("a tiled layer", () => {
    it("on an undeclared third-party origin: its tiles are not downloaded", async () => {
        profile({});
        const resources: Resource[] = [];

        await ResourceEnumerator._addLayerResources(
            resources,
            {
                layers: [
                    { id: "l1", type: "tile", url: "https://tiles.vendor.test/{z}/{x}/{y}.png" },
                ],
            },
            "p",
            "../profiles",
            null
        );

        expect(
            resources.some(
                (r) => r.type === "tile" && r.url.startsWith("https://tiles.vendor.test/1")
            )
        ).toBe(false);
        expect(warnings()).toContain("https://tiles.vendor.test");
    });
});
