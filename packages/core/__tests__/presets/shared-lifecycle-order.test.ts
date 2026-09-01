/**
 * SLO — the POSITION of `pwa` and `offline` in the manifest decides nothing.
 *
 * ## What this file settles
 *
 * The repo asserted, over **20 sites across 13 files**, that the order
 * `pwa` (#7) then `offline` (#8) in `presets/manifest.full.ts` is
 * *load-bearing*. Its strongest wording, `specs/capacites/pwa.md`, went as
 * far as: "**Inverting the two would keep the offline engine from
 * starting.**" No test exercised it.
 *
 * **It is false, and this file measures it.» The coupling is
 * CONFIGURATIONAL, not ordinal:
 *
 *   - `offline/install.ts` reads `config.modules.pwa.enabled` from the
 *     **merged bag** `SharedModule.init()` hands it — not a state set by
 *     `PwaLifecycle`;
 *   - `GeoLeaf.Storage` and `GeoLeaf._OfflineDetector` are set **at
 *     import**, in phase A by `globals/globals.storage.ts`, hence well
 *     before either;
 *   - and the only effect `pwa` would produce before `offline` — the
 *     service worker's registration — is in any case **deferred** by
 *     `Helpers.lazyExecute` (3 s cap). Even in nominal order, it has not
 *     happened when `offline` runs.
 *
 * ⚠️ The incriminated file already contradicted itself: `manifest.full.ts`
 * announces the constraint in its header, then writes "**Position is
 * free** (no module, no mobileIcon)" above the pair, 90 lines below.
 *
 * ## What stays TRUE, and this file also guards
 *
 * Two distinctions, never mixed:
 *
 *   - **the GATE** — `offline` refuses to start its engine if
 *     `modules.pwa.enabled` is false. **TRUE**, kept, pinned by **SLO-05**;
 *   - **the MECHANISM** — the `sharedLifecycle`s run in list order and the
 *     `sharedTeardown`s in reverse. **TRUE**, kept, pinned by
 *     `__tests__/config/s15-modules-storage-init.test.js`;
 *   - **the POSITION** — "the order between the two carries". **REFUTED**, here.
 *
 * ## Why NOT in `manifest-shuffle.test.ts`
 *
 * That file only runs `registerPresetDeclarations` /
 * `registerPresetModules`: it **never calls `SharedModule`**. `pwa` and
 * `offline` have neither `createModule` nor `mobileIcon`, so permuting them
 * there changes nothing observable *by construction* — an assertion set
 * there would be green no matter what, including under mutation M-A1 below.
 * A decorative guard, exactly what has already been paid for twice.
 *
 * ## The comparison bears on the effects' CONTENT, not their order
 *
 * ⚠️ `[...effects].sort()`, deliberately. The effects' order necessarily
 * DIFFERS between the two runs — trivial and without consequence, since
 * neither waits for the other. What must be identical is **what was
 * done**, not in which order. Without this sentence, the next reader will
 * believe the guard weaker than it is.
 *
 * ## Proof by mutation — seen on 08/08/2026
 *
 *   M-A1  `offline` refuses to run if `pwa` did not set a flag (the coupling
 *         the doc asserted, written by hand)                            → 🔴 **SLO-01 and SLO-08**
 *   M-A2  run B is no longer inverted                                   → 🔴 SLO-CTRL-1
 *   M-A3  removing the `requestIdleCallback` stub                       → 🔴 SLO-CTRL-2
 *   M-A4  removing `&& cfg.pwaEnabled === true` from `offline/lifecycle.ts` → 🔴 SLO-05
 *   M-A5  `SharedModule.destroy()` iterates FORWARD                     → 🟢 **SLO-06 stays green**,
 *         and `s15-modules-storage-init.test.js` turns red. The most
 *         instructive mutation of the lot: it separates "the reverse-order
 *         mechanism exists" — true, guarded elsewhere — from "that order
 *         carries a consequence" — false, and refuted here.
 *
 * ⚠️ M-A1 turns **SLO-01 and SLO-08 red, not all four cells**, and that is
 * correct: on the other three, `offline` produces no effect anyway (its
 * gate blocks it, or it is disabled), so both orders stay identical. Only
 * the cell where the engine really starts can see a coupling. A guard
 * turning red on all four would be suspect, not better.
 *
 * ⚠️ HARNESS defect found while writing this file, logged because it would
 * have led to concluding the inverse of the measure: `run()` returns
 * **copies** of its arrays. The `navigator.*` stubs survive the return, and
 * the `reset()` separating the two runs calls `PwaLifecycle._reset()` →
 * `_unregisterAll()` → `getRegistrations()`. Without the copy, that call
 * wrote itself into the **already finished** run's effects and the
 * `pwa:off offline:off` cell compared 2 against 1.
 *
 * @see packages/core/src/presets/manifest.full.ts — the requalified header
 * @see docs/specs/capacites/pwa.md — §Décisions, the "Position libre" line
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { shuffled } from "./_helpers/shuffle.ts";

// ⚠️ `vi.hoisted`, not a plain `let`: `offline/install.ts` imports
// `api/geoleaf.sync.ts`, which SELF-MOUNTS on the namespace at import (so a
// data plugin can register its sync handler before the boot ends).
// `ensureGeoLeaf()` is therefore called while the imports below resolve —
// before any `let` of this file is initialised.
const H = vi.hoisted(() => ({ GL: {} as Record<string, unknown> }));

vi.mock("../../src/utils/general/geoleaf-global.js", () => ({
    ensureGeoLeaf: () => H.GL,
    getGeoLeaf: () => H.GL,
}));
vi.mock("../../src/utils/i18n/i18n.js", () => ({
    initI18n: vi.fn(),
    getLabel: (k: string) => k,
    getActiveLang: () => "fr",
}));

const { SharedModule } = await import("../../src/app/boot-modules/shared.module.ts");
const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");
const { PWA_INSTALLER } = await import("../../src/capabilities/pwa/install.ts");
const { OFFLINE_INSTALLER } = await import("../../src/capabilities/offline/install.ts");
const { FULL } = await import("../../src/presets/manifest.full.ts");
const { SWRegister } = await import("../../src/kernel/storage/index.ts");
const { OfflineLifecycle } = await import("../../src/capabilities/offline/lifecycle.ts");
const { PwaLifecycle } = await import("../../src/capabilities/pwa/lifecycle.ts");

/** One run: the sequence of lifecycles called, and the effects observed. */
interface Run {
    sequence: string[];
    effects: string[];
}

/**
 * Runs `SharedModule.init()` over a list of installers and collects what comes out.
 *
 * Three traps are disarmed here, and each would make the comparison BLIND
 * if it were not — i.e. green for a reason unrelated to what is measured.
 * See SLO-CTRL-*.
 */
async function run(installers: readonly unknown[], cfg: Record<string, unknown>): Promise<Run> {
    const sequence: string[] = [];
    const effects: string[] = [];
    const note = (s: string) => effects.push(s);

    // ── Trap 2 — `navigator.storage` and `navigator.serviceWorker` are
    // ABSENT under happy-dom. Without stubs, `_requestPersistentStorage()`
    // and `_unregisterAll()` exit as no-ops and the "pwa off" cells would
    // compare nothing at all.
    Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: {
            persist: vi.fn(async () => {
                note("navigator.storage.persist()");
                return true;
            }),
        },
    });
    Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
            getRegistrations: vi.fn(async () => {
                note("navigator.serviceWorker.getRegistrations()");
                return [];
            }),
        },
    });

    vi.spyOn(SWRegister, "register").mockImplementation(async (opts: unknown) => {
        note(`SWRegister.register(${JSON.stringify(opts)})`);
        return undefined as never;
    });
    vi.spyOn(CapabilityRegistry, "ensureLoaded").mockImplementation(async (id: string) => {
        note(`CapabilityRegistry.ensureLoaded(${JSON.stringify(id)})`);
        return undefined as never;
    });

    const Storage = {
        init: vi.fn((c: unknown) => {
            note(`Storage.init(${JSON.stringify(c)})`);
            return Promise.resolve();
        }),
    };
    const _OfflineDetector = {
        init: vi.fn(() => note("_OfflineDetector.init()")),
    };

    H.GL = {
        _app: { checkPlugins: vi.fn(), AppLog: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } },
        Storage,
        _OfflineDetector,
    };

    // Wrapper: traces WHO ran, without changing what the installer does.
    const traced = installers.map((inst) => {
        const i = inst as { declaration?: { id?: string }; sharedLifecycle?: (c: unknown) => void };
        return {
            ...i,
            sharedLifecycle: (ctx: unknown) => {
                sequence.push(i.declaration?.id ?? "?");
                i.sharedLifecycle?.(ctx);
            },
        };
    });

    new SharedModule(traced as never).init(null as never, cfg as never);

    // ── Trap 3 — the offline chain is asynchronous: `Storage.init` lives
    // in `ensureLoaded`'s `.then()`. Drain before freezing `effects`,
    // otherwise the on/on cell would see nothing.
    await new Promise((r) => setTimeout(r, 20));

    // ⚠️ COPIES, not the live arrays. The `navigator.*` stubs set above
    // stay in place after the return, and the `reset()` separating the two
    // runs calls `PwaLifecycle._reset()` → `_unregisterAll()` →
    // `getRegistrations()`. Without the copy, that call went and wrote
    // itself into the ALREADY FINISHED run's effects, and the comparison
    // saw 2 against 1 on a cell where both orders nonetheless do the same
    // thing. A harness defect, not the subject's — but it would have led to
    // concluding the inverse of the measure.
    return { sequence: [...sequence], effects: [...effects] };
}

/** The two orders to compare, on one same configuration. */
async function bothOrders(cfg: Record<string, unknown>) {
    const nominal = await run([PWA_INSTALLER, OFFLINE_INSTALLER], cfg);
    reset();
    const inverse = await run([OFFLINE_INSTALLER, PWA_INSTALLER], cfg);
    return { nominal, inverse };
}

function reset() {
    OfflineLifecycle._reset();
    PwaLifecycle._reset();
    CapabilityRegistry._reset();
}

/** The four cells `{pwa on|off} × {offline on|off}`. */
const CELLS = [
    { name: "pwa:on offline:on", pwa: true, offline: true },
    { name: "pwa:on offline:off", pwa: true, offline: false },
    { name: "pwa:off offline:on", pwa: false, offline: true },
    { name: "pwa:off offline:off", pwa: false, offline: false },
] as const;

const cfgFor = (c: (typeof CELLS)[number]) => ({
    map: {},
    modules: {
        pwa: { enabled: c.pwa, installPrompt: { enabled: false } },
        offline: { enabled: c.offline },
    },
});

describe("SLO — la position de pwa/offline au manifeste ne décide de rien (7.4)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // ── Trap 1 — happy-dom does NOT expose `requestIdleCallback`, so
        // `Helpers.lazyExecute` falls back to `setTimeout(cb, 3000)` and the
        // SW registration happens in NEITHER order. The comparison would
        // then be blind on the axis that counts most. The synchronous stub
        // puts the effect IN the tick, hence within the measure's field.
        // SLO-CTRL-2 is what keeps this trap from closing again silently.
        (window as unknown as Record<string, unknown>).requestIdleCallback = (cb: () => void) => {
            cb();
            return 0;
        };
        reset();
    });

    afterEach(() => {
        delete (window as unknown as Record<string, unknown>).requestIdleCallback;
        vi.restoreAllMocks();
        reset();
    });

    it("SLO-CTRL-1 — l'inversion a VRAIMENT eu lieu", async () => {
        // Without it, SLO-01..04 would be true by vacuity: two identical
        // runs compared to each other always pass.
        const { nominal, inverse } = await bothOrders(cfgFor(CELLS[0]));
        expect(nominal.sequence).toEqual(["pwa", "offline"]);
        expect(inverse.sequence).toEqual(["offline", "pwa"]);
    });

    it("SLO-CTRL-2 — l'enregistrement du SW est bien OBSERVÉ quand pwa est actif", async () => {
        // Disarms the `lazyExecute` trap. If this rule turns red, SLO-01..04
        // no longer measure the service-worker axis and their green is worthless.
        const { nominal, inverse } = await bothOrders(cfgFor(CELLS[0]));
        for (const r of [nominal, inverse]) {
            expect(r.effects.some((e) => e.startsWith("SWRegister.register("))).toBe(true);
        }
    });

    it("SLO-CTRL-3 — le drain asynchrone a bien eu lieu", async () => {
        // Without the drain, `Storage.init` is never observed and the on/on
        // cell would compare two equally truncated sets.
        const { nominal } = await bothOrders(cfgFor(CELLS[0]));
        expect(nominal.effects.some((e) => e.startsWith("Storage.init("))).toBe(true);
    });

    for (const cell of CELLS) {
        it(`SLO-0${CELLS.indexOf(cell) + 1} — effets identiques sous les deux ordres (${cell.name})`, async () => {
            const { nominal, inverse } = await bothOrders(cfgFor(cell));
            expect(
                [...inverse.effects].sort(),
                `Cellule ${cell.name} : inverser pwa et offline au manifeste a changé ce que le ` +
                    `boot FAIT. Si ce test rougit, la contrainte d'ordre que socle-init 7.4 a ` +
                    `réfutée le 08/08/2026 est réapparue — et il faut la DÉCLARER, pas la subir.`
            ).toEqual([...nominal.effects].sort());
        });
    }

    it("SLO-05 — le GATE tient : pwa désactivé ⟹ aucun moteur hors-ligne, dans LES DEUX ordres", async () => {
        // The TRUE half of the historical claim, and it is only guarded
        // here. `offline` reads `modules.pwa.enabled` from the merged bag: a
        // condition, not a position.
        const { nominal, inverse } = await bothOrders(cfgFor(CELLS[2]));
        for (const r of [nominal, inverse]) {
            expect(r.effects.some((e) => e.includes("ensureLoaded"))).toBe(false);
            expect(r.effects.some((e) => e.startsWith("Storage.init("))).toBe(false);
        }
    });

    it("SLO-06 — le démontage aussi est invariant sous les deux ordres", async () => {
        const teardown = async (installers: readonly unknown[]) => {
            const seen: string[] = [];
            const traced = installers.map((inst) => {
                const i = inst as { declaration?: { id?: string }; sharedTeardown?: () => void };
                return {
                    ...i,
                    sharedTeardown: () => {
                        seen.push(i.declaration?.id ?? "?");
                        i.sharedTeardown?.();
                    },
                };
            });
            H.GL = { _app: { checkPlugins: vi.fn() } };
            new SharedModule(traced as never).destroy();
            return seen;
        };
        // The MECHANISM (reverse order) is there — pinned by
        // `s15-modules-storage-init.test.js`. What is asserted HERE is that
        // inverting it has no consequence.
        expect((await teardown([PWA_INSTALLER, OFFLINE_INSTALLER])).sort()).toEqual(
            (await teardown([OFFLINE_INSTALLER, PWA_INSTALLER])).sort()
        );
    });

    it("SLO-08 — invariance généralisée à TOUS les contributeurs de sharedLifecycle", async () => {
        const contributors = FULL.capabilities.filter(
            (i: { sharedLifecycle?: unknown }) => typeof i.sharedLifecycle === "function"
        );
        // Anti-empty-gate: with fewer than two contributors there is
        // nothing to permute, and this rule would come out green guarding nothing.
        expect(
            contributors.length,
            "moins de deux capacités contribuent un `sharedLifecycle` — SLO-08 n'a plus de sujet"
        ).toBeGreaterThanOrEqual(2);

        const cfg = cfgFor(CELLS[0]);
        const base = await run(contributors, cfg);
        reset();
        for (const seed of [1, 7, 42]) {
            const permuted = await run(shuffled(contributors, seed), cfg);
            reset();
            expect(
                [...permuted.effects].sort(),
                `Graine ${seed} : permuter les contributeurs de \`sharedLifecycle\` a changé ce ` +
                    `que le boot fait. Un couplage d'ORDRE est réapparu entre capacités app-globales.`
            ).toEqual([...base.effects].sort());
        }
    });
});
