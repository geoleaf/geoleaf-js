#!/usr/bin/env node
/**
 * PROBE: from which zoom does a CORRIDOR around a route cost fewer tiles than that
 * route's BOUNDING RECTANGLE?
 *
 * 🛑 **Why it is committed before the work engages.** The measurement that takes this
 * batch from 40 h to 55 h lived in a session scratchpad: it was no longer replayable.
 * It is the project's only design decision that depends on an order of magnitude —
 * hence the only place where "a verdict that cannot be re-measured fossilizes" has
 * already bitten.
 *
 * 🛑 **It IMPORTS `latLngToTile`, it does not copy it.** Copying it would be the
 * forbidden move: an identical copy diverges as soon as the original moves, and a
 * probe measuring a copy measures nothing of what runs.
 *
 * ⚠️ **The import goes through the package's PUBLIC SUBPATH**, not the source file.
 * This probe's first version imported `../packages/core/src/.../tile-math.ts` under
 * `--experimental-strip-types`, on the faith of a preflight concluding "not publicly
 * exported" — true of the main entry, FALSE of the subpaths. `offline-ui` has always
 * imported this very module that way, and the resolution works from `scripts/`,
 * measured.
 *
 * What the fix removes: an experimental flag the execution depended on, and a
 * `@ts-expect-error` directive to silence the tooling typecheck. **Two pieces of
 * machinery were holding up a preflight conclusion one notch too wide.**
 *
 * ⚠️ What is new here, and legitimately: the counting of a CORRIDOR. It exists
 * nowhere in the repo — it is copied from nothing.
 *
 * Usage:
 *   node scripts/probe-corridor-cost.mjs
 *   node scripts/probe-corridor-cost.mjs --buffer 500 --zoom 8:16
 *
 * ⚠️ It reads the BUILT package: run `npx turbo run build --filter=@geoleaf/core`
 * first if `dist/` is absent. The price of the public subpath — and the trade is
 * good, since what the probe measures is then exactly what consumers execute.
 *
 * Instruction probe: NOT gated, never wired into `ci:local`. It answers a design
 * question, it guards nothing.
 */
import { latLngToTile } from "@geoleaf/core/capabilities/offline/cache/tile-math.js";

/** Web Mercator's maximum latitude — the same as the `offline` capability's. */
const MAX_LAT = 85.0511287798;

/**
 * A realistic route: ~42 km of coastal road on Réunion Island, 60 vertices.
 *
 * ⚠️ A REAL route and not a straight segment, and that is not cosmetic: a corridor
 * around a straight line occupies a constant fraction of its rectangle, so the
 * crossover would fall at the same zoom whatever the route. What decides for real is
 * SINUOSITY — an itinerary that turns fills its rectangle, one that runs straight
 * leaves it empty.
 */
function sampleRoute(scale, wiggle = 1, axis = false) {
    const pts = [];
    const lat0 = -20.8823;
    const lng0 = 55.4504;
    for (let i = 0; i < 60; i++) {
        const t = i / 59;
        // A south-east descent, with two inflections — the shape of a road following relief.
        pts.push([
            lng0 + (t * 0.42 + Math.sin(t * Math.PI * 2) * 0.035 * wiggle) * scale,
            // `axis` pins the latitude: the route runs due east, and its rectangle is thin.
            axis ? lat0 : lat0 - (t * 0.31 - Math.cos(t * Math.PI * 3) * 0.028 * wiggle) * scale,
        ]);
    }
    return pts;
}

/**
 * 🛑 **Three LENGTHS, and it is the deciding factor.**
 *
 * A corridor costs roughly the route's length times the buffer; a bbox costs the
 * rectangle's area. On a LONG route, the area grows squared and the corridor wins
 * early. On a SHORT route, the rectangle is already small and the buffer overflows it
 * — the case the design decision names, and it cannot be seen when measuring a single
 * scale.
 *
 * ⚠️ The original probe measured only one, and concluded "crossover at zoom 10" with
 * no validity domain. A right measurement on one case says nothing of its neighbour.
 */
const SCALES = [
    { label: "court · sinueux", scale: 0.05, wiggle: 1 },
    { label: "moyen · sinueux", scale: 0.25, wiggle: 1 },
    { label: "long · sinueux", scale: 1, wiggle: 1 },
    // 🛑 **The deciding factor is neither length nor sinuosity: it is the SHARE of
    // the rectangle the route fills.** This probe only varied the length and
    // concluded "long ⇒ the corridor wins"; then, sinuosity added, a "straight" route
    // still won — because it was DIAGONAL, and a diagonal has a square bounding
    // rectangle, i.e. the bbox's worst case.
    //
    // The case that flips the verdict is an AXIS-ALIGNED route: its rectangle is
    // thin, barely wider than its own corridor, and the buffer suffices to overflow
    // it. Compare the last two lines — same length, opposite verdicts.
    { label: "long · diagonal", scale: 1, wiggle: 0 },
    { label: "long · ALIGNÉ", scale: 1, wiggle: 0, axis: true },
];

/**
 * A route's bounding rectangle.
 *
 * @param {number[][]} line The route, as `[longitude, latitude]`.
 * @returns {{north: number, south: number, east: number, west: number}} The bounds.
 */
function boundsOf(line) {
    let north = -90;
    let south = 90;
    let east = -180;
    let west = 180;
    for (const [lng, lat] of line) {
        if (lat > north) north = lat;
        if (lat < south) south = lat;
        if (lng > east) east = lng;
        if (lng < west) west = lng;
    }
    return { north, south, east, west };
}

/**
 * A rectangle's tile count, at a zoom.
 *
 * ⚠️ Same shape as `vector-zone-estimate.ts`'s `countTilesForBounds`, and for the
 * same reason `latLngToTile` is imported: IT carries the arithmetic, the rest is two
 * differences and a multiplication. What the probe must not copy is the
 * lat/lng → tile conversion, and it does not.
 *
 * @param {{north: number, south: number, east: number, west: number}} b The bounds.
 * @param {number} zoom The zoom level.
 * @returns {number} The tile count.
 */
function bboxTiles(b, zoom) {
    const min = latLngToTile(b.south, b.west, zoom, MAX_LAT);
    const max = latLngToTile(b.north, b.east, zoom, MAX_LAT);
    return (Math.abs(max.x - min.x) + 1) * (Math.abs(min.y - max.y) + 1);
}

/**
 * A CORRIDOR's tile count: the union of tiles within `bufferM` of the route.
 *
 * ⚠️ The route is resampled before being walked. Without that, two vertices a
 * kilometre apart would leave a HOLE in the corridor at high zoom — the tiles between
 * them would never be visited, and the probe would render a corridor cheaper than the
 * real one. A too-low number here would engage the work on savings that do not exist.
 *
 * @param {number[][]} line The route, as `[longitude, latitude]`.
 * @param {number} zoom The zoom level.
 * @param {number} bufferM The buffer radius, in METRES.
 * @returns {number} The distinct tile count.
 */
function corridorTiles(line, zoom, bufferM) {
    const tiles = new Set();
    // One degree of latitude ≈ 111,320 m; longitude contracts with the cosine.
    const dLat = bufferM / 111_320;
    for (const [lng, lat] of densify(line, bufferM)) {
        const dLng = bufferM / (111_320 * Math.cos((lat * Math.PI) / 180));
        const a = latLngToTile(lat - dLat, lng - dLng, zoom, MAX_LAT);
        const b = latLngToTile(lat + dLat, lng + dLng, zoom, MAX_LAT);
        for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
            for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
                tiles.add(`${x}/${y}`);
            }
        }
    }
    return tiles.size;
}

/**
 * The route, resampled so no step exceeds `stepM`.
 *
 * @param {number[][]} line The route.
 * @param {number} stepM The maximum step, in METRES.
 * @returns {number[][]} The densified route.
 */
function densify(line, stepM) {
    const out = [];
    for (let i = 0; i < line.length - 1; i++) {
        const [x1, y1] = line[i];
        const [x2, y2] = line[i + 1];
        const metres = Math.hypot(
            (x2 - x1) * 111_320 * Math.cos((((y1 + y2) / 2) * Math.PI) / 180),
            (y2 - y1) * 111_320
        );
        const n = Math.max(1, Math.ceil(metres / stepM));
        for (let k = 0; k < n; k++) {
            out.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]);
        }
    }
    out.push(line[line.length - 1]);
    return out;
}

/**
 * Reads a command-line argument.
 *
 * @param {string} name The flag name, without dashes.
 * @param {string} fallback The default value.
 * @returns {string} The value.
 */
function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const [zMin, zMax] = arg("zoom", "6:17").split(":").map(Number);
const buffers = arg("buffer", "250,500,1000").split(",").map(Number);

console.log("");
console.log("── corridor contre bbox — sonde d'instruction ──");
console.log("");
console.log("  arithmétique : latLngToTile IMPORTÉ de tile-math.ts — jamais recopié");

for (const { label, scale, wiggle, axis } of SCALES) {
    const line = sampleRoute(scale, wiggle, axis);
    const bounds = boundsOf(line);
    const diag = Math.hypot(
        (bounds.east - bounds.west) * 111_320 * Math.cos((bounds.north * Math.PI) / 180),
        (bounds.north - bounds.south) * 111_320
    );

    console.log("");
    console.log(`  ── tracé ${label} — diagonale du rectangle ≈ ${(diag / 1000).toFixed(1)} km ──`);
    const header = ["zoom", "bbox", ...buffers.map((b) => `corr. ${b}m`), "gagnant"];
    console.log("  " + header.map((h) => h.padStart(13)).join(""));
    console.log("  " + "─".repeat(13 * header.length));

    /** @type {Record<number, number|null>} */
    const crossover = {};
    for (const b of buffers) crossover[b] = null;
    let bboxWins = 0;

    for (let z = zMin; z <= zMax; z++) {
        const bb = bboxTiles(bounds, z);
        const cells = buffers.map((b) => corridorTiles(line, z, b));
        cells.forEach((c, i2) => {
            if (crossover[buffers[i2]] === null && c < bb) crossover[buffers[i2]] = z;
        });
        // 🛑 The INVERSE WITNESS: the zooms where the BBOX wins. Without it, "the
        // corridor is better" would be a conclusion with no validity domain — and
        // that is precisely what the design decision refuses, by mandating that the
        // list path be added ALONGSIDE the bbox path.
        const best = Math.min(...cells) < bb ? "corridor" : "BBOX";
        if (best === "BBOX") bboxWins += 1;
        console.log(
            "  " +
                [String(z), String(bb), ...cells.map(String), best]
                    .map((c) => c.padStart(13))
                    .join("")
        );
    }

    for (const b of buffers) {
        const z = crossover[b];
        console.log(
            `    tampon ${String(b).padStart(5)} m  →  ` +
                (z === null
                    ? "JAMAIS sur la plage mesurée — la bbox gagne partout"
                    : `bascule au zoom ${z}`)
        );
    }
    console.log(`    la bbox gagne sur ${bboxWins} zoom(s) de la plage.`);
}

console.log("");
console.log("  ⚠️ La bascule DÉPEND DE LA LONGUEUR du tracé : un corridor coûte la longueur");
console.log("     fois le tampon, une bbox coûte une AIRE. Plus le tracé est long, plus tôt le");
console.log("     corridor gagne. C'est le motif de D15 — la voie liste s'AJOUTE à la voie");
console.log("     bbox, elle ne la remplace pas, parce qu'il existe des tracés où la bbox est");
console.log("     moins chère et ils ne sont pas rares.");
console.log("");
console.log("  🛑 Le facteur qui décide n'est ni la longueur ni la sinuosité : c'est la PART du");
console.log("     rectangle que le tracé remplit. Une diagonale a un rectangle CARRÉ — le pire");
console.log("     cas pour la bbox — quand un tracé aligné sur un axe a un rectangle mince, à");
console.log("     peine plus large que son propre corridor. Comparer les deux dernières lignes :");
console.log("     même longueur, verdicts opposés.");
console.log("");
