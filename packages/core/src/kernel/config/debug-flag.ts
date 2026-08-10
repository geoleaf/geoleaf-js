/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Centralized debug mode accessor.
 *
 * Phase 10-A: Extracts the `globalThis.GeoLeaf.DEBUG` lookup into a dedicated
 * utility so modules can declare the dependency explicitly rather than
 * reading the global namespace directly.
 *
 * NOTE: This still reads `globalThis.GeoLeaf.DEBUG` at call time to support
 * the use casee where end users set `window.GeoLeaf.DEBUG = true` after init.
 */

/**
 * Returns whether GeoLeaf debug mode is currently active.
 * Reads the runtime flag set by end users via `window.GeoLeaf.DEBUG = true`.
 */
export function getDebugMode(): boolean {
    const g = globalThis as unknown as { GeoLeaf?: { DEBUG?: boolean } };
    return g.GeoLeaf?.DEBUG === true;
}
