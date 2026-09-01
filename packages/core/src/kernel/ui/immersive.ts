/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Immersive UI mode — the seam that lets something outside the kernel strip the application
 * chrome without the kernel naming it.
 *
 * ## Why this is a kernel concern and not the caller's
 *
 * The repository already had four `<body>`-class UI modes (`gl-right-panel-open`,
 * `gl-poi-sidepanel-open`, `gl-table-open`, `gl-print-modal-open`), each owned by whoever set
 * it, each reaching into selectors belonging to someone else. That works, and it makes the
 * hiding invisible from the side being hidden: the `theme-selector` capability cannot know it
 * is hidden, cannot test it, and cannot say so. Naming the mode here makes it typed, gated and
 * reusable — and it keeps the rule `no-plugin-in-core` intact, because nothing below knows
 * which caller asked.
 *
 * ## 🛑 Why fullscreen targets `documentElement` and not `.gl-main`
 *
 * The obvious target is the one the toolbar button already uses — `.gl-main`. It is wrong for
 * this mode, and the reason is not cosmetic: **an element outside the fullscreen subtree is
 * not mispositioned, it is not rendered at all**. The notification container is appended to
 * `document.body`, and so are the feature-info side panel, the routing itinerary panel, the
 * share modal and the PWA banners. Going fullscreen on `.gl-main` would therefore switch the
 * toasts off — at the exact moment a guidance session starts reporting lost GPS and failed
 * recomputations. `documentElement` renders the whole document: nothing disappears.
 *
 * The toolbar button keeps `.gl-main` on purpose. It is a different gesture — "let the map
 * fill the screen" — and rewiring a control people already use is not this module's business.
 *
 * ## 🛑 Why ownership of the fullscreen state is tracked
 *
 * Two callers can now ask for fullscreen: this module and the toolbar button. A user who
 * entered fullscreen themselves, then started a session, must not be thrown out of it when the
 * session ends. So exiting is conditional on having entered — and a user pressing Escape
 * releases the claim without ending anything, because the mode and the fullscreen state are
 * deliberately two different facts.
 */

import { registerLifecycleTeardown } from "../shared/lifecycle.js";

/** The class that marks the document as immersive. Consumed by `css/geoleaf-ui-base.css`. */
const IMMERSIVE_CLASS = "gl-immersive";

/**
 * Whether THIS module put the document into fullscreen.
 *
 * ⚠️ Not derivable from the DOM: `document.fullscreenElement` says the page IS fullscreen, never
 * who asked. Exiting on that alone would eject a user who entered it themselves.
 */
let ownsFullscreen = false;

/** Whether the `fullscreenchange` listener is attached. Attaching twice would fire twice. */
let listening = false;

/**
 * Releases the fullscreen claim when the page leaves fullscreen by any route.
 *
 * ⚠️ It does NOT clear the immersive class. Pressing Escape leaves fullscreen; it does not end
 * whatever asked for the mode, and stripping the chrome back in mid-session would be a second
 * surprise on top of the first.
 */
function onFullscreenChange(): void {
    if (!document.fullscreenElement) ownsFullscreen = false;
}

/**
 * Attaches the `fullscreenchange` listener once, and registers its removal.
 *
 * ⚠️ The handler is NAMED rather than an arrow written in place, and that is the whole point:
 * an anonymous closure cannot be passed to `removeEventListener`, so it accumulates one live
 * listener per destroy→recreate cycle over a `domState` nobody can reach any more.
 */
function ensureListening(): void {
    if (listening || typeof document === "undefined") return;
    document.addEventListener("fullscreenchange", onFullscreenChange);
    listening = true;
}

/** Detaches the listener and forgets the claim. Registered as a lifecycle teardown. */
function releaseImmersive(): void {
    if (listening && typeof document !== "undefined") {
        document.removeEventListener("fullscreenchange", onFullscreenChange);
    }
    listening = false;
    ownsFullscreen = false;
}
registerLifecycleTeardown(releaseImmersive);

/**
 * Asks the browser for fullscreen on the whole document, and records the claim.
 *
 * ⚠️ Every member is probed before use. `requestFullscreen` is absent from jsdom and refused by
 * some embedded browsers; a mode that threw there would fail on the setups where the rest of it
 * works perfectly well.
 */
function enterFullscreen(): void {
    const root = document.documentElement as HTMLElement | null;
    if (!root || typeof root.requestFullscreen !== "function") return;
    if (document.fullscreenElement) {
        // 🛑 The claim is DROPPED here, not left as it was. Someone else — the toolbar button,
        // or the user's own keyboard — is already holding fullscreen, so this module did not
        // enter it and must not be the one to leave it. An early return that kept a stale claim
        // from an earlier session would eject a user from a fullscreen they chose themselves,
        // and the symptom would arrive one session later than the cause.
        ownsFullscreen = false;
        return;
    }
    ownsFullscreen = true;
    void Promise.resolve(root.requestFullscreen()).catch(() => {
        // Refused — no transient user activation left, or the browser says no. The immersive
        // mode itself has already been applied, so there is nothing to roll back but the claim.
        ownsFullscreen = false;
    });
}

/** Leaves fullscreen, but only when this module is the one that entered it. */
function leaveFullscreen(): void {
    if (!ownsFullscreen) return;
    ownsFullscreen = false;
    if (typeof document.exitFullscreen !== "function" || !document.fullscreenElement) return;
    void Promise.resolve(document.exitFullscreen()).catch(() => {
        // Already out, or the exit was refused. Nothing depends on the outcome.
    });
}

/**
 * Turns the immersive UI mode on or off.
 *
 * The mode strips the chrome the kernel owns — theme bars, filter entry point, right panel,
 * proximity bar — so a caller that needs the whole surface for one task can have it without
 * knowing which controls exist.
 *
 * @param on Whether the document should be immersive.
 * @param options `fullscreen` also asks the browser for fullscreen — best-effort, a refusal
 *                never propagates, because a caller that entered immersive mode has still
 *                entered it. See the note on ownership: an `exitFullscreen` only happens when
 *                this module was the one that entered.
 *
 * ⚠️ The shape is inlined rather than a named exported interface: nothing outside needed to
 *    name it, and an exported type nobody imports is indistinguishable from one left behind
 *    after a deletion.
 */
export function setImmersive(on: boolean, options: { fullscreen?: boolean } = {}): void {
    if (typeof document === "undefined" || !document.body) return;
    document.body.classList.toggle(IMMERSIVE_CLASS, on);
    if (!options.fullscreen) return;
    if (on) {
        ensureListening();
        enterFullscreen();
    } else {
        leaveFullscreen();
    }
}

/**
 * Whether the document is currently in immersive mode.
 *
 * Read back from the DOM rather than from a variable: the class IS the state, so the answer
 * cannot drift from what the user sees.
 *
 * @returns `true` while the immersive class is set.
 */
export function isImmersive(): boolean {
    if (typeof document === "undefined" || !document.body) return false;
    return document.body.classList.contains(IMMERSIVE_CLASS);
}
