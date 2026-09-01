/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview General utility functions for GeoLeaf
 *
 * @remarks
 * `getLog` lives in `./di-accessors.js` since KERNEL S10 and is re-exported
 * here so the public `GeoLeaf.Utils` shape is unchanged.
 */

import { Log } from "../log/index.js";
import { Config } from "../../kernel/config/config-primitives.js";
import { validateUrl as _secValidateUrl } from "../../kernel/security/index.js";
import { Core } from "../../api/geoleaf.core.js";
import { getLog } from "./di-accessors.js";
import { isUnsafeKey } from "./object-path-guard.js";

/**
 * Validates a URL against the allowed protocols and returns it resolved.
 *
 * The low-level form behind `GeoLeaf.Validators.validateUrl` — same protocol allow-list, which
 * is what keeps `javascript:` out of attributes built from profile data.
 */
export function validateUrl(
    url: string | null | undefined,
    allowedProtocols: string[] = ["http:", "https:", "mailto:", "tel:"]
): string | null {
    if (!url || typeof url !== "string") return null;
    try {
        const parsed = new URL(url);
        if (!allowedProtocols.includes(parsed.protocol)) return null;
        // For non-http(s) protocols that the security module doesn't handle,
        // return the normalized href after basic validation
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return parsed.href;
        }
        return _secValidateUrl(url);
    } catch {
        return null;
    }
}

/**
 * Recursively merges `source` into `target`, returning the merged object.
 *
 * ⚠️ Arrays are **replaced, not concatenated** — a source array wins whole. That is what makes
 * a profile able to override a default list rather than grow it.
 *
 * @param target - Base object. Returned as-is when `source` is not an object.
 * @param source - Values taking precedence; null or undefined leaves `target` untouched.
 * @returns The merged object.
 */
export function deepMerge<T extends Record<string, unknown>>(
    target: T,
    source: Record<string, unknown> | null | undefined
): T {
    if (!source || typeof source !== "object") return target;
    if (!target || typeof target !== "object") return source as T;

    const output = Object.assign({}, target);

    Object.keys(source).forEach((key) => {
        // Canonical blocklist. The list used to be declared right here, in
        // the function body — so it was reallocated on every call, recursive ones
        // included, i.e. once per nested object of a merged profile.
        if (isUnsafeKey(key)) return;

        const srcVal = source[key];
        if (srcVal && typeof srcVal === "object" && !Array.isArray(srcVal)) {
            (output as Record<string, unknown>)[key] = deepMerge(
                (target[key] as Record<string, unknown>) || {},
                srcVal as Record<string, unknown>
            );
        } else {
            (output as Record<string, unknown>)[key] = srcVal;
        }
    });

    return output;
}

/**
 * Duck-types a map instance: accepts a GeoLeaf map adapter **and** a raw
 * `maplibregl.Map`, which both expose these four.
 *
 * ⚠️ `setView` is deliberately NOT part of the check. It is a **Leaflet** API — absent
 * from MapLibre's surface — and only the GeoLeaf adapter has it, as a shim delegating
 * to `jumpTo`. Requiring it would reject exactly what this function's own npm docs tell
 * you to pass (a MapLibre GL instance). That is the mistake the removed `MapHelpers`
 * made: it read as "is this a map?" while actually asking "is this our adapter?".
 */
function _looksLikeMap(candidate: unknown): boolean {
    if (!candidate || typeof candidate !== "object") return false;
    const m = candidate as Record<string, unknown>;
    return (
        typeof m.getCenter === "function" &&
        typeof m.getBounds === "function" &&
        typeof m.on === "function" &&
        typeof m.off === "function"
    );
}

/**
 * Resolves a usable map instance: the explicit one when it is a map, otherwise the one
 * held by `Core`, otherwise `null`.
 *
 * @param explicitMap - A map adapter or `maplibregl.Map`; `undefined` to use Core's.
 * @returns The resolved map, or `null` when none is available.
 *
 * @remarks
 * S13 — this used to return **any** truthy argument unchanged, so `ensureMap("foo")`
 * yielded `"foo"`: the function ensured nothing, and the failure surfaced later at the
 * first method call, far from the cause. It now validates, so a non-map yields `null`
 * like an absent map. Both in-tree callers already handled `null`.
 */
export function ensureMap(explicitMap: unknown): unknown {
    if (_looksLikeMap(explicitMap)) return explicitMap;
    if (Core && typeof (Core as { getMap?: () => unknown }).getMap === "function") {
        const coreMap = (Core as { getMap: () => unknown }).getMap();
        if (_looksLikeMap(coreMap)) return coreMap;
    }
    return null;
}

/**
 * Merges caller options over a defaults object.
 *
 * A thin, intent-revealing wrapper over {@link deepMerge}: it exists so option-merging call
 * sites read as such rather than as a generic deep merge.
 */
export function mergeOptions<T extends Record<string, unknown>>(
    defaults: T,
    override: Record<string, unknown> | null | undefined
): T {
    if (!override || typeof override !== "object") return defaults;
    return Object.assign({}, defaults, override);
}

/**
 * Dispatches a GeoLeaf CustomEvent on `document`.
 *
 * The single emission point for map events, which is what keeps every event name and detail
 * shape flowing through one place. A no-op where there is no `document`.
 */
export function fireMapEvent(
    map: { fire?: (name: string, payload: unknown) => void } | null | undefined,
    eventName: string,
    payload?: unknown
): void {
    if (!map || typeof map.fire !== "function") return;
    try {
        map.fire(eventName, payload ?? {});
    } catch (err) {
        if (Log) Log.warn("[Utils] fireMapEvent error:", eventName, err);
    }
}

/**
 * Delays a function until it has stopped being called for `wait` milliseconds.
 *
 * With `immediate`, it fires on the **leading** edge instead — the first call runs at once and
 * subsequent ones are swallowed until the window closes. Use it for search inputs and resize
 * handlers; use {@link throttle} when you want a guaranteed cadence rather than a quiet period.
 *
 * ⚠️ The constraint is `(...args: never[]) => unknown`, NOT `(...args: unknown[]) => unknown`.
 * The latter looks equivalent and is not: parameters are contravariant, so `unknown[]` demands a
 * callback accepting `unknown` in every position, which **rejects every concretely-typed
 * callback** — `(query: string) => void` included. That was the real signature until 31/07/2026,
 * and it made the documented example of this very function fail to compile (TS2345, frozen three
 * days in the `typecheck-docs-examples` baseline). `never[]` is the idiom for "any function":
 * it accepts them all, and `Parameters<T>` still recovers the true argument types.
 *
 * @param func - Function to debounce. `this` and arguments are forwarded.
 * @param wait - Quiet period in milliseconds. Defaults to `250`.
 * @param immediate - Fire on the leading edge instead of the trailing one. Defaults to `false`.
 * @returns The debounced wrapper. ⚠️ It returns `void` — the wrapped return value is lost.
 */
export function debounce<T extends (...args: never[]) => unknown>(
    func: T,
    wait: number = 250,
    immediate: boolean = false
): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return function debounced(this: unknown, ...args: Parameters<T>) {
        const context = this;
        const later = () => {
            timeout = undefined;
            if (!immediate) func.apply(context, args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
}

/**
 * Caps a function to at most one call per `limit` milliseconds.
 *
 * Unlike {@link debounce}, a steady stream of calls still gets through at a fixed rate rather
 * than being held until it stops — which is what a scroll or pan handler needs.
 *
 * ⚠️ Same `never[]` constraint as {@link debounce}, and for the same reason — see its note.
 * Corrected here in the same gesture on 31/07/2026: the defect was **identical and latent**,
 * invisible only because no published example happened to call `throttle` with a typed
 * callback. Fixing one and not its twin would have left the next documenter to rediscover it.
 *
 * @param func - Function to throttle. `this` and arguments are forwarded.
 * @param limit - Minimum interval between calls, in milliseconds. Defaults to `100`.
 * @returns The throttled wrapper. ⚠️ It returns `void` — the wrapped return value is lost.
 */
export function throttle<T extends (...args: never[]) => unknown>(
    func: T,
    limit: number = 100
): (...args: Parameters<T>) => void {
    let lastRan: number | undefined;
    return function throttled(this: unknown, ...args: Parameters<T>) {
        const context = this;
        const now = Date.now();
        if (!lastRan || now - lastRan >= limit) {
            func.apply(context, args);
            lastRan = now;
        }
    };
}

/**
 * Great-circle distance between two points, in **KILOMETRES**.
 *
 * ⚠️ This is the only distance function in the repo that does NOT return metres —
 * `utils/geo/haversine.haversineDistance()` and the filter helpers all return metres.
 * The two families share the same scalar signature `(lat1, lng1, lat2, lng2) => number`,
 * so TypeScript cannot tell them apart: substituting one for the other type-checks
 * cleanly and shifts every comparison by a factor of 1000. That is exactly what happened
 * in `route-filter` until KERNEL S11. **Convert explicitly at the call site.**
 *
 * ⚠️ This line pointed at a plugin file as the example to imitate, until the 19/08/2026 —
 * a file that no longer exists, and whose successor does NOT do the conversion. Measured
 * the same day: **no caller in this repo converts any more**, so there is nothing left to
 * imitate. That is worth knowing rather than hiding: the trap is guarded by this comment
 * alone, not by an example a reader could copy.
 *
 * Kept in kilometres because it is published as `GeoLeaf.Utils.getDistance`.
 *
 * @param lat1 - Latitude of the first point, decimal degrees.
 * @param lng1 - Longitude of the first point, decimal degrees.
 * @param lat2 - Latitude of the second point, decimal degrees.
 * @param lng2 - Longitude of the second point, decimal degrees.
 * @returns The distance in kilometres.
 */
export function getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLng = (lng2 - lng1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) *
            Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function _traversePath(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split(".");
    let value: unknown = obj;

    for (const key of keys) {
        if (value && typeof value === "object" && key in value) {
            value = (value as Record<string, unknown>)[key];
        } else {
            value = null;
            break;
        }
    }

    if (value != null) {
        if (typeof value === "string") {
            if (value.trim()) return value;
        } else {
            return value;
        }
    }
    return null;
}

/**
 * Returns the first non-blank value found across several dotted paths, or `""`.
 *
 * ⚠️ **Not interchangeable with `Utils.getNestedValue()`** (`object-utils.ts`) — see the
 * divergence list documented there. The two traps specific to this function: a miss yields
 * `""` rather than `null`, and a value that is an empty or whitespace-only string is treated
 * as a miss (`_traversePath` drops it), so `resolveField({ name: "  " }, "name") === ""`.
 * That last behaviour is deliberate — this helper backs "first field that actually has
 * something to display" lookups — and is pinned by a test.
 *
 * @param obj - Source object.
 * @param paths - Dotted paths, tried in order; the first non-blank hit wins.
 * @returns The resolved value, or `""` when nothing matches.
 */
export function resolveField(
    obj: Record<string, unknown> | null | undefined,
    ...paths: string[]
): unknown {
    if (!obj || typeof obj !== "object") return "";

    for (const path of paths) {
        const result = _traversePath(obj, path);
        if (result != null) return result;
    }

    return "";
}

/**
 * Comparator sorting objects by a numeric `order` field.
 *
 * Entries without an `order` fall back to `999`, so unordered items sink to the end while
 * keeping a stable relation among themselves. Used for layers, legend entries and toolbar items.
 *
 * @param a - First entry.
 * @param b - Second entry.
 * @param fallback - Rank given to entries with no `order`. Defaults to `999`.
 * @returns Negative, zero or positive, per the `Array.prototype.sort` contract.
 */
export function compareByOrder(
    a: { order?: number },
    b: { order?: number },
    fallback: number = 999
): number {
    const orderA = typeof a.order === "number" ? a.order : fallback;
    const orderB = typeof b.order === "number" ? b.order : fallback;
    return orderA - orderB;
}

export { getLog };

/**
 * The profile currently loaded, read off the live configuration.
 *
 * @returns The active profile, or a nullish value before the configuration has loaded.
 */
export function getActiveProfile(): unknown {
    const C = Config as unknown as { getActiveProfile?: () => unknown };
    if (C && typeof C.getActiveProfile === "function") {
        return C.getActiveProfile() ?? null;
    }
    return null;
}

/**
 * The `GeoLeaf.Utils` façade — generic helpers with no DOM or map dependency.
 *
 * Distinct from `GeoLeaf.Helpers`, which is the DOM-facing set: anything here works without a
 * document. The split is the reason `debounce` and `throttle` live on this side.
 */
export const Utils = {
    validateUrl,
    deepMerge,
    ensureMap,
    mergeOptions,
    fireMapEvent,
    debounce,
    throttle,
    getDistance,
    resolveField,
    compareByOrder,
    getLog,
    getActiveProfile,
};
