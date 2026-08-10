/*!
 * GeoLeaf File Import Plugin — TopoJSON Converter
 * Converts TopoJSON topology to GeoJSON FeatureCollection.
 *
 * Uses topojson-client to convert topology objects,
 * merges all objects into a single FeatureCollection.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import * as topojsonClient from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, Geometry } from "geojson";
import type { IFileConverter, ConvertResult } from "./i-converter.js";
import { emptyFC } from "./i-converter.js";

// ─── Main converter ───────────────────────────────────────────────────────────

/**
 * TopoJSON → GeoJSON converter.
 * Iterates all objects in the topology and merges them into a single
 * GeoJSON FeatureCollection using topojson-client.feature().
 */
export const topojsonConverter: IFileConverter = {
    formatName: "TopoJSON",

    convert(input: string | ArrayBuffer): ConvertResult {
        const str = typeof input === "string" ? input : new TextDecoder().decode(input);

        if (!str || str.trim().length === 0) {
            return { data: emptyFC(), warnings: ["Empty TopoJSON input"] };
        }

        const warnings: string[] = [];

        try {
            const topology = JSON.parse(str) as Topology;

            if (!topology.objects || typeof topology.objects !== "object") {
                return {
                    data: emptyFC(),
                    warnings: ["Invalid TopoJSON: no 'objects' property found"],
                };
            }

            const objectNames = Object.keys(topology.objects);
            if (objectNames.length === 0) {
                return {
                    data: emptyFC(),
                    warnings: ["TopoJSON has no objects to convert"],
                };
            }

            const allFeatures: Feature<Geometry>[] = [];

            for (const name of objectNames) {
                const obj = topology.objects[name];
                const fc = topojsonClient.feature(topology, obj as GeometryCollection);

                if (fc.type === "FeatureCollection") {
                    for (const f of fc.features) {
                        if (!f.properties) (f as Feature<Geometry>).properties = {};
                        (f.properties as Record<string, unknown>)._topoObjectName = name;
                        allFeatures.push(f as Feature<Geometry>);
                    }
                } else if (fc.type === "Feature") {
                    const feat = fc as unknown as Feature<Geometry>;
                    if (!feat.properties) feat.properties = {};
                    (feat.properties as Record<string, unknown>)._topoObjectName = name;
                    allFeatures.push(feat);
                }
            }

            return {
                data: { type: "FeatureCollection", features: allFeatures },
                warnings,
            };
        } catch (err) {
            return {
                data: emptyFC(),
                warnings: [`TopoJSON parsing error: ${(err as Error).message}`],
            };
        }
    },
};
