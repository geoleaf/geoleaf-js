/*!
 * @geoleaf-plugins/navigation — Manoeuvre banner
 *
 * The one thing a driver looks at: what to do next, and in how far.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { RouteStep } from "@geoleaf-plugins/routing";

/**
 * ## 🛑 Why nothing here is ever escaped — and why that is STRONGER, not weaker
 *
 * The roadmap says provider labels are untrusted content and must pass through the core's
 * security helpers. `GeoLeaf.Security.escapeHtml` does exist and is mounted — measured, not
 * assumed. But escaping exists to make a string safe **inside markup**, and this module
 * produces no markup at all: every provider-sourced string is written with `textContent`.
 *
 * A string assigned to `textContent` cannot become an element, an attribute or a handler,
 * whatever it contains. That is a property of the assignment, not of a call someone has to
 * remember to make — and the seam's own documentation states it: *writing user-controlled
 * strings must use `textContent`*. A test below pins that no `innerHTML` appears here.
 *
 * ## Why the phrase is composed LOCALLY rather than taken from the provider
 *
 * `RouteStep.instruction` is optional, and its absence is not an edge case: the public OSRM
 * instance emits **no narrative at all** — measured on the captured corpus in sprint 1. A
 * banner built on it would be blank for every user of that engine.
 *
 * ⚠️ And when a provider DOES give a sentence, it is in the language the provider was asked
 * for, which is not necessarily the interface language. Rendering it would make the banner
 * switch languages depending on which engine answered — a difference the user cannot explain
 * and did not choose. The manoeuvre and the modifier are a small closed vocabulary; composing
 * from them gives one voice on every engine. The road name still comes from the provider, as
 * data, on its own line.
 */

/** The strings the banner renders, resolved in the interface language by the caller. */
export interface BannerLabels {
    /** Names a manoeuvre, e.g. `("turn", "left") => "Tournez à gauche"`. */
    maneuver(maneuver: string, modifier: string | undefined): string;
    /** Formats a distance, e.g. `(400) => "400 m"`. */
    distance(metres: number): string;
}

/** What the banner shows. */
export interface BannerState {
    /** The step being approached, or `null` when there is nothing to announce. */
    readonly step: RouteStep | null;
    /** Distance to that manoeuvre, in METRES. Decrements as the user approaches. */
    readonly distanceMetres: number;
}

/** A banner attached to the page. */
export interface ManeuverBanner {
    /** The element, for the caller to place. */
    readonly element: HTMLElement;
    /** Redraws with a new state. Cheap enough to call on every fix. */
    update(state: BannerState): void;
    /** Removes the element and drops its references. Idempotent. */
    destroy(): void;
}

/**
 * A CSS-safe token for a manoeuvre or modifier.
 *
 * ⚠️ OSRM modifiers contain spaces — `"slight left"`, `"sharp right"` — and a space in a class
 * name silently creates a SECOND class. `gl-nav-banner__icon--slight left` would apply
 * `--slight` and `left`, one of which does not exist and the other of which might. Normalising
 * is not cosmetic here.
 *
 * @param value The raw provider token.
 * @returns Lower-case, non-alphanumerics collapsed to `-`, or `unknown` when empty.
 */
export function cssToken(value: string | undefined): string {
    const t = (value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    return t || "unknown";
}

/**
 * Creates a manoeuvre banner.
 *
 * @param labels The strings, resolved by the caller. This module holds none.
 * @returns The banner.
 */
export function createManeuverBanner(labels: BannerLabels): ManeuverBanner {
    const element = document.createElement("div");
    element.className = "gl-nav-banner";
    // A live region: the next manoeuvre must reach a screen-reader user without them having to
    // go looking for it, and `polite` rather than `assertive` so it does not interrupt.
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    element.hidden = true;

    const icon = document.createElement("span");
    icon.className = "gl-nav-banner__icon";
    // Decorative: the manoeuvre is already stated in words below it, and announcing the
    // pictogram as well would read the same instruction twice.
    icon.setAttribute("aria-hidden", "true");

    const distance = document.createElement("span");
    distance.className = "gl-nav-banner__distance";

    const maneuver = document.createElement("span");
    maneuver.className = "gl-nav-banner__maneuver";

    const road = document.createElement("span");
    road.className = "gl-nav-banner__road";

    element.append(icon, distance, maneuver, road);

    return {
        element,

        update(state: BannerState): void {
            if (!state.step) {
                element.hidden = true;
                return;
            }
            element.hidden = false;

            const step = state.step;
            icon.className =
                `gl-nav-banner__icon gl-nav-banner__icon--${cssToken(step.maneuver)}` +
                (step.modifier ? ` gl-nav-banner__icon--${cssToken(step.modifier)}` : "");

            // `textContent` on all four, including the two the provider supplies. See the note
            // at the top: this is what makes escaping unnecessary rather than forgotten.
            distance.textContent = labels.distance(state.distanceMetres);
            maneuver.textContent = labels.maneuver(step.maneuver, step.modifier);
            road.textContent = step.name;
        },

        destroy(): void {
            element.remove();
            element.replaceChildren();
        },
    };
}
