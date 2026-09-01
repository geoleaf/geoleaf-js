/*!
 * @geoleaf-plugins/routing — Controller
 *
 * Holds the itinerary, opens the panel, asks an engine, publishes the geometry, and turns every
 * refusal into a sentence. The one place the parts of this plugin meet.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { tLabel, getActiveLang, getGeoLeaf } from "@geoleaf/host-runtime";
import type { RouteFailure, RouteOutcome, RouteResult, Waypoint } from "./model.js";
import { decodePolyline } from "./polyline.js";
import { createProvider } from "./provider.js";
import { publishRoute, clearRoute } from "./publish.js";
import { originFromUserPosition } from "./origin.js";
import { openItineraryPanel, type ItineraryPanel, type PanelLabels } from "./ui/itinerary-panel.js";
import { travelProfile } from "./config.js";
import { cachedRoute, rememberRoute } from "./route-cache.js";
import { pickWaypointOnMap, type PickMode } from "./pick-on-map.js";
import { fitRouteIfOutOfView } from "./fit-route.js";
import { showPane } from "./ui-seam.js";

/**
 * ## Why the labels are resolved HERE and passed down
 *
 * Neither the panel nor the step list holds a string. They take what they render, which is what
 * makes both of them testable without a host and without a language: a rendering test that has to
 * boot an i18n facade to assert a list order is a test of the wrong thing.
 *
 * ## Why a failure is never a thrown error
 *
 * Every refusal this plugin produces is something the user can be told and, for three of them,
 * something they can act on. A throw would climb out of the click handler into whatever the host
 * does with unhandled rejections, and the panel would sit there with nothing said.
 */

/**
 * The identifier this plugin's panel is registered under, in the kernel's pane registry.
 *
 * ⚠️ It is also the DOM id of the host pane (`gl-rp-pane-routing`) and of its tab, so it may
 * not be changed without changing what `openPane` is asked for on the other side.
 */
export const PANE_ID = "routing";

/** The live state of this plugin, for as long as a panel is open. */
let panel: ItineraryPanel | null = null;
let waypoints: readonly Waypoint[] = [];
/**
 * The last route computed, kept so guidance can be started on it.
 *
 * ⚠️ Cleared by `onChange` along with the drawn route: a route computed for a previous list of
 * stops describes an itinerary that no longer exists, and starting guidance on it would follow
 * a line the user has already edited away.
 */
let lastRoute: RouteResult | null = null;

/**
 * The live "pick a stop on the map" mode, when there is one.
 *
 * 🛑 Held HERE and not in the panel, because this is what outlives the panel. A mode whose only
 * owner is the panel keeps a click handler on the map after the panel is gone, and every later
 * click on the map adds a stop nobody asked for.
 */
let picking: PickMode | null = null;

/** Leaves the pick mode, if one is running. Idempotent, and safe with no panel. */
function stopPicking(): void {
    picking?.stop();
    picking = null;
    panel?.setPicking(false);
}

/**
 * The precision every geometry in this package is encoded at.
 *
 * ⚠️ **5, and it is not a free choice.** Valhalla encodes at 1e6 and OSRM at 1e5; the
 * normalisers re-encode everything to 5 so that one number is true of every route this package
 * produces. Decoding at the wrong factor puts Réunion at latitude −208 — measured in sprint 1,
 * on the captured corpus.
 */
const POLYLINE_PRECISION = 5;

/**
 * Every string the panel renders, in the interface language.
 *
 * @returns The labels.
 */
function labels(): PanelLabels {
    const t = (k: string) => tLabel(`routing.${k}`);
    return {
        title: t("panel.title"),
        close: t("panel.close"),
        useMyPosition: t("origin.you"),
        clear: t("panel.clear"),
        compute: t("panel.compute"),
        startGuidance: t("panel.startGuidance"),
        empty: t("panel.empty"),
        origin: t("step.origin"),
        via: t("step.via"),
        destination: t("step.destination"),
        moveUp: t("step.moveUp"),
        moveDown: t("step.moveDown"),
        remove: t("step.remove"),
        leg: (metres, seconds) => `${formatDistance(metres)} · ${formatDuration(seconds)}`,
        total: (metres, seconds) => `${formatDistance(metres)} · ${formatDuration(seconds)}`,
        failure: (reason) => t(`error.${FAILURE_KEYS[reason] ?? "http"}`),
        input: {
            field: t("add.field"),
            add: t("add.submit"),
            pickOnMap: t("add.pick"),
            picking: t("add.picking"),
            refusal: (reason) => t(`add.${INPUT_REFUSAL_KEYS[reason] ?? "notCoordinates"}`),
        },
    };
}

/**
 * i18n key per input refusal.
 *
 * ⚠️ A table and not `t(\`add.\${reason}\`)`: the refusals are kebab-case because they read as
 * data, the keys are camelCase because every other key in this package is, and interpolating one
 * into the other yields a key that resolves nowhere — which the banner's own note calls the most
 * alarming possible way to say "unknown".
 */
const INPUT_REFUSAL_KEYS: Record<string, string> = {
    "not-coordinates": "notCoordinates",
    "out-of-range": "outOfRange",
    "no-match": "noMatch",
    "search-failed": "searchFailed",
};

/** Refusal → i18n key suffix. */
const FAILURE_KEYS: Readonly<Record<string, string>> = {
    timeout: "timeout",
    network: "network",
    http: "http",
    malformed: "malformed",
    "no-route": "noRoute",
    refused: "refused",
    "cap-reached": "capReached",
    "no-layer": "noLayer",
    // ⚠️ The three origin refusals have their OWN sentences, and not out of
    // finesse: a refused permission is not a routing failure. Folding it onto
    // `refused` would tell the user their CONFIGURATION is at fault, when it
    // is they who said no — and the next step they must know (type a start by
    // hand) is unrelated.
    "origin-denied": "originDenied",
    "origin-no-fix": "originNoFix",
    "origin-unavailable": "originUnavailable",
};

/**
 * Opens the panel, appending whatever stops the caller brought.
 *
 * 🛑 **Appended, never assigned — and that is a behaviour change of 26/08/2026.** This used to
 * call `setWaypoints(initial)` when a panel was already open, which REPLACED the whole list.
 * The everyday consequence: press "your position", then click a POI on the map, and the start
 * point you just set is gone. The two gestures compose, so the code has to.
 *
 * ⚠️ Each stop goes through {@link ItineraryPanel.addWaypoint}, so the cap is honoured and a
 * refused stop says so in the message area. Assigning the array would have silently ignored it.
 *
 * @param initial Waypoints to append — a destination, when the call came from a POI.
 * @returns The panel.
 */
export function openPanel(initial: readonly Waypoint[] = []): ItineraryPanel {
    const live = ensurePanel();
    for (const waypoint of initial) live.addWaypoint(waypoint);
    // The kernel owns which surface is live: the desktop side panel above 1440px, the mobile
    // sheet below it. Asking for the pane by id is the only thing this plugin can honestly do.
    showPane(PANE_ID);
    return live;
}

/**
 * Takes the panel down and forgets everything it held.
 *
 * ⚠️ Distinct from {@link ItineraryPanel.close}, which only asks the host to hide it — the
 * itinerary survives a collapsed tab on purpose. This is the teardown: what a `Core.destroy()`
 * needs, and what a test needs between two cases, because `panel` is MODULE state and an open
 * one is reused rather than replaced.
 */
export function destroyPanel(): void {
    stopPicking();
    panel?.destroy();
    panel = null;
    waypoints = [];
    lastRoute = null;
}

/**
 * The panel, built on first use.
 *
 * ⚠️ Exported for the pane registry's `onOpen` hook, which fires when the KERNEL activates
 * this plugin's tab — a path that never goes through {@link openPanel}. It must NOT call
 * `openPanel` in turn: that asks the kernel to open the pane, and the kernel is what called us.
 *
 * @returns The live panel.
 */
export function ensurePanel(): ItineraryPanel {
    if (panel) return panel;
    waypoints = [];
    // 🛑 A NEW panel carries no route, so neither does `lastRoute`. Letting it
    // survive a closing would start guidance on a line the user no longer
    // sees: the panel re-displays an empty figure list, while the button
    // would leave on the old computation. A guidance following a line not
    // before your eyes is the worst of both worlds — it looks like it works.
    lastRoute = null;
    panel = openItineraryPanel(labels(), {
        onChange: (next) => {
            waypoints = next;
            // The drawn route describes an itinerary that no longer exists.
            lastRoute = null;
            clearRoute();
        },
        onCompute: (next) => {
            void compute(next);
        },
        onUseMyPosition: () => {
            useMyPosition();
        },
        onClose: () => {
            // ⚠️ The mode goes with the panel. It is the exit this file exists to guarantee:
            // three of the four ways out live in the mode itself, and this is the fourth.
            stopPicking();
            // 🛑 `panel` is NOT dropped here, and that changed on 26/08/2026 with the move
            // off the modal. A pane is hidden by its host, not destroyed — like the legend",
            // and dropping the reference would throw away the itinerary the user composed
            // every time they collapsed the tab. Losing a start point that way is the same
            // defect as the POI button overwriting it, reached from the other side.
        },
        onPickOnMap: () => {
            // A second press leaves the mode rather than starting a second one — a toggle,
            // because the button reads as one once it is showing "click on the map".
            if (picking?.active) {
                stopPicking();
                return;
            }
            picking = pickWaypointOnMap((wp) => {
                picking = null;
                panel?.setPicking(false);
                panel?.addWaypoint(wp);
            });
            // ⚠️ Reflected from what the mode ANSWERED, never from the intent: with no map
            // the mode is inert, and a button stuck on "click on the map" would wait for a
            // click that can never come.
            panel?.setPicking(picking.active);
        },
        // 🛑 The handler is provided ONLY when guidance is reachable, and
        // its absence is the guard: the panel then creates no button. See `guidanceHandler`.
        ...guidanceHandler(),
    });
    return panel;
}

/**
 * The plugin registry, with the two lazy-loading members the namespace does not declare.
 *
 * ⚠️ `isLazyAvailable` and `load` EXIST on the registry — `kernel/api/plugin-registry.ts`
 * and `:220`, measured — but `GeoLeafGlobal.plugins` declares neither, so both fall into its
 * `[key: string]: unknown` tail and are not callable through the typed surface.
 *
 * 🛑 The right repair is to DECLARE them, which narrows that tail — the direction the
 * namespace-typing ratchet moves, and never back towards `any`. It is not done here: adding a
 * member to the published namespace changes `packages/core/`'s public surface, and this sprint
 * is deliberately not the one that touches the core. Recorded as a finding instead.
 *
 * @returns The registry, typed for what this file calls.
 */
function lazyRegistry():
    | {
          isLoaded?(name: string): boolean;
          isLazyAvailable?(name: string): boolean;
          load?(name: string): Promise<void>;
      }
    | undefined {
    return getGeoLeaf()?.plugins as
        | {
              isLoaded?(name: string): boolean;
              isLazyAvailable?(name: string): boolean;
              load?(name: string): Promise<void>;
          }
        | undefined;
}

/**
 * The guidance handler, when guidance can be reached at all.
 *
 * 🛑 **`isLazyAvailable`, never `isLoaded`.** `navigation` is registered lazily, so `isLoaded`
 * answers `false` until something loads it — and the only thing that ever would is this
 * button. Gating on `isLoaded` would hide the entry point behind the condition it exists to
 * satisfy. This is the same trap that forces `routing` itself to stay eager (D2), met from the
 * other side.
 *
 * ⚠️ The handler is OMITTED rather than supplied-and-disabled when guidance is absent. A
 * disabled button says "this exists but not for you", which is false: an integrator who did
 * not install the plugin has no such feature at all, and offering its greyed-out shape invites
 * them to look for a setting that does not exist.
 *
 * @returns An object carrying `onStartGuidance`, or an empty one.
 */
function guidanceHandler(): { onStartGuidance?: () => void } {
    const plugins = lazyRegistry();
    const reachable =
        plugins?.isLoaded?.("navigation") === true ||
        plugins?.isLazyAvailable?.("navigation") === true;
    if (!reachable) return {};
    return { onStartGuidance: () => void startGuidance() };
}

/**
 * Loads guidance if needed, then hands it the computed route.
 *
 * ⚠️ The two functions handed over are CLOSURES over this module's own provider and codec.
 * `navigation` imports only TYPES from this package, so it can obtain neither — and putting
 * them on `GeoLeaf.Routing` would grow the public surface by two exports whose only consumer
 * is one call site.
 *
 * @returns Nothing. Failures are reported through the panel, never thrown: a guidance session
 *          that could not start is an outcome the user must be told about, not an exception
 *          that takes the map with it.
 */
async function startGuidance(): Promise<void> {
    if (!lastRoute) return;
    try {
        await lazyRegistry()?.load?.("navigation");
    } catch {
        panel?.showFailure("refused");
        return;
    }
    const nav = getGeoLeaf()?.Navigation as
        | {
              start?(
                  route: RouteResult,
                  line: readonly (readonly [number, number])[],
                  deps: {
                      recompute(
                          from: readonly [number, number],
                          remaining: readonly Waypoint[]
                      ): Promise<RouteOutcome>;
                      decodeGeometry(geometry: string): readonly (readonly [number, number])[];
                  }
              ): void;
          }
        | undefined;
    if (typeof nav?.start !== "function") {
        // Loaded, but without the expected surface: a version on one side not
        // matching the other. Saying so beats a button that does nothing.
        panel?.showFailure("refused");
        return;
    }
    nav.start(lastRoute, decodePolyline(lastRoute.geometry, POLYLINE_PRECISION), {
        recompute: async (from, remaining): Promise<RouteOutcome> => {
            // Same call shape as `compute` — a provider created on demand,
            // never captured: the configuration may have changed between the
            // initial computation and a recompute an hour later.
            const provider = createProvider();
            if (!provider) return { ok: false, reason: "refused" };
            return provider.route({
                waypoints: [{ coordinates: from }, ...remaining],
                profile: travelProfile(),
                language: getActiveLang(),
            });
        },
        decodeGeometry: (geometry) => decodePolyline(geometry, POLYLINE_PRECISION),
    });
    panel?.close();
}

/**
 * Adds the user's position as the ORIGIN of the current itinerary.
 *
 * ⚠️ Prepended, not appended: "your position" is where the journey starts. Appending it would
 * make the user their own destination, which is a route of length zero and reads as a bug.
 *
 * ⚠️ NOT exported: the panel button is how this is reached, and nothing has asked for a
 * programmatic entry. Advertising one "in case" is how a surface grows methods nobody calls and
 * nobody can remove later without a major.
 *
 * @returns Whether a position was available.
 */
function useMyPosition(): boolean {
    const res = originFromUserPosition(tLabel("routing.origin.you"));
    if (!res.ok) {
        panel?.showFailure(`origin-${res.reason}` as const);
        return false;
    }
    const next = [res.waypoint, ...waypoints.filter((w) => w.name !== res.waypoint.name)];
    panel?.setWaypoints(next);
    return true;
}

/**
 * Asks the configured engine and publishes what comes back.
 *
 * @param next The itinerary to compute.
 */
/**
 * Whether a computation is in flight.
 *
 * 🛑 **The re-entrance guard, and the burst it actually prevents is not the one the backlog line
 * described.** That line assumed a recomputation on every edit; measured, editing the list
 * recomputes nothing — `compute()` is reached from the compute button alone. What DOES fire three
 * requests is pressing that button three times, which nothing stopped: it is disabled on an
 * unroutable itinerary and on nothing else.
 *
 * ⚠️ A flag and not a debounce timer. A timer would DELAY an explicit press, which is the one
 * gesture a user is entitled to see answered immediately; this refuses only the presses that
 * arrive while the first is still being answered.
 */
let computing = false;

async function compute(next: readonly Waypoint[]): Promise<void> {
    if (computing) return;

    // ⚠️ Read BEFORE the guard is set, so a cache hit does not leave the flag raised on a path
    // that never clears it. A hit costs no request and no quota, which is the whole point.
    const cached = cachedRoute({
        waypoints: next,
        profile: travelProfile(),
        language: getActiveLang(),
    });
    if (cached) {
        show(cached);
        return;
    }

    const provider = createProvider();
    // `refused` covers both "no adapter for this id" and "the endpoint was not accepted" —
    // the two the factory answers `null` for, and both a configuration problem.
    if (!provider) {
        panel?.showFailure("refused");
        return;
    }

    const request = {
        waypoints: next,
        profile: travelProfile(),
        language: getActiveLang(),
    };

    computing = true;
    panel?.setComputing(true);
    let outcome;
    try {
        outcome = await provider.route(request);
    } finally {
        // `finally`, so a provider that throws does not leave the button dead for the rest of the
        // session. A guard that can get stuck is worse than none: it turns a transient failure
        // into a panel nobody can use again.
        computing = false;
        panel?.setComputing(false);
    }

    if (!outcome.ok) {
        panel?.showFailure(outcome.reason satisfies RouteFailure);
        return;
    }
    // ⚠️ Only a SUCCESS is remembered. Caching a refusal would make a transient network failure
    // permanent for the rest of the session, with a retry that never leaves the page.
    rememberRoute(request, outcome.route);
    show(outcome.route);
}

/**
 * Draws a computed route and tells the panel about it.
 *
 * @param route The route.
 */
function show(route: RouteResult): void {
    lastRoute = route;
    panel?.setRoute(route);
    const published = publishRoute(route);
    // 🛑 A route that computed but could not be drawn is NOT a success to stay silent about: the
    // user asked for a line on a map and there is none. The panel says which of the two failed.
    if (!published.ok) {
        panel?.showFailure("no-layer");
        return;
    }
    // ⚠️ Framed only AFTER a successful publication, and only when the route is not already on
    // screen. Moving the map for a line that was not drawn would leave someone looking at an empty
    // frame that just moved to show them nothing.
    fitRouteIfOutOfView(route);
}

/**
 * A distance, in the unit a reader expects at that magnitude.
 *
 * @param metres The distance.
 * @returns The text.
 */
function formatDistance(metres: number): string {
    return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

/**
 * A duration, in whole minutes — the precision a travel estimate can honestly carry.
 *
 * @param seconds The duration.
 * @returns The text.
 */
function formatDuration(seconds: number): string {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}
