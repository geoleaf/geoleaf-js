/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Vector-tiles capability — layer-data assembly.
 *
 * Builds the shared-state layer-data record for a loaded VT layer. Originally extracted
 * from `vector-tiles.ts` to keep it under the 700-line limit; the orchestrator is now
 * well below it (a later refactor moved the MapLibre building to the adapter), and this
 * stays split as a self-contained pure builder.
 */

import type { GeoJSONCurrentStyle, GeoJSONLayerEntry } from "../../kernel/geojson/core-types.js";
import type { VtLayerDef } from "./types.js";
import { layerGeometry } from "../../kernel/config/index.js";

/** Assembles the shared-state layer-data record for a loaded VT layer. */
export function buildVtLayerData(args: {
    layerId: string;
    layerLabel: string;
    def: VtLayerDef;
    vtLayerName: string;
    tileUrl: string;
    styleData: GeoJSONCurrentStyle | null;
    createdSubIds: string[];
    layerBasePath: string;
}): GeoJSONLayerEntry {
    const {
        layerId,
        layerLabel,
        def,
        vtLayerName,
        tileUrl,
        styleData,
        createdSubIds,
        layerBasePath,
    } = args;
    return {
        id: layerId,
        label: layerLabel,
        layer: null, // No layer object (MapLibre)
        visible: true,
        config: def,
        clusterGroup: null,
        legendsConfig: def.legends,
        basePath: layerBasePath,
        useSharedCluster: false,
        features: [],
        // The alias resolves through `layerGeometry`. ⚠️ The order inverts
        // (`geometryType` first): no effect, none of the 6 configs declaring both
        // declares them DIFFERENT. The fallback stays "polygon", local to this
        // subsystem.
        geometryType: layerGeometry(def, "polygon"),
        isVectorTile: true,
        vtLayerName,
        vtTileUrl: tileUrl,
        currentStyle: styleData,
        _maplibreLayerId: layerId,
        _maplibreSubLayerIds: createdSubIds,
        _visibility: {
            current: true,
            logicalState: true,
            source: "system",
            userOverride: false,
            themeOverride: false,
            themeDesired: null,
            zoomConstrained: false,
        },
    };
}
