/**
 * Guard — the offline list carries the STYLE of both layer families, not just one.
 *
 * ## Why two cases and not one
 *
 * Layers reach the enumerator by two distinct paths: `_addConfigFileResources` for those
 * carrying a `configFile`, `_addInlineConfigResource` for the `layerTemplates` instances,
 * which have none. Adding styles to one branch only leaves the other family with no style
 * offline — the map renders, unstyled, with nothing in the console. That exact defect already
 * happened once on this file for the DATA path, and is documented in it; reproducing it for
 * styles would be the same mistake with a different noun.
 *
 * The two cases below call each branch's helper directly: it is the only way to prove that
 * both were wired, rather than that one of them happened to be exercised.
 */
import { describe, expect, it } from "vitest";

const { ResourceEnumerator } =
    await import("../../../src/capabilities/offline/cache/resource-enumerator.js");

type Res = { url: string; type: string; priority?: number; layerId?: string };

const STYLES = {
    directory: "styles",
    default: "defaut.json",
    available: [
        { id: "defaut", file: "defaut.json" },
        { id: "sombre", file: "sombre.json" },
    ],
};

describe("offline enumeration — style files", () => {
    it("① a layer carrying a configFile gets its styles", () => {
        const resources: Res[] = [];
        (ResourceEnumerator as never as Record<string, CallableFunction>)._addStyleResources.call(
            ResourceEnumerator,
            resources,
            STYLES,
            "../profiles/tourism/layers/hebergements",
            "hebergements",
            { layerId: "hebergements" }
        );

        expect(resources.map((r) => r.url)).toEqual([
            "../profiles/tourism/layers/hebergements/styles/defaut.json",
            "../profiles/tourism/layers/hebergements/styles/sombre.json",
        ]);
        expect(resources.every((r) => r.layerId === "hebergements")).toBe(true);
    });

    it("② a layerTemplates instance gets its styles too — same helper, other branch", () => {
        const resources: Res[] = [];
        (ResourceEnumerator as never as Record<string, CallableFunction>)._addStyleResources.call(
            ResourceEnumerator,
            resources,
            { directory: "styles", default: "defaut.json" },
            "../profiles/tourism/layers/pluviometrie_janvier",
            "pluviometrie_janvier",
            { layerId: "pluviometrie_janvier" }
        );

        expect(resources).toHaveLength(1);
        expect(resources[0].url).toBe(
            "../profiles/tourism/layers/pluviometrie_janvier/styles/defaut.json"
        );
    });

    it("a layer without a styles block adds nothing — and does not throw", () => {
        const resources: Res[] = [];
        for (const styles of [undefined, null, {}, { available: [] }]) {
            (
                ResourceEnumerator as never as Record<string, CallableFunction>
            )._addStyleResources.call(ResourceEnumerator, resources, styles, "x", "l", {});
        }
        expect(resources).toHaveLength(0);
    });

    it("orders the files, so two enumerations of one profile agree", () => {
        const resources: Res[] = [];
        (ResourceEnumerator as never as Record<string, CallableFunction>)._addStyleResources.call(
            ResourceEnumerator,
            resources,
            { available: [{ file: "z.json" }, { file: "a.json" }], default: "m.json" },
            "base",
            "l",
            {}
        );
        expect(resources.map((r) => r.url)).toEqual([
            "base/styles/a.json",
            "base/styles/m.json",
            "base/styles/z.json",
        ]);
    });
});
