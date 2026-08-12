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
 * for the long tail. Precision is meant to GROW sprint by sprint
 * (see `roadmap_typage-strict.md`): each cleaned domain promotes members from the
 * `unknown` tail to explicit types — never widen back to `any`.
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
     * (theme-selector-state.ts:28), so `null` was outside the declared type at the one
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
     * Raccourci local vers le contrat des onze méthodes de premier niveau.
     *
     * `GeoLeafGlobal` les référence membre par membre (`init?: GeoLeafTopLevelApi["init"]`)
     * plutôt que par `extends` : les lecteurs d'AST du dépôt n'itèrent que les membres
     * déclarés, et un membre hérité disparaîtrait de la vue de toutes les gates du namespace.
     */
    type GeoLeafTopLevelApi = import("./contracts/top-level-api.contract.js").GeoLeafTopLevelApi;

    /**
     * `GeoLeaf.UI` — the kernel UI façade (API publique S4.2, lot B).
     *
     * ## Pourquoi une interface écrite à la main, et pas un `typeof import(...)`
     *
     * `kernel/ui/ui-api.ts:304` fait `const UI = _g.GeoLeaf.UI;` puis le ré-exporte : la valeur
     * exportée EST le membre du namespace. Un `typeof import("./api/geoleaf.ui.js").UI` est donc
     * structurellement circulaire — mesuré, `tsc` sort `TS7022` puis `TS2303`. C'est très
     * probablement la raison pour laquelle ce membre était déclaré `Record<string, unknown>` :
     * la forme facile ne compile pas.
     *
     * Ce n'est pas une raison de ne rien typer. La façade est montée par mutation depuis ~10
     * modules ; les 24 membres ci-dessous sont relevés sur les sites d'affectation réels, et
     * l'interface nommée rompt le cycle en ne dépendant d'aucune valeur.
     *
     * ## B-202 (09/08/2026) — la traîne `[key: string]: unknown` est RETIRÉE
     *
     * ⚠️ **Le motif qui la justifiait ici était faux.** Il disait « `boot-core.ts` et
     * `init-features.ts` posent encore des membres hors de cette liste ». Mesuré : ces deux
     * fichiers ne posent **aucun** membre sur `GeoLeaf.UI` — leurs seules occurrences de
     * `ui.` sont des lectures de config (`init-features.ts:227,246`). Les 6 membres qui
     * manquaient réellement venaient de `globals/globals.ui.ts` et du plugin `offline-ui` ;
     * ils sont déclarés ci-dessous, relevés sur leurs sites d'affectation.
     *
     * **Ce que la traîne coûtait.** Elle rendait `unknown` — donc indiscernable d'un membre
     * réel non typé — **tout membre inventé**. `GeoLeaf.UI.toggleFilterPanel(true)` était
     * enseigné par l'`@example` de `api/geoleaf.ui.ts` alors que cet identifiant n'a jamais
     * existé dans le dépôt, et les trois gates de documentation sortaient vertes dessus.
     * B-80 l'avait mesuré le 31/07/2026 (mutation `GeoLeaf.UI.cetteApiNExistePas("dark")`
     * → **VERTE**) et conclu « le bénéfice réel de B-80 croît avec B-13, et pas autrement ».
     * Traîne ôtée, un membre fantôme rend TS2339, que `typecheck-docs-examples.cjs` connaît.
     *
     * **Aucun site d'affectation ne casse** : `globals.ui.ts:138` écrit à travers
     * `_gl.UI as Record<string, unknown>`, `cache-button.ts:43` par son propre cast, et
     * `ui.module.ts:119` lit par le helper dynamique `member(obj: unknown, …)`.
     */
    interface GeoLeafUIFacade {
        /** Orchestrator version tag, set by `ui-api.ts:296`. */
        VERSION?: string;
        /** Build tag, set by `ui-api.ts:297`. */
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
         * GeoLeaf.UI.toggleTheme(); // passe à "light"
         * ```
         */
        toggleTheme?: (...args: unknown[]) => unknown;

        // Notifications — bound methods of `GeoLeaf._UINotifications`.
        /**
         * The notification renderer, reachable through the UI façade.
         *
         * ⚠️ Typed `Record<string, unknown>`, so nothing here is arity-checked — the real
         * surface is the one documented on `NotificationSystem`. Tracked as **B-13**.
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

        // ── B-202 (09/08/2026) — les 6 membres que la traîne couvrait ────────────────────
        // Relevés sur leurs sites d'affectation, pas devinés. Sans eux, retirer la traîne
        // rejouerait le collatéral de B-52 : des membres bien montés au runtime, devenus
        // inatteignables au niveau des types.

        /**
         * Rich toast surface — the KERNEL one, mounted by `globals/globals.ui.ts:151`.
         *
         * Distinct from {@link GeoLeafUIFacade.Notifications}: `notify` is the anchor-B2
         * adapter that reads the renderer back lazily, so a build without the
         * `toast-renderer` capability degrades to a silent no-op instead of throwing.
         *
         * ⚠️ Chaîner l'optionnel n'est pas de la coquetterie ici : sans écrivain, le membre
         * est absent, et `GeoLeaf.UI.notify.success(…)` jette. C'est aussi ce qui évite
         * d'ajouter une entrée de baseline à `typecheck-docs-examples` (B-202).
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
        /** Mounts the mobile toolbar. Set by `globals/globals.ui.ts:207`. */
        initMobileToolbar?: typeof import("./kernel/ui/mobile/mobile-toolbar.js").initMobileToolbar;
        /** Mounts the desktop side-panel. Set by `globals/globals.ui.ts:208`. */
        initDesktopPanel?: typeof import("./kernel/ui/desktop/desktop-panel.js").initDesktopPanel;
        /** Reveals the desktop side-panel. Set by `globals/globals.ui.ts:209`. */
        activateDesktopPanel?: typeof import("./kernel/ui/desktop/desktop-panel.js").activateDesktopPanel;
        /** Tears the desktop side-panel down. Set by `globals/globals.ui.ts:210`. */
        destroyDesktopPanel?: typeof import("./kernel/ui/desktop/desktop-panel.js").destroyDesktopPanel;
        /**
         * Offline cache button — mounted by the `offline-ui` PLUGIN
         * (`ui/cache-button.ts:43`), read by `app/boot-modules/ui.module.ts:119`.
         *
         * ⚠️ Typé STRUCTURELLEMENT à dessein. La règle `no-plugin-in-core`
         * (`scripts/verify-core-standalone.cjs`) interdit au core de nommer
         * `@geoleaf-plugins/*` : un `typeof import(...)` est indisponible ici, et ce n'est
         * pas un raccourci mais la frontière d'architecture. Le membre reste optionnel —
         * un build sans le plugin n'a pas d'écrivain.
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
     * ⚠️ ONE alias, ONE type. `globals.api.ts:86-87` assigns the SAME reference to both names;
     * declaring them separately would let the two drift with nothing to notice — both names sit
     * in the post-boot oracle, so the namespace gates are satisfied by their mere presence.
     */
    type GeoLeafBaselayersFacade = typeof import("./api/geoleaf.baselayers.js").Baselayers;

    /** `GeoLeaf.Events` and its lowercase alias `GeoLeaf.events` — same reference, one type. */
    type GeoLeafEventsFacade = typeof import("./api/geoleaf.events.js").Events;

    /**
     * `GeoLeaf.API` — the seven constructors assembled as an object literal by
     * `globals.api.ts:75-84`.
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
         * `GeoLeaf.UI` — la façade UI du kernel.
         *
         * ⚠️ Déclarée `Record<string, unknown>` jusqu'à l'API S4.2, elle était comptée parmi les
         * membres « typés » alors qu'elle ne vérifiait rien : ce type accepte n'importe quel
         * objet et rend `unknown` sur chaque accès, exactement comme la traîne qu'il était censé
         * remplacer. C'est HOST-06 (`check-namespace-typing-coverage.cjs`) qui l'a trouvée, en
         * refusant de compter une déclaration vide comme un typage.
         *
         * ⚠️ `globals.ui.ts:128` pose `_gl.UI = {}` si absent : tous les membres de
         * {@link GeoLeafUIFacade} sont donc optionnels. Et son typage ne peut PAS passer par
         * `typeof import(...)` — la façade est auto-montée, le détail est sur l'interface.
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
             * Profil actif enrichi. Son tableau `layers` porte les configurations de couche
             * **complètes** — à la différence de `getAllLayerConfigs()`, qui est une projection
             * en liste blanche et ne porte ni `offline`, ni `data`, ni `write`.
             *
             * ⚠️ `Config.Profile` n'est PAS monté ici, bien que le module `Config` le porte :
             * mesuré en navigateur (tâche 4.1). Passer par `getActiveProfile()`.
             */
            getActiveProfile?(): unknown;
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
         * Façade de la légende (`GeoLeaf.Legend`).
         *
         * ⚠️ Les 8 membres ci-dessous étaient **implémentés et documentés** dans
         * `capabilities/legend/legend.ts` — `@example` compris — mais **non déclarés ici**,
         * donc absents de la page `GeoLeafGlobal` que TypeDoc rend et que lit un intégrateur
         * (B-229). La traîne `[key: string]: unknown` subsiste (gisement B-13).
         */
        Legend?: {
            /** Monte la légende sur une carte. Rend `false` si le montage échoue. */
            init(mapInstance: unknown, options?: Record<string, unknown>): boolean;
            /** Charge et rend l'entrée de légende d'une couche, pour un style donné. */
            loadLayerLegend(layerId: string, styleId: string, layerConfig: unknown): void;
            /** Affiche ou masque une couche depuis la légende. */
            setLayerVisibility(layerId: string, visible: boolean): void;
            /** Toutes les couches connues de la légende, indexées par identifiant. */
            getAllLayers(): Map<string, unknown>;
            /** Masque le panneau sans le démonter — l'état des couches est conservé. */
            hideLegend(): void;
            /** Démonte le panneau et libère ses écouteurs. */
            removeLegend(): void;
            /** Si le panneau est actuellement visible. */
            isLegendVisible(): boolean;
            /** Plie ou déplie la section d'une couche. */
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
             * La table `valeur → symbole` d'une couche donnée (vide si la couche ne déclare
             * aucune taxonomie). B-229 : implémenté et documenté dans
             * `capabilities/taxonomy/public-api.ts`, mais non déclaré ici jusqu'au 11/08/2026.
             */
            getLayerCategories(
                layerId: string
            ): Record<string, import("./capabilities/taxonomy/types.js").TaxonomyCategory>;
            /** Résout l'icône de sprite d'un point, tenant compte de sa catégorie et de sa teinte. */
            resolvePoiIcon(
                poi: import("./capabilities/taxonomy/types.js").TaxonomyFeatureLike
            ): import("./capabilities/taxonomy/types.js").ResolvedIcon;
            /**
             * Chaque paire (icône × teinte) référencée par la config, pour que l'adaptateur
             * MapLibre les rastérise et les enregistre. Vide si rien n'est teinté.
             */
            getIconVariants(): import("./capabilities/taxonomy/types.js").TaxonomyIconVariant[];
            /** Peinture MapLibre d'une couche de marqueurs, ou `null` si la taxonomie ne s'applique pas. */
            resolveMarkerPaint(
                layerId: string,
                existingPaint: Record<string, unknown>
            ): Record<string, unknown> | null;
            /**
             * Le `symbolId` de l'icône à afficher à côté du TITRE d'une entité sur une surface
             * feature-info, en honorant les drapeaux `render` par surface
             * (priorité sous-catégorie → catégorie → défaut).
             */
            resolveTitleIcon(
                layerId: string,
                feature: import("./capabilities/taxonomy/types.js").TaxonomyFeatureLike,
                surface: import("./capabilities/taxonomy/types.js").TaxonomySurface
            ): string | null;
            /** Le style de badge d'un champ, ou `null` si aucun ne s'applique. */
            resolveBadgeStyle(
                layerId: string,
                feature: import("./capabilities/taxonomy/types.js").TaxonomyFeatureLike,
                surface: import("./capabilities/taxonomy/types.js").TaxonomySurface,
                field: string
            ): import("./capabilities/taxonomy/types.js").ResolvedBadgeStyle | null;
            /**
             * Garantit que le sprite SVG du profil actif (ses `<symbol>`) est présent dans le
             * DOM, pour qu'un `<use href="#…">` puisse le référencer. Sans attente et
             * idempotent — le chargeur dédoublonne.
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
         * `GeoLeaf._LayerVisibilityManager` — **contrat de fait, délibérément NON promu.**
         *
         * API publique S4.3d a examiné sa promotion en `GeoLeaf.Layers.getVisibilityState()`
         * et l'a écartée, pour deux raisons mesurées :
         *
         * 1. **Elle n'aurait retiré aucune clé.** Le motif annoncé était « promouvoir puis
         *    retirer `_LayerVisibilityManager` du namespace » — impossible : le CORE le relit
         *    lui-même par le global à **5 sites**, avec 3 méthodes différentes
         *    (`kernel/geojson/layers/visibility.ts:87,159,207,246` et
         *    `capabilities/legend/legend.ts:163`). La promotion n'achetait qu'un chemin typé
         *    pour `plugin-table`, au prix d'une entrée publique de plus.
         *
         * 2. **La forme est un piège, et le publier le graverait.** `getVisibilityState()`
         *    rend 6 champs, dont `current` — la visibilité PHYSIQUE, que le zoom force à
         *    `false` — et `logicalState`, l'intention utilisateur. Le backlog B.19 consigne
         *    que lire `current` pour piloter un toggle est le bug DÉJÀ commis. Or les 2 sites
         *    de `plugin-table` lisent exactement `current`. Publier dans `LayerDataApi` est
         *    irréversible (règle Q1 : on ajoute un sous-chemin, on n'en retire jamais).
         *
         * Lecteurs de fait, hors core : `packages/plugins/table/src/panel.ts:236` et
         * `src/table-layer.ts:93`. Ils restent sur cette clé, sciemment.
         */
        _LayerVisibilityManager?: {
            getVisibilityState: (layerId: string) => { current?: boolean } | null;
            [key: string]: unknown;
        };
        /**
         * `GeoLeaf.Sync` — the offline sync-handler registry seam (S14 Phase B).
         *
         * A **public API of fact** (B.25): it is how a data plugin pushes its offline
         * sync handler into the core (`@geoleaf-plugins/addpoi` does
         * `GeoLeaf.Sync.registerHandler("poi", POISyncHandler)` at its own `entry.ts`),
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
            getHandlers(): import("./kernel/shared/sync-handler-seam.js").SyncHandler[];
        };
        /** Theme switch bar — in-core `theme-selector` capability (see above). */
        ThemeSelector?: GeoLeafThemeSelector;
        /**
         * `GeoLeaf._VectorTiles` — the MVT policy seam published by the `vector-tiles`
         * installer. Internal (underscore), but read through the global by two kernel
         * modules that each wrote their own narrow `VectorTilesLike` — and the two were
         * DISJOINT (`loader-types.ts:273` declares `shouldUseVectorTiles` /
         * `loadVectorTileLayer`, `layer-manager/style.ts:17` declares `updateLayerStyle`),
         * so neither described the seam. Typed here as the capability's own export, the
         * only shape that covers both (B.25).
         */
        _VectorTiles?: typeof import("./capabilities/vector-tiles/vector-tiles.js").VectorTiles;
        Introspection?: import("./contracts/introspection.contract.js").IIntrospectionAPI;
        Layers?: import("./contracts/layer-data.contract.js").LayerDataApi;
        /** In-core geolocation capability seam (GPS state + config helpers). */
        Geolocation?: import("./capabilities/geolocation/public-api.js").GeolocationPublicApi;

        // ── API publique S4.2 lot A — les 11 façades de capacité montées au namespace ──
        //
        // Elles tombaient toutes dans la traîne `[key: string]: unknown` : `GeoLeaf.Scale.show()`
        // ne se vérifiait pas plus que `GeoLeaf.Scale.nimportequoi()`. `Geolocation` ci-dessus
        // était le seul précédent — ce lot le généralise aux dix autres.
        //
        // Quatre dévient du patron `capabilities/<nom>/public-api.js`, et le pré-vol les a
        // trouvées une par une plutôt que de les supposer :
        //   • `Share` n'est pas une capacité de premier niveau — elle vit sous `permalink/` ;
        //   • `NotificationSystem` est une CLASSE, montée depuis `toast-renderer/renderer/`,
        //     répertoire dont le nom ne ressemble pas à la clé ;
        //   • `FeatureInfoPublicApi` est déclaré dans `types.ts`, pas ré-exporté par sa façade ;
        //   • `Cluster`, `PWA` et `Permalink` n'ont AUCUN type public nommé. Elles prennent
        //     `typeof import(...)` de la valeur : le compilateur infère la forme exacte, ce qui
        //     est précis, pas un compromis. `pwa/public-api.ts:27-36` motive explicitement son
        //     refus d'un `PWAPublicApi` — on ne lui en fabrique pas un au passage.

        /** Branding overlay (logo, attribution) — `GeoLeaf.Branding`. */
        Branding?: import("./capabilities/branding/public-api.js").BrandingPublicApi;
        /** POI clustering controls — `GeoLeaf.Cluster`. */
        Cluster?: import("./capabilities/cluster/public-api.js").ClusterPublicApi;
        /** Coordinate readout control — `GeoLeaf.Coordinates`. */
        Coordinates?: import("./capabilities/coordinates/public-api.js").CoordinatesPublicApi;
        /** Feature detail panel — `GeoLeaf.FeatureInfo`. Type déclaré dans `types.ts`. */
        FeatureInfo?: import("./capabilities/feature-info/types.js").FeatureInfoPublicApi;
        /** Map labels toggle + renderer — `GeoLeaf.Labels`. */
        Labels?: import("./capabilities/labels/public-api.js").LabelsPublicApi;
        /** Toast/notification CLASS mounted by the `toast-renderer` installer. */
        NotificationSystem?: typeof import("./capabilities/toast-renderer/notifications.js").NotificationSystem;
        /** PWA install/update manager — `GeoLeaf.PWA`. Pas de type public nommé, cf. ci-dessus. */
        PWA?: typeof import("./capabilities/pwa/public-api.js").PWA;
        /** URL state serialisation — `GeoLeaf.Permalink`. Pas de type public nommé. */
        Permalink?: typeof import("./capabilities/permalink/public-api.js").Permalink;
        /** Scale bar control — `GeoLeaf.Scale`. */
        Scale?: import("./capabilities/scale/public-api.js").ScalePublicApi;

        /** Data-profile selector — `GeoLeaf.ProfileSwitcher` (S1 sélecteurs UI). */
        ProfileSwitcher?: import("./capabilities/profile-switcher/public-api.js").ProfileSwitcherPublicApi;
        /** UI language selector — `GeoLeaf.LanguageSwitcher` (S2 sélecteurs UI). */
        LanguageSwitcher?: import("./capabilities/language-switcher/public-api.js").LanguageSwitcherPublicApi;
        /** Accent-colour palette — `GeoLeaf.ThemePalette` (S3 sélecteurs UI). */
        ThemePalette?: import("./capabilities/theme-palette/public-api.js").ThemePalettePublicApi;
        /** Share sheet — `GeoLeaf.Share`, sous-dossier de la capacité `permalink`. */
        Share?: import("./capabilities/permalink/share/public-api.js").SharePublicApi;
        /** Light/dark toggle — `GeoLeaf.ThemeToggle`. */
        ThemeToggle?: import("./capabilities/theme-toggle/public-api.js").ThemeTogglePublicApi;

        // ── API publique S4.2 lot B — les façades kernel ──
        //
        // ⚠️ Les deux paires d'ALIAS partagent UN SEUL type, jamais deux déclarations jumelles.
        // `_gl.BaseLayers = Baselayers` (globals.api.ts:87) et `_gl.events = Events` (:100)
        // pointent la MÊME référence : deux déclarations indépendantes pourraient diverger sans
        // qu'aucune gate ne le voie, puisque les deux noms sont dans l'oracle et que HOST-04 se
        // contente de leur présence.
        //
        // ⚠️ Cinq ne viennent pas d'`api/`, contrairement au patron : `CONSTANTS` et `Errors`
        // sont posées par `globals.core.ts:62-63`, `ThemeCache` par `globals.ui.ts:120`, et
        // `version` est une chaîne. Pré-volé fichier par fichier plutôt que supposé.

        /** Base layer catalogue façade. */
        Baselayers?: GeoLeafBaselayersFacade;
        /** Alias historique de {@link GeoLeafGlobal.Baselayers} — même référence, même type. */
        BaseLayers?: GeoLeafBaselayersFacade;
        /** Typed event bus façade (`on`/`off`/`once`/`dispatch`). */
        Events?: GeoLeafEventsFacade;
        /** Alias minuscule de {@link GeoLeafGlobal.Events} — même référence, même type. */
        events?: GeoLeafEventsFacade;
        /** Frozen runtime constants — posé par `globals.core.ts:63`. */
        CONSTANTS?: typeof import("./utils/constants/constants.js").CONSTANTS;
        /** Error helpers — posé par `globals.core.ts:62`. */
        Errors?: typeof import("./utils/errors/errors.js").Errors;
        /** General-purpose helpers façade. */
        Helpers?: typeof import("./api/geoleaf.helpers.js").Helpers;
        /** Layer manager façade (visibility, ordering, legend wiring). */
        LayerManager?: typeof import("./api/geoleaf.layer-manager.js").LayerManager;
        /** Theme cache — posé par `globals.ui.ts:120`, hors de la chaîne des façades. */
        ThemeCache?: typeof import("./kernel/themes/theme-cache.js").ThemeCache;
        /** Style/config validators façade. */
        Validators?: typeof import("./api/geoleaf.validators.js").Validators;
        /**
         * Package version string.
         *
         * ✅ **Un seul écrivain depuis socle-init 7.7** : `globals/globals.api.ts`, sous garde
         * `if (!_gl.version)` — ce qui rend `setupAPIKernel()` ré-appelable sans écraser une
         * version déjà posée.
         *
         * ⚠️ Cette note disait « Écrite à DEUX endroits : `globals.api.ts:200` […] et
         * `kernel/api/geoleaf-api.ts:133` sans garde. Le dernier writer gagne » — c'était vrai
         * (divergence D8), et **les deux numéros de ligne avaient dérivé** (208 et 164 au moment
         * du retrait). Une citation de ligne dans un commentaire vieillit sans bruit ; celle-ci
         * ne renvoie plus qu'au fichier.
         */
        version?: string;
        /**
         * `GeoLeaf.API` — les constructeurs de l'API, assemblés en littéral par
         * `globals.api.ts:75-84`.
         *
         * ⚠️ Écrit à la main, et c'est mesuré : `contracts/api.contract.ts:103` déclare bien
         * `IGeoLeafAPIConstructors`, mais il ne couvre que les **3 alias**, pas les 7 clés
         * réellement posées. Le référencer aurait typé moins de la moitié de l'objet tout en
         * ayant l'air de le typer — le défaut que HOST-06 traque, un cran plus haut.
         */
        API?: GeoLeafApiConstructors;

        // ── API publique S4.2 lot C — les méthodes et valeurs de premier niveau ──
        //
        // ⚠️ Les onze méthodes C2 sont référencées MEMBRE PAR MEMBRE depuis
        // `GeoLeafTopLevelApi`, et jamais par `extends`. Les lecteurs d'AST du dépôt
        // (`scripts/lib/ts-decl-read.cjs`) n'itèrent que les membres DÉCLARÉS : un membre
        // hérité leur serait invisible, et HOST-02/HOST-04 se desserreraient en silence sur
        // onze clés d'un coup. Le lecteur refuse d'ailleurs de conclure sur une clause
        // `extends` depuis S4.2, précisément pour que ce piège ne se retende pas.
        //
        // ⚠️ Et ce n'est pas de la décoration : `globals.api.ts:70` type son `_gl` en
        // `GeoLeafRuntime = ReturnType<typeof ensureGeoLeaf>`, c'est-à-dire `GeoLeafGlobal`.
        // Déclarer ici fait donc VÉRIFIER par le compilateur les onze affectations de
        // `defineApiMethods`. C'est le versant UMD du lien ; le versant ESM le `satisfies`.

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

        // ── C1 — les quatre valeurs de premier niveau ──
        //
        // `fetch`, `get` et `post` sont des méthodes LIÉES de `FetchHelper`
        // (`globals.core.ts:89-91` fait `.bind(FetchHelper)`), d'où l'indexation du type de la
        // méthode plutôt qu'un `typeof` de l'objet entier.

        /** `FetchHelper.fetch`, liée — requête HTTP instrumentée. */
        fetch?: (typeof import("./utils/general/fetch-helper.js").FetchHelper)["fetch"];
        /** `FetchHelper.get`, liée. */
        get?: (typeof import("./utils/general/fetch-helper.js").FetchHelper)["get"];
        /** `FetchHelper.post`, liée. */
        post?: (typeof import("./utils/general/fetch-helper.js").FetchHelper)["post"];
        /** Rapport de démarrage (⚠️ minuscule côté namespace, `BootInfo` côté module). */
        bootInfo?: typeof import("./kernel/api/boot-info.js").BootInfo;

        // ── C3 — le boot et les cinq mesures de performance ──

        /**
         * Démarre l'application GeoLeaf : charge le profil, crée la carte, initialise les
         * modules. C'est l'entrée applicative — `apps/geoleaf-app/init.js` l'appelle, et
         * l'ordre de chargement de tous les plugins s'y réfère.
         *
         * ⚠️ À ne pas confondre avec {@link GeoLeafGlobal.init}, qui est l'enveloppe manuelle
         * de `Core.init()`. Le chemin de boot passe par `registry.init()` — celui du
         * ModuleRegistry — et n'appelle jamais `GeoLeaf.init`.
         *
         * Les deux options sont le seul canal par lequel un hôte pose un gate d'auth (SSO) ou
         * récupère les métriques de démarrage ; elles sont relues depuis `_beforeBootCallback`
         * et `_perfCallback`, qui restent hors de ce contrat (dette D-14).
         */
        boot?: (options?: {
            /** Appelé après le chargement de la config, avant la carte. Jeter abandonne le boot. */
            beforeBoot?: (context: {
                config: Readonly<Record<string, unknown>>;
            }) => Promise<void> | void;
            /** Reçoit les métriques de démarrage après `geoleaf:app:ready`. */
            onPerformanceMetrics?: (metrics: {
                timeToMapReadyMs: number | null;
                timeToAppReadyMs: number | null;
                startupTotalMs: number | null;
                capturedAt: string;
            }) => void;
        }) => void;

        /** Pose une marque de performance nommée. */
        mark?: (name: string) => void;
        /** Mesure entre deux marques ; rend la durée en millisecondes. */
        measure?: (name: string, startMark: string, endMark?: string) => number;
        /** Rapport de performance agrégé du profileur. */
        getPerformanceReport?: () => Record<string, unknown>;
        /** Fige la mesure courante comme référence de comparaison. */
        establishBaseline?: () => Record<string, unknown>;
        /** Notification utilisateur — primitive, indépendante du rendu. */
        notify?: import("./contracts/notify.contract.js").INotifyPrimitive["notify"];

        // ── API publique S3.5 — les membres que `GeoLeafHost` nommait et pas ce fichier ──
        //
        // `GeoLeafHost` (`@geoleaf/host-runtime`) se déclare « kept in sync (loosely) with
        // the core source of truth `GeoLeafGlobal` ». C'était faux dans les deux sens : 5 de
        // ses 9 membres (`Core`, `plugins`, `registry`, `I18n`, `Storage`) n'étaient pas
        // décrits ici du tout, et 3 des membres les plus appelés par les plugins (`GeoJSON`,
        // `Log`, `Notifications`) ne l'étaient nulle part.
        //
        // Les voici. L'invariant « tout membre de `GeoLeafHost` est aussi un membre de
        // `GeoLeafGlobal` » devient vrai, et `verify-host-contract-sync.cjs` (HOST-03) le
        // tient. Additif : ces 8 tombaient dans la traîne, aucun consommateur ne casse.

        /**
         * Core map façade (`GeoLeaf.Core`) — low-level map lifecycle.
         *
         * Depuis la **v3.0.0**, `Core` tient un **registre indexé** d'adaptateurs
         * (`Map<mapId, IMapAdapter>`) : N cartes coexistent sur une page, chacune avec son
         * cycle de vie. Le singleton de module des versions ≤ 2.1.x n'existe plus.
         *
         * ⚠️ **La traîne `[key: string]: unknown` subsiste** (gisement B-13) : les 8 membres
         * ci-dessous sont désormais déclarés et documentés, le reste du namespace ne l'est pas
         * encore. Ne jamais l'élargir vers `any`.
         */
        Core?: {
            /**
             * Initialise une carte. **Exige `options.mapId`** — sans lui, rend `null` et
             * journalise. Ré-initialiser un `mapId` existant rend l'instance déjà en place
             * plutôt que d'en créer une seconde.
             */
            init(options?: Record<string, unknown>): unknown;
            /**
             * L'instance ciblée par `mapId` ; **sans argument, la première instance active** —
             * forme rétro-compatible pour les applications mono-carte.
             */
            getMap(mapId?: string): unknown;
            /** Alias de {@link getMap}. */
            getAdapter(mapId?: string): unknown;
            /**
             * Détruit l'instance (`map.remove()` puis libère l'emplacement du registre).
             * Rend `true` si elle existait. À appeler au démontage côté consommateur.
             */
            destroy(mapId: string): boolean;
            /** Si une instance est enregistrée sous ce `mapId`. */
            hasMap(mapId: string): boolean;
            /** Les identifiants de toutes les instances actives. */
            listMaps(): string[];
            /**
             * Applique un thème au conteneur de la carte.
             *
             * ⚠️ Le thème reste **global** en v3.0.0 et s'applique à la **première** instance :
             * l'isolation par carte est hors périmètre de cette version.
             */
            setTheme(theme: string): void;
            /** Le nom du thème courant. */
            getTheme(): string;
            [key: string]: unknown;
        };
        /**
         * Plugin registry / lifecycle façade (`GeoLeaf.plugins`).
         *
         * ⚠️ **`getLoadedPlugins`, `canActivate` et `registerLazy` ont été ajoutés le
         * 31/07/2026, et pas par confort de typage.** Les trois sont **enseignés par
         * `docs/API_REFERENCE.md`** (section « Plugins ») depuis longtemps, existent dans
         * `kernel/api/plugin-registry.ts` et partent dans le bundle livré — mais n'étaient
         * déclarés nulle part ici, donc ils tombaient dans la traîne `[key: string]: unknown`.
         *
         * Ce que ça coûtait, mesuré : `showBootInfo(GeoLeaf)` — l'appel que sa propre doc
         * montre — **ne compilait pas**. `BootInfoNamespace` exige
         * `plugins?.getLoadedPlugins?: () => string[]` ; résolu par la traîne, le membre valait
         * `unknown`, et `unknown` n'est pas assignable à `(() => string[]) | undefined`. Le
         * défaut n'était visible d'aucune gate tant que l'exemple de `showBootInfo` s'écrivait
         * `showBootInfo()` — c'est-à-dire tant qu'il était faux d'une AUTRE manière, gelée dans
         * la baseline du typecheck. Un diagnostic gelé masque ce qui vit sous lui.
         *
         * Rétrécir la traîne est le sens autorisé (B-13) : jamais élargir vers `any`.
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
         * signature, so the loose shape rejected the very object `boot-install.ts:135` assigns.
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
         * ⚠️ La traîne `[key: string]: unknown` rend `unknown` — donc **non appelable** — tout
         * membre non nommé ici, et aucune gate ne le signale : HOST-06 ne rejette qu'une
         * déclaration entièrement vide. Un membre qui est une API publique se **nomme**.
         */
        Storage?: {
            DB?: Record<string, unknown>;
            /**
             * Rapatriement borné d'une couche déclarée vers le store `features` (tâche 4.1).
             * Ne confère jamais l'éditabilité (invariant S6). Ne jette pas : `refused` porte
             * le motif quand rien n'a été écrit.
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
             * Rapport de synchronisation par couche (tâche 4.8).
             *
             * Rend `declaredNeverPulled` observable : une couche déclarée hors-ligne mais
             * jamais rapatriée est autrement indiscernable d'une couche rapatriée, jusqu'à
             * l'instant où le réseau tombe. Ne jette pas — sans moteur câblé, rend `[]`.
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
         * ⚠️ Distinct de `Layers` ci-dessus : `Layers` est le seam de données par couche.
         */
        GeoJSON?: {
            getLayerById?(id: string): unknown;
            getAllLayers(): unknown;
            getLayerData?(id: string): unknown;
            // ⚠️ `addData` a été DÉCLARÉE ICI et n'a JAMAIS existé sur cette façade
            // (retirée le 09/08/2026, roadmap npm S2 tâche 2.16). `kernel/geojson/core.ts`
            // ne la porte pas, et l'oracle post-boot `namespace-surface.mjs` ne la liste
            // pas. Comme `emit-ambient-types.cjs` publie ce fichier dans le tarball, un
            // intégrateur qui écrivait `GeoLeaf.GeoJSON.addData(fc)` COMPILAIT puis
            // cassait à l'exécution — mesuré par témoin avant/après.
            // Ne pas la réintroduire : la capacité existe, mais ailleurs — sur
            // `CoreLoaderLike` (`kernel/geojson/loader/loader-types.ts`), atteignable en
            // `GeoLeaf._GeoJSONLoader.addData()`. Le remplaçant PUBLIC est `Layers.setData`.
            [key: string]: unknown;
        };
        /**
         * Logger façade (`GeoLeaf.Log`).
         *
         * Same reason as `registry` above — `LogImplInterface` is an interface, so it carries
         * no implicit index signature and a loose `{ error?; …; [key]: unknown }` shape would
         * reject what `globals.core.ts:61` actually mounts.
         */
        Log?: typeof import("./utils/log/index.js").Log;
        /** Toast façade (`GeoLeaf.Notifications`), mounted by the `toast-renderer` capability. */
        Notifications?: {
            show?(message: string, typeOrOptions?: unknown, duration?: number): unknown;
            [key: string]: unknown;
        };

        // ── Les 17 membres qui remplacent la traîne `[key: string]: unknown` (B-13) ──────
        //
        // ⚠️ **Ce bloc n'est pas un fourre-tout renommé.** La traîne acceptait N'IMPORTE
        // QUEL nom : `GeoLeaf.nimporteQuoi` compilait, et l'intégrateur n'avait aucun moyen
        // de distinguer une faute de frappe d'un membre réel. Ces 17 clés sont exactement
        // celles que le code accède — mesurées en retirant la traîne : 61 erreurs,
        // 17 clés distinctes (27/07/2026). Les déclarer nommément ferme la porte tout en
        // gardant le code compilable.
        //
        // ⚠️ Les membres `_`-préfixés sont **internes** : ils existent sur l'objet runtime,
        // donc le contrat doit les dire, mais ils ne sont pas une API pour l'intégrateur.
        // Ne pas s'appuyer dessus depuis un plugin — la route sanctionnée reste les façades
        // publiques et les 6 sous-chemins `contracts/`.

        /** @internal Namespace applicatif (`boot`, `startApp`, `AppLog`…). */
        _app?: unknown;
        /** @internal Le `ModuleRegistry`, aussi exposé publiquement en `registry`. */
        _registry?: unknown;
        /** @internal Accesseur du contrôleur d'API — CONSTRUIT à la lecture (garde de ré-entrance). */
        _APIController?: unknown;
        /** @internal Version du bundle, injectée au build. */
        _version?: string;
        /**
         * @internal Hook d'authentification appelé avant `registry.init()` ; jeter interrompt
         * le boot. Volontairement opaque : le typer en `(ctx: unknown) => unknown` rendrait
         * l'affectation d'un rappel à paramètre concret non assignable (contravariance).
         */
        _beforeBootCallback?: unknown;
        /** @internal Rappel de métriques de performance, armé par `?perf=1`. Opaque, même motif. */
        _perfCallback?: unknown;
        /** @internal Drapeau de trace perf. */
        _debugPerf?: boolean;

        /** @internal Sous-systèmes GeoJSON exposés pour le pont plugin. */
        _GeoJSONLayerConfig?: unknown;
        /** @internal */
        _GeoJSONLayerManager?: unknown;
        /** @internal */
        _GeoJSONLoader?: unknown;
        /** @internal */
        _LabelButtonManager?: unknown;
        /** @internal */
        _LayerManagerStyleSelector?: unknown;
        /** @internal */
        _OfflineDetector?: unknown;

        // ── Namespaces montés par les PLUGINS ────────────────────────────────────────────
        //
        // Ils n'existent que si le plugin correspondant est chargé — d'où l'optionnalité,
        // qui n'est pas une précaution mais la vérité du runtime. Le core ne les référence
        // jamais (`no-plugin-in-core`) ; ils sont déclarés ici parce que **le namespace est
        // la route sanctionnée du plugin vers l'hôte** (`MODULE_CONTRACT.md` §Règles de
        // dépendances), donc son type doit les nommer.
        //
        // ⚠️ Déclarés à la suite de B-13 (27/07/2026) : la traîne `[key: string]: unknown`
        // les couvrait implicitement, ce qui rendait indiscernables un plugin réel et une
        // faute de frappe. Le retrait de la traîne a fait apparaître **8 appels documentés
        // vers des namespaces inexistants** dans `packages/core/docs/` — publiés sur npm.

        /** `@geoleaf-plugins/table` — panneau tabulaire. */
        Table?: unknown;
        /** `@geoleaf-plugins/geocoding` — recherche d'adresses. */
        Geocoding?: unknown;
        /** `@geoleaf-plugins/realtime-layer` — flux temps réel (GTFS-RT…). */
        RealtimeLayer?: unknown;
        /** `@geoleaf-plugins/flatgeobuf` — lecture FlatGeobuf par bbox. */
        FlatGeobuf?: unknown;
        /** `@geoleaf-plugins/connector` — pont vers le backend Connector. */
        Connector?: unknown;
        /** `@geoleaf-plugins/cog` — Cloud Optimized GeoTIFF. */
        COG?: unknown;

        // ── B-52 (27/07/2026) — les 5 namespaces que B-13 avait laissés fermés ───────────
        //
        // ⚠️ B-13 a retiré la traîne `[key: string]: unknown` de cette interface et déclaré
        // 7 namespaces de plugins. Les 5 ci-dessous n'y étaient pas, et le retrait de la
        // traîne les a donc rendus **inatteignables au niveau des types** : un intégrateur
        // compilant contre les types publiés recevait TS2339 sur `GeoLeaf.FileImport`, alors
        // que le plugin le monte bien au runtime. Les deux effets de B-13 — 8 API fantômes
        // tombées, 5 plugins fermés — venaient du MÊME geste ; seul le premier était voulu.
        //
        // Mesuré par une sonde qui compile contre `dist/types/` **via l'exports map**, comme
        // le fait un intégrateur (`examples/consumer/`) : 5 erreurs avant, 0 après. La sonde
        // portait aussi un témoin POSITIF (`GeoLeaf.COG`, déclaré) pour prouver qu'elle
        // discriminait au lieu de tout rejeter.
        //
        // `unknown` suffit ici, et c'est délibéré : l'objet de cette ligne est l'EXISTENCE de
        // la propriété (une faute de frappe ne compile pas, un accès légitime compile). Le
        // typage fin de chaque surface reste le gisement de B-13, et **ne s'élargit jamais en
        // arrière vers `any`**.
        //
        // ⚠️ `offline-ui` n'est pas dans cette liste et n'y sera jamais : il ne monte AUCUN
        // namespace propre — il pilote `GeoLeaf.Storage`, qui est une façade du core. Son
        // `entry.ts` l'écrit en toutes lettres.

        /** `@geoleaf-plugins/file-import` — conversion GPX/KML/KMZ/CSV/TSV/TopoJSON. */
        FileImport?: unknown;
        /**
         * `@geoleaf-plugins/measure` — outils de mesure.
         *
         * ⚠️ **Ne pas confondre avec `measure` en minuscule**, plus haut dans cette même
         * interface : celui-là est l'aide de mesure de performance entre deux marques. Les
         * deux ne diffèrent que par la casse. C'est d'ailleurs le compilateur qui l'a signalé
         * — la sonde de B-52 a rendu TS2551 « Did you mean 'measure'? » sur ce nom.
         */
        Measure?: unknown;
        /** `@geoleaf-plugins/print` — export imprimable de la carte. */
        Print?: unknown;
        /** `@geoleaf-plugins/editor` — édition d'entités. */
        Editor?: unknown;
        /** `@geoleaf-plugins/websocket` — flux WebSocket (monté sous `Ws`, pas `Websocket`). */
        Ws?: unknown;

        /** @internal Enregistrement du Service Worker (`kernel/storage/sw-register.ts`). */

        /** Métriques runtime (alias historique de `getRuntimeMetrics`). */
        getPerformanceMetrics?: () => unknown;
        /** Métriques runtime — temps d'init, mémoire, rendu. */
        getRuntimeMetrics?: () => unknown;
        /** Remet les compteurs de métriques à zéro. */
        resetRuntimeMetrics?: () => void;
    }

    /** The global `GeoLeaf` namespace (`undefined` before boot completes). */
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
