/*!
 * @geoleaf/host-runtime — lifecycle-seam tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * Runs under the package default (`environment: "node"`): the seam only reads the
 * `GeoLeaf` namespace off `globalThis`.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { registerPluginModule } from "../lifecycle-seam.js";
import type { GeoLeafHost } from "../host.js";

const carrier = globalThis as { GeoLeaf?: GeoLeafHost };

/** What the registry was handed, as a plugin's module arrives there. */
interface Registered {
    id: string;
    dependencies: string[];
    init: () => unknown;
    destroy: () => void;
    ui?: object;
}

/**
 * Mounts a namespace with a module registry.
 *
 * @param initialized - What `registry.isInitialized()` answers; `undefined` leaves the member out.
 * @param withMount - Whether the core has `GeoLeaf.mount()`.
 * @returns The `register` spy.
 */
function mountHost(initialized: boolean | undefined, withMount = true) {
    const register = vi.fn<(module: Registered) => void>();
    carrier.GeoLeaf = {
        registry: {
            register,
            ...(initialized === undefined ? {} : { isInitialized: () => initialized }),
        },
        ...(withMount ? { mount: () => undefined } : {}),
    } as unknown as GeoLeafHost;
    return register;
}

const SLOT = { mobileIcon: { icon: "<svg/>", labelKey: "x.button", action: "x" } };

afterEach(() => {
    delete carrier.GeoLeaf;
    vi.restoreAllMocks();
});

describe("registerPluginModule", () => {
    it("before the boot: registers the teardown AND the toolbar slot", () => {
        const register = mountHost(false);
        const destroy = vi.fn();

        expect(registerPluginModule({ id: "x", destroy, ui: SLOT })).toBe(true);

        expect(register).toHaveBeenCalledTimes(1);
        const module = register.mock.calls[0]![0];
        expect(module.id).toBe("x");
        expect(module.dependencies).toEqual([]);
        expect(module.ui).toBe(SLOT);
        // The registry demands both hooks; the plugin starts on the boot's events, not here.
        expect(module.init()).toBeUndefined();
        module.destroy();
        expect(destroy).toHaveBeenCalledTimes(1);
    });

    it("🛑 after the boot: registers the teardown WITHOUT the slot", () => {
        const register = mountHost(true);
        const destroy = vi.fn();

        expect(registerPluginModule({ id: "x", destroy, ui: SLOT })).toBe(true);

        const module = register.mock.calls[0]![0];
        // The button belongs to the lazy declaration that drew it: a slot registered now would
        // be judged a second time at the next boot.
        expect("ui" in module).toBe(false);
        module.destroy();
        expect(destroy).toHaveBeenCalledTimes(1);
    });

    it("a host without isInitialized() is the eager path — the slot is declared", () => {
        const register = mountHost(undefined);
        registerPluginModule({ id: "x", destroy: () => undefined, ui: SLOT });
        expect(register.mock.calls[0]![0].ui).toBe(SLOT);
    });

    it("a module without a slot carries none, on either path", () => {
        const eager = mountHost(false);
        registerPluginModule({ id: "x", destroy: () => undefined });
        expect("ui" in eager.mock.calls[0]![0]).toBe(false);

        const late = mountHost(true);
        registerPluginModule({ id: "x", destroy: () => undefined });
        expect("ui" in late.mock.calls[0]![0]).toBe(false);
    });

    it("🛑 after the boot of a core without GeoLeaf.mount(): registers nothing", () => {
        const register = mountHost(true, false);
        expect(registerPluginModule({ id: "x", destroy: () => undefined, ui: SLOT })).toBe(false);
        expect(register).not.toHaveBeenCalled();
    });

    it("before the boot of a core without GeoLeaf.mount(): the slot is still declared", () => {
        const register = mountHost(false, false);
        expect(registerPluginModule({ id: "x", destroy: () => undefined, ui: SLOT })).toBe(true);
        expect(register.mock.calls[0]![0].ui).toBe(SLOT);
    });

    it("answers false without a core, and without a registry", () => {
        expect(registerPluginModule({ id: "x", destroy: () => undefined })).toBe(false);
        carrier.GeoLeaf = {} as GeoLeafHost;
        expect(registerPluginModule({ id: "x", destroy: () => undefined })).toBe(false);
    });
});
