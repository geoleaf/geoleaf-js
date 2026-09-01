/**
 * Fuzzing of the four file-import converters (security roadmap B.3).
 *
 * The converters parse UNTRUSTED input (a user's file -> GeoJSON). Their contract: whatever
 * the input, `convert()` NEVER throws (try/catch -> emptyFC() + warnings), returns a
 * well-formed FeatureCollection, TERMINATES (no ReDoS), and writes no key onto
 * `Object.prototype` (a key from an arbitrary file may be `__proto__`).
 *
 * Deterministic, dependency-free fuzzer: a seeded LCG feeds both noise (Unicode, XML/CSV/JSON
 * meta-characters) and STRUCTURED skeletons (recombined fragments) — pure noise is rejected at
 * the parse and only exercises the error path, so semi-valid input is needed to reach the
 * enrichment path. A fixed seed keeps branch coverage STABLE (the coverage thresholds ratchet
 * upward; a non-deterministic fuzzer would make them flaky). An LCG is preferred over
 * `fast-check` to avoid adding a devDependency and a lockfile entry to this package for a set
 * of properties a seeded loop already covers.
 */
import { describe, it, expect } from "vitest";
import { kmlConverter } from "../../converters/kml-converter.js";
import { gpxConverter } from "../../converters/gpx-converter.js";
import { csvConverter } from "../../converters/csv-converter.js";
import { topojsonConverter } from "../../converters/topojson-converter.js";
import type { IFileConverter } from "../../converters/i-converter.js";

// ─── Deterministic PRNG (LCG) ───────────────────────────────────────────────
function makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

/** Adversarial fragments any generator may splice in — the point of the exercise. */
const HOSTILE = [
    "__proto__",
    "constructor",
    "prototype",
    '"><script>x</script>',
    "]]>",
    "&amp;<>\"'",
    " ￾",
    "POINT(1e400 -1e400)",
    "{",
    "\\",
];

// `as T`: the index is always in range for the non-empty arrays used here, but
// `noUncheckedIndexedAccess` widens `arr[i]` to `T | undefined`.
function pick<T>(rng: () => number, arr: readonly T[]): T {
    return arr[Math.floor(rng() * arr.length)] as T;
}

function noise(rng: () => number): string {
    const n = Math.floor(rng() * 60);
    let out = "";
    for (let i = 0; i < n; i++) {
        out += rng() < 0.25 ? pick(rng, HOSTILE) : String.fromCharCode(Math.floor(rng() * 0x2000));
    }
    return out;
}

// ─── Structured, semi-valid skeletons per format ────────────────────────────
function kmlInput(rng: () => number): string {
    const marks = Array.from({ length: Math.floor(rng() * 5) }, () => {
        const coord = `${(rng() * 360 - 180).toFixed(4)},${(rng() * 180 - 90).toFixed(4)}`;
        return (
            `<Placemark><name>${noise(rng)}</name>` +
            `<description>${noise(rng)}</description>` +
            `<ExtendedData><Data name="${pick(rng, HOSTILE)}"><value>${noise(rng)}</value></Data></ExtendedData>` +
            `<Point><coordinates>${rng() < 0.5 ? coord : noise(rng)}</coordinates></Point></Placemark>`
        );
    }).join("");
    return `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${marks}</Document></kml>`;
}

function gpxInput(rng: () => number): string {
    const pts = Array.from({ length: Math.floor(rng() * 5) }, () => {
        const lat = rng() < 0.6 ? (rng() * 180 - 90).toFixed(4) : noise(rng);
        const lon = rng() < 0.6 ? (rng() * 360 - 180).toFixed(4) : noise(rng);
        return `<wpt lat="${lat}" lon="${lon}"><name>${noise(rng)}</name></wpt>`;
    }).join("");
    return `<?xml version="1.0"?><gpx version="1.1">${pts}<trk><trkseg>${pts}</trkseg></trk></gpx>`;
}

function csvInput(rng: () => number): string {
    const header = pick(rng, ["lat,lng,name", "latitude,longitude,label", "y,x,wkt", noise(rng)]);
    const rows = Array.from({ length: Math.floor(rng() * 6) }, () => {
        const cells = [
            rng() < 0.6 ? (rng() * 180 - 90).toFixed(3) : pick(rng, HOSTILE),
            rng() < 0.6 ? (rng() * 360 - 180).toFixed(3) : pick(rng, HOSTILE),
            rng() < 0.4 ? `POINT(${noise(rng)})` : noise(rng),
        ];
        return cells.join(",");
    });
    return [header, ...rows].join("\n");
}

function topojsonInput(rng: () => number): string {
    if (rng() < 0.3) return noise(rng); // pure garbage -> error path
    const obj: Record<string, unknown> = {
        type: rng() < 0.7 ? "Topology" : noise(rng),
        objects: { [pick(rng, HOSTILE)]: { type: "GeometryCollection", geometries: [] } },
        arcs: [],
    };
    if (rng() < 0.5) obj["__proto__"] = { polluted: 1 };
    return JSON.stringify(obj);
}

const CASES: { conv: IFileConverter; gen: (r: () => number) => string; name: string }[] = [
    { conv: kmlConverter, gen: kmlInput, name: "kml" },
    { conv: gpxConverter, gen: gpxInput, name: "gpx" },
    { conv: csvConverter, gen: csvInput, name: "csv" },
    { conv: topojsonConverter, gen: topojsonInput, name: "topojson" },
];

const RUNS = 200;

/**
 * Per-conversion ReDoS ceiling. It guards TERMINATION — the header's third contract —
 * not micro-performance: catastrophic backtracking on inputs this small runs for SECONDS,
 * so a bound three orders of magnitude above the observed cost still catches it, while a
 * tight one only measures the machine.
 *
 * ⚠️ It was 50 ms until 2026-09-01, and that is what it measured: the machine. The fuzzer
 * is SEEDED, so every host converts byte-identical input — only the host differs. Green
 * locally (~0.8 ms per iteration, 16 cores), red on the CI runner at `i=0` with 60.5 ms:
 * the FIRST iteration, cold JIT under istanbul instrumentation on 2-4 shared cores. The
 * assertion never saw a slow INPUT, it saw a slow START.
 *
 * 🛑 The cost is not the red itself but what a random red does to a gate: this repo has
 * measured more than once that a gate reddening without a defect gets disarmed within the
 * week. A ceiling that only a real ReDoS can cross keeps the guard armed.
 */
const REDOS_CEILING_MS = 1000;

describe("converters — fuzzing (B.3)", () => {
    for (const { conv, gen, name } of CASES) {
        it(`${name}: never throws, returns a well-formed FeatureCollection, terminates, does not pollute`, async () => {
            const rng = makeRng(0x9e3779b1 ^ name.length);
            for (let i = 0; i < RUNS; i++) {
                // 1 in 4: pure noise (error path); otherwise structured (enrichment path).
                const input = i % 4 === 0 ? noise(rng) : gen(rng);
                const t0 = performance.now();
                const r = await Promise.resolve(conv.convert(input)); // must never throw
                expect(
                    performance.now() - t0,
                    `${name} did not terminate promptly on i=${i} — suspect ReDoS`
                ).toBeLessThan(REDOS_CEILING_MS);
                expect(r.data.type).toBe("FeatureCollection");
                expect(Array.isArray(r.data.features)).toBe(true);
                expect(Array.isArray(r.warnings)).toBe(true);
            }
            // No key from an arbitrary file reached Object.prototype.
            expect((Object.prototype as Record<string, unknown>)["polluted"]).toBeUndefined();
            expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
        });
    }
});
