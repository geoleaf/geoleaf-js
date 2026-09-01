/**
 * Coordinates capability — runtime control.
 * Relocated from __tests__/ui/coordinates-display.test.js (extraction roadmap contrôles carte).
 * The former internal `ui.showCoordinates` gate is removed (the capability gate +
 * CoordinatesLifecycle decide whether init runs), so the "returns early when config false"
 * test no longer applies.
 */

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { CoordinatesDisplay } from "../../../src/capabilities/coordinates/coordinates.js";

describe("capabilities/coordinates", () => {
    it("init does not throw when map null (logs error)", () => {
        expect(() => CoordinatesDisplay.init(null)).not.toThrow();
    });

    it("init attaches to .gl-scale-main-wrapper when present", () => {
        const scaleWrapper = document.createElement("div");
        scaleWrapper.className = "gl-scale-main-wrapper";
        document.body.appendChild(scaleWrapper);
        const map = { on: vi.fn(), off: vi.fn(), addControl: vi.fn() };
        CoordinatesDisplay.init(map);
        expect(CoordinatesDisplay._coordsElement).toBeTruthy();
        expect(scaleWrapper.querySelector(".gl-scale-coordinates")).toBeTruthy();
        document.body.removeChild(scaleWrapper);
    });

    // ─── mousemove is coalesced onto one frame ─────────────────────────────────
    // MapLibre emits `mousemove` at the pointer's pace, but the display can
    // only change once per painted frame: intermediate writes are invisible
    // by construction. We keep the frame's LAST position — a leading-edge
    // throttle would have frozen the display on a stale position.

    /** rAF is asynchronous: let the frame paint before asserting. */
    const nextFrame = () => new Promise((r) => setTimeout(r, 20));

    const withWrapper = (fn) => {
        const scaleWrapper = document.createElement("div");
        scaleWrapper.className = "gl-scale-main-wrapper";
        document.body.appendChild(scaleWrapper);
        return Promise.resolve(fn(scaleWrapper)).finally(() =>
            document.body.removeChild(scaleWrapper)
        );
    };

    it("_onMouseMove updates coords element when _coordsElement set", async () => {
        await withWrapper(async () => {
            const map = { on: vi.fn(), off: vi.fn(), addControl: vi.fn() };
            CoordinatesDisplay.init(map);
            CoordinatesDisplay._onMouseMove({ latlng: { lat: 48.5, lng: 2.3 } });
            await nextFrame();
            expect(CoordinatesDisplay._coordsElement.textContent).toContain("48.5");
            expect(CoordinatesDisplay._coordsElement.textContent).toContain("2.3");
        });
    });

    it("coalesce N mousemove en UNE écriture, sur la dernière position", async () => {
        await withWrapper(async () => {
            const map = { on: vi.fn(), off: vi.fn(), addControl: vi.fn() };
            CoordinatesDisplay.init(map);

            for (const lat of [10.1, 20.2, 30.3, 48.5]) {
                CoordinatesDisplay._onMouseMove({ latlng: { lat, lng: 2.3 } });
            }
            // A single pending frame, whatever the event count.
            expect(CoordinatesDisplay._frameHandle).not.toBeNull();
            await nextFrame();

            // The last position wins — not the first (the leading-edge trap).
            expect(CoordinatesDisplay._coordsElement.textContent).toContain("48.5");
            expect(CoordinatesDisplay._coordsElement.textContent).not.toContain("10.1");
            expect(CoordinatesDisplay._frameHandle).toBeNull();
        });
    });

    it("n'écrit pas dans un élément déjà retiré (frame annulée au destroy)", async () => {
        await withWrapper(async () => {
            const map = { on: vi.fn(), off: vi.fn(), addControl: vi.fn() };
            CoordinatesDisplay.init(map);
            const element = CoordinatesDisplay._coordsElement;

            CoordinatesDisplay._onMouseMove({ latlng: { lat: 48.5, lng: 2.3 } });
            CoordinatesDisplay.destroy(); // before the frame paints
            await nextFrame();

            expect(element.textContent).not.toContain("48.5");
            expect(CoordinatesDisplay._frameHandle).toBeNull();
        });
    });

    it("has destroy method", () => {
        expect(typeof CoordinatesDisplay.destroy).toBe("function");
    });

    it("destroy does not throw", () => {
        expect(() => CoordinatesDisplay.destroy()).not.toThrow();
    });

    it("destroy removes mousemove listener when set", () => {
        const scaleWrapper = document.createElement("div");
        scaleWrapper.className = "gl-scale-main-wrapper";
        document.body.appendChild(scaleWrapper);
        const off = vi.fn();
        const map = { on: vi.fn(), off, addControl: vi.fn() };
        CoordinatesDisplay.init(map);
        CoordinatesDisplay.destroy();
        expect(off).toHaveBeenCalledWith("mousemove", expect.any(Function));
        document.body.removeChild(scaleWrapper);
    });

    it("init uses standalone control when no scale wrapper (fake timer)", () => {
        vi.useFakeTimers();
        const mockHandle = { remove: vi.fn() };
        const map = {
            on: vi.fn(),
            off: vi.fn(),
            addControl: vi.fn(() => mockHandle),
        };
        CoordinatesDisplay.init(map);
        expect(CoordinatesDisplay._coordsElement).toBeFalsy();
        vi.advanceTimersByTime(5000);
        expect(CoordinatesDisplay._controlHandle).toBeTruthy();
        expect(CoordinatesDisplay._coordsElement).toBeTruthy();
        vi.useRealTimers();
    });

    // ─── Teardown leaks fixed ─────────────────────────────────────────────────

    it("destroy annule le timeout d'attente — sinon il ressuscite le contrôle", () => {
        // The 5s timeout tested `!this._coordsElement` to decide creating the
        // standalone control. Yet `destroy()` sets precisely that field to
        // null: the timeout fired AFTER destruction, saw null, and recreated
        // a control on a dead instance — calling `map.on("mousemove", null)` in passing.
        vi.useFakeTimers();
        const map = { on: vi.fn(), off: vi.fn(), addControl: vi.fn(() => ({ remove: vi.fn() })) };
        CoordinatesDisplay.init(map); // no wrapper → arms the timeout
        CoordinatesDisplay.destroy();
        map.addControl.mockClear();

        vi.advanceTimersByTime(5000);

        expect(map.addControl).not.toHaveBeenCalled();
        expect(CoordinatesDisplay._coordsElement).toBeFalsy();
        vi.useRealTimers();
    });

    it("destroy déconnecte le MutationObserver", () => {
        vi.useFakeTimers();
        const map = { on: vi.fn(), off: vi.fn(), addControl: vi.fn(() => ({ remove: vi.fn() })) };
        CoordinatesDisplay.init(map); // pas de wrapper → arme l'observateur
        expect(CoordinatesDisplay._wrapperObserver).toBeTruthy();

        CoordinatesDisplay.destroy();

        expect(CoordinatesDisplay._wrapperObserver).toBeNull();
        expect(CoordinatesDisplay._wrapperTimeout).toBeNull();
        vi.useRealTimers();
    });
    // ── The separator must be REMOVED at teardown ───────────────
    //
    // 🛑 The defect: `_attachToScaleWrapper` creates `gl-scale-separator`
    // through `domCreate` without keeping the reference, and `destroy()` only
    // removes `_coordsElement`. Each teardown → remount cycle thus left one
    // more orphan separator, visible on screen (it is a vertical bar), and
    // nothing counted them.
    //
    // ⚠️ This file's 11 tests passed with NO assertion on the separator: the
    // faulty behaviour was attested by nothing, which is the configuration in
    // which a defect survives every reread.
    it("ne laisse aucun séparateur orphelin après deux cycles init/destroy", async () => {
        await withWrapper(async (scaleWrapper) => {
            const map = { on: vi.fn(), off: vi.fn(), addControl: vi.fn() };

            CoordinatesDisplay.init(map);
            CoordinatesDisplay.destroy();
            CoordinatesDisplay.init(map);
            CoordinatesDisplay.destroy();

            expect(scaleWrapper.querySelectorAll(".gl-scale-separator").length).toBe(0);
            expect(scaleWrapper.querySelectorAll(".gl-scale-coordinates").length).toBe(0);
        });
    });

    // TWIN leak, same trigger, same `destroy()`: `init()` has NO re-entrance
    // guard — it does not test `_coordsElement` and does not call `destroy()`.
    // Two consecutive `init()`s thus stack two separators AND two coordinate
    // elements, the first becoming unreachable (`_coordsElement` is
    // overwritten), hence unremovable by `destroy()`.
    it("deux init() consécutifs n'empilent pas deux contrôles", async () => {
        await withWrapper(async (scaleWrapper) => {
            const map = { on: vi.fn(), off: vi.fn(), addControl: vi.fn() };

            CoordinatesDisplay.init(map);
            CoordinatesDisplay.init(map);

            expect(scaleWrapper.querySelectorAll(".gl-scale-separator").length).toBe(1);
            expect(scaleWrapper.querySelectorAll(".gl-scale-coordinates").length).toBe(1);

            CoordinatesDisplay.destroy();
            expect(scaleWrapper.querySelectorAll(".gl-scale-separator").length).toBe(0);
            expect(scaleWrapper.querySelectorAll(".gl-scale-coordinates").length).toBe(0);
        });
    });
});
