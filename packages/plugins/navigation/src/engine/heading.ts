/*!
 * @geoleaf-plugins/navigation — Heading
 *
 * Which way the user is facing, from the platform when it says, and from movement when it
 * does not.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import bearing from "@turf/bearing";
import { point } from "@turf/helpers";
import type { Position } from "./snap.js";

/**
 * ## Why there is a fallback at all
 *
 * `GeolocationCoordinates.heading` is `null` whenever the device is not moving, and on many
 * desktop and some mobile browsers it is `null` always. A camera that only rotates when the
 * platform volunteers a heading would sit north-up for whole journeys on those devices, which
 * reads as a broken map rather than as a missing sensor.
 *
 * ## Why the fallback needs a minimum distance, and the projection does not
 *
 * A bearing between two fixes metres apart is dominated by GPS noise: standing still produces
 * a heading that spins. So the fallback refuses to answer below a floor, and the caller keeps
 * the last heading it had. ⚠️ This is NOT the same as dropping the fix — the fix is still
 * projected, still advances progress, still counts for arrival. Only the HEADING abstains.
 */

/** Below this, the bearing between two fixes is noise rather than direction. METRES. */
const MIN_FALLBACK_DISTANCE_M = 5;

/**
 * The heading to face, in degrees clockwise from true north.
 *
 * @param platformHeading What the platform reported, if anything. `null` and `NaN` both count
 *                        as "did not report" — `NaN` because some hosts produce it rather than
 *                        `null`, and one `NaN` reaching a camera rotation makes it disappear.
 * @param previous        Where the user was on the previous accepted fix, if there was one.
 * @param current         Where the user is now.
 * @param travelled       Distance between `previous` and `current`, in METRES. Passed in
 *                        rather than recomputed: the caller already has it from the
 *                        projection, and measuring it twice invites the two to disagree.
 * @returns The heading in `[0, 360)`, or `null` when neither source can answer.
 */
export function resolveHeading(
    platformHeading: number | null | undefined,
    previous: Position | null,
    current: Position,
    travelled: number
): number | null {
    if (typeof platformHeading === "number" && Number.isFinite(platformHeading)) {
        return normaliseDegrees(platformHeading);
    }
    if (!previous || travelled < MIN_FALLBACK_DISTANCE_M) return null;
    return normaliseDegrees(
        bearing(point([previous[0], previous[1]]), point([current[0], current[1]]))
    );
}

/**
 * A bearing folded into `[0, 360)`.
 *
 * ⚠️ `@turf/bearing` answers in `(-180, 180]`, and a map camera wants `[0, 360)`. Handing the
 * negative form straight through puts the camera a half-turn out for every westward heading —
 * a defect that looks like a broken compass and is an unconverted convention.
 *
 * @param deg Any angle in degrees.
 * @returns The same direction in `[0, 360)`.
 */
export function normaliseDegrees(deg: number): number {
    return ((deg % 360) + 360) % 360;
}
