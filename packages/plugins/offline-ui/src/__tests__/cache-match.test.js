/**
 * PLUGINS S7 — cached-resource matching.
 *
 * These tests exist for ONE reason: the sprint changed a user-visible verdict.
 * `isBasemapCached` used to answer `true` for every basemap as soon as any
 * cached url contained the substring "tile", so a single downloaded tile turned
 * the whole column green. The replacement matches on prefixes derived from the
 * basemap's own declaration, and that derivation makes assumptions about how
 * the core builds tile urls — those assumptions are what is pinned here.
 *
 * Url shapes below are taken verbatim from `profiles/**\/basemaps.json`.
 */

import {
    basemapUrlPrefixes,
    matchesBasemap,
    matchesLayer,
    normalizeResourceUrl,
} from "../cache/layer-selector/cache-match.js";

describe("normalizeResourceUrl", () => {
    test("strips query and hash, folds backslashes and duplicate slashes", () => {
        expect(normalizeResourceUrl("profiles\\demo//layers/a.geojson?v=2#x")).toBe(
            "profiles/demo/layers/a.geojson"
        );
    });

    test("preserves the double slash of a scheme", () => {
        expect(normalizeResourceUrl("https://host/a")).toBe("https://host/a");
    });
});

describe("basemapUrlPrefixes", () => {
    test("substitutes {s} with 'a' like CacheCalculator.buildTileUrl does", () => {
        // Without the substitution the prefix would stop at "https://", which
        // matches every https url in the manifest.
        expect(
            basemapUrlPrefixes({
                url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
            })
        ).toEqual(["https://a.basemaps.cartocdn.com/light_all/"]);
    });

    test("handles a template with no {s}", () => {
        expect(
            basemapUrlPrefixes({
                url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
            })
        ).toEqual(["https://basemaps.cartocdn.com/light_all/"]);
    });

    test("accepts an array of templates (subdomain rotation)", () => {
        expect(
            basemapUrlPrefixes({
                url: [
                    "https://a.tiles.example.com/voyager/{z}/{x}/{y}.png",
                    "https://b.tiles.example.com/voyager/{z}/{x}/{y}.png",
                ],
            })
        ).toEqual(["https://a.tiles.example.com/voyager/", "https://b.tiles.example.com/voyager/"]);
    });

    test("uses the style ORIGIN for a vector basemap (no url at all)", () => {
        // IGN Plan: type "maplibre", style on data.geopf.fr, no `url`. Its cached
        // resources are the style, glyphs, sprite and .pbf tiles — none of which
        // carry the basemap id.
        expect(
            basemapUrlPrefixes({
                style: "https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json",
            })
        ).toEqual(["https://data.geopf.fr"]);
    });

    test("keeps both the tile template and the style origin when both are declared", () => {
        expect(
            basemapUrlPrefixes({
                style: "https://data.geopf.fr/styles/standard.json",
                fallbackUrl: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
            })
        ).toEqual(["https://basemaps.cartocdn.com/light_all/", "https://data.geopf.fr"]);
    });

    test("yields nothing when the basemap declares neither url nor style", () => {
        expect(basemapUrlPrefixes({ id: "ign-wmts" })).toEqual([]);
    });

    test("rejects a prefix that is only a scheme", () => {
        // A template whose first placeholder is the host would otherwise produce
        // "https://" and match the entire manifest.
        expect(basemapUrlPrefixes({ url: "https://{host}/{z}/{x}/{y}.png" })).toEqual([]);
    });
});

describe("matchesBasemap", () => {
    const cartoTiles = [
        "https://a.basemaps.cartocdn.com/light_all/5/16/11@2x.png",
        "https://a.basemaps.cartocdn.com/light_all/5/16/12@2x.png",
    ];

    // The predicate as it stood before PLUGINS S7, reproduced verbatim so the
    // regression cases below can assert that it answered WRONG where the current
    // one answers right. Without this the "regression" tests would be green
    // against the old code too, and would document nothing.
    const legacyIsCached = (resourceUrls, basemap) => {
        const basemapId = (basemap.id || basemap.url || "").toString();
        return resourceUrls.some((url) => {
            const resourceUrl = url.replace(/\\/g, "/").toLowerCase();
            return resourceUrl.includes(basemapId.toLowerCase()) || resourceUrl.includes("tile");
        });
    };

    test("matches its own tiles", () => {
        const prefixes = basemapUrlPrefixes({
            url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        });
        expect(matchesBasemap(cartoTiles, prefixes)).toBe(true);
    });

    test("REGRESSION — another basemap's tiles no longer count as its own", () => {
        // Manifest holds OpenTopoMap tiles only. Their host contains "tile", which
        // is what the old fallback keyed on — so it reported the CartoDB basemap as
        // cached although not one of its tiles was ever downloaded.
        const manifest = [
            "https://a.tile.opentopomap.org/5/16/11.png",
            "https://a.tile.opentopomap.org/5/16/12.png",
        ];
        const carto = {
            id: "positron",
            url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        };

        expect(legacyIsCached(manifest, carto)).toBe(true); // the defect
        expect(matchesBasemap(manifest, basemapUrlPrefixes(carto))).toBe(false); // fixed
    });

    test("REGRESSION — a basemap with nothing to match on reports not-cached", () => {
        const manifest = ["https://tiles.mapterhorn.com/9/256/170.webp"];
        const wmts = { id: "ign-wmts" };

        expect(legacyIsCached(manifest, wmts)).toBe(true); // the defect
        expect(matchesBasemap(manifest, basemapUrlPrefixes(wmts))).toBe(false); // fixed
    });

    test("REGRESSION — a vector basemap is not turned green by a raster basemap's tiles", () => {
        const manifest = ["https://tiles.mapterhorn.com/9/256/170.webp"];
        const ignPlan = {
            id: "ign-plan",
            style: "https://data.geopf.fr/annexes/styles/standard.json",
        };

        expect(legacyIsCached(manifest, ignPlan)).toBe(true); // the defect
        expect(matchesBasemap(manifest, basemapUrlPrefixes(ignPlan))).toBe(false); // fixed
    });

    test("a vector basemap matches the resources of its own style origin", () => {
        const prefixes = basemapUrlPrefixes({
            style: "https://data.geopf.fr/annexes/styles/standard.json",
        });
        expect(
            matchesBasemap(["https://data.geopf.fr/tms/pyramide/12/2048/1024.pbf"], prefixes)
        ).toBe(true);
        expect(matchesBasemap(cartoTiles, prefixes)).toBe(false);
    });
});

describe("matchesLayer", () => {
    const search = [
        "profiles/demo/layers/roads/roads.geojson",
        "../profiles/demo/layers/roads/roads.geojson",
    ];

    test("matches an absolute cached url ending on the layer path", () => {
        expect(
            matchesLayer(["https://host/app/profiles/demo/layers/roads/roads.geojson"], search)
        ).toBe(true);
    });

    test("matches the ../-prefixed spelling", () => {
        expect(matchesLayer(["../profiles/demo/layers/roads/roads.geojson"], search)).toBe(true);
    });

    test("REGRESSION — a SHORTER cached url no longer matches a longer layer path", () => {
        // The old test was bidirectional (`searchUrl.includes(resourceUrl)`), so a
        // cached directory-ish entry counted as a cached layer file.
        expect(matchesLayer(["profiles/demo/layers/roads/"], search)).toBe(false);
    });

    test("does not match a different layer sharing a prefix", () => {
        expect(
            matchesLayer(["https://host/profiles/demo/layers/roads/roads-old.geojson"], search)
        ).toBe(false);
    });

    test("no search url means not cached", () => {
        expect(matchesLayer(["https://host/anything.geojson"], [])).toBe(false);
    });
});
