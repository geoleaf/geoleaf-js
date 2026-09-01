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
 *     then loads the bundle on demand. `registry.register()` then arrives after `init()`:
 *     `module-registry.ts` stores it, never calls its `init()`, never draws its slot, and logs a
 *     warning. The registration is inert, and the warning has no reachable audience.
 *
 * 🛑 The two are told apart by `registry.isInitialized()` — at the contract since
 * `core-module.contract.ts`, so a plugin may read it. Nothing else in the page distinguishes
 * them: the plugin cannot know who loaded it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let registerSlot: ReturnType<typeof vi.fn>;
let registerPlugin: ReturnType<typeof vi.fn>;
let registerDict: ReturnType<typeof vi.fn>;

/** Installs a namespace whose registry reports the given initialisation state. */
function installHost(initialized: boolean): void {
    registerSlot = vi.fn();
    registerPlugin = vi.fn();
    registerDict = vi.fn();
    (globalThis as Record<string, unknown>).GeoLeaf = {
        I18n: { registerDict },
        plugins: { register: registerPlugin },
        registry: { register: registerSlot, isInitialized: () => initialized },
        Config: { get: () => ({}) },
        Log: { warn: vi.fn(), info: vi.fn() },
    };
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
        const [slot] = registerSlot.mock.calls[0] as [{ id: string }];
        expect(slot.id).toBe("position-share");
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
    // The slot is already declared by `init.js` via `registerLazyForAction`. Registering again
    // here changes NOTHING on screen — `_appendRegistryIcons()` ran once, at boot — and costs a
    // warning per load. Skipping it is the whole point of the fix.
    it("ne re-déclare PAS son créneau : l'appel serait inerte et bruyant", async () => {
        installHost(true);
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
