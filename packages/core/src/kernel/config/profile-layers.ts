/*!
 * GeoLeaf Core — Profile layers resolver
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 *
 * This file used to live under `capabilities/offline/`, which made it a
 * `plugin-storage` dependency on a CONFIGURATION-GATED capability: a profile can
 * disable `offline`, and a static import made it a de-facto mandatory capability.
 * Yet it does not deal with offline — it resolves a profile's layer list
 * (`profile.json` → `layers.json`). Its place is the profile/config domain, next to
 * `profile.ts` and `profile-loader.ts`.
 */

import { extractRawLayers, expandLayerTemplates } from "./profile-loader-helpers.js";

/**
 * Minimal layer descriptor (structural). Mirrors the plugin UI's `LayerLike` so the
 * UI callers of `resolveProfileLayers` stay assignment-compatible without a
 * core→plugin type import.
 */
export interface LayerLike {
    id?: string;
    configFile?: string;
    layerDir?: string;
    dataFile?: string;
    url?: string;
    /**
     * Config set INLINE in `layers.json`, for a `layerTemplates` instance.
     *
     * ⚠️ Such a layer has NO `configFile` — which is what made it vanish from the
     * whole offline path, four sites of which branch on that key. Its config is
     * already there, nothing to refetch; its directory is `layers/<id>` by
     * convention (`profile-loader.ts`).
     */
    inlineConfig?: Record<string, unknown>;
    [key: string]: unknown;
}

/** Minimal profile shape needed to locate the layers list. */
export interface ProfileWithLayers {
    layers?: LayerLike[];
    Files?: { layersFile?: string };
}

/** Path/guard options matching the calling site's fetch convention. */
interface ResolveLayersOptions {
    /** Prefix the URL with a leading slash (display convention). Default: false. */
    leadingSlash?: boolean;
    /** Optional URL guard run before fetch (e.g. validateFetchUrl on the download path). */
    validateUrl?: (url: string) => void;
    /**
     * Optional sink for load failures, called with a ready-made message.
     *
     * CAPACITÉS S1 — the warnings used to go straight to the core `Log`, which tethered
     * the whole logger to `plugin-storage`'s bundle (this module is a deep import of
     * that plugin). Injecting the sink keeps the diagnostics — every caller passes its
     * own logger — while leaving this file dependency-free. The resolve-to-empty
     * behaviour below is unchanged and deliberate.
     */
    onWarn?: (message: string) => void;
}

/**
 * Resolves the layer list of a profile.
 *
 * The served `profile.json` does NOT inline a `layers` array — layers live in a
 * separate file referenced by `profile.Files.layersFile` (`layers.json`, shaped
 * `{ layers: [{ id, configFile, layerManagerId }] }`). This helper returns
 * `profile.layers` when already present (forward-compat with an inlined array),
 * otherwise fetches the referenced file. It never throws: any failure resolves
 * to an empty array.
 *
 * Callers pass their own `profilesBasePath` and `leadingSlash`/`validateUrl` so
 * the URL is built with the exact convention their other fetches use (the
 * display path uses a leading slash + base "profiles"; the download path uses a
 * relative base "../profiles" guarded by `validateFetchUrl`).
 *
 * @param profile Parsed profile.json object.
 * @param profileId Active profile id.
 * @param profilesBasePath Base path for profiles (caller's convention).
 * @param opts Path/guard options matching the caller's fetch convention.
 * @returns The resolved layer descriptors (possibly empty).
 */
export async function resolveProfileLayers(
    profile: ProfileWithLayers | null | undefined,
    profileId: string,
    profilesBasePath: string,
    opts: ResolveLayersOptions = {}
): Promise<LayerLike[]> {
    if (profile?.layers && Array.isArray(profile.layers)) {
        return profile.layers;
    }

    const layersFile = profile?.Files?.layersFile;
    if (!layersFile || !profileId) return [];

    const prefix = opts.leadingSlash ? "/" : "";
    const url = `${prefix}${profilesBasePath}/${profileId}/${layersFile}`;

    try {
        opts.validateUrl?.(url);
        const response = await fetch(url);
        if (!response.ok) {
            opts.onWarn?.(`[ProfileLayers] Failed to load ${url}: ${response.status}`);
            return [];
        }
        // 🛑 THIS BLOCK DID `json.layers` AND IGNORED `layerTemplates`.
        //
        // Measured consequence: `tourism` declares **18 direct layers and 24
        // templated ones**; the 24 did NOT appear in the "Download for offline"
        // selector and cached nothing — **57% of the demo profile**, in the very
        // capability this work exists to prove. And the defect was silent: a layer
        // not enumerated is not a layer in failure.
        //
        // ⚠️ Resolution now goes through the SAME helpers as the production loader
        // (`profile-loader.ts`), not a second read written here. That was exactly
        // the defect: two resolution paths, one of which had forgotten the
        // templates. `extractRawLayers` brings bare-array tolerance along, which
        // this path lacked.
        const json = (await response.json()) as Record<string, unknown>;
        const regular = extractRawLayers(json) ?? [];
        return expandLayerTemplates(regular, json) as LayerLike[];
    } catch (error) {
        opts.onWarn?.(`[ProfileLayers] Error loading ${url}: ${(error as Error).message}`);
        return [];
    }
}
