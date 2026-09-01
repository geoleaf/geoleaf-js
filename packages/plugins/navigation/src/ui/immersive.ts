/*!
 * @geoleaf-plugins/navigation — Immersive mode for a running session
 *
 * Asks the host to strip its chrome for the length of a guidance session, and to give it back.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getGeoLeaf, Log } from "@geoleaf/host-runtime";

/**
 * ## Why this file is four lines of logic and thirty of reasoning
 *
 * The mode itself belongs to the core: it is the core's chrome that gets stripped, and a plugin
 * that reached into `#gl-theme-primary-container` from its own stylesheet would be hiding a
 * capability that cannot know it is hidden, cannot test it, and cannot say so. What lives here
 * is the *asking* — plus the two things a plugin must never assume about a host it did not
 * build.
 *
 * ## 🛑 A core that predates the mode satisfies the same peer range
 *
 * `peerDependencies` says `@geoleaf/core: ^3.0.0`. A `3.0.0` without `setImmersive` matches it
 * perfectly, and then the call is a no-op AND the stylesheet that would hide the chrome does not
 * exist either — so the mode silently does nothing at all. `?.()` would swallow that whole. The
 * absence is therefore REPORTED: a feature that quietly does not exist is the defect this
 * repository keeps re-finding, and the one thing that makes it findable is saying so once.
 *
 * ## Why the session never depends on the answer
 *
 * Entering immersive mode is a comfort, not a precondition. Nothing here throws, and nothing
 * here is awaited: a guidance session must run on a host that refuses fullscreen, on a host
 * with no chrome to strip, and in a headless test with no document at all.
 */

/** The slice of `GeoLeaf.UI` this needs. `GeoLeafHost.UI` is an untyped bag; this is the cast. */
interface ImmersiveCapableUI {
    setImmersive?(on: boolean, options?: { fullscreen?: boolean }): void;
}

/** Whether the missing-core-support warning has already been emitted. Once is informative. */
let warned = false;

/**
 * Resolves the host's immersive seam.
 *
 * @returns The seam, or `null` when the core is absent or predates it.
 */
function seam(): ImmersiveCapableUI | null {
    const ui = getGeoLeaf()?.UI as ImmersiveCapableUI | undefined;
    if (typeof ui?.setImmersive === "function") return ui;
    if (!warned) {
        warned = true;
        Log.warn(
            "[Navigation] This core has no immersive UI mode: guidance will run with the " +
                "application chrome still on screen. Upgrade @geoleaf/core to get it."
        );
    }
    return null;
}

/**
 * Strips the host chrome and asks for fullscreen, for the length of a session.
 *
 * ⚠️ Fullscreen is best-effort by design. The gesture that starts guidance is a click, but the
 * plugin is loaded lazily in between, and an import slower than the browser's transient
 * activation window leaves the request to be refused. That refusal costs nothing: hiding the
 * chrome and going fullscreen are two mechanisms, and the first one has already happened.
 */
export function enterImmersive(): void {
    seam()?.setImmersive?.(true, { fullscreen: true });
}

/** Gives the chrome back and leaves fullscreen — the latter only if the host entered it. */
export function exitImmersive(): void {
    seam()?.setImmersive?.(false, { fullscreen: true });
}
