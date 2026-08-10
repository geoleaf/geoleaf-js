/**
 * @tests built-in/basemaps/wmts-resolver
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/general/utils-base.js", () => ({
    validateUrl: (url, _protocols) => {
        if (typeof url !== "string") return null;
        return url.startsWith("http://") || url.startsWith("https://") ? url : null;
    },
}));

// ─── Module under test ────────────────────────────────────────────────────────

let parseWmtsCapabilities;
let resolveWmtsTilesUrl;
let buildWmsUrl;
let _clearWmtsCache;
let _getWmtsCache;
/** The mocked Log — the B-151 guard is asserted through the messages it emits. */
let Log;

beforeAll(async () => {
    ({ Log } = await import("../../src/utils/log/index.js"));
    const mod = await import("../../src/kernel/basemaps/wmts-resolver.ts");
    parseWmtsCapabilities = mod.parseWmtsCapabilities;
    resolveWmtsTilesUrl = mod.resolveWmtsTilesUrl;
    buildWmsUrl = mod.buildWmsUrl;
    _clearWmtsCache = mod._clearWmtsCache;
    _getWmtsCache = mod._getWmtsCache;
});

afterEach(() => {
    _clearWmtsCache?.();
    vi.restoreAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal WMTS GetCapabilities XML with a RESTful ResourceURL layer. */
function makeWmtsXml({
    layerId = "ORTHO",
    tmsId = "PM",
    template = "https://tiles.example.com/wmts/{TileMatrixSet}/{TileMatrix}/{TileCol}/{TileRow}.png",
    useKvp = false,
} = {}) {
    // ows: namespace must be declared to avoid XML parsererror in jsdom / strict parsers
    const nsDecl =
        'xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink"';

    if (useKvp) {
        return `<?xml version="1.0"?>
<Capabilities ${nsDecl}>
  <ows:OperationsMetadata>
    <ows:Operation name="GetTile">
      <ows:DCP><ows:HTTP><ows:Get xlink:href="https://tiles.example.com/wmts"/></ows:HTTP></ows:DCP>
    </ows:Operation>
  </ows:OperationsMetadata>
  <Contents>
    <Layer>
      <ows:Identifier>${layerId}</ows:Identifier>
      <TileMatrixSetLink><TileMatrixSet>${tmsId}</TileMatrixSet></TileMatrixSetLink>
    </Layer>
  </Contents>
</Capabilities>`;
    }

    return `<?xml version="1.0"?>
<Capabilities ${nsDecl}>
  <Contents>
    <Layer>
      <ows:Identifier>${layerId}</ows:Identifier>
      <ResourceURL resourceType="tile" template="${template}"/>
      <TileMatrixSetLink><TileMatrixSet>${tmsId}</TileMatrixSet></TileMatrixSetLink>
    </Layer>
  </Contents>
</Capabilities>`;
}

function mockFetch(responseOrError) {
    global.fetch = vi.fn().mockImplementation(async () => {
        if (responseOrError instanceof Error) throw responseOrError;
        return {
            ok: responseOrError.ok ?? true,
            status: responseOrError.status ?? 200,
            statusText: responseOrError.statusText ?? "OK",
            text: async () => responseOrError.body ?? "",
        };
    });
}

// ─── parseWmtsCapabilities ────────────────────────────────────────────────────

describe("parseWmtsCapabilities — RESTful ResourceURL", () => {
    it("parses a WMTS GetCapabilities and returns an XYZ tile URL", () => {
        const xml = makeWmtsXml();
        const url = parseWmtsCapabilities(xml, "ORTHO", "PM", "image/png");
        expect(url).toContain("{z}");
        expect(url).toContain("{x}");
        expect(url).toContain("{y}");
    });

    it("replaces TileMatrixSet placeholder with tmsId", () => {
        const xml = makeWmtsXml({ tmsId: "GoogleMapsCompatible" });
        const url = parseWmtsCapabilities(xml, "ORTHO", "GoogleMapsCompatible", "image/png");
        expect(url).toContain("GoogleMapsCompatible");
        expect(url).not.toContain("{TileMatrixSet}");
    });

    it("uses first available layer when layerName is omitted", () => {
        const xml = makeWmtsXml({ layerId: "TOPO" });
        const url = parseWmtsCapabilities(xml, undefined, "PM", "image/png");
        expect(url).not.toBeNull();
    });

    it("returns null for empty XML", () => {
        const url = parseWmtsCapabilities("", undefined, undefined, "image/png");
        expect(url).toBeNull();
    });

    it("returns null for malformed XML", () => {
        const url = parseWmtsCapabilities("<broken><unclosed>", undefined, undefined, "image/png");
        expect(url).toBeNull();
    });

    it("returns null when an explicitly requested layer is not found", () => {
        const xml = makeWmtsXml({ layerId: "EXISTING" });
        // Behaviour (98a0d69a): a specifically requested layer that does not match
        // returns null rather than silently falling back to an unrelated layer.
        const url = parseWmtsCapabilities(xml, "NONEXISTENT_LAYER_XYZ_ABC", "PM", "image/png");
        expect(url).toBeNull();
    });

    it("falls back to KVP URL when no ResourceURL is present (using href attribute)", () => {
        // KVP XML with plain href (namespace-safe for jsdom + browsers via getAttributeNS)
        const nsDecl =
            'xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink"';
        const kvpXml = `<?xml version="1.0"?>
<Capabilities ${nsDecl}>
  <ows:OperationsMetadata>
    <ows:Operation name="GetTile">
      <ows:DCP><ows:HTTP><ows:Get href="https://tiles.example.com/wmts"/></ows:HTTP></ows:DCP>
    </ows:Operation>
  </ows:OperationsMetadata>
  <Contents>
    <Layer>
      <ows:Identifier>ORTHO</ows:Identifier>
      <TileMatrixSetLink><TileMatrixSet>PM</TileMatrixSet></TileMatrixSetLink>
    </Layer>
  </Contents>
</Capabilities>`;
        const url = parseWmtsCapabilities(kvpXml, "ORTHO", "PM", "image/png");
        expect(url).not.toBeNull();
        expect(url).toContain("SERVICE=WMTS");
        expect(url).toContain("TILEMATRIX={z}");
        expect(url).toContain("TILEROW={y}");
        expect(url).toContain("TILECOL={x}");
    });

    it("returns null when KVP XML has no GetTile operation", () => {
        const nsDecl = 'xmlns:ows="http://www.opengis.net/ows/1.1"';
        // No OperationsMetadata, no ResourceURL → no tile URL possible
        const noOpXml = `<?xml version="1.0"?>
<Capabilities ${nsDecl}>
  <Contents>
    <Layer>
      <ows:Identifier>ORTHO</ows:Identifier>
      <TileMatrixSetLink><TileMatrixSet>PM</TileMatrixSet></TileMatrixSetLink>
    </Layer>
  </Contents>
</Capabilities>`;
        const url = parseWmtsCapabilities(noOpXml, "ORTHO", "PM", "image/png");
        expect(url).toBeNull();
    });
});

// ─── XYZ grid-compatibility guard (B-151) ─────────────────────────────────────
//
// Fixtures below are TRIMMED FROM THE REAL `https://data.geopf.fr/wmts` GetCapabilities
// (2 895 885 bytes, 763 TileMatrixSet definitions, fetched 07/08/2026). `PM` is the grid
// the three shipped WMTS basemaps actually use; `2154_5cm` is a real Lambert-93 grid the
// same service publishes alongside it. Values are copied verbatim, decimals included.

/** One `<TileMatrix>` level, in the exact shape IGN emits. */
function grid1Level(z, scaleDen, topLeft, size = 256) {
    const n = 2 ** z;
    return `      <TileMatrix>
        <ows:Identifier>${z}</ows:Identifier>
        <ScaleDenominator>${scaleDen}</ScaleDenominator>
        <TopLeftCorner>${topLeft}</TopLeftCorner>
        <TileWidth>${size}</TileWidth>
        <TileHeight>${size}</TileHeight>
        <MatrixWidth>${n}</MatrixWidth>
        <MatrixHeight>${n}</MatrixHeight>
      </TileMatrix>`;
}

const PM_ORIGIN = "-20037508.3427891992032528 20037508.3427891992032528";
const L93_ORIGIN = "0.0000000000000000 12000000.0000000000000000";

/** Capabilities carrying a real TileMatrixSet DEFINITION (not only the link). */
function makeWmtsXmlWithGrid({
    tmsId = "PM",
    crs = "EPSG:3857",
    topLeft = PM_ORIGIN,
    tileSize = 256,
    levels,
} = {}) {
    const nsDecl =
        'xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink"';
    const matrices = (
        levels ?? [
            [0, "559082264.0287178958533332"],
            [1, "279541132.0143589479266666"],
            [2, "139770566.0071792920643929"],
        ]
    )
        .map(([z, s]) => grid1Level(z, s, topLeft, tileSize))
        .join("\n");

    return `<?xml version="1.0"?>
<Capabilities ${nsDecl}>
  <Contents>
    <Layer>
      <ows:Identifier>ORTHO</ows:Identifier>
      <ResourceURL resourceType="tile" template="https://tiles.example.com/wmts/{TileMatrixSet}/{TileMatrix}/{TileCol}/{TileRow}.png"/>
      <TileMatrixSetLink><TileMatrixSet>${tmsId}</TileMatrixSet></TileMatrixSetLink>
    </Layer>
    <TileMatrixSet>
      <ows:Identifier>${tmsId}</ows:Identifier>
      <ows:SupportedCRS>${crs}</ows:SupportedCRS>
${matrices}
    </TileMatrixSet>
  </Contents>
</Capabilities>`;
}

describe("parseWmtsCapabilities — XYZ grid compatibility (B-151)", () => {
    // ── The guard must be SEEN RED — and seen red FOR THE RIGHT REASON. Asserting only
    //    `toBeNull()` would pass just as well if the fixture were malformed or the layer
    //    were missing, so every refusal below also pins the message the guard emits.

    /** The reason text carried by the guard's own `Log.error`, or null if it never fired. */
    function guardRefusalReason() {
        const call = Log.error.mock.calls.find(
            (c) => typeof c[0] === "string" && c[0].includes("is not XYZ-compatible")
        );
        return call ? call[0] : null;
    }

    beforeEach(() => Log.error.mockClear());

    it("REFUSES a Lambert-93 grid (EPSG:2154) — the real `2154_5cm` published by IGN", () => {
        const xml = makeWmtsXmlWithGrid({
            tmsId: "2154_5cm",
            crs: "EPSG:2154",
            topLeft: L93_ORIGIN,
        });
        expect(parseWmtsCapabilities(xml, "ORTHO", "2154_5cm", "image/png")).toBeNull();
        expect(guardRefusalReason()).toContain('CRS is "EPSG:2154"');
    });

    it("REFUSES a Web Mercator CRS with a non-world origin", () => {
        const xml = makeWmtsXmlWithGrid({ topLeft: "0.0 12000000.0" });
        expect(parseWmtsCapabilities(xml, "ORTHO", "PM", "image/png")).toBeNull();
        expect(guardRefusalReason()).toContain("top-left corner");
    });

    it("REFUSES 512 px tiles — the XYZ template is only valid at 256", () => {
        const xml = makeWmtsXmlWithGrid({ tileSize: 512 });
        expect(parseWmtsCapabilities(xml, "ORTHO", "PM", "image/png")).toBeNull();
        expect(guardRefusalReason()).toContain("tiles are 512×512");
    });

    it("REFUSES a grid whose matrices are not a 2^z quadtree", () => {
        const xml = makeWmtsXmlWithGrid().replace(
            "<MatrixWidth>4</MatrixWidth>",
            "<MatrixWidth>5</MatrixWidth>"
        );
        expect(parseWmtsCapabilities(xml, "ORTHO", "PM", "image/png")).toBeNull();
        expect(guardRefusalReason()).toContain("not a 2^z quadtree");
    });

    it("warns instead of substituting silently when the requested grid is absent (B-151 ①)", () => {
        Log.warn.mockClear();
        // Layer links only `PM`; the caller asks for a Lambert-93 set that is not linked.
        parseWmtsCapabilities(makeWmtsXml(), "ORTHO", "2154_5cm", "image/png");
        const warned = Log.warn.mock.calls.some(
            (c) => typeof c[0] === "string" && c[0].includes("not found on this layer")
        );
        expect(warned).toBe(true);
    });

    // ── …and it must stay GREEN on what ships today.

    it("accepts the real IGN `PM` grid — the one the three shipped basemaps use", () => {
        const xml = makeWmtsXmlWithGrid();
        const url = parseWmtsCapabilities(xml, "ORTHO", "PM", "image/png");
        expect(url).toBe("https://tiles.example.com/wmts/PM/{z}/{x}/{y}.png");
    });

    it.each([
        "urn:ogc:def:crs:EPSG::3857",
        "urn:ogc:def:crs:EPSG:6.18:3:3857",
        "http://www.opengis.net/def/crs/EPSG/0/3857",
        "EPSG:900913",
    ])("accepts Web Mercator written as %s", (crs) => {
        const xml = makeWmtsXmlWithGrid({ crs });
        expect(parseWmtsCapabilities(xml, "ORTHO", "PM", "image/png")).not.toBeNull();
    });

    it("proceeds when the document carries only the LINK, with no definition to read", () => {
        // Deliberate: failing closed on missing information would reject services that
        // work today. The guard only refuses grids it has actually read.
        const url = parseWmtsCapabilities(makeWmtsXml(), "ORTHO", "PM", "image/png");
        expect(url).not.toBeNull();
    });

    it("does not mistake a <TileMatrixSetLink>'s inner element for a definition", () => {
        // Both are named `TileMatrixSet`; only the definition has an Identifier CHILD.
        // If the link were read as a definition it would have no CRS → wrongly refused.
        expect(parseWmtsCapabilities(makeWmtsXml(), "ORTHO", "PM", "image/png")).not.toBeNull();
    });
});

// ─── resolveWmtsTilesUrl ──────────────────────────────────────────────────────

describe("resolveWmtsTilesUrl", () => {
    it("fetches GetCapabilities and returns resolved XYZ URL", async () => {
        mockFetch({ body: makeWmtsXml() });
        const def = {
            wmts: {
                getCapabilitiesUrl: "https://example.com/WMTSCapabilities.xml",
                layer: "ORTHO",
                tileMatrixSet: "PM",
            },
        };
        const url = await resolveWmtsTilesUrl(def);
        expect(url).toBeTruthy();
        expect(url).toContain("{z}");
        expect(global.fetch).toHaveBeenCalledOnce();
    });

    it("caches the resolved URL on second call (no second fetch)", async () => {
        mockFetch({ body: makeWmtsXml() });
        const def = {
            wmts: { getCapabilitiesUrl: "https://example.com/WMTSCapabilities.xml" },
        };
        await resolveWmtsTilesUrl(def);
        await resolveWmtsTilesUrl(def);
        expect(global.fetch).toHaveBeenCalledOnce();
    });

    it("returns null on HTTP error response", async () => {
        mockFetch({ ok: false, status: 403, statusText: "Forbidden", body: "" });
        const def = {
            wmts: { getCapabilitiesUrl: "https://example.com/WMTSCapabilities.xml" },
        };
        const url = await resolveWmtsTilesUrl(def);
        expect(url).toBeNull();
    });

    it("returns null on network error", async () => {
        mockFetch(new Error("Network error"));
        const def = {
            wmts: { getCapabilitiesUrl: "https://example.com/WMTSCapabilities.xml" },
        };
        const url = await resolveWmtsTilesUrl(def);
        expect(url).toBeNull();
    });

    it("returns null when getCapabilitiesUrl is missing", async () => {
        const url = await resolveWmtsTilesUrl({ wmts: {} });
        expect(url).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it("returns null for invalid GetCapabilities URL", async () => {
        const url = await resolveWmtsTilesUrl({
            wmts: { getCapabilitiesUrl: "javascript:evil()" },
        });
        expect(url).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it("respects AbortSignal cancellation", async () => {
        const abortError = new DOMException("aborted", "AbortError");
        global.fetch = vi.fn().mockRejectedValue(abortError);
        const ac = new AbortController();
        const def = {
            wmts: { getCapabilitiesUrl: "https://example.com/WMTSCapabilities.xml" },
        };
        const url = await resolveWmtsTilesUrl(def, ac.signal);
        expect(url).toBeNull();
    });

    it("returns null when extracted tile URL fails security validation", async () => {
        // XML with a non-HTTP tile URL (e.g. javascript: protocol)
        const nsDecl = 'xmlns:ows="http://www.opengis.net/ows/1.1"';
        const maliciousXml = `<?xml version="1.0"?>
<Capabilities ${nsDecl}>
  <Contents>
    <Layer>
      <ows:Identifier>EVIL</ows:Identifier>
      <ResourceURL resourceType="tile" template="javascript:evil()/{z}/{x}/{y}"/>
      <TileMatrixSetLink><TileMatrixSet>PM</TileMatrixSet></TileMatrixSetLink>
    </Layer>
  </Contents>
</Capabilities>`;
        mockFetch({ body: maliciousXml });
        const def = {
            wmts: { getCapabilitiesUrl: "https://example.com/WMTSCapabilities.xml" },
        };
        const url = await resolveWmtsTilesUrl(def);
        expect(url).toBeNull();
    });

    it("returns null when XML has no Layer elements at all", async () => {
        const nsDecl = 'xmlns:ows="http://www.opengis.net/ows/1.1"';
        const emptyXml = `<?xml version="1.0"?><Capabilities ${nsDecl}><Contents></Contents></Capabilities>`;
        mockFetch({ body: emptyXml });
        const def = {
            wmts: { getCapabilitiesUrl: "https://example.com/WMTSCapabilities.xml" },
        };
        const url = await resolveWmtsTilesUrl(def);
        expect(url).toBeNull();
    });

    it("returns null when Layer elements have no Identifier children", async () => {
        const nsDecl = 'xmlns:ows="http://www.opengis.net/ows/1.1"';
        const noIdXml = `<?xml version="1.0"?>
<Capabilities ${nsDecl}>
  <Contents>
    <Layer>
      <ResourceURL resourceType="tile" template="https://example.com/{z}/{x}/{y}.png"/>
      <TileMatrixSetLink><TileMatrixSet>PM</TileMatrixSet></TileMatrixSetLink>
    </Layer>
  </Contents>
</Capabilities>`;
        mockFetch({ body: noIdXml });
        const def = {
            wmts: { getCapabilitiesUrl: "https://example.com/WMTSCapabilities.xml" },
        };
        const url = await resolveWmtsTilesUrl(def);
        expect(url).toBeNull();
    });

    it("clears cache via _clearWmtsCache", async () => {
        mockFetch({ body: makeWmtsXml() });
        const def = {
            wmts: { getCapabilitiesUrl: "https://example.com/WMTSCapabilities.xml" },
        };
        await resolveWmtsTilesUrl(def);
        expect(_getWmtsCache().size).toBe(1);
        _clearWmtsCache();
        expect(_getWmtsCache().size).toBe(0);
    });
});

// ─── buildWmsUrl ──────────────────────────────────────────────────────────────

describe("buildWmsUrl", () => {
    const BASE_DEF = {
        wms: {
            url: "https://example.com/wms",
            layers: "LAYER1,LAYER2",
        },
    };

    it("builds a WMS URL with required parameters", () => {
        const url = buildWmsUrl(BASE_DEF);
        expect(url).toBeTruthy();
        expect(url).toContain("SERVICE=WMS");
        expect(url).toContain("REQUEST=GetMap");
        expect(url).toContain("LAYERS=LAYER1%2CLAYER2");
        expect(url).toContain("BBOX={bbox-epsg-3857}");
    });

    it("preserves {bbox-epsg-3857} placeholder unencoded (MapLibre requires this)", () => {
        const url = buildWmsUrl(BASE_DEF);
        expect(url).toContain("{bbox-epsg-3857}");
        expect(url).not.toContain("%7B");
        expect(url).not.toContain("%7D");
    });

    it("uses WMS defaults: version 1.3.0, CRS EPSG:3857, size 256", () => {
        const url = buildWmsUrl(BASE_DEF);
        expect(url).toContain("VERSION=1.3.0");
        expect(url).toContain("CRS=EPSG%3A3857");
        expect(url).toContain("WIDTH=256");
        expect(url).toContain("HEIGHT=256");
    });

    it("overrides defaults with config values", () => {
        const def = {
            wms: {
                url: "https://example.com/wms",
                layers: "LAYER",
                version: "1.1.1",
                crs: "EPSG:4326",
                tileSize: 512,
                transparent: false,
            },
        };
        const url = buildWmsUrl(def);
        expect(url).toContain("VERSION=1.1.1");
        expect(url).toContain("CRS=EPSG%3A4326");
        expect(url).toContain("WIDTH=512");
        expect(url).toContain("TRANSPARENT=FALSE");
    });

    it("returns null when wms.url is missing", () => {
        expect(buildWmsUrl({ wms: { layers: "LAYER" } })).toBeNull();
    });

    it("returns null when wms.layers is missing", () => {
        expect(buildWmsUrl({ wms: { url: "https://example.com/wms" } })).toBeNull();
    });

    it("returns null for invalid WMS URL", () => {
        expect(buildWmsUrl({ wms: { url: "javascript:evil()", layers: "LAYER" } })).toBeNull();
    });
});
