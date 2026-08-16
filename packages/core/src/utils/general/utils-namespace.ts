/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Canonical composition of the `GeoLeaf.Utils` namespace.
 *
 *
 * @remarks
 * KERNEL S14 — this module exists so the ESM export and the runtime global describe
 * the SAME surface. Before it, they did not: `kernel-exports.ts` re-exported the bare
 * 12-key object from `general-utils.ts`, while `globals.core.ts` built a 27-key
 * namespace on `window.GeoLeaf.Utils`. `import { Utils } from "@geoleaf/core"` and
 * `window.GeoLeaf.Utils` were simply different objects with different shapes, and
 * nothing in the test suite compared them.
 *
 * It is deliberately **side-effect free** — it touches neither `globalThis` nor
 * `GeoLeaf`. That is what lets `kernel-exports.ts` consume it without dragging the
 * boot-ordered mutations of `globals.core.ts` (invariant B1→B11, ADR-08) into the ESM
 * entry point.
 *
 * ## Why an applier and not a shared object
 *
 * `performanceProfiler` is a **lazy getter** (`Object.defineProperty`): reading it
 * constructs the profiler. `Object.assign` *reads* getters, so copying a pre-built
 * object onto the global would invoke `getPerformanceProfiler()` at boot and destroy
 * the laziness — silently, with every key still present, so no key-presence test
 * would notice. {@link applyUtilsNamespace} therefore re-installs the descriptor on
 * the target instead of copying a value.
 *
 * The getter is also **non-enumerable** (it always was): it is reachable as
 * `GeoLeaf.Utils.performanceProfiler` but absent from `Object.keys()`. That asymmetry
 * is preserved here on purpose — changing it would alter the published surface.
 */

import { Utils as UtilsBase } from "./utils-base.js";
import { createElement, applyCssText } from "./dom-helpers.js";
import { DOMSecurity } from "../../kernel/security/index.js";
import { ErrorLogger } from "../log/error-logger.js";
import {
    EventListenerManager,
    globalEventManager,
    events as globalEvents,
} from "./event-listener-manager.js";
import { FetchHelper, FetchError } from "./fetch-helper.js";
import {
    PerformanceProfiler,
    getPerformanceProfiler,
} from "../performance/performance-profiler.js";
import { TimerManager } from "./timer-manager.js";
import { getNestedValue, hasNestedPath, setNestedValue } from "./object-utils.js";
import { calculateMapScale, isScaleInRange, clearScaleCache } from "./scale-utils.js";
import { wktToGeoJSON } from "../geo/wkt-parser.js";
// ARCHI S7 (7.3, geste 3) — promus depuis des modules internes que les plugins
// atteignaient en deep import. Tous deux purs et sans dépendance.
import { formatDateTime, formatFileSize, toMB, toGB } from "./formatters.js";
import { poiToFeature } from "./poi-to-feature.js";

/**
 * The full `GeoLeaf.Utils` surface: the 12 base helpers of `general-utils.ts` plus the
 * 16 members the kernel mounts on top, and `wktToGeoJSON`.
 *
 * `performanceProfiler` is typed as a property but is installed as a non-enumerable
 * lazy getter — see the module remarks.
 */
export type UtilsNamespace = typeof UtilsBase & {
    createElement: typeof createElement;
    // ARCHI S7 (7.3, geste 1) — `applyCssText` était exporté par `kernel-exports.ts` mais
    // n'avait AUCUN foyer runtime : les plugins qui l'utilisaient n'avaient donc pas de
    // cible sur `GeoLeaf.*`. Monté ici plutôt qu'en raccourci de premier niveau, par
    // cohérence avec `createElement`, qui vient du même `dom-helpers.ts`.
    applyCssText: typeof applyCssText;
    DOMSecurity: typeof DOMSecurity;
    ErrorLogger: typeof ErrorLogger;
    EventListenerManager: typeof EventListenerManager;
    events: typeof globalEvents;
    globalEventManager: typeof globalEventManager;
    FetchHelper: typeof FetchHelper;
    FetchError: typeof FetchError;
    PerformanceProfiler: typeof PerformanceProfiler;
    readonly performanceProfiler: ReturnType<typeof getPerformanceProfiler>;
    TimerManager: typeof TimerManager;
    ObjectUtils: {
        getNestedValue: typeof getNestedValue;
        hasNestedPath: typeof hasNestedPath;
        setNestedValue: typeof setNestedValue;
    };
    getNestedValue: typeof getNestedValue;
    hasNestedPath: typeof hasNestedPath;
    setNestedValue: typeof setNestedValue;
    ScaleUtils: {
        calculateMapScale: typeof calculateMapScale;
        isScaleInRange: typeof isScaleInRange;
        clearScaleCache: typeof clearScaleCache;
    };
    wktToGeoJSON: typeof wktToGeoJSON;
    // ARCHI S7 (7.3, geste 3) — sous-namespace cohérent avec `ObjectUtils` / `ScaleUtils`.
    Formatters: {
        formatDateTime: typeof formatDateTime;
        formatFileSize: typeof formatFileSize;
        toMB: typeof toMB;
        toGB: typeof toGB;
    };
    // Helper géo pur, au premier niveau comme son voisin `wktToGeoJSON`.
    poiToFeature: typeof poiToFeature;
};

/**
 * Installs the whole `Utils` surface onto `target`, in place.
 *
 * Used by `globals.core.ts` (B2) against the live `GeoLeaf.Utils` object, which must
 * stay the same reference across re-invocations of `setupCoreMap()` — the module
 * lifecycle re-runs it, and a caller may have captured `GeoLeaf.Utils` beforehand.
 *
 * @param target - the object to populate (mutated).
 */
export function applyUtilsNamespace(target: Record<string, unknown>): void {
    Object.assign(target, UtilsBase);
    target.createElement = createElement;
    target.applyCssText = applyCssText;
    target.DOMSecurity = DOMSecurity;
    target.ErrorLogger = ErrorLogger;
    target.EventListenerManager = EventListenerManager;
    target.events = globalEvents;
    target.globalEventManager = globalEventManager;
    target.FetchHelper = FetchHelper;
    target.FetchError = FetchError;
    target.PerformanceProfiler = PerformanceProfiler;
    // Lazy + non-enumerable, exactly as globals.core.ts installed it before S14.
    Object.defineProperty(target, "performanceProfiler", {
        get: () => getPerformanceProfiler(),
        configurable: true,
    });
    target.TimerManager = TimerManager;
    target.ObjectUtils = { getNestedValue, hasNestedPath, setNestedValue };
    target.getNestedValue = getNestedValue;
    target.hasNestedPath = hasNestedPath;
    target.setNestedValue = setNestedValue;
    target.ScaleUtils = { calculateMapScale, isScaleInRange, clearScaleCache };
    // Repatriated at S14 from the dead `utils-api.ts` assembler: documented on
    // `GeoLeaf.Utils` (README + 2 changelogs) but never actually mounted at runtime,
    // because its only entry point died with the UMD builds in v2.0.0.
    target.wktToGeoJSON = wktToGeoJSON;
    // ARCHI S7 (7.3, geste 3) — promus pour que les plugins cessent d'atteindre
    // `utils/general/formatters.js` et `utils/general/poi-to-feature.js` en deep import.
    target.Formatters = { formatDateTime, formatFileSize, toMB, toGB };
    target.poiToFeature = poiToFeature;
}

/**
 * Builds a fresh, fully-populated `Utils` object.
 *
 * Used by `kernel-exports.ts` so the ESM named export carries the same shape as the
 * runtime global. The two are intentionally **distinct objects** — the global must
 * remain mutable and re-appliable by the module lifecycle — so the invariant this
 * establishes is shape equality, not reference equality.
 */
export function createUtilsNamespace(): UtilsNamespace {
    const ns: Record<string, unknown> = {};
    applyUtilsNamespace(ns);
    return ns as UtilsNamespace;
}
