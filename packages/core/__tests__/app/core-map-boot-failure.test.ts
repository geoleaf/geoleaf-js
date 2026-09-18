/**
 * Witness — a map that cannot be built is signalled, and a missing WebGL2 is NAMED.
 *
 * ## What this file pins
 *
 * `CoreMapLifecycle.init` used to return on a missing extent, or on a null map, with a log
 * line: the veil stayed up and nothing said why. MapLibre 6 throws `GPUInitializationError`
 * when `getContext("webgl2")` fails, and `kernel/map/facade.ts` reduced it to `null` — so the
 * one failure a user can act on (turn hardware acceleration back on, change browser) was
 * indistinguishable from any other. Each case below was seen RED on that code.
 *
 * `GeoLeaf.init` is played by a stand-in that behaves like the facade: the adapter builds the
 * map, and a throw becomes `null`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { CoreMapLifecycle } = await import("../../src/app/boot-modules/core-map-lifecycle.ts");
const { MaplibreAdapter } = await import("../../src/adapters/maplibre/maplibre-adapter.ts");
const { beginBoot } = await import("../../src/app/boot-failure.ts");
const { ensureGeoLeaf } = await import("../../src/utils/general/geoleaf-global.ts");

type Adapter = InstanceType<typeof MaplibreAdapter>;
type MapConfig = Parameters<typeof CoreMapLifecycle.init>[1];

const GeoLeaf = ensureGeoLeaf() as unknown as Record<string, unknown>;
const globals = globalThis as unknown as Record<string, unknown>;
const saved = { app: GeoLeaf["_app"], init: GeoLeaf["init"], maplibregl: globals["maplibregl"] };

const disposers: (() => void)[] = [];

/** Collects the details of `geoleaf:boot:failed` until the test ends. */
function listenFailed(): unknown[] {
    const details: unknown[] = [];
    const handler = (event: Event) => details.push((event as CustomEvent).detail);
    document.addEventListener("geoleaf:boot:failed", handler);
    disposers.push(() => document.removeEventListener("geoleaf:boot:failed", handler));
    return details;
}

/** `GeoLeaf.init` as the facade behaves: the adapter builds the map, a throw becomes `null`. */
function facadeInit(opts: { _adapter: Adapter }): Adapter | null {
    try {
        opts._adapter.init({ container: document.createElement("div") } as never);
        return opts._adapter;
    } catch {
        return null;
    }
}

/** A MapLibre global whose `Map` constructor throws `error`. */
function throwingMaplibre(error: Error, extra: Record<string, unknown> = {}): void {
    globals["maplibregl"] = {
        ...extra,
        Map: class {
            constructor() {
                throw error;
            }
        },
    };
}

const WITH_EXTENT = { map: { center: [45, 5], zoom: 6 } } as unknown as MapConfig;

beforeEach(() => {
    // The first terminal failure wins for a whole boot, so each case starts a boot of its own —
    // with no watchdog, which these cases do not exercise.
    beginBoot({ watchdogMs: 0 });
    GeoLeaf["_app"] = { AppLog: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    GeoLeaf["init"] = facadeInit;
});

afterEach(() => {
    while (disposers.length > 0) disposers.pop()?.();
    GeoLeaf["_app"] = saved.app;
    GeoLeaf["init"] = saved.init;
    globals["maplibregl"] = saved.maplibregl;
});

describe("CoreMapLifecycle — a map that cannot be built", () => {
    it("a profile without a map extent → geoleaf:boot:failed (map)", () => {
        const failed = listenFailed();

        CoreMapLifecycle.init(new MaplibreAdapter(), { map: {} } as unknown as MapConfig);

        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({ reason: "map", phase: "map", provisional: false });
    });

    it("MapLibre's GPUInitializationError, recognised by name → geoleaf:boot:failed (webgl)", () => {
        throwingMaplibre(
            Object.assign(new Error("WebGL2 is required to display this map."), {
                name: "GPUInitializationError",
            })
        );
        const failed = listenFailed();

        CoreMapLifecycle.init(new MaplibreAdapter(), WITH_EXTENT);

        expect(failed[0]).toMatchObject({ reason: "webgl", phase: "map" });
    });

    it("recognised by CLASS when MapLibre exposes it — whatever the error's name", () => {
        class GPUInitializationError extends Error {}
        throwingMaplibre(new GPUInitializationError("no context"), { GPUInitializationError });
        const failed = listenFailed();

        CoreMapLifecycle.init(new MaplibreAdapter(), WITH_EXTENT);

        expect(failed[0]).toMatchObject({ reason: "webgl" });
    });

    it("any other construction error stays reason map, and keeps its message", () => {
        throwingMaplibre(new Error('Container "geoleaf-map" not found.'));
        const failed = listenFailed();

        CoreMapLifecycle.init(new MaplibreAdapter(), WITH_EXTENT);

        expect(failed[0]).toMatchObject({
            reason: "map",
            message: expect.stringContaining("not found"),
        });
    });
});
