/*!
 * @geoleaf-plugins/navigation — Guidance runtime contract
 *
 * What the guidance runtime will be, expressed against the route model of
 * `@geoleaf-plugins/routing`. Types only — no implementation lives here yet.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { RouteResult, NavProgress, NavState, RouteStep } from "@geoleaf-plugins/routing";

/**
 * ## Why this file exists before the runtime does
 *
 * It is the ONE place the dependency on `@geoleaf-plugins/routing` is real, and making it real
 * is the point: the manifest may only declare a package that something imports — knip refuses a
 * dependency nothing uses, and it is right to, because a declared-but-unused dependency is
 * indistinguishable from one left behind after a deletion.
 *
 * 🛑 **`import type`, and nothing else, ever.** Type imports are erased at build, so no byte of
 * `routing` enters this bundle and no load order is created between the two. That containment
 * is what makes this — the first plugin-to-plugin edge in the repository — safe. Importing a
 * VALUE from here would turn the light package into a runtime prerequisite of the heavy one,
 * which is the reverse of the dependency the split exists to express.
 */

/** A sample handed to whoever is listening while guidance runs. */
export type GuidanceListener = (progress: NavProgress) => void;

/**
 * What the INTERFACE needs on each fix, and `NavProgress` deliberately does not carry.
 *
 * ## 🛑 Why a second channel rather than four more fields on `NavProgress`
 *
 * `NavProgress` belongs to `@geoleaf-plugins/routing`: it is part of the route model, published
 * with it, and consumed by anything that wants to know how a journey is going. A projected
 * position, a resolved heading and the seconds since the previous sample are none of those
 * things — they are the guidance runtime's own working state, useful to something that DRAWS.
 * Putting them on the route model would make every consumer of a route carry the internals of a
 * renderer it does not have.
 *
 * The split is also what keeps `onProgress` stable: an integrator listening to journey progress
 * is unaffected by anything the banner or the camera ever needs.
 *
 * ⚠️ `heading` is `null` rather than `0` when unknown — the platform withholds it precisely
 * while standing still, and a `0` would be read as "facing north" and turn the map at every red
 * light. `elapsedSeconds` is `null` on the first fix for the same reason: there is no previous
 * sample, and inventing a duration would make the first camera move an arbitrary length.
 */
export interface GuidanceView {
    /** The step whose manoeuvre comes next, or `null` when there is nothing to announce. */
    readonly step: RouteStep | null;
    /** Distance to that manoeuvre, in METRES. */
    readonly distanceToManeuver: number;
    /** The fix PROJECTED onto the route line, `[longitude, latitude]`. */
    readonly position: readonly [number, number];
    /** Degrees clockwise from north, or `null` when neither the platform nor the track gives one. */
    readonly heading: number | null;
    /** Seconds since the previous accepted fix, or `null` on the first. */
    readonly elapsedSeconds: number | null;
}

/** A view sample handed to whatever draws the session. */
export type GuidanceViewListener = (view: GuidanceView) => void;

/** What drives a route into turn-by-turn guidance. */
export interface GuidanceRuntime {
    /** Where the runtime currently is. */
    readonly state: NavState;
    /**
     * Starts following `route` along `line`.
     *
     * @param route A route as any provider normalised it — the runtime never asks WHICH engine
     *              produced it, which is the whole reason the model is provider-neutral.
     * @param line  The route geometry, ALREADY DECODED, in `[longitude, latitude]`.
     *
     * ⚠️ The line is a second parameter rather than being read from `route.geometry`, and the
     * reason is the same containment that makes this edge safe at all: `geometry` is an
     * encoded polyline, decoding it needs a VALUE from `@geoleaf-plugins/routing`, and this
     * package may import only types. Copying the decoder here instead would be a fork — the
     * thing this repository has a gate and a scar for. The caller has the decoded line
     * already: it is what it drew.
     */
    start(route: RouteResult, line: readonly (readonly [number, number])[]): void;
    /** Stops guidance and releases the platform adapters. Idempotent. */
    stop(): void;
    /** Subscribes to progress samples. Returns the unsubscribe function. */
    onProgress(listener: GuidanceListener): () => void;
    /**
     * Subscribes to VIEW samples — what something drawing the session needs.
     *
     * Separate from `onProgress` on purpose; see `GuidanceView`. Returns the unsubscribe
     * function.
     */
    onView(listener: GuidanceViewListener): () => void;
}
