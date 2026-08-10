/**
 * Config-contract Phase C / C5 — B6 styles/{style}.json @anomaly regression-locks.
 *
 * Posture (Mattieu, S8/S14): DETECT & CONSIGN — read-but-unschema'd keys are LOCKED, not
 * "fixed" by loosening style.schema.json. Each code-only CONTRAT anomaly carries two
 * assertions: (1) live — the code consumes the key (asserted here or in the sibling s14-*
 * file noted inline); (2) schema — AJV's verdict against the hardened style schema.
 * Keys that are schema-ACCEPTED but dead (no-mapping) keep the schema sanity + an it.todo
 * with their consumer/registre site so coverage stays traceable.
 *
 * Schema: profiles/schemas/style.schema.json. Inventory B6, registre ANO-059→075.
 */

import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
    toCasingPaint,
    normalizeToFlat,
} from "../../src/adapters/maplibre/maplibre-style-converter.js";
import { REFERENCE_STYLE, REFERENCE_STYLE_ALT } from "./_helpers/config-harness.js";

// config → __tests__ → core → packages → <repo root>
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const readSchema = (n) =>
    JSON.parse(readFileSync(resolve(ROOT, `profiles/schemas/${n}.schema.json`), "utf8"));

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validate = ajv.compile(readSchema("style"));

/** Minimal schema-valid style, merged with the probed fragment. */
const doc = (extra) => ({ id: "reference-style", ...extra });

describe("config B6 — style schema sanity", () => {
    it("both reference fixtures (defaut.json, alt.json) are schema-valid", () => {
        expect(validate(REFERENCE_STYLE)).toBe(true);
        expect(validate(REFERENCE_STYLE_ALT)).toBe(true);
    });
    it("minimal {id} style is valid; id is optional (filename acts as id)", () => {
        expect(validate(doc({}))).toBe(true);
        expect(validate({})).toBe(true);
    });
    it("unknown root key is rejected (additionalProperties:false)", () => {
        expect(validate(doc({ bogusRootKey: 1 }))).toBe(false);
    });
    it("unknown flatStyle key is rejected (flatStyle additionalProperties:false)", () => {
        expect(validate(doc({ style: { bogusStyleKey: 1 } }))).toBe(false);
    });
});

describe("config B6 — label oneOf (selector string OR text-config object)", () => {
    it("string label accepted (selector label)", () =>
        expect(validate(doc({ label: "Défaut" }))).toBe(true));
    it("object label accepted (requires enabled)", () =>
        expect(validate(doc({ label: { enabled: true, field: "properties.name" } }))).toBe(true));
    it("object label WITHOUT enabled rejected (oneOf matches neither branch)", () =>
        expect(validate(doc({ label: {} }))).toBe(false));
});

describe("config B6 — styleRules operator enum is hardened", () => {
    const OPERATORS = [
        "==",
        "===",
        "eq",
        "!=",
        "!==",
        "neq",
        ">",
        ">=",
        "<",
        "<=",
        "contains",
        "startsWith",
        "endsWith",
        "in",
        "notIn",
        "between",
    ];
    OPERATORS.forEach((op) => {
        it(`operator "${op}" is accepted`, () => {
            expect(
                validate(
                    doc({
                        styleRules: [{ when: { field: "p.x", operator: op, value: 1 }, style: {} }],
                    })
                )
            ).toBe(true);
        });
    });
    it("unknown operator rejected (enum)", () => {
        expect(
            validate(
                doc({
                    styleRules: [
                        { when: { field: "p.x", operator: "bogus", value: 1 }, style: {} },
                    ],
                })
            )
        ).toBe(false);
    });
    it("styleRule without `style` rejected (required)", () => {
        expect(
            validate(doc({ styleRules: [{ when: { field: "p.x", operator: "==", value: 1 } }] }))
        ).toBe(false);
    });
});

describe("ANO-060 — layerScale (root) legacy alias REMOVED in S3; still rejected by schema", () => {
    // live read removed in S3 (roadmap_code) — was visibility.ts currentStyle.layerScale fallback + warn
    it("schema: root layerScale rejected → inconfigurable (canonical = scaleConfig)", () => {
        expect(validate(doc({ layerScale: { minScale: 50000, maxScale: 1000 } }))).toBe(false);
    });
    it("sanity: the canonical scaleConfig + labelScale ARE accepted", () => {
        expect(validate(doc({ scaleConfig: { minScale: 9222148, maxScale: 2252 } }))).toBe(true);
        expect(validate(doc({ labelScale: { minScale: 50000, maxScale: 1000 } }))).toBe(true);
    });
    // N-1 (S5): `zoomConfig` retired. Its minZoom/maxZoom naming invited zoom levels into a
    // field read as scale denominators, hiding 18 layers at every zoom. The schema must
    // reject it outright so a stale profile fails loudly instead of losing its constraint.
    it("schema: retired zoomConfig rejected at root", () => {
        expect(validate(doc({ zoomConfig: { minZoom: 4, maxZoom: 18 } }))).toBe(false);
    });
    it("schema: minZoom/maxZoom rejected inside scaleConfig (no alias survives)", () => {
        expect(validate(doc({ scaleConfig: { minZoom: 4, maxZoom: 18 } }))).toBe(false);
    });
});

describe("ANO-068 — style.casing.{dashArray,lineCap,lineJoin} read by code AND accepted by schema (résolu — archi B.5)", () => {
    it("live: toCasingPaint reads casing.dashArray/lineCap/lineJoin", () => {
        const paint = toCasingPaint(
            { enabled: true, dashArray: "2 2", lineCap: "round", lineJoin: "bevel" },
            2
        );
        expect(paint["line-dasharray"]).toEqual([2, 2]);
        expect(paint["line-cap"]).toBe("round");
        expect(paint["line-join"]).toBe("bevel");
    });
    it("schema: those casing keys are now ACCEPTED (B.5 — schéma aligné sur le code)", () => {
        expect(validate(doc({ style: { casing: { dashArray: "2 2" } } }))).toBe(true);
        expect(validate(doc({ style: { casing: { lineCap: "round" } } }))).toBe(true);
        expect(validate(doc({ style: { casing: { lineJoin: "bevel" } } }))).toBe(true);
    });
    it("sanity: the schema'd casing keys ARE accepted", () => {
        expect(
            validate(
                doc({
                    style: {
                        casing: { enabled: true, color: "#000000", opacity: 0.8, widthPx: 1 },
                    },
                })
            )
        ).toBe(true);
    });
});

describe("ANO-069 — style.sizePx legacy radius alias REMOVED in S3 (roadmap_code)", () => {
    it("live: normalizeToFlat no longer aliases sizePx → radius (removed)", () => {
        expect(normalizeToFlat({ sizePx: 5 }).radius).toBeUndefined();
    });
    it("schema: style.sizePx still rejected (flatStyle additionalProperties:false)", () => {
        expect(validate(doc({ style: { sizePx: 5 } }))).toBe(false);
    });
});

describe("@anomaly ANO-072 — styleRules[].legend.description read by code, rejected by schema", () => {
    // live: s14-style-legend-labels.test.js asserts generateLegendItem carries legend.description
    it("schema: styleRule.legend.description rejected (legend additionalProperties:false)", () => {
        expect(
            validate(doc({ styleRules: [{ style: {}, legend: { label: "L", description: "d" } }] }))
        ).toBe(false);
    });
    it("sanity: legend.{label,order} ARE accepted", () => {
        expect(
            validate(doc({ styleRules: [{ style: {}, legend: { label: "L", order: 1 } }] }))
        ).toBe(true);
    });
});

describe("config B6 — schema-ACCEPTED but dead/no-mapping (sanity + it.todo)", () => {
    // style.paint validates (passthrough) AND is now merged by the converter (ANO-059 résolu —
    // live assertion in s14-style-converter-paint.test.js). The remaining keys here validate but
    // the converter ignores them — finalisation deferred to the cleanup roadmap.
    it("schema accepts style.paint (passthrough, additionalProperties:true)", () =>
        expect(validate(doc({ style: { paint: { "fill-antialias": true } } }))).toBe(true));
    it("ANO-062 RÉSOLU — line* aliases REMOVED from schema → now rejected (flatStyle additionalProperties:false)", () => {
        expect(validate(doc({ style: { lineColor: "#000000" } }))).toBe(false);
        expect(validate(doc({ style: { lineOpacity: 0.4 } }))).toBe(false);
        expect(validate(doc({ style: { lineWidth: 3 } }))).toBe(false);
    });
    it("ANO-063 RÉSOLU — shape restreint à circle ; style.type REJECTED (ANO-071, archi B.3)", () => {
        // Le schéma déclarait `shape` en texte libre et annonçait « square », que le
        // moteur n'a jamais rendu : MapLibre ne dessine que des cercles pour un type
        // `circle`. Backlog B.20 — le rendu carré a été ABANDONNÉ (il exigeait un second
        // chemin symbol/SDF plus la ré-implémentation de taxonomy/badge/styleRules), et
        // la clé a été contrainte pour cesser de promettre une capacité inexistante.
        expect(validate(doc({ style: { shape: "circle" } }))).toBe(true);
        expect(validate(doc({ style: { shape: "square" } }))).toBe(false);
        expect(validate(doc({ style: { type: "anything" } }))).toBe(false);
    });
    it("scaleConfig.defaultZoom + legend.items now REJECTED (ANO-073/074 résolus — archi B.3)", () => {
        expect(validate(doc({ scaleConfig: { defaultZoom: 12 } }))).toBe(false);
        expect(validate(doc({ legend: { items: [{ color: "#000000", label: "x" }] } }))).toBe(
            false
        );
    });

    // ANO-063 close (backlog B.20) : ni rendu, ni clé retirée — clé CONTRAINTE à
    // `circle` et conservée comme point d'extension réservé. L'assertion vit
    // ci-dessus ; ce `it.todo` n'a plus d'objet.
});
