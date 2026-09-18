/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description The log's record — a bounded ring of recent entries that support can read
 * without developer tools.
 *
 * ## The defect it closes
 *
 * `GeoLeaf.Log` wrote to the console and nowhere else. On a field device there are no developer
 * tools: nothing a technician saw could be reported, and the boot failure screen had no history
 * to hand over.
 *
 * ## What it keeps, and how
 *
 * - It is fed by `GeoLeaf.Log` (`logger.ts`: what it prints, plus every warning and error), by
 *   the boot logger (`GeoLeaf._app.AppLog`) and, from `GeoLeaf.boot()` on, by uncaught errors and
 *   unhandled rejections ({@link captureGlobalErrors}).
 * - Each entry is formatted when it is recorded, into bounded text: an `Error` becomes its name,
 *   its message and a few stack frames; a GeoJSON object its type and id; any other object a
 *   depth- and size-bounded summary. No reference to a live object is kept, so the log never
 *   retains a feature or a map.
 * - The latest entries are kept, the oldest dropped.
 * - Secrets are redacted when entries are READ (`redact.ts`).
 *
 * ⚠️ Deliberately NOT on the `utils/log` barrel, like `error-logger.ts`: test files mock that
 * barrel with the four logging methods only, and a reader of the record would find none in it.
 */

import { redactSecrets } from "./redact.js";

/** An entry of the log's record, as `GeoLeaf.Log.getEntries()` returns it. */
export interface LogEntry {
    /** When it was recorded, in milliseconds since the epoch. */
    readonly time: number;
    readonly level: "debug" | "info" | "warn" | "error";
    /**
     * `log`: `GeoLeaf.Log`. `app`: the boot logger. `global`: an uncaught error or an unhandled
     * promise rejection.
     */
    readonly source: "log" | "app" | "global";
    /** The logged values, formatted into bounded text — secrets redacted. */
    readonly message: string;
}

const RING_CAPACITY = 500;
const MAX_ARG_CHARS = 800;
const MAX_MESSAGE_CHARS = 1500;
const MAX_DEPTH = 3;
const MAX_ITEMS = 20;
const MAX_NODES = 200;
const STACK_LINES = 3;
const GEOMETRY_TYPES = new Set([
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
]);

const _ring: LogEntry[] = [];
const _capturedTargets = new WeakSet<EventTarget>();

/** What one formatting pass may still spend — objects visited, and the ones already seen. */
interface FormatBudget {
    nodes: number;
    readonly seen: WeakSet<object>;
}

function _clip(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max)}… (+${text.length - max})`;
}

/** A property read that survives a throwing getter. */
function _read(value: object, key: string): unknown {
    try {
        return Reflect.get(value, key);
    } catch {
        return "[unreadable]";
    }
}

/** An `Error` as its name, its message and the first stack frames. */
function _formatError(error: Error): string {
    const header = `${error.name}: ${error.message}`;
    const stack = typeof error.stack === "string" ? error.stack : "";
    const frames = (stack.startsWith(header) ? stack.slice(header.length) : stack)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, STACK_LINES);
    return [header, ...frames].join("\n    ");
}

/** A GeoJSON object as its type and identity: attributes and coordinates are not diagnostics. */
function _formatGeoJSON(value: object): string | null {
    const type: unknown = _read(value, "type");
    if (type === "Feature") {
        const id: unknown = _read(value, "id");
        return typeof id === "string" || typeof id === "number"
            ? `[Feature id=${id}]`
            : "[Feature]";
    }
    if (type === "FeatureCollection") {
        const features: unknown = _read(value, "features");
        return Array.isArray(features)
            ? `[FeatureCollection n=${features.length}]`
            : "[FeatureCollection]";
    }
    return typeof type === "string" && GEOMETRY_TYPES.has(type) ? `[${type}]` : null;
}

function _formatValue(value: unknown, depth: number, budget: FormatBudget): string {
    if (typeof value === "string") return JSON.stringify(_clip(value, MAX_ARG_CHARS));
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
    if (value === null || typeof value !== "object") return String(value);
    if (value instanceof Error) return _formatError(value);
    budget.nodes += 1;
    if (budget.nodes > MAX_NODES || budget.seen.has(value)) return "…";
    return _formatGeoJSON(value) ?? _formatContainer(value, depth, budget);
}

function _formatContainer(value: object, depth: number, budget: FormatBudget): string {
    if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[Array(${value.length})]` : "{…}";
    if (typeof Node !== "undefined" && value instanceof Node) return `[${value.nodeName}]`;
    budget.seen.add(value);
    if (Array.isArray(value)) {
        const items = value
            .slice(0, MAX_ITEMS)
            .map((item: unknown) => _formatValue(item, depth + 1, budget));
        if (value.length > MAX_ITEMS) items.push(`…${value.length - MAX_ITEMS} more`);
        return `[${items.join(",")}]`;
    }
    const keys = Object.keys(value);
    const members = keys
        .slice(0, MAX_ITEMS)
        .map(
            (key) => `${JSON.stringify(key)}:${_formatValue(_read(value, key), depth + 1, budget)}`
        );
    if (keys.length > MAX_ITEMS) members.push(`…${keys.length - MAX_ITEMS} more`);
    return `{${members.join(",")}}`;
}

/** The logged values as one bounded text: strings as they are, anything else summarised. */
function _formatArgs(args: readonly unknown[]): string {
    const budget: FormatBudget = { nodes: 0, seen: new WeakSet() };
    const parts = args.map((arg) => {
        try {
            return _clip(
                typeof arg === "string" ? arg : _formatValue(arg, 0, budget),
                MAX_ARG_CHARS
            );
        } catch {
            return "[unformattable]";
        }
    });
    return _clip(parts.join(" "), MAX_MESSAGE_CHARS);
}

/**
 * Adds an entry to the log's record — the one way in.
 *
 * `GeoLeaf.Log` calls it for what it prints plus every warning and error, the boot logger
 * (`GeoLeaf._app.AppLog`) for what it prints, and {@link captureGlobalErrors} for uncaught errors.
 * When the record is full, the oldest entry is dropped.
 *
 * @param level - The entry's level.
 * @param source - Who logged it.
 * @param args - The logged values, formatted here into bounded text.
 */
export function recordLogEntry(
    level: LogEntry["level"],
    source: LogEntry["source"],
    args: readonly unknown[]
): void {
    // Kept oldest first, so reading needs no rotation.
    _ring.push({ time: Date.now(), level, source, message: _formatArgs(args) });
    if (_ring.length > RING_CAPACITY) _ring.shift();
}

/**
 * The log's record, oldest first, secrets redacted — what `GeoLeaf.Log.getEntries()` returns.
 *
 * @returns A fresh array of fresh entries: changing it changes nothing in the record.
 */
export function getLogEntries(): LogEntry[] {
    return _ring.map((entry) => ({ ...entry, message: redactSecrets(entry.message) }));
}

/**
 * Records uncaught errors and unhandled promise rejections in the log's record — once per
 * target, however many times it is called.
 *
 * Installed by `GeoLeaf.boot()`, never at import: loading the library attaches nothing to the
 * page. It only records — the browser still reports them in its own console.
 *
 * @param target - Where to listen; the page's `window` when omitted. Without either, nothing is
 *   installed.
 */
export function captureGlobalErrors(target?: EventTarget): void {
    const where = target ?? (typeof window === "undefined" ? undefined : window);
    if (where === undefined || _capturedTargets.has(where)) return;
    _capturedTargets.add(where);
    where.addEventListener("error", (event) => {
        const error: unknown = Reflect.get(event, "error");
        const message: unknown = Reflect.get(event, "message");
        recordLogEntry("error", "global", ["Uncaught error:", error ?? message]);
    });
    where.addEventListener("unhandledrejection", (event) => {
        const reason: unknown = Reflect.get(event, "reason");
        recordLogEntry("error", "global", ["Unhandled rejection:", reason]);
    });
}
