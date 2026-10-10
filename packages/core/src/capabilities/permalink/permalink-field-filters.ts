/*!
 * GeoLeaf Core – Permalink / Per-field filter grammar
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The per-field filter grammar of a permalink — `gl_f.<descriptor id>=<value>`.
 *
 * 🛑 **Why one parameter per FIELD.** The filter used to be ranged by KIND, in four fixed
 * slots — `gl_filter`, `gl_cats`, `gl_tags`, `gl_rating`. Two fields of the same kind shared a
 * slot, so the second one's value overwrote the first and both were restored with it; a range
 * kept its lower bound only; and the sub-categories of a taxonomy field lost the category they
 * were checked under. A field now has its own parameter, named by the id of its descriptor
 * (`modules.filter.fields[].id`).
 *
 * | Kind       | Value                                                              |
 * | ---------- | ------------------------------------------------------------------ |
 * | `text`     | the query, as typed                                                |
 * | `tag`      | `a,b,c`                                                            |
 * | `range`    | `min..max` — an open bound is left empty: `100..`, `..500`         |
 * | `taxonomy` | `a,b,c`, and its checked sub-categories under `<id>.sub`: `a/x,b/y` |
 *
 * `boolean` and `proximity` are not carried — they never were.
 *
 * ⚠️ **The kind is NOT in the URL.** An entry is read for a descriptor, by that descriptor's
 * kind: `a,b` is a query for a `text` field and two values for a `tag` field. So this module
 * cannot be asked what an entry "is" — only what it is for a given field — and the whitelist
 * of `PermalinkConfig.fields`, which gates by kind, is applied where a kind is known: at the
 * capture and at the restore (`permalink-sync.ts`).
 *
 * PURE — no URL, no DOM, no filter capability. The URL layer carries the entries as an opaque
 * map of strings (`PermalinkState.fieldFilters`).
 */

import { validateNumber } from "../../kernel/security/index.js";
import { isUnsafeKey } from "../../utils/general/object-path-guard.js";
import { MAX_LIST_ITEMS, MAX_TEXT_LEN } from "./constants.js";
import type { PermalinkFilterField } from "./types.js";

/** Prefix of a per-field filter parameter: `gl_f.<descriptor id>`. */
export const FIELD_FILTER_PREFIX = "gl_f.";

/** Suffix, after the descriptor id, of the entry carrying a taxonomy field's sub-categories. */
const SUB_SUFFIX = ".sub";

/** The most per-field entries a link may carry. */
const MAX_FIELD_FILTERS = 50;
/** The longest entry key — a descriptor id, plus the sub-category suffix. */
const MAX_KEY_LEN = 100;
/** The longest entry value: a full list of capped elements, with room for its separators. */
const MAX_VALUE_LEN = 4000;

/**
 * The facet of `PermalinkConfig.fields` that gates each filter kind — the four names the
 * whitelist has always had, each now read as « the fields of that kind ».
 */
const FACET_OF_KIND: ReadonlyMap<string, string> = new Map([
    ["text", "filter"],
    ["taxonomy", "categories"],
    ["tag", "tags"],
    ["range", "rating"],
]);

/**
 * The whitelist facet that gates a filter kind.
 *
 * @param kind - A filter kind (`modules.filter.fields[].kind`).
 * @returns The facet name, or `null` for a kind the permalink does not carry.
 * @example
 * facetOfKind("taxonomy"); // "categories"
 * facetOfKind("boolean"); // null
 */
export function facetOfKind(kind: string): string | null {
    return FACET_OF_KIND.get(kind) ?? null;
}

/**
 * Escapes the three characters the grammar separates with, inside one list element. Only
 * those: an accented id stays readable in the URL, where a full percent-encoding would be
 * encoded a second time by the query string.
 */
function _escape(token: string): string {
    return token.replace(/[%,/]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Reverses {@link _escape} — in one pass, so an escaped `%` cannot re-open a sequence. */
function _unescape(token: string): string {
    return token.replace(/%(25|2C|2F)/gi, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
    );
}

/** A list of elements, in the grammar. */
function _encodeList(values: readonly string[]): string {
    return values.map(_escape).join(",");
}

/** Reads a list back: split, unescaped, emptied of blanks, capped in count and length. */
function _decodeList(raw: string): string[] {
    return raw
        .split(",")
        .map((token) => _unescape(token))
        .filter((token) => token.length > 0)
        .slice(0, MAX_LIST_ITEMS)
        .map((token) => token.slice(0, MAX_TEXT_LEN));
}

/** `min..max`, an open bound left empty — or `null` when the range constrains nothing. */
function _encodeRange(range: PermalinkFilterField["range"]): string | null {
    const bound = (n: number | undefined): string =>
        typeof n === "number" && Number.isFinite(n) ? String(n) : "";
    const min = bound(range?.min);
    const max = bound(range?.max);
    return min === "" && max === "" ? null : `${min}..${max}`;
}

/**
 * One side of `min..max`: `undefined` when it is left open, the bound when it reads as a
 * finite number, `null` when it is given and does not.
 */
function _decodeBound(side: string): number | null | undefined {
    if (side === "") return undefined;
    return side.trim() === "" ? null : validateNumber(side);
}

/**
 * Reads `min..max`. Refused whole when it is not exactly that: one `..`, each side empty or
 * a finite number, and at least one of them given — a bound is never guessed from a value
 * that does not read as one.
 */
function _decodeRange(raw: string): { min?: number; max?: number } | null {
    const sides = raw.split("..");
    if (sides.length !== 2) return null;
    const min = _decodeBound(sides[0] ?? "");
    const max = _decodeBound(sides[1] ?? "");
    if (min === null || max === null) return null;
    if (min === undefined && max === undefined) return null;
    return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
}

/** `category/sub-category` pairs — malformed ones are ignored, like malformed `subValues`. */
function _decodeSubValues(raw: string | undefined): Array<{ value: string; category: string }> {
    if (!raw) return [];
    const pairs: Array<{ value: string; category: string }> = [];
    for (const token of raw.split(",").slice(0, MAX_LIST_ITEMS)) {
        const cut = token.indexOf("/");
        if (cut <= 0 || cut === token.length - 1) continue;
        pairs.push({
            category: _unescape(token.slice(0, cut)).slice(0, MAX_TEXT_LEN),
            value: _unescape(token.slice(cut + 1)).slice(0, MAX_TEXT_LEN),
        });
    }
    return pairs;
}

/**
 * One field's selection, as the entries a URL carries for it.
 *
 * @param field - A serialised filter field (`GeoLeaf.Filter.getActiveFilter().fields[]`).
 * @returns `[key, value]` pairs, the key relative to {@link FIELD_FILTER_PREFIX}: one for the
 *   field, a second for a taxonomy field's sub-categories. Empty when the field constrains
 *   nothing or its kind is not carried.
 * @example
 * encodeFieldFilter({ id: "altitude", kind: "range", range: { min: 100, max: 500 } });
 * // → [["altitude", "100..500"]]
 */
export function encodeFieldFilter(field: PermalinkFilterField): Array<[string, string]> {
    switch (field.kind) {
        case "text": {
            const text = (field.text ?? "").slice(0, MAX_TEXT_LEN);
            return text ? [[field.id, text]] : [];
        }
        case "tag":
            return field.values?.length ? [[field.id, _encodeList(field.values)]] : [];
        case "taxonomy": {
            if (!field.values?.length) return [];
            const entries: Array<[string, string]> = [[field.id, _encodeList(field.values)]];
            const pairs = (field.subValues ?? [])
                .filter((sub) => sub?.value && sub.category)
                .map((sub) => `${_escape(sub.category)}/${_escape(sub.value)}`);
            if (pairs.length) entries.push([field.id + SUB_SUFFIX, pairs.join(",")]);
            return entries;
        }
        case "range": {
            const range = _encodeRange(field.range);
            return range === null ? [] : [[field.id, range]];
        }
        default:
            return [];
    }
}

/**
 * A descriptor's selection, read back from the per-field entries of a link.
 *
 * @param descriptor - The filter field the entries are read for: its id names the entry, its
 *   kind says how to read it.
 * @param entries - The per-field entries (`PermalinkState.fieldFilters`).
 * @returns The serialised field to hand to `GeoLeaf.Filter.applyFilter()`, or `null` when the
 *   link carries nothing usable for that field.
 * @example
 * decodeFieldFilter({ id: "altitude", kind: "range" }, { altitude: "100.." });
 * // → { id: "altitude", kind: "range", range: { min: 100 } }
 */
export function decodeFieldFilter(
    descriptor: { id: string; kind: string },
    entries: Readonly<Record<string, string>>
): PermalinkFilterField | null {
    const { id, kind } = descriptor;
    const raw = Object.prototype.hasOwnProperty.call(entries, id) ? entries[id] : undefined;
    if (typeof raw !== "string" || raw.length === 0) return null;
    switch (kind) {
        case "text":
            return { id, kind, text: raw.slice(0, MAX_TEXT_LEN) };
        case "tag": {
            const values = _decodeList(raw);
            return values.length ? { id, kind, values } : null;
        }
        case "taxonomy": {
            const values = _decodeList(raw);
            if (!values.length) return null;
            const subKey = id + SUB_SUFFIX;
            const subRaw = Object.prototype.hasOwnProperty.call(entries, subKey)
                ? entries[subKey]
                : undefined;
            const subValues = _decodeSubValues(subRaw);
            return subValues.length ? { id, kind, values, subValues } : { id, kind, values };
        }
        case "range": {
            const range = _decodeRange(raw);
            return range ? { id, kind, range } : null;
        }
        default:
            return null;
    }
}

/**
 * Keeps, of a raw value read from a link, what may be per-field entries: a map of non-empty
 * strings, capped in number, key length and value length.
 *
 * @security The keys come from a URL. A key that would reach the prototype is dropped, and
 * the result is built key by key — never spread from the untrusted object.
 *
 * @param raw - What a compact payload carried under `fieldFilters`, or the `gl_f.*`
 *   parameters gathered from a verbose link.
 * @returns The entries, or `undefined` when there is none to keep.
 * @example
 * sanitizeFieldFilters({ altitude: "100..500", junk: 3 }); // { altitude: "100..500" }
 */
export function sanitizeFieldFilters(raw: unknown): Record<string, string> | undefined {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const kept: Record<string, string> = {};
    let count = 0;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (count >= MAX_FIELD_FILTERS) break;
        if (isUnsafeKey(key) || key.length === 0 || key.length > MAX_KEY_LEN) continue;
        if (typeof value !== "string" || value.length === 0) continue;
        kept[key] = value.slice(0, MAX_VALUE_LEN);
        count += 1;
    }
    return count > 0 ? kept : undefined;
}
