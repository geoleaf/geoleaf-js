/*!
 * @geoleaf-plugins/navigation — Follow camera
 *
 * Keeps the map under the driver: centred on them, turned the way they are going, tilted.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getNativeMap } from "@geoleaf/host-runtime";
import type { Position } from "../engine/snap.js";

/**
 * ## 🛑 Why the camera is driven by FIXES and never by a render loop
 *
 * The obvious implementation animates the camera from a `requestAnimationFrame` loop, so it
 * glides between positions. It is also the single most expensive thing this plugin could do:
 * a rAF loop wakes the GPU sixty times a second for the whole journey, on a phone that is
 * already holding a screen wake lock and a GPS watch, in a car, often unplugged.
 *
 * Positions arrive at about 1 Hz. Everything between two of them is invented — there is no new
 * information to render. So the camera moves once per fix and lets MapLibre's own transition
 * cover the interval: the same visual result, sixty times fewer frames. The roadmap calls this
 * the most effective energy measure available here, and notes it is free. It is free only if
 * nobody adds the loop back for smoothness.
 *
 * ## Why the transition is never longer than the gap between fixes
 *
 * An eased move that outlasts its interval is still running when the next one starts, so each
 * arrives late and the camera trails further behind with every sample. Capping the duration
 * keeps the lag bounded instead of accumulating.
 */

/** What the camera does on each sample. */
export interface FollowCamera {
    /**
     * Moves the camera.
     *
     * @param position Where the user is, `[longitude, latitude]`.
     * @param heading  Which way they face, in degrees clockwise from north, or `null` to keep
     *                 the current bearing — see the note in `follow`.
     * @param elapsedSeconds Seconds since the previous sample, which bounds the transition.
     */
    follow(position: Position, heading: number | null, elapsedSeconds: number | null): void;
    /** Releases the map back to the user: north-up, flat, no follow. */
    release(): void;
}

/**
 * How the camera behaves while following.
 *
 * 🛑 **Every member is REQUIRED, and none of them has a default here.** `config.ts` is the one
 * place a threshold of this plugin receives a value; a default written both there and in the
 * module that reads it diverges from it without anything turning red, on a quantity nobody
 * re-measures because both sides look authoritative. A module that wants a threshold gains a
 * parameter, not a constant.
 *
 * ⚠️ This interface used to make all three optional, and `zoom` had no default at all — so the
 * one caller, which passed nothing, got a camera that tilted and turned but **never zoomed**.
 * An optional knob nobody sets is indistinguishable from a knob that does not work.
 */
export interface CameraOptions {
    /** Tilt, in degrees. */
    readonly pitch: number;
    /** Zoom to hold while following. */
    readonly zoom: number;
    /** Ceiling on a transition, in MILLISECONDS. */
    readonly maxTransitionMs: number;
}

/** The slice of MapLibre this needs. Named so a test can supply it without a WebGL context. */
interface CameraCapableMap {
    easeTo(options: Record<string, unknown>): void;
}

/**
 * Creates a follow camera over the host's map.
 *
 * @param options Tilt, zoom and the transition ceiling — all three required, see the type.
 * @returns The camera. Every method is a no-op when no map is available — a guidance session
 *          must not fail because the map was torn down under it.
 */
export function createFollowCamera(options: CameraOptions): FollowCamera {
    const { pitch, zoom, maxTransitionMs: maxMs } = options;

    return {
        follow(position: Position, heading: number | null, elapsedSeconds: number | null): void {
            const map = getNativeMap<CameraCapableMap>();
            if (typeof map?.easeTo !== "function") return;

            const duration =
                elapsedSeconds && elapsedSeconds > 0
                    ? Math.min(elapsedSeconds * 1000, maxMs)
                    : maxMs;

            const move: Record<string, unknown> = {
                center: { lng: position[0], lat: position[1] },
                pitch,
                duration,
                // The move is the runtime's, not the user's: an `easeTo` that reports itself as
                // user-originated makes the map's own "user has interacted" logic treat every
                // sample as a gesture, which cancels follow modes elsewhere in the core.
                essential: true,
            };
            // ⚠️ `bearing` is omitted, not set to 0, when there is no heading. Setting 0 would
            // snap the map north-up at every stop — the device withholds `heading` precisely
            // when standing still — and the map would spin back and forth at every red light.
            if (heading !== null) move["bearing"] = heading;
            // Applied on EVERY fix, exactly like pitch. See `config.ts` for why zoom is not
            // the one axis left to drift: a camera that frames once and then lets go is a
            // camera that follows by halves.
            move["zoom"] = zoom;

            map.easeTo(move);
        },

        release(): void {
            const map = getNativeMap<CameraCapableMap>();
            if (typeof map?.easeTo !== "function") return;
            // Flat and north-up: the map is handed back in the state a user expects to find it,
            // not in the one guidance happened to leave it in.
            map.easeTo({ pitch: 0, bearing: 0, duration: maxMs, essential: true });
        },
    };
}
