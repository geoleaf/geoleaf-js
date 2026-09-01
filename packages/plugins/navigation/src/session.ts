/*!
 * @geoleaf-plugins/navigation — Guidance session
 *
 * Holds the one runtime a page may have, and the listeners waiting for it.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { RouteResult, RouteOutcome, Waypoint } from "@geoleaf-plugins/routing";
import { getPluginConfig } from "./config.js";
import { createGuidanceRuntime } from "./engine/runtime.js";
import type { Position } from "./engine/snap.js";
import type { GuidanceListener } from "./guidance-contract.js";
import { attachSessionView, type SessionView } from "./ui/session-view.js";
import { createScreenWakeLock, type ScreenWakeLock } from "./platform/wake-lock.js";

/**
 * ## Why this is not in `public-api.ts`
 *
 * `INV-FACADE`: a façade exposes an API, it does not implement one. The rule is not decoration
 * — a façade that holds state is a façade nobody can read to learn what the surface IS,
 * because the surface and its machinery are interleaved. The state lives here; the façade
 * delegates.
 *
 * ## 🛑 Why the caller supplies the route, the line and the two functions
 *
 * All four require `@geoleaf-plugins/routing` as a **value** — a provider to call, a polyline
 * codec to run — and this package imports only its types. That containment is what makes the
 * repository's first plugin-to-plugin edge inert. The caller already holds both, as closures
 * over what it just used; passing them costs nothing and grows no API.
 */

/** What the caller must supply for guidance to be able to re-route. */
export interface GuidanceDeps {
    /**
     * Recomputes from `from` through `remaining`.
     *
     * @param from      Where the user is now.
     * @param remaining The stops not yet reached, in travel order.
     * @returns What the provider answered, including its named refusals.
     */
    recompute(from: Position, remaining: readonly Waypoint[]): Promise<RouteOutcome>;
    /**
     * Decodes a route geometry.
     *
     * @param geometry The encoded polyline a provider returned.
     * @returns The positions, in `[longitude, latitude]`.
     */
    decodeGeometry(geometry: string): readonly Position[];
}

/** The single runtime, created on the first `startSession`. */
let runtime: ReturnType<typeof createGuidanceRuntime> | null = null;

/** Listeners subscribed before there was a runtime to give them to. */
const pending = new Set<GuidanceListener>();

/** What the running session draws, while it runs. */
let view: SessionView | null = null;

/**
 * The screen lock held for the length of a session, when the profile asks for one.
 *
 * 🛑 **It lives here and not in the view**, because it is not something a session DRAWS: it is
 * something a session HOLDS, exactly like the runtime beside it. And it must survive a view that
 * never attached — a headless host, a page whose map went away — because the screen has to stay
 * lit whether or not there is a banner on it.
 */
let wakeLock: ScreenWakeLock | null = null;

/**
 * Whether guidance is running.
 *
 * @returns `true` while a route is being followed.
 */
export function isGuiding(): boolean {
    return runtime !== null && runtime.state !== "idle";
}

/**
 * Starts guiding along `route`.
 *
 * ⚠️ Creating the runtime lazily rather than at module load is not an optimisation: building it
 * eagerly would open a position watch for a session nobody asked for, on every page that merely
 * loads the bundle.
 *
 * @param route The route to follow, as any provider normalised it.
 * @param line  Its geometry, ALREADY DECODED.
 * @param deps  How to recompute, and how to decode what comes back.
 */
export function startSession(
    route: RouteResult,
    line: readonly Position[],
    deps: GuidanceDeps
): void {
    const cfg = getPluginConfig();
    // A previous session is stopped rather than left running: two runtimes would hold two
    // position watches and two sets of listeners, and the older would keep moving the camera
    // for a route the user has left.
    runtime?.stop();
    // ⚠️ The previous lock is released BEFORE a new one is taken, and this is not tidiness: the
    // lock installs a `visibilitychange` listener, so a restart that skipped the release would
    // leave one live listener per session for the life of the page, each re-requesting a lock
    // for a journey that ended.
    void wakeLock?.release();
    wakeLock = null;
    runtime = createGuidanceRuntime({
        config: {
            arrivalRadiusMetres: cfg.arrivalRadiusMetres,
            offRouteThresholdMetres: cfg.offRouteThresholdMetres,
            confirmExit: cfg.confirmExit,
            confirmReturn: cfg.confirmReturn,
            retryAfterFixes: cfg.retryAfterFixes,
            maxRetryFixes: cfg.maxRetryFixes,
        },
        recompute: deps.recompute,
        decodeGeometry: deps.decodeGeometry,
    });
    // ⚠️ Listeners subscribed BEFORE the first start are carried over. Without this, an
    // interface that wires `onProgress` at mount time — the normal order — would receive
    // nothing, and the bug would look like a runtime that does not emit.
    for (const l of pending) runtime.onProgress(l);

    // 🛑 The interface is attached HERE, and its absence was the plugin's largest defect: the
    // banner and the camera were written, tested and published while nothing imported them, so
    // a session drove the whole engine and drew nothing. Attaching before `start` rather than
    // after is deliberate — `start` opens the position watch, and a fix arriving before the
    // banner exists would be the one sample nobody sees.
    view?.detach();
    view = attachSessionView(
        runtime,
        {
            pitch: cfg.followPitch,
            zoom: cfg.followZoom,
            maxTransitionMs: cfg.cameraMaxTransitionMs,
        },
        { enabled: cfg.voiceEnabled, announceAtMetres: cfg.voiceAnnounceAtMetres }
    );

    // ⚠️ Fire-and-forget, and never awaited: a wake lock is a comfort, never a prerequisite. It
    // is refused on an insecure origin, on a low battery, under a policy — all ordinary. Guidance
    // that waited on it, or warned about it, would be worse than a screen that dims.
    if (cfg.keepScreenAwake) {
        wakeLock = createScreenWakeLock();
        void wakeLock.acquire();
    }

    runtime.start(route, line);
}

/** Stops guidance and releases the platform, and takes the interface down with it. Idempotent. */
export function stopSession(): void {
    runtime?.stop();
    // ⚠️ Detached even when there is no runtime. The two are set on different paths — a view
    // survives a runtime that was never created — and leaving a banner on the map after the
    // guidance behind it has ended is worse than leaving no banner at all: it keeps showing the
    // last manoeuvre, forever, and reads as current.
    view?.detach();
    view = null;
    // ⚠️ Released even when no lock was taken: the two are set on different paths — a profile can
    // switch `keepScreenAwake` off between two sessions — and a lock that outlived its journey
    // would keep a phone lit in a pocket until the tab is closed.
    void wakeLock?.release();
    wakeLock = null;
}

/**
 * Turns spoken announcements on or off for the RUNNING session.
 *
 * ⚠️ Session-scoped by contract, not by omission: `modules.navigation.voiceEnabled` is the
 * STARTING state, and each session starts from the profile again. A preference that survived
 * would need somewhere to live, and nothing has asked for one.
 *
 * @param on Whether announcements are allowed. Turning them off silences what is already
 *           speaking — a switch that only stopped future announcements would leave a driver who
 *           just asked for quiet listening to the next twenty seconds of instructions.
 */
export function setVoiceEnabled(on: boolean): void {
    view?.setVoiceEnabled(on);
}

/**
 * Whether announcements are currently allowed.
 *
 * @returns `false` when nothing is running, when the platform cannot speak, or when they are off.
 */
export function isVoiceEnabled(): boolean {
    return view?.voiceEnabled ?? false;
}

/**
 * Whether the platform can speak at all.
 *
 * @returns `false` when nothing is running or the engine has no speech synthesis. An interface
 *          should hide its toggle on `false` rather than offer a control that does nothing.
 */
export function isVoiceAvailable(): boolean {
    return view?.voiceAvailable ?? false;
}

/**
 * Subscribes to progress samples.
 *
 * @param listener Called for every accepted fix.
 * @returns The unsubscribe function.
 */
export function onProgress(listener: GuidanceListener): () => void {
    pending.add(listener);
    const off = runtime?.onProgress(listener);
    return () => {
        pending.delete(listener);
        off?.();
    };
}
