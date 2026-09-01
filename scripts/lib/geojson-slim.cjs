"use strict";
/**
 * geojson-slim.cjs — slims a GeoJSON at DEPLOY time, without touching the source.
 *
 * ## What the measurement said, and the task statement did not
 *
 * The deploy-time slimming asked to "simplify the geometries (Douglas-Peucker)" of the
 * three heavy layers, announcing "−60 to −80 %". Both halves of that sentence were
 * disproved by the 2026-08-07 preflight:
 *
 * **① The dominant lever is NOT the vertex count, it is PRECISION.** The three files carry
 * up to **15 decimals** (average 9.6 on `aires_protegees_nationales_sib`) — nanometre
 * scale for a web map. Rounding to 5 decimals — **≈1.1 m on the ground**, three orders of
 * magnitude below the pixel at any shipped zoom — removes **26.9 %** on its own, without
 * dropping a single vertex.
 *
 * **② The "−60 to −80 %" is unreachable at any reasonable tolerance.** Measured on these
 * exact files, rounding included: −29.1 % at 6 m, −30.0 % at 11 m, −38.7 % at 22 m, and
 * **only −52.5 % at 56 m** — a tolerance at which coastal outlines visibly lose detail.
 * The announced figure was the algorithm's usual expectation on raw data, not a
 * measurement on this data.
 *
 * The chosen setting — **5 decimals + 11 m** — is where the curve flattens: going to 22 m
 * buys 8 more points and starts to show.
 *
 * ## ⚠️ What this module does NOT do — to know before raising the tolerance
 *
 * The simplification is **per geometry, with no shared topology**. Two adjacent polygons
 * (two abutting protected areas) are simplified independently, so their common border can
 * diverge and open a sliver. At 11 m that sliver is below the pixel at every shipped zoom
 * — that is what makes the setting safe, not a property of the algorithm. **Beyond that, a
 * TOPOLOGICAL simplifier is needed** (`mapshaper -simplify`), not a higher tolerance here.
 * Do not raise this number without changing tools.
 *
 * @module scripts/lib/geojson-slim
 */

/**
 * Perpendicular distance of a point to segment [a, b], in degrees.
 *
 * ⚠️ The computation is PLANAR, on raw degrees. That is legitimate here and only here:
 * the tolerance serves as a rejection threshold, not a published metric measurement, and
 * a planar's longitude error (cos φ) only makes the filter more CONSERVATIVE away from
 * the equator — it removes less, never more. The day this module served to measure rather
 * than filter, this shortcut would no longer hold.
 *
 * @param {number[]} p
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function perpendicularDistance(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Ramer–Douglas–Peucker, **iterative**.
 *
 * ⚠️ The natural recursive form stacks one frame per kept vertex in the worst case. One
 * layer in this repo carries 46,941 vertices and a single `LineString` can concentrate
 * several thousand: the recursive version blows the stack on real data, not on a
 * theoretical edge case. The explicit stack below is not a style preference.
 *
 * @param {number[][]} points
 * @param {number} epsilon Tolerance in degrees.
 * @returns {number[][]} Subset of the input points, endpoints always kept.
 */
function simplifyPath(points, epsilon) {
    if (points.length < 3) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length > 0) {
        const [first, last] = stack.pop();
        let maxDist = 0;
        let index = -1;
        for (let i = first + 1; i < last; i++) {
            const d = perpendicularDistance(points[i], points[first], points[last]);
            if (d > maxDist) {
                maxDist = d;
                index = i;
            }
        }
        if (index !== -1 && maxDist > epsilon) {
            keep[index] = 1;
            stack.push([first, index], [index, last]);
        }
    }
    const out = [];
    for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
    return out;
}

/**
 * Rounds every coordinate of a nested geometry.
 *
 * `Number(v.toFixed(d))` rather than `Math.round(v * 10**d) / 10**d`: the latter keeps
 * binary tails (`-53.60000000000001`) that go back into JSON at their original length,
 * saving zero bytes — which is the whole point of the operation.
 *
 * @param {unknown} coords
 * @param {number} decimals
 * @returns {unknown}
 */
function roundCoords(coords, decimals) {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === "number") {
        return coords.map((v) => (typeof v === "number" ? Number(v.toFixed(decimals)) : v));
    }
    return coords.map((c) => roundCoords(c, decimals));
}

/**
 * Simplifies a nested geometry, honouring each type's invariants.
 *
 * 🛑 TWO INVARIANTS A BARE RDP BREAKS, INVISIBLE TO THE EYE IN THE JSON:
 *
 *   • **A ring must stay CLOSED** — first vertex identical to the last. RDP always keeps
 *     the endpoints, so closure survives; that is true by construction, not by caution,
 *     and it would stop being true under a different algorithm.
 *   • **A ring needs at least 4 positions** (3 distinct + the closure). Below that, the
 *     polygon is degenerate: MapLibre does not draw it and says nothing. We then keep the
 *     ORIGINAL ring rather than emit invalid geometry — losing the savings on a handful
 *     of tiny rings costs less than a shape vanishing in silence.
 *
 * @param {unknown} coords
 * @param {number} epsilon
 * @param {boolean} isRing True as soon as we descend into a (Multi)Polygon.
 * @returns {unknown}
 */
function simplifyCoords(coords, epsilon, isRing) {
    if (!Array.isArray(coords) || coords.length === 0) return coords;
    if (typeof coords[0][0] === "number") {
        const simplified = simplifyPath(/** @type {number[][]} */ (coords), epsilon);
        const floor = isRing ? 4 : 2;
        return simplified.length >= floor ? simplified : coords;
    }
    return coords.map((c) => simplifyCoords(c, epsilon, isRing));
}

/**
 * Slims a GeoJSON document: simplification then rounding, in that order.
 *
 * ⚠️ **The order is not indifferent.** Rounding first creates exactly collinear vertices
 * that RDP then removes — the result would be the same in size, but the tolerance would
 * no longer apply to the SOURCE geometry, so the 11 m threshold would no longer mean
 * 11 m. We simplify on the original data, then round what remains.
 *
 * Features without geometry (`null`, empty `GeometryCollection`) pass through intact: a
 * valid GeoJSON may carry them, and dropping them would change the feature count.
 *
 * @param {Buffer|string} input The source document.
 * @param {object} opts
 * @param {number} opts.decimals Decimals kept (5 ≈ 1.1 m).
 * @param {number} opts.toleranceDeg RDP tolerance in degrees (0 to only round).
 * @returns {{ json: string, verticesBefore: number, verticesAfter: number }}
 * @throws {SyntaxError} If the input is not JSON — rethrown as-is: an unreadable data file
 *   must fail the build, not get copied in silence.
 */
function slimGeoJSON(input, { decimals, toleranceDeg }) {
    const doc = JSON.parse(typeof input === "string" ? input : input.toString("utf-8"));
    let verticesBefore = 0;
    let verticesAfter = 0;
    const count = (c) => {
        if (!Array.isArray(c) || c.length === 0) return 0;
        if (typeof c[0] === "number") return 1;
        let n = 0;
        for (const x of c) n += count(x);
        return n;
    };

    const geometries = [];
    const collect = (node) => {
        if (!node || typeof node !== "object") return;
        if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
            node.features.forEach(collect);
        } else if (node.type === "Feature") {
            collect(node.geometry);
        } else if (node.type === "GeometryCollection" && Array.isArray(node.geometries)) {
            node.geometries.forEach(collect);
        } else if (node.coordinates) {
            geometries.push(node);
        }
    };
    collect(doc);

    for (const geom of geometries) {
        verticesBefore += count(geom.coordinates);
        const isRing = /Polygon$/.test(String(geom.type));
        // A (Multi)Point has no path to simplify — RDP would be pointless there, and
        // `simplifyCoords` would let it through, but skipping it here avoids a useless
        // walk over the POI layers, which have the most features.
        if (toleranceDeg > 0 && !/Point$/.test(String(geom.type))) {
            geom.coordinates = simplifyCoords(geom.coordinates, toleranceDeg, isRing);
        }
        geom.coordinates = roundCoords(geom.coordinates, decimals);
        verticesAfter += count(geom.coordinates);
    }

    return { json: JSON.stringify(doc), verticesBefore, verticesAfter };
}

module.exports = { slimGeoJSON, simplifyPath, roundCoords };
