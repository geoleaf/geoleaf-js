/*
 * Generates a tiny, valid georeferenced GeoTIFF used as the COG fixture for the
 * plugin-cog e2e suite (17-cog.spec.js). Uses the `geotiff` dependency already
 * present in the workspace — no external GDAL/QGIS required.
 *
 * The output is a 16x16 RGB (uint8) image georeferenced over French Guiana
 * (bbox [-54, 3, -53, 4] in EPSG:4326). It is NOT internally tiled, so it has
 * a single IFD (overviewCount === 0) — overview selection stays covered by the
 * unit tests; the e2e only needs a real file the bundled geotiff.js can decode.
 *
 * Run:  node e2e/fixtures/_gen-cog.cjs
 * Output: e2e/fixtures/sample-cog.tif
 */

/* eslint-disable no-console -- dev-only CLI fixture generator: console output + inline verification are intentional */

const fs = require("fs");
const path = require("path");
const { writeArrayBuffer, fromArrayBuffer } = require("geotiff");

// ─── Fixture geometry ──────────────────────────────────────────────────────
const W = 16;
const H = 16;
const WEST = -54;
const SOUTH = 3;
const EAST = -53;
const NORTH = 4;

/** Builds one band as a H×W matrix using a per-pixel fill function. */
function band(fill) {
    return Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => fill(x, y)));
}

// Recognizable gradient so a human can eyeball the rendered raster if needed.
const R = band((x) => (x * 16) & 255);
const G = band((_x, y) => (y * 16) & 255);
const B = band(() => 128);

// 3-D [band][row][column] form — geotiff derives width/height/bandCount from it.
const values = [R, G, B];

const metadata = {
    ModelPixelScale: [(EAST - WEST) / W, (NORTH - SOUTH) / H, 0],
    ModelTiepoint: [0, 0, 0, WEST, NORTH, 0],
    GeographicTypeGeoKey: 4326,
    GTModelTypeGeoKey: 2, // geographic
    GTRasterTypeGeoKey: 1, // RasterPixelIsArea
    PhotometricInterpretation: 2, // RGB
};

const outPath = path.join(__dirname, "sample-cog.tif");

async function main() {
    const arrayBuffer = writeArrayBuffer(values, metadata);
    fs.writeFileSync(outPath, Buffer.from(arrayBuffer));

    // ─── Round-trip verification (mirrors plugin-cog cog-loader.getCogInfo) ──
    const tiff = await fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const bbox = image.getBoundingBox();
    const imageCount = await tiff.getImageCount();

    // geotiff >= 3 exposes parsed geo keys via getGeoKeys() (fileDirectory is an
    // ImageFileDirectory instance, no longer a plain object keyed by tag name).
    const gk = image.getGeoKeys ? image.getGeoKeys() : null;
    const epsg = gk ? (gk.ProjectedCSTypeGeoKey ?? gk.GeographicTypeGeoKey ?? null) : null;

    const info = {
        bytes: arrayBuffer.byteLength,
        bounds: bbox.map((n) => Math.round(n * 1000) / 1000),
        width: image.getWidth(),
        height: image.getHeight(),
        bandCount: image.getSamplesPerPixel(),
        overviewCount: imageCount - 1,
        epsg,
    };

    // Assertions — fail loudly so a broken fixture is caught at generation time.
    const expected = { width: W, height: H, bandCount: 3, overviewCount: 0, epsg: 4326 };
    const bExp = [WEST, SOUTH, EAST, NORTH];
    const ok =
        info.width === expected.width &&
        info.height === expected.height &&
        info.bandCount === expected.bandCount &&
        info.overviewCount === expected.overviewCount &&
        info.epsg === expected.epsg &&
        bExp.every((v, i) => Math.abs(info.bounds[i] - v) < 1e-6);

    console.log("Wrote", outPath);
    console.log(JSON.stringify(info, null, 2));
    if (!ok) {
        console.error("FIXTURE ROUND-TRIP MISMATCH — expected", expected, bExp);
        process.exit(1);
    }
    console.log("Round-trip OK ✓");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
