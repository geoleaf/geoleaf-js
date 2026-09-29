/**
 * Witness — a capability whose teardown throws still starts again.
 *
 * ## What this file pins
 *
 * Every `capabilities/<id>/lifecycle.ts` guards its `init()` with a module-level `_started`, and
 * put `_started = false` LAST in its `_reset()`. A teardown that throws before that line — the
 * scale bar's `map.off` on a map destroyed first, measured — left `_started === true`: the
 * registry logged the error, and the next `init()` — an application mounted again — returned at
 * once. The capability never came back, in silence.
 *
 * Each `_reset()` now resets its state in a `finally`. Seen RED on the scale bar with the
 * `finally` removed: the second `init()` never subscribed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScaleLifecycle } from "../../src/capabilities/scale/lifecycle.js";
import { ScaleControl } from "../../src/capabilities/scale/scale-control.js";
import { CoordinatesLifecycle } from "../../src/capabilities/coordinates/lifecycle.js";
import { CoordinatesDisplay } from "../../src/capabilities/coordinates/coordinates.js";
import { LegendLifecycle } from "../../src/capabilities/legend/lifecycle.js";
import { Legend } from "../../src/capabilities/legend/legend.js";
import { ThemeSelectorLifecycle } from "../../src/capabilities/theme-selector/lifecycle.js";
import { ThemeSelector } from "../../src/capabilities/theme-selector/theme-selector.js";
import { resetAppReady } from "../../src/kernel/shared/app-ready.js";

const map = {} as never;

/** A capability, how to start it, and the teardown call its `_reset()` makes. */
const CASES = [
    {
        id: "scale",
        init: () => ScaleLifecycle.init(map),
        reset: () => ScaleLifecycle._reset(),
        teardown: () => vi.spyOn(ScaleControl, "destroy"),
    },
    {
        id: "coordinates",
        init: () => CoordinatesLifecycle.init(map),
        reset: () => CoordinatesLifecycle._reset(),
        teardown: () => vi.spyOn(CoordinatesDisplay, "destroy"),
    },
    {
        id: "legend",
        init: () => LegendLifecycle.init(),
        reset: () => LegendLifecycle._reset(),
        teardown: () => vi.spyOn(Legend, "_reset"),
    },
    {
        id: "theme-selector",
        init: () => ThemeSelectorLifecycle.init(),
        reset: () => ThemeSelectorLifecycle._reset(),
        teardown: () => vi.spyOn(ThemeSelector, "destroy"),
    },
];

afterEach(() => {
    vi.restoreAllMocks();
    for (const c of CASES) {
        try {
            c.reset();
        } catch {
            // A case below made the teardown throw on purpose.
        }
    }
    resetAppReady();
});

describe("a capability whose teardown throws starts again", () => {
    it.each(CASES)("🛑 $id", (c) => {
        resetAppReady();
        c.init();
        c.teardown().mockImplementationOnce(() => {
            throw new Error("map is not ready");
        });
        expect(() => c.reset()).toThrow("map is not ready");

        // Started again, it subscribes again: the proof is a listener on `geoleaf:app:ready`.
        const add = vi.spyOn(document, "addEventListener");
        c.init();
        expect(add.mock.calls.some(([type]) => type === "geoleaf:app:ready")).toBe(true);
    });
});
