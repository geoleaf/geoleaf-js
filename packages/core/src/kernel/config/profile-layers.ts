/*!
 * GeoLeaf Core — Profile layers resolver
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 *
 * ARCHI S7 (7.3, geste 2) — ce fichier vivait sous `capabilities/offline/`, ce qui en
 * faisait une dépendance de `plugin-storage` vers une capacité GATÉE PAR CONFIGURATION :
 * un profil peut désactiver `offline`, et un import statique en faisait de fait une
 * capacité obligatoire. Or il ne traite pas d'offline — il résout la liste de couches
 * d'un profil (`profile.json` → `layers.json`). Sa place est le domaine profil/config,
 * aux côtés de `profile.ts` et `profile-loader.ts`.
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
     * Config posée EN LIGNE dans `layers.json`, pour une instance de `layerTemplates`.
     *
     * ⚠️ Une telle couche n'a PAS de `configFile` — c'est ce qui la faisait disparaître de
     * tout le chemin hors-ligne, dont quatre sites branchent sur cette clé. Sa config est
     * déjà là, il n'y a rien à refetcher ; son répertoire vaut `layers/<id>` par convention
     * (`profile-loader.ts:38`).
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
        // 🛑 TÂCHE 8.9 / C.15 — CE BLOC FAISAIT `json.layers` ET IGNORAIT `layerTemplates`.
        //
        // Conséquence mesurée : `tourism` déclare **18 couches directes et 24 templatées** ;
        // les 24 n'apparaissaient PAS dans le sélecteur « Télécharger pour hors-ligne » et
        // ne cachaient rien — **57 % du profil de démo**, dans la capacité que cette roadmap
        // existe pour prouver. Et le défaut était silencieux : une couche non énumérée n'est
        // pas une couche en échec.
        //
        // ⚠️ La résolution passe désormais par les MÊMES helpers que le chargeur de
        // production (`profile-loader.ts`), pas par une seconde lecture écrite ici. C'était
        // exactement le défaut : deux chemins de résolution, dont un avait oublié les
        // templates. `extractRawLayers` apporte au passage la tolérance au tableau nu, que
        // ce chemin-ci n'avait pas.
        const json = (await response.json()) as Record<string, unknown>;
        const regular = extractRawLayers(json) ?? [];
        return expandLayerTemplates(regular, json) as LayerLike[];
    } catch (error) {
        opts.onWarn?.(`[ProfileLayers] Error loading ${url}: ${(error as Error).message}`);
        return [];
    }
}
