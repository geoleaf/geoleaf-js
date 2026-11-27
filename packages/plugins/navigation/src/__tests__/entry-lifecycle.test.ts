/**
 * THE GUIDANCE SESSION ENDS WITH THE APPLICATION.
 *
 * 🛑 Measured in a browser, on a session running when the application was unmounted: the
 * guidance banner stayed in the page, the position watch and the screen wake lock stayed
 * held, and the session kept reading fixes for a map that no longer existed. This plugin
 * registered a toolbar slot with the core's module registry, and no teardown.
 *
 * ⚠️ The entry is a side-effect module: it is imported after the namespace is planted, and
 * re-imported for each case (`vi.resetModules()`).
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

interface RegisteredModule {
    id: string;
    destroy?: () => void;
    ui?: Record<string, unknown>;
}
interface Planted {
    registry: { register: (m: RegisteredModule) => void; isInitialized: () => boolean };
    mount?: () => void;
    Navigation?: { stop: () => void };
}
const g = globalThis as unknown as { GeoLeaf?: Planted };

/** Plants a core as the entry finds it, before or after its boot. */
function plantCore({ initialized, mount = true }: { initialized: boolean; mount?: boolean }) {
    const register = vi.fn<(m: RegisteredModule) => void>();
    g.GeoLeaf = {
        registry: { register, isInitialized: () => initialized },
        ...(mount && { mount: () => undefined }),
    };
    return register;
}

const moduleOf = (register: ReturnType<typeof plantCore>): RegisteredModule | undefined =>
    register.mock.calls.map(([m]) => m).find((m) => m.id === "navigation");

beforeEach(() => {
    vi.resetModules();
});

afterEach(() => {
    delete g.GeoLeaf;
});

describe("navigation — le démontage", () => {
    test("🛑 chargé à la demande (après le boot) : un démontage est inscrit, et il ARRÊTE la session", async () => {
        // The shipped path: the application declares this plugin lazy, so it is always
        // evaluated on a running registry.
        const register = plantCore({ initialized: true });
        await import("../entry.js");

        const module = moduleOf(register);
        expect(module, "aucun module de cycle de vie inscrit").toBeDefined();
        expect(typeof module?.destroy).toBe("function");

        const stop = vi.spyOn(g.GeoLeaf!.Navigation!, "stop");
        module?.destroy?.();
        expect(stop).toHaveBeenCalledTimes(1);
        // On that path the toolbar is already built: a slot registered now is not drawn.
        expect(module?.ui).toBeUndefined();
    });

    test("chargé avant le boot : le même démontage, et AUCUN créneau de barre", async () => {
        // The slot never opened anything (its listener called a `Navigation.open` that does not
        // exist): it is gone, with `showButton`. Guidance is entered from routing's panel.
        const register = plantCore({ initialized: false });
        await import("../entry.js");

        const module = moduleOf(register);
        expect(typeof module?.destroy).toBe("function");
        expect(module?.ui).toBeUndefined();

        const stop = vi.spyOn(g.GeoLeaf!.Navigation!, "stop");
        module?.destroy?.();
        expect(stop).toHaveBeenCalledTimes(1);
    });

    test("après le boot d'un core SANS `mount()` : rien n'est inscrit — rien n'y démonte", async () => {
        const register = plantCore({ initialized: true, mount: false });
        await import("../entry.js");
        expect(moduleOf(register)).toBeUndefined();
    });

    test("le démontage est sans effet quand aucune session ne tourne", async () => {
        const register = plantCore({ initialized: true });
        await import("../entry.js");
        expect(() => moduleOf(register)?.destroy?.()).not.toThrow();
    });
});

describe('navigation — `requires: ["routing"]` est tenu', () => {
    test("sans routing chargé, le chargement refuse et nomme la dépendance — rien n'est monté", async () => {
        plantCore({ initialized: true });
        (g.GeoLeaf as unknown as { plugins: unknown }).plugins = {
            isLoaded: (name: string) => name !== "routing",
            register: vi.fn(),
        };
        await expect(import("../entry.js")).rejects.toThrow(/requires the routing plugin/);
        expect(g.GeoLeaf?.Navigation).toBeUndefined();
    });

    test("avec routing chargé, le chargement se fait", async () => {
        plantCore({ initialized: true });
        (g.GeoLeaf as unknown as { plugins: unknown }).plugins = {
            isLoaded: () => true,
            register: vi.fn(),
        };
        await import("../entry.js");
        expect(typeof g.GeoLeaf?.Navigation).toBe("object");
    });
});
