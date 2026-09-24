/**
 * A host that destroys the map while the boot is still running ENDS the boot — it does not
 * fail it.
 *
 * 🛑 Measured in a browser before the fix: `Core.destroy()` called before `geoleaf:app:ready`
 * (a component unmounted right after mounting) left the boot running on the destroyed map; the
 * `ui` module threw "map is not ready", the boot failed, and the failure screen « Le démarrage a
 * échoué » stayed up over the map the host had just recreated — 3 times out of 3.
 *
 * The boot now reads `wasDestroyed(adapter)` when a module fails, and exits as a refused
 * `beforeBoot` does: `geoleaf:boot:aborted` (reason `"destroyed"`), no failure screen, the veil
 * hidden. Witness mutations: drop the `wasDestroyed` branch of `_onModuleError` (the first two
 * tests go red), or the `_destroyedAdapters.add` line of `Core.destroy()` (every test reading
 * `wasDestroyed` as true goes red).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

vi.mock("../../src/adapters/maplibre/maplibre-adapter.js", () => ({
    // A plain function, not a class: `mockImplementation` is typed for callables, and a
    // constructor that returns an object yields that object under `new` just the same.
    MaplibreAdapter: vi.fn().mockImplementation(function () {
        return { init: vi.fn(), destroy: vi.fn(), getNativeMap: vi.fn(() => null) };
    }),
}));

vi.mock("../../src/kernel/map/map-container.js", () => ({
    resolveMapContainer: vi.fn(() => document.createElement("div")),
    applyThemeSafe: vi.fn(),
}));

vi.mock("../../src/kernel/map/theme.js", () => ({
    setTheme: vi.fn(),
    getTheme: vi.fn(() => "light"),
}));

type FacadeModule = typeof import("../../src/kernel/map/facade.js");
type BootCore = typeof import("../../src/app/boot-core.js");
type Preset = Parameters<BootCore["bootWithPreset"]>[0];
type Ctx = Parameters<BootCore["bootWithPreset"]>[1];
type RegistryInit = (
    adapter: unknown,
    cfg: unknown,
    opts: { onModuleError: (f: { id: string; error: unknown; skipped: string[] }) => string }
) => Promise<void>;

let Core: FacadeModule["Core"];
let wasDestroyed: FacadeModule["wasDestroyed"];
let bootWithPreset: BootCore["bootWithPreset"];

beforeAll(async () => {
    ({ Core, wasDestroyed } = await import("../../src/kernel/map/facade.js"));
    ({ bootWithPreset } = await import("../../src/app/boot-core.js"));
});

const PRESET = { id: "boot-destroyed-map", capabilities: [] } as unknown as Preset;

/** A BootContext whose registry runs `registryInit` in place of the modules. */
function makeCtx(registryInit: RegistryInit): Ctx {
    const AppLog = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const GeoLeaf: Record<string, unknown> = {
        loadConfig: (opts: { onLoaded: (c: unknown) => void }) => {
            setTimeout(() => opts.onLoaded({}), 0);
        },
        Config: { loadActiveProfileResources: vi.fn(() => Promise.resolve(null)) },
    };
    const registry = {
        register: vi.fn(),
        isInitialized: vi.fn(() => false),
        init: vi.fn(registryInit),
        getAll: vi.fn(() => []),
    };
    const app = { AppLog, getProfilesBasePath: () => "../profiles/", _appStarted: false };
    return { GeoLeaf, app, registry } as unknown as Ctx;
}

/** Registers the boot's adapter as the core-map module does. */
function registerBootMap(adapter: unknown, mapId: string): void {
    (Core.init as (o: Record<string, unknown>) => unknown)({
        mapId,
        container: document.createElement("div"),
        _adapter: adapter,
    });
}

const disposers: (() => void)[] = [];
function listen(name: string): unknown[] {
    const details: unknown[] = [];
    const handler = (event: Event) => details.push((event as CustomEvent).detail);
    document.addEventListener(name, handler);
    disposers.push(() => document.removeEventListener(name, handler));
    return details;
}
function mountVeil(): HTMLElement {
    const veil = document.createElement("div");
    veil.id = "gl-loader";
    document.body.appendChild(veil);
    return veil;
}

beforeEach(() => {
    document.body.replaceChildren();
});
afterEach(() => {
    while (disposers.length > 0) disposers.pop()?.();
    for (const id of Core.listMaps()) Core.destroy(id);
    document.body.replaceChildren();
});

describe("wasDestroyed — the registry remembers what Core.destroy() took out", () => {
    it("false while registered, true once destroyed, false again once registered anew", () => {
        const adapter = { init: vi.fn(), destroy: vi.fn(), getNativeMap: vi.fn(() => null) };
        expect(wasDestroyed(adapter as never)).toBe(false);

        registerBootMap(adapter, "was-destroyed-1");
        expect(wasDestroyed(adapter as never)).toBe(false);

        Core.destroy("was-destroyed-1");
        expect(wasDestroyed(adapter as never)).toBe(true);

        registerBootMap(adapter, "was-destroyed-1");
        expect(wasDestroyed(adapter as never)).toBe(false);
    });
});

describe("a map destroyed during the boot ends the boot, it does not fail it", () => {
    it("🛑 a module failing on the destroyed map → geoleaf:boot:aborted (destroyed), no failure", async () => {
        const veil = mountVeil();
        const aborted = listen("geoleaf:boot:aborted");
        const failed = listen("geoleaf:boot:failed");
        const ctx = makeCtx(async (adapter, _cfg, opts) => {
            registerBootMap(adapter, "boot-destroyed-1");
            Core.destroy("boot-destroyed-1"); // the host unmounts
            opts.onModuleError({ id: "ui", error: new Error("map is not ready"), skipped: [] });
        });

        await bootWithPreset(PRESET, ctx);

        expect(failed).toHaveLength(0);
        expect(aborted).toEqual([{ reason: "destroyed" }]);
        expect(veil.classList.contains("gl-loader--fade")).toBe(true);
        expect(veil.querySelector(".gl-boot-failure")).toBeNull();
    });

    it("a registry that throws after the host destroyed the map aborts once, and does not fail", async () => {
        const aborted = listen("geoleaf:boot:aborted");
        const failed = listen("geoleaf:boot:failed");
        const ctx = makeCtx(async (adapter, _cfg, opts) => {
            registerBootMap(adapter, "boot-destroyed-2");
            Core.destroy("boot-destroyed-2");
            opts.onModuleError({ id: "ui", error: new Error("map is not ready"), skipped: [] });
            throw new Error("map is not ready");
        });

        await bootWithPreset(PRESET, ctx);

        expect(failed).toHaveLength(0);
        expect(aborted).toHaveLength(1);
    });

    it("control — the same failure on a map still alive FAILS the boot, as before", async () => {
        const aborted = listen("geoleaf:boot:aborted");
        const failed = listen("geoleaf:boot:failed");
        const ctx = makeCtx(async (adapter, _cfg, opts) => {
            registerBootMap(adapter, "boot-destroyed-3");
            opts.onModuleError({ id: "ui", error: new Error("boom"), skipped: [] });
        });

        await bootWithPreset(PRESET, ctx);

        expect(aborted).toHaveLength(0);
        expect(failed[0]).toMatchObject({ reason: "module", module: "ui" });
    });
});
