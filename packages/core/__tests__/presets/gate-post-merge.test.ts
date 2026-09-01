/**
 * GATE — a profile must be able to TURN ON a capability.
 *
 * ## The defect, as it measures
 *
 * `bootWithPreset()` evaluates Pass 2 (`registerPresetModules`) on
 * `toCapConfig(baseCfg)`, i.e. the config **BEFORE**
 * `loadActiveProfileResources()` has returned the profile's
 * (`boot-core.ts` — Pass 2 then, further down, `effectiveCfg`). A profile
 * writing `modules.branding.enabled: true` thus arrives too late: when the
 * gate is read, the key is absent, `enableWhenAbsent` is `false`, and the
 * module is never created.
 *
 * The consequence is the one that counts for an integrator: **the profile
 * is the product's documented configuration surface, and it cannot turn on
 * what it describes.**
 *
 * ## Why `branding` and not another
 *
 * Not an example picked for demonstration, the only possible subject —
 * surveyed at the 07/08/2026 preflight over the repo's 20 gates:
 *
 *   - 17 capabilities are **opt-out** (`enableWhenAbsent: true`): absent ⟹
 *     on. The defect does not keep them from turning on, it keeps them from
 *     being turned OFF from a profile.
 *   - 3 are **opt-in**: `branding`, `offline`, `pwa`.
 *   - `offline` and `pwa` have **no** `createModule` — their TSDoc says so
 *     in full. They are app-global and already gate **post-merge**, in
 *     `SharedModule.init()`.
 *
 * `branding` remains: the only opt-in capability owning an `ICoreModule`,
 * hence the repo's only place where "the profile turns on" was without effect.
 *
 * ## What this file does NOT allow
 *
 * ⛔ It does not ask to move Pass 2 under `loadActiveProfileResources()`.
 * `app/boot-core.ts`'s TSDoc carries the prohibition, and notes an earlier
 * sprint had to revert that zone. The gesture is to **remove a condition** —
 * register the module in all cases, and let a wrapper decide in its
 * `init()`, which runs post-merge.
 *
 * @see packages/core/src/app/boot-core.ts — the pass order, and why it does not move
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { ICapabilityConfigGate } from "../../src/contracts/capability.contract.js";
import type { ICoreModule } from "../../src/contracts/core-module.contract.js";
import type { PresetManifest } from "../../src/contracts/preset.contract.js";

const { bootWithPreset } = await import("../../src/app/boot-core.ts");
const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");

/**
 * An instrumented installer.
 *
 * ⚠️ `initCalls` is not part of the `ICapabilityInstaller` contract — it is
 * this file's only observation channel, and it is declared rather than
 * attached on the fly so its disappearance is a type error and not a
 * silently empty test.
 */
interface InstrumentedInstaller {
    declaration: { id: string; gate?: ICapabilityConfigGate };
    registerGlobals: ReturnType<typeof vi.fn>;
    createModule: ReturnType<typeof vi.fn>;
    /** The configs received by each `init()` — empty = the module did not run. */
    initCalls: unknown[];
}

/** The stand-in registry, with its ids exposed for the assertion. */
interface StandInRegistry {
    modules: ICoreModule[];
    register: ReturnType<typeof vi.fn>;
    isInitialized: ReturnType<typeof vi.fn>;
    init: ReturnType<typeof vi.fn>;
    getAll: ReturnType<typeof vi.fn>;
    ids(): string[];
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * A minimal installer, whose module RECORDS its `init()` call.
 *
 * `boot-core.test.js` carries the same fixture in shorter form; here the
 * module must be observable into its lifecycle, because the question asked
 * is not only "was it registered" but "did it run, and on which config".
 *
 * @param id Capability identifier.
 * @param gate Declaration gate. Omitted ⟹ ungated capability (always active).
 */
function makeInstaller(id: string, gate?: ICapabilityConfigGate): InstrumentedInstaller {
    const initCalls: unknown[] = [];
    return {
        declaration: gate ? { id, gate } : { id },
        registerGlobals: vi.fn(),
        initCalls,
        createModule: vi.fn(() => ({
            id,
            dependencies: [],
            init: vi.fn((_adapter: unknown, cfg: unknown) => {
                initCalls.push(cfg);
            }),
        })),
    };
}

/**
 * A stand-in ModuleRegistry that really INITIALISES its modules.
 *
 * `boot-core.test.js`'s stand-in stubs `init()`; it could not tell
 * "registered module" from "module that ran". Here the two must be
 * separable: the wrapper ALWAYS registers, and `init()` decides.
 */
function makeRegistry(): StandInRegistry {
    const modules: ICoreModule[] = [];
    return {
        modules,
        register: vi.fn((m: ICoreModule) => modules.push(m)),
        isInitialized: vi.fn(() => false),
        init: vi.fn(async (adapter: unknown, cfg: unknown) => {
            for (const m of modules) {
                await (m.init as ((a: unknown, c: unknown) => unknown) | undefined)?.(adapter, cfg);
            }
        }),
        getAll: vi.fn(() => modules),
        /** The registered ids, in order. */
        ids: () => modules.map((m) => m.id),
    };
}

/**
 * Assembles a BootContext explicitly separating the two configs.
 *
 * @param cfg What `GeoLeaf.loadConfig` returns — the **pre-merge** config (`baseCfg`).
 * @param profileCfg What `Config.loadActiveProfileResources` returns — the **post-merge**.
 */
function makeCtx(cfg: Record<string, unknown>, profileCfg: Record<string, unknown> | null) {
    const AppLog = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const GeoLeaf = {
        loadConfig: (opts: { onLoaded: (c: unknown) => void }) =>
            setTimeout(() => opts.onLoaded(cfg), 0),
        Config: {
            loadActiveProfileResources: vi.fn(() => Promise.resolve(profileCfg ?? null)),
        },
    };
    const registry = makeRegistry();
    const app = { AppLog, getProfilesBasePath: () => "../profiles/", _appStarted: false };
    return { GeoLeaf, app, registry, AppLog };
}

const preset = (...capabilities: InstrumentedInstaller[]) =>
    ({ id: "gate-post-merge", capabilities }) as unknown as PresetManifest;

/** `branding`'s real gate: opt-in, `enableWhenAbsent` omitted ⟹ absent = off. */
const BRANDING_GATE: ICapabilityConfigGate = { configPath: "modules.branding.enabled" };

beforeEach(() => {
    // Module singleton: declarations would leak from one test to the next.
    CapabilityRegistry._reset();
    sessionStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── The gate ──────────────────────────────────────────────────────────────────

describe("GATE 9.2 — le profil décide, et il décide APRÈS la Pass 2", () => {
    it("allume une capacité opt-in que SEUL le profil active", async () => {
        const branding = makeInstaller("branding", BRANDING_GATE);
        // Pre-merge: nothing. Post-merge: the profile turns it on. The whole subject.
        const ctx = makeCtx({}, { modules: { branding: { enabled: true } } });

        await bootWithPreset(preset(branding), ctx);

        expect(ctx.registry.ids()).toContain("branding");
        expect(branding.initCalls).toHaveLength(1);
        // And it did receive the PROFILE's config, not the empty pre-merge —
        // otherwise the module would exist still reading a state prior to
        // what turned it on.
        expect(branding.initCalls[0]).toMatchObject({
            modules: { branding: { enabled: true } },
        });
    });

    it("laisse éteint ce qu'aucune des deux configs n'allume", async () => {
        const branding = makeInstaller("branding", BRANDING_GATE);
        const ctx = makeCtx({}, { modules: {} });

        await bootWithPreset(preset(branding), ctx);

        expect(branding.initCalls).toHaveLength(0);
    });

    it("laisse le pré-merge allumer, quand c'est lui qui porte la clé", async () => {
        // Counter-proof: the fix must not merely move the blindness. A key
        // present BEFORE the profile stays valid if the profile does not
        // contradict it.
        const branding = makeInstaller("branding", BRANDING_GATE);
        const ctx = makeCtx({ modules: { branding: { enabled: true } } }, null);

        await bootWithPreset(preset(branding), ctx);

        expect(branding.initCalls).toHaveLength(1);
    });
});

// ── Characterisation: the INVERSE direction ───────────────────────────────────
//
// ⚠️ This block is not a request, it is a record. The fix evaluates the gate
// on the merged config, so it also acts the other way: a profile writing
// `false` on an opt-out capability stops being ignored. Consistent with the
// gate's declared semantics (`value false → disabled`), and a real
// BEHAVIOUR CHANGE.
//
// It is written here to be visible and dated, rather than discovered later
// as a regression. `boot-core.ts` warns against migrating Pass 2 for this
// precise reason — but its warning bears on DE-REGISTERING a late-gated
// module, not on not initialising it.

describe("caractérisation — un profil qui ÉTEINT une capacité opt-out", () => {
    it("relève le comportement courant, quel qu'il soit", async () => {
        const legend = makeInstaller("legend", {
            configPath: "modules.legend.enabled",
            enableWhenAbsent: true,
        });
        const ctx = makeCtx({}, { modules: { legend: { enabled: false } } });

        await bootWithPreset(preset(legend), ctx);

        // Before: the module is registered AND initialised — the profile's
        // `false` arrives after Pass 2, so the gate never reads it.
        // After: the wrapper rereads the gate post-merge and does not initialise.
        expect(ctx.registry.ids()).toContain("legend");
        expect(legend.initCalls.length).toBe(0);
    });
});
