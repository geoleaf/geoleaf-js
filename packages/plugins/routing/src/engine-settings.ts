/*!
 * @geoleaf-plugins/routing — Engine settings
 *
 * What `configure()` holds: where the engine is and what every request must carry, given by the
 * host at runtime. This is where a key lives — and the only place it does.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { Log } from "@geoleaf/host-runtime";
import type { EngineSettings } from "./model.js";
import { parseEndpoint } from "./engine-url.js";

/**
 * The query parameters the OSRM adapter writes itself. A host parameter of one of these names
 * would be overwritten without a word, so it is refused where the host can read why.
 */
const RESERVED_PARAMS = new Set(["steps", "overview", "geometries"]);

/**
 * The settings in force, or `null`.
 *
 * ⚠️ Module state, on purpose: it survives a teardown of the map, because a host that obtained a
 * key through its own session should not have to hand it over again each time the application
 * is remounted. It does not survive a reload — nothing is stored.
 */
let current: EngineSettings | null = null;

/**
 * Tells a query parameter a host may add: a text, under any name but a reserved one.
 *
 * @param entry One `[name, value]` pair of the host's `query`.
 * @returns Whether the pair is usable.
 */
function isParam(entry: [string, unknown]): entry is [string, string] {
    return !RESERVED_PARAMS.has(entry[0]) && typeof entry[1] === "string";
}

/**
 * Reads what a host passed to `configure()`, or names the field that makes it unusable.
 *
 * @param input Whatever the host passed.
 * @returns The settings, or the name of the first field refused.
 */
function read(
    input: unknown
): { readonly value: EngineSettings } | { readonly refused: "settings" | "endpoint" | "query" } {
    if (typeof input !== "object" || input === null || Array.isArray(input))
        return { refused: "settings" };
    const { endpoint, query } = input as { endpoint?: unknown; query?: unknown };

    if (endpoint !== undefined && parseEndpoint(endpoint) === null) return { refused: "endpoint" };

    let params: Record<string, string> | undefined;
    if (query !== undefined) {
        if (typeof query !== "object" || query === null || Array.isArray(query))
            return { refused: "query" };
        const entries = Object.entries(query);
        if (!entries.every(isParam)) return { refused: "query" };
        // ⚠️ `Object.fromEntries` DEFINES each property. A parameter named `__proto__` — an own
        // key as soon as the object comes from `JSON.parse` — becomes an own key of the copy
        // too: it never reaches the prototype setter an assignment by key would trigger.
        params = Object.fromEntries(entries);
    }

    return {
        value: {
            ...(typeof endpoint === "string" ? { endpoint } : {}),
            ...(params !== undefined ? { query: params } : {}),
        },
    };
}

/**
 * Replaces the engine settings, whole.
 *
 * Validated whole or refused whole: when one value is unusable nothing is applied, and the
 * settings in force stay as they were — a half-applied `configure()` would send a key to an
 * address the host never meant.
 *
 * 🛑 **A refusal names the FIELD, never its value.** The value is where the key is.
 *
 * @param input `{ endpoint?, query? }`, or `null` to clear the settings.
 * @returns `true` once applied, `false` when refused.
 */
export function setEngineSettings(input: unknown): boolean {
    if (input === null) {
        current = null;
        return true;
    }
    const result = read(input);
    if ("refused" in result) {
        Log.warn(
            `[routing] configure() refused — \`${result.refused}\` is not usable. ` +
                "Nothing was applied; the previous settings stay in force."
        );
        return false;
    }
    current = result.value;
    return true;
}

/**
 * The engine settings in force.
 *
 * @returns What the last accepted `configure()` gave, or `null`.
 */
export function getEngineSettings(): EngineSettings | null {
    return current;
}
