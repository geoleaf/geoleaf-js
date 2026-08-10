/**
 * Unit tests — presets/apply-preset.ts (presets build, S2)
 *
 * Covers the two-pass preset composition helpers extracted from boot.ts:
 * registerPresetDeclarations (Pass 1) and registerPresetModules (Pass 2),
 * including every branch of the gated-module condition.
 */

import { describe, expect, it, vi } from "vitest";

const { registerPresetDeclarations, registerPresetModules } = await import(
    "../../src/presets/apply-preset.ts"
);

/**
 * Builds a minimal fake installer matching the CapabilityInstaller surface.
 *
 * Le module porte un `init` espionné depuis socle-init 9.2 : l'enrobage enregistre TOUS les
 * modules et c'est `init()` qui tranche, donc « a-t-il tourné » n'est plus lisible sur
 * l'enregistrement.
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

/** Le dernier module remis au registre, c'est-à-dire l'enrobage de `gatedModule()`. */
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

    // Socle-init 9.4 : la Pass 1 est le seul endroit qui voit TOUS les installeurs, donc le
    // seul qui puisse dire lesquels contribuent un module. Le fait voyage ici, pas sur la
    // déclaration — le canal runtime produit des déclarations sans installeur.
    it("relève hasModule depuis l'installeur, sans appeler createModule", () => {
        const withMod = makeInstaller("with-mod");
        const policy = makeInstaller("policy", { withModule: false });
        const capReg = { register: vi.fn(), noteInstaller: vi.fn() };

        registerPresetDeclarations({ id: "test", capabilities: [withMod, policy] }, capReg, {});

        expect(capReg.noteInstaller).toHaveBeenCalledWith("with-mod", { hasModule: true });
        expect(capReg.noteInstaller).toHaveBeenCalledWith("policy", { hasModule: false });
        // `createModule` est lu comme un CHAMP : Pass 2 en est le seul appelant, et un second
        // appel construirait une seconde instance de module.
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
    // ⚠️ Ce test s'appelait « registers modules only for enabled installers » et exigeait
    // `registered === ["with-mod"]`. Socle-init 9.2 a retiré la condition d'enregistrement :
    // ce qui est filtré, c'est l'exécution, et elle l'est plus tard. Le `policy` (sans
    // createModule) reste, lui, absent — cette moitié-là n'a pas changé.
    it("registers a module for every installer that declares createModule, gated or not", () => {
        const withMod = makeInstaller("with-mod");
        const policy = makeInstaller("policy", { withModule: false }); // no createModule
        const disabled = makeInstaller("disabled"); // createModule, mais gate fermé
        const preset = { id: "test", capabilities: [withMod, policy, disabled] };
        const registered = [];
        const modReg = { register: vi.fn((m) => registered.push(m.id)) };
        const capReg = { isEnabled: vi.fn((id) => id !== "disabled") };

        registerPresetModules(preset, capReg, modReg);

        expect(registered).toEqual(["with-mod", "disabled"]);
        expect(withMod.createModule).toHaveBeenCalledTimes(1);
        expect(disabled.createModule).toHaveBeenCalledTimes(1);
        // Le gate n'est pas consulté à l'enregistrement — c'est tout le geste de 9.2.
        expect(capReg.isEnabled).not.toHaveBeenCalled();
        // `policy` n'a pas de createModule : il ne contribue rien, avant comme après.
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
        // Et le registre a bien été interrogé avec un lecteur de la config d'init.
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

    // ⚠️ Ce test exigeait `modReg.register` JAMAIS appelé. Depuis 9.2 le module est bien
    // enregistré ; ce qui est sauté, c'est son `init()`. La propriété testée — « la sous-clé
    // l'emporte sur le gate de déclaration, y compris pour ÉTEINDRE » — est inchangée.
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

    // Un module éteint ne doit pas non plus être DÉTRUIT : `destroy()` défaisant un `init()`
    // qui n'a jamais tourné est la moitié silencieuse de l'enrobage.
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
