/**
 * Unit tests — the API-simple capability installers.
 *
 * Covers the 3 API-side capabilities (taxonomy, feature-info, cluster): declaration
 * wiring (layer C), the registerGlobals facade write moved out of globals.api.ts's
 * assignApiFacades (layer B), the createModule factory — ABSENT for taxonomy and
 * cluster, both pull-based policy capabilities — and the facade read-API.
 *
 * The read-API block is deterministic coverage for capabilities/<cap>/{public-api,config}.ts:
 * without a live Config, each reader falls back to its built-in DEFAULTS. It replaces the
 * fragile incidental coverage those files used to get from a full boot (non-deterministic
 * under pool:forks). Installers are loaded via ESM `await import()` — never `require(".ts")`,
 * which would create a second, non-merged V8 instance under forks + tsx + V8 coverage.
 */

import { describe, expect, it } from "vitest";

const taxonomy = await import("../../src/capabilities/taxonomy/install.ts");
const taxonomyCap = await import("../../src/capabilities/taxonomy/taxonomy-capability.ts");
const taxonomyFacade = await import("../../src/api/geoleaf.taxonomy.ts");

const featureInfo = await import("../../src/capabilities/feature-info/install.ts");
const featureInfoCap =
    await import("../../src/capabilities/feature-info/feature-info-capability.ts");
const featureInfoMod = await import("../../src/capabilities/feature-info/module.ts");
const featureInfoFacade = await import("../../src/api/geoleaf.featureinfo.ts");

const cluster = await import("../../src/capabilities/cluster/install.ts");
const clusterCap = await import("../../src/capabilities/cluster/cluster-capability.ts");
const clusterFacade = await import("../../src/api/geoleaf.cluster.ts");

const cases = [
    {
        id: "taxonomy",
        key: "Taxonomy",
        installer: taxonomy.TAXONOMY_INSTALLER,
        declaration: taxonomyCap.TAXONOMY_CAPABILITY,
        // Policy capability: taxonomy hands out symbol ids, paint expressions and
        // badge colours to whoever asks, and subscribes to nothing. No ICoreModule.
        Module: null,
        facade: taxonomyFacade.Taxonomy,
        // No getConfig() on this facade — the read surface is icons/categories/mappings.
        readApi: (f) => {
            // Opt-out: with no live config the capability is ON, not off.
            expect(f.isEnabled()).toBe(true);
            expect(f.getIcons()).toBeNull();
            expect(f.getCategories("unknown-taxonomy")).toEqual({});
            expect(f.getFieldMappings("unknown-taxonomy")).toEqual({});
            expect(f.getIconVariants()).toEqual([]);
            expect(f.resolvePoiIcon({ layerId: "unknown-layer" })).toMatchObject({
                useIcon: false,
            });
            expect(f.resolveMarkerPaint("unknown-layer", {})).toBeNull();
            expect(f.resolveBadgeStyle("unknown-layer", {}, "popup", "categoryId")).toBeNull();
        },
    },
    {
        id: "feature-info",
        key: "FeatureInfo",
        installer: featureInfo.FEATURE_INFO_INSTALLER,
        declaration: featureInfoCap.FEATURE_INFO_CAPABILITY,
        Module: featureInfoMod.FeatureInfoModule,
        facade: featureInfoFacade.FeatureInfo,
        readApi: (f) => {
            expect(typeof f.isEnabled()).toBe("boolean");
            // getConfig(layerId) resolves a per-layer binding — null without a live config.
            // NB: toBeTypeOf("object") would pass on null (typeof null === "object").
            expect(f.getConfig("unknown-layer")).toBeNull();
        },
    },
    {
        id: "cluster",
        key: "Cluster",
        installer: cluster.CLUSTER_INSTALLER,
        declaration: clusterCap.CLUSTER_CAPABILITY,
        // Policy capability (pull-based resolvers) → no ICoreModule.
        Module: null,
        facade: clusterFacade.Cluster,
        readApi: (f) => {
            expect(typeof f.isEnabled()).toBe("boolean");
            expect(f.getConfig()).toBeTypeOf("object");
        },
    },
];

describe.each(cases)("$id installer (capabilities/$id/install)", (c) => {
    it("exposes its capability declaration", () => {
        expect(c.installer.declaration).toBe(c.declaration);
        expect(c.installer.declaration.id).toBe(c.id);
    });

    it(`registerGlobals assigns GeoLeaf.${c.key} (ex-assignApiFacades) and is additive`, () => {
        const gl = { existing: 1 };
        c.installer.registerGlobals(gl);
        expect(gl[c.key]).toBe(c.facade);
        expect(gl.existing).toBe(1);
    });

    if (c.Module) {
        it("createModule returns a fresh module instance with the right id", () => {
            const m = c.installer.createModule();
            expect(m).toBeInstanceOf(c.Module);
            expect(m.id).toBe(c.id);
            expect(c.installer.createModule()).not.toBe(m);
        });
    } else {
        it("declares no createModule (policy capability — no ICoreModule to register)", () => {
            expect(c.installer.createModule).toBeUndefined();
        });
    }

    // Deterministic read-API coverage (public-api / config): without a live config each
    // reader falls back to its DEFAULTS. Replaces the fragile incidental boot coverage.
    it("facade read-API works without a live config", () => {
        c.readApi(c.facade);
    });
});
