/*!
 * @geoleaf-plugins/navigation — Guidance runtime
 *
 * Ties the position watch, the projection, the progress, the off-route detector and the state
 * machine into one object that follows a route.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type {
    RouteResult,
    RouteOutcome,
    RouteFailure,
    Waypoint,
    NavProgress,
} from "@geoleaf-plugins/routing";
import type {
    GuidanceRuntime,
    GuidanceListener,
    GuidanceView,
    GuidanceViewListener,
} from "../guidance-contract.js";
import { buildTrack, snapToTrack, type Position, type RouteTrack } from "./snap.js";
import { computeProgress } from "./progress.js";
import { nextManeuver } from "./maneuver.js";
import { resolveHeading } from "./heading.js";
import { OffRouteDetector } from "./off-route.js";
import { GuidanceMachine } from "./state-machine.js";
import { startGeoWatch, type GeoFix } from "../platform/geo.js";
import { onNetworkReturn } from "../platform/network.js";

/**
 * ## 🛑 Why "out of coverage" is discovered by TRYING, not by asking
 *
 * The requirement says a recomputation happens "in network coverage". The obvious reading is
 * to consult `navigator.onLine` and skip the attempt when it says no. That reading is wrong
 * twice over.
 *
 * First, `onLine` reports whether a link exists, not whether anything answers: a captive
 * portal, a dead provider and a phone showing one bar all read as online. Second, the routing
 * model already names `network` and `timeout` among its six failure reasons — the answer is
 * a normal, expected outcome, not an exception to be predicted.
 *
 * So the runtime attempts the recomputation and **backs off when it fails**, doubling the wait
 * so a long tunnel costs a handful of attempts rather than one per fix. That also covers the
 * case coverage detection cannot: a provider that is reachable and broken.
 *
 * ⚠️ And when the recomputation fails, **guidance continues on the route it already has.**
 * That is not a fallback invented here: the offline-computation module was withdrawn at v1.0.0
 * of the specification, and what replaced it is exactly "guide out of coverage along a route
 * prepared in coverage". A runtime that stopped guiding when it could not re-route would
 * discard the one thing the design says to keep.
 *
 * ## Why the caller supplies both `recompute` and `decodeGeometry`
 *
 * Both need `@geoleaf-plugins/routing` as a VALUE — a provider to call, a polyline decoder to
 * run. This package imports only types from it, which is what keeps the first plugin-to-plugin
 * edge in the repository inert. Injecting them moves the dependency to the caller, which
 * already holds both.
 */

/** Every threshold the runtime reads. No value is defaulted here — see the note below. */
export interface GuidanceConfig {
    /** Within this distance of a stop, the stop counts as reached. METRES. */
    readonly arrivalRadiusMetres: number;
    /** Beyond this distance from the line, a reading counts as off-route. METRES. */
    readonly offRouteThresholdMetres: number;
    /** Consecutive off readings needed to confirm a departure. */
    readonly confirmExit: number;
    /** Consecutive on readings needed to confirm a return. */
    readonly confirmReturn: number;
    /** Fixes to wait before the first retry after a failed recomputation. */
    readonly retryAfterFixes: number;
    /** Ceiling on the backoff, in fixes. */
    readonly maxRetryFixes: number;
}

/**
 * ⚠️ The defaults live in the profile schema, not here.
 *
 * A value written both in a schema and in code diverges from the schema without anything
 * turning red — the exact family of defect this project keeps finding. These are the values
 * the schema declares, repeated nowhere: the runtime refuses to run without being told.
 */
export interface GuidanceOptions {
    /** The thresholds. */
    readonly config: GuidanceConfig;
    /**
     * Recomputes a route from `from` through the remaining stops.
     *
     * @param from      Where the user is now.
     * @param remaining The stops not yet reached, in travel order.
     * @returns What the provider answered — including the named refusals.
     */
    recompute(from: Position, remaining: readonly Waypoint[]): Promise<RouteOutcome>;
    /**
     * Decodes a route geometry.
     *
     * @param geometry The encoded polyline a provider returned.
     * @returns The positions, in `[longitude, latitude]`.
     */
    decodeGeometry(geometry: string): readonly Position[];
    /** The document whose visibility drives the resume rule. Injected so a test can drive it. */
    readonly doc?: Document;
}

/**
 * Creates a guidance runtime.
 *
 * @param options Thresholds and the two functions this package cannot supply itself.
 * @returns The runtime.
 */
/**
 * Everything one guidance session holds.
 *
 * ⚠️ An explicit object rather than closure variables, and not only to keep the factory under
 * the line limit: it makes the per-fix pipeline a plain function of `(state, deps, fix)`, so
 * each step can be exercised without standing up a runtime — and so nothing can quietly read a
 * variable it was never handed.
 */
interface Session {
    route: RouteResult | null;
    track: RouteTrack | null;
    /** Distance along the line at the last accepted fix, or `null` when re-acquiring. */
    anchor: number | null;
    lastTimestamp: number | null;
    /**
     * The previously PROJECTED position, kept for the fallback bearing.
     *
     * ⚠️ The projected one and not the raw fix: two consecutive raw fixes on a straight road
     * can sit either side of the line, and the bearing between them points across the road
     * rather than along it. Projections lie on the line by construction, so the bearing
     * between two of them is the direction of travel.
     */
    lastProjected: Position | null;
    /** Distance along the line at the previous accepted fix, in METRES. */
    lastAlong: number | null;
    /** Fixes still to wait before another recomputation is attempted. */
    cooldown: number;
    /** How long the next wait will be, doubling on each failure. */
    backoff: number;
    recomputing: boolean;
    /**
     * Why the last recomputation was refused, or `null`.
     *
     * ⚠️ Cleared as soon as a recompute succeeds. A reason outliving its cause
     * would leave a permanent warning under a guidance working again for twenty minutes.
     */
    lastFailure: RouteFailure | null;
}

/** What the pipeline needs besides the session. */
interface Deps {
    readonly options: GuidanceOptions;
    readonly detector: OffRouteDetector;
    readonly machine: GuidanceMachine;
    emit(progress: NavProgress): void;
    emitView(view: GuidanceView): void;
}

/**
 * A one-way emitter over a set of listeners.
 *
 * 🛑 **A listener that throws must not take the others down, nor the next fix with them.** These
 * listeners are an integrator's progress handler, a banner and a camera — the last two being
 * exactly what throws on a map torn down underneath a running session. Letting one of them turn
 * a rendering bug into a guidance outage is the wrong trade in a moving car.
 *
 * ⚠️ The failure is swallowed rather than reported, and that is a real cost: a handler that
 * throws on every sample does so silently. It is accepted because the alternative — logging on
 * each fix — writes a line per second for the length of a journey, which is how a log stops
 * being read at all.
 *
 * @param listeners The set to fan out to. Held by reference, so subscriptions taken after this
 *                  call are seen.
 * @returns The emit function.
 */
function fanOut<T>(listeners: ReadonlySet<(value: T) => void>): (value: T) => void {
    return (value: T): void => {
        for (const listener of listeners) {
            try {
                listener(value);
            } catch {
                // See the note above: containment is the point.
            }
        }
    };
}

/**
 * Forgets where the user was on the line.
 *
 * @param session The session.
 */
function releaseAnchor(session: Session): void {
    session.anchor = null;
    session.lastTimestamp = null;
    // ⚠️ The previous projection goes with the anchor. Keeping it would let the first fix
    // after a re-route derive a bearing between two points on DIFFERENT lines — a heading
    // pointing at where the user used to be going.
    session.lastProjected = null;
    session.lastAlong = null;
}

/**
 * Adopts a route and its decoded line.
 *
 * 🛑 Releases the anchor AND resets the detector, together, never one without the other. The
 * counters were accumulated against the OLD line and the anchor points into it; carrying
 * either into a route computed from the user's current position lets a departure confirmed on
 * the old geometry fire immediately on the new one — a route that re-routes forever.
 *
 * @param session The session.
 * @param deps    The pipeline's collaborators.
 * @param route   The route to follow.
 * @param line    Its geometry, decoded.
 */
function adopt(session: Session, deps: Deps, route: RouteResult, line: readonly Position[]): void {
    session.route = route;
    session.track = buildTrack(line);
    releaseAnchor(session);
    deps.detector.reset();
}

/**
 * Asks for a new route, once, and adopts it if one comes back.
 *
 * @param session  The session.
 * @param deps     The pipeline's collaborators.
 * @param from     Where the user is now — the recomputation starts here, not at the origin,
 *                 which is the whole point of an automatic re-route.
 * @param legIndex The leg being travelled, which decides what still remains.
 */
async function attemptRecompute(
    session: Session,
    deps: Deps,
    from: Position,
    legIndex: number
): Promise<void> {
    const route = session.route;
    if (session.recomputing || !route) return;
    session.recomputing = true;
    try {
        const outcome = await deps.options.recompute(from, remainingWaypoints(route, legIndex));
        if (outcome.ok) {
            adopt(
                session,
                deps,
                outcome.route,
                deps.options.decodeGeometry(outcome.route.geometry)
            );
            deps.machine.start();
            session.backoff = deps.options.config.retryAfterFixes;
            session.lastFailure = null;
        } else {
            // Out of coverage, provider down, or nothing routable from here. Guidance keeps
            // following the route it has — see the note at the top of this file.
            //
            // ⚠️ The reason is KEPT and emitted: "off route" and "off route,
            // and I cannot recompute for lack of network" are the same state
            // on screen without it — and they call for opposite moves from the
            // driver: wait, or turn around.
            session.lastFailure = outcome.reason;
            session.cooldown = session.backoff;
            session.backoff = Math.min(session.backoff * 2, deps.options.config.maxRetryFixes);
        }
    } finally {
        session.recomputing = false;
    }
}

/**
 * One measured fix, all the way through.
 *
 * @param session The session.
 * @param deps    The pipeline's collaborators.
 * @param fix     What the platform reported.
 */
function processFix(session: Session, deps: Deps, fix: GeoFix): void {
    const { route, track } = session;
    if (!route || !track) return;

    const elapsed =
        session.lastTimestamp === null ? null : (fix.timestamp - session.lastTimestamp) / 1000;
    const snapped = snapToTrack(track, fix.position, session.anchor, elapsed);
    if (!snapped) return;
    session.lastTimestamp = fix.timestamp;

    const verdict = deps.detector.accept(snapped.distanceToLine);
    // The anchor is kept only while the user is on the line: off it the projection is
    // meaningless, and freezing the anchor would leave it behind for the whole excursion.
    session.anchor = verdict.off ? null : snapped.distanceAlong;

    const progress = computeProgress(route, snapped.distanceAlong, track.length);
    const state = deps.machine.accept({
        off: verdict.off,
        legIndex: progress.legIndex,
        legDistanceRemaining: progress.legDistanceRemaining,
        isFinalLeg: progress.legIndex === route.legs.length - 1,
    });

    // ⚠️ `stepIndex` was a literal `0` here until the interface was wired, at both emit sites.
    // A field that is always zero is indistinguishable from a field nobody reads — right up to
    // the moment something does.
    const leg = route.legs[progress.legIndex];
    const ahead = leg
        ? nextManeuver(
              leg,
              progress.legDistanceTravelled,
              progress.legDistanceTravelled + progress.legDistanceRemaining
          )
        : null;

    // The heading is resolved from the PROJECTED positions, and `travelled` is measured ALONG
    // the line rather than as the straight-line gap: on a bend the two differ, and the one that
    // says whether a fallback bearing is meaningful is the distance actually covered.
    // ⚠️ `session.anchor` cannot serve here — it was overwritten with THIS fix eight lines
    // above, so the difference would be zero on every sample and the fallback would never fire.
    const travelled =
        session.lastAlong === null ? 0 : Math.abs(snapped.distanceAlong - session.lastAlong);
    const heading = resolveHeading(fix.heading, session.lastProjected, snapped.position, travelled);

    deps.emit({
        state,
        legIndex: progress.legIndex,
        stepIndex: ahead?.stepIndex ?? 0,
        distanceRemaining: progress.distanceRemaining,
        durationRemaining: progress.durationRemaining,
        offRouteDistance: snapped.distanceToLine,
        // ⚠️ Omitted rather than `null` when there is nothing to report: the
        // field is optional, and `rerouteFailure: null` in a sample reads
        // "there was a failure, with no cause" — which is not the state of a
        // guidance following its route.
        ...(session.lastFailure ? { rerouteFailure: session.lastFailure } : {}),
    });

    deps.emitView({
        step: ahead?.step ?? null,
        distanceToManeuver: ahead?.distanceToManeuver ?? 0,
        position: snapped.position,
        heading,
        elapsedSeconds: elapsed,
    });

    // Recorded AFTER both emissions, so a listener that throws cannot leave the session with a
    // previous position from a fix it never saw.
    session.lastProjected = snapped.position;
    session.lastAlong = snapped.distanceAlong;

    if (session.cooldown > 0) session.cooldown -= 1;
    if (state === "rerouting" && session.cooldown === 0) {
        void attemptRecompute(session, deps, fix.position, progress.legIndex);
    }
}

/**
 * Creates a guidance runtime.
 *
 * @param options Thresholds and the two functions this package cannot supply itself.
 * @returns The runtime.
 */
export function createGuidanceRuntime(options: GuidanceOptions): GuidanceRuntime {
    const cfg = options.config;
    const doc = options.doc ?? globalThis.document;
    const listeners = new Set<GuidanceListener>();
    const viewListeners = new Set<GuidanceViewListener>();

    const session: Session = {
        route: null,
        track: null,
        anchor: null,
        lastTimestamp: null,
        cooldown: 0,
        backoff: cfg.retryAfterFixes,
        recomputing: false,
        lastFailure: null,
        lastProjected: null,
        lastAlong: null,
    };
    const deps: Deps = {
        options,
        detector: new OffRouteDetector({
            thresholdMetres: cfg.offRouteThresholdMetres,
            confirmExit: cfg.confirmExit,
            confirmReturn: cfg.confirmReturn,
        }),
        machine: new GuidanceMachine({ arrivalRadiusMetres: cfg.arrivalRadiusMetres }),
        emit: fanOut(listeners),
        emitView: fanOut(viewListeners),
    };

    let stopWatch: (() => void) | null = null;
    let stopNetwork: (() => void) | null = null;

    /**
     * The network is back: retry at the NEXT fix, not later.
     *
     * 🛑 It is a HINT, not a predicate. The runtime never asks
     * `navigator.onLine` whether to try — it tries and reads the answer. What
     * the event brings is "something just changed", hence shorten the wait. A
     * false positive costs one request that will fail; a false negative would
     * have cost a whole wait while the network was back — and it is the only
     * one of the two the user feels, sitting at a junction waiting for a route.
     *
     * ⚠️ The backoff is NOT reset to its floor: if the network flaps,
     * resetting at each toggle would give back exactly the bursts the backoff
     * exists to avoid. Only the CURRENT wait is cancelled.
     */
    const onBackOnline = (): void => {
        session.cooldown = 0;
    };

    /** Drops to `idle` and forgets, so the next fix re-projects. The resume rule. */
    const onVisibility = (): void => {
        if (doc?.visibilityState === "hidden") {
            deps.machine.suspend();
            releaseAnchor(session);
        }
    };

    return {
        get state() {
            return deps.machine.state;
        },

        start(route: RouteResult, line: readonly (readonly [number, number])[]): void {
            this.stop();
            adopt(session, deps, route, line);
            deps.machine.start();
            session.backoff = cfg.retryAfterFixes;
            session.cooldown = 0;
            doc?.addEventListener("visibilitychange", onVisibility);
            stopNetwork = onNetworkReturn(onBackOnline);
            stopWatch = startGeoWatch({
                onFix: (fix) => processFix(session, deps, fix),
                onFailure: () => {
                    // A refused or unavailable sensor is reported through the samples, not
                    // thrown: the interface must be able to say "waiting for a position"
                    // rather than lose the panel it was drawing.
                    deps.emit({
                        state: deps.machine.state,
                        legIndex: 0,
                        // Zero here is a FACT, not the placeholder the fix path used to carry:
                        // no position was measured, so no step is known. The interface reads
                        // the state, not the indices, on this sample.
                        stepIndex: 0,
                        distanceRemaining: 0,
                        durationRemaining: 0,
                        offRouteDistance: 0,
                    });
                },
            });
        },

        stop(): void {
            stopWatch?.();
            stopWatch = null;
            stopNetwork?.();
            stopNetwork = null;
            doc?.removeEventListener("visibilitychange", onVisibility);
            deps.machine.stop();
            deps.detector.reset();
            releaseAnchor(session);
            session.route = null;
            session.track = null;
            session.lastFailure = null;
        },

        onProgress(listener: GuidanceListener): () => void {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        onView(listener: GuidanceViewListener): () => void {
            viewListeners.add(listener);
            return () => viewListeners.delete(listener);
        },
    };
}

/**
 * The stops not yet reached.
 *
 * ⚠️ Derived from the LEG INDEX, never stored — same reason as the step number in
 * `composition.ts`: a stored "next stop" survives a recomputation that changed how many stops
 * there are, and then points at the wrong one with nothing to explain it.
 *
 * 🛑 And it must be the leg index, not a constant offset. Leg *i* runs from waypoint *i* to
 * waypoint *i + 1*, so what remains from leg *i* is `waypoints[i + 1…]`. Slicing from 1 —
 * "everything but the origin" — is right only on the first leg, and silently re-routes a
 * driver on their third stop back through the second.
 *
 * @param route    The route being followed.
 * @param legIndex The leg currently being travelled.
 * @returns The remaining stops, in travel order. Never empty: a recomputation with no
 *          destination is not a request a provider can answer, so the last stop is kept even
 *          if the index has run past it.
 */
function remainingWaypoints(route: RouteResult, legIndex: number): readonly Waypoint[] {
    const rest = route.waypoints.slice(legIndex + 1);
    return rest.length > 0 ? rest : route.waypoints.slice(-1);
}
