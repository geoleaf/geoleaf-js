/**
 * `@geoleaf-plugins/navigation` — the immersive seam and the driver's arrow.
 *
 * 🛑 What these two modules have in common, and why they share a suite: both talk to a host
 * they did not build, through surfaces that may be absent. The interesting cases are therefore
 * the ABSENCES — a core that predates the immersive mode, an adapter with no rotation seam, a
 * map that went away mid-session — because those are the paths a running vehicle actually takes
 * and the ones no manual test reaches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getGeoLeafMock, warnMock } = vi.hoisted(() => ({
    getGeoLeafMock: vi.fn(),
    warnMock: vi.fn(),
}));
vi.mock("@geoleaf/host-runtime", () => ({
    getGeoLeaf: () => getGeoLeafMock(),
    Log: {
        debug: () => {},
        info: () => {},
        warn: (...a: unknown[]) => warnMock(...a),
        error: () => {},
    },
}));

const { enterImmersive, exitImmersive } = await import("../ui/immersive.js");
const { createPositionArrow } = await import("../ui/position-arrow.js");

/** A doubled map adapter, recording what the arrow asks of it. */
function fakeAdapter() {
    return {
        createMarker: vi.fn(),
        removeMarker: vi.fn(),
        updateMarkerPosition: vi.fn(),
        setMarkerRotation: vi.fn(),
    };
}

describe("le mode immersif, vu du plugin", () => {
    beforeEach(() => {
        getGeoLeafMock.mockReset();
        warnMock.mockReset();
    });

    it("demande le mode ET le plein écran au cœur", () => {
        const setImmersive = vi.fn();
        getGeoLeafMock.mockReturnValue({ UI: { setImmersive } });
        enterImmersive();
        expect(setImmersive).toHaveBeenCalledWith(true, { fullscreen: true });
        exitImmersive();
        expect(setImmersive).toHaveBeenLastCalledWith(false, { fullscreen: true });
    });

    it("🛑 un cœur SANS la couture ne jette pas — mais il ne se tait pas non plus", () => {
        // `peerDependencies` says `^3.0.0`, and a 3.0.0 without `setImmersive` satisfies it
        // perfectly. Swallowing that with `?.()` would give a mode that silently does nothing —
        // no chrome hidden, no stylesheet either — which is the exact defect class this
        // repository keeps re-finding. Saying it once is what makes it findable.
        getGeoLeafMock.mockReturnValue({ UI: {} });
        expect(() => enterImmersive()).not.toThrow();
        expect(warnMock).toHaveBeenCalledTimes(1);
        expect(String(warnMock.mock.calls[0]![0])).toMatch(/immersive/i);
    });

    it("l'avertissement ne se répète pas à chaque relevé", () => {
        getGeoLeafMock.mockReturnValue({ UI: {} });
        enterImmersive();
        enterImmersive();
        exitImmersive();
        expect(warnMock.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it("aucun cœur du tout : le guidage continue", () => {
        getGeoLeafMock.mockReturnValue(undefined);
        expect(() => enterImmersive()).not.toThrow();
        expect(() => exitImmersive()).not.toThrow();
    });
});

describe("la flèche de position", () => {
    beforeEach(() => getGeoLeafMock.mockReset());

    it("ne dessine RIEN avant le premier relevé", () => {
        // A marker placed before any position has been measured would sit at 0,0 in the
        // Atlantic until the first fix arrived.
        const map = fakeAdapter();
        getGeoLeafMock.mockReturnValue({ Core: { getMap: () => map } });
        createPositionArrow();
        expect(map.createMarker).not.toHaveBeenCalled();
    });

    it('🛑 crée le marqueur avec `rotationAlignment: "map"` — c\'est ce qui délègue la contre-rotation au moteur', () => {
        // The engine re-derives `rotation − bearing` on every rendered frame for a marker
        // aligned to the map. Computing it here instead, once per fix, would freeze the arrow
        // while the camera is still easing round a corner — pointing 90° wrong for the whole
        // turn, which is the one moment anybody looks at it.
        const map = fakeAdapter();
        getGeoLeafMock.mockReturnValue({ Core: { getMap: () => map } });
        createPositionArrow().update([55, -21], 90);
        const [id, at, opts] = map.createMarker.mock.calls[0]!;
        expect(id).toBe("gl-nav-position-arrow");
        expect(at).toEqual({ lng: 55, lat: -21 });
        expect((opts as Record<string, unknown>).rotationAlignment).toBe("map");
        expect((opts as Record<string, unknown>).rotation).toBe(90);
    });

    it("🛑 l'icône est du SVG PUR — un `<div>` serait retiré par l'assainissement", () => {
        // The adapter passes `icon` through an SVG-only allow-list. A wrapping `<div>` is not
        // on it and would be dropped in silence, taking the shape with it.
        const map = fakeAdapter();
        getGeoLeafMock.mockReturnValue({ Core: { getMap: () => map } });
        createPositionArrow().update([55, -21], 0);
        const icon = String((map.createMarker.mock.calls[0]![2] as Record<string, unknown>).icon);
        expect(icon.trimStart().startsWith("<svg")).toBe(true);
        expect(icon).not.toMatch(/<div/i);
    });

    it("DÉPLACE le marqueur au relevé suivant, il ne le recrée pas", () => {
        const map = fakeAdapter();
        getGeoLeafMock.mockReturnValue({ Core: { getMap: () => map } });
        const a = createPositionArrow();
        a.update([55, -21], 10);
        a.update([55.1, -21.1], 20);
        expect(map.createMarker).toHaveBeenCalledTimes(1);
        expect(map.updateMarkerPosition).toHaveBeenCalledWith("gl-nav-position-arrow", {
            lng: 55.1,
            lat: -21.1,
        });
        expect(map.setMarkerRotation).toHaveBeenCalledWith("gl-nav-position-arrow", 20);
    });

    it("🛑 sans cap, la rotation est LAISSÉE TELLE QUELLE — jamais remise à zéro", () => {
        // The platform withholds the heading precisely while standing still. Zeroing it would
        // swing the arrow due north at every red light — the same trap the camera avoids by
        // omitting `bearing` rather than sending 0.
        const map = fakeAdapter();
        getGeoLeafMock.mockReturnValue({ Core: { getMap: () => map } });
        const a = createPositionArrow();
        a.update([55, -21], 42);
        a.update([55, -21], null);
        expect(map.setMarkerRotation).not.toHaveBeenCalled();
    });

    it("un adaptateur SANS couture de rotation ne casse pas la flèche", () => {
        // `setMarkerRotation` is optional on the contract. An engine without a rotation model
        // still gets a marker that moves.
        const map = { ...fakeAdapter(), setMarkerRotation: undefined };
        getGeoLeafMock.mockReturnValue({ Core: { getMap: () => map } });
        const a = createPositionArrow();
        a.update([55, -21], 10);
        expect(() => a.update([55.1, -21], 20)).not.toThrow();
        expect(map.updateMarkerPosition).toHaveBeenCalled();
    });

    it("retire le marqueur au démontage, et deux fois ne jette pas", () => {
        const map = fakeAdapter();
        getGeoLeafMock.mockReturnValue({ Core: { getMap: () => map } });
        const a = createPositionArrow();
        a.update([55, -21], 0);
        a.destroy();
        a.destroy();
        expect(map.removeMarker).toHaveBeenCalledTimes(1);
    });

    it("sans carte, tout est sans effet — le guidage ne s'arrête pas pour ça", () => {
        getGeoLeafMock.mockReturnValue(undefined);
        const a = createPositionArrow();
        expect(() => a.update([55, -21], 0)).not.toThrow();
        expect(() => a.destroy()).not.toThrow();
    });
});
