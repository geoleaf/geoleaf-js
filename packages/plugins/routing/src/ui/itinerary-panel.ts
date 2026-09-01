/*!
 * @geoleaf-plugins/routing — Itinerary panel
 *
 * The surface a user composes an itinerary in. Built on the host runtime's modal shell, which
 * carries the overlay, the ARIA role, the focus trap and the teardown.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { hidePane } from "../ui-seam.js";
import type { RouteResult, Waypoint, RouteFailure } from "../model.js";
import { renderStepList, type StepListLabels } from "./step-list.js";
import { addWaypoint, removeWaypoint, moveWaypoint, isRoutable } from "../composition.js";
import {
    createWaypointInput,
    type WaypointInput,
    type WaypointInputLabels,
} from "./waypoint-input.js";

/**
 * ## Why this is NOT a modal any more
 *
 * It was built on `createModalShell` until 26/08/2026, and the panel was **invisible**: that
 * helper writes `.gl-form-modal-overlay` / `.gl-form-modal-panel`, whose rules live only in
 * `field-renderer`, which this bundle does not embed. The overlay therefore rendered
 * `position: static` at the end of `<body>`, below a `.gl-page` that is `100vh` tall — off
 * screen, and with no error anywhere. `editor` escaped the same call only because it happens
 * to embed field-renderer.
 *
 * 🛑 **The repair is not to copy those rules here.** An itinerary is composed ALONGSIDE the
 * map — one watches the route while editing the stops — so a modal was the wrong shape to
 * begin with. The panel is now a plain region the kernel ADOPTS into whichever host is live:
 * the desktop side panel above 1440px, the mobile sheet below it. Same gesture as the legend
 * and the layer manager, and the reason it carries no overlay, no `aria-modal` and no focus
 * trap: a tab panel beside the map traps nothing.
 * * ## Why a message AREA and not an alert
 *
 * Every refusal this plugin can produce — a cap reached, an engine that timed out, a quota, a
 * layer the profile does not declare — has a different sentence and a different next step. A
 * single `alert()` would interrupt for all of them equally, and none of them is worth stealing
 * focus for. The area is `aria-live`, so a screen reader hears the change without being torn out
 * of the list.
 */

/**
 * Everything the panel can refuse to do, or be told about.
 *
 * ⚠️ The three `origin-*` reasons are NOT foldable into the engine's five. A denied permission is
 * not a routing failure — it is an answer the user gave, and telling them "no route between these
 * points" would be false about the map AND about what they did. Each of the eight has one right
 * sentence and one right next step; that is the whole reason the type is a union and not a flag.
 */
export type PanelRefusal =
    | RouteFailure
    | "cap-reached"
    | "no-layer"
    | "origin-denied"
    | "origin-no-fix"
    | "origin-unavailable";

/** Everything the panel renders, resolved in the interface language by the caller. */
export interface PanelLabels extends StepListLabels {
    readonly title: string;
    readonly close: string;
    readonly useMyPosition: string;
    readonly clear: string;
    readonly compute: string;
    /** Opens turn-by-turn guidance on the computed route. */
    readonly startGuidance: string;
    /** Formats the whole-route summary. */
    total(distanceMetres: number, durationSeconds: number): string;
    /** The sentence for one refusal — the caller owns the wording, this module owns the timing. */
    failure(reason: PanelRefusal): string;
    /**
     * Every string the "add a stop" field renders.
     *
     * 🛑 Required, not optional. An optional block here would let a caller mount the panel with
     * no way to add a stop and see nothing wrong — which is exactly the state this package was
     * in before the field existed, and it went unnoticed for a sprint.
     */
    readonly input: WaypointInputLabels;
}

/** What the panel calls back into. */
export interface PanelHandlers {
    /**
     * Asked to start guidance on the computed route.
     *
     * 🛑 **Optional, and its absence IS the guard.** `navigation` is registered lazily, so
     * `isLoaded()` answers `false` until something loads it — a button gated on that would
     * hide the only thing that would ever load it. The controller decides availability once,
     * with `isLazyAvailable()`, and simply does not supply this handler when the plugin is
     * absent. No button is then created at all, which is stronger than one that is hidden.
     */
    onStartGuidance?(): void;

    /** Asked to compute the itinerary currently composed. */
    onCompute(waypoints: readonly Waypoint[]): void;
    /**
     * Asked to use the user's position as the origin.
     *
     * ⚠️ A handler and not something the panel does itself: reading the position is the core's
     * business, and a panel that reached for `navigator.geolocation` would open a second watch
     * beside the one the core already holds.
     */
    onUseMyPosition(): void;
    /** The itinerary changed — the host republishes and may recompute. */
    onChange(waypoints: readonly Waypoint[]): void;
    /**
     * The user asked to pick the next stop on the map.
     *
     * The panel does not do it itself: entering the mode means attaching a handler to the native
     * map, and the controller is what already owns that lifetime — it can end the mode when the
     * panel closes, which the panel cannot do for itself after it is gone.
     */
    onPickOnMap(): void;
    /** The panel was dismissed. */
    onClose?(): void;
}

/** A live panel. */
export interface ItineraryPanel {
    /** Replaces the itinerary and redraws. */
    setWaypoints(waypoints: readonly Waypoint[]): void;
    /** Appends a waypoint, honouring the cap; shows the refusal when there is one. */
    addWaypoint(waypoint: Waypoint): void;
    /** Attaches a computed route, so the list can show per-leg figures. */
    setRoute(route: RouteResult | null): void;
    /** Shows a refusal in the message area. */
    showFailure(reason: PanelRefusal): void;
    /** Reflects whether the map is waiting for a click. */
    setPicking(picking: boolean): void;
    /**
     * Reflects whether a computation is in flight.
     *
     * ⚠️ The panel does not decide this: the controller owns the request, and a button that
     * disarmed itself on click would also disarm on a cache hit — which costs nothing and should
     * feel instant.
     */
    setComputing(busy: boolean): void;
    /**
     * Asks the host to hide the panel. The DOM survives, and so does the itinerary.
     *
     * 🛑 NOT a teardown, and the distinction is the whole point of the move off the modal: a
     * user who collapses the tab has not asked to lose the stops they entered. Use
     * {@link ItineraryPanel.destroy} to actually take it down.
     */
    close(): void;
    /** Detaches the panel for good. Idempotent. */
    destroy(): void;
}

/** The panel's root element and the region content is written into. */
interface PanelShell {
    /** The adoptable root — what a host moves into itself. */
    readonly root: HTMLElement;
    /** Where the itinerary itself is rendered. */
    readonly body: HTMLElement;
    /** Asks the live host to hide it. The DOM stays. */
    close(): void;
    /** Detaches the root for good. */
    remove(): void;
}

/** `id` of the heading, so the region can point at its own name. */
const TITLE_ID = "gl-routing-panel-title";

/**
 * Builds the adoptable panel: a named region with a header and a body.
 *
 * ⚠️ Mounted on `document.body` and hidden by its own stylesheet, exactly like the legend and
 * the layer manager. It is the host that reveals it — which is why the CSS carries
 * `.gl-routing-panel { display: none }` with **no media query**: a control visible on its own
 * would float over the map at every width no host claims it.
 *
 * 🛑 `close()` does NOT remove the node, and that is the difference with the modal it
 * replaces. The itinerary a user composed survives closing the panel — losing a start point
 * because the panel was collapsed is the same class of defect as the POI button overwriting
 * it. `remove()` exists for teardown, and nothing else calls it.
 *
 * @param title - The panel heading, already in the interface language.
 * @param closeLabel - Accessible name of the header's close control.
 * @param onClose - Called when the user dismisses the panel.
 * @returns The shell.
 */
function createPanelShell(title: string, closeLabel: string, onClose: () => void): PanelShell {
    const root = document.createElement("div");
    root.className = "gl-routing-panel";
    // `region`, not `dialog`: it sits beside the map rather than over it, and announcing a
    // dialog would promise a modality that is not there.
    root.setAttribute("role", "region");
    root.setAttribute("aria-labelledby", TITLE_ID);

    const wrapper = document.createElement("div");
    wrapper.className = "gl-routing-panel__wrapper";

    const header = document.createElement("div");
    header.className = "gl-routing-panel__header";

    const heading = document.createElement("h2");
    heading.className = "gl-routing-panel__title";
    heading.id = TITLE_ID;
    heading.textContent = title;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gl-routing-panel__close";
    closeBtn.setAttribute("aria-label", closeLabel);
    // Text and not an inline SVG: the icon would have to be sanitised on the way in, and a
    // multiplication sign needs neither a sanitiser nor a sprite.
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", onClose);

    const body = document.createElement("div");
    body.className = "gl-routing-panel__body";

    header.append(heading, closeBtn);
    wrapper.append(header, body);
    root.append(wrapper);
    document.body.appendChild(root);

    return {
        root,
        body,
        close() {
            hidePane();
        },
        remove() {
            root.remove();
        },
    };
}

/**
 * Opens the itinerary panel.
 *
 * @param labels Every string it renders.
 * @param handlers What it calls back into.
 * @param initial The itinerary to open with — a destination, when it came from a POI.
 * @returns The live panel.
 */
export function openItineraryPanel(
    labels: PanelLabels,
    handlers: PanelHandlers,
    initial: readonly Waypoint[] = []
): ItineraryPanel {
    let waypoints: readonly Waypoint[] = [...initial];
    let route: RouteResult | null = null;
    /** Created only when guidance is available — see `onStartGuidance`. */
    let guideBtn: HTMLButtonElement | null = null;
    let listHost: HTMLElement | null = null;
    let message: HTMLElement | null = null;
    let computeBtn: HTMLButtonElement | null = null;
    let input: WaypointInput | null = null;

    const shell = createPanelShell(labels.title, labels.close, () => api.close());

    {
        const panel = shell.body;

        listHost = document.createElement("div");
        listHost.className = "gl-routing-panel__list";
        panel.append(listHost);

        // 🛑 The field sits BELOW the list and above the actions: a stop is appended to the
        // end, so the control that appends belongs where the end is. Putting it above the
        // list would suggest it inserts at the top, which it does not.
        input = createWaypointInput(labels.input, {
            onAdd: (wp) => api.addWaypoint(wp),
            onPickOnMap: () => handlers.onPickOnMap(),
        });
        panel.append(input.element);

        message = document.createElement("p");
        message.className = "gl-routing-panel__message";
        // Polite, not assertive: a refusal is worth hearing, not worth cutting off whatever
        // the user was being read at that moment.
        message.setAttribute("aria-live", "polite");
        panel.append(message);

        computeBtn = actionButton("gl-routing-panel__compute", labels.compute, () =>
            handlers.onCompute(waypoints)
        );
        guideBtn = makeGuideButton(labels.startGuidance, handlers.onStartGuidance);

        panel.append(computeBtn);
        if (guideBtn) panel.append(guideBtn);
        // ⚠️ No "close" button here any more: the header carries one, and a second at the
        // foot of a tab panel says the panel is dismissable in two different ways. The
        // header copy is the one the host hides when it supplies its own chrome.
        panel.append(
            textButton(
                "gl-routing-panel__my-position",
                labels.useMyPosition,
                handlers.onUseMyPosition
            ),
            textButton("gl-routing-panel__clear", labels.clear, () => {
                set([]);
            })
        );

        draw();
    }

    /**
     * Replaces the itinerary, redraws, and tells the host.
     *
     * @param next The new list.
     */
    function set(next: readonly Waypoint[]): void {
        waypoints = next;
        // A route computed for the previous list describes an itinerary that no longer exists.
        // Keeping it would show per-leg figures beside stops they do not belong to.
        route = null;
        draw();
        handlers.onChange(waypoints);
    }

    /** Rebuilds the list and the derived state around it. */
    function draw(): void {
        if (!listHost) return;
        listHost.replaceChildren(renderList(waypoints, route, labels, set));

        if (computeBtn) computeBtn.disabled = !isRoutable(waypoints);

        // ⚠️ Hidden rather than disabled, unlike the stop-move buttons: those
        // keep their place in the tab order because they RECUR on every row.
        // This one is meaningless while there is no route, and a greyed
        // "Start guidance" button above an empty list invites hunting for
        // what is missing rather than computing.
        if (guideBtn) guideBtn.hidden = route === null;

        if (route && message) {
            message.textContent = labels.total(route.distance, route.duration);
        }
    }

    const api: ItineraryPanel = {
        setWaypoints(next) {
            set([...next]);
        },
        addWaypoint(wp) {
            const r = addWaypoint(waypoints, wp);
            if (r.ok) {
                set(r.waypoints);
                return;
            }
            api.showFailure("cap-reached");
        },
        setRoute(next) {
            route = next;
            draw();
        },
        showFailure(reason) {
            if (message) message.textContent = labels.failure(reason);
        },
        setPicking(picking) {
            input?.setPicking(picking);
        },
        setComputing(busy) {
            if (computeBtn) computeBtn.disabled = busy || !isRoutable(waypoints);
        },
        close() {
            shell.close();
            handlers.onClose?.();
        },
        destroy() {
            shell.remove();
            handlers.onClose?.();
        },
    };

    return api;
}

/**
 * The step list, with its two edit callbacks bound.
 *
 * @param waypoints The itinerary, in travel order.
 * @param route     The computed route, when there is one.
 * @param labels    The strings.
 * @param set       Applies a new list of stops.
 * @returns The list element.
 */
function renderList(
    waypoints: readonly Waypoint[],
    route: RouteResult | null,
    labels: PanelLabels,
    set: (next: readonly Waypoint[]) => void
): HTMLElement {
    return renderStepList({
        waypoints,
        route,
        labels,
        onMove: (from, to) => {
            const r = moveWaypoint(waypoints, from, to);
            // A refused move is not worth a message: `no-op` is a drag that ended where it
            // started, and the user already knows nothing moved.
            if (r.ok) set(r.waypoints);
        },
        onRemove: (index) => {
            const r = removeWaypoint(waypoints, index);
            if (r.ok) set(r.waypoints);
        },
    });
}

/**
 * The primary action button.
 *
 * ⚠️ Distinct from {@link textButton}, which is for the secondary row: this one carries the
 * panel's main verb and is styled as such. Sharing one helper would mean a class name passed
 * in at every call site, which is how two buttons end up looking alike by accident.
 *
 * @param className Its class.
 * @param label     Its text.
 * @param onClick   What to do.
 * @returns The button.
 */
function actionButton(className: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
}

/**
 * The guidance button, when guidance is reachable at all.
 *
 * 🛑 Returns `null` rather than a disabled button when `onStart` is absent. That absence is
 * the caller's guard: an integrator who has not installed the guidance plugin has no such
 * feature, and offering its greyed-out shape would invite them to look for a setting that
 * does not exist.
 *
 * @param label   The button text, resolved by the caller.
 * @param onStart What to do, or `undefined` when guidance is unreachable.
 * @returns The button, or `null`.
 */
function makeGuideButton(label: string, onStart?: () => void): HTMLButtonElement | null {
    if (!onStart) return null;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gl-routing-panel__guide";
    b.textContent = label;
    // Hidden until a route is computed — `draw()` reveals it.
    b.hidden = true;
    b.addEventListener("click", onStart);
    return b;
}

/**
 * A plain text button.
 *
 * @param className Its class.
 * @param label Its text and accessible name.
 * @param onClick What to do.
 * @returns The button.
 */
function textButton(className: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
}
