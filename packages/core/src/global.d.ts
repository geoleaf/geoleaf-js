/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Canonical ambient declarations for GeoLeaf's runtime globals.
 *
 * Single source of truth — supersedes the former competing declarations:
 *  - `GeoLeafNamespace` (was in `modules/built-in/ui/ui-api.ts`)
 *  - `GeoLeafGlobal` + `const GeoLeaf` (was in `modules/utils/general/dom-helpers.ts`)
 *  - `GeoLeafGlobal` (was local in `capabilities/legend/public-api.ts`)
 *
 * The `GeoLeaf` namespace is assembled incrementally across the B1→B11 boot phases
 * (and varies with which plugins are loaded), so members are typed where they are
 * stable and frequently accessed, with a top-level `[key: string]: unknown` fallback
 * for the long tail. Precision is meant to GROW release after release: each cleaned
 * domain promotes members from the `unknown` tail to explicit types — never widen
 * back to `any`.
 */

export {};

declare global {
    /** Event-delegation helper exposed on `GeoLeaf.Utils.events`. */
    interface GeoLeafUtilsEvents {
        on: (
            target: EventTarget | null,
            event: string,
            handler: EventListenerOrEventListenerObject,
            options?: boolean | AddEventListenerOptions,
            label?: string
        ) => number | null;
        off?: (id: number) => boolean;
    }

    /**
     * Canonical structural view of `GeoLeaf.ThemeSelector` — the theme switch bar
     * (in-core `theme-selector` capability, mounted by its installer).
     *
     * PROMOTED here from `capabilities/permalink/permalink-types.ts`, which had written
     * the only view of this surface for its own use (B.25); that module now aliases this
     * one rather than keeping a second, quietly divergent copy — its `getCurrentTheme`
     * declared `string | undefined` where `_state.currentTheme` is `string | null`
     * (theme-selector-state.ts), so `null` was outside the declared type at the one
     * call site that reads it.
     *
     * Narrow on purpose (the two members consumers actually reach for) with the usual
     * `unknown` tail — same posture as `_UITheme` / `Legend` above. Precision grows.
     */
    interface GeoLeafThemeSelector {
        /** Active theme id, or `null` before a theme is applied. */
        getCurrentTheme?: () => string | null | undefined;
        /** Applies a theme by id (resolves once the theme is loaded and applied). */
        setTheme?: (themeId: string) => Promise<void>;
        [key: string]: unknown;
    }

    /**
     * Local shortcut to the contract of the eleven top-level methods.
     *
     * `GeoLeafGlobal` references them member by member (`init?: GeoLeafTopLevelApi["init"]`)
     * rather than via `extends`: the repo's AST readers only iterate declared members, and
     * an inherited member would vanish from the view of every namespace gate.
     */
    type GeoLeafTopLevelApi = import("./contracts/top-level-api.contract.js").GeoLeafTopLevelApi;

    /**
     * `GeoLeaf.UI` — the kernel UI façade.
     *
     * ## Why a hand-written interface, and not a `typeof import(...)`
     *
     * `kernel/ui/ui-api.ts` does `const UI = _g.GeoLeaf.UI;` then re-exports it: the
     * exported value IS the namespace member. A `typeof import("./api/geoleaf.ui.js").UI`
     * is therefore structurally circular — measured, `tsc` emits `TS7022` then `TS2303`.
     * Most probably the reason this member used to be declared `Record<string, unknown>`:
     * the easy form does not compile.
     *
     * That is no reason to type nothing. The facade is mounted by mutation from ~10
     * modules; the 24 members below were read off the real assignment sites, and the named
     * interface breaks the cycle by depending on no value.
     *
     * ## The `[key: string]: unknown` tail is REMOVED (09/08/2026)
     *
     * ⚠️ **The motive that justified it here was false.** It said "`boot-core.ts` and
     * `init-features.ts` still set members outside this list". Measured: those two files
     * set **no** member on `GeoLeaf.UI` — their only `ui.` occurrences are config reads
     * (`init-features.ts`). The 6 genuinely missing members came from
     * `globals/globals.ui.ts` and the `offline-ui` plugin; they are declared below, read
     * off their assignment sites.
     *
     * **What the tail cost.** It made **any invented member** `unknown` — hence
     * indistinguishable from a real untyped one. `GeoLeaf.UI.toggleFilterPanel(true)` was
     * taught by the `@example` of `api/geoleaf.ui.ts` although that identifier never
     * existed in the repo, and the three documentation gates came out green on it.
     * Measured on 31/07/2026 (mutation `GeoLeaf.UI.cetteApiNExistePas("dark")` →
     * **GREEN**), with the conclusion: the benefit of compiling the examples grows with
     * the namespace's typing, and not otherwise.
     * Tail removed, a phantom member yields TS2339, which `typecheck-docs-examples.cjs`
     * knows.
     *
     * **No assignment site breaks**: `globals.ui.ts` writes through
     * `_gl.UI as Record<string, unknown>`, `cache-button.ts` through its own cast, and
     * `ui.module.ts` reads through the dynamic helper `member(obj: unknown, …)`.
     */
    interface GeoLeafUIFacade {
        /** Orchestrator version tag, set by `ui-api.ts`. */
        VERSION?: string;
        /** Build tag, set by `ui-api.ts`. */
        BUILD?: string;
        /** Boots the UI kernel (delegation, theme, containers). */
        init?: (options?: {
            map?: unknown;
            mapContainer?: HTMLElement;
            filterContainer?: HTMLElement;
            buttonSelector?: string;
            autoInitOnDomReady?: boolean;
            enableEventDelegation?: boolean;
            config?: unknown;
        }) => unknown;
        /** Tears listeners down and resets the delegation flag. */
        cleanup?: () => void;
        /** Availability report for the UI sub-modules. */
        getModuleStatus?: () => unknown;

        // Theme — thin re-bindings of `GeoLeaf._UITheme` (ui-api.ts:...).
        /**
         * Applies a theme by name.
         *
         * Sets the theme classes on `<body>` and `#geoleaf-map`, then dispatches
         * `geoleaf:ui-theme-changed`. ⚠️ Always prefer this over touching the CSS classes
         * directly — a manual `classList.add("gl-theme-dark")` skips the event, so anything
         * listening for the change never learns of it.
         *
         * @example
         * ```js
         * GeoLeaf.UI.applyTheme("dark");
         * ```
         */
        applyTheme?: (...args: unknown[]) => unknown;
        /** Alias of {@link GeoLeafUIFacade.applyTheme} — the SAME reference, by design. */
        setTheme?: (...args: unknown[]) => unknown;
        /**
         * The theme currently applied.
         *
         * @example
         * ```js
         * const theme = GeoLeaf.UI.getCurrentTheme(); // "dark"
         * ```
         */
        getCurrentTheme?: () => string;
        /** Applies the theme declared in the profile configuration. Called during boot. */
        initAutoTheme?: (...args: unknown[]) => unknown;
        /**
         * Wires a theme-toggle button, located by the configured `buttonSelector`.
         */
        initThemeToggle?: (...args: unknown[]) => unknown;
        /**
         * Switches to the other theme and applies it.
         *
         * @example
         * ```js
         * GeoLeaf.UI.toggleTheme(); // switches to "light"
         * ```
         */
        toggleTheme?: (...args: unknown[]) => unknown;

        // Notifications — bound methods of `GeoLeaf._UINotifications`.
        /**
         * The notification renderer, reachable through the UI façade.
         *
         * ⚠️ Typed `Record<string, unknown>`, so nothing here is arity-checked — the real
         * surface is the one documented on `NotificationSystem`. The `unknown`-typed
         * remainder only ever shrinks — never widened back.
         *
         * @example
         * ```js
         * GeoLeaf.UI.Notifications.success("Données chargées !");
         * GeoLeaf.UI.Notifications.error("Erreur réseau", 8000);
         * ```
         */
        Notifications?: Record<string, unknown>;
        /** Shows a toast of an explicit type. Bound form of `Notifications.show`. */
        showNotification?: (...args: unknown[]) => unknown;
        /** Shows a success toast. Bound form of `Notifications.success`. */
        showSuccess?: (...args: unknown[]) => unknown;
        /** Shows an error toast. Bound form of `Notifications.error`. */
        showError?: (...args: unknown[]) => unknown;
        /** Shows a warning toast. Bound form of `Notifications.warning`. */
        showWarning?: (...args: unknown[]) => unknown;
        /** Shows an informational toast. Bound form of `Notifications.info`. */
        showInfo?: (...args: unknown[]) => unknown;
        /** Dismisses every visible toast and empties the queue. */
        clearNotifications?: (...args: unknown[]) => unknown;

        // ── The 6 members the tail used to cover, declared on 09/08/2026 ─────────────────
        // Read off their assignment sites, not guessed. Without them, removing the tail
        // would replay a collateral already paid once: members properly mounted at
        // runtime, become unreachable at the type level.

        /**
         * Rich toast surface — the KERNEL one, mounted by `globals/globals.ui.ts`.
         *
         * Distinct from {@link GeoLeafUIFacade.Notifications}: `notify` is the anchor-B2
         * adapter that reads the renderer back lazily, so a build without the
         * `toast-renderer` capability degrades to a silent no-op instead of throwing.
         *
         * ⚠️ Optional chaining is not cosmetic here: without a writer the member is
         * absent, and `GeoLeaf.UI.notify.success(…)` throws. It is also what avoids
         * adding a baseline entry to `typecheck-docs-examples`.
         *
         * @example
         * ```js
         * GeoLeaf.UI.notify?.success?.("Couche enregistrée");
         * ```
         */
        notify?: {
            info?: (msg: string, opts?: number | Record<string, unknown>) => unknown;
            warn?: (msg: string, opts?: number | Record<string, unknown>) => unknown;
            error?: (msg: string, opts?: number | Record<string, unknown>) => unknown;
            success?: (msg: string, opts?: number | Record<string, unknown>) => unknown;
            dismiss?: (id: HTMLElement) => unknown;
        };
        // ⚠️ The six entries below used to cite `globals/globals.ui.ts` through
        // `:210`. The numbers were removed on 13/08/2026: lines were inserted into that
        // file and the four citations all went false at once, with no gate able to see
        // it. The function name, on the other hand, does not drift.
        /** Mounts the mobile toolbar. Set by `setupUIKernel()` in `globals/globals.ui.ts`. */
        initMobileToolbar?: typeof import("./kernel/ui/mobile/mobile-toolbar.js").initMobileToolbar;
        /** Mounts the desktop side-panel. Set by `setupUIKernel()`. */
        initDesktopPanel?: typeof import("./kernel/ui/desktop/desktop-panel.js").initDesktopPanel;
        /** Reveals the desktop side-panel. Set by `setupUIKernel()`. */
        activateDesktopPanel?: typeof import("./kernel/ui/desktop/desktop-panel.js").activateDesktopPanel;
        /** Tears the desktop side-panel down. Set by `setupUIKernel()`. */
        destroyDesktopPanel?: typeof import("./kernel/ui/desktop/desktop-panel.js").destroyDesktopPanel;
        /**
         * Opens a side-panel tab by id, **without toggling** — calling it twice with the same
         * id leaves the panel open.
         *
         * ⚠️ This is what separates it from a click on the tab, which closes an already-open
         * tab. Set by `setupUIKernel()`.
         *
         * @example
         * ```js
         * GeoLeaf?.UI?.openPanel("layers"); // true
         * GeoLeaf?.UI?.openPanel("layers"); // true — not a toggle
         * ```
         */
        openPanel?: typeof import("./kernel/ui/desktop/desktop-panel.js").openPanel;
        /**
         * Closes whichever side-panel tab is open. A no-op when none is.
         *
         * @example
         * ```js
         * GeoLeaf?.UI?.closePanel();
         * ```
         */
        closePanel?: typeof import("./kernel/ui/desktop/desktop-panel.js").closePanel;
        /**
         * The id of the open side-panel tab, or `null` when closed or not built.
         *
         * @example
         * ```js
         * GeoLeaf?.UI?.openPanel("legend");
         * GeoLeaf?.UI?.getOpenPanel(); // "legend"
         * ```
         */
        getOpenPanel?: typeof import("./kernel/ui/desktop/desktop-panel.js").getOpenPanel;

        /**
         * Offers a panel surface to whichever host is live — the desktop side panel above
         * 1440px, the mobile sheet below it.
         *
         * The host ADOPTS the element named by `selector`: it moves the node, and puts it
         * back where it came from on close. Register before or after boot; a registration
         * arriving late is synced into an already-built panel.
         *
         * @example
         * ```js
         * GeoLeaf?.UI?.registerPanelPane({
         *     id: "routing",
         *     labelKey: "routing.toolbar.button",
         *     selector: ".gl-routing-panel",
         * });
         * ```
         */
        registerPanelPane?: typeof import("./kernel/ui/panel-panes.js").registerPanelPane;

        /**
         * Opens a registered pane on whichever host is live.
         *
         * ⚠️ Prefer this to {@link GeoLeafUIFacade.openPanel} from a plugin: `openPanel`
         * drives the DESKTOP panel and answers `false` below its breakpoint, where the same
         * content belongs in the mobile sheet. A caller reacting to a click on a feature
         * cannot be asked to know which surface the current width implies.
         *
         * @example
         * ```js
         * GeoLeaf?.UI?.openPane("routing"); // true at any width
         * ```
         */
        openPane?: typeof import("./kernel/ui/panel-panes.js").openPane;

        /** Closes the pane on every live host. */
        closePane?: typeof import("./kernel/ui/panel-panes.js").closePane;

        /**
         * Turns the immersive UI mode on or off — strips the chrome the kernel owns, and
         * optionally asks for browser fullscreen.
         *
         * @example
         * ```js
         * GeoLeaf?.UI?.setImmersive(true, { fullscreen: true });
         * ```
         */
        setImmersive?: typeof import("./kernel/ui/immersive.js").setImmersive;

        /** Whether the document is currently in immersive mode. */
        isImmersive?: typeof import("./kernel/ui/immersive.js").isImmersive;
        /**
         * Offline cache button — mounted by the `offline-ui` PLUGIN
         * (`ui/cache-button.ts`), read by `app/boot-modules/ui.module.ts`.
         *
         * ⚠️ Typed STRUCTURALLY on purpose. The `no-plugin-in-core` rule
         * (`scripts/verify-core-standalone.cjs`) forbids the core to name
         * `@geoleaf-plugins/*`: a `typeof import(...)` is unavailable here, and that is
         * not a shortcut but the architecture boundary. The member stays optional — a
         * build without the plugin has no writer.
         */
        CacheButton?: {
            init?: (map: unknown, cfg: Record<string, unknown>) => unknown;
            openModal?: () => unknown;
            closeModal?: () => unknown;
            Modules?: Record<string, unknown>;
        };
    }

    /**
     * `GeoLeaf.Baselayers` and its alias `GeoLeaf.BaseLayers`.
     *
     * ⚠️ ONE alias, ONE type. `globals.api.ts` assigns the SAME reference to both names;
     * declaring them separately would let the two drift with nothing to notice — both names sit
     * in the post-boot oracle, so the namespace gates are satisfied by their mere presence.
     */
    type GeoLeafBaselayersFacade = typeof import("./api/geoleaf.baselayers.js").Baselayers;

    /** `GeoLeaf.Events` and its lowercase alias `GeoLeaf.events` — same reference, one type. */
    type GeoLeafEventsFacade = typeof import("./api/geoleaf.events.js").Events;

    /**
     * `GeoLeaf.API` — the seven constructors assembled as an object literal by
     * `globals.api.ts`.
     *
     * Written out rather than pointed at `contracts/api.contract.ts`'s
     * `IGeoLeafAPIConstructors`: that one declares only the three Phase-7 aliases, so
     * referencing it would have typed under half the object while looking complete.
     */
    interface GeoLeafApiConstructors {
        Controller?: typeof import("./kernel/api/controller.js").APIController;
        FactoryManager?: typeof import("./kernel/api/factory-manager.js").APIFactoryManager;
        InitializationManager?: typeof import("./kernel/api/initialization-manager.js").APIInitializationManager;
        ModuleManager?: typeof import("./kernel/api/module-manager.js").APIModuleManager;
        /** Phase-7 alias — `controller.js._getManagerClass()` looks the managers up by these. */
        APIModuleManager?: typeof import("./kernel/api/module-manager.js").APIModuleManager;
        APIInitializationManager?: typeof import("./kernel/api/initialization-manager.js").APIInitializationManager;
        APIFactoryManager?: typeof import("./kernel/api/factory-manager.js").APIFactoryManager;
    }

    /**
     * Canonical shape of the global `GeoLeaf` namespace.
     * All members are optional (assembled at boot) and tolerate extra keys.
     */
    interface GeoLeafGlobal {
        /**
         * `GeoLeaf.DEBUG` — debug mode, set by the INTEGRATOR, never by the library.
         *
         * `getDebugMode()` reads it at call time, precisely so that setting
         * `window.GeoLeaf.DEBUG = true` after boot takes effect without a reload.
         *
         * ⚠️ It was missing from this contract until 19/08/2026, and the gap was invisible from
         * the inside: nothing here writes it, so no gate that watches what the library MOUNTS
         * could see it. An integrator following the accessor's own instruction got
         * `TS2339: Property 'DEBUG' does not exist on type 'GeoLeafGlobal'` — the top-level
         * index signature that used to absorb it is gone, deliberately, so a member only
         * reachable through it became unreachable. A read-only member of the public surface is
         * declared here or it does not exist for the consumer.
         */
        DEBUG?: boolean;
        /**
         * `GeoLeaf.UI` — the kernel UI facade.
         *
         * ⚠️ Long declared `Record<string, unknown>`, it was counted among the "typed"
         * members while verifying nothing: that type accepts any object and yields
         * `unknown` on every access, exactly like the tail it was supposed to replace.
         * HOST-06 (`check-namespace-typing-coverage.cjs`) found it, by refusing to count
         * an empty declaration as typing.
         *
         * ⚠️ `globals.ui.ts` sets `_gl.UI = {}` when absent: every member of
         * {@link GeoLeafUIFacade} is therefore optional. And its typing canNOT go through
         * `typeof import(...)` — the facade is self-mounted, the detail sits on the
         * interface.
         */
        UI?: GeoLeafUIFacade;
        _UITheme?: {
            initThemeToggle: (...args: unknown[]) => unknown;
            initAutoTheme: (...args: unknown[]) => unknown;
            toggleTheme: (...args: unknown[]) => unknown;
            applyTheme: (...args: unknown[]) => unknown;
            getCurrentTheme: () => string;
            [key: string]: unknown;
        };
        _UINotifications?: {
            show: (...args: unknown[]) => unknown;
            success: (...args: unknown[]) => unknown;
            error: (...args: unknown[]) => unknown;
            warning: (...args: unknown[]) => unknown;
            info: (...args: unknown[]) => unknown;
            clearAll: (...args: unknown[]) => unknown;
            enable: (...args: unknown[]) => unknown;
            disable: (...args: unknown[]) => unknown;
            getStatus: (...args: unknown[]) => unknown;
            [key: string]: unknown;
        };
        _UIEventDelegation?: {
            attachAccordionEvents: (...args: unknown[]) => unknown;
            cleanupAllListeners: () => number;
            [key: string]: unknown;
        };
        /** Public `GeoLeaf.Filter` facade — generic attribute filter capability (S5/S13). */
        Filter?: {
            /** Whether the capability is active — mirrors the `modules.filter.enabled` gate. */
            isEnabled(): boolean;
            /** The resolved filter configuration for the active profile. */
            getConfig(): unknown;
            /** The filter state currently applied to the map. */
            getActiveFilter(): unknown;
            /** Applies a filter state (debounced — see {@link applyNow} to flush immediately). */
            applyFilter(state: unknown): void;
            /** Flushes the pending debounced filter immediately. */
            applyNow(): void;
            /** Clears every active filter and restores the unfiltered view. */
            reset(): void;
            /** Whether at least one filter is currently narrowing the view. */
            hasActiveFilters(): boolean;
            /** Proximity (radius-around-a-point) sub-filter. */
            proximity: {
                /** Sets the proximity radius, in kilometres. */
                setRadius(radiusKm: number): void;
                /**
                 * Toggles proximity mode. Returns the resulting state: `true` once the map is
                 * waiting for the user to place the centre point, `false` when switched off.
                 */
                toggle(
                    map: unknown,
                    radiusKm?: number,
                    options?: { onPointPlaced?: () => void }
                ): boolean;
            };
        };
        Config?: {
            get(key: string, def?: unknown): unknown;
            getAll(): Record<string, unknown>;
            /**
             * Enriched active profile. Its `layers` array carries the **complete** layer
             * configurations — unlike `getAllLayerConfigs()`, which is a whitelist
             * projection and carries neither `offline`, nor `data`, nor `write`.
             *
             * ⚠️ `Config.Profile` is NOT mounted here, although the `Config` module
             * carries it: measured in a browser. Go through `getActiveProfile()`.
             */
            getActiveProfile?(): unknown;
            /**
             * Drops the cached `themes.json` of a profile, so the next theme read goes back
             * to its source.
             *
             * Clears **one** profile when `profileId` is given, **all** of them otherwise —
             * and in both cases the in-flight loading promises too, so a reload started
             * before the call cannot repopulate the cache behind it.
             *
             * ⚠️ This is the cache of the theme **configuration**, not the IndexedDB cache of
             * layer data — that one is `GeoLeaf.ThemeCache`, a trap homonym.
             *
             * @param profileId - Profile to clear. Omit to clear every profile.
             *
             * @example
             * ```js
             * GeoLeaf?.Config?.clearThemesCache("reunion-eclairage");
             * GeoLeaf?.Config?.clearThemesCache(); // every profile
             * ```
             */
            clearThemesCache(profileId?: string): void;
            [key: string]: unknown;
        };
        Utils?: {
            createElement?: (
                tag: string,
                props: Record<string, unknown>,
                ...children: unknown[]
            ) => HTMLElement;
            events?: GeoLeafUtilsEvents;
            [key: string]: unknown;
        };
        DOMSecurity?: {
            setSafeHTML(element: HTMLElement, html: string): void;
            [key: string]: unknown;
        };
        Security?: { escapeHtml?: (s: unknown) => string; [key: string]: unknown };
        /**
         * Legend facade (`GeoLeaf.Legend`).
         *
         * ⚠️ The 8 members below were **implemented and documented** in
         * `capabilities/legend/legend.ts` — `@example` included — but **not declared
         * here**, hence absent from the `GeoLeafGlobal` page TypeDoc renders and an
         * integrator reads, until 11/08/2026. The `[key: string]: unknown` tail remains —
         * it only ever shrinks.
         */
        Legend?: {
            /** Mounts the legend on a map. Returns `false` when mounting fails. */
            init(mapInstance: unknown, options?: Record<string, unknown>): boolean;
            /** Loads and renders a layer's legend entry, for a given style. */
            loadLayerLegend(layerId: string, styleId: string, layerConfig: unknown): void;
            /** Shows or hides a layer from the legend. */
            setLayerVisibility(layerId: string, visible: boolean): void;
            /** Every layer the legend knows, indexed by identifier. */
            getAllLayers(): Map<string, unknown>;
            /** Hides the panel without unmounting it — layer state is preserved. */
            hideLegend(): void;
            /** Unmounts the panel and releases its listeners. */
            removeLegend(): void;
            /** Whether the panel is currently visible. */
            isLegendVisible(): boolean;
            /** Collapses or expands a layer's section. */
            toggleAccordion: (id: string) => void;
            [key: string]: unknown;
        };
        /** Taxonomy capability facade (in-core, gated by `modules.taxonomy`). */
        Taxonomy?: {
            isEnabled(): boolean;
            getIcons(): import("./capabilities/taxonomy/types.js").TaxonomyIconsConfig | null;
            getCategories(
                ref: string
            ): Record<string, import("./capabilities/taxonomy/types.js").TaxonomyCategory>;
            getFieldMappings(
                ref: string
            ): import("./capabilities/taxonomy/types.js").TaxonomyFieldMappings;
            /**
             * The `value → symbol` table of a given layer (empty when the layer declares
             * no taxonomy). Implemented and documented in
             * `capabilities/taxonomy/public-api.ts`, but not declared here until
             * 11/08/2026.
             */
            getLayerCategories(
                layerId: string
            ): Record<string, import("./capabilities/taxonomy/types.js").TaxonomyCategory>;
            /** Resolves a point's sprite icon, accounting for its category and tint. */
            resolvePoiIcon(
                poi: import("./capabilities/taxonomy/resolver.js").TaxonomyFeatureLike
            ): import("./capabilities/taxonomy/types.js").ResolvedIcon;
            /**
             * Every (icon × tint) pair the config references, so the MapLibre adapter can
             * rasterise and register them. Empty when nothing is tinted.
             */
            getIconVariants(): import("./capabilities/taxonomy/types.js").TaxonomyIconVariant[];
            /** MapLibre paint of a marker layer, or `null` when taxonomy does not apply. */
            resolveMarkerPaint(
                layerId: string,
                existingPaint: Record<string, unknown>
            ): Record<string, unknown> | null;
            /**
             * The `symbolId` of the icon to show next to a feature's TITLE on a
             * feature-info surface, honouring the per-surface `render` flags
             * (priority: subcategory → category → default).
             */
            resolveTitleIcon(
                layerId: string,
                feature: import("./capabilities/taxonomy/resolver.js").TaxonomyFeatureLike,
                surface: import("./capabilities/taxonomy/types.js").TaxonomySurface
            ): string | null;
            /** A field's badge style, or `null` when none applies. */
            resolveBadgeStyle(
                layerId: string,
                feature: import("./capabilities/taxonomy/resolver.js").TaxonomyFeatureLike,
                surface: import("./capabilities/taxonomy/types.js").TaxonomySurface,
                field: string
            ): import("./capabilities/taxonomy/types.js").ResolvedBadgeStyle | null;
            /**
             * Guarantees the active profile's SVG sprite (its `<symbol>` elements) is in
             * the DOM, so a `<use href="#…">` can reference it. Non-blocking and
             * idempotent — the loader deduplicates.
             */
            ensureSprite(): void;
            [key: string]: unknown;
        };
        _LegendControl?: { create: (opts: unknown) => unknown; [key: string]: unknown };
        _LegendGenerator?: {
            generateLegendFromStyle: (
                styleData: unknown,
                geometryType: string,
                taxonomyData: unknown
            ) => unknown;
            [key: string]: unknown;
        };
        /**
         * `GeoLeaf._LayerVisibilityManager` — **a contract of fact, deliberately NOT
         * promoted.**
         *
         * Its promotion to `GeoLeaf.Layers.getVisibilityState()` was examined and set
         * aside, for two measured reasons:
         *
         * 1. **It would have removed no key.** The announced motive was "promote, then
         *    remove `_LayerVisibilityManager` from the namespace" — impossible: the CORE
         *    itself re-reads it through the global at **5 sites**, with 3 different
         *    methods (`kernel/geojson/layers/visibility.ts` and
         *    `capabilities/legend/legend.ts`). Promotion only bought a typed path for
         *    `plugin-table`, at the price of one more public entry.
         *
         * 2. **The shape is a trap, and publishing would engrave it.**
         *    `getVisibilityState()` returns 6 fields, among them `current` — the PHYSICAL
         *    visibility, which zoom forces to `false` — and `logicalState`, the user's
         *    intent. Reading `current` to drive a toggle is a bug that was ALREADY
         *    committed once. And `plugin-table`'s 2 sites read exactly `current`.
         *    Publishing into `LayerDataApi` is irreversible (rule: subpaths are added,
         *    never removed).
         *
         * De-facto readers, outside the core: `packages/plugins/table/src/panel.ts`
         * and `src/table-layer.ts`. They stay on this key, knowingly.
         */
        _LayerVisibilityManager?: {
            getVisibilityState: (layerId: string) => { current?: boolean } | null;
            [key: string]: unknown;
        };
        /**
         * `GeoLeaf.Sync` — the offline sync-handler registry seam (S14 Phase B).
         *
         * A **public API of fact** (B.25): it is how a data plugin pushes its offline
         * sync handler into the core (`@geoleaf-plugins/editor` does
         * `GeoLeaf.Sync.registerHandler("poi", EditorSyncHandler)` at its own `entry.ts`),
         * and the offline engine reads them back at replay time. It was reachable and
         * documented but typed NOWHERE — a third-party plugin integrated against
         * `unknown`. Mounted twice on purpose: `geoleaf.sync.ts` self-mounts at import
         * so a plugin can register before boot completes, and `offline/install.ts`
         * re-assigns the same singleton (Layer B).
         */
        Sync?: {
            /** Register (or replace) a handler under a stable id (e.g. `"poi"`). */
            registerHandler(
                id: string,
                handler: import("./kernel/shared/sync-handler-seam.js").SyncHandler
            ): void;
            /** The handler registered under `id`, or `undefined`. */
            getHandler(
                id: string
            ): import("./kernel/shared/sync-handler-seam.js").SyncHandler | undefined;
            /** Every registered handler, in registration order. */
        };
        /** Theme switch bar — in-core `theme-selector` capability (see above). */
        ThemeSelector?: GeoLeafThemeSelector;
        /**
         * `GeoLeaf._VectorTiles` — the MVT policy seam published by the `vector-tiles`
         * installer. Internal (underscore), but read through the global by two kernel
         * modules that each wrote their own narrow `VectorTilesLike` — and the two were
         * DISJOINT (`loader-types.ts` declares `shouldUseVectorTiles` /
         * `loadVectorTileLayer`, `layer-manager/style.ts` declares `updateLayerStyle`),
         * so neither described the seam. Typed here as the capability's own export, the
         * only shape that covers both (B.25).
         */
        _VectorTiles?: typeof import("./capabilities/vector-tiles/vector-tiles.js").VectorTiles;
        /**
         * `GeoLeaf._Cluster` — the bag of PURE resolvers the `cluster` installer
         * publishes for the GeoJSON loader. Same mechanism as `_VectorTiles` just above,
         * and the same motive: a build that leaves the capability out has **no writer**,
         * the loader falls back to `{ shouldCluster: false }`, and the core imports
         * nothing statically.
         *
         * ⚠️ This is NOT the whole module: the installer writes only two members
         * (`install.ts`). Typing them via `typeof import(...)` keeps them tied to the
         * SOURCE — a signature hand-copied here would drift with nothing saying so, which
         * is exactly the defect `_VectorTiles` documents for its two disjoint local
         * views.
         *
         * 📌 The reader's local view, `ClusterResolversLike` (`loader/loader-types.ts`),
         * widens `def`/`geojsonData` to `unknown` and COPIES the return shape. It agrees
         * with the source as of 23/08/2026 — `ClusterStrategyResult` is indeed
         * `{ shouldCluster, useSharedCluster }` — but nothing holds it there: the
         * local-views guard compares NAMES, not SHAPES, and says so.
         */
        _Cluster?: {
            getClusteringStrategy: typeof import("./capabilities/cluster/strategy.js").getClusteringStrategy;
            applyGeoJSONClusterOptions: typeof import("./capabilities/cluster/options.js").applyGeoJSONClusterOptions;
        };
        Introspection?: import("./contracts/introspection.contract.js").IIntrospectionAPI;
        /** Capability-unavailable bus — `declareUnavailable` / `onUnavailable`. */
        Capabilities?: import("./contracts/capability.contract.js").ICapabilitiesAPI;
        Layers?: import("./contracts/layer-data.contract.js").LayerDataApi;
        /** In-core geolocation capability seam (GPS state + config helpers). */
        Geolocation?: import("./capabilities/geolocation/public-api.js").GeolocationPublicApi;

        // ── The 11 capability facades mounted on the namespace ──
        //
        // They all fell into the `[key: string]: unknown` tail: `GeoLeaf.Scale.show()`
        // checked no better than `GeoLeaf.Scale.nimportequoi()`. `Geolocation` above was
        // the only precedent — this batch generalises it to the other ten.
        //
        // Four deviate from the `capabilities/<name>/public-api.js` pattern, and the
        // pre-flight found them one by one rather than assuming:
        //   • `Share` is not a top-level capability — it lives under `permalink/`;
        //   • `NotificationSystem` is a CLASS, mounted from `toast-renderer/renderer/`,
        //     a directory whose name does not resemble the key;
        //   • `FeatureInfoPublicApi` is declared in `types.ts`, not re-exported by its
        //     facade;
        //   • `Cluster`, `PWA` and `Permalink` have NO named public type. They take
        //     `typeof import(...)` of the value: the compiler infers the exact shape,
        //     which is precise, not a compromise. `pwa/public-api.ts` explicitly
        //     motivates its refusal of a `PWAPublicApi` — we do not fabricate one in
        //     passing.

        /** Branding overlay (logo, attribution) — `GeoLeaf.Branding`. */
        Branding?: import("./capabilities/branding/public-api.js").BrandingPublicApi;
        /** POI clustering controls — `GeoLeaf.Cluster`. */
        Cluster?: import("./capabilities/cluster/public-api.js").ClusterPublicApi;
        /** Coordinate readout control — `GeoLeaf.Coordinates`. */
        Coordinates?: import("./capabilities/coordinates/public-api.js").CoordinatesPublicApi;
        /** Feature detail panel — `GeoLeaf.FeatureInfo`. Type declared in `types.ts`. */
        FeatureInfo?: import("./capabilities/feature-info/types.js").FeatureInfoPublicApi;
        /** Map labels toggle + renderer — `GeoLeaf.Labels`. */
        Labels?: import("./capabilities/labels/public-api.js").LabelsPublicApi;
        /** Toast/notification CLASS mounted by the `toast-renderer` installer. */
        NotificationSystem?: typeof import("./capabilities/toast-renderer/notifications.js").NotificationSystem;
        /** PWA install/update manager — `GeoLeaf.PWA`. No named public type, see above. */
        PWA?: typeof import("./capabilities/pwa/public-api.js").PWA;
        /** URL state serialisation — `GeoLeaf.Permalink`. No named public type. */
        Permalink?: typeof import("./capabilities/permalink/public-api.js").Permalink;
        /** Scale bar control — `GeoLeaf.Scale`. */
        Scale?: import("./capabilities/scale/public-api.js").ScalePublicApi;

        /** Data-profile selector — `GeoLeaf.ProfileSwitcher`. */
        ProfileSwitcher?: import("./capabilities/profile-switcher/public-api.js").ProfileSwitcherPublicApi;
        /** UI language selector — `GeoLeaf.LanguageSwitcher`. */
        LanguageSwitcher?: import("./capabilities/language-switcher/public-api.js").LanguageSwitcherPublicApi;
        /** Accent-colour palette — `GeoLeaf.ThemePalette`. */
        ThemePalette?: import("./capabilities/theme-palette/public-api.js").ThemePalettePublicApi;
        /** Share sheet — `GeoLeaf.Share`, subdirectory of the `permalink` capability. */
        Share?: import("./capabilities/permalink/share/public-api.js").SharePublicApi;
        /** Light/dark toggle — `GeoLeaf.ThemeToggle`. */
        ThemeToggle?: import("./capabilities/theme-toggle/public-api.js").ThemeTogglePublicApi;

        // ── The kernel facades ──
        //
        // ⚠️ The two ALIAS pairs share ONE type, never twin declarations.
        // `_gl.BaseLayers = Baselayers` (globals.api.ts) and `_gl.events = Events`
        // (:100) point at the SAME reference: two independent declarations could diverge
        // with no gate seeing it, since both names sit in the oracle and HOST-04 is
        // satisfied by their mere presence.
        //
        // ⚠️ Five do not come from `api/`, unlike the pattern: `CONSTANTS` and `Errors`
        // are set by `globals.core.ts`, `ThemeCache` by `globals.ui.ts`, and
        // `version` is a string. Pre-flown file by file rather than assumed.

        /** Base layer catalogue façade. */
        Baselayers?: GeoLeafBaselayersFacade;
        /** Historical alias of {@link GeoLeafGlobal.Baselayers} — same reference, same type. */
        BaseLayers?: GeoLeafBaselayersFacade;
        /** Typed event bus façade (`on`/`off`/`once`/`dispatch`). */
        Events?: GeoLeafEventsFacade;
        /** Lowercase alias of {@link GeoLeafGlobal.Events} — same reference, same type. */
        events?: GeoLeafEventsFacade;
        /** Frozen runtime constants — set by `globals.core.ts`. */
        CONSTANTS?: typeof import("./utils/constants/constants.js").CONSTANTS;
        /** Error helpers — set by `globals.core.ts`. */
        Errors?: typeof import("./utils/errors/errors.js").Errors;
        /** General-purpose helpers façade. */
        Helpers?: typeof import("./api/geoleaf.helpers.js").Helpers;
        /** Layer manager façade (visibility, ordering, legend wiring). */
        LayerManager?: typeof import("./api/geoleaf.layer-manager.js").LayerManager;
        /** Theme cache — set by `globals.ui.ts`, outside the facade chain. */
        ThemeCache?: typeof import("./kernel/themes/theme-cache.js").ThemeCache;
        /** Style/config validators façade. */
        Validators?: typeof import("./api/geoleaf.validators.js").Validators;
        /**
         * Package version string.
         *
         * ✅ **A single writer**: `globals/globals.api.ts`, under an `if (!_gl.version)`
         * guard — which makes `setupAPIKernel()` re-callable without overwriting an
         * already-set version.
         *
         * ⚠️ This note used to say "Written in TWO places: `globals.api.ts` […] and
         * `kernel/api/geoleaf-api.ts` unguarded. Last writer wins" — that was true,
         * and **both line numbers had drifted** (208 and 164 by the time of removal). A
         * line citation in a comment ages silently; this one now points only at the
         * file.
         */
        version?: string;
        /**
         * `GeoLeaf.API` — the API constructors, assembled as a literal by
         * `globals.api.ts`.
         *
         * ⚠️ Hand-written, and that is measured: `contracts/api.contract.ts` does
         * declare `IGeoLeafAPIConstructors`, but it covers only the **3 aliases**, not
         * the 7 keys actually set. Referencing it would have typed under half the object
         * while looking like it typed it — the defect HOST-06 hunts, one level up.
         */
        API?: GeoLeafApiConstructors;

        // ── The top-level methods and values ──
        //
        // ⚠️ The eleven methods are referenced MEMBER BY MEMBER from
        // `GeoLeafTopLevelApi`, and never via `extends`. The repo's AST readers
        // (`scripts/lib/ts-decl-read.cjs`) iterate DECLARED members only: an inherited
        // member would be invisible to them, and HOST-02/HOST-04 would silently loosen
        // on eleven keys at once. The reader in fact refuses to conclude on an `extends`
        // clause since their member-by-member declaration — precisely so this trap can
        // never re-arm.
        //
        // ⚠️ And this is not decoration: `globals.api.ts` types its `_gl` as
        // `GeoLeafRuntime = ReturnType<typeof ensureGeoLeaf>`, that is `GeoLeafGlobal`.
        // Declaring here therefore makes the compiler CHECK the eleven assignments of
        // `defineApiMethods`. This is the UMD side of the link; the ESM side `satisfies`
        // it.

        /** {@inheritDoc GeoLeafTopLevelApi.init} */
        init?: GeoLeafTopLevelApi["init"];
        /** {@inheritDoc GeoLeafTopLevelApi.setTheme} */
        setTheme?: GeoLeafTopLevelApi["setTheme"];
        /** {@inheritDoc GeoLeafTopLevelApi.loadConfig} */
        loadConfig?: GeoLeafTopLevelApi["loadConfig"];
        /** {@inheritDoc GeoLeafTopLevelApi.createMap} */
        createMap?: GeoLeafTopLevelApi["createMap"];
        /** {@inheritDoc GeoLeafTopLevelApi.getMap} */
        getMap?: GeoLeafTopLevelApi["getMap"];
        /** {@inheritDoc GeoLeafTopLevelApi.getAllMaps} */
        getAllMaps?: GeoLeafTopLevelApi["getAllMaps"];
        /** {@inheritDoc GeoLeafTopLevelApi.getModule} */
        getModule?: GeoLeafTopLevelApi["getModule"];
        /** {@inheritDoc GeoLeafTopLevelApi.hasModule} */
        hasModule?: GeoLeafTopLevelApi["hasModule"];
        /** {@inheritDoc GeoLeafTopLevelApi.getNamespace} */
        getNamespace?: GeoLeafTopLevelApi["getNamespace"];
        /** {@inheritDoc GeoLeafTopLevelApi.getHealth} */
        getHealth?: GeoLeafTopLevelApi["getHealth"];
        /** {@inheritDoc GeoLeafTopLevelApi.getMetrics} */
        getMetrics?: GeoLeafTopLevelApi["getMetrics"];

        // ── C1 — the four top-level values ──
        //
        // `fetch`, `get` and `post` are BOUND methods of `FetchHelper`
        // (`globals.core.ts` does `.bind(FetchHelper)`), hence indexing the
        // method's type rather than a `typeof` of the whole object.

        /** `FetchHelper.fetch`, bound — instrumented HTTP request. */
        fetch?: (typeof import("./utils/general/fetch-helper.js").FetchHelper)["fetch"];
        /** `FetchHelper.get`, bound. */
        get?: (typeof import("./utils/general/fetch-helper.js").FetchHelper)["get"];
        /** `FetchHelper.post`, bound. */
        post?: (typeof import("./utils/general/fetch-helper.js").FetchHelper)["post"];
        /** Boot report (⚠️ lowercase on the namespace side, `BootInfo` on the module side). */
        bootInfo?: typeof import("./kernel/api/boot-info.js").BootInfo;

        // ── C3 — boot and the five performance measures ──

        /**
         * Starts the GeoLeaf application: loads the profile, creates the map, initialises
         * the modules. This is the application entry — `apps/geoleaf-app/init.js` calls
         * it, and the load order of every plugin refers to it.
         *
         * ⚠️ Not to be confused with {@link GeoLeafGlobal.init}, the manual wrapper
         * around `Core.init()`. The boot path goes through `registry.init()` — the
         * ModuleRegistry's — and never calls `GeoLeaf.init`.
         *
         * The two options are the only channel through which a host sets an auth gate
         * (SSO) or retrieves the startup metrics; they are re-read from
         * `_beforeBootCallback` and `_perfCallback`. Those two stay out of this contract:
         * they are service-locator keys, `_`-prefixed because they are internal to the
         * core and no integrator has to write them — they are the channel, not the
         * rendezvous.
         */
        boot?: (options?: {
            /**
             * Configuration handed over IN MEMORY. When present it is applied as-is and
             * no request is emitted to fetch one. Takes precedence over `configUrl`.
             *
             * ⚠️ An empty object `{}` is a VALID inline configuration, exactly as for
             * `GeoLeaf.loadConfig` — the two bootstrap paths never diverge on the same
             * value.
             */
            config?: Record<string, unknown>;
            /**
             * Explicit URL to load the configuration from. Used when `config` is absent.
             * With neither, the path stays INFERRED from the host page — unchanged.
             */
            configUrl?: string;
            /** Called after config load, before the map. Throwing aborts the boot. */
            beforeBoot?: (context: {
                config: Readonly<Record<string, unknown>>;
            }) => Promise<void> | void;
            /** Receives the startup metrics after `geoleaf:app:ready`. */
            onPerformanceMetrics?: (metrics: {
                timeToMapReadyMs: number | null;
                timeToAppReadyMs: number | null;
                startupTotalMs: number | null;
                capturedAt: string;
            }) => void;
        }) => void;

        /** Sets a named performance mark. */
        mark?: (name: string) => void;
        /** Measures between two marks; returns the duration in milliseconds. */
        measure?: (name: string, startMark: string, endMark?: string) => number;
        /** Aggregated performance report from the profiler. */
        getPerformanceReport?: () => Record<string, unknown>;
        /** Freezes the current measurement as the comparison reference. */
        establishBaseline?: () => Record<string, unknown>;
        /** User notification — primitive, renderer-independent. */
        notify?: import("./contracts/notify.contract.js").INotifyPrimitive["notify"];

        // ── The members `GeoLeafHost` named and this file did not ──
        //
        // `GeoLeafHost` (`@geoleaf/host-runtime`) declares itself "kept in sync (loosely)
        // with the core source of truth `GeoLeafGlobal`". That was false in both
        // directions: 5 of its 9 members (`Core`, `plugins`, `registry`, `I18n`,
        // `Storage`) were not described here at all, and 3 of the members plugins call
        // most (`GeoJSON`, `Log`, `Notifications`) were described nowhere.
        //
        // Here they are. The invariant "every member of `GeoLeafHost` is also a member of
        // `GeoLeafGlobal`" becomes true, and `verify-host-contract-sync.cjs` (HOST-03)
        // holds it. Additive: these 8 fell into the tail, no consumer breaks.

        /**
         * Core map façade (`GeoLeaf.Core`) — low-level map lifecycle.
         *
         * Since **v3.0.0**, `Core` holds an **indexed registry** of adapters
         * (`Map<mapId, IMapAdapter>`): N maps coexist on one page, each with its own
         * lifecycle. The module singleton of versions ≤ 2.1.x no longer exists.
         *
         * ⚠️ **The `[key: string]: unknown` tail remains**: the 8 members below are now
         * declared and documented, the rest of the namespace is not yet. Never widen it
         * back to `any`.
         */
        Core?: {
            /**
             * Initialises a map. **Requires `options.mapId`** — without it, returns
             * `null` and logs. Re-initialising an existing `mapId` returns the instance
             * already in place rather than creating a second one.
             */
            init(options?: Record<string, unknown>): unknown;
            /**
             * The instance targeted by `mapId`; **with no argument, the first active
             * instance** — the backward-compatible form for single-map applications.
             */
            getMap(mapId?: string): unknown;
            /** Alias of {@link getMap}. */
            getAdapter(mapId?: string): unknown;
            /**
             * Destroys the instance (`map.remove()` then frees the registry slot).
             * Returns `true` when it existed. Call it at unmount on the consumer side.
             */
            destroy(mapId: string): boolean;
            /** Whether an instance is registered under this `mapId`. */
            hasMap(mapId: string): boolean;
            /** The identifiers of every active instance. */
            listMaps(): string[];
            /**
             * Whether an instance is registered **and** its container is still in the
             * document. Stronger than {@link hasMap}, which only answers for the
             * registration: a host that removes the subtree without calling `destroy()`
             * leaves a registered map that renders nowhere. Returns `false` after
             * `destroy()`.
             */
            isAttached(mapId: string): boolean;
            /**
             * Moves a live map into another parent, without destroying or rebuilding it.
             * The ENTIRE container is re-parented — MapLibre remembers its construction
             * element, so moving its children would leave `getContainer()` pointing at
             * the old node.
             *
             * ⚠️ **The panels do not follow**: they live in `glMain`, not in the map
             * container. Remounting them is the host's job —
             * `UI.destroyDesktopPanel()` → `initDesktopPanel()` → `activateDesktopPanel()`.
             */
            reattach(mapId: string, parent: HTMLElement): boolean;
            /**
             * Applies a theme to the map container.
             *
             * ⚠️ The theme stays **global** in v3.0.0 and applies to the **first**
             * instance: per-map isolation is out of this version's scope.
             */
            setTheme(theme: string): void;
            /** The current theme's name. */
            getTheme(): string;
            [key: string]: unknown;
        };
        /**
         * Plugin registry / lifecycle façade (`GeoLeaf.plugins`).
         *
         * ⚠️ **`getLoadedPlugins`, `canActivate` and `registerLazy` were added on
         * 31/07/2026, and not for typing comfort.** All three have long been **taught by
         * `docs/API_REFERENCE.md`** ("Plugins" section), exist in
         * `kernel/api/plugin-registry.ts` and ship in the delivered bundle — but were
         * declared nowhere here, so they fell into the `[key: string]: unknown` tail.
         *
         * What that cost, measured: `showBootInfo(GeoLeaf)` — the call its own doc shows
         * — **did not compile**. `BootInfoNamespace` requires
         * `plugins?.getLoadedPlugins?: () => string[]`; resolved through the tail the
         * member was `unknown`, and `unknown` is not assignable to
         * `(() => string[]) | undefined`. The defect was visible to no gate as long as
         * the `showBootInfo` example was written `showBootInfo()` — that is, as long as
         * it was wrong in ANOTHER way, frozen in the typecheck baseline. A frozen
         * diagnostic masks what lives under it.
         *
         * Shrinking the tail is the only allowed direction: never widen back to `any`.
         */
        plugins?: {
            register?(name: string, meta?: Record<string, unknown>): void;
            registerLazy?(name: string, resolver: () => Promise<void>): void;
            isLoaded?(name: string): boolean;
            canActivate?(name: string): boolean;
            getLoadedPlugins?(): string[];
            registerLayerLoader?(
                pluginId: string,
                loader: (def: Record<string, unknown>) => Promise<string>
            ): void;
            [key: string]: unknown;
        };
        /**
         * Module registry (`GeoLeaf.registry`) — lifecycle modules AND UI-only slots.
         *
         * Typed as the contract itself rather than as a structural `{ register?; [key]: unknown }`:
         * `ModuleRegistry` is a CLASS, and TypeScript does not give classes an implicit index
         * signature, so the loose shape rejected the very object `boot-install.ts` assigns.
         */
        registry?: import("./contracts/core-module.contract.js").IModuleRegistry;
        /** Internationalization façade (`GeoLeaf.I18n`). */
        I18n?: {
            registerDict?(...args: unknown[]): unknown;
            getLabel?(key: string, fallback?: string): string;
            t?(key: string, ...args: unknown[]): string;
            [key: string]: unknown;
        };
        /**
         * Offline storage façade (`GeoLeaf.Storage`), mounted in-core by `kernel/storage/facade.ts`.
         *
         * ⚠️ The `[key: string]: unknown` tail makes any member not named here `unknown`
         * — hence **not callable** — and no gate flags it: HOST-06 only rejects a fully
         * empty declaration. A member that is a public API gets **named**.
         */
        Storage?: {
            DB?: Record<string, unknown>;
            /**
             * Bounded pull of a declared layer into the `features` store.
             * Never confers editability (a standing invariant). Does not throw:
             * `refused` carries the motive when nothing was written.
             */
            pullLayer?(
                layerId: string,
                options?: { bbox?: [number, number, number, number]; signal?: AbortSignal }
            ): Promise<{
                layerId: string;
                fetched: number;
                written: number;
                preserved: number;
                skipped: number;
                capped: boolean;
                aborted: boolean;
                refused: string | null;
            }>;
            /**
             * Per-layer synchronisation report.
             *
             * Makes `declaredNeverPulled` observable: a layer declared offline but never
             * pulled is otherwise indistinguishable from a pulled one, until the instant
             * the network drops. Does not throw — with no engine wired, returns `[]`.
             */
            getSyncReport?(): Promise<
                ReadonlyArray<import("./contracts/sync.contract.js").LayerSyncReport>
            >;
            [key: string]: unknown;
        };
        /**
         * GeoJSON subsystem façade (`GeoLeaf.GeoJSON`) — 87 call sites across the plugins,
         * the single most-used member of the host, and typed nowhere before S3.
         *
         * ⚠️ Distinct from `Layers` above: `Layers` is the per-layer data seam.
         */
        GeoJSON?: {
            getLayerById?(id: string): unknown;
            getAllLayers(): unknown;
            getLayerData?(id: string): unknown;
            // ⚠️ `addData` was DECLARED HERE and NEVER existed on this facade
            // (removed on 09/08/2026). `kernel/geojson/core.ts` does not carry it, and
            // the post-boot oracle `namespace-surface.mjs` does not list it. Since
            // `emit-ambient-types.cjs` publishes this file in the tarball, an integrator
            // writing `GeoLeaf.GeoJSON.addData(fc)` COMPILED then broke at runtime —
            // measured by a before/after witness.
            // Do not reintroduce it: the capability exists, but elsewhere — on
            // `CoreLoaderLike` (`kernel/geojson/loader/loader-types.ts`), reachable as
            // `GeoLeaf._GeoJSONLoader.addData()`. The PUBLIC replacement is
            // `Layers.setData`.
            [key: string]: unknown;
        };
        /**
         * Logger façade (`GeoLeaf.Log`).
         *
         * Same reason as `registry` above — `LogImplInterface` is an interface, so it carries
         * no implicit index signature and a loose `{ error?; …; [key]: unknown }` shape would
         * reject what `globals.core.ts` actually mounts.
         */
        Log?: typeof import("./utils/log/index.js").Log;
        /** Toast façade (`GeoLeaf.Notifications`), mounted by the `toast-renderer` capability. */
        Notifications?: {
            show?(message: string, typeOrOptions?: unknown, duration?: number): unknown;
            [key: string]: unknown;
        };

        // ── The 17 members that replace the `[key: string]: unknown` tail ─────────────
        //
        // ⚠️ **This block is not a renamed catch-all.** The tail accepted ANY name:
        // `GeoLeaf.nimporteQuoi` compiled, and the integrator had no way to tell a typo
        // from a real member. These 17 keys are exactly the ones the code accesses —
        // measured by removing the tail: 61 errors, 17 distinct keys (27/07/2026).
        // Declaring them by name closes the door while keeping the code compilable.
        //
        // ⚠️ The `_`-prefixed members are **internal**: they exist on the runtime object,
        // so the contract must say them, but they are not an API for the integrator. Do
        // not lean on them from a plugin — the sanctioned route stays the public facades
        // and the 6 `contracts/` subpaths.

        /** @internal Application namespace (`boot`, `startApp`, `AppLog`…). */
        _app?: Partial<import("./app/app-types.js").AppNamespace>;
        /** @internal The `ModuleRegistry`, also publicly exposed as `registry`. */
        _registry?: import("./app/module-registry.js").ModuleRegistry;
        /** @internal API controller accessor — CONSTRUCTED on read (re-entrance guard). */
        _APIController?: import("./kernel/api/controller.js").APIController | null;
        /** @internal Bundle version, injected at build time. */
        _version?: string;
        /**
         * @internal Authentication hook called before `registry.init()`; throwing aborts
         * the boot. Deliberately opaque: typing it `(ctx: unknown) => unknown` would make
         * assigning a callback with a concrete parameter non-assignable (contravariance).
         */
        _beforeBootCallback?: unknown;
        /** @internal Performance-metrics callback, armed by `?perf=1`. Opaque, same motive. */
        _perfCallback?: unknown;
        /** @internal Perf trace flag. */
        _debugPerf?: boolean;

        /** @internal GeoJSON subsystems exposed for the plugin bridge. */
        _GeoJSONLayerConfig?: typeof import("./kernel/geojson/layer-config-manager.js").LayerConfigManager;
        /** @internal `Object.assign` composite of four modules — the shape is the one
         * the writer (`globals.geojson.ts`) asserts at assignment. */
        _GeoJSONLayerManager?: import("./kernel/geojson/loader/loader-types.js").GeoJSONLayerManagerLike &
            Record<string, unknown>;
        /** @internal Profile + single-layer composite — same derivation as the manager. */
        _GeoJSONLoader?: import("./kernel/geojson/loader/loader-types.js").GeoJSONLoaderLike &
            Record<string, unknown>;
        /** @internal */
        _LabelButtonManager?: typeof import("./capabilities/labels/label-button-manager.js").LabelButtonManager;
        /** @internal */
        _LayerManagerStyleSelector?: typeof import("./kernel/layer-manager/style-selector.js").StyleSelector;
        /** @internal */
        _OfflineDetector?: typeof import("./kernel/storage/offline-detector.js").OfflineDetector;

        /** @internal Configuration loader (UMD/ESM bridge, B3). */
        _ConfigLoader?: typeof import("./kernel/config/loader.js").ConfigLoader;
        /** @internal Data converter (UMD/ESM bridge, B3). */
        _DataConverter?: typeof import("./kernel/geojson/loader/data-converter.js").DataConverter;
        /** @internal Label renderer of the labels capability. */
        _LabelRenderer?: typeof import("./capabilities/labels/label-renderer.js").LabelRenderer;
        /** @internal Layer manager control. */
        _LayerManagerControl?: typeof import("./kernel/layer-manager/control.js").LMControl;
        /** @internal Shared UI component factory (`kernel/ui/components.ts`). */
        _UIComponents?: typeof import("./kernel/ui/components.js")._UIComponents;
        /** @internal Style validators, set member by member by `globals.config.ts`. */
        _Validators?: {
            StyleValidator?: typeof import("./utils/validators/style-validator.js").StyleValidator;
            StyleValidatorRules?: typeof import("./utils/validators/style-validator-rules.js").StyleValidatorRules;
        };

        // ── Namespaces mounted by the PLUGINS ────────────────────────────────────────────
        //
        // They only exist when the matching plugin is loaded — hence the optionality,
        // which is not caution but the runtime's truth. The core never references them
        // (`no-plugin-in-core`); they are declared here because **the namespace is the
        // plugin's sanctioned route to the host** (`MODULE_CONTRACT.md`, dependency
        // rules), so its type must name them.
        //
        // ⚠️ Declared on 27/07/2026, when the tail was removed: the
        // `[key: string]: unknown` tail covered them implicitly, which made a real
        // plugin and a typo indistinguishable. Removing the tail surfaced **8 documented
        // calls to non-existent namespaces** in `packages/core/docs/` — published on
        // npm.

        /** `@geoleaf-plugins/table` — tabular panel. */
        Table?: unknown;
        /** `@geoleaf-plugins/geocoding` — address search. */
        Geocoding?: unknown;
        /** `@geoleaf-plugins/realtime-layer` — realtime feeds (GTFS-RT…). */
        RealtimeLayer?: unknown;
        /** `@geoleaf-plugins/position-share` — user position broadcasting. */
        PositionShare?: unknown;
        /** `@geoleaf-plugins/routing` — multi-stop route computation. */
        Routing?: unknown;
        /**
         * `@geoleaf-plugins/navigation` — realtime guidance.
         *
         * ⚠️ Two packages and not one: computation has value alone, guidance has none
         * without it. The dependency is asymmetric, so the boundary sits there — and
         * `navigation` imports only TYPES from `routing`.
         */
        Navigation?: unknown;
        /** `@geoleaf-plugins/flatgeobuf` — FlatGeobuf reads by bbox. */
        FlatGeobuf?: unknown;
        /** `@geoleaf-plugins/connector` — bridge to the Connector backend. */
        Connector?: unknown;
        /** `@geoleaf-plugins/cog` — Cloud Optimized GeoTIFF. */
        COG?: unknown;

        // ── The 5 plugin namespaces, declared on 27/07/2026 ──────────────────────────
        //
        // ⚠️ Removing the `[key: string]: unknown` tail closed this interface and
        // declared 7 plugin namespaces. The 5 below were not among them, so the removal
        // made them **unreachable at the type level**: an integrator compiling against
        // the published types got TS2339 on `GeoLeaf.FileImport`, although the plugin
        // does mount it at runtime. Both effects of the removal — 8 phantom APIs down, 5
        // plugins closed off — came from the SAME gesture; only the first was intended.
        //
        // Measured by a probe compiling against `dist/types/` **through the exports
        // map**, the way an integrator does (`examples/consumer/`): 5 errors before, 0
        // after. The probe also carried a POSITIVE witness (`GeoLeaf.COG`, declared) to
        // prove it discriminated instead of rejecting everything.
        //
        // `unknown` suffices here, deliberately: this line's object is the EXISTENCE of
        // the property (a typo does not compile, a legitimate access does). The fine
        // typing of each surface remains a tracked deposit, and **never widens back to
        // `any`**.
        //
        // ⚠️ `offline-ui` is not in this list and never will be: it mounts NO namespace
        // of its own — it drives `GeoLeaf.Storage`, a core facade. Its `entry.ts` says
        // so in as many words.

        /** `@geoleaf-plugins/file-import` — GPX/KML/KMZ/CSV/TSV/TopoJSON conversion. */
        FileImport?: unknown;
        /**
         * `@geoleaf-plugins/measure` — measuring tools.
         *
         * ⚠️ **Not to be confused with lowercase `measure`**, higher in this same
         * interface: that one is the performance-measuring helper between two marks. The
         * two differ only by case. The compiler is in fact what flagged it — the
         * declaration probe yielded TS2551 "Did you mean 'measure'?" on this name.
         */
        Measure?: unknown;
        /** `@geoleaf-plugins/print` — printable map export. */
        Print?: unknown;
        /** `@geoleaf-plugins/editor` — feature editing. */
        Editor?: unknown;
        /** `@geoleaf-plugins/websocket` — WebSocket feeds (mounted as `Ws`, not `Websocket`). */
        Ws?: unknown;

        /** @internal Service Worker registration (`kernel/storage/sw-register.ts`). */

        /** Runtime metrics (historical alias of `getRuntimeMetrics`). */
        getPerformanceMetrics?: () => unknown;
        /** Runtime metrics — init time, memory, rendering. */
        getRuntimeMetrics?: () => unknown;
        /** Resets the metric counters to zero. */
        resetRuntimeMetrics?: () => void;
    }

    /**
     * The global `GeoLeaf` namespace (`undefined` before boot completes).
     *
     * 🛑 **The `| undefined` is a DELIBERATE CHOICE, not an oversight — and it costs 117
     * diagnostics. The next reader must know both.**
     *
     * **The motive**: the namespace **does not exist** before boot. Declaring it
     * present-holding-`undefined` is more **true** than `GeoLeaf?:`, which would suggest
     * an optional property of an existing object.
     *
     * **The cost, measured on 17/08/2026** — `scripts/typecheck-docs-examples.baseline.json`:
     * `generatedCount: 117`, `diagnostics: [117]`, and **117 out of 117 are `TS18048 —
     * 'GeoLeaf' is possibly 'undefined'`**. A single cause, this line. The deposit is
     * therefore not a 117-fix work site: it is **one** decision.
     *
     * 🛑 **There is no third way, and the arbitration was RENDERED on 17/08/2026: KEEP.**
     * The two branches, for the decision's record:
     *   • **keep** — the typing stays true, the 117 diagnostics stay in the baseline
     *     (chosen);
     *   • **remove the `| undefined`** — the 117 would fall at once, at the price of an
     *     ambient asserting a presence the boot does not guarantee.
     *
     * ⚠️ **What must ABOVE ALL not be done**: fix example by example. The baseline's
     * `_comment` settles it — _"this is NOT a per-example defect, it is a property of the
     * published ambient […] fixing it example by example would teach an idiom
     * (`GeoLeaf!.X`) the rest of the doc does not use; it gets fixed at the source, in
     * the declaration, or not at all."_
     *
     * ⚠️ **And both branches commit the ambient PUBLISHED on npm** since 12/08/2026: this
     * is not an internal setting. That is why the motive was written down without
     * deciding — writing the decision has value whatever the outcome, taking it only has
     * value once.
     */
    var GeoLeaf: GeoLeafGlobal | undefined;

    interface Window {
        GeoLeaf?: GeoLeafGlobal;
    }

    /**
     * MapLibre GL JS — injected at runtime via a `<script>` tag (declared as a
     * peer dependency, never bundled). Typed type-only through `typeof import(...)`,
     * which emits nothing: this keeps the CDN bundle free of any MapLibre value import.
     */
    const maplibregl: typeof import("maplibre-gl");
}
