/*!
 * GeoLeaf Core (offline capability) — Profile icons resolver
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../../utils/log/index.js";
import { fetchBounded } from "../../../utils/general/fetch-bounded.js";

/**
 * Icon/sprite config block, as found at the root of `config/plugins/taxonomy.json`.
 * Deliberately NOT exported: callers infer it from `resolveProfileIcons`, so exporting
 * it would leave an orphan export (the B3 gate says so, and it is right). Export it the
 * day something actually imports it — unlike `LayerLike`, whose plugin-side consumers
 * need the name.
 */
interface IconsLike {
    spriteUrl?: string;
    [key: string]: unknown;
}

/** Minimal profile shape needed to locate the taxonomy config file. */
export interface ProfileWithIcons {
    icons?: IconsLike;
    Files?: { modules?: Record<string, unknown> };
}

/** Path/guard options matching the calling site's fetch convention. */
interface ResolveIconsOptions {
    /** Prefix the URL with a leading slash (display convention). Default: false. */
    leadingSlash?: boolean;
    /** Optional URL guard run before fetch (e.g. validateFetchUrl on the download path). */
    validateUrl?: (url: string) => void;
}

/**
 * Resolves the icon/sprite config of a profile.
 *
 * The served `profile.json` does NOT inline an `icons` block — since the taxonomy-v3
 * migration it lives at the root of the file referenced by `Files.modules.taxonomy`
 * (`config/plugins/taxonomy.json`), and is exposed at runtime as `modules.taxonomy.icons`.
 * This helper returns `profile.icons` when already present (forward-compat with an
 * inlined block), otherwise fetches the referenced file. It never throws: any failure
 * resolves to `null`.
 *
 * Mirrors the runtime gate of `GeoLeaf.Taxonomy.getIcons()`
 * (`capabilities/taxonomy/public-api.ts`): a capability disabled with `enabled: false`
 * loads no sprite, so there is nothing to cache either. `enabled` absent means enabled
 * (opt-out), matching `getTaxonomyConfig()`.
 *
 * @param profile Parsed profile.json object.
 * @param profileId Active profile id.
 * @param profilesBasePath Base path for profiles (caller's convention).
 * @param opts Path/guard options matching the caller's fetch convention.
 * @returns The icons block, or `null` when absent/disabled/unreachable.
 */
export async function resolveProfileIcons(
    profile: ProfileWithIcons | null | undefined,
    profileId: string,
    profilesBasePath: string,
    opts: ResolveIconsOptions = {}
): Promise<IconsLike | null> {
    if (profile?.icons && typeof profile.icons === "object") {
        return profile.icons;
    }

    // Deliberately NOT named after the retired root-level manifest key (the one the
    // extracted-features guard bans as a taxonomy-legacy token, retired 11/07 and purged
    // from the config inventory in S7). This reads the v3 entry `Files.modules.taxonomy`;
    // conflating the two names is precisely the confusion that guard prevents.
    const taxonomyModulePath = profile?.Files?.modules?.taxonomy;
    if (typeof taxonomyModulePath !== "string" || !taxonomyModulePath || !profileId) return null;

    const prefix = opts.leadingSlash ? "/" : "";
    const url = `${prefix}${profilesBasePath}/${profileId}/${taxonomyModulePath}`;

    try {
        opts.validateUrl?.(url);
        const response = await fetchBounded(url);
        if (!response.ok) {
            Log.warn(`[ProfileIcons] Failed to load ${url}: ${response.status}`);
            return null;
        }
        const json = (await response.json()) as { enabled?: unknown; icons?: IconsLike };
        if (json.enabled === false) return null;
        return json.icons && typeof json.icons === "object" ? json.icons : null;
    } catch (error) {
        Log.warn(`[ProfileIcons] Error loading ${url}: ${(error as Error).message}`);
        return null;
    }
}
