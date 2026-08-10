/*!
 * Generates e2e/fixtures/sample.kmz from sample.kml (zips it as doc.kml).
 * KMZ = ZIP archive containing a .kml — the plugin's kmz-extractor reads the
 * first .kml entry. Binary fixtures cannot be hand-written, so this one-shot
 * generator produces a deterministic sample.kmz for the e2e file-upload test.
 *
 * Run once via node 22:  node e2e/fixtures/_gen-kmz.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { zipSync, strToU8 } = require("fflate");

const dir = __dirname;
const kml = fs.readFileSync(path.join(dir, "sample.kml"), "utf8");
const zipped = zipSync({ "doc.kml": strToU8(kml) }, { level: 6 });
fs.writeFileSync(path.join(dir, "sample.kmz"), zipped);
console.info(`sample.kmz written: ${zipped.length} bytes`);
