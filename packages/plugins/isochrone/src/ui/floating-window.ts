/*!
 * @geoleaf-plugins/isochrone — The floating window
 *
 * A window that floats over the map without blocking it: the form that asks for zones, the
 * state of the computation and its failures, and the rows of the zones drawn. The map stays
 * visible and usable — a colour is set while watching it change.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import {
    createEl,
    isGeolocationEnabled,
    positionMenuNear,
    requestUserPosition,
    wireDrag,
    wireTouchDrag,
} from "@geoleaf/host-runtime";

import { getPluginConfig } from "../config.js";
import {
    cancelComputation,
    clearLayers,
    computeIsochrone,
    isComputing,
    listLayers,
    moveLayer,
    onStackChange,
    removeLayer,
    showLayer,
    styleLayer,
} from "../controller.js";
import type { ComputeResult, TravelMode } from "../model.js";
import { pickOriginOnMap, type PickMode } from "../pick-on-map.js";
import { createLayerList } from "./layer-list.js";
import { label, modeLabel, refusalMessage } from "./messages.js";

/**
 * What the window keeps, and why
 *
 * - **Two origins: a point placed on the map, or « my position ».** The second reads the
 *   core's GPS through `@geoleaf/host-runtime` — switched on if it is off, never called directly
 *   — and is hidden where the profile turns the GPS off. A refusal, a missing device and a
 *   timeout all read « position unavailable »: the core tells them apart to nobody.
 * - **One Escape, one gesture.** While the window is open, Escape leaves the picking, else
 *   abandons the position being sought, else cancels the computation, else closes the window —
 *   the last only when the focus is in it, so an Escape meant for something else of the page
 *   does not close it.
 * - **One floating tool at a time.** Opening announces itself on the document's
 *   `geoleaf:submenu:open` convention, and another tool's announcement closes this window. The
 *   zones stay.
 * - **Folded while picking.** The window gives the map back to the click, and unfolds as it
 *   was once the point is placed. The state line stays visible, outside the folded part: it is
 *   where « click on the map » is said. ⚠️ **On a small screen it STAYS folded once a point is
 *   placed — and folds once « my position » has a fix**: unfolded, it covers most of the map —
 *   the point and the zones the user just asked for. The focus then goes to the unfold button, the folded part being hidden. A picking left
 *   without a point unfolds as before, there is nothing new to see.
 * - **It follows the stack, whoever changes it.** It listens to the controller, so a call to
 *   the public API while it is open shows in its rows.
 */

/**
 * The width under which the window stays folded once a point is placed — the SAME breakpoint as
 * the stylesheet's small-screen block (`css/geoleaf-isochrone.css`), where the window already goes
 * over the toolbar for want of room.
 */
const SMALL_SCREEN = "(max-width: 480px)";

/** True on a small screen; false where the host has no `matchMedia`. */
function isSmallScreen(): boolean {
    return typeof matchMedia === "function" && matchMedia(SMALL_SCREEN).matches;
}

/** The live window. */
export interface FloatingWindow {
    /** The window's element, to be placed in the plugin's root. */
    readonly element: HTMLElement;
    /** Places the window beside a toolbar button, inside the map. */
    placeNear(anchor: Element, container: HTMLElement): void;
    /** Makes the window draggable inside `container`. Called once, after the window is placed. */
    wireMove(container: HTMLElement, root: HTMLElement): void;
    /** Leaves the picking, unsubscribes everything. The zones stay. */
    destroy(): void;
}

/** Name shared by the mode radios: one group per page, the window being one. */
const MODE_GROUP = "gl-isochrone-mode";

/** Gutter kept between the window and the screen's edges, in px — the stylesheet's own. */
const SCREEN_GUTTER = 16;

/**
 * Keeps a coordinate where the whole window stays on the screen.
 *
 * The toolbar's placement only keeps the window inside the MAP, and by its left edge: on a
 * phone, beside the toolbar, it ran past the right edge of the screen.
 *
 * @param at The coordinate asked.
 * @param size The window's size on that axis.
 * @param screen The screen's size on that axis.
 * @returns The coordinate, moved back on the screen.
 */
function onScreen(at: number, size: number, screen: number): number {
    return Math.max(SCREEN_GUTTER, Math.min(at, screen - size - SCREEN_GUTTER));
}

/**
 * Builds the window.
 *
 * @param onClose Called when the window asks to be closed — its button, Escape, another tool.
 * @returns The live window.
 */
export function createFloatingWindow(onClose: () => void): FloatingWindow {
    const config = getPluginConfig();

    const element = createEl("section", "gl-isochrone__panel", { role: "dialog" });
    element.setAttribute("aria-label", label("isochrone.panel.title"));

    // — Title bar —
    const header = createEl("div", "gl-isochrone__header");
    const grip = createEl("span", "gl-isochrone__grip", { "aria-hidden": "true" });
    grip.textContent = "⠇";
    const title = createEl("h2", "gl-isochrone__title");
    title.textContent = label("isochrone.panel.title");
    const fold = createEl("button", "gl-isochrone__fold", { type: "button" });
    fold.textContent = "▁";
    const close = createEl("button", "gl-isochrone__close", { type: "button" });
    close.textContent = "✕";
    close.setAttribute("aria-label", label("isochrone.panel.close"));
    header.append(grip, title, fold, close);

    // — State: outside the folded part, so it is still read while picking —
    const status = createEl("p", "gl-isochrone__status", { role: "status", "aria-live": "polite" });
    const error = createEl("p", "gl-isochrone__error", { role: "alert" });
    error.hidden = true;

    // — Form —
    const body = createEl("div", "gl-isochrone__body");
    body.id = "gl-isochrone-body";
    fold.setAttribute("aria-controls", body.id);

    const modes = createEl("fieldset", "gl-isochrone__modes");
    const modesLegend = createEl("legend", "gl-isochrone__legend");
    modesLegend.textContent = label("isochrone.form.mode");
    modes.append(modesLegend);
    const modeInputs = new Map<TravelMode, HTMLInputElement>();
    for (const mode of config.modes) {
        const option = createEl("label", "gl-isochrone__option");
        const input = createEl("input", "gl-isochrone__radio", {
            type: "radio",
            name: MODE_GROUP,
            value: mode,
        });
        input.checked = mode === config.mode;
        const text = createEl("span", "gl-isochrone__option-text");
        text.textContent = modeLabel(mode);
        option.append(input, text);
        modes.append(option);
        modeInputs.set(mode, input);
    }

    const durations = createEl("fieldset", "gl-isochrone__durations");
    const durationsLegend = createEl("legend", "gl-isochrone__legend");
    durationsLegend.textContent = label("isochrone.form.durations");
    durations.append(durationsLegend);
    const durationInputs = new Map<number, HTMLInputElement>();
    for (const minutes of config.durations) {
        const option = createEl("label", "gl-isochrone__option");
        const input = createEl("input", "gl-isochrone__check", {
            type: "checkbox",
            value: String(minutes),
        });
        input.checked = true;
        const text = createEl("span", "gl-isochrone__option-text");
        text.textContent = label("isochrone.form.minutes", { minutes });
        option.append(input, text);
        durations.append(option);
        durationInputs.set(minutes, input);
    }

    const actions = createEl("div", "gl-isochrone__actions");
    const pick = createEl("button", "gl-isochrone__pick", { type: "button" });
    pick.textContent = label("isochrone.form.pick");
    pick.setAttribute("aria-pressed", "false");
    // « My position »: the core's GPS, switched on if it is off. Hidden where the profile turns
    // the GPS off — a button that can only fail is not offered.
    const locate = createEl("button", "gl-isochrone__locate", { type: "button" });
    locate.textContent = label("isochrone.form.myPosition");
    locate.hidden = !isGeolocationEnabled();
    const cancel = createEl("button", "gl-isochrone__cancel", { type: "button" });
    cancel.textContent = label("isochrone.form.cancel");
    cancel.hidden = true;
    actions.append(pick, locate, cancel);

    const say = (message: string): void => {
        status.textContent = message;
    };
    const fail = (message: string): void => {
        error.textContent = message;
        error.hidden = message === "";
    };

    const rows = createLayerList({
        setStyle: (id, style) => void styleLayer(id, style),
        setVisible: (id, visible) => void showLayer(id, visible),
        move: (id, toIndex) => void moveLayer(id, toIndex),
        remove: (id) => void removeLayer(id),
        clear: () => {
            clearLayers();
            say(label("isochrone.status.cleared"));
        },
        announce: say,
        leaveFocus: () => pick.focus(),
    });

    body.append(modes, durations, actions, rows.element);
    element.append(header, status, error, body);

    // — Folding —
    let folded = false;
    const setFolded = (value: boolean): void => {
        folded = value;
        body.hidden = value;
        fold.setAttribute("aria-expanded", String(!value));
        fold.setAttribute(
            "aria-label",
            label(value ? "isochrone.panel.expand" : "isochrone.panel.collapse")
        );
    };
    setFolded(false);
    fold.addEventListener("click", () => setFolded(!folded));

    // — Following the controller —
    // A position being sought counts as busy: one origin at a time.
    let locating = 0;
    let locatingNow = false;
    const sync = (): void => {
        const busy = isComputing() || locatingNow;
        pick.disabled = busy;
        locate.disabled = busy;
        cancel.hidden = !busy;
        rows.update(listLayers());
    };
    const unsubscribe = onStackChange(sync);
    sync();

    // — Computing —
    const chosenMode = (): TravelMode => {
        for (const [mode, input] of modeInputs) if (input.checked) return mode;
        return config.mode;
    };
    const chosenMinutes = (): number[] =>
        [...durationInputs].filter(([, input]) => input.checked).map(([minutes]) => minutes);

    const report = (result: ComputeResult): void => {
        if (result.ok) {
            say(label("isochrone.status.done", { count: result.ids.length }));
        } else if (result.reason === "aborted") {
            say(label("isochrone.status.cancelled"));
        } else {
            say("");
            fail(refusalMessage(result));
        }
    };

    const run = (origin: [lon: number, lat: number]): void => {
        const minutes = chosenMinutes();
        fail("");
        if (minutes.length === 0) {
            fail(label("isochrone.error.noDuration"));
            return;
        }
        say(label("isochrone.status.computing"));
        void computeIsochrone({ origin, mode: chosenMode(), minutes }).then(report);
    };

    // — Picking —
    let picking: PickMode | null = null;
    let foldedBeforePick = false;
    const stopPicking = (keepFolded = false): void => {
        if (!picking) return;
        picking.stop();
        picking = null;
        pick.setAttribute("aria-pressed", "false");
        setFolded(keepFolded || foldedBeforePick);
    };
    pick.addEventListener("click", () => {
        if (picking) {
            stopPicking();
            say("");
            pick.focus();
            return;
        }
        fail("");
        const mode = pickOriginOnMap((origin) => {
            const small = isSmallScreen();
            stopPicking(small);
            // The pick button is in the folded part when the window stays folded.
            (small || foldedBeforePick ? fold : pick).focus();
            run(origin);
        });
        if (!mode.active) {
            fail(refusalMessage({ ok: false, reason: "no-map" }));
            return;
        }
        picking = mode;
        foldedBeforePick = folded;
        pick.setAttribute("aria-pressed", "true");
        say(label("isochrone.status.picking"));
        setFolded(true);
        fold.focus();
    });

    // ⚠️ A request is abandoned, never cancelled — the core's watch goes on — by bumping
    // `locating`: Escape and closing the window do it, and a fix that arrives late computes nothing.
    const stopLocating = (): void => {
        locating += 1;
        locatingNow = false;
        sync();
    };
    locate.addEventListener("click", () => {
        fail("");
        const ticket = ++locating;
        locatingNow = true;
        sync();
        say(label("isochrone.status.locating"));
        void requestUserPosition().then((fix) => {
            if (ticket !== locating) return;
            stopLocating();
            if (!fix) {
                say("");
                fail(label("isochrone.error.noPosition"));
                return;
            }
            // Same rule as a placed point: on a small screen the window folds, or it covers the
            // position and the zones just asked for.
            if (isSmallScreen()) {
                setFolded(true);
                fold.focus();
            }
            run([fix.lng, fix.lat]);
        });
    });

    cancel.addEventListener("click", () => {
        cancelComputation();
        pick.focus();
    });

    close.addEventListener("click", () => onClose());

    // — Escape —
    const onKey = (e: KeyboardEvent): void => {
        if (e.key !== "Escape") return;
        if (picking) {
            stopPicking();
            say("");
            pick.focus();
        } else if (locatingNow) {
            stopLocating();
            say("");
            locate.focus();
        } else if (isComputing()) {
            cancelComputation();
        } else if (element.contains(document.activeElement)) {
            onClose();
        } else {
            return;
        }
        e.preventDefault();
    };
    document.addEventListener("keydown", onKey);

    // — One floating tool at a time —
    const onOtherTool = (e: Event): void => {
        const id = (e as CustomEvent<{ id?: unknown }>).detail?.id;
        if (id !== "isochrone") onClose();
    };
    document.addEventListener("geoleaf:submenu:open", onOtherTool);

    return {
        element,
        placeNear: (anchor, container) =>
            positionMenuNear(anchor, container, {
                menuHeight: element.offsetHeight,
                setPosition: (top, left) => {
                    const root = element.parentElement;
                    const y = onScreen(top, element.offsetHeight, window.innerHeight);
                    const x = onScreen(left, element.offsetWidth, window.innerWidth);
                    root?.style.setProperty("--gl-isochrone-top", `${y}px`);
                    root?.style.setProperty("--gl-isochrone-left", `${x}px`);
                },
            }),
        wireMove: (container, root) => {
            wireDrag(grip, container, () => root, "isochrone");
            wireTouchDrag(grip, container, () => root, "isochrone");
        },
        destroy: () => {
            stopPicking();
            stopLocating();
            unsubscribe();
            rows.destroy();
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("geoleaf:submenu:open", onOtherTool);
        },
    };
}
