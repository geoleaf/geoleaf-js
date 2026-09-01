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
     * ⚠️ `inlineConfig` is carried by `layerTemplates` instances, which have NO
     * `configFile`. It was missing from this type, which made `tourism`'s 24 templated
     * layers invisible to this whole file — with no error coming out.
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
 * Should the engine enumerate tiles? — the `enableTileCache` flag, FINALLY READ.
 *
 * 🛑 IT WAS NOT, AND THIS IS THE LIVE HALF OF A "HALF-DEAD" ENTRY. Measured:
 * `modules.offline.cache.enableTileCache` was **written** in four core locations
 * (`cache-manager.ts`, `downloader.ts` ×2, `lifecycle.ts`) and **read nowhere**; its
 * only two readers lived in `offline-ui`. The engine therefore only knew
 * `selection.includeTiles`, a value the **UI** persists — a host calling
 * `CacheManager.cacheProfile()` without a UI had no way to express the setting.
 *
 * ⚠️ AND THE CONSEQUENCE WRITTEN IN THE INVENTORY WAS INVERTED. It announced "a host
 * without the UI downloads tiles even with the flag at `false`". Measured in a
 * browser: with no persisted selection, `selection` is `null`, so `includeTiles` is
 * undefined, so **no tile was enumerated** — the exact opposite. Pre-flight failure
 * mode no. 2, carried on the effect.
 *
 * The flag is a **VETO**, not a default: at `false` it wins over any selection, even
 * one persisted before the profile changed its mind. At `true`, the user's selection
 * decides; absent one, we follow the declaration.
 *
 * @param selection - Selection persisted by the UI, or `null`.
 * @returns `true` when tiles enter the enumeration.
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

        return selection;
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

            // Object part computed ONCE: the three `resources.push` below must omit
            // `layerId` when the layer carries none — resources travel through the
            // persisted manifest, where a key present with value `undefined` is not
            // equivalent to its absence. Hoisted out of the pushes to avoid adding
            // three branches to this method's complexity (ESLint ceiling: 20).
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
            // 🛑 THE MISSING BRANCH, AND THE DOWNSTREAM HALF OF THE DEFECT.
            //
            // A `layerTemplates` instance carries its config INLINE and therefore has
            // NO `configFile`. The `if` above skipped it, the `else if (layer.url)`
            // too — it crossed the enumerator without producing a single resource. On
            // `tourism`, that made **24 layers out of 42** cache nothing, silently.
            //
            // ⚠️ Fixing `resolveProfileLayers` alone would NOT have sufficed: the
            // layers would have appeared in the selector, the user would have checked
            // them, and the download would have pulled nothing. A defect worse than
            // absence, because it promises.
            //
            // Nothing to refetch here: the config is already in `layers.json`, itself
            // enumerated with the profile. The directory is `layers/<id>` — the
            // convention `profile-loader.ts` applies to these same layers, and
            // reusing it rather than inventing one is what keeps the two paths from
            // diverging. The filename derivation goes through `layerDataPath`, as
            // above.
            else if (layer.inlineConfig) {
                // Extracted into a method for the same reason as `layerIdPart` just
                // above: inline, this branch pushed `_addLayerResources`' complexity
                // to 24 for an ESLint ceiling of 20. Seen red, not assumed.
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
     * Enumerates a layer's config AND the data it declares.
     *
     * ⚠️ Extracted from `_addLayerResources` for the SAME reason as `layerIdPart` and
     * `_addInlineConfigResource`: adding the templated-layers branch pushed the
     * caller's complexity to 24 for an ESLint ceiling of 20. Seen red twice — at 24,
     * then at 21 after the first extraction.
     *
     * @param resources - List under construction, mutated.
     * @param layer - Layer descriptor carrying `configFile`.
     * @param profileId - Identifier of the active profile.
     * @param basePath - Profiles URL base, the caller's convention.
     * @param layerIdPart - `{layerId}` object part, or empty.
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

        // 🛑 THIS BLOCK READ A KEY THAT EXISTS IN NO FILE.
        //
        // It typed the response `{ dataFile?, type? }` and tested
        // `layerConfig.dataFile`. But `dataFile` is the NORMALISED form, produced by
        // `profile-loader.ts` when hydrating a profile — and this path never goes
        // through it: `CacheStorage.loadProfileConfig` fetches the RAW `profile.json`,
        // then each layer config is refetched RAW here. Measured on the repo: **46 of
        // the 48 layer configs carry `data.file`, and 0 carry `dataFile`**.
        //
        // Consequence: the condition was false for every layer, the data was never
        // enumerated, hence never cached. A layer "downloaded for offline" came back
        // empty — and nothing said so, because a resource not enumerated is not a
        // resource in failure.
        //
        // ⚠️ The derivation lives in `layerDataPath`, not here: `profile-loader.ts`
        // needs it TOO, and redoing it in place would have given two places free to
        // diverge — the very defect removed elsewhere.
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
                    // Legitimate for a tiled or direct-`url` layer — but silent until
                    // now, which made the bug above indistinguishable from the normal
                    // case.
                    Log.debug(`[ResourceEnumerator] Layer ${layer.id}: no data file declared`);
                }

                if (layer.configFile) {
                    const layerDir = layer.configFile.substring(
                        0,
                        layer.configFile.lastIndexOf("/")
                    );
                    this._addStyleResources(
                        resources,
                        (layerConfig as { styles?: unknown }).styles,
                        `${basePath}/${profileId}/${layerDir}`,
                        layer.id,
                        layerIdPart
                    );
                }
            }
        } catch (error) {
            Log.warn(
                `[ResourceEnumerator] Failed to load config for ${layer.id}: ${(error as Error).message}`
            );
        }
    },

    /**
     * Pushes a layer's style files into the offline resources.
     *
     * 🛑 **Called from BOTH branches, and that is the point.** `configFile` layers and
     * `layerTemplates` instances are enumerated through two distinct paths; adding
     * styles to only one of them leaves the other family without offline styles —
     * exactly the defect recorded above in this file for the data, reproduced
     * identically.
     *
     * ⚠️ The path prefix is passed by the caller, never recomputed here. The repo's
     * three default `profilesBasePath` values diverge deliberately (`"profiles"` in
     * the style loader, `"profiles"` in the legend, `"../profiles"` here): a
     * well-meaning "harmonisation" would cache the resource under a key nobody looks
     * up.
     *
     * @param resources - The resource accumulator.
     * @param styles - The layer config's `styles` block, whatever its origin.
     * @param layerDirUrl - URL prefix of the layer directory, no trailing slash.
     * @param layerId - Layer identifier, for logging.
     * @param layerIdPart - The `{layerId}` fragment all resources carry.
     */
    _addStyleResources(
        resources: CacheResource[],
        styles: unknown,
        layerDirUrl: string,
        layerId: string | undefined,
        layerIdPart: { layerId?: string }
    ): void {
        if (!styles || typeof styles !== "object") return;
        const block = styles as {
            directory?: string;
            default?: string;
            available?: { file?: string }[];
        };
        const dir = typeof block.directory === "string" ? block.directory : "styles";
        const files = new Set<string>();
        for (const entry of Array.isArray(block.available) ? block.available : []) {
            if (entry && typeof entry.file === "string") files.add(entry.file);
        }
        if (typeof block.default === "string") files.add(block.default);
        if (files.size === 0) return;

        for (const file of [...files].sort()) {
            resources.push({
                url: `${layerDirUrl}/${dir}/${file}`,
                type: "config",
                priority: 3,
                ...layerIdPart,
            });
        }
        Log.debug(
            `[ResourceEnumerator] Layer ${layerId}: added ${files.size} style file(s) from ${dir}/`
        );
    },

    /**
     * Enumerates the data of a layer whose config sits INLINE in `layers.json` — a
     * `layerTemplates` instance.
     *
     * 🛑 These layers have NO `configFile`, so they crossed `_addLayerResources`
     * without producing a single resource: on `tourism`, 24 layers out of 42 were
     * checkable in the offline selector and pulled nothing, silently — a layer not
     * enumerated is not a layer in failure.
     *
     * No fetch: the config is already in `layers.json`, itself enumerated with the
     * profile. The directory is `layers/<id>`, the convention `profile-loader.ts`
     * applies to these same layers — reusing it rather than inventing one is what
     * keeps the offline path and the boot path from diverging. The filename
     * derivation goes through `layerDataPath`, like the `configFile` branch.
     *
     * @param resources - List under construction, mutated.
     * @param layer - Layer descriptor carrying `inlineConfig`.
     * @param profileId - Identifier of the active profile.
     * @param basePath - Profiles URL base, the caller's convention.
     * @param layerIdPart - `{layerId}` object part or empty — see its computation in the caller.
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
        this._addStyleResources(
            resources,
            layer.inlineConfig?.["styles"],
            `${basePath}/${profileId}/layers/${layer.id}`,
            layer.id,
            layerIdPart
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
            // ⚠️ `selection?.` AND NOT `selection.` — `_tilesRequested()` can return
            // `true` WITHOUT a selection (the UI-less host, which persists none). The
            // old guard `if (!selection?.includeTiles) return;` implicitly guaranteed
            // `selection` was non-null here; that is no longer true, and a test
            // brought it down (`Cannot read properties of null`).
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
