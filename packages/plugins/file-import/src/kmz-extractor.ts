/*!
 * GeoLeaf File Import Plugin — KMZ Extractor
 * Decompresses KMZ (zipped KML) and extracts the inner .kml file.
 *
 * Uses fflate for ZIP decompression (lightweight, no Node.js deps).
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { unzipSync } from "fflate";

/** Maximum total decompressed size (50 MB) — zip-bomb protection. */
const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;

/**
 * Extract the KML content string from a KMZ (ZIP) buffer.
 * @param data - The raw KMZ file as a Uint8Array.
 * @returns The KML string content, or null if no .kml file found.
 */
export function extractKmlFromKmz(data: Uint8Array): { kml: string | null; warnings: string[] } {
    const warnings: string[] = [];

    const overSizeWarning = `KMZ archive exceeds maximum decompressed size (${MAX_DECOMPRESSED_BYTES / 1024 / 1024} MB)`;

    try {
        // Zip-bomb guard, FIRST line: fflate reads each entry's declared decompressed
        // size from the central directory BEFORE inflating it, so we refuse to inflate
        // once the declared total across all entries exceeds the cap — the bomb never
        // lands in memory. We also only inflate `.kml` entries; the rest of the archive
        // is irrelevant to KMZ and need not be decompressed at all.
        //
        // `originalSize` lives inside the archive and is therefore attacker-controlled,
        // so this is a gate, not a proof — see the post-inflate check below.
        let declaredTotal = 0;
        let bombDetected = false;

        // Shape annotated at the boundary rather than inferred. `fflate` exposes its
        // types through a conditional `exports` map (`.` / `./node` / `./browser`),
        // and the ESLint type-aware project service does not always resolve that the
        // way `tsc -p` does — it then sees an `error` type and every downstream use
        // trips no-unsafe-*. `Unzipped` IS `Record<string, Uint8Array>`, so this
        // states the real contract instead of widening it: no type safety is lost,
        // and the resolution quirk stops leaking into three unrelated diagnostics.
        const files: Record<string, Uint8Array> = unzipSync(data, {
            filter: (file) => {
                declaredTotal += file.originalSize;
                if (declaredTotal > MAX_DECOMPRESSED_BYTES) {
                    bombDetected = true;
                    return false;
                }
                return file.name.toLowerCase().endsWith(".kml");
            },
        });

        if (bombDetected) {
            warnings.push(overSizeWarning);
            return { kml: null, warnings };
        }

        // Zip-bomb guard, SECOND line: sum the bytes we ACTUALLY inflated (real, not the
        // archive's claim). Catches an entry that under-reports its `originalSize` to
        // slip past the declared-size gate above.
        let actualTotal = 0;
        for (const content of Object.values(files)) {
            actualTotal += content.length;
            if (actualTotal > MAX_DECOMPRESSED_BYTES) {
                warnings.push(overSizeWarning);
                return { kml: null, warnings };
            }
        }

        // Find the first .kml file (usually doc.kml)
        const kmlEntry = Object.keys(files).find((name) => name.toLowerCase().endsWith(".kml"));

        if (!kmlEntry) {
            warnings.push("No .kml file found inside KMZ archive");
            return { kml: null, warnings };
        }

        const kmlBytes = files[kmlEntry];
        const kml = new TextDecoder().decode(kmlBytes);
        return { kml, warnings };
    } catch (err) {
        warnings.push(`KMZ decompression error: ${(err as Error).message}`);
        return { kml: null, warnings };
    }
}
