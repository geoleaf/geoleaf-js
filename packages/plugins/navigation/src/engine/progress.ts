/*!
 * @geoleaf-plugins/navigation — Remaining distance and time
 *
 * What is left, at the two levels a driver actually asks about: to the next stop, and to the
 * end.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { RouteResult } from "@geoleaf-plugins/routing";

/**
 * ## Why BOTH levels, always, and not one derived from the other
 *
 * "12 min to the next stop" and "1 h 40 to the end" answer different questions, and a driver
 * on a multi-stop route asks the first far more often. Reporting only the total makes a
 * three-stop delivery round unreadable; reporting only the leg hides whether the day fits.
 *
 * ## Why time is scaled from distance rather than counted down
 *
 * The provider gives a duration per leg, computed for the whole leg. Once the user is
 * mid-leg, the only honest estimate from that number is the fraction of the leg still to
 * travel. ⚠️ **This is an estimate and it is named as one.** Live traffic would change it, and
 * this runtime has none — pretending otherwise by decrementing a clock would produce a figure
 * that looks measured and is not.
 */

/** What is left, at both levels. */
export interface ProgressSample {
    /** Index of the leg being travelled, into `RouteResult.legs`. */
    readonly legIndex: number;
    /** Distance still to travel on THIS leg, in METRES. */
    readonly legDistanceRemaining: number;
    /**
     * Distance already travelled on THIS leg, in METRES.
     *
     * Reported rather than left to the caller to subtract, because the leg's length is scaled to
     * the measured line and is not returned: `legDistance - legDistanceRemaining` computed from
     * the provider's own total would be off by the very drift the scaling exists to remove.
     * `nextManeuver` needs both ends of the leg to place a step boundary, and they must be the
     * SAME two numbers the remaining distance came from.
     */
    readonly legDistanceTravelled: number;
    /** Estimated time still to travel on THIS leg, in SECONDS. */
    readonly legDurationRemaining: number;
    /** Distance still to travel to the destination, in METRES. */
    readonly distanceRemaining: number;
    /** Estimated time still to travel to the destination, in SECONDS. */
    readonly durationRemaining: number;
}

/**
 * Where the user is, expressed as what is left.
 *
 * @param route         The route being followed.
 * @param distanceAlong Distance travelled along the line, in METRES — from the projection.
 * @param lineLengthM   Total length of the line, in METRES, measured the SAME way.
 * @returns The two levels. A route with no legs yields zeros rather than throwing: a guidance
 *          runtime that crashes on a degenerate route is worse than one that reports nothing.
 */
export function computeProgress(
    route: RouteResult,
    distanceAlong: number,
    lineLengthM: number
): ProgressSample {
    const empty = {
        legIndex: 0,
        legDistanceRemaining: 0,
        legDistanceTravelled: 0,
        legDurationRemaining: 0,
        distanceRemaining: 0,
        durationRemaining: 0,
    };
    if (route.legs.length === 0 || lineLengthM <= 0) return empty;

    // The legs are measured against the LINE, not against the provider's own totals — see
    // `lineLength`. Their lengths are scaled to the line so the two agree by construction.
    const scale = lineLengthM / Math.max(sumLegDistances(route), 1);
    let boundary = 0;
    let legIndex = route.legs.length - 1;
    let legStart = 0;

    for (let i = 0; i < route.legs.length; i++) {
        const legLength = (route.legs[i] as { distance: number }).distance * scale;
        if (distanceAlong < boundary + legLength || i === route.legs.length - 1) {
            legIndex = i;
            legStart = boundary;
            break;
        }
        boundary += legLength;
    }

    const leg = route.legs[legIndex] as { distance: number; duration: number };
    const legLength = leg.distance * scale;
    const travelledInLeg = clamp(distanceAlong - legStart, 0, legLength);
    const legFraction = legLength > 0 ? 1 - travelledInLeg / legLength : 0;

    const distanceRemaining = clamp(lineLengthM - distanceAlong, 0, lineLengthM);

    return {
        legIndex,
        legDistanceRemaining: clamp(legLength - travelledInLeg, 0, legLength),
        legDistanceTravelled: travelledInLeg,
        legDurationRemaining: leg.duration * legFraction,
        distanceRemaining,
        durationRemaining: estimateTotalDuration(route, legIndex, legFraction),
    };
}

/**
 * Time left over the current leg plus every leg after it.
 *
 * @param route       The route.
 * @param legIndex    The leg being travelled.
 * @param legFraction Fraction of the current leg still ahead, in `[0, 1]`.
 * @returns Seconds.
 */
function estimateTotalDuration(route: RouteResult, legIndex: number, legFraction: number): number {
    let total = (route.legs[legIndex] as { duration: number }).duration * legFraction;
    for (let i = legIndex + 1; i < route.legs.length; i++) {
        total += (route.legs[i] as { duration: number }).duration;
    }
    return total;
}

/**
 * Sum of the provider's own leg distances.
 *
 * @param route The route.
 * @returns Metres.
 */
function sumLegDistances(route: RouteResult): number {
    return route.legs.reduce((acc, leg) => acc + leg.distance, 0);
}

/**
 * Confines a value to a range.
 *
 * @param v   The value.
 * @param lo  Lower bound.
 * @param hi  Upper bound.
 * @returns The confined value.
 */
function clamp(v: number, lo: number, hi: number): number {
    return Math.min(Math.max(v, lo), hi);
}
