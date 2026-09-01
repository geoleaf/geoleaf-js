/*!
 * @geoleaf-plugins/navigation — Guidance state machine
 *
 * The five states, their transitions, and the one rule that makes resuming safe.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { NavState } from "@geoleaf-plugins/routing";

/**
 * ## The resume rule, and the class of bug it exists to prevent
 *
 * 🛑 **Coming back to the foreground NEVER restores the remembered state.** The machine drops
 * to `idle` awaiting a fix, and the next fix re-projects, recomputes progress, and re-runs
 * off-route detection before any state is claimed again.
 *
 * The application may have been backgrounded for twenty minutes. Restoring the remembered
 * state would announce a manoeuvre that was passed long ago, and — worse — would announce it
 * confidently. The validated CDC names the class: "le guidage reprend trois kilomètres en
 * arrière".
 *
 * ⚠️ This is why {@link GuidanceMachine.suspend} exists and there is no `resume`. Resuming is
 * not an operation on the machine: it is an ordinary fix arriving after a suspension, and
 * giving it its own method would create the very shortcut the rule forbids.
 *
 * ## Why `waypoint-reached` holds rather than passing through
 *
 * An intermediate stop is a place someone stops FOR something — a delivery, a visit. Rolling
 * straight on to the next leg would be right for a via point drawn on a map and wrong for the
 * multi-stop rounds this scope exists to serve. The hold is released by
 * {@link GuidanceMachine.continueToNextLeg}, which the interface calls on an explicit action
 * or a timer, never this module.
 */

/** What a fix tells the machine, once everything measurable about it has been measured. */
export interface MachineInput {
    /** Whether off-route detection considers the user away from the line — already confirmed. */
    readonly off: boolean;
    /** Index of the leg being travelled. */
    readonly legIndex: number;
    /** Distance from the projected position to the end of the current leg, in METRES. */
    readonly legDistanceRemaining: number;
    /** Whether the current leg is the last one. */
    readonly isFinalLeg: boolean;
}

/** The thresholds this machine reads. Passed in; this module reads no configuration. */
export interface MachineConfig {
    /** Within this distance of a stop, the stop counts as reached. METRES. */
    readonly arrivalRadiusMetres: number;
}

/** The machine. Holds the state and the leg it last announced, and nothing else. */
export class GuidanceMachine {
    #config: MachineConfig;
    #state: NavState = "idle";
    #reachedLeg = -1;

    /**
     * @param config The arrival radius.
     */
    constructor(config: MachineConfig) {
        this.#config = config;
    }

    /** The current state. */
    get state(): NavState {
        return this.#state;
    }

    /**
     * Begins guidance on a loaded route.
     *
     * @returns The state after starting.
     */
    start(): NavState {
        this.#state = "navigating";
        this.#reachedLeg = -1;
        return this.#state;
    }

    /**
     * Stops guidance. Idempotent, and the same operation as a user stopping: the CDC's
     * "tout état → arrêt utilisateur → idle".
     *
     * @returns `"idle"`.
     */
    stop(): NavState {
        this.#state = "idle";
        this.#reachedLeg = -1;
        return this.#state;
    }

    /**
     * Marks the runtime as having lost the foreground.
     *
     * ⚠️ Drops to `idle` and forgets which leg was announced. That forgetting is the point:
     * see the resume rule above.
     *
     * @returns `"idle"`.
     */
    suspend(): NavState {
        this.#state = "idle";
        this.#reachedLeg = -1;
        return this.#state;
    }

    /**
     * Releases a hold at an intermediate stop.
     *
     * @returns The state after continuing — `"navigating"`, or the state unchanged when the
     *          machine was not holding, so that a stray call cannot restart a finished route.
     */
    continueToNextLeg(): NavState {
        if (this.#state === "waypoint-reached") this.#state = "navigating";
        return this.#state;
    }

    /**
     * Feeds one measured fix.
     *
     * @param input What the fix means, once measured.
     * @returns The state after this fix.
     */
    accept(input: MachineInput): NavState {
        // A terminal state is terminal: `arrived` is left by `start` or `stop`, never by a
        // fix. Without this, driving past the destination would re-enter `navigating` and the
        // interface would resume guiding someone who has finished.
        if (this.#state === "arrived") return this.#state;

        // A held stop stays held until it is explicitly released — including while off-route,
        // because someone parked at a delivery is routinely more than the threshold from the
        // road the route used.
        if (this.#state === "waypoint-reached") return this.#state;

        if (this.#state === "idle") this.#state = "navigating";

        if (input.off) {
            this.#state = "rerouting";
            return this.#state;
        }

        // Back on the line after a recomputation, or after a confirmed return.
        if (this.#state === "rerouting") this.#state = "navigating";

        if (input.legDistanceRemaining <= this.#config.arrivalRadiusMetres) {
            if (input.isFinalLeg) {
                this.#state = "arrived";
            } else if (input.legIndex !== this.#reachedLeg) {
                // Guarded by the leg index, not by the state alone: without it, a fix that
                // lingers inside the arrival radius re-announces the same stop on every
                // sample, and the interface fires its arrival chime once per second.
                this.#reachedLeg = input.legIndex;
                this.#state = "waypoint-reached";
            }
        }

        return this.#state;
    }
}
