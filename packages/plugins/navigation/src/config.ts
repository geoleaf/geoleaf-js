/*!
 * @geoleaf-plugins/navigation — Configuration
 *
 * Reads `modules.navigation` from the active profile, and is the ONE place every threshold the
 * guidance runtime uses receives a value.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { coreConfigGet } from "@geoleaf/host-runtime";

/**
 * ## Why the engine modules hold no defaults of their own
 *
 * `snap.ts`, `off-route.ts`, `state-machine.ts` and `runtime.ts` all take their thresholds as
 * parameters and default none of them. That is deliberate and it is the reason this file
 * exists: a value written both here and in the module that reads it diverges from this one
 * without anything turning red — the exact family of defect this project keeps finding, on a
 * quantity nobody re-measures because both sides look authoritative.
 *
 * ⚠️ So the rule is one-way: **a threshold is declared here and nowhere else.** A module that
 * wants a new one gains a parameter, not a constant.
 *
 * ## Why an out-of-range value falls back rather than throwing
 *
 * A profile is written by an integrator, by hand, sometimes months before anyone drives with
 * it. `confirmExit: 0` would make every single noisy reading a confirmed departure — a route
 * that re-routes on every fix — and `arrivalRadiusMetres: -5` would make arrival unreachable.
 * Throwing would take the map down over a typo in a comfort setting; ignoring silently would
 * leave the operator with guidance that behaves nothing like their file says. Falling back to
 * a working value keeps the map alive, and the inventory says what each bound is.
 */

/**
 * The values a profile inherits when it says nothing.
 *
 * ⚠️ `showButton` is `false` while the panel does not exist — a visible button that opens
 * nothing is a DEAD control, and a dead control does not announce itself, it gets clicked. It
 * turns `true` together with what it opens.
 */
const DEFAULTS = {
    enabled: true,
    showButton: false,

    /** Within this distance of a stop, the stop counts as reached. METRES. */
    arrivalRadiusMetres: 30,
    /**
     * Beyond this distance from the line, a reading counts as off-route. METRES.
     *
     * ⚠️ Wider than the arrival radius, on purpose: a vehicle parked at a delivery is
     * routinely further from the road than it is from the stop, and the two thresholds
     * crossing would make every arrival look like a departure.
     */
    offRouteThresholdMetres: 40,
    /** Consecutive off-route readings needed to confirm a departure. */
    confirmExit: 3,
    /**
     * Consecutive on-route readings needed to confirm a return.
     *
     * ⚠️ Lower than `confirmExit`, and the asymmetry is intended: a wrongly confirmed
     * departure spends a provider request, a wrongly confirmed return only delays one. Being
     * back on the route is also the state the driver is trying to reach.
     */
    confirmReturn: 2,
    /** Fixes to wait before the first retry after a failed recomputation. */
    retryAfterFixes: 2,
    /** Ceiling on the retry backoff, in fixes. */
    maxRetryFixes: 8,

    /** Whether manoeuvres are spoken. Switchable in session; this is only the starting state. */
    voiceEnabled: true,
    /** How far ahead of a manoeuvre it is first announced. METRES. */
    voiceAnnounceAtMetres: 200,
    /** Whether the screen is kept awake while guidance runs. */
    keepScreenAwake: true,

    /**
     * Zoom held while following the driver.
     *
     * 🛑 Re-applied on EVERY fix, like pitch and bearing — so a manual zoom during guidance is
     * pulled back within a second. That is the coherent choice, not an oversight: pitch and
     * bearing are already written every fix, and making zoom the one exception would give a
     * camera that follows by halves — framed at the start, drifting afterwards with nothing to
     * catch it. The way out of the frame is to stop guidance.
     */
    followZoom: 17.5,
    /**
     * Tilt held while following, in degrees.
     *
     * ⚠️ Capped at 80 because that is what the engine accepts (`maxPitch` in the MapLibre
     * adapter), not because 80 is a good idea. A value above it is not a stronger tilt, it is a
     * value the renderer refuses.
     */
    followPitch: 60,
    /**
     * Ceiling on a camera transition, in MILLISECONDS.
     *
     * ⚠️ An eased move that outlasts the gap between fixes is still running when the next one
     * starts, so each arrives late and the camera trails further behind with every sample.
     */
    cameraMaxTransitionMs: 1000,
} as const;

/** Every key `modules.navigation` accepts. */
export interface PluginConfig {
    enabled: boolean;
    showButton: boolean;
    arrivalRadiusMetres: number;
    offRouteThresholdMetres: number;
    confirmExit: number;
    confirmReturn: number;
    retryAfterFixes: number;
    maxRetryFixes: number;
    voiceEnabled: boolean;
    voiceAnnounceAtMetres: number;
    keepScreenAwake: boolean;
    followZoom: number;
    followPitch: number;
    cameraMaxTransitionMs: number;
    [key: string]: unknown;
}

/**
 * The numeric keys, with the bounds outside which the declared default is used instead.
 *
 * ⚠️ The upper bound is optional, and it is not symmetry for its own sake: the camera ones are
 * ENGINE limits, not preferences. A pitch of 95 or a zoom of 40 is not an aggressive setting,
 * it is a number the renderer refuses — and honouring it would hand MapLibre a camera it cannot
 * build, on the say-so of a typo in a comfort setting.
 */
const NUMERIC_BOUNDS: ReadonlyArray<readonly [keyof PluginConfig, number, number?]> = [
    ["arrivalRadiusMetres", 1],
    ["offRouteThresholdMetres", 1],
    // 🛑 At least ONE. Zero would confirm a departure on a reading that has not happened yet,
    // which is not a shorter confirmation — it is no confirmation, and it empties a provider
    // quota in minutes.
    ["confirmExit", 1],
    ["confirmReturn", 1],
    ["retryAfterFixes", 1],
    ["maxRetryFixes", 1],
    ["voiceAnnounceAtMetres", 1],
    // Engine-bounded. `maxPitch` defaults to 80 in the MapLibre adapter; zoom 22 is past the
    // deepest tile level anything here serves. Zero pitch is legitimate — it means flat.
    ["followZoom", 1, 22],
    ["followPitch", 0, 80],
    ["cameraMaxTransitionMs", 1, 5000],
];

/**
 * The effective configuration.
 *
 * @returns The profile's values merged over the defaults, with out-of-range numbers replaced
 *          by their default rather than honoured or thrown on.
 */
export function getPluginConfig(): PluginConfig {
    const raw = coreConfigGet<Partial<PluginConfig>>("modules.navigation", {}) ?? {};
    const merged = { ...DEFAULTS, ...raw } as PluginConfig;

    for (const [key, min, max] of NUMERIC_BOUNDS) {
        const v = merged[key];
        const outOfRange =
            typeof v !== "number" ||
            !Number.isFinite(v) ||
            v < min ||
            (max !== undefined && v > max);
        if (outOfRange) {
            merged[key] = DEFAULTS[key as keyof typeof DEFAULTS] as never;
        }
    }
    // ⚠️ Checked AFTER the bounds, because a ceiling below its own floor is not out of range —
    // each value is individually valid, and only their relation is wrong. Left as written, the
    // backoff would shrink on every failure instead of growing.
    if (merged.maxRetryFixes < merged.retryAfterFixes) {
        merged.maxRetryFixes = merged.retryAfterFixes;
    }
    return merged;
}
