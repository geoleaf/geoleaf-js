/**
 * Config-contract Phase C / C4 — B5 layer-config @anomaly regression-locks.
 *
 * Posture (Mattieu, S13): DETECT & CONSIGN — the read-but-unschema'd keys are LOCKED,
 * not "fixed" by loosening the schema. Each no-mapping CONTRAT anomaly carries two
 * assertions: (1) live — the code consumes the key (asserted in the sibling s13-*
 * file noted inline); (2) schema — AJV's verdict against the hardened layer-config
 * schema. Aliases resolved in S7 (geometryType ANO-007, tooltipMode ANO-008) are
 * confirmed schema-ACCEPTED with a mirror enum. Orphans / plugin keys / legacy keep
 * an it.todo with their consumer site so coverage stays traceable.
 *
 * Schema: profiles/schemas/layer-config.schema.json. Inventory B5,
 * registre ANO-050→058 (+ ANO-002/007/008/031/057 cross-refs).
 */

import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { REFERENCE_LAYER_CONFIG } from "./_helpers/config-harness.js";

// config → __tests__ → core → packages → <repo root>
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const readSchema = (n) =>
    JSON.parse(readFileSync(resolve(ROOT, `profiles/schemas/${n}.schema.json`), "utf8"));

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validate = ajv.compile(readSchema("layer-config"));

/** Minimal schema-valid layer-config, merged with the probed fragment. */
const doc = (extra) => ({ id: "reference-points", ...extra });

describe("config B5 — layer-config schema sanity", () => {
    it("the reference fixture {id}_config.json is schema-valid", () => {
        expect(validate(REFERENCE_LAYER_CONFIG)).toBe(true);
    });
    it("minimal {id} document is valid", () => {
        expect(validate(doc({}))).toBe(true);
    });
    it("unknown root key is rejected (additionalProperties:false)", () => {
        expect(validate(doc({ bogusRootKey: 1 }))).toBe(false);
    });
});

describe("ANO-055 RÉSOLU (Archi S3) — data.vectorTiles.scheme déclaré (enum [xyz,tms])", () => {
    // live: s13-layer-data.test.js asserts loadVectorTileLayer builds the source with scheme:"tms"
    it("schema: data.vectorTiles.scheme is now ACCEPTED (enum xyz/tms)", () => {
        expect(
            validate(
                doc({
                    data: {
                        vectorTiles: {
                            enabled: true,
                            tilesUrl: "https://x/{z}/{x}/{y}.pbf",
                            scheme: "tms",
                        },
                    },
                })
            )
        ).toBe(true);
    });
    it("schema: an unknown scheme value is rejected (enum)", () => {
        expect(
            validate(
                doc({
                    data: {
                        vectorTiles: {
                            enabled: true,
                            tilesUrl: "https://x/{z}/{x}/{y}.pbf",
                            scheme: "bogus",
                        },
                    },
                })
            )
        ).toBe(false);
    });
    it("sanity: the same vectorTiles block WITHOUT scheme is accepted", () => {
        expect(
            validate(
                doc({
                    data: { vectorTiles: { enabled: true, tilesUrl: "https://x/{z}/{x}/{y}.pbf" } },
                })
            )
        ).toBe(true);
    });
});

describe("ANO-056 RÉSOLU (Archi S3) — data.ogcApi déclaré + durci (miroir OgcApiConfig)", () => {
    // live: geojson/loader/single-layer.ts reads data.ogcApi (OGC API Features source)
    it("schema: a valid ogcApi block (url required) is accepted", () => {
        expect(
            validate(
                doc({
                    data: {
                        ogcApi: {
                            url: "https://api.example/collections/roads/items",
                            limit: 500,
                            bbox: [-1, 48, 1, 49],
                        },
                    },
                })
            )
        ).toBe(true);
    });
    it("schema: ogcApi without `url` is rejected (required)", () => {
        expect(validate(doc({ data: { ogcApi: { collectionId: "roads" } } }))).toBe(false);
    });
    it("schema: an unknown ogcApi key is rejected (additionalProperties:false)", () => {
        expect(validate(doc({ data: { ogcApi: { url: "https://x", bogus: 1 } } }))).toBe(false);
    });
});

describe("@anomaly ANO-057 — sidepanelFields root alias (historical; read path removed S9)", () => {
    // The `sidepanelFields` root alias was a code-only normalization output consumed by the
    // now-removed popup-tooltip binders / POI config helpers; the schema always rejected it.
    it("schema: root sidepanelFields is rejected → inconfigurable (canonical = sidepanelConfig.detailLayout)", () => {
        expect(validate(doc({ sidepanelFields: [{ type: "text", field: "x" }] }))).toBe(false);
    });
});

describe("config B5 — resolved aliases are schema-accepted (mirror enums)", () => {
    it("ANO-007 geometryType: enum mirror of geometry is accepted; bogus value rejected", () => {
        expect(validate(doc({ geometryType: "point" }))).toBe(true);
        expect(validate(doc({ geometryType: "bogus" }))).toBe(false);
    });
});

describe("config B5 — S9 render slice: legacy attribute-config keys removed (schema-rejected)", () => {
    // `popup` / `tooltip` / `sidepanelConfig` / root `tooltipMode` are removed: feature
    // rendering (tooltip/popup/side-panel) is now configured under the plugin-owned
    // `capabilities.feature-info` block. Breaking change, no shim — the strict root
    // `additionalProperties:false` now rejects the legacy keys.
    it("rejects the legacy `tooltip` block", () => {
        expect(validate(doc({ tooltip: { mode: "hover" } }))).toBe(false);
    });
    it("rejects the legacy `popup` block", () => {
        expect(validate(doc({ popup: { enabled: true } }))).toBe(false);
    });
    it("rejects the legacy `sidepanelConfig` block", () => {
        expect(validate(doc({ sidepanelConfig: { enabled: true } }))).toBe(false);
    });
    it("rejects the legacy root `tooltipMode` alias", () => {
        expect(validate(doc({ tooltipMode: "hover" }))).toBe(false);
    });
});

describe("config B5 — orphan / legacy / plugin keys (schema-accepted, locked it.todo)", () => {
    // Orphans — schema-accepted but no core consumer (registre)
    it.todo(
        "ANO-050 layers.json layers[].defaultVisible — 0 core consumer (visibility via theme B4)"
    );
    it.todo(
        "ANO-051 layers.json layerTemplates[].templateId — not destructured by expandLayerTemplates"
    );
    it.todo("ANO-052 {id}_config.plugin — no core auto-routing (API loadLayerFromConfig)");
    it.todo(
        "ANO-053 {id}_config.data.licence / data.format — 0 consumer (format inferred from ext)"
    );
    it.todo(
        "ANO-058 {id}_config.table.searchFields — 0 consumer (filter reads config.searchFields)"
    );
    // Legacy → renvoi B9 (mapping.json)
    it.todo("ANO-054 {id}_config.data.mapping / data.mappingFile — legacy mapping → roadmap B9");
    // Plugin-owned per-layer keys → renvoi B7 / roadmap plugin-validation
    // ⚠️ `formSchema` a quitté cette ligne à la tâche 7.2 : la clé n'existe plus, le schéma
    // la REFUSE désormais, et la saisie se déclare sur `attributes.fields[].edit` — couvert
    // par `attributes-opposability` (A14/A17) et `write-capture-parity`, pas par un renvoi.
    it.todo("B7 renvoi — edition.{create,update,delete}/editableGeometryTypes (editor)");
    // ⚠️ `pointStyle` a quitté cette ligne le 11/08/2026 (B-225), pour la même raison que
    // `formSchema` ci-dessus : la clé n'existe plus. Elle a été retirée du résolveur au S3
    // (`e17e41a6`, BREAKING v3.0.0) et ne figure ni en source, ni dans les schémas, ni dans
    // les profils livrés — un renvoi vers elle certifierait une dette sans objet.
    it.todo(
        "B7 renvoi — data.limit/data.realtime/realtimeLayer/write (flatgeobuf/realtime/editor)"
    );
});
