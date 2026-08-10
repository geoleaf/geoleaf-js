/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage - Style Resolver (S3 vector offline)
 *
 * Resolves a MapLibre style into the concrete set of resources required to
 * render the basemap offline:
 *  - the style JSON itself
 *  - vector tiles (.pbf) enumerated over a bbox + zoom ceiling (overzoom-aware)
 *  - glyph ranges ({fontstack}/{range}.pbf) for the fonts used by the style
 *  - sprite sheet (.json + .png, plus @2x variants)
 *
 * Tile math is delegated to CacheCalculator (shared with the raster path).
 *
 * @version 1.0.0
 */
"use strict";

import { Log } from "../../../utils/log/index.js";
import { fetchBounded } from "../../../utils/general/fetch-bounded.js";
import { CacheCalculator } from "./calculator.js";
import { validateFetchUrl } from "./url-guard.js";

/**
 * Glyph ranges cached per fontstack. Each range is a 256-codepoint block:
 *  - 0-255   : Basic Latin + Latin-1 Supplement (French accents é è à ç)
 *  - 256-511 : Latin Extended-A / B
 *  - 768-1023: Combining diacritics + Greek/Cyrillic start
 * Covers French/European labels without caching all 256 ranges. Tunable.
 */
const GLYPH_RANGES = ["0-255", "256-511", "768-1023"];

/** Default source maxzoom when a TileJSON omits it. */
const DEFAULT_SOURCE_MAXZOOM = 14;

interface ResolverBounds {
    north: number;
    south: number;
    east: number;
    west: number;
}

/**
 * One geographic area to cache, with the zoom range to cache it at.
 *
 * The zoom bounds are carried by the zone rather than by the profile because a single profile
 * can cache a city centre deeply and its outskirts shallowly. Both are inclusive.
 */
export interface ResolverZone {
    bounds: ResolverBounds;
    cacheMinZoom: number;
    cacheMaxZoom: number;
}

interface StyleResource {
    url: string;
    type: string;
    priority?: number;
    optional?: boolean;
    x?: number;
    y?: number;
    z?: number;
}

interface MapLibreSource {
    type?: string;
    url?: string;
    tiles?: string[];
    maxzoom?: number;
}

interface MapLibreLayer {
    layout?: { "text-font"?: string[] } & Record<string, unknown>;
}

interface MapLibreStyle {
    sources?: Record<string, MapLibreSource>;
    layers?: MapLibreLayer[];
    glyphs?: string;
    sprite?: string;
}

const StyleResolver = {
    GLYPH_RANGES,

    /**
     * Enumerates every offline resource for a MapLibre vector style.
     * Network failures degrade gracefully (a sub-step returning nothing never
     * aborts the others); the caller decides whether the partial set is usable.
     *
     * @param styleUrl Absolute URL of the style JSON.
     * @param zone bbox + zoom ceiling chosen by the user (null → tiles skipped).
     */
    async enumerate(styleUrl: string, zone: ResolverZone | null): Promise<StyleResource[]> {
        const resources: StyleResource[] = [];

        const style = await this._fetchStyle(styleUrl);
        if (!style) {
            Log.warn(`[StyleResolver] Could not fetch style: ${styleUrl}`);
            return resources;
        }

        // The style JSON itself — MapLibre refetches it by exact URL offline.
        resources.push({ url: styleUrl, type: "style", priority: 2 });

        // Vector tiles (.pbf) for each vector source.
        if (zone) {
            const tiles = await this._enumerateVectorTiles(style, styleUrl, zone);
            resources.push(...tiles);
        } else {
            Log.warn("[StyleResolver] No zone provided — vector tiles skipped");
        }

        // Glyphs + sprite (independent of the zone).
        resources.push(...this._enumerateGlyphs(style, styleUrl));
        resources.push(...this._enumerateSprite(style, styleUrl));

        Log.info(
            `[StyleResolver] Enumerated ${resources.length} resources for ${styleUrl}` +
                ` (${resources.filter((r) => r.type === "tile").length} tiles)`
        );
        return resources;
    },

    /**
     * Fetches and parses a JSON document, returning null on any failure.
     *
     * The URL is scheme-guarded first. This is not defence in depth: `_fetchJson` is
     * called BOTH with the style URL from config AND with `source.url` read out of that
     * fetched style — i.e. with remote content. A hostile style could therefore point
     * `source.url` at `javascript:`/`data:` and have it fetched (CAPACITÉS B.10).
     *
     * A refusal is logged and mapped to `null`, like every other failure here: the
     * enumeration of the other sources must not abort over one poisoned entry. Same
     * shape as `cache/metrics.ts:_fetchHeadContentLengths`.
     */
    async _fetchJson<T>(url: string): Promise<T | null> {
        try {
            validateFetchUrl(url);
        } catch (error) {
            Log.warn(`[StyleResolver] URL blocked, skipping: ${(error as Error).message}`);
            return null;
        }

        try {
            const response = await fetchBounded(url);
            if (!response.ok) {
                Log.warn(`[StyleResolver] Fetch ${url} → HTTP ${response.status}`);
                return null;
            }
            return (await response.json()) as T;
        } catch (error) {
            Log.warn(`[StyleResolver] Fetch ${url} failed: ${(error as Error).message}`);
            return null;
        }
    },

    async _fetchStyle(styleUrl: string): Promise<MapLibreStyle | null> {
        return this._fetchJson<MapLibreStyle>(styleUrl);
    },

    /**
     * Resolves each vector source to a tile template + source maxzoom, then
     * enumerates the .pbf URLs over the zone. Caps maxZoom at the source maxzoom
     * so MapLibre overzooms from there (no requests for non-existent tiles).
     */
    async _enumerateVectorTiles(
        style: MapLibreStyle,
        styleUrl: string,
        zone: ResolverZone
    ): Promise<StyleResource[]> {
        const out: StyleResource[] = [];
        const sources = style.sources || {};

        for (const source of Object.values(sources)) {
            if (source.type !== "vector") continue;

            let template: string | undefined;
            let sourceMaxzoom = source.maxzoom;

            if (Array.isArray(source.tiles) && source.tiles.length > 0) {
                template = source.tiles[0];
            } else if (source.url) {
                const tileJson = await this._fetchJson<MapLibreSource>(
                    this._resolveUrl(source.url, styleUrl)
                );
                if (tileJson?.tiles?.length) {
                    template = tileJson.tiles[0];
                    sourceMaxzoom = sourceMaxzoom ?? tileJson.maxzoom;
                }
            }

            if (!template) {
                Log.warn("[StyleResolver] Vector source without resolvable tiles template");
                continue;
            }

            const maxZoom = Math.min(zone.cacheMaxZoom, sourceMaxzoom ?? DEFAULT_SOURCE_MAXZOOM);
            const minZoom = Math.min(zone.cacheMinZoom, maxZoom);

            const tiles = await CacheCalculator.enumerateTiles(
                {
                    offlineBounds: zone.bounds,
                    cacheMinZoom: minZoom,
                    cacheMaxZoom: maxZoom,
                    url: this._resolveUrl(template, styleUrl),
                },
                ""
            );
            out.push(...(tiles as StyleResource[]));
        }

        return out;
    },

    /**
     * Enumerates glyph ranges for every fontstack used by the style's layers.
     * MapLibre requests `{fontstack}` URL-encoded and `{range}` as a 256-block;
     * the cached key must byte-match that request.
     */
    _enumerateGlyphs(style: MapLibreStyle, styleUrl: string): StyleResource[] {
        if (!style.glyphs) return [];

        const template = this._resolveUrl(style.glyphs, styleUrl);
        const fontstacks = new Set<string>();

        for (const layer of style.layers || []) {
            const fonts = layer.layout?.["text-font"];
            if (Array.isArray(fonts) && fonts.length > 0) {
                fontstacks.add(fonts.join(","));
            }
        }

        const out: StyleResource[] = [];
        for (const fontstack of fontstacks) {
            for (const range of GLYPH_RANGES) {
                out.push({
                    url: template
                        .replace("{fontstack}", encodeURIComponent(fontstack))
                        .replace("{range}", range),
                    type: "glyph",
                    priority: 2,
                    // A missing range degrades labels gracefully — never fatal.
                    optional: true,
                });
            }
        }
        return out;
    },

    /**
     * Enumerates the sprite sheet: .json + .png, plus optional @2x variants
     * (the runtime devicePixelRatio is unknown at download time).
     */
    _enumerateSprite(style: MapLibreStyle, styleUrl: string): StyleResource[] {
        if (!style.sprite) return [];

        const base = this._resolveUrl(style.sprite, styleUrl);
        return [
            { url: `${base}.json`, type: "sprite-json", priority: 2 },
            { url: `${base}.png`, type: "sprite-image", priority: 2 },
            { url: `${base}@2x.json`, type: "sprite-json", priority: 2, optional: true },
            { url: `${base}@2x.png`, type: "sprite-image", priority: 2, optional: true },
        ];
    },

    /** Resolves a possibly-relative URL against the style URL. */
    _resolveUrl(maybeRelative: string, baseUrl: string): string {
        if (/^https?:\/\//.test(maybeRelative) || maybeRelative.startsWith("//")) {
            return maybeRelative;
        }
        try {
            return new URL(maybeRelative, baseUrl).href;
        } catch {
            return maybeRelative;
        }
    },
};

export { StyleResolver };
