/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Config (public type boundary)
 *
 * Minimal configuration interface consumed by {@link ICoreModule.init}.
 * Deliberately lightweight to avoid circular dependencies between modules
 * and the full `GeoLeafConfig` type defined in `kernel/config/geoleaf-config/config-types.ts`.
 *
 * Implementors: the concrete `Config` object in `config-core.ts` satisfies
 * this interface without modification.
 */

/**
 * Minimal read-only interface to the GeoLeaf configuration system.
 *
 * Modules that implement `ICoreModule` receive an `IGeoLeafConfig` in their
 * `init()` call. They should use `get()` / `getAll()` to read settings rather
 * than importing the full `GeoLeafConfig` type, which would create a direct
 * coupling to the config module internals.
 *
 * @example
 * ```typescript
 * const theme = config.get<string>('ui.theme', 'light');
 * const allSettings = config.getAll();
 * ```
 */
export interface IGeoLeafConfig {
    /**
     * Returns the value associated with the given dot-notation key.
     * Returns `undefined` if the key does not exist.
     *
     * @param key - Dot-notation config key (e.g. `'ui.theme'`, `'map.zoom'`).
     */
    get(key: string): unknown;

    /**
     * Returns the value associated with the given dot-notation key,
     * falling back to `defaultValue` when the key is absent or `undefined`.
     *
     * @param key - Dot-notation config key.
     * @param defaultValue - Value returned when the key is not found.
     *
     * @example
     * ```typescript
     * const zoom = config.get<number>('map.zoom', 12);
     * ```
     */
    get<T = unknown>(key: string, defaultValue: T): T;

    /**
     * Returns a shallow snapshot of the entire resolved configuration object.
     * Callers must not mutate the returned record.
     */
    getAll(): Record<string, unknown>;

    /**
     * Returns `true` once the configuration has been fully loaded and resolved.
     * `ICoreModule.init()` is guaranteed to be called only after `isLoaded()` returns `true`.
     */
    isLoaded(): boolean;
}
