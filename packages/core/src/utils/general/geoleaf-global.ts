/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Typed access to the global `GeoLeaf` namespace.
 *
 * Canonical replacement for the ad-hoc `const _g/_gl: any = globalThis…` accessor
 * blocks scattered across the core. The namespace
 * shape is declared ambiently in `src/global.d.ts` (`GeoLeafGlobal`).
 */

/** Returns the global `GeoLeaf` namespace, or `undefined` before boot completes. */
export function getGeoLeaf(): GeoLeafGlobal | undefined {
    if (typeof globalThis !== "undefined" && globalThis.GeoLeaf) {
        return globalThis.GeoLeaf;
    }
    if (typeof window !== "undefined" && window.GeoLeaf) {
        return window.GeoLeaf;
    }
    return undefined;
}

/**
 * Returns the global `GeoLeaf` namespace, creating an empty one if absent.
 *
 * The typed way to the namespace for code that must MOUNT a member on it — the core's own
 * boot-time setup (`globals.*.ts`), and a module loaded beside the core. Exported from the
 * package since 3.15.0.
 *
 * @returns The namespace `globalThis.GeoLeaf` holds — never `undefined`.
 * @example
 * import { ensureGeoLeaf } from "@geoleaf/core";
 *
 * const loaded = ensureGeoLeaf().plugins?.isLoaded?.("table") ?? false;
 */
export function ensureGeoLeaf(): GeoLeafGlobal {
    const host = (
        typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {}
    ) as { GeoLeaf?: GeoLeafGlobal };
    host.GeoLeaf = host.GeoLeaf ?? {};
    return host.GeoLeaf;
}
