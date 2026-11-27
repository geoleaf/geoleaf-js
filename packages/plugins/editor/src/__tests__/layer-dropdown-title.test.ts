/*!
 * Tests — `modal/layer-dropdown.ts`, the chosen layer's full name on hover.
 *
 * The menu sits beside the form's title and is bounded in width: a long layer name is cut by
 * the select's own box. Its `title` carries the chosen layer's full label — set at creation,
 * on a pick, and when the value is set from code (which fires no `change`); none while the
 * prompt shows.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../config.js", async (importActual) => ({
    ...(await importActual()),
    getEditableLayers: vi.fn(() => [
        { id: "short", label: "Routes" },
        { id: "long", label: "Sites touristiques – Rosario" },
    ]),
}));

import { createLayerDropdown } from "../modal/layer-dropdown.js";
import { EDITOR_CONFIG_DEFAULTS } from "../config.js";
import type { EditorConfig } from "../types.js";

const CFG = { ...EDITOR_CONFIG_DEFAULTS } as EditorConfig;

function selectOf(el: HTMLElement): HTMLSelectElement {
    const select = el.querySelector("select");
    if (!select) throw new Error("no select in the dropdown");
    return select;
}

describe("createLayerDropdown — the select's title", () => {
    it("names the pre-selected layer in full", () => {
        const dd = createLayerDropdown({ ...CFG, defaultLayer: "long" });
        expect(selectOf(dd.el).title).toBe("Sites touristiques – Rosario");
    });

    it("follows the user's pick", () => {
        const dd = createLayerDropdown(CFG);
        const select = selectOf(dd.el);
        select.value = "long";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        expect(select.title).toBe("Sites touristiques – Rosario");
        select.value = "short";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        expect(select.title).toBe("Routes");
    });

    it("follows setValue(), which fires no change", () => {
        const dd = createLayerDropdown(CFG);
        dd.setValue("long");
        expect(selectOf(dd.el).title).toBe("Sites touristiques – Rosario");
    });

    it("names no layer while the prompt shows", () => {
        const dd = createLayerDropdown(CFG);
        const select = selectOf(dd.el);
        expect(select.value).toBe("");
        expect(select.title).toBe("");
    });
});
