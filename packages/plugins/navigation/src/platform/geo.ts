/*!
 * @geoleaf-plugins/navigation — Position watch
 *
 * The one place this package asks the browser where the user is.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * ## Why a watch of its own, when the core already has one
 *
 * The core's geolocation capability keeps a fix and a permission, and the routing plugin reads
 * it to answer "start from my position". But it destructures exactly `latitude`, `longitude`
 * and `accuracy` — measured, `geolocation.ts` — so it carries neither **heading** nor
 * **speed**. Guidance needs both: heading orients the camera, and speed is what tells an
 * implausible jump from a fast vehicle.
 *
 * ⚠️ Two watches means two subscriptions to the same sensor, not two permissions: the browser
 * asks once and both watches receive fixes. What it does cost is battery, which is why this
 * one is started when guidance starts and stopped the moment it ends.
 *
 * ## The jump filter, and the half of it that is NOT reused
 *
 * `measure/src/tools/tool-gps.ts` filters two ways: it rejects an implausible speed between
 * consecutive fixes, and it drops fixes closer than two metres apart.
 *
 * 🛑 **Only the first half belongs here.** Dropping a fix is right when collecting vertices —
 * a stationary device would otherwise pile up hundreds of identical points. It is wrong for
 * guidance: a vehicle stopped at a light would cease to exist, the state machine would stop
 * receiving samples, and a slow approach to a stop would never come inside the arrival radius.
 * **Filtering is not the same as not updating.**
 */

/** One accepted fix, with everything the guidance engine reads. */
export interface GeoFix {
    /** `[longitude, latitude]`, the order this repository uses everywhere. */
    readonly position: readonly [number, number];
    /** Reported accuracy, in METRES. */
    readonly accuracy: number;
    /** Heading in degrees clockwise from north, or `null` when the platform withholds it. */
    readonly heading: number | null;
    /** Ground speed in METRES PER SECOND, or `null` when the platform withholds it. */
    readonly speed: number | null;
    /** Platform timestamp, in milliseconds. */
    readonly timestamp: number;
}

/** Why a watch could not deliver. */
export type GeoWatchFailure =
    /** The browser exposes no geolocation at all — an insecure origin, or a stripped host. */
    | "unsupported"
    /** The user declined, or a policy refuses. Not an error: it is an answer. */
    | "denied"
    /** Permission is there, but no fix can be acquired — indoors, no signal. */
    | "unavailable"
    /** No fix arrived inside the timeout. Retrying later may work. */
    | "timeout";

/** How to run the watch, and where to send what it produces. */
export interface GeoWatchOptions {
    /** Called for every ACCEPTED fix. */
    onFix(fix: GeoFix): void;
    /** Called when the watch cannot deliver. May be called more than once. */
    onFailure(reason: GeoWatchFailure): void;
    /**
     * Ceiling on plausible ground speed between two fixes, in METRES PER SECOND.
     *
     * Defaulted rather than left to the caller because a missing ceiling is indistinguishable
     * from a very large one, and the failure it lets through — a single GPS jump projecting
     * onto the wrong part of the route — is silent.
     */
    readonly maxSpeedMps?: number;
}

/** ~200 km/h. Generous on purpose: this rejects sensor glitches, not fast driving. */
const DEFAULT_MAX_SPEED_MPS = 55;

/** Metres per degree of latitude — enough for a plausibility check, not for a measurement. */
const METRES_PER_DEGREE = 111_320;

/**
 * Starts watching the user's position.
 *
 * @param options Callbacks and the speed ceiling.
 * @returns A function that stops the watch. Idempotent — calling it twice is harmless, which
 *          matters because guidance can be stopped by the user, by arrival, and by teardown,
 *          and those races are real.
 */
export function startGeoWatch(options: GeoWatchOptions): () => void {
    const geo = globalThis.navigator?.geolocation;
    if (!geo) {
        options.onFailure("unsupported");
        return () => {};
    }

    const ceiling = options.maxSpeedMps ?? DEFAULT_MAX_SPEED_MPS;
    let previous: GeoFix | null = null;
    let watchId: number | null = null;
    let stopped = false;

    watchId = geo.watchPosition(
        (pos) => {
            const fix: GeoFix = {
                position: [pos.coords.longitude, pos.coords.latitude],
                accuracy: pos.coords.accuracy,
                heading: usable(pos.coords.heading),
                speed: usable(pos.coords.speed),
                timestamp: pos.timestamp,
            };
            // ⚠️ The very first fix has nothing to be implausible against, and refusing it
            // would leave guidance waiting for a second one — on a slow sensor, tens of
            // seconds of a screen that says nothing.
            if (previous && jumped(previous, fix, ceiling)) return;
            previous = fix;
            options.onFix(fix);
        },
        (err) => options.onFailure(classify(err)),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
    );

    return () => {
        if (stopped || watchId === null) return;
        stopped = true;
        geo.clearWatch(watchId);
    };
}

/**
 * Whether the step between two fixes is faster than a vehicle can move.
 *
 * ⚠️ Planar, not geodesic, and deliberately so: this is a plausibility test, and a projection
 * good to a percent is ample to tell 12 m/s from 900. Pulling in a geodesic distance here
 * would add a dependency to an adapter whose whole job is to touch one browser API.
 *
 * @param a       The previous accepted fix.
 * @param b       The candidate.
 * @param ceiling Metres per second above which the step is refused.
 * @returns `true` when the step should be dropped.
 */
function jumped(a: GeoFix, b: GeoFix, ceiling: number): boolean {
    const seconds = (b.timestamp - a.timestamp) / 1000;
    // A non-advancing clock cannot bound anything: some hosts repeat a timestamp, and dividing
    // by it would make every step infinitely fast and drop the whole stream.
    if (!(seconds > 0)) return false;
    const dLat = (b.position[1] - a.position[1]) * METRES_PER_DEGREE;
    const dLon =
        (b.position[0] - a.position[0]) *
        METRES_PER_DEGREE *
        Math.cos((a.position[1] * Math.PI) / 180);
    return Math.hypot(dLat, dLon) / seconds > ceiling;
}

/**
 * A platform number that can actually be used.
 *
 * ⚠️ `NaN` is treated as absence, like `null`. Some hosts report it for a heading while
 * stationary, and one `NaN` reaching a camera rotation makes the map disappear.
 *
 * @param v What the platform reported.
 * @returns The number, or `null`.
 */
function usable(v: number | null | undefined): number | null {
    return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * The platform's error code, named.
 *
 * @param err What the platform passed.
 * @returns The failure this package reports.
 */
function classify(err: GeolocationPositionError): GeoWatchFailure {
    if (err.code === 1) return "denied";
    if (err.code === 3) return "timeout";
    return "unavailable";
}
