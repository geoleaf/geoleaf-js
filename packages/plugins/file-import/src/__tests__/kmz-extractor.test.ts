// @vitest-environment node
//
// kmz-extractor is pure ZIP + TextDecoder logic (no DOM). It runs under the
// `node` environment because fflate's zipSync/strToU8 mis-encode binary under
// happy-dom (a test-env artifact — fflate works correctly in node and in real
// browsers; the full KMZ→File path is validated in e2e/15-file-import.spec.js).
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractKmlFromKmz } from "../kmz-extractor.js";

const KML = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>A</name><Point><coordinates>2,48,0</coordinates></Point></Placemark></Document></kml>`;

// ── Forged over-declaring archive ────────────────────────────────────────────
//
// The zip-bomb test below needs an archive that CLAIMS to be huge while carrying almost
// nothing. Both guards in kmz-extractor.ts push the SAME warning string, so a genuinely
// oversized archive satisfies the assertion through EITHER of them — which is how the
// previous version of this test managed to prove nothing:
//
//   Measured 30/07/2026 — with the declared-size guard deleted outright, the old fixture
//   (a real 60 MB of zeros through zipSync) still passed. The payload got inflated, the
//   post-inflate guard caught it, same message, green. The test could not fail for the
//   reason it is named after, and paid ~6 s of real deflate to do it — 10.5 s under
//   istanbul instrumentation, which is what finally broke the CI coverage gate.
//
// With a tiny payload, `actualTotal` can never cross the cap, so the warning can only come
// from the declared-size gate. Remove that gate and the test goes red, as it should.
//
// fflate 0.8.3 reads the declared size from the CENTRAL DIRECTORY record at offset +24
// (`zh()` → `b4(d, b + 24)`). 0xFFFFFFFF is reserved — it sends fflate hunting for a ZIP64
// extra field — so the forged value must stay below it.
const CDIR_UNCOMPRESSED_SIZE_OFFSET = 24;

/** Offset of the single central-directory record ("PK\x01\x02"), or throw. */
function centralDirectoryOffset(zip: Uint8Array): number {
    const hits: number[] = [];
    for (let i = 0; i + 4 <= zip.length; i++) {
        if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x01 && zip[i + 3] === 0x02) {
            hits.push(i);
        }
    }
    // One entry in, one record out. Any other count means the archive layout is not what
    // this forge assumes, and patching a guessed offset would yield a fixture that silently
    // tests nothing — the exact failure mode this rewrite exists to remove. Fail loudly.
    if (hits.length !== 1) {
        throw new Error(`forge: expected exactly 1 central-directory record, found ${hits.length}`);
    }
    return hits[0];
}

/** A valid tiny KMZ whose central directory declares `declaredBytes` uncompressed. */
function kmzDeclaringSize(declaredBytes: number): Uint8Array {
    const zip = zipSync({ "doc.kml": strToU8(KML) });
    const at = centralDirectoryOffset(zip) + CDIR_UNCOMPRESSED_SIZE_OFFSET;
    zip[at] = declaredBytes & 0xff;
    zip[at + 1] = (declaredBytes >>> 8) & 0xff;
    zip[at + 2] = (declaredBytes >>> 16) & 0xff;
    zip[at + 3] = (declaredBytes >>> 24) & 0xff;
    return zip;
}

describe("kmz-extractor", () => {
    it("extracts the inner .kml from a KMZ (doc.kml) archive", () => {
        const kmz = zipSync({ "doc.kml": strToU8(KML) });
        const { kml, warnings } = extractKmlFromKmz(kmz);
        expect(kml).toContain("<Placemark>");
        expect(kml).toContain("coordinates");
        expect(warnings).toEqual([]);
    });

    it("finds a .kml entry regardless of name/case and subfolder", () => {
        const kmz = zipSync({ "layers/Track.KML": strToU8(KML) });
        const { kml } = extractKmlFromKmz(kmz);
        expect(kml).toContain("<Point>");
    });

    it("warns when the archive contains no .kml entry", () => {
        const kmz = zipSync({ "readme.txt": strToU8("not a kml") });
        const { kml, warnings } = extractKmlFromKmz(kmz);
        expect(kml).toBeNull();
        expect(warnings.some((w) => w.includes("No .kml"))).toBe(true);
    });

    it("warns on a corrupt / non-zip buffer (decompression error)", () => {
        const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        const { kml, warnings } = extractKmlFromKmz(garbage);
        expect(kml).toBeNull();
        expect(warnings.some((w) => w.includes("decompression error"))).toBe(true);
    });

    it("rejects a zip bomb by DECLARED size, before inflating it", () => {
        // The archive carries a handful of bytes but CLAIMS 60 MB, above the 50 MB cap.
        // Only the declared-size gate can refuse this one — there is nothing here large
        // enough for the post-inflate guard to catch — so a pass here is proof the archive
        // was refused on its header alone, without ever being inflated.
        const kmz = kmzDeclaringSize(60 * 1024 * 1024);
        expect(kmz.length).toBeLessThan(1024); // the point: no 60 MB anywhere

        const { kml, warnings } = extractKmlFromKmz(kmz);
        expect(kml).toBeNull();
        expect(warnings.some((w) => w.includes("maximum decompressed size"))).toBe(true);
    });

    it("ignores non-kml entries when locating the KML", () => {
        const kmz = zipSync({
            "images/logo.png": strToU8("not really a png but irrelevant"),
            "doc.kml": strToU8(KML),
        });
        const { kml, warnings } = extractKmlFromKmz(kmz);
        expect(kml).toContain("<Placemark>");
        expect(warnings).toEqual([]);
    });
});
