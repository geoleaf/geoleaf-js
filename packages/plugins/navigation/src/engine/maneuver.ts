/*!
 * @geoleaf-plugins/navigation — The manoeuvre ahead
 *
 * Which instruction comes next, and in how far — the two things a banner shows.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { RouteLeg, RouteStep } from "@geoleaf-plugins/routing";

/**
 * ## 🛑 Why this exists at all: `stepIndex` was a literal `0`
 *
 * `NavProgress` has carried a `stepIndex` field since the model was frozen, and the runtime
 * emitted `stepIndex: 0` at both of its emit sites. Nothing consumed it, so nothing contradicted
 * it — a field that is always zero is indistinguishable from a field nobody reads, right up to
 * the moment something does. Wiring the banner is what made it read.
 *
 * ## Why a manoeuvre is located by the step BOUNDARY, not by the step you are in
 *
 * In the OSRM vocabulary this model follows, a step's `maneuver` happens at its **start**, and
 * its `distance` is how far you then travel. So "the next instruction" is not a property of the
 * step you are currently traversing — it is the **start of the following one**. Reading the
 * current step's own manoeuvre would announce the turn you have already taken, for the whole
 * length of the street after it.
 *
 * The final step is `arrive` with a distance of zero, so its boundary falls at the end of the
 * leg: the arrival announces itself with the correct remaining distance, by the same rule, with
 * no special case.
 *
 * ## Why step lengths are rescaled to the leg
 *
 * `computeProgress` measures legs against the DECODED LINE rather than against the provider's
 * own totals, because the two differ by a percent or two and a remaining distance that does not
 * equal the sum of its parts is a bug someone will chase. Step boundaries must be measured the
 * same way or the banner's countdown would drift against the leg's — the same figure, disagreeing
 * with itself on the same screen.
 */

/** The instruction ahead, and how far it is. */
export interface ManeuverAhead {
    /** Index of the step being travelled, into `RouteLeg.steps`. */
    readonly stepIndex: number;
    /** The step whose manoeuvre comes next, or `null` when none does. */
    readonly step: RouteStep | null;
    /** Distance to that manoeuvre, in METRES. Zero when there is no manoeuvre ahead. */
    readonly distanceToManeuver: number;
}

/** What a leg with no steps yields — reported, never thrown. */
const NOTHING_AHEAD: ManeuverAhead = { stepIndex: 0, step: null, distanceToManeuver: 0 };

/**
 * The manoeuvre ahead on this leg.
 *
 * @param leg         The leg being travelled.
 * @param travelledM  Distance already travelled along the leg, in METRES, measured against the
 *                    line — `ProgressSample.legDistanceTravelled`.
 * @param legLengthM  Length of the leg by the SAME measure, in METRES. Pass
 *                    `legDistanceTravelled + legDistanceRemaining`; deriving it here from the
 *                    provider's own total would reintroduce the drift this module rescales away.
 * @returns Where you are among the steps, and what comes next. A leg with no steps yields a null
 *          manoeuvre rather than throwing: a banner with nothing to say is a banner that hides,
 *          and a guidance session must not end because a provider returned a stepless leg.
 */
export function nextManeuver(leg: RouteLeg, travelledM: number, legLengthM: number): ManeuverAhead {
    const steps = leg.steps;
    if (steps.length === 0) return NOTHING_AHEAD;

    const declared = steps.reduce((acc, s) => acc + s.distance, 0);
    // A leg whose steps declare no length at all — degenerate, but a provider may emit it —
    // would divide by zero. Falling back to 1 leaves every boundary at its declared position,
    // which is the honest reading of "no scale information".
    const scale = declared > 0 && legLengthM > 0 ? legLengthM / declared : 1;

    let boundary = 0;
    let stepIndex = 0;

    for (let i = 0; i < steps.length; i++) {
        const start = boundary;
        // ⚠️ `>` and not `>=`: standing exactly on a boundary means the manoeuvre is HERE, not
        // behind. With `>=` the banner would blank for one sample at every single turn.
        if (start > travelledM) {
            return {
                stepIndex,
                step: steps[i] as RouteStep,
                distanceToManeuver: start - travelledM,
            };
        }
        stepIndex = i;
        boundary += (steps[i] as RouteStep).distance * scale;
    }

    // Past the last boundary: the leg's own end is the only thing left ahead. The final step is
    // `arrive`, so announcing it here is the arrival, at the distance that remains.
    return {
        stepIndex,
        step: steps[steps.length - 1] as RouteStep,
        distanceToManeuver: Math.max(legLengthM - travelledM, 0),
    };
}
