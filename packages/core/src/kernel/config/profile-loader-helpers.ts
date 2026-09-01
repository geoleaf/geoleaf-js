/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Pure helpers and shared types for the modular profile loader.
 * Extracted from profile-loader.ts (file size cap) — no I/O, no module state.
 */

import { ConfigStore } from "./storage.js";
import { isUnsafeKey } from "../../utils/general/object-path-guard.js";
import { layerDataPath } from "../../utils/general/layer-data-path.js";

/**
 * A profile as declared on disk, before its referenced files are fetched.
 *
 * The `Files` block names side-car documents (themes, layers, basemaps, ui) that the loader
 * resolves relative to the profile's base path — the profile itself carries only the pointers.
 */
export interface ProfileWithFiles {
    Files?: {
        themesFile?: string;
        layersFile?: string;
        basemapsFile?: string;
        uiFile?: string;
        featuresFile?: string;
        /** POI data normalization mapping (mapping.json — per-source named blocks). */
        mappingFile?: string;
        /** Module id -> plugin config file path (profile layout v2). */
        modules?: Record<string, string>;
    };
    themes?: unknown;
    modules?: Record<string, unknown>;
    layers?: unknown[];
    version?: string;
    [key: string]: unknown;
}

/**
 * A layer entry in a profile: an id plus how to obtain its configuration.
 *
 * ⚠️ Two mutually exclusive routes. `configFile` is fetched over HTTP; `inlineConfig` is
 * already-expanded configuration — produced by a `layerTemplate` — and **skips the fetch
 * entirely**. A ref carrying both takes the inline path.
 */
export interface LayerRef {
    id: string;
    configFile?: string;
    layerManagerId?: string;
    /** Inline config generated from a layerTemplate expansion — skips HTTP fetch. */
    inlineConfig?: Record<string, unknown>;
}

interface LayerTemplateInstance {
    id: string;
    label: string;
    dataFile: string;
    [key: string]: unknown;
}

interface LayerTemplate {
    templateId: string;
    layerManagerId?: string;
    template: Record<string, unknown>;
    instances: LayerTemplateInstance[];
}

/**
 * One layer's configuration once resolved, whatever route it came by.
 *
 * `config` is `null` when resolution failed — the entry is kept rather than dropped so the
 * caller can report which layer is missing instead of silently loading fewer than declared.
 */
export interface LayerConfigResult {
    id: string;
    config: Record<string, unknown> | null;
    layerDirectory: string | null;
    layerManagerId: string | null;
}

/**
 * Everything the enrichment pass needs to turn a declared profile into a usable one.
 *
 * Gathered into one object rather than a long parameter list because the pass threads all of
 * it through several helpers; adding a field here is cheaper than re-threading a signature.
 */
export interface EnrichedProfileParams {
    profile: ProfileWithFiles;
    baseUrl: string;
    profileId: string;
    themes: Record<string, unknown> | null;
    mapping?: Record<string, unknown> | null;
    layersSource: unknown[];
    layersConfigs: LayerConfigResult[];
}

/** Validates the Files manifest: string paths, plus the modules map shape. */
export function validateFiles(files: Record<string, unknown>, warn: (msg: string) => void): void {
    for (const [key, val] of Object.entries(files)) {
        if (key === "modules") {
            validateFilesModules(val, warn);
            continue;
        }
        if (val !== undefined && typeof val !== "string") {
            warn(`Files.${key} should be a string filename`);
        }
    }
}

/** Validates the Files.modules map: module id -> string file path. */
export function validateFilesModules(value: unknown, warn: (msg: string) => void): void {
    if (value === undefined) return;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        warn("Files.modules should be an object mapping module ids to file paths");
        return;
    }
    for (const [moduleId, filePath] of Object.entries(value as Record<string, unknown>)) {
        if (typeof filePath !== "string") {
            warn(`Files.modules.${moduleId} should be a string file path`);
        }
    }
}

/** True when the value is a plain (non-array) object eligible for a deep merge. */
function _isMergeableBlock(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Merges the plugin-config bag loaded from `Files.modules` files with the
 * inline `modules` block of profile.json. The inline block wins per module
 * (it acts as a local override of the file). Returns undefined when neither
 * source declares anything, so callers do not create an empty bag.
 */
export function mergeModuleBags(
    fromFiles: Record<string, unknown> | null | undefined,
    inline: Record<string, unknown> | null | undefined
): Record<string, unknown> | undefined {
    const hasFiles = !!fromFiles && Object.keys(fromFiles).length > 0;
    const hasInline = _isMergeableBlock(inline);
    if (!hasFiles && !hasInline) return undefined;
    if (!hasFiles) return inline as Record<string, unknown>;
    // @security Both bags come from profile JSON. The spread above uses
    // CreateDataPropertyOrThrow, so a `__proto__` in `fromFiles` does NOT trigger the
    // setter — it lands as an own data property shadowing the accessor. Harmless in
    // itself, but it must not travel on into the config, so it is dropped here rather
    // than relied upon to be inert.
    const merged: Record<string, unknown> = {};
    for (const [moduleId, block] of Object.entries(fromFiles)) {
        if (isUnsafeKey(moduleId)) continue;
        merged[moduleId] = block;
    }
    if (hasInline) {
        for (const [moduleId, inlineBlock] of Object.entries(inline)) {
            // The inline block IS parsed JSON, so this assignment is the live vector.
            if (isUnsafeKey(moduleId)) continue;
            const fileBlock = merged[moduleId];
            merged[moduleId] =
                _isMergeableBlock(fileBlock) && _isMergeableBlock(inlineBlock)
                    ? ConfigStore.deepMerge(fileBlock, inlineBlock)
                    : inlineBlock;
        }
    }
    return merged;
}

/** Warns for every basemap entry missing both `url` and `style`. */
export function validateBasemaps(
    basemaps: Record<string, unknown>,
    warn: (msg: string) => void
): void {
    for (const [id, entry] of Object.entries(basemaps)) {
        const bm = entry as Record<string, unknown> | null;
        if (!bm || (!bm.url && !bm.style)) {
            // Sanitize id before logging: limit to 64 chars and strip control chars
            const safeId = String(id)
                .replaceAll(/[^\w.-]/g, "_")
                .slice(0, 64);
            warn(`basemaps.${safeId}: "url" or "style" is required`);
        }
    }
}

/**
 * Warns when `map.center` looks like it was written `[lng, lat]`.
 *
 * `center` is `[lat, lng]` (map/facade.ts `_centerFromArray`), same order as `bounds`. Three
 * profiles had it swapped — guyane declared `[-53, 4]`, i.e. latitude -53 (Southern Ocean)
 * instead of 4°N. It went unnoticed because they also declare `bounds`, which the loader
 * prefers; the wrong center only bites the day the bounds go away.
 *
 * A range check alone would not catch it (-53 is a valid latitude), so the tell is a center
 * sitting OUTSIDE its own bounds while fitting once swapped.
 */
export function validateMapCenter(map: Record<string, unknown>, warn: (msg: string) => void): void {
    const center = map.center;
    if (!Array.isArray(center) || center.length !== 2) return;
    const [lat, lng] = center as [number, number];
    if (typeof lat !== "number" || typeof lng !== "number") return;

    if (Math.abs(lat) > 90) {
        warn(
            `map.center: [${lat}, ${lng}] — first value is a LATITUDE and must be within ` +
                `[-90;90]. Order is [lat, lng]; this looks swapped`
        );
        return;
    }

    const bounds = map.bounds;
    if (!Array.isArray(bounds) || bounds.length !== 2) return;
    const [[latMin, lngMin], [latMax, lngMax]] = bounds as [[number, number], [number, number]];
    const inside = lat >= latMin && lat <= latMax && lng >= lngMin && lng <= lngMax;
    const insideSwapped = lng >= latMin && lng <= latMax && lat >= lngMin && lat <= lngMax;
    if (!inside && insideSwapped) {
        warn(
            `map.center: [${lat}, ${lng}] falls outside map.bounds but fits once swapped — ` +
                `both are [lat, lng]. Did you mean [${lng}, ${lat}] ?`
        );
    }
}

/** Returns the raw layers array from a layers file payload, or null. */
export function extractRawLayers(layersFileData: Record<string, unknown> | null): unknown[] | null {
    if (!layersFileData) return null;
    if (Array.isArray((layersFileData as { layers?: unknown[] }).layers)) {
        return (layersFileData as { layers: unknown[] }).layers;
    }
    return Array.isArray(layersFileData) ? (layersFileData as unknown[]) : null;
}

/**
 * Expands `layerTemplates` from the layers file into individual LayerRef entries
 * with pre-built inline configs, appended after the regular layers array.
 */
export function expandLayerTemplates(
    regularLayers: unknown[],
    layersFileData: Record<string, unknown> | null
): LayerRef[] {
    const templates = (layersFileData as { layerTemplates?: LayerTemplate[] } | null)
        ?.layerTemplates;
    if (!templates || !Array.isArray(templates) || templates.length === 0) {
        return regularLayers as LayerRef[];
    }
    const expanded: LayerRef[] = [...(regularLayers as LayerRef[])];
    for (const tpl of templates) {
        if (!Array.isArray(tpl.instances)) continue; // guard: malformed template
        const baseData = (tpl.template.data as { directory?: string } | undefined) ?? {};
        for (const inst of tpl.instances) {
            const { id, label, dataFile, ...overrides } = inst;
            const data = { directory: baseData.directory ?? "data", file: dataFile };
            const normalisedDataFile = layerDataPath({ data });
            expanded.push({
                id,
                ...(tpl.layerManagerId !== undefined && { layerManagerId: tpl.layerManagerId }),
                inlineConfig: {
                    ...tpl.template,
                    ...overrides,
                    id,
                    label,
                    data,
                    // 🛑 `dataFile` NORMALISED HERE, and that is what makes the
                    // inline config usable outside the core.
                    //
                    // Without it, `inlineConfig` was the ONLY config form in the repo
                    // whose data path derived solely through `layerDataPath`, a
                    // core-internal helper. `offline-ui` — which calls
                    // `resolveProfileLayers` and may import no core source (PCB
                    // baseline at `[]`) — therefore could NOT compute it: its three
                    // selector sites fell back to `configFile`, absent here, and 24
                    // of `tourism`'s 42 layers displayed with no label, no geometry
                    // and no cache state.
                    //
                    // ⚠️ The two other outcomes were set aside, for the same motive:
                    // publishing `layer-data-path.js` in the core's `exports` would
                    // widen the published surface for a helper, and re-deriving it
                    // in the plugin would reopen exactly the divergence closed by
                    // extracting `layerDataPath` ("the offline cache path needed it
                    // TOO, redoing it there would have made two places free to
                    // diverge").
                    //
                    // ✅ No effect on `profile-loader.ts`, which already derives
                    // through the same helper: it returns `dataFile` as-is when set.
                    // Idempotent, and both callers of `expandLayerTemplates` see the
                    // same shape.
                    ...(normalisedDataFile !== null && { dataFile: normalisedDataFile }),
                },
            });
        }
    }
    return expanded;
}
