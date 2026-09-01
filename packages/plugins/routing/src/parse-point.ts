/*!
 * @geoleaf-plugins/routing — Typed coordinates
 *
 * Turns what someone types into a point, or says it is not one.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { Waypoint } from "./model.js";

/**
 * ## 🛑 Why `latitude, longitude` and not the model's own order
 *
 * This repository carries positions as `[longitude, latitude]` everywhere, and that is right: it
 * is the GeoJSON order, and flipping it at a boundary is how coordinates end up in the Gulf of
 * Guinea. **The typed field is the one place where the other order is correct.**
 *
 * Two reasons, and neither is preference. A user copying a point from a map application gets
 * `latitude, longitude` — every consumer-facing tool prints that order, so accepting anything else
 * silently relocates their stop. And this package **already renders that order**: an unnamed
 * waypoint appears in the step list as `-21.0964, 55.4781`. A field that would not accept back what
 * the list just showed is a field that fails on the most obvious thing anyone tries.
 *
 * The conversion happens here, once, at the edge — which is the only place a coordinate order
 * should ever be decided.
 *
 * ## Why a bare pair and no other syntax
 *
 * Degrees-minutes-seconds, `N 21° 05'`, plus-codes and geo URIs all exist and all have real users.
 * Accepting them halfway is worse than not accepting them: `21°05'47"S` parsed as `21` is a valid
 * number pointing at the wrong hemisphere, and nothing would say so. A pair or a refusal.
 */

/** What a typed string turned out to be. */
export type ParsedPoint =
    | { readonly ok: true; readonly waypoint: Waypoint }
    | { readonly ok: false; readonly reason: ParseRefusal };

/** Why a string is not a point. */
export type ParseRefusal =
    /** Nothing usable — empty, or no pair of numbers at all. Try geocoding instead. */
    | "not-coordinates"
    /** A pair, but outside the possible range for a latitude or a longitude. */
    | "out-of-range";

/** Latitude beyond this is not a place. */
const MAX_LATITUDE = 90;

/** Longitude beyond this is not a place. */
const MAX_LONGITUDE = 180;

/**
 * Reads `"latitude, longitude"`.
 *
 * Accepts a comma, a semicolon or plain whitespace as the separator, and both decimal marks —
 * `-21,0964` is what a French keyboard produces and refusing it would look like a broken field.
 *
 * ⚠️ **The decimal comma needs a second mark to lean on, and a space is one.** `-21,0964 55,4781`
 * parses, and so does `-21,0964, 55,4781` — the space separates and the commas are decimals.
 * `-21,0964,55,4781` does not: four comma-separated pieces, and nothing says which comma is which.
 *
 * 🛑 That last sentence used to say the form WITH a space was ambiguous too, and a test asserted
 * it. Both were wrong, and the implementation was right — a claim broader than what it describes,
 * caught by writing the case out. Refusing there would have rejected exactly what a French keyboard
 * produces.
 *
 * @param text What was typed.
 * @param name Label for the waypoint, when one is wanted. Omitted, the list shows the coordinates,
 *             which is the honest thing for a point that has no name.
 * @returns The waypoint, or why not.
 */
export function parseTypedPoint(text: string, name?: string): ParsedPoint {
    const raw = (text ?? "").trim();
    if (raw === "") return { ok: false, reason: "not-coordinates" };

    const pair = splitPair(raw);
    if (!pair) return { ok: false, reason: "not-coordinates" };

    const [lat, lon] = pair;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { ok: false, reason: "not-coordinates" };
    }
    if (Math.abs(lat) > MAX_LATITUDE || Math.abs(lon) > MAX_LONGITUDE) {
        return { ok: false, reason: "out-of-range" };
    }

    // Back to the model's order at the edge, and only here.
    return { ok: true, waypoint: { coordinates: [lon, lat], ...(name ? { name } : {}) } };
}

/**
 * Splits a typed string into two numbers.
 *
 * 🛑 **No regular expression, and that is the third version of this function.** The first split on
 * whitespace before looking at commas, so `-21.0964, 55.4781` — the single most likely thing anyone
 * types — came out as `["-21.0964,", "55.4781"]`. The second expressed the accepted forms as
 * patterns and tripped `security/detect-unsafe-regex`, which this repository does not allow to be
 * lowered without a written motive beside the rule. There was no motive worth that here.
 *
 * What is left is a scan, and it happens to say the rule more plainly than the patterns did:
 * **the separator is whichever explicit mark is present, and the decimal mark is then the other
 * one.** The single combination that cannot say which is which — comma decimals with a comma
 * separator — falls through to a refusal rather than being guessed.
 *
 * @param raw The trimmed input.
 * @returns `[latitude, longitude]`, or `null` when it is not an unambiguous pair.
 */
function splitPair(raw: string): [number, number] | null {
    const hasSemicolon = raw.includes(";");
    const hasSpace = /\s/.test(raw);
    const hasComma = raw.includes(",");

    let tokens: string[];
    let decimalComma: boolean;

    if (hasSemicolon) {
        tokens = raw.split(";");
        // A semicolon separates unambiguously, so a comma inside a token is a decimal mark.
        decimalComma = hasComma;
    } else if (hasSpace) {
        // ⚠️ `-21.0964, 55.4781` lands here: whitespace separates AND a comma clings to the end of
        // the first token. Stripping it is what the first version of this function forgot, and the
        // omission was invisible to every test whose separator had no space after it.
        tokens = raw
            .split(/\s+/)
            .filter((t) => t !== "")
            .map((t) => stripEdgeComma(t));
        // A comma SURVIVING the strip is inside a token, so it is a decimal mark. One that did not
        // was the separator, doubled with the space.
        decimalComma = tokens.some((t) => t.includes(","));
    } else if (hasComma) {
        tokens = raw.split(",");
        // Only one mark is present, so it is the separator and the decimals use points.
        decimalComma = false;
    } else {
        return null;
    }

    if (tokens.length !== 2) return null;
    const [a, b] = tokens as [string, string];
    if (a.trim() === "" || b.trim() === "") return null;
    return [num(a, decimalComma), num(b, decimalComma)];
}

/**
 * Removes a comma clinging to either end of a token.
 *
 * @param token The token.
 * @returns The token without its edge comma.
 */
function stripEdgeComma(token: string): string {
    let t = token;
    while (t.startsWith(",")) t = t.slice(1);
    while (t.endsWith(",")) t = t.slice(0, -1);
    return t;
}

/**
 * A number from a token, told which mark its decimals use.
 *
 * ⚠️ Rejects anything carrying a letter before parsing. `Number("0x10")` is `16` and
 * `Number("1e400")` is `Infinity`: both are numbers nobody typed as a coordinate, and both would
 * pass a bare `Number.isFinite` check on the way to a place the user did not name.
 *
 * @param token The token.
 * @param decimalComma Whether its decimals are written with a comma.
 * @returns The number, or `NaN`.
 */
function num(token: string, decimalComma: boolean): number {
    const t = token.trim();
    if (/[a-zA-Z]/.test(t)) return Number.NaN;
    return Number(decimalComma ? t.replace(",", ".") : t);
}
