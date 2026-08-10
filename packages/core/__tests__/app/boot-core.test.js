/**
 * Unit tests — app/boot-core.ts (presets build, S3).
 *
 * `bootWithPreset()` is the boot SEQUENCE, extracted from `boot.ts#startApp` and
 * parameterised by a preset manifest. Because it takes its collaborators through a
 * context bag instead of reaching for globals, it can be driven directly — no
 * `GeoLeaf.*` namespace to stand up, no B1→B11 chain to import. That is the point
 * of the extraction, and this file is what it buys.
 *
 * `boot.test.js` still covers the module-eval half (the `GeoLeaf.boot()` facade, the
 * kernel registrations, the `?perf=1` latch), and `boot-golden-master.test.js` remains
 * the 0-regression oracle over the real chain.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { bootWithPreset } = await import("../../src/app/boot-core.ts");
const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * A minimal CapabilityInstaller.
 *
 * @param id Capability id.
 * @param opts.gate Declaration gate (absent → ungated → always enabled).
 * @param opts.withModule Whether the installer owns a lifecycle module.
 */
function makeInstaller(id, { gate, withModule = true } = {}) {
    const inst = {
        declaration: gate ? { id, gate } : { id },
        registerGlobals: vi.fn((gl) => {
            gl[`_${id}`] = true;
        }),
    };
    if (withModule) {
        inst.createModule = vi.fn(() => ({ id, dependencies: [] }));
    }
    return inst;
}

/** A recording stand-in for the kernel ModuleRegistry. */
function makeRegistry() {
    const registered = [];
    return {
        registered,
        register: vi.fn((m) => registered.push(m.id)),
        isInitialized: vi.fn(() => false),
        init: vi.fn(() => Promise.resolve()),
        getAll: vi.fn(() => registered.map((id) => ({ id }))),
    };
}

/**
 * Assembles a BootContext.
 *
 * @param opts.cfg Config resolved by `GeoLeaf.loadConfig` (the pre-merge baseCfg).
 * @param opts.profileCfg Config resolved by `Config.loadActiveProfileResources`.
 * @param opts.withConfig `false` → no `GeoLeaf.Config` at all (integrator without a profile).
 * @param opts.loadConfig `null` → `GeoLeaf.loadConfig` absent (early-return path).
 */
function makeCtx({ cfg = {}, profileCfg, withConfig = true, loadConfig } = {}) {
    const AppLog = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const GeoLeaf = {};

    if (loadConfig !== null) {
        GeoLeaf.loadConfig = loadConfig ?? ((opts) => setTimeout(() => opts.onLoaded(cfg), 0));
    }
    if (withConfig) {
        GeoLeaf.Config = {
            loadActiveProfileResources: vi.fn(() =>
                Promise.resolve(profileCfg === undefined ? null : profileCfg)
            ),
        };
    }

    const registry = makeRegistry();
    const app = {
        AppLog,
        getProfilesBasePath: () => "../profiles/",
        _appStarted: false,
    };
    return { GeoLeaf, app, registry, AppLog };
}

const preset = (...capabilities) => ({ id: "tourisme-full", capabilities });

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    // CapabilityRegistry is a module singleton — declarations would leak between tests.
    CapabilityRegistry._reset();
    sessionStorage.clear();
});

afterEach(() => {
    delete window.__GEOLEAF_PERF__;
    vi.restoreAllMocks();
});

// ── Early returns ─────────────────────────────────────────────────────────────

describe("bootWithPreset — early returns", () => {
    it("aborts when GeoLeaf.loadConfig is absent", async () => {
        const ctx = makeCtx({ loadConfig: null });

        await bootWithPreset(preset(), ctx);

        expect(ctx.AppLog.error).toHaveBeenCalledWith(expect.stringContaining("loadConfig"));
        expect(ctx.registry.init).not.toHaveBeenCalled();
        expect(ctx.app._appStarted).toBe(false);
    });

    it("ignores a second boot call (double-boot guard)", async () => {
        const ctx = makeCtx();
        ctx.app._appStarted = true;

        await bootWithPreset(preset(), ctx);

        expect(ctx.AppLog.warn).toHaveBeenCalledWith(expect.stringContaining("already started"));
        expect(ctx.registry.init).not.toHaveBeenCalled();
    });

    it("aborts when loadConfig reports an error", async () => {
        const ctx = makeCtx({
            loadConfig: (opts) => setTimeout(() => opts.onError(new Error("404")), 0),
        });

        await bootWithPreset(preset(), ctx);

        expect(ctx.AppLog.error).toHaveBeenCalledWith(
            expect.stringContaining("Error loading config"),
            expect.any(Error)
        );
        expect(ctx.registry.init).not.toHaveBeenCalled();
    });
});

// ── Preset composition (the 2 passes) ─────────────────────────────────────────

describe("bootWithPreset — preset composition", () => {
    it("boots the kernel alone on an empty preset", async () => {
        const ctx = makeCtx();

        await bootWithPreset(preset(), ctx);

        expect(ctx.registry.register).not.toHaveBeenCalled();
        expect(CapabilityRegistry.getAllSchemas()).toEqual([]);
        expect(ctx.registry.init).toHaveBeenCalledTimes(1);
    });

    it("registers the declaration AND the module of an enabled capability", async () => {
        const on = makeInstaller("labels", {
            gate: { configPath: "modules.labels.enabled", enableWhenAbsent: true },
        });
        const ctx = makeCtx();

        await bootWithPreset(preset(on), ctx);

        expect(on.registerGlobals).toHaveBeenCalledWith(ctx.GeoLeaf);
        expect(ctx.GeoLeaf._labels).toBe(true);
        expect(CapabilityRegistry.getAllSchemas().map((s) => s.id)).toEqual(["labels"]);
        expect(ctx.registry.registered).toEqual(["labels"]);
    });

    // ⚠️ Ces deux tests affirmaient l'inverse jusqu'à socle-init 9.2 — « registers the
    // declaration but NOT the module of a gated-off capability » et « honours an explicit
    // `false` in the pre-merge config » (par NON-enregistrement). Ils encodaient l'observable
    // de l'ancien mécanisme, pas la propriété : Pass 2 filtrait, donc un module éteint
    // n'existait pas. Il existe désormais, et c'est son `init()` qui ne fait rien.
    //
    // La propriété protégée — « une capacité éteinte ne TOURNE pas » — n'a pas bougé ; elle
    // s'observe ailleurs, et c'est `__tests__/presets/gate-post-merge.test.js` qui la tient,
    // avec un registre de substitution qui initialise réellement ses modules (celui d'ici
    // stube `init()`, il ne pourrait pas la voir).
    it("registers the module of a gated-off capability, gate DEFERRED to init()", async () => {
        // Pass 1 reste ungated par conception (introspection + façade doivent exister dans
        // les deux cas). Ce qui change en 9.2, c'est que Pass 2 ne tranche plus non plus.
        const off = makeInstaller("branding", {
            gate: { configPath: "modules.branding.enabled", enableWhenAbsent: false },
        });
        const ctx = makeCtx({ cfg: {} }); // clé absente en pré-merge

        await bootWithPreset(preset(off), ctx);

        expect(off.registerGlobals).toHaveBeenCalled();
        expect(CapabilityRegistry.getAllSchemas().map((s) => s.id)).toEqual(["branding"]);
        expect(off.createModule).toHaveBeenCalledTimes(1);
        expect(ctx.registry.registered).toEqual(["branding"]);

        // Et le verdict n'est pas rendu : l'enrobage l'expose, et il vaut `false` tant que
        // `init()` n'a pas tourné. C'est ce report qui permet au profil d'avoir son mot à dire.
        const [registered] = ctx.registry.register.mock.calls[0];
        expect(typeof registered.isEnabled).toBe("function");
        expect(registered.isEnabled()).toBe(false);
    });

    it("registers a capability the pre-merge config switches off, and lets init() decide", async () => {
        const off = makeInstaller("legend", {
            gate: { configPath: "modules.legend.enabled", enableWhenAbsent: true },
        });
        const ctx = makeCtx({ cfg: { modules: { legend: { enabled: false } } } });

        await bootWithPreset(preset(off), ctx);

        expect(ctx.registry.registered).toEqual(["legend"]);

        // Le `false` est bien lu — mais par l'enrobage, au moment où on l'initialise.
        const [registered] = ctx.registry.register.mock.calls[0];
        await registered.init({}, { modules: { legend: { enabled: false } } });
        expect(registered.isEnabled()).toBe(false);
    });

    it("contributes no module for a pull-based capability (no createModule)", async () => {
        // The `taxonomy` / `cluster` shape: facade + declaration, no lifecycle module.
        const pull = makeInstaller("taxonomy", { withModule: false });
        const ctx = makeCtx();

        await bootWithPreset(preset(pull), ctx);

        expect(ctx.GeoLeaf._taxonomy).toBe(true);
        expect(CapabilityRegistry.getAllSchemas().map((s) => s.id)).toEqual(["taxonomy"]);
        expect(ctx.registry.registered).toEqual([]);
    });

    it("skips Pass 2 when the registry is already initialised", async () => {
        const on = makeInstaller("labels");
        const ctx = makeCtx();
        ctx.registry.isInitialized = vi.fn(() => true);

        await bootWithPreset(preset(on), ctx);

        // Pass 1 still runs (facades + introspection), Pass 2 does not.
        expect(on.registerGlobals).toHaveBeenCalled();
        expect(on.createModule).not.toHaveBeenCalled();
    });
});

// ── Config merge → what the modules actually receive ──────────────────────────

describe("bootWithPreset — effective config", () => {
    it("passes the merged profile config to registry.init()", async () => {
        const merged = { modules: { taxonomy: { enabled: true } } };
        const ctx = makeCtx({ cfg: { debug: false }, profileCfg: merged });

        await bootWithPreset(preset(), ctx);

        expect(ctx.GeoLeaf.Config.loadActiveProfileResources).toHaveBeenCalledTimes(1);
        expect(ctx.registry.init).toHaveBeenCalledWith(expect.anything(), merged);
    });

    it("falls back to the pre-merge config when there is no profile loader", async () => {
        const base = { debug: true };
        const ctx = makeCtx({ cfg: base, withConfig: false });

        await bootWithPreset(preset(), ctx);

        expect(ctx.registry.init).toHaveBeenCalledWith(expect.anything(), base);
    });

    it("falls back to the pre-merge config when profile loading throws", async () => {
        const base = { debug: true };
        const ctx = makeCtx({ cfg: base });
        ctx.GeoLeaf.Config.loadActiveProfileResources = vi.fn(() =>
            Promise.reject(new Error("network"))
        );

        await bootWithPreset(preset(), ctx);

        expect(ctx.AppLog.warn).toHaveBeenCalledWith(
            expect.stringContaining("Error loading profile resources"),
            expect.any(Error)
        );
        expect(ctx.registry.init).toHaveBeenCalledWith(expect.anything(), base);
    });
});

// ── beforeBoot hook ───────────────────────────────────────────────────────────

describe("bootWithPreset — beforeBoot hook", () => {
    it("receives the merged config and lets the boot proceed", async () => {
        const merged = { data: { activeProfile: "tourism" } };
        const ctx = makeCtx({ profileCfg: merged });
        const seen = [];
        ctx.GeoLeaf._beforeBootCallback = vi.fn(({ config }) => {
            seen.push(config);
        });

        await bootWithPreset(preset(), ctx);

        expect(seen).toEqual([merged]);
        expect(ctx.registry.init).toHaveBeenCalledTimes(1);
    });

    it("aborts the boot and emits geoleaf:boot:aborted when the hook throws", async () => {
        const ctx = makeCtx();
        const reason = new Error("not authenticated");
        ctx.GeoLeaf._beforeBootCallback = vi.fn(() => {
            throw reason;
        });
        const onAborted = vi.fn();
        document.addEventListener("geoleaf:boot:aborted", onAborted, { once: true });

        await bootWithPreset(preset(), ctx);

        expect(onAborted).toHaveBeenCalledTimes(1);
        expect(onAborted.mock.calls[0][0].detail).toEqual({ reason });
        expect(ctx.registry.init).not.toHaveBeenCalled();
    });
});

// ── Registry handover ─────────────────────────────────────────────────────────

describe("bootWithPreset — registry handover", () => {
    it("logs a registry init() failure instead of throwing", async () => {
        const ctx = makeCtx();
        ctx.registry.init = vi.fn(() => Promise.reject(new Error("boom")));

        await expect(bootWithPreset(preset(), ctx)).resolves.toBeUndefined();

        expect(ctx.AppLog.warn).toHaveBeenCalledWith(
            expect.stringContaining("init() failed"),
            expect.any(Error)
        );
    });
});

// ── Perf marks ────────────────────────────────────────────────────────────────

describe("bootWithPreset — perf marks", () => {
    it("emits the 6 geoleaf:boot:* marks in order when the perf latch is on", async () => {
        window.__GEOLEAF_PERF__ = true;
        const marks = [];
        vi.spyOn(performance, "mark").mockImplementation((name) => {
            marks.push(name);
            return undefined;
        });

        await bootWithPreset(preset(), makeCtx({ profileCfg: {} }));

        expect(marks.filter((m) => String(m).startsWith("geoleaf:boot:"))).toEqual([
            "geoleaf:boot:loadConfig:start",
            "geoleaf:boot:loadConfig:end",
            "geoleaf:boot:profileResources:start",
            "geoleaf:boot:profileResources:end",
            "geoleaf:boot:registry:start",
            "geoleaf:boot:registry:end",
        ]);
    });

    it("emits no mark when the perf latch is off", async () => {
        const marks = [];
        vi.spyOn(performance, "mark").mockImplementation((name) => {
            marks.push(name);
            return undefined;
        });

        await bootWithPreset(preset(), makeCtx());

        expect(marks.filter((m) => String(m).startsWith("geoleaf:boot:"))).toEqual([]);
    });
});
