/*!
 * GeoLeaf Core – Configured absences of in-core capabilities
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Turns the absence of an in-core capability that the configuration asks for
 * into a fact, at boot, on the {@link Capabilities} channel.
 *
 * ## Why a boot-time verdict holds here, and only here
 *
 * `unavailable-capabilities.ts` explains why "confront the `modules.<id>` keys against the
 * registry at boot" is false **in general**: a plugin can register a capability lazily, long
 * after boot, or never. That motive does not reach the in-core capabilities. Their installers
 * are composed by the preset manifest and declared at boot pass 1 — **or never**: a bundle
 * that does not embark one has no way to declare it later. For that closed set the question
 * "is it absent?" has a defined answer once pass 1 has run, and this module answers it.
 *
 * Plugin ids are never accused: they are not in {@link IN_CORE_CAPABILITY_IDS}.
 *
 * ## What is declared
 *
 * An in-core capability that the merged configuration **names** (`modules.<id>` is an object)
 * without switching it off (`enabled: false`), and that the bundle does not embark. Not named,
 * nothing asks for it and its absence stays silent — the principle the capability recipe
 * retained: an absence is said when something asks for it, never otherwise.
 */

import { CapabilityRegistry } from "./capability-registry.js";
import { declareUnavailable } from "./unavailable-capabilities.js";

/**
 * Ids of the in-core capabilities — the full manifest's, as a closed list of strings.
 *
 * Kept as strings rather than derived from the manifest: importing the manifest would pull
 * every installer into every bundle, which is the very thing a reduced entry leaves out. A
 * guard test holds it equal to the full manifest, in both directions.
 */
export const IN_CORE_CAPABILITY_IDS: readonly string[] = [
    "branding",
    "cluster",
    "coordinates",
    "feature-info",
    "filter",
    "geolocation",
    "labels",
    "language-switcher",
    "legend",
    "offline",
    "permalink",
    "profile-switcher",
    "pwa",
    "route",
    "scale",
    "taxonomy",
    "theme-palette",
    "theme-selector",
    "theme-toggle",
    "toast-renderer",
    "vector-tiles",
];

/** The motif a host displays — one sentence, as {@link declareUnavailable} asks. */
function _motif(id: string): string {
    return (
        `the configuration names it (modules.${id}) but the bundle does not embark it — ` +
        `its controls and behaviour are absent`
    );
}

/**
 * Declares unavailable every in-core capability the configuration names and the bundle lacks.
 *
 * Call it once per boot, after the preset declarations (pass 1) and with the MERGED
 * configuration: before pass 1 every capability would read as absent, and before the profile
 * merge a block the profile adds would be missed. Idempotent per id, like the channel it feeds.
 *
 * @param config - The merged configuration object.
 *
 * @example
 * ```ts
 * declareConfiguredAbsences(effectiveCfg);
 * GeoLeaf.Capabilities.onUnavailable(({ id, motif }) => console.warn(id, motif));
 * ```
 */
export function declareConfiguredAbsences(config: object | null | undefined): void {
    const modules = (config as { modules?: Record<string, unknown> } | null | undefined)?.modules;
    if (!modules || typeof modules !== "object") return;

    for (const id of IN_CORE_CAPABILITY_IDS) {
        const block = modules[id];
        if (!block || typeof block !== "object") continue;
        if ((block as { enabled?: unknown }).enabled === false) continue;
        if (CapabilityRegistry.getSchema(id) !== null) continue;
        declareUnavailable(id, _motif(id));
    }
}
