/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — API module types (public type boundary)
 *
 * Defines the shared interfaces for the API cluster:
 * - `IModuleAccessFn` — function signature used by managers to resolve modules
 * - `IControllerHealthStatus` — runtime health reported by `APIController`
 * - `IAPIManagerRecord` — typed manager bag held by `APIController`
 * - `INormalizedInitOptions` — output of `_normalizeInitOptions`
 * - `INormalizedConfigOptions` — output of `_normalizeConfigOptions`
 * - `GeoLeafAPINamespace` — shape of the `GeoLeaf` global as seen by api/ files
 */

// ─── Module access ────────────────────────────────────────────────────────────

/**
 * Function used by managers to resolve a named GeoLeaf module at runtime.
 *
 * Returns `unknown` intentionally — callers must narrow the result before use.
 */
export type IModuleAccessFn = (name: string) => unknown;

// ─── Health ───────────────────────────────────────────────────────────────────

/** Entry pushed into `healthStatus.errors` on any manager failure. */
export interface IHealthError {
    message?: string;
    timestamp?: string;
    stack?: string;
    /** Set when the error originates from a manager load failure. */
    manager?: string;
    error?: string;
}

/** Runtime health object aggregated by `APIController`. */
export interface IControllerHealthStatus {
    /** Count of successfully loaded managers. */
    managers: number;
    errors: IHealthError[];
    lastUpdate: string | null;
}

// ─── Manager record ───────────────────────────────────────────────────────────

// Forward-declared to avoid circular imports — concrete types are assigned
// in each manager class after its class declaration.
/** Opaque manager shapes: typed at the class level, stored as a union here. */
export interface IAPIManagerRecord {
    module?: { init(): boolean; getModule(name: string): unknown };
    initialization?: {
        init(options: Record<string, unknown>, getModule: IModuleAccessFn): unknown;
        loadConfig(
            input: string | Record<string, unknown>,
            getModule: IModuleAccessFn
        ): Promise<unknown>;
        setTheme(theme: string, getModule: IModuleAccessFn): unknown;
    };
    factory?: {
        /**
         * Wires module access into the factory.
         *
         * ⚠️ Declared here because the controller now CALLS it. It existed on
         * `APIFactoryManager` from the start and nobody ever invoked it, so the factory
         * ran with `getModule === null` for its whole life — invisible while its only
         * job was to fill a map of its own, fatal the moment its accessors had to reach
         * `Core`.
         */
        init(getModule: IModuleAccessFn): boolean;
        createMap(targetId: string, options: unknown, getModule: IModuleAccessFn): unknown;
    };
}

// ─── Normalized options ───────────────────────────────────────────────────────

/** Output of `APIInitializationManager._normalizeInitOptions`. */
export interface INormalizedInitOptions {
    mapId: string;
    center: [number, number];
    zoom: number;
    theme: string;
    mapOptions: Record<string, unknown>;
    /**
     * Internal — pre-created adapter injected by the boot sequence so
     * `_createInstance()` reuses it instead of creating a second one. Typed
     * `unknown` to keep this public type boundary decoupled from the adapter
     * contract; narrowed at the consumption point (`map/facade.ts`). Absent for
     * direct `GeoLeaf.init()` calls.
     */
    _adapter?: unknown;
}

/** Output of `APIInitializationManager._normalizeConfigOptions`. */
export interface INormalizedConfigOptions {
    source: "url" | "data";
    url?: string;
    data?: unknown;
    profileId?: unknown;
    autoEvent: boolean;
    [key: string]: unknown;
}

// ─── Global namespace ─────────────────────────────────────────────────────────

/** Shape of the manager class constructors registered under `GeoLeaf.API`. */
export interface IGeoLeafAPIConstructors {
    APIModuleManager?: new () => { init(): boolean; getModule(name: string): unknown };
    APIInitializationManager?: new () => IAPIManagerRecord["initialization"];
    APIFactoryManager?: new () => IAPIManagerRecord["factory"];
}

/**
 * Shape of `globalThis.GeoLeaf` as expected by api/ files.
 *
 * Intentionally permissive ([key: string]: unknown) — the full namespace is
 * assembled progressively at boot and only the keys used by this cluster are
 * declared explicitly.
 *
 * ## ✅ This contract HAS a type witness since 25/08/2026
 *
 * It had none from the day the type that extended it became standalone (to be publishable):
 * nothing confronted this shape with the object it describes, and the contract had gone from
 * constraint to prose. The witness is
 * `__tests__/guards/api-namespace-contract.witness.test.ts` — member-wise assignability
 * (`import type` only, zero bytes in any bundle), enforced by the test type-check gate: a
 * drifting member reddens as TS2322, proven by mutation on `_APIController.init()`. Member-wise
 * rather than whole-shape on purpose: this contract is a narrow view, and `global.d.ts` types
 * `_APIController` as `unknown` — a whole-shape witness would be red in both directions by
 * construction.
 *
 * ⚠️ **An `@example` cannot serve as that witness here, and this was MEASURED rather than
 * assumed.** The example type-checker classifies assignability errors as non-defect
 * diagnostics, so an example asserting a FALSE type relation compiles green — tried, and
 * deliberately broken to check. That refutation is why the witness lives in a type-checked
 * test file instead. The extending type stays standalone: the witness imports types, it never
 * re-couples them.
 */
export interface GeoLeafAPINamespace {
    _APIController?: { init(): boolean } | null;
    API?: IGeoLeafAPIConstructors;
    CONSTANTS?: Record<string, unknown>;
    [key: string]: unknown;
}
