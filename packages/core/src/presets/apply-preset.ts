/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Preset composition — the single boot loop over a {@link PresetManifest}.
 *
 * Extracted from `boot.ts` (presets build, S2) so the loop that replaces the
 * historical dispersed register / gate blocks is a small, directly-testable pure
 * unit rather than uncovered inline code buried in `startApp`. `bootWithPreset()`
 * (S3) generalises `startApp` and reuses these two helpers verbatim.
 *
 * Two passes, matching the two former boot blocks:
 *   1. {@link registerPresetDeclarations} — register each capability declaration
 *      (introspection + gate) and assign its public-facade globals (layer B) ;
 *   2. {@link registerPresetModules} — register the gated lifecycle module for
 *      every installer that declares a `createModule` factory.
 */

import type { PresetManifest } from "../contracts/preset.contract.js";
import type {
    ICapabilityDeclaration,
    ICapabilityInstallFacts,
} from "../contracts/capability.contract.js";
import type { ICoreModule, ILifecycleModule } from "../contracts/core-module.contract.js";
import type { IMapAdapter } from "../contracts/map-adapter.contract.js";
import type { IGeoLeafConfig } from "../contracts/config.contract.js";
import { evaluateGate, toCapConfig } from "../kernel/api/capability-registry.js";

/** Dotted-path config reader — the shape returned by `toCapConfig()`. */
interface CapConfigReader {
    get(key: string, defaultValue?: unknown): unknown;
}

/** Minimal capability-registry surface used during preset composition. */
interface CapRegistryLike {
    register(decl: ICapabilityDeclaration): void;
    noteInstaller(id: string, facts: ICapabilityInstallFacts): void;
    isEnabled(id: string, config: CapConfigReader): boolean;
}

/** Minimal module-registry surface used during preset composition. */
interface ModuleRegistryLike {
    register(module: ICoreModule): void;
}

/**
 * Pass 1 — register each installer's declaration and assign its facade globals.
 * Order follows the manifest (introspection insertion-order preserved). Pure and
 * synchronous; `registerGlobals` writes are idempotent references.
 *
 * ## Why the install facts are recorded HERE (socle-init 9.4)
 *
 * This pass is the only place that sees **every** installer: Pass 2 skips those without a
 * `createModule` (5 of the 21 shipped ones), and it is itself conditional on the module
 * registry not being initialised yet. Recording `hasModule` there would answer "no module"
 * for a capability that has one, depending on when boot ran.
 *
 * `createModule` is read as a **field**, never invoked — Pass 2 is the single caller, and a
 * second call would build a second module instance.
 *
 * @param preset - the active preset manifest.
 * @param capabilityRegistry - registry that records declarations for the gate + introspection.
 * @param gl - the boot-populated `GeoLeaf` global namespace (bag view).
 */
export function registerPresetDeclarations(
    preset: PresetManifest,
    capabilityRegistry: Pick<CapRegistryLike, "register" | "noteInstaller">,
    gl: Record<string, unknown>
): void {
    for (const inst of preset.capabilities) {
        capabilityRegistry.register(inst.declaration);
        capabilityRegistry.noteInstaller(inst.declaration.id, {
            hasModule: inst.createModule !== undefined,
        });
        inst.registerGlobals(gl);
    }
}

/**
 * Adapts whatever `ICoreModule.init()` is handed into a dotted-path reader.
 *
 * ⚠️ Two shapes reach this function, and only one of them matches the declared type.
 * `boot-core.ts` calls `registry.init(adapter, effectiveCfg as unknown as IGeoLeafConfig)` —
 * a **cast**, not a conversion: modules actually receive the plain resolved-config object.
 * The lie has been invisible because no in-core module calls `config.get()` in its `init()`.
 * This gate would be the first, so it accepts both rather than trusting the annotation.
 *
 * @param config - the value `init()` received.
 * @returns a reader that resolves dotted keys against it.
 */
function toReader(config: unknown): CapConfigReader {
    const maybe = config as { get?: unknown } | null | undefined;
    if (maybe && typeof maybe.get === "function") return maybe as CapConfigReader;
    return toCapConfig((config ?? {}) as Record<string, unknown>);
}

/**
 * Wraps a capability's module so its gate is evaluated **when the module initialises**,
 * against the config the module itself receives, instead of at registration time.
 *
 * ## Why this exists (socle-init 9.2)
 *
 * Pass 2 runs before `loadActiveProfileResources()`. Reading the gate there meant reading a
 * config the profile had not contributed to yet, so a profile that wrote
 * `modules.branding.enabled: true` was answered by a config in which the key was simply
 * absent — `enableWhenAbsent ?? false` — and the module was never created. **The product's
 * documented configuration surface could not switch on what it describes.**
 *
 * ⛔ The fix is NOT to move Pass 2 below the profile load. `app/boot-core.ts` carries that
 * interdiction, and notes the zone had to be reverted once already. Here the pass stays where
 * it is and a **condition is removed**: every module is registered, and this wrapper decides
 * whether to run it — in `init()`, which the registry calls after the merge.
 *
 * Registering unconditionally is safe on the three surfaces that could have noticed:
 *   - **topo-sort** — the wrapper forwards `dependencies`, and the only ones capability
 *     modules declare are `geojson` / `config` / none, all kernel modules always present ;
 *   - **UI slots** — `ui` is forwarded, and a pill for a switched-off capability is already
 *     rejected downstream by its own `profileKey` guard, which reads the post-merge config
 *     (`kernel/ui/ui-slot-builder.ts`) ;
 *   - **`destroy()`** — skipped when the gate said no, so nothing tears down what never ran.
 *
 * `ModuleRegistry` is left alone: it never learns what a capability gate is. It only gets a
 * module that can be asked `isEnabled()`, which is a lifecycle question, not a gate one.
 *
 * @param module - the module the installer built.
 * @param isOn - the gate, deferred: given a config reader, does this module run?
 * @returns a module of the same shape, plus `isEnabled()`.
 */
function gatedModule(
    module: ICoreModule,
    isOn: (config: CapConfigReader) => boolean
): ICoreModule & { isEnabled(): boolean } {
    let enabled = false;
    const inner = module as Partial<ILifecycleModule>;

    const wrapper: ILifecycleModule & { isEnabled(): boolean } = {
        id: module.id,
        dependencies: module.dependencies ?? [],
        isEnabled: () => enabled,

        init(adapter: IMapAdapter, config: IGeoLeafConfig): Promise<void> | void {
            enabled = isOn(toReader(config));
            if (!enabled) return;
            return inner.init?.(adapter, config);
        },

        // `init` and `destroy` go together or the registry throws
        // (`app/module-registry.ts` validates the disjunction at register time).
        destroy(): void {
            if (!enabled) return;
            inner.destroy?.();
        },
    };

    // Only forward `ui` when there is one: an `ui: undefined` key would make
    // `getModuleSchema().hasUI` read `false` for a slot that legitimately has none, which is
    // the same answer by accident rather than by fact.
    if (module.ui !== undefined) {
        (wrapper as { ui?: ICoreModule["ui"] }).ui = module.ui;
    }

    return wrapper;
}

/**
 * Pass 2 — register the lifecycle module of every installer that owns one, each wrapped in
 * its own gate.
 *
 * Installers without a `createModule` (policy / hook / shared.module-driven capabilities)
 * contribute no module here.
 *
 * An installer whose module is gated on a **sub-key** of its capability's config
 * (`moduleGate` — e.g. `share` under `permalink`) is evaluated with `evaluateGate()`,
 * the same semantics the registry applies to a declaration gate.
 *
 * ⚠️ **The gate is no longer read here** (socle-init 9.2). It is captured as a closure and
 * evaluated by {@link gatedModule} inside `init()`, so that it sees the profile-merged config
 * rather than the pre-merge one. The two branches below are the *same* two branches as
 * before — only their moment changed. Dropping the former `capConfig` parameter is what makes
 * that unambiguous: there is now exactly one config in play, the one modules receive.
 *
 * @param preset - the active preset manifest.
 * @param capabilityRegistry - registry whose gate decides activation.
 * @param moduleRegistry - the ModuleRegistry receiving the module instances.
 */
export function registerPresetModules(
    preset: PresetManifest,
    capabilityRegistry: Pick<CapRegistryLike, "isEnabled">,
    moduleRegistry: ModuleRegistryLike
): void {
    for (const inst of preset.capabilities) {
        if (!inst.createModule) continue;
        const moduleGate = inst.moduleGate;
        const isOn = moduleGate
            ? (config: CapConfigReader): boolean => evaluateGate(moduleGate, config)
            : (config: CapConfigReader): boolean =>
                  capabilityRegistry.isEnabled(inst.declaration.id, config);
        moduleRegistry.register(gatedModule(inst.createModule(), isOn));
    }
}
