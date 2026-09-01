/*!
 * GeoLeaf Core — Kernel named exports
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * The **kernel** half of the public ESM surface: every named export that belongs to the
 * fixed kernel and to the shared utilities — i.e. everything a bundle entry exposes
 * *regardless* of which capabilities it embarks.
 *
 * ⚠️ ARCHI S5 (5.4) — ce bloc annonçait « **8 modules** (map, config, geojson, ui, api,
 * security, shared, theme-engine)". The runtime registers **SIX**:
 * `core-map`, `config`, `shared`, `geojson`, `ui`, `theme-engine`
 * (`app/boot-install.ts`, identifiers read off the `readonly id` fields).
 *
 * `api` and `security` were never registry modules: they are **facade-only**
 * subsystems, set at import time. `SecurityModule` was in fact deleted because it was
 * nothing but a wrapper around empty `init()`/`destroy()`. And the first one's name is
 * `core-map`, not `map`.
 *
 * Extracted from `bundle-esm-entry.ts` (S4) so that a consumer entry can re-export the
 * kernel with one line (`export * from "../kernel-exports.js"`) and then add only the
 * facades of the capabilities it chose. Before the split, writing an alternative entry
 * meant copy-pasting ~30 export lines and silently drifting from the real one.
 *
 * ⚠ **Never re-export a capability facade from this file.** `Legend`, `Permalink`,
 * `Share`, `Notifications` and `PWA` deliberately stay in the entry that
 * embarks them: a capability re-exported here would be pinned into the eager closure of
 * EVERY entry, which is exactly the anchoring S4 removed. The rule is mechanical — if the
 * symbol lives under `src/capabilities/`, it does not belong here.
 *
 * @see bundle-esm-entry — the shipped entry (kernel + ALL in-core capabilities)
 * @see examples/minimal/entry.ts — a consumer entry (kernel + a chosen subset)
 *
 * ⚠ Neither `@see` carries a count any more. They said « 17 » and « 9 » against a real
 * 21 and 6 — and the second was worse than stale, it quoted `consumer`'s number next to
 * `minimal`'s name. A number written beside a file name is a second source of truth about
 * THAT file, and it drifts silently. `manifest-full-completeness.guard.test.ts` holds the
 * first claim; the generated entries of S8 hold the second.
 */

// High-level facades
export { Core } from "./api/geoleaf.core.js";
export { GeoLeafAPI } from "./api/geoleaf.api.js";
export { UI } from "./api/geoleaf.ui.js";
export { LayerManager } from "./api/geoleaf.layer-manager.js";
export { Baselayers } from "./api/geoleaf.baselayers.js";
export { Helpers } from "./api/geoleaf.helpers.js";
export { Validators } from "./api/geoleaf.validators.js";
export { Events } from "./api/geoleaf.events.js";

// API sub-modules — B4 [ARCH-02]: import from the barrel api/index.js
//
// `CapabilityRegistry` joined this list at API publique S3 (arbitrage Q1 = « oui »). It was
// already exported by the barrel and complete (`register`, `isEnabled`, `isLoaded`,
// `ensureLoaded`, `getSchema`, `getAllSchemas`, typed by `ICapabilityRegistry`), but reachable
// by NO public channel — neither here nor on the global. A plugin could only declare a
// capability through `GeoLeaf.plugins.registerCapability(decl)`, i.e. the runtime channel,
// untyped, because `ICapabilityDeclaration` was not exposed either. The API existed and was
// not offered. It costs no bytes: `app/boot-core.ts` already pins it into the eager closure.
export {
    APIController,
    APIFactoryManager,
    APIInitializationManager,
    APIModuleManager,
    PluginRegistry,
    CapabilityRegistry,
    BootInfo,
    showBootInfo,
} from "./kernel/api/index.js";

import { createUtilsNamespace } from "./utils/general/utils-namespace.js";

// Core utilities frequently imported
export { Log } from "./utils/log/index.js";
export { Errors } from "./utils/errors/errors.js";
export { CONSTANTS } from "./utils/constants/constants.js";
/**
 * The framework-agnostic helper namespace, as an ESM named export.
 *
 * ⚠️ This object and the runtime global `GeoLeaf.Utils` carry the **same shape but are distinct
 * objects**, and the distinction is deliberate: the global has to stay mutable and re-appliable
 * by the module lifecycle, so it cannot be this frozen export. Mutating one therefore does not
 * affect the other — read from whichever you imported.
 *
 * The two were once genuinely divergent (12 keys here against 27 there), which meant
 * `import { Utils }` and `GeoLeaf.Utils` silently disagreed about what existed. Shape equality
 * is now the invariant, and it is guarded — see `__tests__/utils/utils-shape.test.js` (KERNEL
 * S14).
 */
export const Utils = createUtilsNamespace();
export type { UtilsNamespace } from "./utils/general/utils-namespace.js";
// applyCssText — CSP-safe inline-style helper (security roadmap B.5), consumed by plugins.
export { applyCssText } from "./utils/general/dom-helpers.js";
export { Config } from "./kernel/config/geoleaf-config/config-core.js";

// ── Extension contract — TYPES ONLY (API publique S3, arbitrage Q1 = « oui ») ────────────────
//
// The curated subset of `src/contracts/` a third-party extension needs to compile against.
// Until S3 these types were reachable by NO channel: a plugin implementing `ICoreModule` had
// to redeclare it, and `addpoi` reached `IMapAdapter` / `LayerDataApi` through a tsconfig
// `paths` alias into the core's SOURCES (`@core/contracts/*`) — a route no external consumer
// can take.
//
// ⚠ The "never re-export a capability facade from this file" rule above does NOT apply here,
// and the reason is mechanical rather than a judgement call: `export type` is ERASED at
// compile time. These lines add zero bytes to every entry's eager closure — which is the
// exact cost that rule exists to prevent. `export type { UtilsNamespace }` above is the same
// shape and the standing precedent.
//
// Each name below is also reachable through its own `exports` subpath
// (`@geoleaf/core/contracts/<file>.js`, types-only — the contracts emit no JS, cf. D1).
// Re-exporting here is what makes the shorter `import type { ICoreModule } from "@geoleaf/core"`
// work, which is the form the S3 exit criterion exercises.
export type {
    ICoreModule,
    ILifecycleModule,
    IUISlotModule,
    IModuleRegistry,
    IModuleUISlot,
} from "./contracts/core-module.contract.js";
export type {
    ICapabilityDeclaration,
    ICapabilityRegistry,
    ICapabilitySchema,
    ICapabilityFieldSchema,
    ICapabilityConfigGate,
} from "./contracts/capability.contract.js";
export type { IGeoLeafConfig } from "./contracts/config.contract.js";
export type { IMapAdapter } from "./contracts/map-adapter.contract.js";
export type { LayerDataApi, LayerFeatureState } from "./contracts/layer-data.contract.js";
export type {
    GeoLeafEventMap,
    GeoLeafRawEventMap,
    IEventBus,
} from "./contracts/event-bus.contract.js";

// `PluginMetadata` is NOT in `contracts/` — it lives in `kernel/api/api-types.ts`. It is
// re-exported here because it, not the contracts, is the type `@geoleaf/host-runtime`
// hand-copied as `PluginRegisterOptions`: the duplication the API-publique audit cited as
// justification for publishing the contracts was in fact about THIS symbol, and publishing
// `./contracts/*` alone would not have closed it. The two copies have already drifted
// (`version: string | null` here vs `string` there); `verify-host-contract-sync.cjs`
// is what keeps them from drifting again.
export type { PluginMetadata } from "./kernel/api/api-types.js";
// `BootInfoNamespace` typed the first argument of `showBootInfo`, itself exported from here.
// The member was published yet UNTYPEABLE from outside. Exported on 17/08/2026 — an
// ADDITION, never a removal.
// ⚠️ The type had to be made STANDALONE first: it extended `GeoLeafAPINamespace`, which
// lives in `contracts/api.contract.ts`, absent from the `exports` map. Without that
// prerequisite, the published declaration would have referenced a type the consumer
// cannot resolve.
export type { BootInfoNamespace } from "./kernel/api/api-types.js";
