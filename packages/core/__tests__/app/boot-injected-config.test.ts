/**
 * Witness — an injected configuration must not cost a single network request.
 *
 * ## What this witness is for
 *
 * `bootWithPreset()` builds its configuration URL unconditionally (`boot-core.ts`)
 * and hands it to `GeoLeaf.loadConfig`. A host that already holds the configuration in
 * memory has no way to say so: it must let the boot fetch a path that, under a host router,
 * may answer the router's own HTML in HTTP 200. This file pins the contract that removes
 * that trip — `boot({ config })` applies the object and touches the network zero times.
 *
 * 🛑 **RED on purpose until the third parameter exists.** `bootWithPreset(preset, ctx)` takes
 * two arguments today, so the options bag below is silently dropped and the fetch happens.
 * Seeing that red is the point: a guard never seen red guards nothing.
 *
 * ## The trap this harness exists to avoid
 *
 * `boot-core.test.js` stubs `GeoLeaf.loadConfig` with
 * `setTimeout(() => opts.onLoaded(cfg))`. Reusing it here would make this test pass
 * IMMEDIATELY and prove nothing — no `fetch` is reachable from that harness at all. So this
 * file wires the REAL chain instead:
 *
 *     GeoLeaf.loadConfig → APIInitializationManager.loadConfig → Config.init
 *                        → Config.loadUrl → ConfigLoader.loadUrl → fetch
 *
 * ## Scope, stated so it is not mistaken for more
 *
 * This witness covers the CONFIGURATION request only. `Config.loadActiveProfileResources`
 * is stubbed deliberately: its own requests are the subject of the next sprint, and letting
 * them run here would make this test fail for a reason it does not measure.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { bootWithPreset } = await import("../../src/app/boot-core.ts");
const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");
const { APIInitializationManager } = await import("../../src/kernel/api/initialization-manager.ts");
const { Config } = await import("../../src/kernel/config/geoleaf-config/config-loaders.ts");

/** A configuration an embedding application would hand over in memory. */
const INLINE_CONFIG = { app: { title: "Injected" }, map: { center: [4.85, 45.75], zoom: 12 } };

/**
 * A BootContext whose `loadConfig` is the real chain — not a stub.
 *
 * @param onFetch - Stand-in installed as `globalThis.fetch`.
 */
function makeRealCtx(onFetch: typeof globalThis.fetch) {
    const AppLog = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const manager = new APIInitializationManager();
    const getModule = (name) => (name === "Config" ? Config : null);

    const GeoLeaf = {
        loadConfig(opts: Record<string, (v: unknown) => void>) {
            manager
                .loadConfig(opts, getModule)
                .then((cfg: unknown) => opts.onLoaded?.(cfg))
                .catch((err: unknown) => opts.onError?.(err));
        },
        // Profile resources are out of this witness's scope — see the header.
        Config: { loadActiveProfileResources: vi.fn(() => Promise.resolve(null)) },
    };

    const registry = {
        register: vi.fn(),
        isInitialized: vi.fn(() => false),
        init: vi.fn(() => Promise.resolve()),
        getAll: vi.fn(() => []),
    };
    const app = { AppLog, getProfilesBasePath: () => "../profiles/", _appStarted: false };

    globalThis.fetch = onFetch;
    return { GeoLeaf, app, registry, AppLog };
}

const preset = (...capabilities: unknown[]) => ({ id: "witness", capabilities });

beforeEach(() => {
    CapabilityRegistry._reset();
    sessionStorage.clear();
});

afterEach(() => {
    delete globalThis.fetch;
    vi.restoreAllMocks();
});

describe("boot with an injected configuration", () => {
    it("touches the network zero times, and applies the object it was handed", async () => {
        const fetchSpy = vi.fn(() => {
            throw new Error(
                "WITNESS: boot fetched a configuration it was handed in memory — " +
                    "this is the request boot({ config }) exists to remove"
            );
        });
        const ctx = makeRealCtx(fetchSpy);

        // The third argument does not exist yet — that is what makes this red today.
        await bootWithPreset(preset(), ctx, { config: INLINE_CONFIG }).catch(() => {});

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(ctx.AppLog.log).toHaveBeenCalledWith(
            expect.stringContaining("Config loaded"),
            expect.objectContaining({ app: expect.objectContaining({ title: "Injected" }) })
        );
    });
});
