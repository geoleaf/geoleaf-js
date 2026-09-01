/*!
 * @geoleaf-plugins/navigation — Off-route detection, with hysteresis
 *
 * Decides when the user has actually left the route, and — just as importantly — when they
 * have actually come back.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * ## Why a single reading never decides
 *
 * A consumer GPS in a street of tall buildings reports positions tens of metres from where the
 * device is, for a fix or two at a time. Treating each reading as a verdict makes the runtime
 * request a recomputation, get one, leave the route again on the next noisy fix, request
 * another — **and a provider quota measured in requests per minute empties in minutes.** That
 * is not a hypothetical: it is the failure the roadmap names for this task, and it is the
 * reason this module exists rather than a comparison written inline.
 *
 * ## Why the hysteresis runs in BOTH directions
 *
 * Confirming the exit but not the return leaves the frontier just as unstable: a user driving
 * a road that runs parallel to the route crosses the threshold repeatedly, and each favourable
 * fix would snap the state back to "on route" only for the next to push it out again. The
 * oscillation moves, it does not disappear. So a return is confirmed the same way an exit is.
 *
 * ## Why the counters are separate
 *
 * One shared counter would let two consecutive readings on OPPOSITE sides cancel out, so a
 * sequence that alternates never confirms anything and the state freezes at whatever it was.
 * Two counters, each reset by a reading of the other kind, make an alternating sequence hold
 * the state — which is the correct answer for a fix that cannot make up its mind.
 */

/** How the detector is configured. Every value is passed in — this module reads no config. */
export interface OffRouteConfig {
    /** Beyond this distance from the line, a reading counts as "off". METRES. */
    readonly thresholdMetres: number;
    /** Consecutive "off" readings needed to confirm a departure. */
    readonly confirmExit: number;
    /** Consecutive "on" readings needed to confirm a return. */
    readonly confirmReturn: number;
}

/** What the detector concluded from a reading. */
export interface OffRouteVerdict {
    /** Whether the user is considered off the route AFTER this reading. */
    readonly off: boolean;
    /** `true` only on the reading that flips the verdict — the edge a caller acts on. */
    readonly changed: boolean;
}

/**
 * A detector. Holds the two counters and the confirmed verdict, and nothing else.
 *
 * ⚠️ Stateful on purpose, and the state is exactly what hysteresis IS. A pure function over a
 * single reading cannot express "confirmed over several", and writing one would push the
 * counters into the caller — where the next caller would forget them.
 */
export class OffRouteDetector {
    #config: OffRouteConfig;
    #off = false;
    #offStreak = 0;
    #onStreak = 0;

    /**
     * @param config The thresholds. Not defaulted here: the defaults are configuration, they
     *               belong to the profile schema, and a value written in two places diverges
     *               from its schema without anything turning red.
     */
    constructor(config: OffRouteConfig) {
        this.#config = config;
    }

    /** Whether the user is currently considered off the route. */
    get off(): boolean {
        return this.#off;
    }

    /**
     * Feeds one reading.
     *
     * @param distanceToLine Distance from the raw fix to the route line, in METRES.
     * @returns The verdict after this reading.
     */
    accept(distanceToLine: number): OffRouteVerdict {
        const beyond = distanceToLine > this.#config.thresholdMetres;

        if (beyond) {
            this.#offStreak += 1;
            this.#onStreak = 0;
        } else {
            this.#onStreak += 1;
            this.#offStreak = 0;
        }

        const wasOff = this.#off;
        if (!this.#off && this.#offStreak >= this.#config.confirmExit) this.#off = true;
        else if (this.#off && this.#onStreak >= this.#config.confirmReturn) this.#off = false;

        return { off: this.#off, changed: this.#off !== wasOff };
    }

    /**
     * Forgets everything — after a recomputation, or when guidance restarts.
     *
     * ⚠️ Resetting is NOT optional after a recomputation. The counters were accumulated
     * against the OLD line; carrying them into a route computed from the user's current
     * position would let a departure confirmed on the old geometry fire immediately on the
     * new one, which reads as a route that reroutes forever.
     */
    reset(): void {
        this.#off = false;
        this.#offStreak = 0;
        this.#onStreak = 0;
    }
}
