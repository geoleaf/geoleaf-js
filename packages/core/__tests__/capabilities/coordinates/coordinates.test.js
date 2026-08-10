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

    // ─── N-3 : le mousemove est coalescé sur une frame ────────────────────────
    // MapLibre émet `mousemove` au rythme du pointeur, mais l'affichage ne peut changer
    // qu'une fois par frame peinte : les écritures intermédiaires sont invisibles par
    // construction. On garde la DERNIÈRE position de la frame — un throttle leading-edge
    // aurait figé l'affichage sur une position périmée.

    /** Le rAF est asynchrone : laisser la frame se peindre avant d'asserter. */
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
            // Une seule frame en attente, quel que soit le nombre d'événements.
            expect(CoordinatesDisplay._frameHandle).not.toBeNull();
            await nextFrame();

            // La dernière position gagne — pas la première (piège du leading-edge).
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
            CoordinatesDisplay.destroy(); // avant que la frame ne se peigne
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

    // ─── Fuites de teardown corrigées en S5/N-3 ───────────────────────────────

    it("destroy annule le timeout d'attente — sinon il ressuscite le contrôle", () => {
        // Le timeout de 5s testait `!this._coordsElement` pour décider de créer le contrôle
        // standalone. Or `destroy()` met justement ce champ à null : le timeout se
        // déclenchait APRÈS destruction, voyait null, et recréait un contrôle sur une
        // instance morte — en appelant `map.on("mousemove", null)` au passage.
        vi.useFakeTimers();
        const map = { on: vi.fn(), off: vi.fn(), addControl: vi.fn(() => ({ remove: vi.fn() })) };
        CoordinatesDisplay.init(map); // pas de wrapper → arme le timeout
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
});
