/*!
 * GeoLeaf Core – Basemaps / WMTS & WMS Resolver
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * WMTS: fetches GetCapabilities XML, extracts an XYZ-compatible tile URL template,
 *       caches the result per GetCapabilities URL (in-process memory cache).
 * WMS:  builds a MapLibre-compatible WMS tile URL template from configuration
 *       parameters (no network request required).
 *
 * Grid compatibility — the whole point of this resolver, and the reason it is not a URL builder:
 *   - The XYZ template maps {TileMatrix}/{TileRow}/{TileCol} onto {z}/{y}/{x}, which is
 *     only correct on a Web Mercator quadtree. The TileMatrixSet DEFINITION is now read
 *     and checked — CRS, top-left corner, 256 px tiles, 2^z matrices — and a grid that
 *     fails is REFUSED instead of silently producing misplaced tiles.
 *   - A TileMatrixSet requested but absent from the layer's links is warned about before
 *     falling back, instead of being substituted silently.
 *   - When NO TileMatrixSet is requested and the layer offers several, the first is picked by
 *     document order and that pick is warned about too. With a single link there is no choice to
 *     report, so the common case stays quiet — a warning nobody can act on is a warning nobody
 *     reads.
 *   - ⚠️ When the definition is absent from the document, the check reports "unverified"
 *     and lets the resolution proceed with a warning. Failing closed there would reject
 *     services that work today; the guard only refuses grids it has actually read.
 *
 * Security:
 *   - All input URLs validated via validateUrl() before fetch.
 *   - XML parsed with DOMParser (no eval, no innerHTML, no XSS risk).
 *   - External entity expansion (XXE) is not possible in browser DOMParser.
 *   - URLs extracted from XML are validated before use or caching.
 *   - AbortController on all fetch requests (cooperative cancellation).
 *   - No dynamic code execution.
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import { validateUrl } from "../../utils/general/utils-base.js";
import type { BasemapDefinition, WmtsConfig, WmsConfig } from "./basemaps-types.js";

// ─── In-memory WMTS cache ─────────────────────────────────────────────────────

/** Maps GetCapabilities URL → resolved XYZ tile URL template. */
const _wmtsCache = new Map<string, string>();

// ─── Namespace-safe DOM traversal helpers ────────────────────────────────────

/**
 * Returns all descendant elements whose `localName` equals `name`.
 * Works correctly in jsdom and browsers regardless of XML namespace prefixes.
 * @internal
 */
function _byLocalName(parent: Element | Document, name: string): Element[] {
    // `for..of` over the LIVE collection, not `[...collection].filter()`. The spread would
    // materialise the whole document before filtering; a WMTS GetCapabilities holds thousands of
    // elements, and the array is iterated once then discarded.
    const result: Element[] = [];
    for (const el of parent.getElementsByTagName("*")) {
        if (el.localName === name) result.push(el);
    }
    return result;
}

/**
 * Returns the first descendant element whose `localName` equals `name`, or `null`.
 * @internal
 */
function _firstByLocalName(parent: Element | Document, name: string): Element | null {
    // The early exit IS the point of this function, and `[...collection].find()` would lose it:
    // the spread walks and allocates the whole document before searching. This helper is called
    // once PER LAYER, so `for..of` over the live collection keeps the `return` immediate and a
    // document with hundreds of layers is never walked in full for a single lookup.
    for (const el of parent.getElementsByTagName("*")) {
        if (el.localName === name) return el;
    }
    return null;
}

/**
 * Returns the trimmed text content of the first descendant matching `localName`.
 * @internal
 */
function _getText(parent: Element | Document, localName: string): string | null {
    return _firstByLocalName(parent, localName)?.textContent?.trim() ?? null;
}

// ─── WMTS XML parsing helpers ─────────────────────────────────────────────────

/**
 * Finds the first `<Layer>` element matching `layerName`,
 * or the first available layer when `layerName` is omitted.
 * @internal
 */
function _findWmtsLayer(doc: Document, layerName: string | undefined): Element | null {
    const layers = _byLocalName(doc, "Layer").filter(
        (l) => _firstByLocalName(l, "Identifier") !== null
    );

    const [firstLayer] = layers;
    if (!firstLayer) return null;
    if (!layerName) return firstLayer;

    // When a specific layer is requested, return null on miss rather than falling
    // back silently to an unrelated layer.
    return layers.find((l) => _getText(l, "Identifier") === layerName) ?? null;
}

/**
 * Returns the TileMatrixSet identifier from a layer's `<TileMatrixSetLink>`
 * that matches `tileMatrixSet`, or the identifier from the first link found.
 * @internal
 */
function _findTileMatrixSetId(layer: Element, tileMatrixSet: string | undefined): string | null {
    const links = _byLocalName(layer, "TileMatrixSetLink");
    const fallbackLinks = links.length ? links : _byLocalName(layer, "TileMatrixLink");
    if (!fallbackLinks.length) return null;

    if (tileMatrixSet) {
        const exact = fallbackLinks.find((l) => _getText(l, "TileMatrixSet") === tileMatrixSet);
        if (exact) return _getText(exact, "TileMatrixSet");

        // Some providers (IGN) use range-qualified identifiers like "PM_0_19" for "PM".
        // If a link starts with the requested value, honour the caller's intent and
        // return the requested value so GetTile uses TILEMATRIXSET=PM (not PM_0_19).
        const hasPrefix = fallbackLinks.some(
            (l) => _getText(l, "TileMatrixSet")?.startsWith(tileMatrixSet) ?? false
        );
        if (hasPrefix) return tileMatrixSet;
    }

    const [firstLink] = fallbackLinks;
    const fallbackId = firstLink ? _getText(firstLink, "TileMatrixSet") : null;

    const available = () =>
        fallbackLinks.map((l) => _getText(l, "TileMatrixSet") ?? "?").join(", ");

    // Falling back to an unrelated grid used to be silent. A caller who asks for "WGS84G" and is
    // served "PM" gets a map that renders — offset by hundreds of metres. Say so.
    if (tileMatrixSet && fallbackId) {
        Log.warn(
            `[GeoLeaf.WMTS] Requested TileMatrixSet "${tileMatrixSet}" not found on this layer; ` +
                `falling back to "${fallbackId}". Available: ${available()}`
        );
        return fallbackId;
    }

    // The grid was OMITTED, and this branch is quiet on purpose when there is nothing to choose.
    //
    // Taking the first link is documented behaviour, and with a single link it is not a choice at
    // all — warning there would be noise on the common case, and a warning nobody can act on is a
    // warning nobody reads. What deserves a word is the ARBITRARY pick: several grids are offered,
    // the caller expressed no preference, and the first one wins by document order alone. That
    // order is the provider's, not ours, and it can change between two capability documents
    // without anything here noticing.
    if (!tileMatrixSet && fallbackId && fallbackLinks.length > 1) {
        Log.warn(
            `[GeoLeaf.WMTS] No TileMatrixSet requested and this layer offers ${fallbackLinks.length}; ` +
                `picking "${fallbackId}" by document order. Available: ${available()}. ` +
                `Set the layer's tileMatrixSet to make the choice explicit.`
        );
    }

    return fallbackId;
}

// ─── XYZ grid-compatibility guard ─────────────────────────────────────────────
//
// `_toXyzTemplate` maps {TileMatrix}→{z}, {TileRow}→{y}, {TileCol}→{x}. That mapping is
// only correct for the Google/Web-Mercator grid: EPSG:3857, top-left origin at the world
// corner, 256 px tiles, and 2^z × 2^z matrices. Nothing used to check it — a service
// advertising an EPSG:2154 grid (IGN publishes 700+ of them next to `PM`) produced WRONG
// TILES with no error at all. This section reads the TileMatrixSet definition and refuses.

/** World corner of the Web Mercator extent, in metres. */
const WEBMERCATOR_ORIGIN_M = 20037508.3427892;

/** Tolerance on the origin comparison, in metres — providers print 10–16 decimals. */
const ORIGIN_TOLERANCE_M = 1;

/** The only tile size for which the XYZ template emitted by this module is valid. */
const XYZ_TILE_SIZE = 256;

/** EPSG codes that all denote Web Mercator. */
const WEBMERCATOR_EPSG = new Set(["3857", "900913", "102100", "102113", "3785"]);

/**
 * True when a `SupportedCRS` string denotes Web Mercator, whatever its notation
 * (`EPSG:3857`, `urn:ogc:def:crs:EPSG::3857`, `http://www.opengis.net/def/crs/EPSG/0/3857`).
 * @internal
 */
function _isWebMercatorCrs(crs: string | null): boolean {
    if (!crs) return false;
    const codes = crs.match(/\d+/g);
    const last = codes?.[codes.length - 1];
    return last !== undefined && WEBMERCATOR_EPSG.has(last);
}

/**
 * Finds the `<TileMatrixSet>` DEFINITION whose identifier is `id`.
 *
 * ⚠️ `<TileMatrixSetLink>` also contains an element named `TileMatrixSet` — a text
 * reference, not a definition. They are told apart by the presence of a child
 * `Identifier` ELEMENT, which only the definition has.
 * @internal
 */
function _findTileMatrixSetDef(doc: Document, id: string): Element | null {
    // Single live pass, early return — see the note on `_firstByLocalName`. IGN's
    // GetCapabilities is 2.9 MB and defines 763 sets; materialising them would be costly.
    for (const el of doc.getElementsByTagName("*")) {
        if (el.localName !== "TileMatrixSet") continue;
        const identifier = _firstByLocalName(el, "Identifier");
        if (!identifier) continue; // link reference, not a definition
        if (identifier.textContent?.trim() === id) return el;
    }
    return null;
}

/**
 * True when a `<TopLeftCorner>` text denotes the Web Mercator world corner.
 * Axis order follows the CRS, so either ordering is accepted; the discriminant is that
 * exactly one of the two coordinates is negative (x = west, y = north).
 * @internal
 */
function _isWebMercatorOrigin(topLeft: string | null): boolean {
    const parts = (topLeft ?? "").trim().split(/\s+/);
    if (parts.length !== 2) return false;

    const [x, y] = parts.map(Number);
    if (x === undefined || y === undefined) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x < 0 === y < 0) return false;

    return (
        Math.abs(Math.abs(x) - WEBMERCATOR_ORIGIN_M) <= ORIGIN_TOLERANCE_M &&
        Math.abs(Math.abs(y) - WEBMERCATOR_ORIGIN_M) <= ORIGIN_TOLERANCE_M
    );
}

/**
 * Returns the first `<TileMatrix>` whose dimensions are not `2^z × 2^z`, or `null` when
 * every checkable level is a proper quadtree.
 *
 * Only levels whose identifier is a plain integer can be checked: some services label
 * them `EPSG:3857:5`, others use opaque names, and `z` cannot be derived from those.
 * @internal
 */
function _findNonQuadtreeLevel(matrices: Element[]): string | null {
    for (const m of matrices) {
        const label = _getText(m, "Identifier");
        if (label === null || !/^\d+$/.test(label)) continue;

        const expected = 2 ** Number(label);
        const width = Number(_getText(m, "MatrixWidth"));
        const height = Number(_getText(m, "MatrixHeight"));
        if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
        if (width === expected && height === expected) continue;

        return `level ${label} is ${width}×${height} tiles, expected ${expected}×${expected} (grid is not a 2^z quadtree)`;
    }
    return null;
}

/** Outcome of the grid check. `verified` distinguishes "compatible" from "unknown". */
interface GridCheck {
    compatible: boolean;
    verified: boolean;
    reason?: string;
}

/**
 * Checks that the `<TileMatrixSet>` named `tmsId` is an XYZ-compatible grid.
 *
 * ⚠️ **When the definition is absent, this reports `verified: false` and does NOT
 * refuse.** Many capabilities documents (and every fixture in this repo's tests) carry
 * only the link. Failing closed on missing information would reject services that work
 * today; the caller warns instead. The guard fails only on a grid it has READ and found
 * incompatible.
 *
 * @param doc - Parsed GetCapabilities document.
 * @param tmsId - Identifier that will be sent as `TILEMATRIXSET`.
 * @returns Whether the grid is XYZ-compatible, whether it could be verified at all,
 *   and — when incompatible — the reason, for the log.
 * @internal
 */
function _checkXyzGridCompatibility(doc: Document, tmsId: string): GridCheck {
    const def = _findTileMatrixSetDef(doc, tmsId);
    if (!def) return { compatible: true, verified: false };

    const crs = _getText(def, "SupportedCRS");
    if (!_isWebMercatorCrs(crs)) {
        return {
            compatible: false,
            verified: true,
            reason: `CRS is "${crs ?? "(absent)"}", expected Web Mercator (EPSG:3857)`,
        };
    }

    const matrices = _byLocalName(def, "TileMatrix");
    const [first] = matrices;
    if (!first) return { compatible: true, verified: false };

    const tileWidth = Number(_getText(first, "TileWidth"));
    const tileHeight = Number(_getText(first, "TileHeight"));
    if (tileWidth !== XYZ_TILE_SIZE || tileHeight !== XYZ_TILE_SIZE) {
        return {
            compatible: false,
            verified: true,
            reason: `tiles are ${tileWidth}×${tileHeight}, expected ${XYZ_TILE_SIZE}×${XYZ_TILE_SIZE}`,
        };
    }

    const topLeft = _getText(first, "TopLeftCorner");
    if (!_isWebMercatorOrigin(topLeft)) {
        return {
            compatible: false,
            verified: true,
            reason: `top-left corner is "${topLeft ?? "(absent)"}", expected ±${WEBMERCATOR_ORIGIN_M}`,
        };
    }

    const nonQuadtree = _findNonQuadtreeLevel(matrices);
    if (nonQuadtree) return { compatible: false, verified: true, reason: nonQuadtree };

    return { compatible: true, verified: true };
}

/**
 * Returns the identifier of the default `<Style>` element on a WMTS layer,
 * or an empty string when no style is declared (empty string is valid per spec).
 * @internal
 */
function _findDefaultStyle(layer: Element): string {
    const styles = _byLocalName(layer, "Style");
    const [firstStyle] = styles;
    if (!firstStyle) return "";

    const def = styles.find((s) => s.getAttribute("isDefault") === "true");
    return _getText(def ?? firstStyle, "Identifier") ?? "";
}

/**
 * Converts WMTS template variables to MapLibre XYZ placeholders.
 * `{TileMatrix}` → `{z}`, `{TileRow}` → `{y}`, `{TileCol}` → `{x}`,
 * `{Style}` → resolved style identifier.
 * @internal
 */
function _toXyzTemplate(template: string, tmsId: string | null, styleId: string): string {
    return template
        .replace(/\{TileMatrixSet\}/gi, tmsId ?? "")
        .replace(/\{Style\}/gi, styleId)
        .replace(/\{TileMatrix\}/gi, "{z}")
        .replace(/\{TileRow\}/gi, "{y}")
        .replace(/\{TileCol\}/gi, "{x}");
}

/**
 * Builds a KVP fallback tile URL if no RESTful ResourceURL is available.
 * @internal
 */
function _buildKvpFallback(
    doc: Document,
    layer: Element,
    tmsId: string | null,
    format: string,
    styleId: string
): string | null {
    if (!tmsId) return null;

    // Find the GetTile Operation element by name attribute
    const operations = _byLocalName(doc, "Operation");
    const getTile = operations.find((op) => op.getAttribute("name") === "GetTile");
    if (!getTile) return null;

    const getEl = _firstByLocalName(getTile, "Get");
    if (!getEl) return null;

    // xlink:href is a namespaced attribute — use getAttributeNS for cross-environment
    // compatibility (jsdom XML parser + all browsers). Fall back to plain href.
    const XLINK = "http://www.w3.org/1999/xlink";
    const onlineResource = _firstByLocalName(getEl, "OnlineResource");
    const opUrl =
        getEl.getAttributeNS(XLINK, "href") ??
        getEl.getAttribute("href") ??
        onlineResource?.getAttributeNS(XLINK, "href") ??
        onlineResource?.getAttribute("href") ??
        null;

    if (!opUrl) return null;

    const layerId = _getText(layer, "Identifier") ?? "";
    // Strip any existing query string from the operation URL before appending params.
    // IGN and similar WMTS services return operation URLs like
    // "https://...?SERVICE=WMTS&REQUEST=GetCapabilities" — we need only the base path.
    const base = opUrl.split("?")[0];
    const params = [
        "SERVICE=WMTS",
        "REQUEST=GetTile",
        "VERSION=1.0.0",
        `LAYER=${encodeURIComponent(layerId)}`,
        `STYLE=${encodeURIComponent(styleId)}`,
        `TILEMATRIXSET=${encodeURIComponent(tmsId)}`,
        "TILEMATRIX={z}",
        "TILEROW={y}",
        "TILECOL={x}",
        `FORMAT=${encodeURIComponent(format)}`,
    ].join("&");

    return `${base}?${params}`;
}

/**
 * Extracts the XYZ tile URL template from a WMTS layer element.
 * Prefers RESTful `<ResourceURL>` templates; falls back to KVP parameters.
 * @internal
 */
function _extractTileUrl(
    doc: Document,
    layer: Element,
    tmsId: string | null,
    format: string
): string | null {
    const styleId = _findDefaultStyle(layer);
    const resourceUrls = _byLocalName(layer, "ResourceURL");

    for (const ru of resourceUrls) {
        if (ru.getAttribute("resourceType") !== "tile") continue;
        const template = ru.getAttribute("template");
        if (template) return _toXyzTemplate(template, tmsId, styleId);
    }

    return _buildKvpFallback(doc, layer, tmsId, format, styleId);
}

// ─── WMTS public API ──────────────────────────────────────────────────────────

/**
 * Parses a WMTS GetCapabilities XML string and returns a MapLibre-compatible
 * XYZ tile URL template.
 *
 * @param xml - Raw XML string from a GetCapabilities response.
 * @param layerName - Target WMTS layer identifier (uses first layer if omitted).
 * @param tileMatrixSet - TileMatrixSet identifier (uses first available if omitted).
 * @param format - Tile image format (e.g. `"image/png"`).
 * @returns The resolved XYZ tile URL template, or `null` on failure.
 */
export function parseWmtsCapabilities(
    xml: string,
    layerName: string | undefined,
    tileMatrixSet: string | undefined,
    format: string
): string | null {
    let doc: Document;

    try {
        const parser = new DOMParser();
        doc = parser.parseFromString(xml, "application/xml");
    } catch (e) {
        Log.error("[GeoLeaf.WMTS] Failed to parse GetCapabilities XML:", e);
        return null;
    }

    // DOMParser signals XML errors via a <parsererror> element
    if (doc.querySelector("parsererror")) {
        Log.error("[GeoLeaf.WMTS] Malformed XML in GetCapabilities response.");
        return null;
    }

    const layer = _findWmtsLayer(doc, layerName);
    if (!layer) {
        Log.error("[GeoLeaf.WMTS] No matching layer found in GetCapabilities.");
        return null;
    }

    const tmsId = _findTileMatrixSetId(layer, tileMatrixSet);

    // The {TileMatrix}/{TileRow}/{TileCol} → {z}/{x}/{y} mapping below is only
    // valid on a Web Mercator quadtree. Refuse rather than serve misplaced tiles.
    if (tmsId) {
        const grid = _checkXyzGridCompatibility(doc, tmsId);
        if (!grid.compatible) {
            Log.error(
                `[GeoLeaf.WMTS] TileMatrixSet "${tmsId}" is not XYZ-compatible: ${grid.reason}. ` +
                    `MapLibre cannot render it through an XYZ template — refusing.`
            );
            return null;
        }
        if (!grid.verified) {
            Log.warn(
                `[GeoLeaf.WMTS] TileMatrixSet "${tmsId}" has no readable definition in this ` +
                    `GetCapabilities; assuming a Web Mercator quadtree. Misplaced tiles will not be detected.`
            );
        }
    }

    const tileUrl = _extractTileUrl(doc, layer, tmsId, format);

    if (!tileUrl) {
        Log.error("[GeoLeaf.WMTS] Cannot extract tile URL from GetCapabilities.");
        return null;
    }

    return tileUrl;
}

/**
 * Fetches WMTS GetCapabilities XML, resolves the XYZ tile URL template,
 * and caches the result for subsequent calls with the same GetCapabilities URL.
 *
 * @param definition - Basemap config with `wmts.getCapabilitiesUrl` and optional
 *   `wmts.layer`, `wmts.tileMatrixSet`, `wmts.format`.
 * @param signal - Optional `AbortSignal` for cooperative cancellation.
 * @returns The resolved XYZ tile URL, or `null` on failure or cancellation.
 */
export async function resolveWmtsTilesUrl(
    definition: BasemapDefinition,
    signal?: AbortSignal
): Promise<string | null> {
    const config: Partial<WmtsConfig> = definition?.wmts ?? {};
    const capsUrl: string = config.getCapabilitiesUrl ?? "";

    if (!capsUrl) {
        Log.warn("[GeoLeaf.WMTS] wmts.getCapabilitiesUrl is required.");
        return null;
    }

    // Inject optional API key into the GetCapabilities URL
    const apiKey: string | undefined =
        typeof definition.apiKey === "string" ? definition.apiKey : undefined;
    const resolvedCapsUrl = apiKey
        ? capsUrl.includes("?")
            ? `${capsUrl}&apikey=${encodeURIComponent(apiKey)}`
            : `${capsUrl}?apikey=${encodeURIComponent(apiKey)}`
        : capsUrl;

    // Security: validate GetCapabilities URL before fetch
    const safeCapsUrl = validateUrl(resolvedCapsUrl, ["http:", "https:"]);
    if (!safeCapsUrl) {
        Log.error("[GeoLeaf.WMTS] Invalid GetCapabilities URL:", resolvedCapsUrl);
        return null;
    }

    const format: string = config.format ?? "image/png";

    // Cache key includes layer + tileMatrixSet + format so that multiple layers
    // sharing the same GetCapabilities URL (e.g. IGN) each get their own entry.
    const cacheKey = `${safeCapsUrl}|${config.layer ?? ""}|${config.tileMatrixSet ?? ""}|${format}`;

    // Return cached result if available
    const cached = _wmtsCache.get(cacheKey);
    if (cached) {
        Log.debug("[GeoLeaf.WMTS] Cache hit for:", cacheKey);
        return cached;
    }

    try {
        const response = await fetch(safeCapsUrl, {
            method: "GET",
            headers: { Accept: "application/xml, text/xml" },
            signal: signal ?? null,
        });

        if (!response.ok) {
            Log.error(
                "[GeoLeaf.WMTS] GetCapabilities request failed:",
                response.status,
                response.statusText
            );
            return null;
        }

        const xml = await response.text();
        const tileUrl = parseWmtsCapabilities(xml, config.layer, config.tileMatrixSet, format);
        if (!tileUrl) return null;

        // Security: validate the extracted tile URL before caching
        // Replace template vars with "0" for URL validation
        const probeUrl = tileUrl.replace(/\{[^}]+\}/g, "0");
        const safeProbe = validateUrl(probeUrl, ["http:", "https:"]);
        if (!safeProbe) {
            Log.error("[GeoLeaf.WMTS] Extracted tile URL failed security validation:", tileUrl);
            return null;
        }

        _wmtsCache.set(cacheKey, tileUrl);
        Log.info("[GeoLeaf.WMTS] Resolved tile URL:", tileUrl);
        return tileUrl;
    } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") {
            Log.debug("[GeoLeaf.WMTS] GetCapabilities request aborted.");
        } else {
            Log.error("[GeoLeaf.WMTS] Failed to fetch GetCapabilities:", e);
        }
        return null;
    }
}

// ─── WMS URL builder ──────────────────────────────────────────────────────────

/**
 * Builds a MapLibre-compatible WMS tile URL template from a WMS basemap config.
 *
 * The resulting URL uses `{bbox-epsg-3857}` which MapLibre replaces with the
 * actual EPSG:3857 bounding box for each tile request.
 *
 * @param definition - Basemap config with `wms.url` and `wms.layers`.
 * @returns The WMS tile URL template, or `null` if the config is invalid.
 */
export function buildWmsUrl(definition: BasemapDefinition): string | null {
    const config: Partial<WmsConfig> = definition?.wms ?? {};
    const baseUrl: string = config.url ?? "";
    const layers: string = config.layers ?? "";

    if (!baseUrl) {
        Log.warn("[GeoLeaf.WMS] wms.url is required.");
        return null;
    }
    if (!layers) {
        Log.warn("[GeoLeaf.WMS] wms.layers is required.");
        return null;
    }

    // Security: validate base URL before use
    const safeBaseUrl = validateUrl(baseUrl, ["http:", "https:"]);
    if (!safeBaseUrl) {
        Log.error("[GeoLeaf.WMS] Invalid WMS URL:", baseUrl);
        return null;
    }

    const version: string = config.version ?? "1.3.0";
    const crs: string = config.crs ?? "EPSG:3857";
    const format: string = config.format ?? "image/png";
    const transparent = config.transparent !== false;
    const size = typeof config.tileSize === "number" ? config.tileSize : 256;
    const base = safeBaseUrl.replace(/[?&]$/, "");
    const styles: string = config.styles ?? "";

    // Build params without URLSearchParams to preserve the `{bbox-epsg-3857}` placeholder.
    // URLSearchParams would encode `{` / `}` as `%7B` / `%7D`, which MapLibre cannot resolve.
    const params = [
        "SERVICE=WMS",
        `VERSION=${encodeURIComponent(version)}`,
        "REQUEST=GetMap",
        `LAYERS=${encodeURIComponent(layers)}`,
        `CRS=${encodeURIComponent(crs)}`,
        "BBOX={bbox-epsg-3857}",
        `WIDTH=${size}`,
        `HEIGHT=${size}`,
        `FORMAT=${encodeURIComponent(format)}`,
        `TRANSPARENT=${transparent ? "TRUE" : "FALSE"}`,
        `STYLES=${encodeURIComponent(styles)}`,
    ].join("&");

    return `${base}?${params}`;
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** @internal Exposes the WMTS cache for testing. Do not use in production code. */
export function _getWmtsCache(): Map<string, string> {
    return _wmtsCache;
}

/** @internal Clears the WMTS in-memory cache. Used in test teardown. */
export function _clearWmtsCache(): void {
    _wmtsCache.clear();
}
