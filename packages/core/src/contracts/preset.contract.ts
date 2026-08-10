/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Build Preset (composition boundary)
 *
 * A **preset** is the set of in-core capabilities a bundle entry embarks on top of
 * le noyau fixe (**6 modules** enregistrés par `app/boot-install.ts` : `core-map`, `config`,
 * `shared`, `geojson`, `ui`, `theme-engine` — ARCHI S5 (5.4) : ce bloc annonçait « 8 »,
 * en y comptant `api` et `security`, qui sont des sous-systèmes de façade seule et non
 * des modules du registre). It replaced the frozen `lite` build (removed in S4):
 * instead of a hand-maintained parallel entry/boot/globals triple, each capability
 * exposes ONE self-sufficient installer, and an entry is a curated list of them.
 *
 * **GeoLeaf ships exactly one bundle — `dist/geoleaf.esm.js`, with every capability.**
 * This contract is NOT a preset DSL and there is no preset registry: it exists so a
 * consumer who wants *less* can write their own ~25-line entry composing the installers
 * they need, and have the rest tree-shake out. `examples/minimal/entry.ts` is that
 * recipe, built and measured on every build so the promise stays verifiable.
 *
 * Design intent — **one declaration form, not one nature.** The historical capability
 * shapes (module+gate / policy / hook / app-global lifecycle) were wired at 4 distinct
 * sites of `boot.ts`; that dispersion was the debt, not the diversity.
 * `CapabilityInstaller` unifies the *surface* (a single contract, a single boot loop);
 * the legitimate variations become **optional fields**, not code paths:
 *   - `createModule?` absent → policy/hook capability (cluster, permalink, taxonomy) ;
 *   - `moduleGate?` present  → the module gates on a sub-key (share, under permalink) ;
 *   - `sharedLifecycle?`     → app-global capability driven by the kernel `shared` module.
 *
 * There is deliberately no gate-overlay field. `taxonomy` used to need one (its
 * gate key lives in a profile resource, loaded after the boot gate reads config),
 * but the fix is to declare the gate OPT-OUT, not to bolt a preset-level default
 * on top of it. Every capability now gates correctly on its own.
 */
"use strict";

import type {
    ICapabilityConfigGate,
    ICapabilityDeclaration,
} from "../contracts/capability.contract.js";
import type { ICoreModule } from "../contracts/core-module.contract.js";
import type { GeoLeafConfig } from "../kernel/config/geoleaf-config/config-types.js";

// ─── PresetId ─────────────────────────────────────────────────────────────────

/**
 * Identifier of the capability set an entry composes — free-form, and used for
 * diagnostics only (it gates nothing). The shipped bundle uses `"full"`; a consumer
 * entry names its own (see `examples/minimal/entry.ts`, which uses `"minimal"`).
 */
export type PresetId = string;

// ─── CapabilityInstaller ──────────────────────────────────────────────────────

/**
 * Self-sufficient installer for one in-core capability.
 *
 * Regroups the 3 static-anchoring layers of a capability behind a single import
 * site, so a preset embarks a capability by importing ONLY its `install.ts`:
 *   - **A** (facade re-exports) — carried by the preset entry that imports this ;
 *   - **B** (`window.GeoLeaf.*` assignments) — {@link registerGlobals} ;
 *   - **C** (register + gated module) — {@link declaration} + {@link createModule}.
 */
export interface CapabilityInstaller {
    /** Capability declaration — reuses the existing `<cap>-capability.ts` (id, gate, schema). */
    readonly declaration: ICapabilityDeclaration;

    /**
     * Assigns the capability's public facade(s) onto the `GeoLeaf` namespace.
     * This is the former "layer B" — the `window.GeoLeaf.*` writes moved out of
     * the monolithic `globals.{ui,api,geojson}.ts`. Called by Pass 1 of the preset loop
     * (`presets/apply-preset.ts`), ungated. Must be idempotent and additive — the kernel
     * facades are written first, at import, by the `globals.*.ts` chain (phase A).
     *
     * (This used to say "composed by the boot via the `module-setup` seam". That was wrong
     * even then — `registerGlobals` was always driven by `apply-preset.ts` — and the seam
     * itself is gone since S6 Lot 5.)
     *
     * @param gl - the boot-populated `GeoLeaf` global namespace.
     */
    registerGlobals(gl: Record<string, unknown>): void;

    /**
     * Factory for the capability's lifecycle module (`ICoreModule`).
     *
     * **Absent** for the three *pull-based* capabilities — they answer when asked and
     * subscribe to nothing, so there is no lifecycle to drive:
     *   - `cluster` — pure resolvers queried on demand ;
     *   - `taxonomy` — supplies paint expressions and symbol ids to whoever asks ;
     *   - `vector-tiles` — publishes the `_VectorTiles` seam; the GeoJSON loader reads it
     *     back lazily through `_loaderDeps.getVectorTiles()`.
     *
     * ⚠️ This list said `cluster, taxonomy, permalink` until CAPACITÉS S10, and it was wrong
     * in both directions — the same error was copied into `ARCHITECTURE.md` and the
     * `CDC_technique.md` §P2-14 table. `permalink` DOES declare a `createModule`: it builds
     * `ShareModule`, the module of its `share/` sub-feature, which is exactly why it also
     * declares {@link CapabilityInstaller.moduleGate}. What `permalink` lacks is a lifecycle
     * *of its own* — that one lives in `capabilities/permalink/share/lifecycle.ts`. And
     * `vector-tiles`, the genuine third member, was named nowhere.
     *
     * `pwa` and `offline` are absent too, but for the other reason: they are app-global and
     * express their lifecycle through {@link CapabilityInstaller.sharedLifecycle} below.
     *
     * The rule is pinned by `__tests__/capabilities/scaffold-taxonomy.test.js`, which derives
     * each family from the installers rather than from a list — so this comment cannot drift
     * again without a red test.
     */
    createModule?(): ICoreModule;

    /**
     * Gate of {@link createModule} when the module's activation key differs from the
     * capability's own gate — the **sub-feature** case.
     *
     * `permalink` owns no module of its own (two boot hooks drive it), but it embarks
     * `share` (S13 F7), whose `ShareModule` is gated on the sub-key
     * `modules.permalink.share.enabled` (opt-out), NOT on `modules.permalink.enabled`.
     * Share has no capability declaration of its own by design, and the registry ignores
     * a second `register()` on the same id — so the gate cannot be expressed as a second
     * declaration. It is expressed here, as an optional FIELD (the contract's doctrine),
     * evaluated by `evaluateGate()` with exactly the same semantics as a declaration gate.
     *
     * Absent → the declaration's own gate applies (the common case).
     */
    readonly moduleGate?: ICapabilityConfigGate;

    /**
     * Pre-map lifecycle driven by the kernel `shared` module — the **app-global** case.
     *
     * `pwa` (step #7) and `offline` (step #8) own no `ICoreModule`: they are app-global,
     * and their lifecycles must run on the **post-merge** config, inside `SharedModule.init()`
     * (which runs after the profile resources load). Before S4 that was expressed by
     * `shared.module.ts` **statically importing** `PwaLifecycle` and `OfflineLifecycle` —
     * a kernel module hard-wired to two optional capabilities, which pinned both into the
     * eager closure of *every* bundle no matter what its manifest said. That was THE anchor
     * blocking tree-shaking.
     *
     * Expressing it as an optional FIELD (the contract's doctrine) inverts the dependency:
     * `SharedModule` receives the entry's installers and calls whatever contributed itself.
     * An entry that omits `pwa` simply has no contributor — and the capability tree-shakes out.
     *
     * Execution order is the manifest order. ⚠ **No pair of contributors depends on it** — this
     * line read « `pwa` MUST precede `offline`: offline reads `modules.pwa.enabled` and refuses
     * to start its engine without it » until 08/08/2026. The refusal is real; the *ordering* it
     * was used to justify is not, because that flag lives in the merged config bag handed to
     * every contributor. Measured: `__tests__/presets/shared-lifecycle-order.test.ts` (7.4).
     *
     * @param ctx - the `GeoLeaf` namespace and the fully merged config.
     */
    sharedLifecycle?(ctx: SharedLifecycleContext): void;

    /**
     * Tears down what {@link CapabilityInstaller.sharedLifecycle} started, called from
     * `SharedModule.destroy()`. Same inverted dependency: the kernel calls whatever
     * contributed itself and imports no capability.
     *
     * Without this, an app-global capability keeps its module-level state across a
     * `create → destroy → recreate` cycle: the lifecycle runs again on a state that was
     * never reset. Capabilities driven by their own `*.module.ts` already reset in that
     * module's `destroy()`; this is the equivalent for the ones `SharedModule` drives.
     *
     * Runs in **reverse manifest order** (mirror of `sharedLifecycle`) — a real mechanism,
     * asserted by `__tests__/config/s15-modules-storage-init.test.js`. ⚠ The *reason* this line
     * gave for it was not: it read « …, so a capability is torn down before the one it depends
     * on: `offline` (#8) then `pwa` (#7) » until 08/08/2026. No `sharedTeardown` of the shipped
     * manifest reads another's state, and SLO-06 measured the teardown effects invariant under
     * both orders. The mirror is kept for symmetry with `sharedLifecycle`, not for a dependency.
     */
    sharedTeardown?(): void;
}

/** Collaborators handed to {@link CapabilityInstaller.sharedLifecycle}. */
export interface SharedLifecycleContext {
    /** The global `GeoLeaf` namespace (kernel chain already applied). */
    readonly GeoLeaf: GeoLeafGlobal;
    /** The **merged** config (profile resources included) — `SharedModule` runs post-merge. */
    readonly config: GeoLeafConfig;
}

// ─── PresetManifest ───────────────────────────────────────────────────────────

/**
 * Runtime preset manifest: the ordered set of installers a preset entry composes,
 * layered on the fixed kernel. Consumed by `bootWithPreset()` (S3). The kernel is
 * implicit — never listed here.
 */
export interface PresetManifest {
    readonly id: PresetId;
    readonly capabilities: readonly CapabilityInstaller[];
}
