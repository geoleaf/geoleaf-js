/**
 * The labels' side of the field diagnostic — the one name a layer's label reads, strictly
 * as the renderer's `["get", field]` reads it.
 */
import { describe, expect, it } from "vitest";
import { labelDeclaredFields } from "../../../src/capabilities/labels/declared-fields.js";

const feature = (properties: Record<string, unknown>) => ({ type: "Feature", properties });

describe("labelDeclaredFields", () => {
    it("reads the style's label first, keyed by the style", () => {
        const [label] = labelDeclaredFields({
            layerId: "l",
            def: { labels: { enabled: true, field: "ignored" } },
            style: { id: "defaut", label: { enabled: true, field: "id" } },
        });
        expect([label?.key, label?.field]).toEqual(["style[defaut].label.field", "id"]);
        expect(label?.present(feature({ id: null }))).toBe(true);
    });

    it("falls back to the definition's labels block when the style has no label object", () => {
        const [label] = labelDeclaredFields({
            layerId: "l",
            def: { labels: { enabled: true, field: "nom" } },
            style: { id: "defaut", label: "Nom affiché" },
        });
        expect([label?.key, label?.field]).toEqual(["labels.field", "nom"]);
    });

    it("strips nothing — `properties.name` is looked up as a literal key, as the renderer does", () => {
        const [label] = labelDeclaredFields({
            layerId: "l",
            def: {},
            style: { id: "alt", label: { enabled: true, field: "properties.name" } },
        });
        expect(label?.present(feature({ name: "x" }))).toBe(false);
    });

    it("declares nothing for a disabled label, or a label that names no field", () => {
        const ctx = (label: unknown) => ({ layerId: "l", def: {}, style: { id: "s", label } });
        expect(labelDeclaredFields(ctx({ enabled: false, field: "id" }))).toEqual([]);
        expect(labelDeclaredFields(ctx({ enabled: true }))).toEqual([]);
        expect(labelDeclaredFields({ layerId: "l", def: {}, style: null })).toEqual([]);
    });
});
