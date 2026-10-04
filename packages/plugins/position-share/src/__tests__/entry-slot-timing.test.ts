/**
 * @geoleaf-plugins/position-share — WHEN the toolbar slot is declared
 *
 * Two loading paths exist, and `entry.ts` must behave differently on each. This file is the
 * test the repository did NOT have, and whose absence is what made a naive fix tempting.
 *
 *   • EAGER — the integrator loads the bundle with a `<script type="module">` before
 *     `GeoLeaf.boot()`, which is exactly what the six published READMEs prescribe. There is no
 *     `init.js` on that path: `registry.register()` is the ONLY declaration of the slot, it runs
 *     before `init()`, and it is honoured. Removing it would delete the button for every npm
 *     consumer following their package's README.
 *
 *   • LAZY — the deployable app declares the slot BEFORE boot with `registerLazyForAction()`,
 *     then loads the bundle on demand. A SLOT registered then arrives after `init()`: it is
 *     stored, not drawn before the next mount, and warned about. The button belongs to the lazy
 *     declaration, which the core draws again at every boot.
 *
 * 🛑 The two are told apart by `registry.isInitialized()` — at the contract since
 * `core-module.contract.ts`, so a plugin may read it. Nothing else in the page distinguishes
 * them: the plugin cannot know who loaded it.
 *
 * ⚠️ **What is registered on BOTH paths is the TEARDOWN.** Until 1.0.2 the lazy path registered
 * nothing at all, and nothing therefore reached the plugin when `GeoLeaf.mount()` unmounted the
 * application: the emission loop went on. The module now carries the teardown everywhere, and
 * the slot before the boot only (`registerPluginModule`, `@geoleaf/host-runtime`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let registerSlot: ReturnType<typeof vi.fn>;
let registerPlugin: ReturnType<typeof vi.fn>;
let registerDict: ReturnType<typeof vi.fn>;

/**
 * Installs a namespace whose registry reports the given initialisation state.
 *
 * @param initialized - What `registry.isInitialized()` answers.
 * @param withMount - Whether the core has `GeoLeaf.mount()` — i.e. can unmount an application.
 */
function installHost(initialized: boolean, withMount = true): void {
    registerSlot = vi.fn();
    registerPlugin = vi.fn();
    registerDict = vi.fn();
    (globalThis as Record<string, unknown>).GeoLeaf = {
        I18n: { registerDict },
        plugins: { register: registerPlugin },
        registry: { register: registerSlot, isInitialized: () => initialized },
        ...(withMount ? { mount: () => undefined } : {}),
        Config: { get: () => ({}) },
        Log: { warn: vi.fn(), info: vi.fn() },
    };
}

/** The module the entry handed to the registry. */
function registeredModule(): { id: string; ui?: object; destroy: () => void } {
    return registerSlot.mock.calls[0]![0] as { id: string; ui?: object; destroy: () => void };
}

async function loadEntry(): Promise<void> {
    vi.resetModules();
    await import("../entry.js");
}

beforeEach(() => {
    document.body.innerHTML = "";
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>).GeoLeaf;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("chemin EAGER — le bundle est chargé avant boot()", () => {
    it("déclare son créneau : c'est la SEULE déclaration chez l'intégrateur npm", async () => {
        installHost(false);
        await loadEntry();
        expect(registerSlot).toHaveBeenCalledTimes(1);
        const module = registeredModule();
        expect(module.id).toBe("position-share");
        expect(Object.keys(module.ui ?? {}).sort()).toEqual(["desktopTabButton", "mobileIcon"]);
        expect(module.destroy).toBeTypeOf("function");
    });

    it("monte son namespace et s'enregistre, comme sur l'autre chemin", async () => {
        installHost(false);
        await loadEntry();
        const host = (globalThis as Record<string, unknown>).GeoLeaf as Record<string, unknown>;
        expect(typeof host.PositionShare).toBe("object");
        expect(registerPlugin).toHaveBeenCalledTimes(1);
        expect(registerDict).toHaveBeenCalledTimes(1);
    });
});

describe("chemin PARESSEUX — le bundle est chargé après init()", () => {
    // The slot is already declared by `init.js` via `registerLazyForAction`. Registering it
    // again here would change NOTHING on screen — the toolbar is built — and would have the
    // registry judge the same button a second time at the next boot.
    it("ne re-déclare PAS son créneau, et inscrit quand même son démontage", async () => {
        installHost(true);
        await loadEntry();
        expect(registerSlot).toHaveBeenCalledTimes(1);
        const module = registeredModule();
        expect(module.id).toBe("position-share");
        expect("ui" in module).toBe(false);
        expect(module.destroy).toBeTypeOf("function");
    });

    // Nothing unmounts an application on a core without `GeoLeaf.mount()` (< 3.13.0): a late
    // registration would be stored, never used, and reported as a mistake.
    it("n'inscrit rien sur un core qui ne sait pas démonter", async () => {
        installHost(true, false);
        await loadEntry();
        expect(registerSlot).not.toHaveBeenCalled();
    });

    it("monte quand même son namespace et s'enregistre", async () => {
        installHost(true);
        await loadEntry();
        const host = (globalThis as Record<string, unknown>).GeoLeaf as Record<string, unknown>;
        expect(typeof host.PositionShare).toBe("object");
        expect(registerPlugin).toHaveBeenCalledTimes(1);
    });
});

describe("hôte qui ne connaît pas `isInitialized`", () => {
    // ⚠️ An older core, or a partial mock, has no `isInitialized`. Optional chaining then yields
    // `undefined`, which is NOT `true` — so the slot IS declared. Failing open is the right way
    // round: a spurious warning costs a console line, a missing declaration costs the button.
    it("déclare le créneau plutôt que de le sauter", async () => {
        registerSlot = vi.fn();
        registerPlugin = vi.fn();
        registerDict = vi.fn();
        (globalThis as Record<string, unknown>).GeoLeaf = {
            I18n: { registerDict },
            plugins: { register: registerPlugin },
            registry: { register: registerSlot },
            Config: { get: () => ({}) },
            Log: { warn: vi.fn(), info: vi.fn() },
        };
        await loadEntry();
        expect(registerSlot).toHaveBeenCalledTimes(1);
    });
});
