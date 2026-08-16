/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage - Resource Enumerator
 * @version 3.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { fetchBounded } from "../../../utils/general/fetch-bounded.js";
import { layerDataPath } from "../../../utils/general/layer-data-path.js";
import { coreConfigGet } from "../config-seam.js";
import { CacheStorage } from "./storage.js";
import { CacheCalculator } from "./calculator.js";
import { StyleResolver, type ResolverZone } from "./style-resolver.js";

interface CacheResource {
    url: string;
    type: string;
    priority?: number;
    optional?: boolean;
    layerId?: string;
    [key: string]: unknown;
}
interface LayerSelection {
    layers?: string[];
    basemaps?: string[];
    includeTiles?: boolean;
    vectorZone?: ResolverZone;
}
interface BasemapConfig {
    id?: string;
    offline?: boolean;
    type?: string;
    style?: string;
    url?: string;
    [key: string]: unknown;
}
/**
 * The profile object as this enumerator consumes it — i.e. AFTER
 * `CacheStorage.loadProfileConfig` has reconciled it with the v2 layout.
 *
 * ⚠ `layers` and `icons` are NOT keys of the served profile.json: the v2 layout moved
 * them behind the `Files` manifest (`Files.layersFile`, `Files.modules.taxonomy`).
 * `loadProfileConfig` resolves both onto this object, which is why they can be read
 * here. Anything added to this interface must be fed there too — declaring a key the
 * loader never populates is precisely how the sprite went uncached for months.
 */
interface ProfileLike {
    id?: string;
    /**
     * Resolved from `Files.layersFile` by loadProfileConfig — never inlined.
     *
     * ⚠️ `inlineConfig` est porté par les instances de `layerTemplates`, qui n'ont PAS de
     * `configFile`. Il manquait à ce type jusqu'à la tâche 8.9, ce qui rendait les 24 couches
     * templatées de `tourism` invisibles à tout ce fichier — sans qu'aucune erreur ne sorte.
     */
    layers?: Array<{
        id?: string;
        url?: string;
        type?: string;
        configFile?: string;
        inlineConfig?: Record<string, unknown>;
    }>;
    /** Resolved from `Files.modules.taxonomy` by loadProfileConfig — never inlined. */
    icons?: { spriteUrl?: string };
    Files?: Record<string, unknown>;
    bundleFile?: string;
}

/**
 * Le moteur doit-il énumérer des tuiles ? — le drapeau `enableTileCache`, ENFIN LU.
 *
 * 🛑 IL NE L'ÉTAIT PAS, ET C'EST LA MOITIÉ VIVANTE D'UNE ENTRÉE « MI-MORTE ». Mesuré à la
 * tâche 3.13 : `modules.offline.cache.enableTileCache` était **écrit** en quatre endroits du
 * core (`cache-manager.ts`, `downloader.ts` ×2, `lifecycle.ts`) et **lu nulle part** ; ses
 * deux seuls lecteurs vivaient dans `offline-ui`. Le moteur ne connaissait donc que
 * `selection.includeTiles`, une valeur que **l'interface** persiste — un hôte qui appelle
 * `CacheManager.cacheProfile()` sans interface n'avait aucun moyen d'exprimer le réglage.
 *
 * ⚠️ ET LA CONSÉQUENCE ÉCRITE À L'INVENTAIRE ÉTAIT INVERSÉE. Elle annonçait « un hôte sans
 * l'UI télécharge les tuiles même avec le drapeau à `false` ». Mesuré en navigateur : sans
 * sélection persistée, `selection` vaut `null`, donc `includeTiles` est indéfini, donc
 * **aucune tuile n'était énumérée** — l'inverse exactement. Mode d'échec n° 2 de la règle de
 * pré-vol, porté sur l'effet.
 *
 * Le drapeau est un **VETO**, pas un défaut : à `false` il l'emporte sur toute sélection,
 * fût-elle persistée avant que le profil ne change d'avis. À `true`, la sélection de
 * l'utilisateur décide ; en son absence, on suit la déclaration.
 *
 * @param selection - Sélection persistée par l'interface, ou `null`.
 * @returns `true` si les tuiles entrent dans l'énumération.
 */
function _tilesRequested(selection: LayerSelection | null | undefined): boolean {
    const declared = coreConfigGet("modules.offline.cache.enableTileCache", true) as boolean;
    if (declared === false) return false;
    return selection?.includeTiles ?? true;
}

const ResourceEnumerator = {
    async enumerateAll(
        profile: ProfileLike,
        profileId: string,
        selection?: LayerSelection | null
    ): Promise<CacheResource[]> {
        const resources: CacheResource[] = [];
        const profilesBasePath = coreConfigGet("data.profilesBasePath", "../profiles") as string;

        // Load user selection if not provided
        if (!selection) {
            selection = await this._loadSelection(profileId);
        }

        Log.debug("[ResourceEnumerator] enumerateAll called with selection:", {
            hasSelection: !!selection,
            selectedLayers: selection?.layers,
            selectedBasemaps: selection?.basemaps,
            includeTiles: (selection as LayerSelection & { includeTiles?: boolean })?.includeTiles,
        });

        // 1. Mandatory resources (config + sprites)
        this._addConfigResources(resources, profile, profileId, profilesBasePath);
        this._addSpriteResources(resources, profile);

        // 2. Selected layers
        await this._addLayerResources(resources, profile, profileId, profilesBasePath, selection);

        // 3. Selected offline basemaps
        await this._addBasemapResources(resources, profileId, selection);

        Log.info(`[ResourceEnumerator] Enumerated ${resources.length} resources`);
        return resources;
    },

    /**
     * Loads the user selection from storage
     * @private
     */
    async _loadSelection(profileId: string): Promise<LayerSelection | null> {
        const Storage = CacheStorage;
        const selection = await Storage.loadLayerSelection(profileId);

        Log.info(`[ResourceEnumerator] ===== Layer selection loaded =====`);
        Log.info(`[ResourceEnumerator] Layers: ${JSON.stringify(selection?.layers || [])}`);
        Log.info(`[ResourceEnumerator] Basemaps: ${JSON.stringify(selection?.basemaps || [])}`);
        Log.info(
            `[ResourceEnumerator] includeTiles: ${(selection as LayerSelection)?.includeTiles}`
        );

        return selection as LayerSelection | null;
    },

    /**
     * Adds configuration resources: profile.json, the pre-built bundle when
     * declared, and every file referenced by the Files manifest (sections +
     * plugin configs, profile layout v2). Paths are never assumed — they come
     * from the manifest, so legacy and v2 layouts are both covered.
     * @private
     */
    _addConfigResources(
        resources: CacheResource[],
        profile: ProfileLike,
        profileId: string,
        basePath: string
    ) {
        const pushConfig = (relPath: string, optional: boolean) =>
            resources.push({
                url: `${basePath}/${profileId}/${relPath}`,
                type: "config",
                priority: 1,
                ...(optional && { optional: true }),
            });

        pushConfig("profile.json", false);

        // Pre-built bundle (deploy) — cached so the offline boot single-fetch works.
        if (typeof profile.bundleFile === "string" && profile.bundleFile) {
            pushConfig(profile.bundleFile, true);
        }

        // Section + plugin config files from the Files manifest.
        const files = profile.Files;
        if (files && typeof files === "object") {
            for (const [key, value] of Object.entries(files)) {
                if (key === "modules" && value && typeof value === "object") {
                    for (const filePath of Object.values(value as Record<string, unknown>)) {
                        if (typeof filePath === "string" && filePath) pushConfig(filePath, true);
                    }
                } else if (typeof value === "string" && value) {
                    pushConfig(value, true);
                }
            }
        }

        // Legacy profiles only: mapping.json at the profile root.
        pushConfig("mapping.json", true);
    },

    /**
     * Adds the profile's SVG sprite.
     *
     * `profile.icons` is NOT a key of the served profile.json — since taxonomy v3 the
     * block lives in the file behind `Files.modules.taxonomy`. It is reconciled onto the
     * profile object by `CacheStorage.loadProfileConfig`, the same place `layers` is
     * resolved; this method only reads the result.
     *
     * The URL is taken VERBATIM, exactly as the runtime loader does
     * (`_getSpriteUrl` → `_fetchAndInjectSprite`, utils/loaders/profile-sprite-loader.ts):
     * it fetches `spriteUrl` with no base path and no rewriting. Caching must request the
     * same URL the runtime requests, or the entry is stored under a key nobody looks up —
     * a cache that never hits. The previous `basePath`/`profileId` prefixing was
     * unreachable (the early-return above always fired) and would have produced exactly
     * that mismatch on any profile whose spriteUrl is not `../`-relative.
     * @private
     */
    _addSpriteResources(resources: CacheResource[], profile: ProfileLike) {
        const spriteUrl = profile.icons?.spriteUrl;
        if (typeof spriteUrl !== "string" || !spriteUrl) return;

        resources.push({
            url: spriteUrl,
            type: "icon",
            priority: 2,
        });
    },

    /**
     * Adds resources for selected layers
     * @private
     */
    async _addLayerResources(
        resources: CacheResource[],
        profile: ProfileLike,
        profileId: string,
        basePath: string,
        selection: LayerSelection | null
    ) {
        if (!profile.layers || !Array.isArray(profile.layers)) return;

        Log.debug(
            "[ResourceEnumerator] _addLayerResources: checking",
            profile.layers.length,
            "layers"
        );

        for (const layer of profile.layers) {
            // Filter by selection
            if (selection?.layers && layer.id != null && !selection.layers.includes(layer.id)) {
                Log.debug(`[ResourceEnumerator] Skipping layer: ${layer.id} (not selected)`);
                continue;
            }

            Log.debug(`[ResourceEnumerator] Adding layer: ${layer.id}`);

            // Part d'objet calculée UNE fois : les trois `resources.push` ci-dessous doivent
            // omettre `layerId` quand la couche n'en porte pas — les ressources transitent par
            // le manifeste persisté, où une clé présente valant `undefined` n'équivaut pas à
            // son absence. Hissée hors des push pour ne pas ajouter trois branches à la
            // complexité de cette méthode (plafond ESLint : 20).
            const layerIdPart = layer.id !== undefined ? { layerId: layer.id } : {};

            // If the layer has a configFile, load it to obtain the dataFile
            if (layer.configFile) {
                await this._addConfigFileResources(
                    resources,
                    layer,
                    profileId,
                    basePath,
                    layerIdPart
                );
            }
            // 🛑 TÂCHE 8.9 / C.15 — LA BRANCHE QUI MANQUAIT, ET LA MOITIÉ AVAL DU DÉFAUT.
            //
            // Une instance de `layerTemplates` porte sa config EN LIGNE et n'a donc AUCUN
            // `configFile`. Le `if` ci-dessus la sautait, le `else if (layer.url)` aussi —
            // elle traversait l'énumérateur sans produire une seule ressource. Sur `tourism`,
            // ça faisait **24 couches sur 42** qui ne cachaient rien, en silence.
            //
            // ⚠️ Corriger `resolveProfileLayers` seul n'aurait PAS suffi : les couches
            // seraient apparues dans le sélecteur, l'utilisateur les aurait cochées, et le
            // téléchargement n'aurait rien rapatrié. Un défaut pire que l'absence, parce
            // qu'il promet.
            //
            // Rien à refetcher ici : la config est déjà dans `layers.json`, lui-même énuméré
            // avec le profil. Le répertoire vaut `layers/<id>` — c'est la convention que
            // `profile-loader.ts:38` applique pour ces mêmes couches, et la reprendre plutôt
            // que d'en inventer une est ce qui empêche les deux chemins de diverger. La
            // dérivation du fichier passe par `layerDataPath`, comme au-dessus.
            else if (layer.inlineConfig) {
                // Extrait en méthode pour la même raison que `layerIdPart` juste au-dessus :
                // en ligne, cette branche portait la complexité de `_addLayerResources` à 24
                // pour un plafond ESLint de 20. Vu rouge, pas supposé.
                this._addInlineConfigResource(resources, layer, profileId, basePath, layerIdPart);
            }
            // Add data file if direct URL
            else if (layer.url) {
                const layerUrl = this._resolveUrl(layer.url, basePath, profileId);
                resources.push({
                    url: layerUrl,
                    type: layer.type || "data",
                    priority: 3,
                    ...layerIdPart,
                });
            }

            // Add tiles if tiled layer
            if (layer.type === "tile" && _tilesRequested(selection)) {
                const tiles = await this._enumerateTiles(layer, profileId);
                Log.info(`[ResourceEnumerator] Layer ${layer.id}: ${tiles.length} tiles`);
                resources.push(...tiles);
            }
        }
    },

    /**
     * Énumère la config d'une couche ET la donnée qu'elle déclare.
     *
     * ⚠️ Extrait de `_addLayerResources` à la tâche 8.9, pour la MÊME raison que
     * `layerIdPart` et que `_addInlineConfigResource` : ajouter la branche des couches
     * templatées portait la complexité de l'appelant à 24 pour un plafond ESLint de 20.
     * Vu rouge deux fois — à 24, puis à 21 après la première extraction.
     *
     * @param resources - Liste en construction, mutée.
     * @param layer - Descripteur de couche portant `configFile`.
     * @param profileId - Identifiant du profil actif.
     * @param basePath - Base d'URL des profils, convention de l'appelant.
     * @param layerIdPart - Part d'objet `{layerId}` ou vide.
     * @private
     */
    async _addConfigFileResources(
        resources: CacheResource[],
        layer: { id?: string; configFile?: string },
        profileId: string,
        basePath: string,
        layerIdPart: { layerId?: string }
    ): Promise<void> {
        if (!layer.configFile) return;

        const configUrl = `${basePath}/${profileId}/${layer.configFile}`;

        // Add the config file
        resources.push({
            url: configUrl,
            type: "config",
            priority: 2,
            ...layerIdPart,
        });

        // 🛑 TÂCHE 4.2 — CE BLOC LISAIT UNE CLÉ QUI N'EXISTE DANS AUCUN FICHIER.
        //
        // Il typait la réponse `{ dataFile?, type? }` et testait `layerConfig.dataFile`.
        // Or `dataFile` est la forme NORMALISÉE, produite par `profile-loader.ts` en
        // hydratant un profil — et ce chemin-ci ne passe jamais par lui :
        // `CacheStorage.loadProfileConfig` va chercher `profile.json` BRUT, puis on
        // refetch ici chaque config de couche BRUTE. Mesuré sur le dépôt : **46 des 48
        // configs de couche portent `data.file`, et 0 porte `dataFile`**.
        //
        // Conséquence : la condition était fausse pour toutes les couches, la donnée
        // n'était jamais énumérée, donc jamais mise en cache. Une couche « téléchargée
        // pour le hors-ligne » revenait vide — et rien ne le disait, parce qu'une
        // ressource non énumérée n'est pas une ressource en échec.
        //
        // ⚠️ La dérivation vit dans `layerDataPath`, pas ici : `profile-loader.ts` en a
        // besoin AUSSI, et la refaire sur place aurait donné deux endroits libres de
        // diverger — le défaut même que cette roadmap retire ailleurs.
        try {
            const response = await fetchBounded(configUrl);
            if (response.ok) {
                const layerConfig = (await response.json()) as {
                    dataFile?: unknown;
                    data?: unknown;
                    type?: string;
                };
                const dataPath = layerDataPath(layerConfig);

                if (dataPath && layer.configFile) {
                    const configDir = layer.configFile.substring(
                        0,
                        layer.configFile.lastIndexOf("/")
                    );
                    const dataUrl = `${basePath}/${profileId}/${configDir}/${dataPath}`;
                    resources.push({
                        url: dataUrl,
                        type: layerConfig.type || "geojson",
                        priority: 3,
                        ...layerIdPart,
                    });
                    Log.debug(
                        `[ResourceEnumerator] Layer ${layer.id}: added data file ${dataPath}`
                    );
                } else if (!dataPath) {
                    // Légitime pour une couche tuilée ou à `url` directe — mais silencieux
                    // jusqu'ici, ce qui rendait le bug ci-dessus indiscernable du cas normal.
                    Log.debug(`[ResourceEnumerator] Layer ${layer.id}: no data file declared`);
                }
            }
        } catch (error) {
            Log.warn(
                `[ResourceEnumerator] Failed to load config for ${layer.id}: ${(error as Error).message}`
            );
        }
    },

    /**
     * Énumère la donnée d'une couche dont la config est posée EN LIGNE dans `layers.json`
     * — une instance de `layerTemplates`.
     *
     * 🛑 Tâche 8.9 / C.15. Ces couches n'ont AUCUN `configFile`, donc elles traversaient
     * `_addLayerResources` sans produire une seule ressource : sur `tourism`, 24 couches
     * sur 42 étaient cochables dans le sélecteur hors-ligne et ne rapatriaient rien, en
     * silence — une couche non énumérée n'est pas une couche en échec.
     *
     * Aucun fetch : la config est déjà dans `layers.json`, lui-même énuméré avec le profil.
     * Le répertoire vaut `layers/<id>`, la convention que `profile-loader.ts:38` applique à
     * ces mêmes couches — la reprendre plutôt qu'en inventer une est ce qui empêche le
     * chemin hors-ligne et le chemin de boot de diverger. La dérivation du nom de fichier
     * passe par `layerDataPath`, comme la branche `configFile`.
     *
     * @param resources - Liste en construction, mutée.
     * @param layer - Descripteur de couche portant `inlineConfig`.
     * @param profileId - Identifiant du profil actif.
     * @param basePath - Base d'URL des profils, convention de l'appelant.
     * @param layerIdPart - Part d'objet `{layerId}` ou vide — voir son calcul dans l'appelant.
     * @private
     */
    _addInlineConfigResource(
        resources: CacheResource[],
        layer: { id?: string; inlineConfig?: Record<string, unknown> },
        profileId: string,
        basePath: string,
        layerIdPart: { layerId?: string }
    ): void {
        const dataPath = layerDataPath(layer.inlineConfig);
        if (!dataPath || !layer.id) {
            Log.debug(
                `[ResourceEnumerator] Layer ${layer.id}: inline config declares no data file`
            );
            return;
        }
        resources.push({
            url: `${basePath}/${profileId}/layers/${layer.id}/${dataPath}`,
            type: (layer.inlineConfig?.["type"] as string) || "geojson",
            priority: 3,
            ...layerIdPart,
        });
        Log.debug(
            `[ResourceEnumerator] Layer ${layer.id}: inline config, added data file ${dataPath}`
        );
    },

    /**
     * Adds resources for selected offline basemaps
     * @private
     */
    async _addBasemapResources(
        resources: CacheResource[],
        profileId: string,
        selection: LayerSelection | null
    ) {
        if (!_tilesRequested(selection)) return;

        const basemaps = coreConfigGet("basemaps", {}) as Record<string, BasemapConfig>;
        const offlineBasemaps = Object.values(basemaps).filter((bm) => bm.offline === true);

        for (const basemap of offlineBasemaps) {
            // Filter by selection.
            //
            // ⚠️ `selection?.` ET NON `selection.` — depuis 3.13, `_tilesRequested()` peut
            // rendre `true` SANS sélection (l'hôte sans interface, qui n'en persiste
            // aucune). L'ancienne garde `if (!selection?.includeTiles) return;` garantissait
            // implicitement que `selection` était non nul ici ; ce n'est plus vrai, et un
            // test l'a fait tomber (`Cannot read properties of null`).
            if (
                selection?.basemaps &&
                basemap.id != null &&
                !selection.basemaps.includes(basemap.id)
            ) {
                Log.debug(`[ResourceEnumerator] Skipping basemap: ${basemap.id} (not selected)`);
                continue;
            }

            // Vector (MapLibre style) basemap → resolve style/tiles/glyphs/sprite (S3).
            // Raster basemap → enumerate XYZ tiles from the URL template.
            const isVector = basemap.type === "maplibre" || (!!basemap.style && !basemap.url);
            const tiles = isVector
                ? await this._addVectorBasemapResources(basemap, selection)
                : await this._enumerateTiles(basemap, profileId);

            Log.info(`[ResourceEnumerator] Basemap ${basemap.id}: ${tiles.length} resources`);
            resources.push(...tiles);
        }
    },

    /**
     * Resolves a MapLibre vector basemap into offline resources via StyleResolver.
     * Uses the user-selected download zone (bbox + zoom ceiling); without a zone
     * the style/glyphs/sprite are still cached but vector tiles are skipped.
     * @private
     */
    async _addVectorBasemapResources(
        basemap: BasemapConfig,
        selection: LayerSelection | null
    ): Promise<CacheResource[]> {
        if (!basemap.style) {
            Log.warn(`[ResourceEnumerator] Vector basemap ${basemap.id} has no style URL`);
            return [];
        }

        const zone = selection?.vectorZone ?? null;
        if (!zone) {
            Log.warn(
                `[ResourceEnumerator] No download zone for ${basemap.id} — vector tiles skipped`
            );
        }

        return (await StyleResolver.enumerate(basemap.style, zone)) as CacheResource[];
    },

    /**
     * Resolves a relative or absolute URL
     * @private
     */
    _resolveUrl(url: string, basePath: string, profileId: string): string {
        if (url.startsWith("http://") || url.startsWith("https://")) {
            return url;
        } else if (url.startsWith("../")) {
            return url;
        } else {
            return `${basePath}/${profileId}/${url.replace("./", "")}`;
        }
    },

    /**
     * Enumerates tiles for a layer or basemap
     * @private
     */
    async _enumerateTiles(
        layerOrBasemap: {
            bounds?: unknown;
            offlineBounds?: unknown;
            url?: string;
            [key: string]: unknown;
        },
        profileId: string
    ): Promise<CacheResource[]> {
        try {
            return (await CacheCalculator.enumerateTiles(
                layerOrBasemap as Parameters<typeof CacheCalculator.enumerateTiles>[0],
                profileId
            )) as CacheResource[];
        } catch (error) {
            Log.error(
                `[ResourceEnumerator] Failed to enumerate tiles: ${(error as Error).message}`
            );
            return [];
        }
    },
};

Log.info("[ResourceEnumerator] Module loaded");

export { ResourceEnumerator };
