/**
 * A `range` filter with BOTH bounds — the panel half of a filter the engine always had.
 *
 * The engine applies `min ≤ value ≤ max` (`engine/predicate.ts`); the panel offered one
 * slider, read `min` and restored `min`. An upper bound could only come from a host calling
 * `GeoLeaf.Filter.applyFilter()` — and the panel then showed a slider that did not say so.
 *
 * A descriptor declares it: `bounds: "both"`. One slider stays the default, and its DOM is
 * pinned byte for byte by `panel-dom-golden.test.js`.
 *
 * Cases marked 🛑 are TARGETS, seen red before the key was read; plain titles are guards
 * against over-reach — the single slider must not move.
 */
import { afterEach, describe, expect, it } from "vitest";

import { renderFilterPanel } from "../../../src/capabilities/filter/panel/render.js";
import { readActiveFilter } from "../../../src/capabilities/filter/panel/state.js";
import {
    resetPanelControls,
    writePanelControls,
} from "../../../src/capabilities/filter/panel/write.js";
import { serializeActiveFilter } from "../../../src/capabilities/filter/serialize.js";
import type { FilterConfig } from "../../../src/capabilities/filter/types.js";

const config = (bounds?: unknown): FilterConfig =>
    ({
        enabled: true,
        fields: [
            {
                id: "altitude",
                kind: "range",
                label: "Altitude",
                field: "properties.elevation",
                min: 0,
                max: 3000,
                step: 50,
                ...(bounds === undefined ? {} : { bounds }),
            },
        ],
    }) as FilterConfig;

const BOTH = config("both");

afterEach(() => {
    document.body.innerHTML = "";
});

function panel(cfg: FilterConfig = BOTH): HTMLElement {
    const p = renderFilterPanel(cfg, {});
    document.body.appendChild(p);
    return p;
}

/** The sliders of the field, by the bound each one sets. */
function sliders(p: HTMLElement): { min: HTMLInputElement | null; max: HTMLInputElement | null } {
    const of = (bound: string) =>
        p.querySelector<HTMLInputElement>(
            `[data-gl-filter-id="altitude"] input[type="range"][data-gl-range-bound="${bound}"]`
        );
    return { min: of("min"), max: of("max") };
}

/** Sets a slider the way a user does: the value, then the `input` event. */
function drag(input: HTMLInputElement | null, value: number): void {
    if (!input) throw new Error("le curseur attendu n'est pas dans le panneau");
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** What the panel says is active for the field — its `range`, or `null`. */
function active(p: HTMLElement, cfg: FilterConfig = BOTH): unknown {
    return readActiveFilter(p, cfg).find((a) => a.descriptor.id === "altitude")?.range ?? null;
}

/** The value written beside each slider. */
function shown(p: HTMLElement): string[] {
    return [
        ...p.querySelectorAll('[data-gl-filter-id="altitude"] .gl-filter-panel__range-value'),
    ].map((el) => el.textContent ?? "");
}

describe("a range filter that declares both bounds", () => {
    it("🛑 renders two sliders — the lower at the domain's minimum, the upper at its maximum", () => {
        const { min, max } = sliders(panel());
        expect(min?.value).toBe("0");
        expect(max?.value).toBe("3000");
        for (const input of [min, max]) {
            expect(input?.min).toBe("0");
            expect(input?.max).toBe("3000");
            expect(input?.step).toBe("50");
            // Two sliders in one group: each must say which bound it sets.
            expect(input?.getAttribute("aria-label")).toBeTruthy();
        }
        expect(min?.getAttribute("aria-label")).not.toBe(max?.getAttribute("aria-label"));
    });

    it("untouched, it constrains nothing", () => {
        expect(active(panel())).toBeNull();
    });

    it("🛑 reads the upper bound alone, the lower alone, and both", () => {
        const p = panel();
        drag(sliders(p).max, 1500);
        expect(active(p)).toEqual({ max: 1500 });

        drag(sliders(p).min, 500);
        expect(active(p)).toEqual({ min: 500, max: 1500 });

        drag(sliders(p).max, 3000);
        expect(active(p)).toEqual({ min: 500 });
    });

    it("🛑 shows each slider's value, and follows it", () => {
        const p = panel();
        expect(shown(p)).toEqual(["0", "3000"]);
        drag(sliders(p).min, 500);
        drag(sliders(p).max, 1500);
        expect(shown(p)).toEqual(["500", "1500"]);
    });

    it("🛑 never lets the bounds cross: the slider being dragged pushes the other", () => {
        const p = panel();
        drag(sliders(p).max, 1000);
        drag(sliders(p).min, 2000);
        expect(active(p)).toEqual({ min: 2000, max: 2000 });
        expect(shown(p)).toEqual(["2000", "2000"]);

        drag(sliders(p).max, 800);
        expect(active(p)).toEqual({ min: 800, max: 800 });
    });

    it("🛑 restores both bounds from a serialised state, and one bound leaves the other open", () => {
        const p = panel();
        writePanelControls(
            p,
            { fields: [{ id: "altitude", kind: "range", range: { min: 500, max: 1500 } }] },
            BOTH
        );
        expect(active(p)).toEqual({ min: 500, max: 1500 });
        expect(shown(p)).toEqual(["500", "1500"]);

        writePanelControls(
            p,
            { fields: [{ id: "altitude", kind: "range", range: { max: 1500 } }] },
            BOTH
        );
        expect(active(p)).toEqual({ max: 1500 });
        expect(shown(p)).toEqual(["0", "1500"]);
    });

    it("🛑 a reset opens BOTH bounds — the upper one goes back to the maximum, not the minimum", () => {
        const p = panel();
        drag(sliders(p).min, 500);
        drag(sliders(p).max, 1500);

        resetPanelControls(p);

        expect(sliders(p).min?.value).toBe("0");
        expect(sliders(p).max?.value).toBe("3000");
        expect(active(p)).toBeNull();
        expect(shown(p)).toEqual(["0", "3000"]);
    });

    it("round-trips: read → serialise → write → read gives the same bounds", () => {
        const a = panel();
        drag(sliders(a).min, 500);
        drag(sliders(a).max, 1500);
        const captured = serializeActiveFilter(readActiveFilter(a, BOTH));

        document.body.innerHTML = "";
        const b = panel();
        writePanelControls(b, captured, BOTH);

        expect(active(b)).toEqual({ min: 500, max: 1500 });
    });
});

describe("a range filter that declares nothing keeps its single slider", () => {
    for (const bounds of [undefined, "min", "max", true, "BOTH"]) {
        it(`bounds: ${JSON.stringify(bounds)} — one slider, the lower bound`, () => {
            const cfg = config(bounds);
            const p = panel(cfg);
            const inputs = p.querySelectorAll<HTMLInputElement>(
                '[data-gl-filter-id="altitude"] input[type="range"]'
            );
            expect(inputs).toHaveLength(1);
            const only = inputs[0] ?? null;
            drag(only, 500);
            expect(active(p, cfg)).toEqual({ min: 500 });
        });
    }

    it("🛑 a reset puts the value shown beside the slider back too", () => {
        const cfg = config();
        const p = panel(cfg);
        drag(p.querySelector<HTMLInputElement>('input[type="range"]'), 500);
        expect(shown(p)).toEqual(["500"]);

        resetPanelControls(p);

        expect(shown(p)).toEqual(["0"]);
    });

    it("an upper bound applied by a host is not lost by a slider that cannot show it", () => {
        // `GeoLeaf.Filter.applyFilter()` may carry `max` whatever the panel offers: the single
        // slider restores `min`, and reads back what it holds — the documented limit of the
        // default control.
        const cfg = config();
        const p = panel(cfg);
        writePanelControls(
            p,
            { fields: [{ id: "altitude", kind: "range", range: { min: 500, max: 1500 } }] },
            cfg
        );
        expect(active(p, cfg)).toEqual({ min: 500 });
    });
});
