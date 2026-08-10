/**
 * Boot sequence order invariants — Sprint T11.1
 *
 * Tests that:
 *  T11.1.1 — boot.ts registers the 7 expected core modules in the registry
 *            before startApp() is called.
 *  T11.1.2 — GeoLeaf._registry and GeoLeaf.registry are exposed on the
 *            namespace after the boot module loads.
 *  T11.1.2 — The 'geoleaf:app:ready' DOM listener is registered by startApp().
 *  T11.1.3 — If a module's init() is missing (empty stub), the registry does
 *            not throw fatally — it resolves gracefully.
 *
 * Strategy: vi.mock() for all side-effect dependencies (globals, module classes),
 * await import() for boot.ts — ensures Istanbul instruments boot.ts branches.
 */

import { describe, expect, it, vi } from "vitest";

// ── Mocks — must be declared before import ────────────────────────────────────

// Simulated GeoLeaf global namespace
const mockGeoLeaf = {};

vi.mock("../../src/utils/general/geoleaf-global.js", () => ({
    ensureGeoLeaf: () => mockGeoLeaf,
    getGeoLeaf: () => mockGeoLeaf,
}));

// Stub the 6 core module classes (S6 Lot 6: `security` and `api` are gone — facade-only
// wrappers whose init()/destroy() had become empty).
//
// The `dependencies` below now MIRROR the real graph. They used to be arbitrary (`config`
// depended on `core-map`, `geojson` on `shared`, `ui` on `geojson` — none of which is true),
// which was harmless while the test only checked ids and counts, but made the file read as if
// it documented the graph. It does not: the real edges live on each `*.module.ts`, and the only
// machine-checked authority is `ModuleRegistry._topoSort()`.
vi.mock("../../src/app/boot-modules/core-map.module.js", () => ({
    CoreMapModule: class {
        id = "core-map";
        dependencies = ["config"];
        init = vi.fn().mockResolvedValue(undefined);
        destroy = vi.fn();
    },
}));
vi.mock("../../src/app/boot-modules/config.module.js", () => ({
    ConfigModule: class {
        id = "config";
        dependencies = [];
        init = vi.fn().mockResolvedValue(undefined);
        destroy = vi.fn();
    },
}));
vi.mock("../../src/app/boot-modules/shared.module.js", () => ({
    SharedModule: class {
        id = "shared";
        dependencies = ["config"];
        init = vi.fn().mockResolvedValue(undefined);
        destroy = vi.fn();
    },
}));
vi.mock("../../src/app/boot-modules/geojson.module.js", () => ({
    GeoJSONModule: class {
        id = "geojson";
        dependencies = ["config", "core-map"];
        init = vi.fn().mockResolvedValue(undefined);
        destroy = vi.fn();
    },
}));
vi.mock("../../src/app/boot-modules/ui.module.js", () => ({
    UIModule: class {
        id = "ui";
        dependencies = ["config", "core-map", "shared", "geojson"];
        init = vi.fn().mockResolvedValue(undefined);
        destroy = vi.fn();
    },
}));
vi.mock("../../src/app/boot-modules/theme-engine.module.js", () => ({
    ThemeEngineModule: class {
        id = "theme-engine";
        dependencies = ["geojson", "ui"];
        init = vi.fn().mockResolvedValue(undefined);
        destroy = vi.fn();
    },
}));

// Optional modules registered at startApp time (route, labels, etc.)
vi.mock("../../src/capabilities/route/module.js", () => ({
    RouteModule: class {
        id = "route";
        dependencies = [];
        init = vi.fn().mockResolvedValue(undefined);
        destroy = vi.fn();
    },
}));
vi.mock("../../src/capabilities/labels/module.js", () => ({
    LabelsModule: class {
        id = "labels";
        dependencies = [];
        init = vi.fn().mockResolvedValue(undefined);
        destroy = vi.fn();
    },
}));
vi.mock("../../src/capabilities/legend/module.js", () => ({
    LegendModule: class {
        id = "legend";
        dependencies = [];
        init = vi.fn().mockResolvedValue(undefined);
        destroy = vi.fn();
    },
}));
vi.mock("../../src/capabilities/theme-selector/module.js", () => ({
    ThemeSelectorModule: class {
        id = "theme-selector";
        dependencies = ["geojson"];
        init = vi.fn().mockResolvedValue(undefined);
        destroy = vi.fn();
    },
}));
vi.mock("../../src/app/module-registry.js", async () => {
    const real = await vi.importActual("../../src/app/module-registry.ts");
    return real;
});

// ── Dynamic import — Istanbul instruments boot.ts ──────────────────────────────
await import("../../src/app/boot.ts");

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("boot.ts — boot sequence order invariants (T11)", () => {
    // ── T11.1.1/T11.1.2 — Registry setup at module-init time ──────────────────

    describe("ModuleRegistry setup (B1→B11 contract)", () => {
        it("exposes GeoLeaf._registry after boot module loads", () => {
            expect(mockGeoLeaf._registry).toBeDefined();
        });

        it("exposes GeoLeaf.registry (public API) after boot module loads", () => {
            expect(mockGeoLeaf.registry).toBeDefined();
            expect(mockGeoLeaf._registry).toBe(mockGeoLeaf.registry);
        });

        // S6 Lot 6 — 6 kernel modules, down from 8. `security` and `api` are gone: their
        // init()/destroy() had become empty once phase A posted their facades at import, so
        // they carried a graph node and nothing else. This is a BREAKING change of an
        // observable surface (`GeoLeaf.registry.getAll()`, Introspection) — updated on purpose.
        it("registry contains the 6 expected core modules", () => {
            const registry = mockGeoLeaf._registry;
            const expectedIds = ["core-map", "config", "shared", "geojson", "ui", "theme-engine"];
            for (const id of expectedIds) {
                expect(registry.has(id)).toBe(true);
            }
        });

        it("registry no longer holds the facade-only modules removed in S6", () => {
            // Guards the intent: if either comes back, it should be a deliberate decision,
            // not a merge accident.
            expect(mockGeoLeaf._registry.has("security")).toBe(false);
            expect(mockGeoLeaf._registry.has("api")).toBe(false);
        });

        it("registry has() returns false for unknown module ids", () => {
            expect(mockGeoLeaf._registry.has("__not_registered__")).toBe(false);
        });

        it("registry getAll() returns exactly 6 core modules", () => {
            expect(mockGeoLeaf._registry.getAll()).toHaveLength(6);
        });
    });

    // ── T11.1.2 — geoleaf:app:ready listener registered by startApp ───────────

    describe("'geoleaf:app:ready' event contract", () => {
        it("addEventListener for 'geoleaf:app:ready' is registered when startApp runs", async () => {
            const addSpy = vi.spyOn(document, "addEventListener");
            mockGeoLeaf._app = mockGeoLeaf._app || {};
            mockGeoLeaf._app.AppLog = {
                info: vi.fn(),
                error: vi.fn(),
                warn: vi.fn(),
                log: vi.fn(),
            };
            mockGeoLeaf._app.getProfilesBasePath = vi.fn(() => "/profiles/");

            // startApp() returns early (loadConfig not defined) but the
            // app:ready listener is registered before the early-return guard
            // only if loadConfig is present — test the listener path via
            // a minimal stub
            mockGeoLeaf.loadConfig = vi.fn((opts) => {
                // Simulate synchronous reject — triggers rejection path
                setTimeout(() => opts.onError?.(new Error("test")), 0);
            });

            try {
                await mockGeoLeaf._app.startApp?.();
            } catch {
                // Expected — focus is on listener registration, not full boot
            }

            const callArgs = addSpy.mock.calls.map(([evt]) => evt);
            expect(callArgs).toContain("geoleaf:app:ready");
            addSpy.mockRestore();
        });

        it("dispatching 'geoleaf:app:ready' triggers bootInfo.show when present", () => {
            const showFn = vi.fn();
            mockGeoLeaf.bootInfo = { show: showFn };

            document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));

            // bootInfo.show called with GeoLeaf — listener registered { once: true }
            expect(showFn).toHaveBeenCalledWith(mockGeoLeaf);

            // Cleanup — remove the show stub
            delete mockGeoLeaf.bootInfo;
        });
    });

    // ── T11.1.3 — Resilience: module init() stub (no-op) doesn't throw ────────

    describe("T11.1.3 — resilience: module with no-op init does not crash registry", () => {
        it("registry.init() resolves when all modules have no-op init()", async () => {
            // The mocked module stubs all have init = vi.fn().mockResolvedValue(undefined)
            await expect(mockGeoLeaf._registry.init({}, {})).resolves.toBeUndefined();
        });

        it("registry.init() is idempotent — second call is safe (no-op)", async () => {
            // Already initialized by previous test — second call should not throw
            await expect(mockGeoLeaf._registry.init({}, {})).resolves.toBeUndefined();
        });
    });
});
