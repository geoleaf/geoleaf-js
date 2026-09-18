/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description GeoLeaf.Log — centralized log handling
 *
 * Purpose:
 * - replace every console.log/console.warn/... across the project
 * - provide a configurable verbosity level via JSON config
 * - ensure each message has a normalized prefix [GeoLeaf.X]
 * - feed the log's record (`log-record.ts`) — what support reads without developer tools,
 *   through `getEntries()` and `exportDiagnostic()`
 */

/* eslint-disable no-console */ // This module IS the logger — console calls are intentional

import { getLogEntries, recordLogEntry, type LogEntry } from "./log-record.js";

/**
 * The level names {@link LogImplInterface.setLevel} recognises, case-insensitively.
 *
 * ⚠️ `"production"` is a mode, not a level: it sets the threshold to `warn` and turns quiet mode on.
 */
export type LogLevelName = "debug" | "info" | "warn" | "error" | "production";

/**
 * The numeric log levels, ordered from most to least verbose.
 *
 * A message is emitted when its own level is `>=` the current threshold, which is why the
 * values are ordered rather than arbitrary. ⚠️ There is no `PRODUCTION` entry here:
 * `setLevel("production")` maps to `WARN` plus quiet mode — it is a mode, not a level.
 *
 * ⚠️ **This table is internal.** It is exported from this module but re-exported nowhere:
 * not by the package entry, not by `kernel-exports`, not onto the global namespace. The
 * documented `import { LEVELS } from "@geoleaf/core"` does not resolve. From outside the
 * core, read the numeric value through {@link LogImplInterface.getLevel} and compare against
 * the literals below.
 *
 * @example
 * ```js
 * // { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }
 * const level = GeoLeaf.Log.getLevel();
 * const isVerbose = level === 0;
 * ```
 */
export const LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
} as const;

let currentLevel: number = LEVELS.INFO; // default level
let quietMode = false; // silent mode for repetitive logs
const groupedMessageCounts = new Map<string, number>(); // groups similar messages together
const MAX_GROUPED_ENTRIES = 200; // cap to prevent unbounded growth

const formatPrefix = (type: string): string => `[GeoLeaf.${type}]`;

// Detects if a message is repetitive or non-critical informational
// These patterns match log messages emitted elsewhere in the codebase, so they must be kept
// in sync with the wording at the emitting site — they are behaviour, not documentation.
// KERNEL S11 removed two French ones (`/Chargement du sprite SVG/`, `/Section.*remplie/`):
// the earlier translation passes had rewritten the messages they targeted, leaving patterns
// that could no longer match anything. Grep before adding or editing an entry here.
const isRepetitiveMessage = (message: string): boolean => {
    const patterns = [
        /Sprite SVG detected/,
        /IconsConfig retrieved/,
        /Module.*loaded/,
        /Module.*initialized/,
        /Control.*added/,
        /Button.*added/,
        /Panel.*created/,
        /Profile.*loaded/,
        /Layer.*loaded/,
        /Style.*applied/,
        /ThemeApplier/,
        /LayerManager/,
        /Storage/,
        /CacheButton/,
        /Renderers\./,
        /FormRenderer/,
        /ResourceEnumerator/,
        /LayerSelector/,
        /CacheControl/,
        /POI.*DEBUG/,
        /AddForm/,
    ];
    return patterns.some((pattern) => pattern.test(message));
};

// Critical messages that must always be displayed — in quiet mode, ON THE `info` PATH ONLY.
//
// ⚠️ Read that scope before reasoning about wording. `warn` and `error` consult NO predicate:
// they print whenever the level allows, whatever the text says. So `/Error/` below does NOT
// mean "any message containing Error is force-shown" — it means "an INFO carrying that word
// survives quiet mode". Backlog B.38 mis-stated its own trap on exactly this point: it held
// that translating `"Erreur loading style"` → `"Error loading style"` would flip that log to
// always-shown, when the site is a `Log.warn` and nothing there is consulted.
//
// Practical rule: on `warn`/`error` the wording is free; on `debug`/`info` it is behaviour.
// Pinned by `__tests__/log/level-predicate-wiring.test.js`.
const isCriticalMessage = (message: string): boolean => {
    const criticalPatterns = [
        /ERROR/,
        /WARN/,
        /Failed/,
        /Error/,
        /Exception/,
        /Map initialized successfully/,
        /All.*modules loaded/,
        /Mode.*activated/,
    ];
    return criticalPatterns.some((pattern) => pattern.test(message));
};

// Manages grouped messages
const handleGroupedMessage = (message: string, _args: unknown[]): boolean => {
    const key = message.replace(/\d+/g, "X").replace(/[{}:,]/g, ""); // normalise
    const count = (groupedMessageCounts.get(key) || 0) + 1;
    groupedMessageCounts.set(key, count);

    // Evict oldest entries when cap is reached
    if (groupedMessageCounts.size > MAX_GROUPED_ENTRIES) {
        const firstKey = groupedMessageCounts.keys().next().value;
        if (firstKey !== undefined) groupedMessageCounts.delete(firstKey);
    }

    if (count === 1) {
        return true; // show the first occurrence
    } else if (count === 3 && !isCriticalMessage(message)) {
        console.info(
            `${formatPrefix("INFO")} [Grouped] Repeated message - continuation hidden: ${message.substring(0, 60)}...`
        );
        return false;
    } else if (count > 3) {
        return false; // suppressed after 3 occurrences for non-critical messages
    }
    return count <= 2; // show non-critical messages at most twice
};

/**
 * The shape of `GeoLeaf.Log` — a level-filtered console with repetition damping.
 *
 * Two independent mechanisms decide whether a call reaches the console: the **level**
 * threshold ({@link LogImplInterface.setLevel}) and, for messages recognised as repetitive,
 * a **grouping** counter that suppresses them after a few occurrences and reports the totals
 * through {@link LogImplInterface.showSummary}. A message can therefore be dropped even at a
 * permissive level.
 *
 * What reaches the console is also recorded — and warnings and errors always are, whatever the
 * level: {@link LogImplInterface.getEntries} reads that record back.
 */
export interface LogImplInterface {
    /**
     * Sets the verbosity threshold.
     *
     * Accepts `"debug"`, `"info"`, `"warn"`, `"error"` and `"production"`, case-insensitively.
     * ⚠️ `"production"` is not a level of its own: it sets the threshold to `warn` **and**
     * turns quiet mode on, so it is the only value with a side effect beyond the threshold.
     * An unrecognised value logs a warning and leaves the level unchanged.
     *
     * @param level - The level name.
     *
     * @example
     * ```js
     * GeoLeaf.Log.setLevel("debug");
     * ```
     *
     * @example
     * ```js
     * GeoLeaf.Log.setLevel("production");
     * // Equivalent to: setLevel('warn') + setQuietMode(true)
     * ```
     */
    setLevel(level: string): void;

    /**
     * The current threshold, as its numeric value from {@link LEVELS}.
     *
     * @returns `0` (DEBUG), `1` (INFO), `2` (WARN) or `3` (ERROR).
     *
     * @example
     * ```js
     * const level = GeoLeaf.Log.getLevel();
     * // Returns: 0 (DEBUG) | 1 (INFO) | 2 (WARN) | 3 (ERROR)
     * ```
     */
    getLevel(): number;

    /**
     * The current threshold, as its name.
     *
     * ⚠️ Reports the **threshold**, not the mode: after `setLevel("production")` this returns
     * `"WARN"`, and nothing here reveals that quiet mode was switched on with it.
     *
     * @returns `"DEBUG"`, `"INFO"`, `"WARN"` or `"ERROR"`.
     *
     * @example
     * ```js
     * const name = GeoLeaf.Log.getLevelName();
     * // Returns: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
     * ```
     */
    getLevelName(): string;

    /**
     * Turns repetition damping on or off, independently of the level.
     *
     * With it on, messages matching the module's repetitive-message patterns are shown a
     * couple of times and then counted silently until {@link LogImplInterface.showSummary}.
     *
     * @param enabled - `true` to damp repetitive messages.
     *
     * @example
     * ```js
     * GeoLeaf.Log.setQuietMode(true);
     * // [GeoLeaf.INFO] Silent mode activated - repetitive logs reduced
     * ```
     */
    setQuietMode(enabled: boolean): void;

    /**
     * Prints how many times each damped message was suppressed.
     *
     * The counterpart of quiet mode: without this call, the suppressed occurrences are never
     * reported at all.
     *
     * @example
     * ```js
     * GeoLeaf.Log.showSummary();
     * // [GeoLeaf.INFO] Grouped log summary
     * // • 12x: Module loaded...
     * // • 8x: Profile loaded...
     * ```
     */
    showSummary(): void;

    /**
     * Logs at DEBUG — internal detail, off by default (the default threshold is INFO).
     *
     * @param args - Values forwarded to the console, prefixed with the module tag.
     *
     * @example
     * ```js
     * GeoLeaf.Log.debug("[GeoLeaf.GeoJSON] Loading features…");
     * ```
     */
    debug(...args: unknown[]): void;

    /**
     * Logs at INFO — normal lifecycle events. Subject to repetition damping.
     *
     * @param args - Values forwarded to the console, prefixed with the module tag.
     *
     * @example
     * ```js
     * GeoLeaf.Log.info("[GeoLeaf.Core] Map initialised.");
     * ```
     */
    info(...args: unknown[]): void;

    /**
     * Logs at WARN — a degraded path was taken, but the operation continued.
     *
     * @param args - Values forwarded to the console, prefixed with the module tag.
     *
     * @example
     * ```js
     * GeoLeaf.Log.warn("[GeoLeaf.Config] Key 'basemap.id' missing, falling back to 'street'.");
     * ```
     */
    warn(...args: unknown[]): void;

    /**
     * Logs at ERROR — the highest level, never damped by quiet mode.
     *
     * @param args - Values forwarded to the console, prefixed with the module tag.
     *
     * @example
     * ```js
     * GeoLeaf.Log.error("[GeoLeaf.Config] Configuration loading failed.");
     * ```
     */
    error(...args: unknown[]): void;

    /**
     * The recent entries of the log's record, oldest first — at most 500, secrets redacted.
     *
     * Warnings and errors are recorded whatever the level; `info` and `debug` when they reach the
     * console. The boot logger feeds the same record, and so do uncaught errors and unhandled
     * rejections from `GeoLeaf.boot()` on. Unlike the console, the record is readable without
     * developer tools: it is what the boot failure screen hands over in its diagnostic.
     *
     * @returns A copy: changing it changes nothing in the record.
     *
     * @example
     * ```js
     * const errors = GeoLeaf.Log.getEntries().filter((entry) => entry.level === "error");
     * ```
     */
    getEntries(): LogEntry[];

    /**
     * The recent entries as a JSON document, ready to hand to support.
     *
     * @returns `{ format: "geoleaf-log", formatVersion: 1, time, level, entries }`, pretty-printed,
     *   where `level` is the current threshold and `entries` what
     *   {@link LogImplInterface.getEntries} returns.
     *
     * @example
     * ```js
     * const report = GeoLeaf.Log.exportDiagnostic();
     * ```
     */
    exportDiagnostic(): string;
}

/**
 * Logger centralized GeoLeaf (implementation)
 */
const _LogImpl: LogImplInterface = {
    setLevel(level: string): void {
        const lvl = String(level).toLowerCase();
        switch (lvl) {
            case "debug":
                currentLevel = LEVELS.DEBUG;
                break;
            case "info":
                currentLevel = LEVELS.INFO;
                break;
            case "warn":
                currentLevel = LEVELS.WARN;
                break;
            case "error":
                currentLevel = LEVELS.ERROR;
                break;
            case "production":
                currentLevel = LEVELS.WARN; // In production, only WARN and ERROR
                quietMode = true;
                break;
            default:
                console.warn(`${formatPrefix("WARN")} Unknown log level:`, level);
        }
    },

    getLevel(): number {
        return currentLevel;
    },

    getLevelName(): string {
        for (const [name, value] of Object.entries(LEVELS)) {
            if (value === currentLevel) return name;
        }
        return "UNKNOWN";
    },

    setQuietMode(enabled: boolean): void {
        if (quietMode === enabled) return; // avoid repetitions
        quietMode = enabled;
        if (enabled) {
            console.info(`${formatPrefix("INFO")} Silent mode activated - repetitive logs reduced`);
        }
    },

    showSummary(): void {
        if (groupedMessageCounts.size > 0) {
            console.group(`${formatPrefix("INFO")} Grouped log summary`);
            for (const [message, count] of groupedMessageCounts) {
                if (count > 3) {
                    console.info(`• ${count}x: ${message.substring(0, 60)}...`);
                }
            }
            console.groupEnd();
        }
    },

    getEntries(): LogEntry[] {
        return getLogEntries();
    },

    exportDiagnostic(): string {
        return JSON.stringify(
            {
                format: "geoleaf-log",
                formatVersion: 1,
                time: new Date().toISOString(),
                level: _LogImpl.getLevelName(),
                entries: getLogEntries(),
            },
            null,
            2
        );
    },

    debug(...args: unknown[]): void {
        if (currentLevel <= LEVELS.DEBUG) {
            const message = args.map((a) => String(a)).join(" ");
            if (quietMode && isRepetitiveMessage(message)) {
                if (!handleGroupedMessage(message, args)) return;
            }
            console.debug(formatPrefix("DEBUG"), ...args);
            recordLogEntry("debug", "log", args);
        }
    },

    info(...args: unknown[]): void {
        if (currentLevel <= LEVELS.INFO) {
            const message = args.map((a) => String(a)).join(" ");

            // In quiet mode, filter more aggressively
            if (quietMode) {
                // Always surface the critical messages
                if (isCriticalMessage(message)) {
                    console.info(formatPrefix("INFO"), ...args);
                    recordLogEntry("info", "log", args);
                    return;
                }

                // Group/hide repetitive messages
                if (isRepetitiveMessage(message)) {
                    if (!handleGroupedMessage(message, args)) return;
                }
            }

            console.info(formatPrefix("INFO"), ...args);
            recordLogEntry("info", "log", args);
        }
    },

    // Warnings and errors are RECORDED whatever the level: what a diagnostic needs most is
    // exactly what a quiet production level keeps off the console.
    warn(...args: unknown[]): void {
        recordLogEntry("warn", "log", args);
        if (currentLevel <= LEVELS.WARN) {
            console.warn(formatPrefix("WARN"), ...args);
        }
    },

    error(...args: unknown[]): void {
        recordLogEntry("error", "log", args);
        if (currentLevel <= LEVELS.ERROR) {
            console.error(formatPrefix("ERROR"), ...args);
        }
    },
};

// ── Local globalThis reference (for test-mock Proxy delegation) ──
interface GeoLeafGlobal {
    GeoLeaf?: { Log?: LogImplInterface };
}
const _g: GeoLeafGlobal =
    typeof globalThis !== "undefined"
        ? (globalThis as unknown as GeoLeafGlobal)
        : typeof window !== "undefined"
          ? (window as unknown as GeoLeafGlobal)
          : {};

/**
 * Exported Log proxy — delegates to LogImpl; provides CJS test override area
 * (global.GeoLeaf.Log = mock)
 * while modules use the standard `import { Log }` pattern.
 */
export const Log: LogImplInterface = new Proxy(_LogImpl, {
    get(_target, prop: string, receiver) {
        const current = _g.GeoLeaf?.Log;
        if (current && current !== _LogImpl && current !== receiver && prop in current) {
            return (current as unknown as Record<string, unknown>)[prop];
        }
        return (_LogImpl as unknown as Record<string, unknown>)[prop];
    },
});
