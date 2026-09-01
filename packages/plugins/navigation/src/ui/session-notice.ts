/*!
 * @geoleaf-plugins/navigation — What a driver is told before the first turn
 *
 * Two sentences, once per session: the road comes first, and the guidance stops if you look away.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getNativeMap } from "@geoleaf/host-runtime";

/**
 * ## 🛑 The second sentence matters more than the first, and it is not legal boilerplate
 *
 * The first is the expected one: the route is a suggestion, the road and its actual conditions
 * are not. Say it, briefly, and move on.
 *
 * The second is the one this notice exists for. **Background geolocation is impossible in a
 * browser** — iOS stops it at lock, Android freezes background tabs — so guidance ends the moment
 * the application stops being what the screen shows. An operator who does not know that puts the
 * phone in a pocket and finds out **while driving**, at the exact moment they cannot respond to
 * it. The limit is written in the plugin's specification sheet; it was said to the **user**
 * nowhere.
 *
 * ## Why it does NOT block guidance
 *
 * The obvious build gates `start()` on an acknowledgement. It is wrong: the position watch would
 * open only after a tap, so the first fix — the one that places the driver on the route — would be
 * the one nobody waited for. The engine runs behind the notice. What the acknowledgement dismisses
 * is the notice, not the guidance.
 *
 * ## Why once per SESSION and not once per page
 *
 * The specification says every session, and the reason survives the repetition: the background
 * limit is exactly the kind of fact someone reads once, agrees with, and has forgotten by the
 * third journey. A notice shown once per install is a notice shown to whoever installed it.
 */

/** A live notice. */
export interface SessionNotice {
    /** Removes it. Idempotent. */
    remove(): void;
}

/** The two sentences and the button, resolved in the interface language by the caller. */
export interface NoticeLabels {
    /** The road comes first. */
    readonly road: string;
    /** Guidance stops when the application is not in front. */
    readonly background: string;
    /** The acknowledgement. */
    readonly dismiss: string;
}

/** The map surface this needs. */
interface ContainerCapableMap {
    getContainer(): HTMLElement;
}

/** The one notice a page may show. */
let mounted: HTMLElement | null = null;

/**
 * Shows the start-of-session notice.
 *
 * @param labels The two sentences and the button.
 * @returns The live notice. Safe when no map is available — the guidance still runs, and it is the
 *          notice that is lost rather than the session.
 */
export function showSessionNotice(labels: NoticeLabels): SessionNotice {
    removeSessionNotice();

    const container = getNativeMap<ContainerCapableMap>()?.getContainer?.();
    if (!container) return { remove: removeSessionNotice };

    const el = document.createElement("section");
    el.className = "gl-nav-notice";
    // `alertdialog` would trap focus and demand an answer before anything else happens — which is
    // the behaviour this notice deliberately does not have. `region` with a label announces it to
    // a screen reader in document order, and leaves the map usable behind it.
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", labels.road);

    el.append(line("gl-nav-notice__road", labels.road));
    el.append(line("gl-nav-notice__background", labels.background));

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "gl-nav-notice__dismiss";
    ok.textContent = labels.dismiss;
    ok.addEventListener("click", removeSessionNotice);
    el.append(ok);

    container.append(el);
    mounted = el;
    return { remove: removeSessionNotice };
}

/**
 * Removes the notice, if one is shown.
 *
 * Called when the session ends as well as by the button: a notice outliving the guidance it
 * introduces tells a driver about a session that is over.
 */
export function removeSessionNotice(): void {
    mounted?.remove();
    mounted = null;
}

/**
 * One sentence of the notice.
 *
 * @param className Its class.
 * @param text The sentence. Written with `textContent` — it comes from a translation file, which
 *             an integrator may replace with their own.
 * @returns The paragraph.
 */
function line(className: string, text: string): HTMLParagraphElement {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    return p;
}
