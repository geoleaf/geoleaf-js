/**
 * Witness — `boot({ maplibregl })` hands the engine over, and a missing one is NAMED.
 *
 * ## What this file pins
 *
 * MapLibre 6 is ESM-only and no longer sets `globalThis.maplibregl`: every integrator had to
 * write `Object.assign(globalThis, { maplibregl })` before booting, and forgetting it failed
 * the boot with `reason: "map"` — the same answer as a missing container. The engine now travels
 * as a boot option, and the core puts it where its readers look for it: the global, which the
 * adapter, the markers, the popups and the PMTiles protocol read.
 *
 * Seen RED before the option existed: the registry read an engine that was never installed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { bootWithPreset } = await import("../../src/app/boot-core.ts");
const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");

type Preset = Parameters<typeof bootWithPreset>[0];
type Ctx = Parameters<typeof bootWithPreset>[1];

const globals = globalThis as unknown as Record<string, unknown>;
const saved = globals["maplibregl"];

/** A BootContext whose registry records the engine it would build the map with. */
function makeCtx(seen: unknown[]) {
    const AppLog = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const GeoLeaf = {
        loadConfig: (opts: { onLoaded: (c: unknown) => void }) => {
            setTimeout(() => opts.onLoaded({}), 0);
        },
        Config: { loadActiveProfileResources: vi.fn(() => Promise.resolve(null)) },
    };
    const registry = {
        register: vi.fn(),
        isInitialized: vi.fn(() => false),
        init: vi.fn(() => {
            seen.push(globals["maplibregl"]);
            return Promise.resolve();
        }),
        getAll: vi.fn(() => []),
    };
    const app = { AppLog, getProfilesBasePath: () => "../profiles/", _appStarted: false };
    return { ctx: { GeoLeaf, app, registry } as unknown as Ctx, AppLog };
}

const PRESET = { id: "engine-option", capabilities: [] } as unknown as Preset;

beforeEach(() => {
    CapabilityRegistry._reset();
    sessionStorage.clear();
    delete globals["maplibregl"];
});

afterEach(() => {
    if (saved === undefined) delete globals["maplibregl"];
    else globals["maplibregl"] = saved;
});

describe("boot({ maplibregl })", () => {
    it("🛑 installs the engine it is handed, before the map is built", async () => {
        const engine = { Map: class {} };
        const seen: unknown[] = [];
        const { ctx } = makeCtx(seen);

        await bootWithPreset(PRESET, ctx, { watchdogMs: 0, maplibregl: engine as never });

        expect(seen).toEqual([engine]);
        expect(globals["maplibregl"]).toBe(engine);
    });

    it("a different engine already on the global is replaced, and the replacement is named", async () => {
        const previous = { Map: class {} };
        const engine = { Map: class {} };
        globals["maplibregl"] = previous;
        const seen: unknown[] = [];
        const { ctx, AppLog } = makeCtx(seen);

        await bootWithPreset(PRESET, ctx, { watchdogMs: 0, maplibregl: engine as never });

        expect(seen).toEqual([engine]);
        expect(AppLog.warn).toHaveBeenCalledWith(expect.stringContaining("maplibregl"));
    });

    it("without the option, the global is read as before", async () => {
        const engine = { Map: class {} };
        globals["maplibregl"] = engine;
        const seen: unknown[] = [];
        const { ctx } = makeCtx(seen);

        await bootWithPreset(PRESET, ctx, { watchdogMs: 0 });

        expect(seen).toEqual([engine]);
    });
});
