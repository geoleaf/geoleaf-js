/*!
 * @geoleaf-plugins/navigation — What a session draws
 *
 * Puts the banner on the map and the camera under the driver, for as long as guidance runs.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getNativeMap, tLabel } from "@geoleaf/host-runtime";
import type { GuidanceView, GuidanceViewListener } from "../guidance-contract.js";
import { createManeuverBanner, type ManeuverBanner } from "./maneuver-banner.js";
import { maneuverLabel, formatApproachDistance } from "./maneuver-labels.js";
import { createFollowCamera, type CameraOptions } from "./camera.js";
import { showSessionNotice, removeSessionNotice } from "./session-notice.js";
import { enterImmersive, exitImmersive } from "./immersive.js";
import { createPositionArrow, type PositionArrow } from "./position-arrow.js";
import { createAnnouncer, type Announcer, type AnnouncerOptions } from "./announcer.js";

/**
 * ## 🛑 Why this file exists, and what its absence cost
 *
 * `maneuver-banner.ts`, `maneuver-labels.ts` and `camera.ts` were written, tested, typed and
 * published — and **nothing imported them**. Not the session, not the façade, not a host: the
 * manifest exposes a single entry point, so no subpath could reach them either. A guidance
 * session ran the whole engine and drew nothing.
 *
 * Three instruments were green on that. The end-to-end suite asserts on `state.guiding` and
 * `r.states` and never queries the DOM, so its oracle could not tell "guidance works" from
 * "guidance works and shows nothing". Knip treats anything reachable from the manifest's
 * `exports` as used. And a closure-review task named *dead code, duplicates, code NOT WIRED*
 * was marked done. It was found by counting importers, which is the only one of the three
 * that could have found it.
 *
 * ## Why the drawing lives here and not in `session.ts`
 *
 * `session.ts` holds the one runtime a page may have, per `INV-FACADE`. Building DOM in it
 * would put a renderer inside the state module, and the next person looking for "what does a
 * session own" would have to read past a banner to find out.
 *
 * ## Why an anchor element rather than positioning the banner itself
 *
 * `maneuver-banner.ts` states, in its stylesheet, that it does not position itself — a plugin
 * that places itself absolutely lands under the toolbar of an integrator who moved theirs. The
 * container decides. This module IS that container: it owns the placement, the banner owns its
 * looks, and neither knows the other's business.
 */

/** A drawn session, for as long as it lasts. */
export interface SessionView {
    /** Removes the banner, hands the map back, and unsubscribes. Idempotent. */
    detach(): void;
    /** Whether the platform can speak — an interface should hide a toggle that does nothing. */
    readonly voiceAvailable: boolean;
    /** Whether announcements are currently allowed. */
    readonly voiceEnabled: boolean;
    /** Turns announcements on or off for this session. Silences what is already speaking. */
    setVoiceEnabled(on: boolean): void;
}

/** The slice of the runtime this needs. Named so a test can drive it without an engine. */
export interface ViewSource {
    /**
     * Subscribes to view samples.
     *
     * @param listener Called for every accepted fix.
     * @returns The unsubscribe function.
     */
    onView(listener: GuidanceViewListener): () => void;
}

/** The map surface this needs — `getContainer`, as `editor` and `measure` already use it. */
interface ContainerCapableMap {
    getContainer(): HTMLElement;
}

/**
 * Draws a running session: banner on the map, camera under the driver.
 *
 * @param source Where view samples come from — the guidance runtime.
 * @param camera How the follow camera frames the driver. Passed in rather than read here: the
 *               configuration is resolved once, in `session.ts`, so two readings cannot differ.
 * @param voice Starting state and distance for spoken announcements, resolved the same way.
 * @returns The attached view. Detaching is safe to call more than once, and safe to call when
 *          nothing attached: a session must be able to end even if the map went away first.
 */
export function attachSessionView(
    source: ViewSource,
    camera: CameraOptions,
    voice: AnnouncerOptions
): SessionView {
    const banner = createManeuverBanner({
        maneuver: (maneuver, modifier) => maneuverLabel(maneuver, modifier),
        distance: (metres) =>
            formatApproachDistance(
                metres,
                tLabel("navigation.unit.metres", "m"),
                tLabel("navigation.unit.kilometres", "km")
            ),
    });

    const anchor = mountAnchor(banner);
    const followCamera = createFollowCamera(camera);
    const arrow: PositionArrow = createPositionArrow();
    // 🛑 The spoken half lives HERE and not in `session.ts`, and it is not a drawing exception:
    // it needs the same samples as the banner, at the same cadence, and it composes its sentence
    // from the same two label helpers. Putting it beside the state module would have meant a
    // second subscription to `onView` for data the view already holds.
    const announcer: Announcer = createAnnouncer(voice);

    // The application chrome goes away for the length of the session. ⚠️ Asked for HERE rather
    // than by the caller: a session draws itself, and the interface it needs room for is the one
    // this module owns. Best-effort throughout — see `immersive.ts`.
    enterImmersive();

    // 🛑 Shown here rather than gated in front of `start()`: the position watch opens with the
    // session, so an acknowledgement that held it back would cost the first fix — the one that
    // places the driver on the route. The engine runs behind the notice.
    showSessionNotice({
        road: tLabel("navigation.notice.road", ""),
        background: tLabel("navigation.notice.background", ""),
        dismiss: tLabel("navigation.notice.dismiss", ""),
    });

    const unsubscribe = source.onView((view: GuidanceView) => {
        banner.update({ step: view.step, distanceMetres: view.distanceToManeuver });
        followCamera.follow(view.position, view.heading, view.elapsedSeconds);
        // ⚠️ The arrow is fed the PROJECTED position, the same one the camera centres on. Using
        // the raw fix instead would make the driver's marker drift off the line the map is
        // holding under it — two truths about one position, a metre apart, both on screen.
        arrow.update(view.position, view.heading);
        announcer.update(view.step, view.distanceToManeuver);
    });

    let detached = false;
    return {
        get voiceAvailable(): boolean {
            return announcer.available;
        },

        get voiceEnabled(): boolean {
            return announcer.enabled;
        },

        setVoiceEnabled(on: boolean): void {
            announcer.setEnabled(on);
        },

        detach(): void {
            if (detached) return;
            detached = true;
            // ⚠️ Unsubscribing first is defensive ORDER, not a load-bearing one, and saying so
            // is the point: nothing can emit between two synchronous statements, so no sample
            // can slip in behind the release. A comment claiming it could would be a property
            // no test can see — which is how the rest of this file came to be needed.
            //
            // What IS load-bearing is that the subscription is dropped at all. A view that
            // stops drawing but keeps listening holds the banner, the camera and the closure
            // over them alive for every remaining fix of the page's life.
            unsubscribe();
            banner.destroy();
            arrow.destroy();
            // ⚠️ Before anything else that could take time: a session ending while a sentence is
            // in flight must stop instructing a driver about a route they have left.
            announcer.destroy();
            anchor?.remove();
            // ⚠️ The notice goes with the session it introduces. One that outlived it would warn
            // a driver about a guidance that ended twenty minutes ago.
            removeSessionNotice();
            // The chrome comes back with the session that took it.
            // ⚠️ Placed before `release()` for READING order, and saying so is the point: it is
            // NOT load-bearing. `exitFullscreen` is asynchronous, so the resize it causes lands
            // after both statements whichever way round they are written. An earlier draft of
            // this comment claimed the order protected the camera from a stale viewport — a
            // property no test can see, which is exactly what the note above warns about.
            exitImmersive();
            // The map goes back flat and north-up — the state a user expects to find it in,
            // not the one guidance happened to leave it in.
            followCamera.release();
        },
    };
}

/**
 * Places the banner inside the map container.
 *
 * ⚠️ Returns `null` rather than throwing when there is no map. A guidance session that refused
 * to start because a container was missing would fail on exactly the setups where the engine
 * still works perfectly well — a headless test, a host that draws its own interface from
 * `onProgress`. The banner is what is lost, not the guidance.
 *
 * @param banner The banner to place.
 * @returns The anchor element, or `null` when no map container was found.
 */
function mountAnchor(banner: ManeuverBanner): HTMLElement | null {
    const container = getNativeMap<ContainerCapableMap>()?.getContainer?.();
    if (!container) return null;

    const anchor = document.createElement("div");
    anchor.className = "gl-nav-banner-anchor";
    anchor.append(banner.element);
    container.append(anchor);
    return anchor;
}
