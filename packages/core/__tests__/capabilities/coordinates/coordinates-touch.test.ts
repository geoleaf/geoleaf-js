/**
 * The coordinates readout is not shown under a coarse pointer unless the profile asks for it.
 *
 * The readout listens to `mousemove` only: on a touch screen it displayed « Lat : --, Lng : -- »
 * for good, on the very devices the product targets. Decided on 13/09/2026: under
 * `(pointer: coarse)`, an ABSENT `enabled` no longer mounts it; `enabled: true` still does, and
 * `enabled: false` still wins everywhere. The coarse-pointer case was seen red on the code that
 * mounted the readout whatever the pointer; the four others pin what must not move.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ raw: {} as Record<string, unknown>, coarse: false }));

vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (_path: string, fallback: unknown) => state.raw ?? fallback },
}));

vi.mock("../../../src/capabilities/coordinates/coordinates.js", () => ({
    CoordinatesDisplay: { init: vi.fn(), destroy: vi.fn() },
}));

const { getCoordinatesConfig } = await import("../../../src/capabilities/coordinates/config.js");
const { buildPublicApi } = await import("../../../src/capabilities/coordinates/public-api.js");
const { CoordinatesLifecycle } = await import("../../../src/capabilities/coordinates/lifecycle.js");
const { CoordinatesDisplay } = await import("../../../src/capabilities/coordinates/coordinates.js");

const realMatchMedia = window.matchMedia;

/** Points `matchMedia` at a pointer kind — `null` removes the API, as outside a browser. */
function pointer(kind: "coarse" | "fine" | null): void {
    state.coarse = kind === "coarse";
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value:
            kind === null
                ? undefined
                : vi.fn((query: string) => ({
                      matches: query === "(pointer: coarse)" && state.coarse,
                      media: query,
                      addEventListener: vi.fn(),
                      removeEventListener: vi.fn(),
                  })),
    });
}

/** Runs the lifecycle to the point where it decides to mount, and says whether it did. */
function mounts(): boolean {
    vi.mocked(CoordinatesDisplay.init).mockClear();
    CoordinatesLifecycle.init({} as never);
    document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
    const mounted = vi.mocked(CoordinatesDisplay.init).mock.calls.length > 0;
    CoordinatesLifecycle._reset();
    return mounted;
}

beforeEach(() => {
    state.raw = {};
});

afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: realMatchMedia,
    });
});

describe("coordonnées — défaut selon le pointeur", () => {
    it("pointeur fin, `enabled` absent : affiché", () => {
        pointer("fine");
        expect(getCoordinatesConfig().enabled).toBe(true);
        expect(buildPublicApi().isEnabled()).toBe(true);
        expect(mounts()).toBe(true);
    });

    it("pointeur grossier, `enabled` absent : NON monté, et `isEnabled()` le dit", () => {
        pointer("coarse");
        expect(getCoordinatesConfig().enabled).toBe(false);
        expect(buildPublicApi().isEnabled()).toBe(false);
        expect(mounts()).toBe(false);
    });

    it("pointeur grossier, `enabled: true` explicite : monté", () => {
        pointer("coarse");
        state.raw = { enabled: true };
        expect(getCoordinatesConfig().enabled).toBe(true);
        expect(mounts()).toBe(true);
    });

    it("`enabled: false` l'emporte sur tout pointeur", () => {
        pointer("fine");
        state.raw = { enabled: false };
        expect(getCoordinatesConfig().enabled).toBe(false);
        expect(mounts()).toBe(false);
    });

    it("sans `matchMedia`, `enabled` absent : affiché — le défaut d'avant est gardé", () => {
        pointer(null);
        expect(getCoordinatesConfig().enabled).toBe(true);
        expect(mounts()).toBe(true);
    });
});
