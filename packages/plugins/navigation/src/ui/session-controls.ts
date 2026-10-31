/*!
 * @geoleaf-plugins/navigation — What a driver can do during a session
 *
 * Stop the guidance, leave a stop, and be told what the banner cannot say.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { NavState, RouteFailure } from "@geoleaf-plugins/routing";

/**
 * ## 🛑 Why this file exists
 *
 * A session took over the screen, hid the application's chrome, and offered no way out: nothing
 * in the interface called `stop()`, so someone who had arrived stayed under a banner reading
 * "0 m" until they reloaded the page. A held stop had no way forward either. And a recomputation
 * refused by the engine reached no one: the reason was emitted on every sample, its sentences
 * were in the dictionaries, and nothing read them.
 *
 * ## Why the status line stays silent while everything is well
 *
 * It only speaks when the banner would mislead: a banner counting down to a manoeuvre of a route
 * the driver has left says nothing about whether a new one is coming.
 */

/** The strings the controls render, resolved in the interface language by the caller. */
interface ControlLabels {
    /** Ends a session in progress. */
    readonly stop: string;
    /** Ends a session that has arrived. */
    readonly finish: string;
    /** Leaves a stop. */
    readonly continue: string;
    /** Says the destination is reached. */
    readonly arrived: string;
    /** Says an intermediate stop is reached. */
    readonly stopReached: string;
    /** The sentence for a refused recomputation. */
    reroute(reason: RouteFailure): string;
}

/** What the buttons do. */
interface ControlActions {
    /** Ends the session. */
    onStop(): void;
    /** Leaves the stop being held. */
    onContinue(): void;
}

/** The controls, for the caller to place. */
export interface SessionControls {
    /** The element, for the caller to place: like the banner, it does not place itself. */
    readonly element: HTMLElement;
    /** Redraws for a state. Cheap enough to call on every fix. */
    update(state: NavState, failure: RouteFailure | undefined): void;
    /** Removes the element. Idempotent. */
    destroy(): void;
}

/**
 * Builds one of the two buttons.
 *
 * @param className Its modifier class.
 * @param onClick What it does.
 * @returns The button.
 */
function makeButton(className: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `gl-nav-controls__button ${className}`;
    b.addEventListener("click", onClick);
    return b;
}

/**
 * Creates the session's controls.
 *
 * @param labels The strings, resolved by the caller. This module holds none.
 * @param actions What the buttons do.
 * @returns The controls.
 */
export function createSessionControls(
    labels: ControlLabels,
    actions: ControlActions
): SessionControls {
    const root = document.createElement("div");
    root.className = "gl-nav-controls";

    const status = document.createElement("p");
    status.className = "gl-nav-controls__status";
    // Polite, like the banner: it must reach a screen reader without interrupting a manoeuvre.
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const resume = makeButton("gl-nav-controls__continue", actions.onContinue);
    resume.textContent = labels.continue;
    resume.hidden = true;

    const stop = makeButton("gl-nav-controls__stop", actions.onStop);
    stop.textContent = labels.stop;

    root.append(status, resume, stop);

    return {
        element: root,

        update(state, failure) {
            resume.hidden = state !== "waypoint-reached";
            stop.textContent = state === "arrived" ? labels.finish : labels.stop;

            // ⚠️ The failure speaks only while off route: the reason outlives a return to the
            // line, and a warning under a guidance that works again would be false.
            let text = "";
            if (state === "arrived") text = labels.arrived;
            else if (state === "waypoint-reached") text = labels.stopReached;
            else if (state === "rerouting" && failure) text = labels.reroute(failure);
            if (status.textContent !== text) status.textContent = text;
        },

        destroy() {
            root.remove();
        },
    };
}
