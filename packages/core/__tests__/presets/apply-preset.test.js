/**
 * Unit tests — presets/apply-preset.ts (presets build, S2)
 *
 * Covers the two-pass preset composition helpers extracted from boot.ts:
 * registerPresetDeclarations (Pass 1) and registerPresetModules (Pass 2),
 * including every branch of the gated-module condition.
 */

import { describe, expect, it, vi } from "vitest";

const { registerPresetDeclarations, registerPresetModules } =
    await import("../../src/presets/apply-preset.ts");

/**
 * Builds a minimal fake installer matching the CapabilityInstaller surface.
 *
 * The module carries a spied `init` since the gate moved into init(): the
 * wrapper registers ALL modules and `init()` decides, so "did it run" no
 * longer reads on registration.
 */
function makeInstaller(id, { withModule = true } = {}) {
    const inst = {
        declaration: { id },
        innerInit: vi.fn(),
        registerGlobals: vi.fn((gl) => {
            gl[`_${id}`] = true;
        }),
    };
    if (withModule) {
        inst.createModule = vi.fn(() => ({
            id,
            dependencies: [],
            init: inst.innerInit,
            destroy: vi.fn(),
        }));
    }
    return inst;
}

/** The last module handed to the registry, i.e. `gatedModule()`'s wrapper. */
const lastRegistered = (modReg) => modReg.register.mock.calls.at(-1)[0];

describe("registerPresetDeclarations (presets/apply-preset)", () => {
    it("registers every declaration and runs registerGlobals in manifest order", () => {
        const a = makeInstaller("a");
        const b = makeInstaller("b");
        const preset = { id: "test", capabilities: [a, b] };
        const registered = [];
        const capReg = { register: vi.fn((d) => registered.push(d.id)), noteInstaller: vi.fn() };
        const gl = {};

        registerPresetDeclarations(preset, capReg, gl);

        expect(registered).toEqual(["a", "b"]);
        expect(a.registerGlobals).toHaveBeenCalledWith(gl);
        expect(b.registerGlobals).toHaveBeenCalledWith(gl);
        expect(gl._a).toBe(true);
        expect(gl._b).toBe(true);
    });

    // Pass 1 is the only place that sees ALL the installers, hence the only
    // one that can say which contribute a module. The fact travels here, not
    // on the declaration — the runtime channel produces installer-less declarations.
    it("relève hasModule depuis l'installeur, sans appeler createModule", () => {
        const withMod = makeInstaller("with-mod");
        const policy = makeInstaller("policy", { withModule: false });
        const capReg = { register: vi.fn(), noteInstaller: vi.fn() };

        registerPresetDeclarations({ id: "test", capabilities: [withMod, policy] }, capReg, {});

        expect(capReg.noteInstaller).toHaveBeenCalledWith("with-mod", { hasModule: true });
        expect(capReg.noteInstaller).toHaveBeenCalledWith("policy", { hasModule: false });
        // `createModule` is read as a FIELD: Pass 2 is its only caller, and
        // a second call would build a second module instance.
        expect(withMod.createModule).not.toHaveBeenCalled();
    });

    it("is a no-op for an empty preset", () => {
        const capReg = { register: vi.fn(), noteInstaller: vi.fn() };
        registerPresetDeclarations({ id: "empty", capabilities: [] }, capReg, {});
        expect(capReg.register).not.toHaveBeenCalled();
        expect(capReg.noteInstaller).not.toHaveBeenCalled();
    });
});

describe("registerPresetModules (presets/apply-preset)", () => {
    // ⚠️ This test was called "registers modules only for enabled
    // installers" and required `registered === ["with-mod"]`. The rework
    // removed the registration condition: what is filtered is execution, and
    // later. `policy` (no createModule) stays absent — that half has not changed.
    it("registers a module for every installer that declares createModule, gated or not", () => {
        const withMod = makeInstaller("with-mod");
        const policy = makeInstaller("policy", { withModule: false }); // no createModule
        const disabled = makeInstaller("disabled"); // createModule, but gate closed
        const preset = { id: "test", capabilities: [withMod, policy, disabled] };
        const registered = [];
        const modReg = { register: vi.fn((m) => registered.push(m.id)) };
        const capReg = { isEnabled: vi.fn((id) => id !== "disabled") };

        registerPresetModules(preset, capReg, modReg);

        expect(registered).toEqual(["with-mod", "disabled"]);
        expect(withMod.createModule).toHaveBeenCalledTimes(1);
        expect(disabled.createModule).toHaveBeenCalledTimes(1);
        // The gate is not consulted at registration — the whole point of the change.
        expect(capReg.isEnabled).not.toHaveBeenCalled();
        // `policy` has no createModule: it contributes nothing, before as after.
        expect(registered).not.toContain("policy");
    });

    it("consults the gate at init(), against the config init() receives", () => {
        const withMod = makeInstaller("with-mod");
        const disabled = makeInstaller("disabled");
        const modReg = { register: vi.fn() };
        const capReg = { isEnabled: vi.fn((id) => id !== "disabled") };

        registerPresetModules({ id: "t", capabilities: [withMod, disabled] }, capReg, modReg);
        expect(capReg.isEnabled).not.toHaveBeenCalled();

        const [onWrapper] = modReg.register.mock.calls[0];
        const [offWrapper] = modReg.register.mock.calls[1];
        const cfg = { modules: {} };

        onWrapper.init({}, cfg);
        offWrapper.init({}, cfg);

        expect(withMod.innerInit).toHaveBeenCalledTimes(1);
        expect(disabled.innerInit).not.toHaveBeenCalled();
        expect(onWrapper.isEnabled()).toBe(true);
        expect(offWrapper.isEnabled()).toBe(false);
        // And the registry was indeed queried with a reader of the init config.
        expect(capReg.isEnabled).toHaveBeenCalledTimes(2);
    });

    it("is a no-op for an empty preset", () => {
        const modReg = { register: vi.fn() };
        registerPresetModules({ id: "empty", capabilities: [] }, { isEnabled: vi.fn() }, modReg);
        expect(modReg.register).not.toHaveBeenCalled();
    });

    // S2 Lot 6 — `moduleGate`: the module hangs off a SUB-KEY of the capability's config
    // (share under permalink), so it must NOT be gated by the declaration's own gate.
    it("prefers moduleGate over the declaration gate when present", () => {
        const sub = makeInstaller("permalink");
        sub.declaration.gate = { configPath: "modules.permalink.enabled", enableWhenAbsent: true };
        sub.moduleGate = {
            configPath: "modules.permalink.share.enabled",
            enableWhenAbsent: true,
        };
        const registered = [];
        const modReg = { register: vi.fn((m) => registered.push(m.id)) };
        // The declaration gate would say "disabled" — it must not be consulted at all.
        const capReg = { isEnabled: vi.fn(() => false) };

        registerPresetModules({ id: "t", capabilities: [sub] }, capReg, modReg);
        lastRegistered(modReg).init(
            {},
            // `share` absent → enableWhenAbsent:true → actif ; `permalink` explicitement false.
            { modules: { permalink: { enabled: false } } }
        );

        expect(registered).toEqual(["permalink"]);
        expect(sub.innerInit).toHaveBeenCalledTimes(1);
        expect(capReg.isEnabled).not.toHaveBeenCalled();
    });

    // ⚠️ This test required `modReg.register` NEVER called. The module is
    // now registered; what is skipped is its `init()`. The tested property —
    // "the sub-key wins over the declaration gate, including to TURN OFF" —
    // is unchanged.
    it("skips the module's init when its moduleGate key is explicitly false", () => {
        const sub = makeInstaller("permalink");
        sub.moduleGate = {
            configPath: "modules.permalink.share.enabled",
            enableWhenAbsent: true,
        };
        const modReg = { register: vi.fn() };
        // The declaration gate would say "enabled" — the sub-key still wins.
        const capReg = { isEnabled: vi.fn(() => true) };

        registerPresetModules({ id: "t", capabilities: [sub] }, capReg, modReg);
        const wrapper = lastRegistered(modReg);
        wrapper.init({}, { modules: { permalink: { share: { enabled: false } } } });

        expect(modReg.register).toHaveBeenCalledTimes(1);
        expect(sub.createModule).toHaveBeenCalledTimes(1);
        expect(sub.innerInit).not.toHaveBeenCalled();
        expect(wrapper.isEnabled()).toBe(false);
        expect(capReg.isEnabled).not.toHaveBeenCalled();
    });

    // A gated-off module must not be DESTROYED either: `destroy()` undoing
    // an `init()` that never ran is the wrapper's silent half.
    it("skips destroy() for a module whose gate never let it run", () => {
        const sub = makeInstaller("branding");
        const modReg = { register: vi.fn() };
        const capReg = { isEnabled: vi.fn(() => false) };

        registerPresetModules({ id: "t", capabilities: [sub] }, capReg, modReg);
        const wrapper = lastRegistered(modReg);
        const inner = sub.createModule.mock.results[0].value;
        wrapper.init({}, {});
        wrapper.destroy();

        expect(sub.innerInit).not.toHaveBeenCalled();
        expect(inner.destroy).not.toHaveBeenCalled();
    });
});
