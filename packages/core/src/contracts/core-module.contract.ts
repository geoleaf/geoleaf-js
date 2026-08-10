/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Core Module (public type boundary)
 *
 * Defines the module system interfaces that make GeoLeaf extensible:
 *
 * - `IModuleUISlot` — how a module registers its toolbar/panel UI
 * - `ICoreModule` — lifecycle contract every module must implement
 * - `IModuleRegistry` — orchestrates module registration, dependency
 *   resolution, initialisation, and teardown
 *
 * These types are the foundation of the `ModuleRegistry` (Sprint 3).
 * They are designed to be implemented by both built-in modules (`poi`,
 * `route`, `search`, …) and by third-party modules registered at runtime.
 */
"use strict";

import type { IGeoLeafConfig } from "./config.contract.ts";
import type { IMapAdapter } from "./map-adapter.contract.ts";
import type { IModuleInfo, IModuleSchema } from "./introspection.contract.ts";

// ─── UI Slots ─────────────────────────────────────────────────────────────────

/**
 * UI integration slot declared by a module.
 *
 * A module may optionally declare:
 * - a **mobile toolbar icon** rendered in the bottom pill
 * - a **desktop filter tab** rendered in the right-hand filter panel
 *
 * Both are opt-in. A module that declares neither simply has no UI presence
 * (e.g. a data connector module).
 *
 * @example
 * ```typescript
 * const ui: IModuleUISlot = {
 *     mobileIcon: {
 *         icon: '<svg …>…</svg>',
 *         labelKey: 'aria.toolbar.legend',
 *         profileKey: 'modules.legend.enabled',
 *     },
 *     filterTab: {
 *         labelKey: 'legend.filterTab',
 *         order: 10,
 *         render() { return buildLegendPanel(); },
 *     },
 * };
 * ```
 */
export interface IModuleUISlot {
    /**
     * Mobile toolbar (bottom pill) integration.
     *
     * When declared, the registry renders a button in the mobile pill using
     * the provided icon and label. The button is hidden when the profile key
     * evaluates to `false`.
     */
    mobileIcon?: {
        /**
         * SVG icon markup rendered inside the pill button.
         *
         * @security This field **must** be a static, hardcoded SVG string
         * written by the module developer. **Never** assign content that
         * originates from user input, network responses, URL parameters, or
         * profile data — SVG markup can carry executable payloads (XSS via
         * inline event handlers, `<script>` elements, or `href="javascript:"`).
         *
         * @example `'<svg viewBox="0 0 24 24"><path d="…"/></svg>'`
         */
        icon: string;

        /**
         * i18n key resolved at render time to produce the button's accessible label.
         *
         * @example `'search.buttonLabel'`
         */
        labelKey: string;

        /**
         * Dot-notation profile configuration key that controls visibility.
         * When `config.get(profileKey)` evaluates to `false`, the icon is hidden.
         *
         * @example `'modules.legend.enabled'`
         */
        profileKey: string;

        /**
         * Whether the icon is visible when `profileKey` is absent from the profile.
         *
         * @default true
         */
        defaultVisible?: boolean;

        /**
         * Optional plugin identifier that must be loaded for this icon to appear.
         * When set, `GeoLeaf.plugins.isLoaded(requiresPlugin)` must return `true`.
         * Use for toolbar buttons backed by external plugins (not core built-ins).
         *
         * @example `'print'`
         */
        requiresPlugin?: string;

        /**
         * Optional toolbar action identifier mapped to `data-gl-toolbar-action`.
         * When set, the click handler dispatches the named action (e.g. `"search"`)
         * instead of opening a sheet modal. Also enables action-specific CSS rules.
         *
         * @example `'search'`
         */
        action?: string;

        /**
         * Render order in the mobile pill. Lower values appear first.
         *
         * Same semantics as {@link IModuleUISlot.filterTab}`.order` — this field aligns the
         * two halves of the same interface, which declared an explicit order on one side and
         * relied on an implicit one on the other.
         *
         * ⚠️ Without it, pills render in **module registration order**, which is an emergent
         * property of the manifest: `presets/manifest.full.ts` orders its installers for
         * load-bearing reasons of its own (see that file's header — it is the registry), and the
         * toolbar layout was one more meaning silently riding on the same list. Reordering the
         * manifest for any of the others moved the buttons.
         *
         * ⚠️ This sentence carried a count and a list until 08/08/2026 — « three unrelated
         * load-bearing reasons (topo-sort tie-breaks, `sharedLifecycle` sequencing, dependency
         * edges) » — and BOTH were wrong. `sharedLifecycle` sequencing was refuted by socle-init
         * 7.4 (`__tests__/presets/shared-lifecycle-order.test.ts`), and « dependency edges » was
         * never one of the manifest's stated reasons at all — it was invented here, and copied
         * from here into `scripts/gen-entry.cjs`. B-43: the count is gone rather than corrected,
         * because a second copy of a list can only drift from the list.
         *
         * Modules that omit it keep the previous behaviour: they render after every ordered
         * one, in registration order.
         *
         * @default undefined — render after all ordered icons, in registration order
         * @example `10`
         */
        order?: number;
    };

    /**
     * Desktop tab-strip button integration.
     *
     * When declared, the registry renders an icon button in the right-hand
     * desktop tab strip (`.gl-rp-tabs`), inserted above the share button.
     * On mobile the button is hidden — only `mobileIcon` is shown on small
     * screens.
     *
     * Shares the same guard semantics as `mobileIcon`: `profileKey` controls
     * config-driven visibility, `requiresPlugin` gates on plugin presence.
     */
    desktopTabButton?: {
        /**
         * SVG icon markup. Same security constraints as `mobileIcon.icon`:
         * must be a static, hardcoded string — never user-supplied content.
         */
        icon: string;

        /** i18n key resolved at render time for the button's accessible label. */
        labelKey: string;

        /**
         * Dot-notation profile key controlling visibility.
         * When `config.get(profileKey)` evaluates to `false`, the button is hidden.
         */
        profileKey?: string;

        /** Whether the button is visible when `profileKey` is absent. @default true */
        defaultVisible?: boolean;

        /**
         * Plugin identifier that must be loaded for this button to appear.
         * Same semantics as `mobileIcon.requiresPlugin`.
         */
        requiresPlugin?: string;

        /** Toolbar action dispatched on click via `geoleaf:toolbar:action`. */
        action?: string;

        /**
         * Visual rendering in the desktop tab strip.
         * - `"icon"` (default): a 28×28 icon button in the bottom stack (`.gl-rp-tab-btn`),
         *   using `icon`.
         * - `"tab"`: a vertical-text tab matching the built-in Filtrer/Couches/Légende
         *   tabs (`.gl-rp-tab`), showing `labelKey` as text (the `icon` is ignored).
         *   Use when the slot replaces a former core tab (e.g. the extracted Table).
         */
        variant?: "icon" | "tab";
    };

    /**
     * Desktop filter panel tab integration.
     *
     * When declared, the registry renders a tab in the right-hand filter panel.
     * Tabs are sorted by `order` (ascending) before rendering.
     *
     * **`render` is required** — it may not be omitted when `filterTab` is declared.
     * TypeScript enforces this at compile time. The registry calls `render()`
     * exactly once (lazy, returned element is cached), which guarantees
     * performance and enables straightforward unit testing:
     * `const el = module.ui.filterTab.render()`.
     */
    filterTab?: {
        /**
         * i18n key resolved at render time to produce the tab title.
         *
         * @example `'search.filterTabLabel'`
         */
        labelKey: string;

        /**
         * Insertion order relative to other filter tabs. Lower values appear first.
         *
         * @default 0
         */
        order?: number;

        /**
         * Renders and returns the tab content as an `HTMLElement`.
         *
         * Called exactly once by the registry (returned element is cached).
         * The module is responsible for the full lifecycle of the returned DOM —
         * `destroy()` must clean up anything created here.
         *
         * @returns The root element of the tab content.
         */
        render(): HTMLElement;
    };
}

// ─── ICoreModule ──────────────────────────────────────────────────────────────

/**
 * Lifecycle contract for a GeoLeaf module that participates in boot.
 *
 * Modules are registered with `IModuleRegistry.register()` and initialised in
 * dependency order by `IModuleRegistry.init()`. Each module must implement
 * `init()` and `destroy()`, and declare its `dependencies` so the registry can
 * resolve the correct initialisation order.
 *
 * **Dependency declaration rules:**
 * - List only direct dependencies (not transitive).
 * - Reference dependencies by their `id` string.
 * - Circular dependencies are detected at registration time and throw a
 *   `GeoLeafError` with the full dependency cycle path in the message.
 *
 * ⚠ Classes implement THIS interface, never the {@link ICoreModule} union —
 * TypeScript's `implements` clause rejects union types.
 *
 * @example
 * ```typescript
 * class ExampleModule implements ILifecycleModule {
 *     readonly id = 'example';
 *     readonly dependencies = ['geojson'] as const;
 *     readonly ui: IModuleUISlot = { … };
 *
 *     async init(adapter: IMapAdapter, config: IGeoLeafConfig): Promise<void> {
 *         // … setup
 *     }
 *
 *     destroy(): void {
 *         // … cleanup
 *     }
 * }
 * ```
 */
export interface ILifecycleModule {
    /**
     * Unique module identifier within the GeoLeaf instance.
     *
     * The registry enforces uniqueness — registering two modules with the same
     * `id` throws a `GeoLeafError`. Use lowercase kebab-case.
     *
     * @example `'geojson'`, `'route'`, `'legend'`, `'layer-manager'`
     */
    readonly id: string;

    /**
     * IDs of modules that must be fully initialised before this module's
     * `init()` is called.
     *
     * The registry resolves a topological order from these declarations.
     * An empty array means this module has no dependencies.
     *
     * Use `as const` in implementing classes for best type inference:
     * ```typescript
     * readonly dependencies = ['poi', 'ui'] as const;
     * ```
     */
    readonly dependencies: readonly string[];

    /**
     * Optional UI slot declaration.
     *
     * Declare this when the module contributes UI to the mobile toolbar pill
     * or the desktop filter panel. The registry collects all slots via
     * `getUISlots()` and passes them to the UI orchestrator.
     */
    readonly ui?: IModuleUISlot;

    /**
     * Initialises the module.
     *
     * Called by the registry after all declared dependencies are ready.
     * Guaranteed postconditions at call time:
     * - `adapter.isReady()` returns `true`
     * - `config.isLoaded()` returns `true`
     * - All modules listed in `dependencies` have completed their `init()`
     *
     * Returning `void` (synchronous) is allowed for modules that do not
     * perform async work. The registry handles both with `Promise.resolve()`.
     *
     * @param adapter - Engine-agnostic map adapter (MapLibre).
     * @param config - Read-only configuration access.
     */
    init(adapter: IMapAdapter, config: IGeoLeafConfig): Promise<void> | void;

    /**
     * Tears down the module and releases all resources.
     *
     * Must remove every event listener, DOM node, and layer reference created
     * during `init()`. After `destroy()`, the module must be safe to garbage
     * collect.
     *
     * Called by the registry in reverse dependency order (dependants are
     * destroyed before their dependencies).
     */
    destroy(): void;
}

/**
 * A registration that contributes **only** a UI slot — no boot lifecycle.
 *
 * This is the shape a lazy plugin uses to place a toolbar pill or a desktop tab
 * without embarking any code at boot: the registry stores it for UI queries and
 * never calls lifecycle hooks on it.
 *
 * ⚠ This shape is **not** a recent addition — it is what `ModuleRegistry.register()`
 * has always accepted (`app/module-registry.ts:58-81` validates exactly these two
 * shapes) and what every plugin already passes. It was simply absent from the
 * contract, which declared `dependencies`, `init` and `destroy` as required. The
 * omission was invisible while the contract stayed private; publishing it (API
 * publique S3) is what forced the correction, since the 8 real call sites —
 * `addpoi/src/entry.ts:163,185`, `editor:446`, `geocoding:77`, `measure:57`,
 * `print:55`, `storage/…/toolbar-registration.ts:52` and `_plugin-template:50` —
 * would all have been rejected by the type they are supposed to satisfy.
 *
 * @example
 * ```typescript
 * GeoLeaf.registry.register({
 *     id: 'my-plugin',
 *     ui: { mobileIcon: { icon: '<svg …>', labelKey: '…', profileKey: '…', action: 'my-plugin' } },
 * });
 * ```
 */
export interface IUISlotModule {
    /**
     * Unique module identifier within the GeoLeaf instance.
     *
     * Same uniqueness rule as {@link ILifecycleModule.id} — the registry is
     * idempotent, so re-registering the same `id` is a silent no-op.
     */
    readonly id: string;

    /**
     * Declared dependencies, if any.
     *
     * Optional here (unlike {@link ILifecycleModule}) because a UI-only slot has
     * no `init()` to order. The registry reads it as `dependencies ?? []`
     * (`app/module-registry.ts:210,231,288`).
     */
    readonly dependencies?: readonly string[];

    /** UI slot declaration — **required**: it is the whole point of this shape. */
    readonly ui: IModuleUISlot;

    /** Never present. A slot carrying `init` is a {@link ILifecycleModule}. */
    init?: never;

    /** Never present. A slot carrying `destroy` is a {@link ILifecycleModule}. */
    destroy?: never;
}

/**
 * What `IModuleRegistry.register()` accepts — a lifecycle module **or** a
 * UI-only slot.
 *
 * The registry enforces the same disjunction at runtime: providing one of
 * `init`/`destroy` without the other throws, and providing neither without a
 * `ui` throws too (`app/module-registry.ts:58-81`).
 *
 * ⚠ Classes cannot `implements` a union. Implement {@link ILifecycleModule}
 * directly — the 19 in-core modules all do.
 */
export type ICoreModule = ILifecycleModule | IUISlotModule;

// ─── IModuleRegistry ──────────────────────────────────────────────────────────

/**
 * Orchestrates the GeoLeaf module lifecycle.
 *
 * The registry is the single entry point for module management:
 * - Modules are **registered** before `init()` is called.
 * - On `init()`, the registry performs a topological sort of all registered
 *   modules and calls each `module.init()` in the resolved order.
 * - On `destroy()`, modules are torn down in reverse initialisation order.
 *
 * The registry is exposed on the `GeoLeaf` namespace after Sprint 3 to allow
 * third-party modules to self-register:
 * ```typescript
 * GeoLeaf.registry.register(new MyCustomModule());
 * ```
 *
 * @example
 * ```typescript
 * const registry: IModuleRegistry = new ModuleRegistry();
 * registry.register(new ConfigModule());
 * registry.register(new GeoJSONModule());
 * await registry.init(adapter, config);
 *
 * const geojson = registry.get<GeoJSONModule>('geojson');
 * ```
 */
export interface IModuleRegistry {
    /**
     * Registers a module descriptor with the registry.
     *
     * Registration is only allowed before `init()` has been called.
     * Throws a `GeoLeafError` if:
     * - A module with the same `id` is already registered.
     * - `init()` has already been called on this registry instance.
     *
     * @param module - The module to register.
     */
    register(module: ICoreModule): void;

    /**
     * Resolves the dependency graph and initialises all registered modules
     * in topological order.
     *
     * Throws a `GeoLeafError` if a circular dependency is detected.
     * The error message includes the full cycle path (e.g. `"A → B → A"`).
     *
     * Returns a Promise that resolves when all modules have completed `init()`.
     * If any module's `init()` rejects, the returned Promise rejects with
     * that error (subsequent modules are not initialised).
     *
     * @param adapter - Engine-agnostic map adapter.
     * @param config - Read-only configuration access.
     */
    init(adapter: IMapAdapter, config: IGeoLeafConfig): Promise<void>;

    /**
     * Retrieves a registered module by its id, cast to type `T`.
     *
     * Throws a `GeoLeafError` when no module with the given id is registered.
     * Use `has()` first when presence is uncertain.
     *
     * @param id - The module's `id` string.
     * @throws `GeoLeafError` if no module with the given id exists.
     *
     * @example
     * ```typescript
     * const geojson = registry.get<GeoJSONModule>('geojson');
     * poi.displayPois(features);
     * ```
     */
    get<T extends ICoreModule = ICoreModule>(id: string): T;

    /**
     * Returns `true` if a module with the given id is registered.
     *
     * @param id - The module's `id` string.
     */
    has(id: string): boolean;

    /**
     * Returns `true` if `init()` has already been called on this registry.
     *
     * Use this guard before calling `register()` in contexts where the registry
     * may have already been initialised (e.g. double-boot scenarios).
     */
    isInitialized(): boolean;

    /**
     * Returns all registered modules in insertion order.
     *
     * The returned array is read-only — use `register()` to add modules.
     */
    getAll(): readonly ICoreModule[];

    /**
     * Collects and returns the `ui` slot of every module that declares one.
     *
     * Used by the UI orchestrator to build the mobile toolbar and the filter
     * panel tabs without coupling the UI layer to specific module classes.
     *
     * Returns an empty array when no module declares a UI slot.
     */
    getUISlots(): IModuleUISlot[];

    /**
     * Destroys all registered modules in reverse initialisation order.
     *
     * Each module's `destroy()` is called exactly once. Errors in individual
     * `destroy()` calls are logged but do not interrupt the teardown sequence —
     * all modules are destroyed regardless of individual failures.
     */
    destroy(): void;

    /**
     * Returns the schema of a registered module, or `null` if no module
     * with the given id is registered.
     *
     * The returned object is a lightweight metadata view — it does not expose
     * internal module state. `IModuleSchema` will be enriched in S2.1 when
     * capability schemas (config, capabilities, metadata) are defined.
     *
     * @param id - Module id (e.g. `'poi'`, `'route'`, `'search'`).
     */
    getModuleSchema(id: string): IModuleSchema | null;

    /**
     * Returns a read-only snapshot of all registered modules in insertion order.
     *
     * Includes both built-in modules (registered before `init()`) and lazily
     * registered plugin modules (registered after `init()`).
     */
    getActiveModules(): readonly IModuleInfo[];
}
