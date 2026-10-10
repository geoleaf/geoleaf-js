/*!
 * GeoLeaf Offline UI — « a new version is ready »
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The banner that asks before the application changes under its user.
 *
 * ## Why this module exists
 *
 * The core's service worker no longer takes a page that is in use: a new version installs,
 * then WAITS, and the core says so — `geoleaf:sw:update-waiting`,
 * `GeoLeaf.PWA.isUpdateWaiting()`. It asks nothing itself: it has no interface for it, and a
 * worker that waits with nobody asking waits for every tab to be closed. This is where the
 * question is put, and `GeoLeaf.PWA.applyUpdate()` is the answer — the page reloads on it.
 *
 * ## Why here
 *
 * The person an unannounced update hurts is the one this plugin serves: in the field, a
 * capture half-filled, perhaps offline. Their answer may well be « later », and it is
 * respected — the banner leaves, the update keeps waiting, and the next visit asks again.
 *
 * ## What this module does NOT do
 *
 * It decides nothing and reloads nothing: the core holds the worker's state and makes the
 * reload. A host that embeds no offline plugin hears the same event and calls the same
 * method from its own interface.
 */

import { tLabel as t } from "@geoleaf/host-runtime";
import { createElement } from "../utils/dom-helpers.js";

/** The core's update gesture. Read at CALL time; absent on a core that does not wait. */
interface PwaUpdateSeam {
    isUpdateWaiting?(): boolean;
    applyUpdate?(): boolean;
}

/** The banner's id — one per page, whatever the number of boots. */
const BANNER_ID = "gl-sw-update-banner";

/** The attached listeners, so they can be removed. */
let _detach: Array<() => void> = [];

/** The answer was « later »: asked again by another update, or by another visit. */
let _dismissed = false;

function _pwa(): PwaUpdateSeam | undefined {
    return (globalThis as { GeoLeaf?: { PWA?: PwaUpdateSeam } }).GeoLeaf?.PWA;
}

function _isWaiting(): boolean {
    return _pwa()?.isUpdateWaiting?.() === true;
}

/**
 * Takes the banner out of the page — at the application's unmount, and when it has no
 * object left. The listeners stay: they are the plugin's, for the life of the page.
 *
 * @example
 * registerPluginModule({ id: "offline-ui", destroy: removeSwUpdateBanner });
 */
export function removeSwUpdateBanner(): void {
    document.getElementById(BANNER_ID)?.remove();
}

function _apply(button: HTMLButtonElement): void {
    if (button.disabled) return;
    if (_pwa()?.applyUpdate?.() === true) {
        // The page reloads once the new worker holds it: the gesture is taken, not repeated.
        button.disabled = true;
        return;
    }
    // Nothing was waiting any more: a button that does nothing is not left on screen.
    removeSwUpdateBanner();
}

function _show(): void {
    if (typeof document === "undefined" || document.getElementById(BANNER_ID)) return;

    const root = createElement("div", "gl-sw-update");
    root.id = BANNER_ID;
    // `status`, not `alert`: said by a screen reader when it has finished, and the focus
    // stays where the user is typing.
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");

    const text = createElement("span", "gl-sw-update__text", root);
    text.textContent = t("storage.update.message");

    const apply = createElement("button", "gl-sw-update__btn gl-sw-update__btn--apply", root);
    apply.type = "button";
    apply.dataset["glAction"] = "sw-update-apply";
    apply.textContent = t("storage.update.reload");
    apply.addEventListener("click", () => _apply(apply));

    const later = createElement("button", "gl-sw-update__btn", root);
    later.type = "button";
    later.dataset["glAction"] = "sw-update-later";
    later.textContent = t("storage.update.later");
    later.addEventListener("click", () => {
        _dismissed = true;
        removeSwUpdateBanner();
    });

    document.body.appendChild(root);
}

/**
 * Wires the banner on the core's signals. Idempotent: a second call replaces the first —
 * its listeners, and the « later » it had been answered.
 *
 * ⚠️ Wired at entry import, like the engine's signals: the core registers its worker at
 * idle, seconds after the boot, and announces a waiting update from there — a listener set
 * when a panel opens would have missed it.
 *
 * @example
 * wireSwUpdateBanner();
 */
export function wireSwUpdateBanner(): void {
    _unwire();
    if (typeof document === "undefined") return;

    // A NEW worker waits: asked again, whatever was answered to the previous one.
    const onWaiting = () => {
        _dismissed = false;
        _show();
    };
    // The event is said once per worker. An application mounted again on the same page
    // hears nothing: the state is read at each boot.
    const onBoot = () => {
        if (!_dismissed && _isWaiting()) _show();
    };
    // The worker activated. Either this page reloads (the gesture was made here), or it was
    // never held and the wait is over — or the gesture came from another tab, and the core
    // still answers `true`: this page is owed its reload.
    const onActivated = () => {
        if (!_isWaiting()) removeSwUpdateBanner();
    };

    document.addEventListener("geoleaf:sw:update-waiting", onWaiting);
    document.addEventListener("geoleaf:app:ready", onBoot);
    document.addEventListener("geoleaf:sw:updated", onActivated);
    _detach = [
        () => document.removeEventListener("geoleaf:sw:update-waiting", onWaiting),
        () => document.removeEventListener("geoleaf:app:ready", onBoot),
        () => document.removeEventListener("geoleaf:sw:updated", onActivated),
    ];
}

/**
 * Removes the listeners of a previous wiring, and the banner with them.
 *
 * ⚠️ Not exported: the plugin wires once at load and keeps its listeners for the life of the
 * page — its teardown removes the banner, not them ({@link removeSwUpdateBanner}). This only
 * makes {@link wireSwUpdateBanner} idempotent.
 */
function _unwire(): void {
    for (const off of _detach) off();
    _detach = [];
    _dismissed = false;
    if (typeof document !== "undefined") removeSwUpdateBanner();
}
