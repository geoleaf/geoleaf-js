/**
 * @tests kernel/ui/mobile/mobile-toolbar-proximity + mobile-toolbar — proximity radius chain
 *
 * The proximity bar is the ONLY proximity UI the core renders: `panel/render.ts` skips
 * `kind: "proximity"` outright ("driven by the toolbar button, not rendered in the panel").
 * So whatever this slider loses, the whole feature loses.
 *
 * The bug these cases pin: the bar read its slider with `Number.parseInt`, so a profile
 * declaring fractional radius bounds got every sub-kilometre notch collapsed onto a
 * zero-radius circle, while the label next to it kept displaying the value the user had
 * actually asked for. Label and applied radius are now read from one number — the case
 * "keeps the label and the applied radius the same number" is the invariant that was violated.
 *
 * ⚠️ Nothing typechecks `__tests__/` — every tsconfig of this package excludes it. The
 * annotations below are therefore load-bearing by convention only; they are what makes a
 * wrong double fail to compile when someone does point a compiler at this directory.
 */
import type { Mock } from "vitest";

const { mockConfigGet, mockGetActiveProfile } = vi.hoisted(() => ({
    mockConfigGet: vi.fn((_key: string, def?: unknown): unknown => def),
    mockGetActiveProfile: vi.fn<() => ProfileDouble | null>(() => null),
}));

vi.mock("../../src/kernel/config/geoleaf-config/config-core.js", () => ({
    Config: { get: mockConfigGet, getActiveProfile: mockGetActiveProfile },
}));

import {
    createProximityBarDom,
    openProximityBar,
    proximityDefaultRadiusKm,
} from "../../src/kernel/ui/mobile/mobile-toolbar-proximity.js";
import { initMobileToolbar } from "../../src/kernel/ui/mobile/mobile-toolbar.js";
import { domState } from "../../src/kernel/ui/mobile/mobile-toolbar-state.js";
import { getLabel } from "../../src/utils/i18n/i18n.js";

// ── Doubles, typed on the contracts the subject actually reads ────────────────

/** One `modules.filter.fields[]` descriptor, as `_readProximityRadius()` reads it. */
interface ProfileFieldDouble {
    kind: string;
    id?: string;
    radiusMin?: number;
    radiusMax?: number;
    radiusStep?: number;
    radiusDefault?: number;
}

/** The slice of the active profile the proximity bar reads. */
interface ProfileDouble {
    modules: { filter: { fields: ProfileFieldDouble[] } };
}

/**
 * The slice of `GeoLeaf.Filter` the proximity chain calls, with spy types.
 *
 * Deliberately narrower than `GeoLeafGlobal["Filter"]`, which declares seven members: the
 * subject reaches the namespace through its own optional view (`FilterLike`), so a double
 * carrying the other five would assert a coupling that does not exist.
 */
interface FilterDouble {
    applyNow: Mock<() => void>;
    proximity: {
        setRadius: Mock<(radiusKm: number) => void>;
        toggle: Mock<
            (map: unknown, radiusKm?: number, options?: { onPointPlaced?: () => void }) => boolean
        >;
    };
}

/** Local view of the namespace — this suite writes `Filter` and reads nothing else. */
const globalView = globalThis as unknown as { GeoLeaf?: { Filter: FilterDouble } };

/** Radius bounds of a profile that needs 100 m granularity: 0,1 km → 10 km by 0,1. */
const FRACTIONAL_FIELD: ProfileFieldDouble = {
    kind: "proximity",
    radiusMin: 0.1,
    radiusMax: 10,
    radiusStep: 0.1,
    radiusDefault: 0.5,
};

/** A profile field of another kind, to exercise the in-core fallback. */
const OTHER_FIELD: ProfileFieldDouble = { kind: "tag", id: "theme" };

// ── Shared fixture ────────────────────────────────────────────────────────────

/** Points `Config.getActiveProfile()` at a `modules.filter.fields` list. */
function useProfileFields(fields: ProfileFieldDouble[]): void {
    mockGetActiveProfile.mockReturnValue({ modules: { filter: { fields } } });
}

/** Mounts a fresh filter double on the namespace and hands it back for assertions. */
function installFilterDouble(): FilterDouble {
    const filter: FilterDouble = {
        applyNow: vi.fn(),
        proximity: { setRadius: vi.fn(), toggle: vi.fn(() => true) },
    };
    globalView.GeoLeaf = { Filter: filter };
    return filter;
}

/** Undoes {@link installFilterDouble} and returns the profile mock to its empty state. */
function resetNamespaceAndProfile(): void {
    delete globalView.GeoLeaf;
    mockGetActiveProfile.mockReset();
    mockGetActiveProfile.mockReturnValue(null);
}

/**
 * Builds the bar and returns the two nodes the radius chain writes to.
 *
 * Both are asserted present rather than returned nullable: `createProximityBarDom` wires
 * them unconditionally, so a null here is a broken subject, not a case to handle.
 */
function mountBar(): { slider: HTMLInputElement; label: HTMLElement } {
    document.body.appendChild(createProximityBarDom());
    const { proximitySlider: slider, proximityRadiusLabel: label } = domState;
    if (!slider || !label) throw new Error("proximity bar did not wire its slider and label");
    return { slider, label };
}

/** Moves the slider and fires the event the bar listens for. */
function slide(slider: HTMLInputElement, value: string): void {
    slider.value = value;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("mobile-toolbar-proximity — radius slider", () => {
    let setRadius: FilterDouble["proximity"]["setRadius"];

    beforeEach(() => {
        setRadius = installFilterDouble().proximity.setRadius;
        useProfileFields([FRACTIONAL_FIELD]);
    });

    afterEach(resetNamespaceAndProfile);

    // ── bounds ───────────────────────────────────────────────────────────────
    it("carries fractional profile bounds onto the range input", () => {
        const { slider } = mountBar();
        expect(slider.type).toBe("range");
        expect([slider.min, slider.max, slider.step, slider.defaultValue]).toEqual([
            "0.1",
            "10",
            "0.1",
            "0.5",
        ]);
    });

    // ── the notches that used to be dead ─────────────────────────────────────
    it.each<[string, number]>([
        ["0.1", 0.1],
        ["0.5", 0.5],
        ["1.4", 1.4],
    ])("applies %s km to the filter without truncating it", (value, expected) => {
        const { slider } = mountBar();
        slide(slider, value);
        expect(setRadius).toHaveBeenCalledWith(expected);
    });

    it("shows the fractional radius rather than rounding it away", () => {
        const { slider, label } = mountBar();
        slide(slider, "0.5");
        // parseInt made this "0 km" next to a circle of radius zero.
        expect(label.textContent).toBe("0.5 km");
    });

    // ── the invariant the bug violated ───────────────────────────────────────
    it("keeps the label and the applied radius the same number", () => {
        const { slider, label } = mountBar();
        for (const value of ["0.1", "0.3", "0.5", "1.4", "2.1", "9.9"]) {
            slide(slider, value);
            const applied = setRadius.mock.calls.at(-1)?.[0];
            expect(applied).toBeTypeOf("number");
            expect(label.textContent).toBe(getLabel("format.proximity.radius", String(applied)));
        }
    });

    it("renders the label through the dictionary, not an inline template", () => {
        const { slider, label } = mountBar();
        slide(slider, "2.5");
        expect(label.textContent).toBe(getLabel("format.proximity.radius", "2.5"));
    });

    it("coerces an out-of-range value the way the range input does", () => {
        // A range input never hands out a non-numeric value — it clamps to its own bounds.
        // That is why the listener needs no NaN guard, and this pins the reason.
        const { slider } = mountBar();
        slide(slider, "40");
        expect(setRadius).toHaveBeenCalledWith(10);
    });

    // ── reopening the bar ────────────────────────────────────────────────────
    it("reopens on the fractional default, slider and label agreeing", () => {
        const { slider, label } = mountBar();
        slide(slider, "9.9");
        openProximityBar();
        expect(slider.value).toBe(slider.defaultValue);
        expect(label.textContent).toBe("0.5 km");
    });

    it("reads the bar default back as a number", () => {
        mountBar();
        expect(proximityDefaultRadiusKm()).toBe(0.5);
    });

    // ── non-regression: the in-core defaults still stand ─────────────────────
    it("falls back to the in-core bounds when the profile declares no proximity field", () => {
        useProfileFields([OTHER_FIELD]);
        const { slider, label } = mountBar();
        expect([slider.min, slider.max, slider.step, slider.defaultValue]).toEqual([
            "1",
            "50",
            "1",
            "10",
        ]);
        expect(label.textContent).toBe("10 km");
        expect(proximityDefaultRadiusKm()).toBe(10);
    });

    it("falls back to the in-core default when no bar has been built", () => {
        domState.proximitySlider = null;
        expect(proximityDefaultRadiusKm()).toBe(10);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The toolbar button, which hands the default radius to the filter on first arming.
// This is the half of the chain that decides the radius of the very FIRST circle:
// it used to parseInt the slider default, so a 0,5 km profile armed proximity at 0 km
// and the first map click painted nothing at all.
// ─────────────────────────────────────────────────────────────────────────────
describe("mobile-toolbar — arming proximity from the toolbar button", () => {
    let toggle: FilterDouble["proximity"]["toggle"];

    /** Boots a real toolbar and returns the proximity button wired into it. */
    function mountToolbarWithProximityButton(): HTMLButtonElement {
        const glMain = document.createElement("div");
        glMain.className = "gl-main";
        document.body.appendChild(glMain);
        initMobileToolbar({
            glMain,
            map: {
                zoomIn: vi.fn(),
                zoomOut: vi.fn(),
                getContainer: () => glMain,
                getZoom: () => 12,
            },
        });
        const btn = document.createElement("button");
        btn.setAttribute("data-gl-sheet", "proximity");
        if (!domState.toolbar) throw new Error("mobile toolbar was not mounted");
        domState.toolbar.appendChild(btn);
        return btn;
    }

    /** The radius the button handed to `toggle` on its Nth call. */
    function armedRadius(call = 0): number | undefined {
        return toggle.mock.calls[call]?.[1];
    }

    beforeEach(() => {
        toggle = installFilterDouble().proximity.toggle;
        useProfileFields([FRACTIONAL_FIELD]);
    });

    afterEach(() => {
        if (domState.filterCheckInterval != null) {
            clearInterval(domState.filterCheckInterval);
            domState.filterCheckInterval = null;
        }
        resetNamespaceAndProfile();
    });

    it("arms proximity at the fractional profile default, not a truncated one", () => {
        const btn = mountToolbarWithProximityButton();

        btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(toggle).toHaveBeenCalledTimes(1);
        // parseInt turned this into 0 — the first click then drew a circle of radius zero.
        expect(armedRadius()).toBe(0.5);
    });

    it("arms at the in-core default when the profile declares no proximity field", () => {
        useProfileFields([OTHER_FIELD]);
        const btn = mountToolbarWithProximityButton();

        btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(armedRadius()).toBe(10);
    });
});
