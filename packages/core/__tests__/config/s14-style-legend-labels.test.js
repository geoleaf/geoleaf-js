/**
 * Config-contract Phase C / C5 — B6 styles/{style}.json legend.* + label.* .
 *
 * `legend.label` / `styleRules[].legend.{label,order,description}` are read LIVE by the
 * LegendGenerator (capabilities/legend/legend-generator): generateLegendFromStyle builds the
 * legend data from the active style, generateLegendItem maps each rule's legend meta to an
 * item. `legend.description` is read here (ANO-072) although the hardened styleRule.legend
 * block rejects it — the schema lock lives in s14-styles-anomalies-lock.test.js.
 *
 * Residual `label.font.{family,weight,bold,italic}` + `buffer.{noFill,opacity}` are NOT
 * mapped to the MapLibre symbol path (ANO-064/067); locked as it.todo. The former dead
 * Leaflet DOM path (ANO-075) and the removed keys background/legend.items (ANO-066/074)
 * were cleaned up in archi B.3/B.5 + résidu. ⚠️ `label.offset` (ANO-065) was in that
 * "removed" list until 05/09/2026 and no longer belongs there: it came BACK to the schema
 * and is now mapped (text-anchor + text-radial-offset).
 *
 * Consumer: packages/core/src/capabilities/legend/legend-generator.ts. Inventory B6.
 */

import { LegendGenerator } from "../../src/capabilities/legend/legend-generator.js";
import { REFERENCE_STYLE, clone } from "./_helpers/config-harness.js";

describe("config B6 — generateLegendItem reads legend.{label,order,description}", () => {
    it("label / order / description are carried into the item", () => {
        const item = LegendGenerator.generateLegendItem(
            { fillColor: "#0a9396" },
            { label: "Catégorie A", order: 2, description: "desc A" },
            "point",
            null,
            null,
            null,
            "tourism-poi-cat-"
        );
        expect(item).toMatchObject({ label: "Catégorie A", order: 2, description: "desc A" });
        expect(item.symbol).toBeTypeOf("object");
    });

    it("missing label → 'Sans label'; missing order → 999; no description key", () => {
        const item = LegendGenerator.generateLegendItem(
            { fillColor: "#111111" },
            {},
            "point",
            null,
            null,
            null,
            "p-"
        );
        expect(item.label).toBe("Sans label");
        expect(item.order).toBe(999);
        expect(item.description).toBeUndefined();
    });

    it("@anomaly ANO-072 — legend.description is consumed by the code (schema rejects it)", () => {
        const item = LegendGenerator.generateLegendItem(
            { fillColor: "#111111" },
            { label: "L", description: "lu malgré le schéma" },
            "point",
            null,
            null,
            null,
            "p-"
        );
        expect(item.description).toBe("lu malgré le schéma");
    });

    it("null style or null legend → null item (guard)", () => {
        expect(
            LegendGenerator.generateLegendItem(
                null,
                { label: "x" },
                "point",
                null,
                null,
                null,
                "p-"
            )
        ).toBeNull();
    });
});

describe("config B6 — generateLegendFromStyle (fixture defaut.json round-trip)", () => {
    const legend = LegendGenerator.generateLegendFromStyle(clone(REFERENCE_STYLE), "point", null);

    it("title ← style.label, description ← style.description", () => {
        expect(legend.title).toBe("Défaut");
        expect(legend.description).toBe("Style de référence (point) — S14 B6");
    });

    it("one section carrying an item per styleRule legend.label", () => {
        const labels = legend.sections.flatMap((s) => s.items.map((i) => i.label));
        expect(labels).toEqual(
            expect.arrayContaining(["Catégorie A", "Score ≥ 5", "Score 10–20", "X ou Y"])
        );
    });

    it("items are ordered by legend.order (Catégorie A = order 1 first)", () => {
        const items = legend.sections[0].items;
        expect(items[0].label).toBe("Catégorie A");
    });

    it("null styleData → null legend (guard)", () => {
        expect(LegendGenerator.generateLegendFromStyle(null, "point", null)).toBeNull();
    });
});

describe("config B6 — label.* non-mapped MapLibre (it.todo)", () => {
    // ANO-066 (label.background), ANO-074 (legend.items) RESOLVED (keys removed from
    // style.schema.json — archi B.3/B.5). ANO-075 RESOLVED (the dead Leaflet DOM label path
    // was removed from label-renderer.ts — archi résidu).
    // ⚠️ ANO-065 (label.offset) was resolved the OTHER way, and this comment said "keys
    // removed" until 05/09/2026: `offset.placement` / `offset.distancePx` are back in the
    // schema and ARE mapped now (text-anchor + text-radial-offset). Their coverage lives in
    // __tests__/capabilities/labels/label-renderer.test.js, not here. Remaining:
    // font.family/weight/bold/italic + buffer.noFill/opacity stay schema-accepted but
    // unmapped by the MapLibre symbol path (font.sizePt + buffer.color/sizePx ARE live).
    it.todo(
        "@anomaly ANO-064 — label.font.family/weight/bold/italic: not mapped (only font.sizePt is live)"
    );
    it.todo(
        "@anomaly ANO-067 — label.buffer.opacity/noFill: MapLibre text-halo has no such option"
    );
});
