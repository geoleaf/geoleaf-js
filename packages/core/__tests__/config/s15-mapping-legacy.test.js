/**
 * Config-contract Phase C / C6 — B7 legacy mapping.json (config/core/mapping.json).
 *
 * Two surfaces:
 *  1. schema — mapping.schema.json (hardened root, permissive named blocks). Sanity
 *     + the fact it ACCEPTS the runtime-broken gbif shape (the bug is runtime, not schema).
 *  2. live  — Normalization.normalizePoiWithMapping (normalization.ts) resolves the flat
 *     field-map from the top-level `mapping` OR a per-source named block, then applies it.
 *
 * @anomaly locks:
 *  - ANO-082 — categoryMapping/subcategoryMapping/coordinateFields/filter/source/description
 *    are schema-accepted but 0-consumer: dropping them does NOT change normalization output.
 *  - ANO-083 RÉSOLU (Archi S2) — per-source named blocks `{ <source>: { mapping } }` are now
 *    resolved & applied (auto when single, by `sourceKey` when several). The mapping contract
 *    (single OR multi-source, flat string→string) is formalized in mapping.schema.json.
 *  - ANO-084 — superseded: the named-block form is now a SUPPORTED contract, not legacy to
 *    migrate. The remaining gap (normalizePoiWithMapping has no runtime caller — the mapping
 *    pipeline is not wired into the layer loader) is tracked separately in the Archi backlog.
 *
 * Inventory B7 (S9), registre ANO-082/083/084. Fixture = profiles/_reference/config/core/mapping.json.
 */

import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { ConfigNormalizer } from "../../src/kernel/config/normalization.ts";
import { REFERENCE_MAPPING, clone } from "./_helpers/config-harness.js";

// config → __tests__ → core → packages → <repo root>
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const schema = JSON.parse(
    readFileSync(resolve(ROOT, "profiles/schemas/mapping.schema.json"), "utf8")
);
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

// ─── schema sanity (mapping.schema.json) ──────────────────────────────────────

describe("config B7 — mapping.schema.json sanity", () => {
    it("the reference fixture validates", () => {
        expect(validate(REFERENCE_MAPPING)).toBe(true);
    });
    it("accepts a per-source named block (multi-source contract — ANO-083 résolu)", () => {
        expect(validate({ gbif: { source: "g", mapping: { id: "x" } } })).toBe(true);
    });
    it("rejects an unknown root key (additionalProperties:false)", () => {
        expect(validate({ bogusRootKey: 1 })).toBe(false);
    });
});

// ─── live: normalizePoiWithMapping resolves the per-source block then applies it ──

describe("config B7 — normalizePoiWithMapping (per-value, via REFERENCE_MAPPING)", () => {
    const raw = () => [
        { ref_id: "p1", ref_name: "Point One", lat: 48.85, lon: 2.35, kind: "museum" },
    ];

    it("maps raw fields → normalized POI field by field (single block auto-resolved)", () => {
        const out = ConfigNormalizer.normalizePoiWithMapping(raw(), clone(REFERENCE_MAPPING));
        expect(out).toEqual([
            {
                id: "p1",
                title: "Point One",
                location: { lat: 48.85, lng: 2.35 },
                attributes: { kind: "museum" },
            },
        ]);
    });

    it("no mapping config → passthrough by reference (raw array untouched)", () => {
        const input = raw();
        expect(ConfigNormalizer.normalizePoiWithMapping(input, null)).toBe(input);
        expect(ConfigNormalizer.normalizePoiWithMapping(input, {})).toBe(input);
    });

    // ── @anomaly ANO-082 — only `mapping` is consumed; the rest is dead ─────────
    it("@anomaly ANO-082: categoryMapping/coordinateFields/filter/source do NOT affect output", () => {
        const full = ConfigNormalizer.normalizePoiWithMapping(raw(), clone(REFERENCE_MAPPING));
        const mappingOnly = ConfigNormalizer.normalizePoiWithMapping(raw(), {
            reference: { mapping: REFERENCE_MAPPING.reference.mapping },
        });
        expect(full).toEqual(mappingOnly);
    });

    // ── ANO-083 RÉSOLU — per-source named blocks are resolved & applied ──────────
    it("single named block {gbif:{mapping}} is auto-resolved and applied", () => {
        const cfg = {
            gbif: {
                source: "gbif",
                mapping: { id: "x", title: "y", "location.lat": "lat", "location.lng": "lon" },
            },
        };
        const input = [{ x: "p9", y: "Nine", lat: 1, lon: 2 }];
        expect(ConfigNormalizer.normalizePoiWithMapping(input, cfg)).toEqual([
            { id: "p9", title: "Nine", location: { lat: 1, lng: 2 }, attributes: {} },
        ]);
    });

    it("multiple blocks → the matching `sourceKey` is applied", () => {
        const cfg = {
            gbif: {
                mapping: { id: "gid", title: "gname", "location.lat": "la", "location.lng": "lo" },
            },
            inpn: {
                mapping: { id: "iid", title: "iname", "location.lat": "la", "location.lng": "lo" },
            },
        };
        const input = [{ gid: "g1", gname: "G", iid: "i1", iname: "I", la: 3, lo: 4 }];
        expect(ConfigNormalizer.normalizePoiWithMapping(input, cfg, "inpn")).toEqual([
            { id: "i1", title: "I", location: { lat: 3, lng: 4 }, attributes: {} },
        ]);
    });

    it("multiple blocks WITHOUT a sourceKey → ambiguous → no-op passthrough", () => {
        const cfg = {
            gbif: { mapping: { id: "gid", title: "gname" } },
            inpn: { mapping: { id: "iid", title: "iname" } },
        };
        const input = [{ gid: "g1", gname: "G" }];
        expect(ConfigNormalizer.normalizePoiWithMapping(input, cfg)).toBe(input);
    });
});
