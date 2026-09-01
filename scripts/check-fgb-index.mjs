/**
 * check-fgb-index.mjs — report the spatial-index status of FlatGeobuf files.
 *
 * Bbox / HTTP-Range filtering (plugin-flatgeobuf `loadBbox` / `loadBboxAsLayer` /
 * declarative `data.bbox`) requires the file to carry an R-tree index
 * (`indexNodeSize > 0`). The `flatgeobuf` JS `serialize()` does NOT write one — use
 * GDAL `ogr2ogr -f FlatGeobuf -lco SPATIAL_INDEX=YES` (see scripts/FGB_DATA_PREP.md).
 *
 * Usage:  node scripts/check-fgb-index.mjs <file.fgb> [<file2.fgb> ...]
 */
import { readFileSync } from "node:fs";
import { ByteBuffer } from "flatbuffers";
import { fromByteBuffer } from "flatgeobuf/lib/mjs/header-meta.js";
import { magicbytes } from "flatgeobuf/lib/mjs/constants.js";

const files = process.argv.slice(2);
if (files.length === 0) {
    console.error("Usage: node scripts/check-fgb-index.mjs <file.fgb> [...]");
    process.exit(1);
}

for (const p of files) {
    try {
        const u8 = new Uint8Array(readFileSync(p));
        const h = fromByteBuffer(new ByteBuffer(u8.subarray(magicbytes.length)));
        const indexed =
            h.indexNodeSize > 0 ? "INDEXED ✓ (bbox/Range OK)" : "NO INDEX ✗ (full-file only)";
        console.log(
            `${p}\n  indexNodeSize=${h.indexNodeSize}  featuresCount=${h.featuresCount}  geometryType=${h.geometryType}  → ${indexed}`
        );
    } catch (e) {
        console.log(`${p}\n  ERROR: ${e.message}`);
    }
}
