/**
 * Replays a versioned GPS trace as synthetic `GeolocationPosition` objects.
 *
 * 🛑 **No network, ever — here or in anything that uses this** (D4). A guidance test that
 * called a routing provider would be slow, would consume a public quota, and would fail on a
 * day the instance is down for reasons that have nothing to do with the code under test.
 *
 * ⚠️ The trace is SYNTHETIC and its fixture says so in its own first field. What it reproduces
 * faithfully is the STRUCTURE of a real one — irregular sampling, noise that varies, a
 * `heading` the platform sometimes withholds, and one frank departure from the line. A trace
 * at a constant step with constant noise would never meet the case hysteresis exists for, and
 * a suite built on it would pass while proving nothing.
 */
import trace from "../fixtures/trace-reunion-3-legs.json" with { type: "json" };

/** One recorded fix, as the fixture stores it. */
interface RecordedFix {
    readonly longitude: number;
    readonly latitude: number;
    readonly accuracy: number;
    readonly heading: number | null;
    readonly speed: number;
    readonly timestamp: number;
}

/** The route line the trace was recorded along, in `[longitude, latitude]`. */
export const traceLine: readonly (readonly [number, number])[] = (trace.line as number[][]).map(
    (p) => [p[0] as number, p[1] as number] as const
);

/** The recorded fixes, in order. */
export const traceFixes: readonly RecordedFix[] = trace.fixes as RecordedFix[];

/**
 * Where the trace leaves the line.
 *
 * ⚠️ `peak` and not `first`, because the departure RAMPS: a vehicle that leaves a route turns,
 * it does not teleport. The first step is only 18 m off — under any sensible threshold — and a
 * witness anchored there would say the trace never departs. The peak is where it plainly has.
 */
export const DEPARTURE_INDICES = { first: 20, peak: 23, last: 27 } as const;

/**
 * One fix as the platform would deliver it.
 *
 * @param index Which recorded fix.
 * @returns A `GeolocationPosition`-shaped object. Structural rather than an instance of the
 *          real class: `GeolocationPosition` is not constructible, and a test that needed a
 *          real one could only get it from a browser.
 */
export function positionAt(index: number): GeolocationPosition {
    const f = traceFixes[index];
    if (!f) throw new Error(`No fix at index ${index} — the trace holds ${traceFixes.length}.`);
    return {
        coords: {
            longitude: f.longitude,
            latitude: f.latitude,
            accuracy: f.accuracy,
            altitude: null,
            altitudeAccuracy: null,
            heading: f.heading,
            speed: f.speed,
            toJSON: () => ({}),
        },
        timestamp: f.timestamp,
        toJSON: () => ({}),
    } as GeolocationPosition;
}

/**
 * Every fix, in order.
 *
 * @yields Each fix as a `GeolocationPosition`.
 */
export function* replay(): Generator<GeolocationPosition> {
    for (let i = 0; i < traceFixes.length; i++) yield positionAt(i);
}
