/**
 * Resolving "what a surface paints", and the removal of the `"all"` mode.
 *
 * ⚠️ Half this file tested `resolveFields()`, five cases of which asserted the
 * IMPLICIT FALLBACK: an absent surface, `null` or `"all"` rendered all the
 * feature's properties as plain text. The decision (02/08/2026) removes that
 * mode — a complete bypass of the attribute contract, reachable by saying nothing.
 *
 * The cases are thus not deleted: they are **flipped**. Each now asserts the
 * surface declares NOTHING, and names the reason. A guard locking a defect in
 * must be re-pointed at the decision, not cancelled.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    getLayerBinding,
    hasFields,
    resolveSurfaceFields,
} from "../../../src/capabilities/feature-info/convert.js";

const BINDING = {
    titleField: "label",
    tooltip: [{ field: "name", label: "Nom" }],
    popup: [
        { field: "name", label: "Nom" },
        { field: "area", type: "number" },
    ],
    sidepanel: "all",
};

/** Mounts the `GeoLeaf.GeoJSON` seam on a given layer config. */
function stubLayer(config) {
    globalThis.GeoLeaf = {
        GeoJSON: { getLayerConfig: (id) => (id === "test-layer" ? config : null) },
    };
}

afterEach(() => {
    delete globalThis.GeoLeaf;
});

describe("getLayerBinding()", () => {
    beforeEach(() => stubLayer({ capabilities: { "feature-info": BINDING } }));

    it("returns binding when config key exists", () => {
        expect(getLayerBinding("test-layer")).toEqual(BINDING);
    });
    it("returns null for unknown layer", () => {
        expect(getLayerBinding("unknown-layer")).toBeNull();
    });
    it("returns null when GeoLeaf is absent", () => {
        delete globalThis.GeoLeaf;
        expect(getLayerBinding("test-layer")).toBeNull();
    });
});

describe("resolveSurfaceFields() — bloc legacy", () => {
    it("rend la liste déclarée d'une surface", () => {
        stubLayer({ capabilities: { "feature-info": BINDING } });
        const fields = resolveSurfaceFields("test-layer", "tooltip");
        expect(hasFields(fields)).toBe(true);
        expect(fields).toHaveLength(1);
        expect(fields[0].field).toBe("name");
    });

    it("écarte les champs marqués hidden d'une liste explicite", () => {
        stubLayer({
            capabilities: {
                "feature-info": {
                    popup: [
                        { field: "name", label: "Nom" },
                        { field: "area", type: "number", hidden: true },
                    ],
                },
            },
        });
        const fields = resolveSurfaceFields("test-layer", "popup");
        expect(fields).toHaveLength(1);
        expect(fields[0].field).toBe("name");
    });

    it("rend une liste VIDE pour une liste explicitement vide — déclarée, mais sans champ", () => {
        stubLayer({ capabilities: { "feature-info": { popup: [] } } });
        const resolved = resolveSurfaceFields("test-layer", "popup");
        expect(hasFields(resolved)).toBe(true);
        expect(resolved).toEqual([]);
    });

    it("rend surface-off pour une surface à false", () => {
        stubLayer({ capabilities: { "feature-info": { tooltip: false } } });
        expect(resolveSurfaceFields("test-layer", "tooltip")).toBe("surface-off");
    });
});

describe("resolveSurfaceFields() — le mode all est RETIRÉ (U2)", () => {
    // ⚠️ These four cases rendered ALL the feature's properties before
    // 02/08/2026. The mode did not even tell `"all"` from an omitted surface:
    // both went through the same branch, so a layer that stayed silent
    // exposed its technical ids and working columns without asking.
    it.each([
        ["all explicite sur le panneau", { sidepanel: "all" }, "sidepanel"],
        ["all explicite sur l'infobulle", { tooltip: "all" }, "tooltip"],
        ["all explicite sur la bulle", { popup: "all" }, "popup"],
        ["surface OMISE — le repli implicite", {}, "popup"],
    ])("%s ne déclare plus rien", (_nom, binding, surface) => {
        stubLayer({ capabilities: { "feature-info": binding } });
        const resolved = resolveSurfaceFields("test-layer", surface);
        expect(hasFields(resolved)).toBe(false);
        expect(resolved).toBe("surface-off");
    });
});

describe("resolveSurfaceFields() — les quatre absences sont DISTINCTES", () => {
    // ⚠️ They were a single mute `null`: an unknown layer and a layer
    // deliberately renouncing a surface produced the same silence, so neither
    // was diagnosable.
    it("no-seam quand le seam GeoJSON n'est pas monté", () => {
        expect(resolveSurfaceFields("test-layer", "popup")).toBe("no-seam");
    });

    it("unknown-layer quand le seam est monté mais ignore l'identifiant", () => {
        stubLayer({ capabilities: { "feature-info": BINDING } });
        expect(resolveSurfaceFields("autre-couche", "popup")).toBe("unknown-layer");
    });

    it("no-declaration quand la couche existe sans aucune déclaration de lecture", () => {
        stubLayer({ id: "test-layer" });
        expect(resolveSurfaceFields("test-layer", "popup")).toBe("no-declaration");
    });

    it("surface-off quand la couche déclare une lecture et éteint cette surface", () => {
        stubLayer({ capabilities: { "feature-info": { popup: false } } });
        expect(resolveSurfaceFields("test-layer", "popup")).toBe("surface-off");
    });
});

describe("resolveSurfaceFields() — le bloc attributes prime sur le legacy", () => {
    const ATTRIBUTES = {
        titleField: "properties.nom",
        fields: [
            {
                field: "properties.nom",
                label: "Nom",
                primitive: "string",
                widget: "text",
                display: { surfaces: ["tooltip", "popup", "sidepanel"] },
            },
            {
                field: "properties.desc",
                label: "Description",
                primitive: "string",
                widget: "longtext",
                display: {
                    surfaces: ["sidepanel"],
                    presentation: { accordion: true, defaultOpen: true },
                },
            },
            {
                field: "properties.saisie",
                label: "Saisie seule",
                primitive: "string",
                widget: "text",
                edit: { required: true },
            },
        ],
    };

    it("une surface ne reçoit que les champs qui la déclarent", () => {
        stubLayer({ attributes: ATTRIBUTES });
        expect(resolveSurfaceFields("test-layer", "tooltip").map((f) => f.field)).toEqual([
            "properties.nom",
        ]);
        expect(resolveSurfaceFields("test-layer", "sidepanel").map((f) => f.field)).toEqual([
            "properties.nom",
            "properties.desc",
        ]);
    });

    it("un champ sans projection de lecture n'apparaît sur AUCUNE surface", () => {
        stubLayer({ attributes: ATTRIBUTES });
        for (const surface of ["tooltip", "popup", "sidepanel"]) {
            const fields = resolveSurfaceFields("test-layer", surface);
            expect(fields.map((f) => f.field)).not.toContain("properties.saisie");
        }
    });

    it("le widget devient le type, et la présentation sa forme héritée", () => {
        stubLayer({ attributes: ATTRIBUTES });
        const [, desc] = resolveSurfaceFields("test-layer", "sidepanel");
        expect(desc.type).toBe("longtext");
        expect(desc.accordion).toBe(true);
        expect(desc.defaultOpen).toBe(true);
    });

    it("titleField MARQUE le champ qu'il nomme — il n'est plus une clé morte", () => {
        stubLayer({ attributes: ATTRIBUTES });
        const [nom] = resolveSurfaceFields("test-layer", "popup");
        expect(nom.style).toBe("title");
    });

    it("les options sont aplaties sur le descripteur de rendu", () => {
        stubLayer({
            attributes: {
                fields: [
                    {
                        field: "properties.aire",
                        label: "Aire",
                        primitive: "number",
                        widget: "metric",
                        options: { suffix: " km²" },
                        display: { surfaces: ["popup"] },
                    },
                ],
            },
        });
        const [aire] = resolveSurfaceFields("test-layer", "popup");
        expect(aire.suffix).toBe(" km²");
    });

    it("le bloc attributes l'emporte quand les DEUX sont posés", () => {
        stubLayer({
            attributes: ATTRIBUTES,
            capabilities: { "feature-info": BINDING },
        });
        expect(resolveSurfaceFields("test-layer", "tooltip").map((f) => f.field)).toEqual([
            "properties.nom",
        ]);
    });
});

describe("attributes-binding — les modificateurs de présentation et le mode", () => {
    it("emphasis, hero et mode arrivent au modèle de rendu", () => {
        stubLayer({
            attributes: {
                fields: [
                    {
                        field: "properties.photo",
                        label: "Photo",
                        primitive: "string",
                        widget: "image",
                        display: {
                            mode: "raw",
                            surfaces: ["sidepanel"],
                            presentation: { emphasis: "category", hero: true },
                        },
                    },
                ],
            },
        });
        const [f] = resolveSurfaceFields("test-layer", "sidepanel");
        expect(f.style).toBe("category");
        expect(f.variant).toBe("hero");
        expect(f.mode).toBe("raw");
    });

    it("un bloc attributes malformé est ignoré, il ne fait pas planter la résolution", () => {
        stubLayer({ attributes: { fields: "pas un tableau" } });
        expect(resolveSurfaceFields("test-layer", "popup")).toBe("no-declaration");
    });
});
