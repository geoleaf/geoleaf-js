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
 * Split in S13.1: `modules/geoleaf.events.ts` is a public facade and, per the "Façades
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
 * ⚠️ Ce paragraphe annonçait « 16 internal callers », deux fois. Le compte valait **20** au
 * 13/08/2026 sans que rien ne l'ait signalé, et le Sprint 4 du contrat inverse l'a encore
 * fait monter. L'argument ne dépend pas du nombre — il dépend du fait qu'il y en a beaucoup
 * d'un côté et zéro de l'autre. Le nombre est donc retiré plutôt que rafraîchi ; il se
 * mesure : `grep -rn "dispatchGeoLeafEvent(" packages/core/src --include=*.ts`.
 *
 * ⚠️ Unlike the storage facade, this module has **no top-level side effect**. The global
 * mount belongs to `globals/globals.api.ts` (single owner, frozen by the boot golden
 * master); self-mounting here would duplicate the assignment.
 *
 * @example — Basic usage
 * ```ts
 * GeoLeaf.Events.on("geoleaf:poi:click", (e) => {
 *   console.log("POI clicked:", e.detail.poiId);
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
 * GeoLeaf.Events.on("geoleaf:poi:click", (e) => {
 *   _paq.push(["trackEvent", "Map", "POI Click", e.detail.poiId]);
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
 * | `geoleaf:poi:click`           | POI marker clicked                      | `poiId`, `layerId`, `source`              |
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
 * Noms déjà signalés — un avertissement par nom, pas par appel.
 *
 * Un intégrateur qui s'abonne dans une boucle de rendu produirait sinon des centaines de
 * lignes identiques, et une console noyée n'avertit plus personne.
 */
const _warnedNames = new Set<string>();

/**
 * Avertit quand un nom d'événement sort du domaine `geoleaf:`.
 *
 * 🛑 **B-240 — POURQUOI UN AVERTISSEMENT PLUTÔT QU'UN REFUS, ET POURQUOI ICI.**
 *
 * `on()` fait `document.addEventListener(event, …)` **sans rien préfixer** : le nom passe
 * verbatim. Un abonnement à `"popup:action"` au lieu de `"geoleaf:popup:action"` est donc
 * **nécessairement mort** — et il l'est **en silence**, puisque le DOM accepte n'importe quelle
 * chaîne. Mesuré chez l'aval : trois abonnements de `GeoLeafMapView.js` sont dans ce cas depuis
 * qu'ils ont été écrits, sur un canal enrichi exprès pour eux.
 *
 * ⚠️ **Le typage ne protège pas la personne concernée.** `K extends keyof
 * GeoLeafListenableEventMap` refuse le nom fautif à la compilation — mais le consommateur qui
 * s'est trompé est en **JavaScript**, dans une base Odoo qui ne compile pas nos types. La
 * garantie existe précisément là où elle n'est pas lue.
 *
 * ✅ **C'est le geste du dépôt quand un fait ne peut pas être gaté chez celui qui en a besoin :
 * le faire VOYAGER avec l'artefact**, comme `SERVEUR.md` part avec le livrable parce qu'aucune
 * gate ne voit le nginx de l'intégrateur. `EM-03` ferme cette classe pour NOTRE code ; rien ne
 * peut la fermer dans le code d'un consommateur, sauf l'API elle-même au moment de l'appel.
 *
 * 🖐 **Il avertit, il ne refuse pas.** Refuser casserait à l'exécution un intégrateur dont le
 * seul tort est d'avoir écrit un nom que nous acceptions hier — sur une API publiée, et avec un
 * `DEPRECATIONS.json` vide. L'avertissement rend le défaut visible sans rien rompre.
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
     * GeoLeaf.Events.on("geoleaf:poi:click", (e) => {
     *     console.log("POI cliqué :", e.detail.poiId);
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
     * // Le handler doit être NOMMÉ : une fonction anonyme ne peut jamais être retirée.
     * const handlePoiClick = (e) => {
     *     console.log(e.detail.poiId);
     * };
     * GeoLeaf.Events.on("geoleaf:poi:click", handlePoiClick);
     *
     * // Plus tard :
     * GeoLeaf.Events.off("geoleaf:poi:click", handlePoiClick);
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
