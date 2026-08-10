/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * @fileoverview Core style loading and validation logic for GeoLeaf.
 * Extracted from style-loader.ts as part of Sprint 1 refactoring.
 *
 * KERNEL S11 — `initStyleLoader`, `loadStyleLenient`, `preloadStyles` and `getCacheStats`
 * were removed: none had a production caller, only the test suite reached them. Their
 * removal collapsed the `loaderConfig` object too — `initStyleLoader` was its only writer,
 * so `debug`/`validateOnLoad`/`throwOnValidationError` were compile-time constants and every
 * branch reading them had one reachable side. Likewise `loadStyleLenient` was the only caller
 * passing `lenient = true`, so the lenient path was unreachable in production.
 */

"use strict";

import { Log } from "../log/index.js";
import { StyleValidator } from "../validators/style-validator.js";
import { getGeoLeaf } from "../general/geoleaf-global.js";
import { styleCache } from "./style-cache.js";
import { extractLabelConfig, _ensureLabelVisibleByDefault } from "./label-extractor.js";

/** Loaded-and-validated style result returned by the loader. */
interface LoadedStyleResult {
    styleData: unknown;
    labelConfig: Record<string, unknown> | null;
    metadata: {
        profileId: string;
        layerId: string;
        styleId: string;
        stylePath: string;
        hasIntegratedLabels: boolean;
        loadedAt: string;
    };
}

function getProfilesBasePath(): string {
    const cfg = getGeoLeaf()?.Config;
    if (cfg && typeof cfg.get === "function") {
        const configured = cfg.get("data.profilesBasePath", "profiles");
        if (typeof configured === "string" && configured.trim().length > 0) {
            return configured.endsWith("/") ? configured.slice(0, -1) : configured;
        }
    }
    return "profiles";
}

async function _parseStyleJson(
    response: Response,
    stylePath: string,
    ctx: Record<string, unknown>
): Promise<unknown> {
    try {
        return await response.json();
    } catch (jsonError: unknown) {
        const message = jsonError instanceof Error ? jsonError.message : String(jsonError);
        const stack = jsonError instanceof Error ? jsonError.stack : undefined;
        Log.error("[StyleLoader] ❌ JSON parse error:", stylePath);
        Log.error("Context:", JSON.stringify({ ...ctx, parseError: message }, null, 2));
        Log.error("Stack:", stack);
        throw new Error(
            `Style file contains malformed JSON: ${stylePath}\n` +
                `Parse error: ${message}\n` +
                `Please check the JSON syntax of the file.`,
            { cause: jsonError }
        );
    }
}

/** Validates the style data against the GeoLeaf schema. Throws on a schema violation. */
function _applyStyleValidation(
    styleData: unknown,
    stylePath: string,
    params: Record<string, unknown>
): void {
    const validationResult = StyleValidator
        ? StyleValidator.validateStyle(
              styleData as Record<string, unknown> | null | undefined,
              params
          )
        : { valid: true, errors: [], warnings: [] };

    if (!validationResult.valid) {
        const errorMessage = StyleValidator
            ? StyleValidator.formatValidationErrors(validationResult, stylePath)
            : "Validation errors";

        Log.error(errorMessage);

        throw new Error(
            `Style file does not match the GeoLeaf schema: ${stylePath}\n` +
                `Check the console for error details.`
        );
    }

    if (validationResult.warnings.length > 0) {
        Log.warn(`[StyleLoader] ${validationResult.warnings.length} warning(s) for ${stylePath}:`);
        validationResult.warnings.forEach((warning) => {
            Log.warn(`  - ${warning.field}: ${warning.message}`);
        });
    }
}

/**
 * Derives the style `id` from its file name when the file omits it.
 *
 * The schema stopped requiring `id` in S1/PRF-SCHEMA — "filename acts as id for ~20% of
 * style files" — but nothing ever performed that derivation, so consumers reading
 * `styleData.id` (e.g. `legend-generator`) got `undefined`. `styleId` is already the file
 * base name resolved upstream by the layer config, so it IS the documented fallback.
 * Mutates in place, before validation, like `_ensureLabelVisibleByDefault`.
 */
function _ensureStyleId(styleData: unknown, styleId: string): void {
    if (!styleData || typeof styleData !== "object") return;
    const data = styleData as Record<string, unknown>;
    if (data.id == null && styleId) data.id = styleId;
}

function _buildStyleResult(
    styleData: unknown,
    profileId: string,
    layerId: string,
    styleId: string,
    stylePath: string
): LoadedStyleResult {
    const labelConfig = extractLabelConfig(styleData);
    return {
        styleData,
        labelConfig,
        metadata: {
            profileId,
            layerId,
            styleId,
            stylePath,
            hasIntegratedLabels: labelConfig !== null,
            loadedAt: new Date().toISOString(),
        },
    };
}

function _throwStyleLoadError(error: unknown, ctx: Record<string, unknown>): never {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    Log.error("═══════════════════════════════════════════════════════");
    Log.error("❌ STYLE LOADING ERROR");
    Log.error("═══════════════════════════════════════════════════════");
    Log.error("Context:", JSON.stringify({ ...ctx, originalError: message }, null, 2));
    Log.error("Stack trace:", stack);
    Log.error("═══════════════════════════════════════════════════════");
    throw error;
}

/**
 * Loads and validates a style file.
 *
 * This is the **single** style-fetching entry point since S5.2: `LayerConfigManager
 * .loadDefaultStyle` delegates here rather than issuing its own bare `fetch()`, so the boot
 * path fetches each style once instead of twice and every style now goes through
 * {@link _applyStyleValidation}. See that function's own note for the arbitration.
 *
 * ⚠️ The cache key deliberately omits `styleDirectory`: for a given
 * `profileId:layerId:styleId` the directory comes from that layer's own config, so it cannot
 * differ between callers. Keying on it would split the cache and silently restore the double
 * fetch this function exists to prevent.
 *
 * @param {string} profileId - Profile ID.
 * @param {string} layerId - Layer ID.
 * @param {string} styleId - Style ID.
 * @param {string} styleFileName - Style file name (e.g. "default.json").
 * @param {string} layerDirectory - Layer directory (e.g. "layers/tourism_poi_all").
 * @param {string} [styleDirectory="styles"] - Sub-directory holding the style files, i.e. the
 *   layer's documented `styles.directory`. It was hard-coded to `"styles"` until S5.2, which
 *   made this the only fetch site and so had to honour the parameter both callers can set.
 * @returns {Promise<Object>} Loaded and validated style with extracted label config.
 * @throws {Error} If the file is invalid or not found.
 */
export async function loadAndValidateStyle(
    profileId: string,
    layerId: string,
    styleId: string,
    styleFileName: string | undefined,
    layerDirectory: string,
    styleDirectory = "styles"
) {
    const cacheKey = `${profileId}:${layerId}:${styleId}`;
    if (styleCache.has(cacheKey)) return styleCache.get(cacheKey);
    const profilesBasePath = getProfilesBasePath();
    const stylePath = `${profilesBasePath}/${profileId}/${layerDirectory}/${styleDirectory}/${styleFileName}`;
    try {
        const response = await fetch(stylePath);
        if (!response.ok)
            throw new Error(
                `Unable to load style file: ${stylePath}\nHTTP ${response.status}: ${response.statusText}`
            );
        const styleData = await _parseStyleJson(response, stylePath, {
            profileId,
            layerId,
            styleId,
            stylePath,
            httpStatus: response.status,
        });
        _ensureLabelVisibleByDefault(
            styleData as {
                label?: { enabled?: boolean; visibleByDefault?: boolean; [key: string]: unknown };
                [key: string]: unknown;
            },
            stylePath
        );
        _ensureStyleId(styleData, styleId);
        _applyStyleValidation(styleData, stylePath, { profileId, layerId, styleId, stylePath });
        const result = _buildStyleResult(styleData, profileId, layerId, styleId, stylePath);
        styleCache.set(cacheKey, result);
        return result;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // Sentinel match against the two messages thrown above: rethrow them verbatim rather
        // than wrapping them in the generic load-failure banner. Keep these substrings in sync
        // with `_parseStyleJson` and `_applyStyleValidation` — they are load-bearing.
        if (message.includes("malformed JSON") || message.includes("GeoLeaf schema")) throw error;
        _throwStyleLoadError(error, { profileId, layerId, styleId, styleFileName, layerDirectory });
    }
}
