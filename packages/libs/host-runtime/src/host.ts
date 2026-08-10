/*!
 * @geoleaf/host-runtime — typed access to the global `GeoLeaf` namespace
 * © 2026 Mattieu Pottier — MIT License
 *
 * Plugins reach the host application through the global `GeoLeaf` namespace assembled
 * at boot by `@geoleaf/core`. Historically each plugin did `const _g = globalThis as any`
 * (reintroducing `any`) and re-declared its own partial namespace shape, which drifted.
 * This module provides ONE typed accessor + ONE shared shape so plugins stop casting.
 * https://geoleaf.dev
 */

/**
 * Options accepted by `GeoLeaf.plugins.register`, per Plugin Contract v1.
 *
 * Consolidated at PLUGINS S1 from the seven private `GeoLeafPluginAPI` interfaces that
 * each `entry.ts` re-declared. They had already drifted: two omitted `requires`, two
 * omitted `isLoaded`, and five still carried the `type` field the contract dropped.
 *
 * The tail stays open — `registerLayerLoader` and friends are plugin-registry
 * extensions that only some consumers narrow.
 */
export interface PluginRegisterOptions {
    /** Plugin version, normally the build-time injected `__GEOLEAF_VERSION__`. */
    version?: string;
    /** Plugin ids that must already be loaded. */
    requires?: string[];
    /** Plugin ids used when present, tolerated when absent. */
    optional?: string[];
    /** Human-readable name for diagnostics. */
    label?: string;
    /** Returns false when the plugin is loaded but not operational. */
    healthCheck?: () => boolean;
    [key: string]: unknown;
}

/**
 * Structural shape of the global `GeoLeaf` namespace, as consumed by plugins.
 *
 * All members are optional (the namespace is assembled incrementally at boot and
 * varies by bundle) and every member tolerates extra keys. Cross-plugin façades
 * (`Measure`, `Print`, `Editor`, `AddPOI`, …) live in the `[key: string]: unknown`
 * tail and are narrowed locally by their consumers.
 *
 * @remarks Kept in sync (loosely) with the core source of truth `GeoLeafGlobal`
 * in `packages/core/src/global.d.ts`. This is the client-side subset plugins use.
 */
export interface GeoLeafHost {
    /** Configuration façade (`GeoLeaf.Config`). */
    Config?: {
        get(key: string, def?: unknown): unknown;
        getAll?(): Record<string, unknown>;
        getActiveProfile?(): unknown;
        [key: string]: unknown;
    };
    /** Core map façade (`GeoLeaf.Core`). */
    Core?: {
        getMap?(): { getNativeMap?(): unknown; [key: string]: unknown } | undefined;
        [key: string]: unknown;
    };
    /** Plugin registry / lifecycle façade (`GeoLeaf.plugins`). */
    plugins?: {
        /**
         * Registers a plugin against Plugin Contract v1.
         *
         * ⚠️ There is no `type` option, and no classification of any kind: every
         * plugin registers through the same shape. A `type` field existed until
         * 19/07/2026 and was removed from the contract by ARCHI S2 (RFC-002, spec
         * 1.3.0 → 1.4.0); nothing read it. Do not reintroduce one.
         */
        register?(name: string, opts: PluginRegisterOptions): void;
        isLoaded?(name: string): boolean;
        /**
         * Registers a per-layer loader so the core profile loader can render
         * `"plugin": "<id>"` layers declared in a profile, with no imperative code.
         * Core side: `kernel/api/plugin-registry.ts`.
         */
        registerLayerLoader?(
            pluginId: string,
            loader: (def: Record<string, unknown>) => Promise<string>
        ): void;
        [key: string]: unknown;
    };
    /** Legacy registration entry point (`GeoLeaf.registry`). */
    registry?: { register?(...args: unknown[]): unknown; [key: string]: unknown };
    /** Internationalization façade (`GeoLeaf.I18n`). */
    I18n?: {
        registerDict?(...args: unknown[]): unknown;
        getLabel?(key: string, fallback?: string): string;
        t?(key: string, ...args: unknown[]): string;
        [key: string]: unknown;
    };
    /** UI façade (`GeoLeaf.UI`) — notifications, controls, flags. */
    UI?: Record<string, unknown>;
    /** Offline storage façade (`GeoLeaf.Storage`). */
    Storage?: { DB?: Record<string, unknown>; [key: string]: unknown };
    /** Security helpers façade (`GeoLeaf.Security`). */
    Security?: {
        CSRFToken?: unknown;
        escapeHtml?(s: unknown): string;
        [key: string]: unknown;
    };
    /** Legend façade (`GeoLeaf.Legend`). */
    Legend?: Record<string, unknown>;

    // ── API publique S3.5 — les 6 membres que les plugins appellent le plus ──────────
    //
    // Ils tombaient tous dans la traîne `[key: string]: unknown` ci-dessous, donc
    // `GeoLeaf.GeoJSON.getLayerById(id)` rendait `unknown` chez chaque consommateur.
    // L'audit API publique a mesuré l'écart : `GeoJSON` est le membre le PLUS sollicité
    // du host (87 appels dans les plugins) et n'était pas au contrat, tandis que `POI`,
    // dissous au S9, y figurait encore — retiré au S1. La dérive était par construction
    // (host-runtime ne doit rien importer du core), et rien ne la surveillait ; c'est
    // désormais `scripts/verify-host-contract-sync.cjs`.
    //
    // Ajouts purement ADDITIFS : la traîne les absorbait déjà, aucun consommateur ne
    // casse. Les signatures sont relevées sur les appels réels, pas devinées ; chaque
    // membre garde sa propre traîne pour que les méthodes non relevées restent
    // atteignables.

    /**
     * GeoJSON layer façade (`GeoLeaf.GeoJSON`) — le membre le plus appelé du host.
     *
     * ⚠️ Distinct de `Layers` : celui-ci est la façade historique du sous-système
     * GeoJSON, `Layers` est le seam de données par couche (`LayerDataApi`).
     */
    GeoJSON?: {
        getLayerById?(id: string): unknown;
        getAllLayers?(): unknown;
        getLayerData?(id: string): unknown;
        addData?(...args: unknown[]): unknown;
        [key: string]: unknown;
    };

    /** Shared utilities façade (`GeoLeaf.Utils`). */
    Utils?: {
        createElement?(
            tag: string,
            props: Record<string, unknown>,
            ...children: unknown[]
        ): HTMLElement;
        applyCssText?(el: HTMLElement, css: string): void;
        validateUrl?(url: unknown): boolean;
        getDistance?(...args: unknown[]): number;
        Formatters?: Record<string, unknown>;
        DOMSecurity?: Record<string, unknown>;
        events?: Record<string, unknown>;
        [key: string]: unknown;
    };

    /** Logger façade (`GeoLeaf.Log`). */
    Log?: {
        error?(...args: unknown[]): void;
        warn?(...args: unknown[]): void;
        info?(...args: unknown[]): void;
        debug?(...args: unknown[]): void;
        [key: string]: unknown;
    };

    /**
     * Offline sync-handler registry (`GeoLeaf.Sync`) — a public API of fact: it is how a
     * data plugin pushes its offline sync handler into the core (`addpoi` calls
     * `GeoLeaf.Sync.registerHandler("poi", …)` in its own `entry.ts`).
     *
     * `handler` stays `unknown` here rather than mirroring the core's `SyncHandler`:
     * copying that shape is what this file must stop doing. Consumers narrow.
     */
    Sync?: {
        registerHandler?(id: string, handler: unknown): void;
        getHandler?(id: string): unknown;
        [key: string]: unknown;
    };

    /** Toast/notification façade (`GeoLeaf.Notifications`). */
    Notifications?: {
        show?(message: string, typeOrOptions?: unknown, duration?: number): unknown;
        [key: string]: unknown;
    };

    /** Per-layer data seam (`GeoLeaf.Layers`) — the core's `LayerDataApi`. */
    Layers?: {
        getFeatures?(layerId: string): unknown[];
        getFeatureById?(layerId: string, id: string | number): unknown;
        getFeatureCount?(layerId: string): number;
        listLayerIds?(): string[];
        hasLayer?(layerId: string): boolean;
        [key: string]: unknown;
    };

    /**
     * Long tail — plugin façades (`Measure`, `Print`, `Editor`, `AddPOI`, …) and
     * other boot-assembled members, not (yet) precisely typed. Consumers narrow.
     */
    [key: string]: unknown;
}

/** Minimal carrier used to read/write `GeoLeaf` off `globalThis` / `window`. */
type HostCarrier = { GeoLeaf?: GeoLeafHost };

/**
 * Returns the global `GeoLeaf` namespace, or `undefined` before boot completes.
 *
 * Typed replacement for the `const _g = globalThis as any` accessor blocks
 * scattered across plugins. Mirrors `@geoleaf/core`'s internal `getGeoLeaf`
 * (`packages/core/src/utils/general/geoleaf-global.ts`) — a pair now PINNED in
 * `scripts/verify-seam-drift.cjs` under `host-global (core ↔ host-runtime)`, because
 * `verify-plugin-shared-fork` exempts both sides and confronted neither.
 *
 * ⚠️ Ce chemin annonçait `packages/core/src/modules/utils/general/…` jusqu'à STRUCT S2 —
 * `src/modules/` a été supprimé à ARCHI S10.1. Un chemin faux dans un commentaire ne fait
 * rougir aucune gate ; celui-ci désignait le fichier même que ce module recopie.
 */
export function getGeoLeaf(): GeoLeafHost | undefined {
    if (typeof globalThis !== "undefined") {
        const g = (globalThis as HostCarrier).GeoLeaf;
        if (g) return g;
    }
    if (typeof window !== "undefined") {
        const w = (window as unknown as HostCarrier).GeoLeaf;
        if (w) return w;
    }
    return undefined;
}

/**
 * Returns the global `GeoLeaf` namespace, creating an empty one if absent.
 * Use when a plugin must assign its façade onto the namespace (e.g. `GeoLeaf.Measure = …`).
 */
export function ensureGeoLeaf(): GeoLeafHost {
    const carrier: HostCarrier =
        typeof globalThis !== "undefined"
            ? (globalThis as HostCarrier)
            : typeof window !== "undefined"
              ? (window as unknown as HostCarrier)
              : ({} as HostCarrier);
    carrier.GeoLeaf = carrier.GeoLeaf ?? {};
    return carrier.GeoLeaf;
}

/**
 * Reads a core configuration value through `GeoLeaf.Config.get`, returning
 * `fallback` when the namespace or `Config` is not (yet) available.
 *
 * Consolidates the `coreConfigGet` helper previously duplicated in each plugin's
 * `src/utils/core-config.ts` (PLUGINS S1) — plus aucun plugin ne porte ce fichier.
 * La copie du core vit dans `src/capabilities/offline/config-seam.ts`, épinglée avec ce
 * fichier dans le seam `host-global`.
 *
 * @typeParam T - Expected value type (caller-asserted; the namespace is untyped).
 */
export function coreConfigGet<T = unknown>(key: string, fallback?: T): T {
    const cfg = getGeoLeaf()?.Config;
    if (cfg && typeof cfg.get === "function") {
        const value = cfg.get(key, fallback);
        return (value === undefined ? fallback : value) as T;
    }
    return fallback as T;
}
