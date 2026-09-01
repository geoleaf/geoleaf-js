/*!
 * GeoLeaf Core – Events / Public Facade implementation
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * Implementation of the public `GeoLeaf.Events` / `GeoLeaf.events` surface — lets
 * integrators subscribe to, and unsubscribe from, GeoLeaf lifecycle events without
 * needing access to the internal `dispatchGeoLeafEvent`.
 *
 * Integrators **subscribe only**. Dispatching is internal to GeoLeaf.
 *
 * ## Why this lives here and not in `geoleaf.events.ts`
 *
 * Split out: `modules/geoleaf.events.ts` is a public facade and, per the "Façades
 * publiques" rule (ARCHITECTURE.md), carries no logic. The three DOM listener calls
 * below are that logic, so they moved here — the same conformation `storage` received
 * in S3 (`kernel/storage/facade.ts`), which the architecture document names as the
 * reference.
 *
 * Kept separate from `event-bus.ts` rather than merged into it: dispatch and
 * subscription have disjoint audiences. `dispatchGeoLeafEvent` has internal callers only
 * and no integrator-facing surface; `on`/`off`/`once` have zero internal callers and
 * exist only for integrators. Merging would make every one of those internal modules
 * import the public surface just to reach the dispatcher.
 *
 * ⚠️ This paragraph announced "16 internal callers", twice. The count was **20** on
 * 13/08/2026 with nothing having flagged it, and the seam typing pushed it up
 * again. The argument does not depend on the number — it depends on there being
 * many on one side and zero on the other. The number is therefore removed rather
 * than refreshed; it measures:
 * `grep -rn "dispatchGeoLeafEvent(" packages/core/src --include=*.ts`.
 *
 * ⚠️ Unlike the storage facade, this module has **no top-level side effect**. The global
 * mount belongs to `globals/globals.api.ts` (single owner, frozen by the boot golden
 * master); self-mounting here would duplicate the assignment.
 *
 * @example — Basic usage
 * ```ts
 * GeoLeaf.Events.on("geoleaf:poi:panel:open", (e) => {
 *   console.log("POI panel opened:", e.detail.poiId, e.detail.poiName);
 * });
 * ```
 *
 * @example — One-time listener
 * ```ts
 * GeoLeaf.Events.once("geoleaf:app:ready", () => {
 *   console.log("App is ready!");
 * });
 * ```
 *
 * @example — Analytics / Matomo
 * ```ts
 * GeoLeaf.Events.on("geoleaf:poi:panel:open", (e) => {
 *   _paq.push(["trackEvent", "Map", "POI Panel", e.detail.poiId]);
 * });
 * GeoLeaf.Events.on("geoleaf:filter:apply", (e) => {
 *   _paq.push(["trackEvent", "Map", "Filter Apply", e.detail.activeCount.toString()]);
 * });
 * ```
 *
 * @example — Analytics / Google Analytics 4
 * ```ts
 * GeoLeaf.Events.on("geoleaf:map:move", (e) => {
 *   gtag("event", "map_pan", { lat: e.detail.center.lat, lng: e.detail.center.lng });
 * });
 * GeoLeaf.Events.on("geoleaf:layer:toggle", (e) => {
 *   gtag("event", "layer_toggle", { layer_id: e.detail.layerId, visible: e.detail.visible });
 * });
 * ```
 *
 * ---
 * ## Complete event reference
 *
 * | Event name                    | When fired                              | Key payload fields                        |
 * |-------------------------------|-----------------------------------------|-------------------------------------------|
 * | `geoleaf:app:ready`           | App fully initialized                   | `version`, `timestamp`                    |
 * | `geoleaf:map:ready`           | MapLibre map created                    | —                                         |
 * | `geoleaf:basemap:change`      | Base tile layer switched                | `key`, `previousKey`                      |
 * | `geoleaf:theme:applied`       | Theme applied (layers loaded)           | `themeName`, `layerCount`                 |
 * | `geoleaf:poi:click`           | 🛑 **DECLARED, NEVER EMITTED** (see below) | `poiId`, `layerId`, `source` (no referent) |
 * | `geoleaf:poi:panel:open`      | Side panel opened for a POI             | `poiId`, `poiName`                        |
 * | `geoleaf:poi:panel:close`     | Side panel closed                       | `poiId`                                   |
 * | `geoleaf:panel:opened`        | Desktop tab panel opened a tab          | `tabId`                                   |
 * | `geoleaf:panel:closed`        | Desktop tab panel closed a tab          | `tabId`                                   |
 * | `geoleaf:layer:toggle`        | Layer shown or hidden                   | `layerId`, `visible`, `source`            |
 * | `geoleaf:filter:apply`        | Filter predicate applied to features    | `layerIds`, `geometryType`, `activeCount` |
 * | `geoleaf:filter:reset`        | Feature filter cleared (all visible)    | `layerIds`                                |
 * | `geoleaf:map:move`            | Map panned (MapLibre `moveend`)         | `center.lat`, `center.lng`, `zoom`        |
 * | `geoleaf:map:zoom`            | Map zoom changed (MapLibre `zoomend`)   | `zoom`, `oldZoom`, `center`               |
 * | `geoleaf:plugin:loaded`       | Plugin registered synchronously         | `name`, `version`                         |
 * | `geoleaf:plugin:lazy-loaded`  | Lazy plugin loaded asynchronously       | `name`                                    |
 * | `geoleaf:plugin:failed`       | Lazy plugin failed to load              | `name`, `error`                           |
 * | `geoleaf:toolbar:action`      | Toolbar button activated (pill or tab)  | `action`, `element` ⚠ raw seam            |
 *
 * ⚠ `geoleaf:toolbar:action` is the one entry above that does NOT travel on the sanitising
 * bus: its `element` is a live `HTMLElement`, which `dispatchGeoLeafEvent`'s JSON round-trip
 * would flatten to `{}`. It is emitted as a raw `CustomEvent` by
 * `kernel/ui/toolbar-dispatch.ts` and typed in `GeoLeafRawEventMap`. Subscribing to it here
 * is fully typed; there is deliberately no way to emit it through this API.
 *
 * 🛑 **`geoleaf:poi:click` is DECLARED and NEVER EMITTED — subscribing to it
 * triggers nothing.** Measured on 17/08/2026: of the map's 49 events, 48 are cited
 * by emitting code, this one by none. ⚠️ **The table above announced it as "POI
 * marker clicked" for months, and three `@example`s of this very file showed how to
 * subscribe** — in the API's most-read document. The exact class of the phantom POI
 * API `CLAUDE.md` records as having already cost this repo: an extract right in
 * appearance, that nothing compiles or executes, and that an integrator copies
 * before wondering why their code does not react. (That API's name is not spelled
 * here on purpose: the `poi-dissolution` guard —
 * `__tests__/guards/extracted-features.guard.test.js` — refuses the token in
 * `src/`, and it bit on this very sentence. A guard that punishes the citation is
 * strict, not broken.) The examples now target `geoleaf:poi:panel:open`, which is
 * really emitted. The event is NOT removed from the map (published interface); it
 * is said to be false.
 *
 * @see `kernel/events/event-bus.ts` for the internal event dispatcher
 */

import type { GeoLeafEventMap, GeoLeafRawEventMap } from "../../contracts/event-bus.contract.js";
import { Log } from "../../utils/log/index.js";

/**
 * Everything a consumer may SUBSCRIBE to — the sanitised bus plus the raw DOM-carrying seams.
 *
 * The asymmetry with emission is deliberate (API publique S3): `dispatchGeoLeafEvent` stays
 * bound to `GeoLeafEventMap` alone, because it JSON-clones its payload and would silently
 * strip the `HTMLElement` that `geoleaf:toolbar:action` exists to hand over. Listening has no
 * such constraint, so the facade covers both maps and `GeoLeaf.Events.on("geoleaf:toolbar:action", …)`
 * is finally typed — until now the canonical plugin extension path had to fall back to a raw
 * `document.addEventListener`, outside the very API the core provides for it.
 */
type GeoLeafListenableEventMap = GeoLeafEventMap & GeoLeafRawEventMap;

type GeoLeafEventHandler<K extends keyof GeoLeafListenableEventMap> = (
    event: CustomEvent<GeoLeafListenableEventMap[K]>
) => void;

/**
 * Names already flagged — one warning per name, not per call.
 *
 * An integrator subscribing in a render loop would otherwise produce hundreds of
 * identical lines, and a drowned console warns nobody any more.
 */
const _warnedNames = new Set<string>();

/**
 * Warns when an event name leaves the `geoleaf:` domain.
 *
 * 🛑 **WHY A WARNING RATHER THAN A REFUSAL, AND WHY HERE.**
 *
 * `on()` does `document.addEventListener(event, …)` **prefixing nothing**: the name
 * passes verbatim. A subscription to `"popup:action"` instead of
 * `"geoleaf:popup:action"` is therefore **necessarily dead** — and it is
 * **silently**, since the DOM accepts any string. Measured downstream: three
 * subscriptions in `GeoLeafMapView.js` have been in this case since they were
 * written, on a channel enriched expressly for them.
 *
 * ⚠️ **Typing does not protect the person concerned.** `K extends keyof
 * GeoLeafListenableEventMap` refuses the faulty name at compilation — but the
 * consumer who erred is in **JavaScript**, in a codebase that does not compile our
 * types. The guarantee exists precisely where it is not read.
 *
 * ✅ **It is the repo's gesture when a fact cannot be gated where it is needed:
 * make it TRAVEL with the artifact**, as `SERVEUR.md` ships with the deliverable
 * because no gate sees the integrator's nginx. `EM-03` closes this class for OUR
 * code; nothing can close it in a consumer's code, except the API itself at call
 * time.
 *
 * 🖐 **It warns, it does not refuse.** Refusing would break at runtime an
 * integrator whose only fault is having written a name we accepted yesterday — on
 * a published API, with an empty `DEPRECATIONS.json`. The warning makes the defect
 * visible without breaking anything.
 */
function _warnIfOutOfDomain(event: string): void {
    if (event.startsWith("geoleaf:") || _warnedNames.has(event)) return;
    _warnedNames.add(event);
    Log.warn(
        `[GeoLeaf.Events] « ${event} » ne commence pas par « geoleaf: » — cet abonnement ne se ` +
            "déclenchera JAMAIS. Les événements GeoLeaf portent tous le préfixe du domaine, et " +
            "cette API ne l'ajoute pas : le nom est passé tel quel à `document`. " +
            `Vouliez-vous « geoleaf:${event} » ?`
    );
}

/**
 * Public GeoLeaf Events API.
 * Exposed as `GeoLeaf.Events` (canonical) and `GeoLeaf.events` (legacy alias).
 */
export const Events = {
    /**
     * Registers a listener for a GeoLeaf event.
     * The listener is called every time the event fires until `off()` is called.
     *
     * @param event - Event name (see module docs for full reference).
     * @param handler - Callback receiving the `CustomEvent` with typed `detail`.
     *
     * @example
     * ```js
     * GeoLeaf.Events.on("geoleaf:poi:panel:open", (e) => {
     *     console.log("Panneau POI ouvert :", e.detail.poiId);
     * });
     * ```
     */
    on<K extends keyof GeoLeafListenableEventMap>(event: K, handler: GeoLeafEventHandler<K>): void {
        if (typeof document === "undefined") return;
        _warnIfOutOfDomain(event as string);
        document.addEventListener(event, handler as EventListener);
    },

    /**
     * Removes a previously registered listener.
     * The exact same `handler` reference must be passed.
     *
     * @param event - Event name.
     * @param handler - The handler reference originally passed to `on()`.
     *
     * @example
     * ```js
     * // The handler must be NAMED: an anonymous function can never be removed.
     * const handlePoiPanel = (e) => {
     *     console.log(e.detail.poiId);
     * };
     * GeoLeaf.Events.on("geoleaf:poi:panel:open", handlePoiPanel);
     *
     * // Plus tard :
     * GeoLeaf.Events.off("geoleaf:poi:panel:open", handlePoiPanel);
     * ```
     */
    off<K extends keyof GeoLeafListenableEventMap>(
        event: K,
        handler: GeoLeafEventHandler<K>
    ): void {
        if (typeof document === "undefined") return;
        _warnIfOutOfDomain(event as string);
        document.removeEventListener(event, handler as EventListener);
    },

    /**
     * Registers a listener that fires **once** then automatically removes itself.
     * Uses the native `{once: true}` option — no wrapper function needed.
     *
     * @param event - Event name.
     * @param handler - Callback called at most once.
     *
     * @example
     * ```js
     * GeoLeaf.Events.once("geoleaf:app:ready", () => {
     *     console.log("App prête !");
     * });
     * ```
     */
    once<K extends keyof GeoLeafListenableEventMap>(
        event: K,
        handler: GeoLeafEventHandler<K>
    ): void {
        if (typeof document === "undefined") return;
        _warnIfOutOfDomain(event as string);
        document.addEventListener(event, handler as EventListener, { once: true });
    },
};
