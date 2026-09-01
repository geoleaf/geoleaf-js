/*!
 * @geoleaf-plugins/routing — Step list rendering
 *
 * Builds the list of waypoints a user reorders, removes from, and reads distances off. Pure DOM:
 * it takes state and callbacks, and holds none of its own.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { Waypoint, RouteResult } from "../model.js";
import { roleAt } from "../composition.js";
import { legSummaries } from "../legs.js";

/**
 * ## Why reordering has BUTTONS and not only a drag
 *
 * A list that can only be reordered by dragging cannot be reordered by anyone using a keyboard,
 * a switch, or a screen reader. This repository runs axe scans in its end-to-end suite, and it
 * would fail them — rightly. The two move buttons are the primary mechanism; the pointer drag is
 * added on top for people who prefer it.
 *
 * ⚠️ The roadmap said to reuse `wireTouchDrag` from `host-runtime` for this. It cannot be:
 * that helper repositions a floating MENU within the map container by writing CSS custom
 * properties. Wiring it here would produce a panel that moves when the user tries to move a step.
 *
 * ## Why the number and the role are read from the position at render time
 *
 * Same reason as in `composition.ts`, and this is the place it would show: a stored number
 * survives a reorder and the list renders "1, 2, 2, 4" with nothing to explain it.
 */

/** What the list needs to render itself, and what it calls back into. */
export interface StepListProps {
    /** The itinerary, in travel order. */
    readonly waypoints: readonly Waypoint[];
    /** The computed route, when there is one — carries the per-leg distances. */
    readonly route: RouteResult | null;
    /** Labels, resolved by the caller. This module holds no strings. */
    readonly labels: StepListLabels;
    /** Asked to move a step. */
    onMove(from: number, to: number): void;
    /** Asked to remove a step. */
    onRemove(index: number): void;
}

/** The strings the list renders, resolved in the interface language by the caller. */
export interface StepListLabels {
    readonly origin: string;
    readonly via: string;
    readonly destination: string;
    readonly moveUp: string;
    readonly moveDown: string;
    readonly remove: string;
    readonly empty: string;
    /** Formats a leg, e.g. `(d, s) => "12,3 km · 18 min"`. */
    leg(distanceMetres: number, durationSeconds: number): string;
}

/**
 * Renders the step list into a fresh element.
 *
 * @param props State and callbacks.
 * @returns The list element, ready to be attached.
 */
export function renderStepList(props: StepListProps): HTMLElement {
    const list = document.createElement("ol");
    list.className = "gl-routing-steps";
    // ⚠️ `role="list"` on an element that already IS one, and it is not redundant here: the
    // stylesheet sets `list-style: none` on this list, and WebKit drops list semantics from a
    // list whose computed `list-style-type` is `none` — the one case where restating the native
    // role is the accepted remedy rather than noise. Without it the rows stop being announced
    // as "1 of 3", which is the very thing the next comment relies on.
    list.setAttribute("role", "list");
    // The numbers are the list's own; a screen reader announces them without the markup
    // repeating them, which is why no number is written into the text. ⚠️ What is DRAWN is a
    // CSS counter, not the `<ol>` marker — see the stylesheet, which says why.
    list.setAttribute("aria-label", props.labels.origin);

    if (props.waypoints.length === 0) {
        const empty = document.createElement("li");
        empty.className = "gl-routing-steps__empty";
        empty.textContent = props.labels.empty;
        list.append(empty);
        return list;
    }

    const legs = props.route ? legSummaries(props.route) : [];

    props.waypoints.forEach((wp, i) => {
        const role = roleAt(i, props.waypoints.length);
        const item = document.createElement("li");
        item.className = `gl-routing-steps__item gl-routing-steps__item--${role}`;
        item.dataset["index"] = String(i);
        item.draggable = true;

        const roleLabel = document.createElement("span");
        roleLabel.className = "gl-routing-steps__role";
        roleLabel.textContent = props.labels[role];
        item.append(roleLabel);

        const name = document.createElement("span");
        name.className = "gl-routing-steps__name";
        // `textContent`, never `innerHTML`: the name comes from a feature property, which comes
        // from a profile, which comes from data nobody in this package controls.
        name.textContent = wp.name ?? formatCoordinates(wp);
        item.append(name);

        // The leg ARRIVING at this step — so the figure sits beside the point it describes,
        // which is what "distance since the previous point" means to a reader.
        const arriving = legs[i - 1];
        if (arriving) {
            const leg = document.createElement("span");
            leg.className = "gl-routing-steps__leg";
            leg.textContent = props.labels.leg(arriving.distance, arriving.duration);
            item.append(leg);
        }

        // The three controls in ONE cluster, and that is a layout decision the stylesheet
        // cannot take back: a row whose name wraps over two or three lines must keep its
        // buttons beside the whole row, not interleaved with the lines of it.
        const controls = document.createElement("span");
        controls.className = "gl-routing-steps__controls";
        controls.append(
            moveButton(props.labels.moveUp, "\u2191", i > 0, () => props.onMove(i, i - 1)),
            moveButton(props.labels.moveDown, "\u2193", i < props.waypoints.length - 1, () =>
                props.onMove(i, i + 1)
            ),
            removeButton(props.labels.remove, () => props.onRemove(i))
        );
        item.append(controls);

        list.append(item);
    });

    wirePointerDrag(list, props.onMove);
    return list;
}

/**
 * One move button.
 *
 * @param label Accessible name.
 * @param glyph What is DRAWN — see the note in the body.
 * @param enabled Whether the move is possible from this position.
 * @param onClick What to do.
 * @returns The button.
 */
function moveButton(
    label: string,
    glyph: string,
    enabled: boolean,
    onClick: () => void
): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gl-routing-steps__move";
    // ⚠️ `disabled` rather than hidden: a button that disappears at the ends makes the control
    // count change per row, and a keyboard user loses their place in the tab order.
    b.disabled = !enabled;
    b.setAttribute("aria-label", label);
    // 🛑 The sentence is the ACCESSIBLE NAME and the glyph is the drawing — they are two
    // different jobs, and writing the sentence into both was the bug. `aria-label` overrides
    // the text content for the accessible name, so a screen reader still hears "Monter cette
    // étape"; what changes is that the panel no longer prints three sentences on every row of
    // a 320 px column, which pushed the stop's own name out of view. Same trade the header's
    // "×" already makes, and text rather than an inline SVG for the same reason: an arrow
    // needs neither a sanitiser nor a sprite.
    b.textContent = glyph;
    b.addEventListener("click", onClick);
    return b;
}

/**
 * One remove button.
 *
 * @param label Accessible name.
 * @param onClick What to do.
 * @returns The button.
 */
function removeButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gl-routing-steps__remove";
    b.setAttribute("aria-label", label);
    // The glyph, not the sentence — see {@link moveButton}.
    b.textContent = "\u00d7";
    b.addEventListener("click", onClick);
    return b;
}

/**
 * Adds pointer drag-and-drop on top of the buttons.
 *
 * @param list The list element.
 * @param onMove Called with the source and target positions.
 */
function wirePointerDrag(list: HTMLElement, onMove: (from: number, to: number) => void): void {
    let from = -1;

    list.addEventListener("dragstart", (e) => {
        const item = (e.target as HTMLElement)?.closest?.("li");
        from = item ? Number(item.dataset["index"]) : -1;
    });

    // Without this, the browser refuses the drop and the gesture ends with nothing happening —
    // the single most common way a drag-and-drop list is shipped broken.
    list.addEventListener("dragover", (e) => e.preventDefault());

    list.addEventListener("drop", (e) => {
        e.preventDefault();
        const item = (e.target as HTMLElement)?.closest?.("li");
        const to = item ? Number(item.dataset["index"]) : -1;
        if (from >= 0 && to >= 0 && from !== to) onMove(from, to);
        from = -1;
    });
}

/**
 * A waypoint with no name, told by its coordinates.
 *
 * ⚠️ Four decimals — about 11 m. Showing the full precision would put fifteen digits in a list
 * row, and showing fewer would make two nearby stops read as the same place.
 *
 * @param wp The waypoint.
 * @returns The text.
 */
function formatCoordinates(wp: Waypoint): string {
    return `${wp.coordinates[1].toFixed(4)}, ${wp.coordinates[0].toFixed(4)}`;
}
