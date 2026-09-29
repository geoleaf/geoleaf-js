/**
 * Feature-info's side of the field diagnostic — the attribute rows a layer SHOWS, judged by
 * the resolver that renders them.
 */
import { describe, expect, it } from "vitest";
import { attributeDeclaredFields } from "../../../src/capabilities/feature-info/declared-fields.js";

const shown = (field: string) => ({ field, label: field, display: { surfaces: ["popup"] } });
const feature = (properties: Record<string, unknown>) => ({ type: "Feature", properties });

describe("attributeDeclaredFields", () => {
    it("declares the displayed rows only — a capture-only field is absent from loaded data by nature", () => {
        const fields = attributeDeclaredFields({
            attributes: {
                fields: [
                    shown("properties.nom"),
                    { field: "properties.saisi", label: "Saisi", edit: { widget: "text" } },
                    { field: "properties.vide", label: "Vide", display: { surfaces: [] } },
                ],
            },
        });
        expect(fields.map((d) => [d.key, d.field])).toEqual([
            ["attributes.fields[0].field", "properties.nom"],
        ]);
    });

    it("resolves the three notations the renderer resolves", () => {
        const [prefixed, nested, bare] = attributeDeclaredFields({
            attributes: {
                fields: [shown("properties.name"), shown("attributes.photo"), shown("name")],
            },
        });
        const f = feature({ name: null, attributes: { photo: "p.jpg" } });
        expect(prefixed?.present(f)).toBe(true);
        expect(nested?.present(f)).toBe(true);
        expect(bare?.present(f)).toBe(true);
    });

    it("is case-sensitive — `properties.NAME` is not `name`", () => {
        const [upper] = attributeDeclaredFields({
            attributes: { fields: [shown("properties.NAME")] },
        });
        expect(upper?.present(feature({ name: "Rosario" }))).toBe(false);
    });

    it("declares nothing for a layer without an attributes block", () => {
        expect(attributeDeclaredFields({})).toEqual([]);
        expect(attributeDeclaredFields({ attributes: { titleField: "x" } })).toEqual([]);
    });
});
