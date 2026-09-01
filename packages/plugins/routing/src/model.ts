/*!
 * @geoleaf-plugins/routing — Route model
 *
 * The seven entities every provider adapter normalises into, and the single place where the
 * units, the coordinate order and the geometry encoding are decided. Frozen AFTER a corpus of
 * real provider responses was captured, not before — see the note below, which is the reason.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * ## Why this shape is OSRM's, and why that is not an aesthetic choice
 *
 * It is the de-facto standard the other engines project onto cleanly, and the identity — rather
 * than a resemblance — keeps the later substitution of a guidance engine open at zero cost: an
 * object of this shape crosses the boundary of a third-party engine and renders a correct
 * projection there.
 *
 * ## What the captured corpus changed, and what freezing first would have shipped
 *
 * The two fixtures under `fixtures/` are the same three-waypoint trip answered by OSRM and by
 * Valhalla. Reading them before writing this file surfaced three differences that no amount of
 * careful thinking would have produced:
 *
 *  1. **Units.** OSRM answers metres and seconds; Valhalla answers KILOMETRES and seconds. A
 *     model frozen on "distance: number" would have had a Valhalla adapter reporting an 80 km
 *     trip as 80 metres, and every guidance threshold downstream would have been meaningless.
 *  2. **Polyline precision.** OSRM encodes at 1e5, Valhalla at **1e6**. Decoded at the wrong
 *     factor, Valhalla's Réunion route lands at latitude −208 — not a wrong place, an impossible
 *     one. Measured on the fixtures, not read in a document.
 *  3. **The narrative is not always there.** The public OSRM instance emits no instruction text
 *     at all: its steps carry `maneuver.type` and `maneuver.modifier`, never a sentence. Valhalla
 *     emits a localised one. `RouteStep.instruction` is therefore OPTIONAL, and a guidance
 *     runtime that assumes it exists is mute on one of the two providers.
 *
 * ## The rules that follow, and that adapters may not bend
 *
 * - **Distances are METRES, durations are SECONDS.** The conversion lives in the adapter, never
 *   here and never in a consumer. A model that carries a unit alongside a number has already
 *   lost: someone will read the number without it.
 * - **Coordinates are `[longitude, latitude]`**, GeoJSON order — the order the core's rendering
 *   seam speaks. Valhalla answers `{lat, lon}` objects; that too is the adapter's job.
 * - **Geometry is an encoded polyline at precision 5.** One decoder for every provider is the
 *   whole point; an adapter whose engine encodes at 1e6 owes a re-encode.
 */

/** A point the route must pass through. */
export interface Waypoint {
    /**
     * Position, `[longitude, latitude]` — GeoJSON order.
     *
     * ⚠️ Not `[lat, lon]`. The two are indistinguishable at a glance near the equator and wrong
     * everywhere else, and Valhalla's own API takes the opposite order.
     */
    readonly coordinates: readonly [number, number];
    /** Human label, when the caller has one — a POI name, an address. Never invented. */
    readonly name?: string;
}

/** What is asked of a provider. */
export interface RouteRequest {
    /**
     * Two or more waypoints, in travel order.
     *
     * The first is the origin, the last the destination, and every one in between is a `via`
     * that the route must visit in this order.
     */
    readonly waypoints: readonly Waypoint[];
    /**
     * Travel profile. Provider-neutral names; the adapter maps them onto its own vocabulary
     * (OSRM `driving`/`walking`/`cycling`, Valhalla `auto`/`pedestrian`/`bicycle`).
     */
    readonly profile: "car" | "foot" | "bike";
    /**
     * BCP-47 tag for the manoeuvre narrative, e.g. `"fr-FR"`.
     *
     * Asked of the SERVER rather than translated client-side: it is free, already written, and
     * it spares the plugin a corpus of turn phrases to maintain per locale. A provider that
     * cannot localise simply answers steps without `instruction`.
     */
    readonly language?: string;
}

/** One manoeuvre along a leg. */
export interface RouteStep {
    /** Length of this step, in METRES. */
    readonly distance: number;
    /** Expected time for this step, in SECONDS. */
    readonly duration: number;
    /**
     * Street name, or `""` when the way is unnamed.
     *
     * Empty rather than absent, and rather than a placeholder: an unnamed way is a fact about
     * the map, and inventing "Unnamed road" here would put a fabricated string in front of a
     * user in a language nobody chose.
     */
    readonly name: string;
    /**
     * The localised sentence, when the provider emits one.
     *
     * ⚠️ **Optional, and measured**: the public OSRM instance emits none. A consumer that
     * renders `step.instruction!` is correct against one provider and blank against the other.
     */
    readonly instruction?: string;
    /** Manoeuvre kind, OSRM vocabulary — `"turn"`, `"depart"`, `"arrive"`, `"new name"`, … */
    readonly maneuver: string;
    /**
     * Direction taken, OSRM vocabulary — `"left"`, `"slight right"`, `"straight"`, …
     *
     * Absent when the manoeuvre carries no direction, as on `depart` and `arrive`.
     */
    readonly modifier?: string;
    /** Where the manoeuvre happens, `[longitude, latitude]`. */
    readonly location: readonly [number, number];
}

/** The portion of a route between two consecutive waypoints. */
export interface RouteLeg {
    /** Length of this leg, in METRES. */
    readonly distance: number;
    /** Expected time for this leg, in SECONDS. */
    readonly duration: number;
    /** The manoeuvres of this leg, in travel order. Never empty on a routable leg. */
    readonly steps: readonly RouteStep[];
}

/** A computed route, whatever the provider that computed it. */
export interface RouteResult {
    /**
     * Total length, in METRES.
     *
     * 🛑 **Invariant: this equals the sum of `legs[].distance`.** It is stated here rather than
     * merely tested because it is what makes the model checkable at all — a normaliser that
     * loses a leg, or double-counts one, is otherwise indistinguishable from a correct one.
     */
    readonly distance: number;
    /** Total expected time, in SECONDS. Same invariant against `legs[].duration`. */
    readonly duration: number;
    /** One leg per consecutive waypoint pair — `waypoints.length - 1` of them. */
    readonly legs: readonly RouteLeg[];
    /**
     * Full geometry, as an encoded polyline at **precision 5**.
     *
     * ⚠️ The precision is part of the contract, not an implementation detail. OSRM encodes at
     * 1e5 and Valhalla at 1e6; decoded at the wrong factor, a Réunion route lands at latitude
     * −208. An adapter whose engine uses 1e6 re-encodes before returning.
     */
    readonly geometry: string;
    /**
     * The waypoints as the provider SNAPPED them to the network — not as they were asked.
     *
     * The difference is the whole reason this field exists: a destination clicked in the middle
     * of a block routes from the nearest road, and showing the asked-for point as if it were the
     * route's start makes the first manoeuvre look wrong.
     */
    readonly waypoints: readonly Waypoint[];
    /** Which adapter produced this, e.g. `"osrm"`. Carried for diagnostics, never branched on. */
    readonly provider: string;
    /**
     * The credit the data behind this route requires, ready to display.
     *
     * 🛑 **Carried on the RESULT and not read from the configuration, and the difference is not
     * academic.** A route computed by one engine can still be drawn on the map after the profile
     * has been pointed at another; reading the active provider would then credit a source that did
     * not produce what the user is looking at. The credit belongs to the data, so it travels with
     * the data.
     *
     * ⚠️ **This is a licence obligation, not a nicety.** Both built-in engines route on
     * OpenStreetMap, whose ODbL requires attribution wherever the derived work is shown. The
     * licence permits commercial use; it does not permit dropping the credit.
     */
    readonly attribution: string;
}

/**
 * Why a route did not come back.
 *
 * 🛑 **Named, not collapsed into a single failure**, and the reason is not abstract: every one of
 * these ends up as a sentence in front of someone, and four of the five would be false if they
 * shared one. `no-route` in particular is an ORDINARY answer — two points on different islands
 * have none — and rendering it as "an error occurred" is a lie about the map.
 */
export type RouteFailure =
    /** The engine was given its time and did not answer. Retrying unchanged may work. */
    | "timeout"
    /** The request never reached the engine. */
    | "network"
    /** The engine answered and refused — a quota (429), a bad request (400). */
    | "http"
    /** The engine answered something the adapter cannot read. A bug on one of the two sides. */
    | "malformed"
    /** The engine answered correctly: there is no route between these points. */
    | "no-route"
    /** The configuration was refused before anything was sent — see `resolveEndpoint`. */
    | "refused";

/**
 * What a provider answers.
 *
 * ⚠️ This replaced `RouteResult | null` on 21/08/2026, and the change is deliberate rather than
 * cosmetic. The sprint that wrote the contract had not yet faced the requirement that a failure
 * be *actionable*; `null` made the five reasons above indistinguishable at the only place that
 * could tell them apart.
 */
export type RouteOutcome =
    | { readonly ok: true; readonly route: RouteResult }
    | { readonly ok: false; readonly reason: RouteFailure; readonly status?: number };

/**
 * What a routing engine must offer to be usable here.
 *
 * The whole surface is one method, and that is the point: everything that differs between
 * engines — units, coordinate order, polyline precision, whether a narrative exists — is the
 * adapter's problem, and none of it reaches the caller.
 *
 * ⚠️ It lives in the MODEL and not beside the factory, although the factory is what builds one.
 * The factory imports the plugin configuration, hence the host runtime; an adapter that only
 * needs to declare its shape would drag both in for a type. Types have no reason to travel with
 * the things that construct them.
 */
export interface IRouteProvider {
    /** Stable identifier, e.g. `"osrm"`. Appears in `RouteResult.provider`. */
    readonly id: string;
    /**
     * The credit this engine's data requires, ready to display.
     *
     * 🛑 **Required, and an empty string is REFUSED at construction** — see `createProvider`. A
     * provider is free to serve data under any licence; it is not free to leave the question
     * unanswered, because the caller has no way to guess and the consequence lands on whoever
     * ships the map. An engine genuinely needing no credit says so explicitly, which is a
     * decision someone made rather than a field someone forgot.
     */
    readonly attribution: string;
    /** Computes a route, or says why it could not. */
    route(request: RouteRequest): Promise<RouteOutcome>;
}

/** Builds a provider bound to one endpoint. */
export type RouteProviderFactory = (endpoint: string) => IRouteProvider;

/** Where the guidance runtime is in its lifecycle. */
/**
 * ## Pourquoi `paused` a disparu, et `waypoint-reached` est arrivé
 *
 * The five states written in S1 were invented against the contract, not read off the validated
 * technical CDC — and the two lists differed on two members. `paused` appeared in neither the
 * CDC's transition table nor any line of code: it was an unreachable state, and an unreachable
 * state in a machine is the kind of thing that rots quietly. `waypoint-reached` is the member
 * the multi-stop scope actually needs, and the CDC names it as the addition proper to that
 * scope.
 *
 * A user stopping guidance goes to `idle` — which is what the CDC's "tout état → arrêt
 * utilisateur → idle" row already said, and what makes `paused` unnecessary rather than
 * missing.
 *
 * ⚠️ Removing a union member is a breaking change for an exhaustive `switch`. It is done here
 * because this package has never been published — measured, not assumed: `npm view` answers
 * 404. Once it is, this edit would need a major.
 */
export type NavState =
    /** No route loaded. */
    | "idle"
    /** A route is loaded and guidance is following it. */
    | "navigating"
    /**
     * An intermediate stop has been reached, and guidance is holding there.
     *
     * ⚠️ Distinct from `arrived`, which is terminal. Collapsing the two would tell a driver on
     * a three-stop round that the journey is over at the first stop.
     */
    | "waypoint-reached"
    /** The user has left the route and a recomputation has been requested. */
    | "rerouting"
    /** The destination has been reached. */
    | "arrived";

/**
 * A guidance progress sample.
 *
 * ⚠️ Lives here, in the routing package, although only `navigation` produces it. That is
 * deliberate: `navigation` depends on `routing` and never the reverse, so a type both sides
 * name has to live on the side that does not depend on the other. Sharing it the other way
 * would make the light package require the heavy one.
 */
export interface NavProgress {
    /** Lifecycle state at the time of the sample. */
    readonly state: NavState;
    /** Index of the leg being travelled, into `RouteResult.legs`. */
    readonly legIndex: number;
    /** Index of the current step, into `RouteLeg.steps`. */
    readonly stepIndex: number;
    /** Remaining distance to the destination, in METRES. */
    readonly distanceRemaining: number;
    /** Remaining time to the destination, in SECONDS. */
    readonly durationRemaining: number;
    /**
     * Distance from the user to the route line, in METRES.
     *
     * The value a re-route threshold reads. It is reported rather than pre-judged: the
     * threshold, and the hysteresis that keeps a noisy GPS from emptying a provider quota in
     * bursts, belong to the guidance runtime and to its configuration — not to this type.
     */
    readonly offRouteDistance: number;
    /**
     * Why the last recomputation was refused, when one was and it failed.
     *
     * ⚠️ Reported so the interface can say WHICH refusal it was. Without it, "off route" and
     * "off route, and I cannot recompute because there is no network" are the same state on
     * screen — and they call for opposite things from the driver: wait, or turn around.
     *
     * Absent while guidance is following the route, and cleared as soon as a recomputation
     * succeeds. A stale reason outliving its cause would leave a permanent warning under a
     * guidance that has been working again for twenty minutes.
     */
    readonly rerouteFailure?: RouteFailure;
}
