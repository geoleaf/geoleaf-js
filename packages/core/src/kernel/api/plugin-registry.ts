/*!
 * GeoLeaf Core – API / PluginRegistry
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Lightweight registry of loaded GeoLeaf plugins and modules.
 * Allows integrators to query available capabilities.
 *
 * @example
 * GeoLeaf.plugins.isLoaded('editor')       // → true/false
 * GeoLeaf.plugins.getLoadedPlugins()        // → ['core', 'editor', 'measure']
 * GeoLeaf.plugins.canActivate('offline-ui') // → true if dependencies OK
 */

import type {
    PluginEntry,
    PluginLayerLoader,
    PluginLazyUI,
    PluginMetadata,
    LazyResolver,
    LazyUISlotEntry,
} from "./api-types.ts";
import type { ICapabilityDeclaration } from "../../contracts/capability.contract.ts";
import { CapabilityRegistry } from "./capability-registry.js";

/** name → registered plugin entry. */
const _registry = new Map<string, PluginEntry>();

/** name → lazy resolver. */
const _lazyResolvers = new Map<string, LazyResolver>();

/** Layer loaders registered by plugins to render declarative `plugin:` layers. */
const _layerLoaders = new Map<string, PluginLayerLoader>();

/** Lazy plugin UI descriptors — keyed by action name. */
const _lazyUISlots = new Map<string, LazyUISlotEntry>(); // action → { id, pluginName, mobileIcon?, desktopTabButton? }

/**
 * Dispatches a GeoLeaf custom event on `document` (inline, no external import).
 * Same pattern used by baselayers/registry.ts to avoid circular dependencies.
 * @internal
 */
function _firePluginEvent(name: string, detail: Record<string, unknown>): void {
    if (typeof document === "undefined") return;
    try {
        document.dispatchEvent(new CustomEvent(name, { detail, bubbles: false }));
    } catch (_e) {
        // Silent — non-critical telemetry event
    }
}

/**
 * Registry of mounted plugins, keyed by name.
 *
 * The plugin counterpart of {@link CapabilityRegistry}. Registration is what puts a plugin's
 * namespace on the global, so a plugin absent from here is absent from `GeoLeaf.*` — which is
 * the usual explanation for an integrator's call landing on `undefined`.
 */
export const PluginRegistry = {
    /**
     * Registers a plugin as loaded.
     * Called automatically by globals.js and plugin files.
     * @param {string} name - Plugin identifier (e.g. 'editor', 'measure', 'connector')
     * @param {object} [metadata] - Optional metadata { version, requires, optional }
     */
    register(name: string, metadata: PluginMetadata = {}) {
        const version = metadata.version || null;
        _registry.set(name, {
            name,
            version,
            loaded: true,
            loadedAt: Date.now(),
            requires: metadata.requires || [],
            optional: metadata.optional || [],
            label: metadata.label || name,
            healthCheck: metadata.healthCheck || null,
        });
        _firePluginEvent("geoleaf:plugin:loaded", { name: String(name), version });
    },

    /**
     * Registers a lazy resolver (called by bundle-entry.js).
     * @param {string} name
     * @param {Function} resolver - () => Promise<void>
     */
    registerLazy(name: string, resolver: LazyResolver) {
        _lazyResolvers.set(name, resolver);
    },

    /**
     * Registers a capability declaration so it can be queried via
     * `GeoLeaf.Introspection.getCapabilitySchema()` / `getAllCapabilities()`.
     *
     * Idempotent — registering the same `id` twice is a no-op.
     * The declaration's optional `loader` is called at most once, on demand,
     * via `CapabilityRegistry.ensureLoaded()`.
     *
     * @param decl - Capability declaration (id, gate, configSchema, loader…).
     *
     * @example
     * ```typescript
     * GeoLeaf.plugins.registerCapability({
     *   id: 'labels',
     *   label: 'Labels',
     *   gate: { configPath: 'modules.table.enabled' },
     *   configSchema: {
     *     pageSize: { type: 'number', description: 'Rows per page', default: 25 },
     *   },
     *   loader: () => import('@geoleaf-plugins/table').then(() => void 0),
     * });
     * ```
     */
    registerCapability(decl: ICapabilityDeclaration): void {
        CapabilityRegistry.register(decl);
    },

    /**
     * Registers a layer loader for a plugin-backed declarative layer.
     * Called by a plugin (e.g. flatgeobuf) so the core profile loader can render
     * layers declared with `"plugin": "<id>"` in a profile config — without the
     * core referencing any plugin by name.
     * @param {string} pluginId - Plugin identifier matching the layer config `plugin` field.
     * @param {Function} loader - Async loader (def) => Promise<layerId>.
     */
    registerLayerLoader(pluginId: string, loader: PluginLayerLoader) {
        if (typeof loader === "function") _layerLoaders.set(String(pluginId), loader);
    },

    /**
     * Returns the layer loader registered for the given plugin id, or undefined.
     * @param {string} pluginId
     */
    getLayerLoader(pluginId: string): PluginLayerLoader | undefined {
        return _layerLoaders.get(String(pluginId));
    },

    /**
     * Returns true if the plugin is registered lazy but not yet loaded.
     * Used by toolbar guards to show buttons before the bundle downloads.
     * @param {string} name
     */
    isLazyAvailable(name: string): boolean {
        return _lazyResolvers.has(name) && !PluginRegistry.isLoaded(name);
    },

    /**
     * Associates a toolbar action with a lazy plugin and its UI descriptor.
     * Call before `GeoLeaf.boot()` (e.g. from init.js) for each lazy plugin.
     * @param {string} action - toolbar action id (e.g. "print")
     * @param {string} pluginName - plugin registry name (e.g. "print")
     * @param ui - optional UI descriptor { mobileIcon?, desktopTabButton? }
     */
    registerLazyForAction(action: string, pluginName: string, ui?: PluginLazyUI) {
        _lazyUISlots.set(action, { id: String(action), pluginName: String(pluginName), ...ui });
    },

    /**
     * Returns true if the action is backed by a lazy plugin that is not yet loaded.
     * Used by the toolbar interceptor before dispatching actions.
     * @param {string} action
     */
    isLazyAction(action: string): boolean {
        const entry = _lazyUISlots.get(action);
        return !!entry && PluginRegistry.isLazyAvailable(entry.pluginName);
    },

    /**
     * Loads the plugin backing the given action if it is lazy and not yet loaded.
     * No-op if the plugin is already loaded or the action is not lazy.
     * @param {string} action
     */
    async ensureLoadedForAction(action: string): Promise<void> {
        const entry = _lazyUISlots.get(action);
        if (entry && PluginRegistry.isLazyAvailable(entry.pluginName)) {
            await PluginRegistry.load(entry.pluginName);
        }
    },

    /**
     * Returns the UI descriptors of all registered lazy plugins that are not yet loaded.
     * Consumed by toolbar renderers to show buttons before the bundle downloads.
     */
    getLazyUISlots(): LazyUISlotEntry[] {
        const slots: LazyUISlotEntry[] = [];
        for (const [, entry] of _lazyUISlots) {
            if (PluginRegistry.isLazyAvailable(entry.pluginName)) {
                slots.push(entry);
            }
        }
        return slots;
    },

    /**
     * Checks if a plugin is currently loaded.
     * @param {string} name
     * @returns {boolean}
     */
    isLoaded(name: string): boolean {
        return _registry.has(name) && _registry.get(name)?.loaded === true;
    },

    /**
     * Checks if a plugin can be activated (its `requires` dependencies are loaded).
     * @param {string} name
     * @returns {boolean}
     */
    canActivate(name: string): boolean {
        const entry = _registry.get(name);
        if (!entry) return _lazyResolvers.has(name);
        return entry.requires.every((dep: string) => PluginRegistry.isLoaded(dep));
    },

    /**
     * Lazily loads a plugin by name.
     * @param {string} name
     * @returns {Promise<void>}
     */
    async load(name: string): Promise<void> {
        if (PluginRegistry.isLoaded(name)) return;
        const resolver = _lazyResolvers.get(name);
        if (!resolver)
            throw new Error(
                `[GeoLeaf.plugins] Module inconnu : "${name}". Modules disponibles : ${[..._lazyResolvers.keys()].join(", ")}`
            );
        try {
            await resolver();
            _firePluginEvent("geoleaf:plugin:lazy-loaded", { name: String(name) });
        } catch (err) {
            _firePluginEvent("geoleaf:plugin:failed", {
                name: String(name),
                error: String(err).slice(0, 200),
            });
            throw err;
        }
    },

    /**
     * Returns the list of loaded plugin names.
     * @returns {string[]}
     */
    getLoadedPlugins(): string[] {
        return [..._registry.keys()].filter((k) => _registry.get(k)?.loaded);
    },

    /**
     * Returns the list of all availabthe modules (loaded + lazy available).
     * @returns {string[]}
     */
    getAvailableModules() {
        return [...new Set([..._registry.keys(), ..._lazyResolvers.keys()])];
    },

    /**
     * Returns the metadata of a plugin.
     * @param {string} name
     * @returns {object|null}
     */
    getInfo(name: string): PluginEntry | null {
        return _registry.get(name) || null;
    },

    /**
     * Prints a console report of loaded plugins (non-core). Silent if none.
     *
     * There is ONE report, and that is deliberate. Two reports existed until
     * 04/07/2026, splitting the registry on a manifest field backed by two
     * hard-coded name sets that OVERRODE the declared value — and disagreed with
     * it in both directions, so `storage` and `editor` each appeared in BOTH
     * reports and every boot double-counted them. A single report has no name set
     * to keep in sync, and therefore no way to drift. Do not partition it again.
     */
    reportPlugins() {
        const loaded = [..._registry.values()].filter((e) => e.loaded && !_isCoreName(e.name));
        // warnUnhealthy stays false — the behaviour retained from the two reports
        // this one replaced, which covered 10 of the 13 plugins. `connector` is
        // legitimately "not
        // connected" at boot, so warning on it would be a false alarm at every load.
        _reportPlugins(loaded, {
            header: `%c[PLUGINS] ${loaded.length} plugin(s) chargé(s)`,
            headerStyle: "color:#0369a1;font-weight:bold",
            healthyIcon: "✅",
            unhealthyIcon: "⚠️",
            healthyColor: "color:#0284c7",
            unhealthyColor: "color:#d97706",
            healthyStatus: "OK",
            unhealthyStatus: "non connecté",
            warnUnhealthy: false,
        });
    },

    // Internal access — do not use outside GeoLeaf
    _registry,
    _lazyResolvers,
    _lazyUISlots,
    _layerLoaders,
};

/** Core internal module names — excluded from the plugin report. */
function _isCoreName(name: string): boolean {
    return [
        "core",
        "labels",
        "route",
        // "table" removed (API S1): Table has been a standalone plugin for several
        // sprints — `plugins/table/src/entry.ts` calls `register("table", …)` — and no
        // core module registers under that name. Keeping it here silently hid a real
        // plugin from every boot report.
        "legend",
        "layerManager",
        "themes",
        "basemapSelector",
        "basemap-selector",
    ].includes(name);
}

/** Console-report style for the loaded-plugin report. */
interface PluginReportStyle {
    /** Pre-built `%c…` header string (already includes the count). */
    header: string;
    /** CSS applied to the `%c` header token. */
    headerStyle: string;
    healthyIcon: string;
    unhealthyIcon: string;
    healthyColor: string;
    unhealthyColor: string;
    healthyStatus: string;
    unhealthyStatus: string;
    /** When true, emit a `console.warn` for each unhealthy entry. */
    warnUnhealthy: boolean;
    /** Logged via `console.info` when the group is empty; omit to stay silent. */
    emptyInfo?: { text: string; style: string };
}

/**
 * Renderer for the loaded-plugin console report.
 * The caller passes a pre-filtered entry list plus a style descriptor; the
 * rendering (empty handling, grouping, per-entry line, optional unhealthy
 * warning) lives here.
 *
 * Kept parameterised although `reportPlugins()` is now its only caller: the style
 * descriptor is the seam a second report would reuse (see `reportPlugins` for why
 * there is only one today).
 */
function _reportPlugins(entries: PluginEntry[], style: PluginReportStyle): void {
    if (entries.length === 0) {
        if (style.emptyInfo) console.info(style.emptyInfo.text, style.emptyInfo.style);
        return;
    }

    /* eslint-disable no-console -- dev-facing console report: `group`/`log` are the
       point of this function, not incidental debug output. `no-console` allows
       warn/error/info (see eslint.config.mjs), which covers the two calls outside this
       block; groupCollapsed/log/groupEnd are not in that allowance and are what the
       collapsible plugin listing is made of. Scoped to the report body, not the file —
       any console call added elsewhere in this module still gets flagged. (Origin:
       three separate undocumented disables collapsed into this one.) */
    console.groupCollapsed(style.header, style.headerStyle);
    for (const entry of entries) {
        const healthy = typeof entry.healthCheck === "function" ? entry.healthCheck() : true;
        const icon = healthy ? style.healthyIcon : style.unhealthyIcon;
        const color = healthy ? style.healthyColor : style.unhealthyColor;
        const label = entry.label || entry.name;
        const version = entry.version ? ` v${entry.version}` : "";
        const status = healthy ? style.healthyStatus : style.unhealthyStatus;
        console.log(`%c  ${icon} ${label}${version}  [${status}]`, color);
        if (style.warnUnhealthy && !healthy) {
            console.warn(
                `     [PLUGINS] ${entry.name} : healthCheck failed — check plugin loading.`
            );
        }
    }
    console.groupEnd();
    /* eslint-enable no-console */
}
