/*!
 * GeoLeaf — the EXTENSION contract, exercised the way a third party must exercise it.
 * © 2026 Mattieu Pottier — MIT
 */

/**
 *
 * @description
 * The exit criterion of API publique S3, written as a compiler assertion: **a third-party
 * extension implements the core's module contract, importing the types from the published
 * package** — no `paths`, no relative escape into `../../src/`.
 *
 * ## Why this file exists (API publique S3)
 *
 * Before S3 the 15 contracts of `src/contracts/` were reachable by NO channel: no
 * `./contracts/*` subpath, no type re-exported from the entry. A plugin that had to
 * implement `ICoreModule` could not import it — the only way out was to redeclare it. The
 * repo already paid that cost twice over: `@geoleaf/host-runtime` hand-copies the core's
 * `PluginMetadata` as `PluginRegisterOptions` (the two have drifted), and `addpoi` reached
 * `IMapAdapter` / `LayerDataApi` through a tsconfig alias pointing at the core's SOURCES.
 *
 * Neither defect was visible from inside the repo, for the same reason `entry.ts` exists:
 * everything in here resolves through `paths` that an integrator does not have. This file
 * is the missing half — it compiles **only** if the `exports` map really carries the
 * contracts.
 *
 * ## What it proves, and in which order
 *
 *   1. The six curated subpaths resolve (`@geoleaf/core/contracts/<file>.js`).
 *   2. The same types are reachable from the package root (`@geoleaf/core`), which is the
 *      short form the documentation will show.
 *   3. `ILifecycleModule` is implementable by a class — the shape the 19 in-core modules use.
 *   4. `ICoreModule` accepts the **UI-only** shape too. This is the load-bearing one: the
 *      contract declared `dependencies`, `init` and `destroy` as REQUIRED while
 *      `ModuleRegistry.register()` has always accepted `{ id, ui }`, and 8 real call sites
 *      pass exactly that. Published unchanged, the type would have rejected every plugin in
 *      this repo. Widening it to a union is what S3 corrected; `UI_ONLY_SLOT` below is what
 *      keeps the correction honest.
 *
 * ## Why type-only at runtime
 *
 * Nothing imports this module, so `rollup.consumer.mjs` (whose input is `entry.ts` alone)
 * never bundles it and the `size:consumer` tree-shaking measurement is untouched — same
 * arrangement as `published-types.ts`. It is compiled by `npm run typecheck:consumer`.
 */
"use strict";

// ── 1. Through the published subpaths — the long form ────────────────────────────────────────
import type {
    ICoreModule,
    ILifecycleModule,
    IUISlotModule,
    IModuleUISlot,
} from "@geoleaf/core/contracts/core-module.contract.js";
import type { IGeoLeafConfig } from "@geoleaf/core/contracts/config.contract.js";
import type { IMapAdapter } from "@geoleaf/core/contracts/map-adapter.contract.js";
import type { LayerDataApi } from "@geoleaf/core/contracts/layer-data.contract.js";
import type {
    GeoLeafEventMap,
    GeoLeafRawEventMap,
} from "@geoleaf/core/contracts/event-bus.contract.js";
import type { ICapabilityDeclaration } from "@geoleaf/core/contracts/capability.contract.js";

// ── 2. Through the package root — the short form the docs show ───────────────────────────────
// `import type { ICoreModule } from "@geoleaf/core"` is the form the S3 exit criterion names.
// It resolves only because `kernel-exports.ts` re-exports the contracts as types.
import type {
    ICoreModule as ICoreModuleFromRoot,
    IModuleRegistry as IModuleRegistryFromRoot,
    ICapabilityRegistry as ICapabilityRegistryFromRoot,
    PluginMetadata as PluginMetadataFromRoot,
} from "@geoleaf/core";

// ── 3. A third-party lifecycle module ────────────────────────────────────────────────────────

/**
 * What an external module author writes. `implements ILifecycleModule` — never
 * `implements ICoreModule`, which is a union and which TypeScript's `implements`
 * clause rejects by design.
 */
class ThirdPartyModule implements ILifecycleModule {
    readonly id = "third-party-example";
    readonly dependencies = ["geojson"] as const;

    readonly ui: IModuleUISlot = {
        mobileIcon: {
            icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>',
            labelKey: "third-party.toolbar.button",
            profileKey: "modules.third-party.enabled",
            action: "third-party-example",
        },
    };

    async init(adapter: IMapAdapter, config: IGeoLeafConfig): Promise<void> {
        // The two arguments the registry passes — named here so a signature change is caught.
        void adapter.isReady();
        void config.isLoaded();
    }

    destroy(): void {
        // no-op
    }
}

// ── 4. The UI-only shape — the union the runtime has always accepted ─────────────────────────

/**
 * The literal 7 plugins and `_plugin-template` pass to `GeoLeaf.registry.register()`.
 * Typing it as `ICoreModule` is the assertion: before S3 this did not compile.
 */
const UI_ONLY_SLOT: ICoreModule = {
    id: "third-party-lazy",
    ui: {
        desktopTabButton: {
            icon: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></svg>',
            labelKey: "third-party.tab.label",
            profileKey: "modules.third-party.enabled",
            requiresPlugin: "third-party-lazy",
            action: "third-party-lazy",
            variant: "tab",
        },
    },
};

// Both members of the union are assignable to it, and each keeps its own identity.
const _asLifecycle: ICoreModule = new ThirdPartyModule();
const _asUISlot: IUISlotModule = UI_ONLY_SLOT as IUISlotModule;

// ── 5. Root-import aliases resolve to the same declarations ──────────────────────────────────
// If the subpath and the root re-export ever pointed at two different files, these would stop
// being mutually assignable — the drift `verify-published-types.cjs` cannot see.
const _sameType: ICoreModuleFromRoot = _asLifecycle;

// ── 6. The remaining published contracts, forced to resolve ──────────────────────────────────
// `typeof import(...)` would not be enough here: these are types, not modules. Naming them in
// a type position is what makes the compiler load and check each declaration file.
type _Registry = IModuleRegistryFromRoot;
type _CapRegistry = ICapabilityRegistryFromRoot;
type _CapDecl = ICapabilityDeclaration;
type _PluginMeta = PluginMetadataFromRoot;
type _Layers = LayerDataApi;
type _AppReady = GeoLeafEventMap["geoleaf:app:ready"];

// The toolbar seam a plugin extends through. It lives in the RAW map, not the sanitised one:
// its `element` is a live DOM node that `dispatchGeoLeafEvent`'s JSON clone would destroy.
// Asserting the field types here is what makes that split observable from outside the repo.
type _ToolbarEvent = GeoLeafRawEventMap["geoleaf:toolbar:action"];
const _toolbarDetail: _ToolbarEvent = { action: "third-party-example", element: null! };
const _toolbarAction: string = _toolbarDetail.action;
const _toolbarElement: HTMLElement = _toolbarDetail.element;

// ── 7. The two descriptions of the namespace, checked by the COMPILER ────────────────────────
//
// `scripts/verify-host-contract-sync.cjs` compares the two contracts by NAME (HOST-01/02/03).
// It cannot see a member whose declared SHAPE drifts on one side — that half is here, and the
// pairing is the same one the repo already runs for published types (`verify-published-types.cjs`
// structural + `published-types.ts` compiler).
//
// This is also the only place the check can live. `@geoleaf/host-runtime` must not import from
// `@geoleaf/core` — "not even a type", its own barrel says, because it is bundled into every
// plugin — and the core does not depend on host-runtime either. A neutral third party is
// required, and this fixture is one: type-only, never bundled, compiled through the `exports`
// map of both packages.
import type { GeoLeafHost, PluginRegisterOptions } from "@geoleaf/host-runtime";

/** `T` must be assignable to `U`; the compile error IS the assertion. */
type AssertAssignable<T extends U, U> = T;

/*
 * `GeoLeafGlobal` → `GeoLeafHost`, member by member.
 *
 * `GeoLeafGlobal` is an AMBIENT declaration (`declare global` in
 * `packages/core/src/global.d.ts`), and it is in the program of whoever imports the package:
 * the published entry, `dist/types/bundle-esm-entry.d.ts`, opens on a reference to it. So the
 * comparison can be written — and the plain form of it, `GeoLeafGlobal` assignable to
 * `GeoLeafHost`, can never hold: the host contract ends every member with a
 * `[key: string]: unknown` tail, on purpose (an older core may lack a member and a plugin must
 * degrade), and no closed interface of the core is assignable to a type that carries one.
 *
 * What is compared is therefore what each side NAMES. For every namespace member the host
 * contract names, and every member it names under it, the core's declaration of that same
 * member must be assignable to the host's. The tails are left out at each of the three levels
 * the comparison reads — the namespace, its member, and the object a method returns.
 *
 * Measured the day it was written (06/10/2026), 45 named members, 9 refused: `Core.getMap()`
 * returned `unknown` on the ambient side; five members of `Utils` the kernel mounts were not
 * named there at all, so they came out of its tail as `unknown`; and the host named
 * `GeoJSON.addData`, which the façade never carried. Those seven are corrected on the side
 * that was wrong. The other two were not divergences but bags, below.
 *
 * ⚠️ What it does NOT compare: a member the host declares as a bag
 * (`UI?: Record<string, unknown>`, `Utils.events`, `Legend`…). A bag names nothing, so there
 * is nothing to hold the core to — its consumers narrow locally, and that narrowing is checked
 * against nothing. Nor the ARGUMENTS of a member the host declares `(...args: unknown[])`
 * (`registry.register`, `I18n.registerDict`…): such a signature says nothing about them, and
 * a method's parameters are compared in either direction. And the name-based gate (`scripts/verify-host-contract-sync.cjs`,
 * HOST-01/02/03) stays what tells a phantom FIRST-level member from a real one: this witness
 * only reads the members the host names, it does not know what the runtime mounts.
 */
type Ambient = NonNullable<typeof globalThis.GeoLeaf>;

/** `T` without its index signatures — what `T` names. */
type Named<T> = {
    [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/** A method's result, reduced to what it names when it is an object. */
type NamedResult<R> = R extends (...args: never[]) => unknown ? R : R extends object ? Named<R> : R;

/**
 * A member as the comparison reads it: a method by its parameters and named result, an object
 * by its names.
 *
 * The method is rebuilt in METHOD syntax, deliberately: that is how both contracts declare
 * theirs, and TypeScript compares the parameters of a method in either direction. A function
 * type here would be stricter than the language is for the members it is fed.
 */
type Compared<M> = M extends (...args: infer A) => infer R
    ? { call(...args: A): NamedResult<R> }["call"]
    : M extends object
      ? Named<M>
      : M;

/** The members the host contract names, as IT declares them. */
type HostNamedView = {
    [N in keyof Named<GeoLeafHost>]-?: {
        [S in keyof Named<NonNullable<GeoLeafHost[N]>>]-?: Compared<
            NonNullable<NonNullable<GeoLeafHost[N]>[S]>
        >;
    };
};

/**
 * The same members, as the core's ambient declaration has them.
 *
 * ⚠️ Written out a second time rather than as one generic view instantiated twice: two
 * instances of ONE alias are compared by their type argument first, which skips the very
 * reduction this fixture exists for — the tails came back, measured.
 */
type AmbientNamedView = {
    [N in keyof Named<GeoLeafHost>]-?: {
        [S in keyof Named<NonNullable<GeoLeafHost[N]>>]-?: Compared<
            NonNullable<
                S extends keyof NonNullable<Ambient[N]> ? NonNullable<Ambient[N]>[S] : never
            >
        >;
    };
};

type _HostShapeConformance = AssertAssignable<AmbientNamedView, HostNamedView>;

/**
 * The registration metadata seam — the duplication the API-publique audit named.
 *
 * `PluginRegisterOptions` (host-runtime) is a hand-written copy of `PluginMetadata` (core).
 * The asserted direction is the one that has to hold for plugins to work: what a plugin
 * builds against the host type must be accepted by `PluginRegistry.register()`.
 *
 * ⚠️ The REVERSE does not hold, and that is a real measured divergence rather than an
 * oversight of this fixture: the core declares `version?: string | null` and
 * `healthCheck?: (() => boolean) | null`, the host copy declares both non-nullable. A plugin
 * reading back a registration made with `version: null` is outside its own declared type.
 * Asserting the reverse today would be red; it is left un-asserted, named here, and belongs
 * to whichever side is chosen as canonical (S4).
 */
type _RegisterConformance = AssertAssignable<PluginRegisterOptions, PluginMetadataFromRoot>;

export {};
