/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import { ConfigStore } from "./storage.js";

/** POI-like object with optional id, title/label, latlng or location */
interface PoiLike {
    id?: string;
    title?: string;
    label?: string;
    latlng?: [number, number];
    location?: { lat: number; lng: number };
    attributes?: Record<string, unknown>;
    [key: string]: unknown;
}

function _isValidLatLng(lat: unknown, lng: unknown): boolean {
    return (
        typeof lat === "number" &&
        !Number.isNaN(lat) &&
        typeof lng === "number" &&
        !Number.isNaN(lng)
    );
}

function _poiHasValidLocation(p: PoiLike): boolean {
    if (Array.isArray(p.latlng) && p.latlng.length >= 2) {
        const [lat, lng] = p.latlng;
        if (_isValidLatLng(lat, lng)) return true;
    }
    if (p.location && typeof p.location === "object") {
        const { lat, lng } = p.location;
        if (_isValidLatLng(lat, lng)) return true;
    }
    return false;
}

/**
 * Module Config.Normalization
 *
 * Responsibilities:
 * - Structural normalization of POIs (raw mapping -> GeoLeaf format)
 * - Application of mapping.json to non-normalized POIs
 * - Validation of the POI structure: id / title / location
 */

/**
 * A mapping.json config — ALWAYS an object of named per-source blocks
 * `{ <sourceId>: { mapping } }`. A single source is one block (no top-level form).
 * See mapping.schema.json. (ANO-083 — per-source contract.)
 */
type MappingConfig = Record<string, unknown>;

const NormalizationModule = {
    /**
     * Type guard: does this object already satisfy the normalized POI structure?
     * Requires a non-empty string `id`, a non-empty `title` OR `label`, and valid
     * coordinates in either `latlng` or `location`.
     * @param poi - Candidate object.
     * @returns `true` when no mapping pass is needed for this item.
     */
    isPoiStructNormalized(poi: unknown): poi is PoiLike {
        if (!poi || typeof poi !== "object") return false;
        const p = poi as PoiLike;
        if (typeof p.id !== "string" || p.id.trim() === "") return false;
        const hasTitle = typeof p.title === "string" && p.title.trim() !== "";
        const hasLabel = typeof p.label === "string" && p.label.trim() !== "";
        if (!hasTitle && !hasLabel) return false;
        return _poiHasValidLocation(p);
    },

    /**
     * Applies a flat field-map to one raw item, producing a normalized POI.
     * @param rawPoi - Raw source record (e.g. a GBIF occurrence or an OurAirports row).
     * @param mappingDef - Flat map of `targetPath -> sourcePath`, both dotted.
     * @returns The normalized POI, or `null` when the mapping is unusable. Numeric ids are
     * coerced to string, and a non-object `attributes` is reset to `{}`.
     * @security Target paths come from a profile file — see the note on the write loop.
     */
    mapRawPoiToNormalized(
        rawPoi: Record<string, unknown>,
        mappingDef: Record<string, string>
    ): {
        id: string;
        title: string;
        location: { lat: number; lng: number };
        attributes: Record<string, unknown>;
    } | null {
        if (!rawPoi || !mappingDef || typeof mappingDef !== "object") return null;
        if (!ConfigStore) {
            Log.error("[GeoLeaf.Config.Normalization] Module Storage non disponible.");
            return null;
        }
        const normalized: Record<string, unknown> = {
            id: "",
            title: "",
            location: { lat: 0, lng: 0 },
            attributes: {},
        };
        // @security `targetPath` comes from the profile's mapping.json keys, i.e. from a
        // config file rather than from the code. setValueByPath refuses any segment naming
        // a prototype key, so a hostile mapping cannot graft inherited properties onto the
        // POIs built here (they would otherwise flow on into feature properties and popups).
        Object.keys(mappingDef).forEach((targetPath) => {
            const sourcePath = mappingDef[targetPath];
            if (!sourcePath) return;
            const value = ConfigStore.getValueByPath(rawPoi, sourcePath);
            if (typeof value === "undefined") return;
            ConfigStore.setValueByPath(normalized, targetPath, value);
        });
        // POI ids must be strings (e.g. the GBIF `key` is numeric) — coerce so the structural
        // validation (isPoiStructNormalized) and downstream feature ids stay consistent.
        if (typeof normalized.id === "number") normalized.id = String(normalized.id);
        if (
            !normalized.attributes ||
            typeof normalized.attributes !== "object" ||
            Array.isArray(normalized.attributes)
        ) {
            normalized.attributes = {};
        }
        return normalized as {
            id: string;
            title: string;
            location: { lat: number; lng: number };
            attributes: Record<string, unknown>;
        };
    },

    /**
     * Resolves the flat field-map to apply from a mapping.json config. The config is
     * ALWAYS an object of named per-source blocks `{ <sourceId>: { mapping } }`.
     * (ANO-083 — per-source contract.)
     *
     * Resolution:
     *  - exactly one source block → auto-selected;
     *  - several blocks + explicit `sourceKey` matching one → that block;
     *  - zero, or several without a `sourceKey` → null (no applicable mapping → no-op).
     */
    _resolveMappingDef(
        mappingConfig: MappingConfig | null,
        sourceKey?: string
    ): Record<string, string> | null {
        if (!mappingConfig || typeof mappingConfig !== "object") return null;
        const asMap = (v: unknown): Record<string, string> | null =>
            v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : null;
        // Named source blocks = values carrying their own `mapping` object.
        const blocks = Object.keys(mappingConfig).filter(
            (k) => asMap((mappingConfig[k] as { mapping?: unknown } | null)?.mapping) !== null
        );
        const chosen =
            sourceKey && blocks.includes(sourceKey)
                ? sourceKey
                : blocks.length === 1
                  ? blocks[0]
                  : undefined;
        if (!chosen) return null;
        return asMap((mappingConfig[chosen] as { mapping?: unknown }).mapping);
    },

    /**
     * Normalizes an array of raw items using a `mapping.json` config.
     * Items already satisfying the POI structure are passed through untouched; the others
     * go through the field-map. Items still invalid afterwards are dropped with a warning.
     * @param rawPoiArray - Raw items. A non-array yields `[]`.
     * @param mappingConfig - `mapping.json` content: named per-source blocks (ANO-083).
     * @param sourceKey - Selects a block when several are declared; optional with exactly one.
     * @returns The normalized POIs. Returns the input as-is when no mapping applies.
     */
    normalizePoiWithMapping(
        rawPoiArray: PoiLike[],
        mappingConfig: MappingConfig | null,
        sourceKey?: string
    ): PoiLike[] {
        if (!Array.isArray(rawPoiArray)) return [];
        const mappingDef = this._resolveMappingDef(mappingConfig, sourceKey);
        if (!mappingDef) {
            Log.debug(
                "[GeoLeaf.Config.Normalization] No applicable mapping (top-level or per-source); " +
                    "POIs used as-is (no structural normalization)."
            );
            return rawPoiArray;
        }
        const result: PoiLike[] = [];
        rawPoiArray.forEach((rawPoi, index) => {
            if (this.isPoiStructNormalized(rawPoi)) {
                result.push(rawPoi);
                return;
            }
            const normalized = this.mapRawPoiToNormalized(
                rawPoi as unknown as Record<string, unknown>,
                mappingDef
            );
            if (normalized && this.isPoiStructNormalized(normalized)) {
                result.push(normalized);
            } else {
                Log.warn(
                    "[GeoLeaf.Config.Normalization] POI not normalized even after mapping; POI skipped.",
                    { poiIndex: index, poiId: rawPoi && (rawPoi as PoiLike).id }
                );
            }
        });
        return result;
    },
};

const ConfigNormalizer = NormalizationModule;
export { ConfigNormalizer };
