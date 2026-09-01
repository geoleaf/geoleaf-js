/*!
 * @geoleaf-plugins/routing — Encoded polyline codec
 *
 * Decoding and encoding of Google's encoded-polyline format, with the precision made explicit at
 * every call site.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * ## Why the precision is a parameter and never a default
 *
 * Measured on the fixture corpus, on the same three-waypoint trip: **OSRM encodes at 1e5,
 * Valhalla at 1e6.** Decoded at the wrong factor, Valhalla's Réunion route reads
 * `[-208.82, 554.50]` — not a wrong place, an impossible one, since no latitude exceeds 90.
 *
 * A default would make one of the two providers work and the other fail somewhere far from
 * here, in a consumer that never chose a factor. Making it an argument means the caller has to
 * know what it is decoding, which is the only state in which this function is safe.
 *
 * `RouteResult.geometry` is normalised to **precision 5**, so one decoder serves every provider.
 */

/** The two precisions the supported engines use. */
export type PolylinePrecision = 5 | 6;

/**
 * Decodes an encoded polyline into `[longitude, latitude]` pairs.
 *
 * ⚠️ The output is GeoJSON order — longitude first — while the WIRE format stores latitude
 * first. The swap happens here, once, rather than at each of the places that would otherwise
 * have to remember it.
 *
 * @param encoded The encoded polyline.
 * @param precision Decimal places the producer used — 5 for OSRM, 6 for Valhalla.
 * @returns The coordinates, in GeoJSON order.
 */
export function decodePolyline(encoded: string, precision: PolylinePrecision): [number, number][] {
    const factor = 10 ** precision;
    const out: [number, number][] = [];
    let index = 0;
    let lat = 0;
    let lon = 0;

    while (index < encoded.length) {
        let shift = 0;
        let result = 0;
        let byte: number;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lat += result & 1 ? ~(result >> 1) : result >> 1;

        shift = 0;
        result = 0;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lon += result & 1 ? ~(result >> 1) : result >> 1;

        out.push([lon / factor, lat / factor]);
    }
    return out;
}

/**
 * Encodes `[longitude, latitude]` pairs into an encoded polyline.
 *
 * @param coordinates Coordinates in GeoJSON order.
 * @param precision Decimal places to encode with.
 * @returns The encoded polyline.
 */
export function encodePolyline(
    coordinates: readonly (readonly [number, number])[],
    precision: PolylinePrecision
): string {
    const factor = 10 ** precision;
    let out = "";
    let prevLat = 0;
    let prevLon = 0;

    for (const [lon, lat] of coordinates) {
        const iLat = Math.round(lat * factor);
        const iLon = Math.round(lon * factor);
        out += encodeSigned(iLat - prevLat) + encodeSigned(iLon - prevLon);
        prevLat = iLat;
        prevLon = iLon;
    }
    return out;
}

/**
 * Re-encodes a polyline from one precision to another.
 *
 * 🛑 **Lossy from 6 to 5, and knowingly so.** A degree at 1e6 resolves to about 11 cm and at 1e5
 * to about 1.1 m — below the accuracy of any consumer-grade GPS fix this data will be compared
 * against, and far below the width of the roads it describes. The alternative — carrying the
 * precision alongside every geometry — puts the burden on every consumer forever so that a
 * decimetre nobody can measure survives.
 *
 * @param encoded The polyline as the producer emitted it.
 * @param from Its precision.
 * @param to The precision to emit.
 * @returns The re-encoded polyline, or the input unchanged when the two precisions are equal.
 */
export function reencodePolyline(
    encoded: string,
    from: PolylinePrecision,
    to: PolylinePrecision
): string {
    if (from === to) return encoded;
    return encodePolyline(decodePolyline(encoded, from), to);
}

/**
 * The variable-length signed encoding shared by both directions.
 *
 * @param value Delta to encode.
 * @returns Its encoded form.
 */
function encodeSigned(value: number): string {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let out = "";
    while (v >= 0x20) {
        out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
    }
    out += String.fromCharCode(v + 63);
    return out;
}
