/*!
 * @geoleaf-plugins/isochrone — The rows of the zones
 *
 * One row per zone, top of the stack first: handle, colour, label, visibility, up, down,
 * remove, and the opacity under the label. The order of the rows is the order on the map.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { createEl } from "@geoleaf/host-runtime";

import type { IsochroneLayer, LayerStyle } from "../model.js";
import { label, rowLabel } from "./messages.js";

/**
 * Three rules this list keeps, and why
 *
 * 1. **The buttons come first, the drag second.** ▲ and ▼ serve the keyboard, the finger and
 *    the screen reader; the drag is a comfort for the mouse, and calls the same move. At the
 *    ends the button is DISABLED, not hidden: the tab order stays where the user left it.
 * 2. **The focus follows the moved row.** After a move the focus goes back to the same button
 *    of that row — to its other one when the row reached an end — and its new place is said.
 * 3. **The list is updated, never rebuilt.** Rows are kept by zone and moved in place; a
 *    control that holds the focus is not written to, so a colour or an opacity being set is
 *    not reset under the user's hand. The settings are sent once per frame.
 */

/** What the list asks of whoever owns the stack. */
interface LayerListActions {
    setStyle(id: string, style: LayerStyle): void;
    setVisible(id: string, visible: boolean): void;
    move(id: string, toIndex: number): void;
    remove(id: string): void;
    clear(): void;
    /** Says a change to whoever does not see it. */
    announce(message: string): void;
    /** Takes the focus once the list has no row left to hold it. */
    leaveFocus(): void;
}

/** The elements of one row. */
interface Row {
    readonly item: HTMLLIElement;
    readonly swatch: HTMLInputElement;
    readonly name: HTMLSpanElement;
    readonly visibility: HTMLButtonElement;
    readonly up: HTMLButtonElement;
    readonly down: HTMLButtonElement;
    readonly remove: HTMLButtonElement;
    readonly opacity: HTMLInputElement;
}

/** The live list. */
interface LayerList {
    /** The list's element, to be placed in the window once. */
    readonly element: HTMLElement;
    /** Brings the rows in line with the stack, top first. */
    update(layers: readonly IsochroneLayer[]): void;
    /** Drops the frame still pending. */
    destroy(): void;
}

/**
 * Builds a button of a row.
 *
 * @param className Its class.
 * @param glyph What it draws — the sentence is its `aria-label`.
 * @returns The button.
 */
function rowButton(className: string, glyph: string): HTMLButtonElement {
    const button = createEl("button", className, { type: "button" });
    button.textContent = glyph;
    return button;
}

/**
 * Builds the list of the zones.
 *
 * @param actions What the controls ask.
 * @returns The list, empty until its first `update()`.
 */
export function createLayerList(actions: LayerListActions): LayerList {
    const element = createEl("div", "gl-isochrone__layers");
    const list = createEl("ol", "gl-isochrone__list", { role: "list" });
    list.setAttribute("aria-label", label("isochrone.list.label"));
    const empty = createEl("p", "gl-isochrone__empty");
    empty.textContent = label("isochrone.list.empty");
    const clear = createEl("button", "gl-isochrone__clear", { type: "button" });
    clear.textContent = label("isochrone.list.clear");
    clear.addEventListener("click", () => {
        actions.clear();
        // The button hides with the last row: the focus would fall to the page.
        if (order.length === 0) actions.leaveFocus();
    });
    element.append(list, empty, clear);

    const rows = new Map<string, Row>();
    let order: IsochroneLayer[] = [];
    let dragged: string | null = null;

    // Settings sent once per frame: a colour picker or a slider fires on every pixel.
    const pending = new Map<string, LayerStyle>();
    let frame = 0;
    const flush = (): void => {
        frame = 0;
        const batch = [...pending];
        pending.clear();
        for (const [id, style] of batch) actions.setStyle(id, style);
    };
    const queueStyle = (id: string, style: LayerStyle): void => {
        pending.set(id, { ...pending.get(id), ...style });
        if (!frame) frame = requestAnimationFrame(flush);
    };

    const indexOf = (id: string): number => order.findIndex((l) => l.id === id);

    /** Moves a zone, then puts the focus back on the row and says where it went. */
    const moveBy = (id: string, step: -1 | 1): void => {
        const from = indexOf(id);
        if (from < 0) return;
        actions.move(id, from + step);
        const row = rows.get(id);
        const to = indexOf(id);
        const layer = order[to];
        if (!row || !layer) return;
        const preferred = step < 0 ? row.up : row.down;
        (preferred.disabled ? (step < 0 ? row.down : row.up) : preferred).focus();
        actions.announce(
            label("isochrone.list.moved", {
                row: rowLabel(layer.minutes, layer.mode),
                rank: to + 1,
                count: order.length,
            })
        );
    };

    const buildRow = (id: string): Row => {
        const item = createEl("li", "gl-isochrone__row");
        item.dataset.id = id;
        const handle = createEl("span", "gl-isochrone__handle", { "aria-hidden": "true" });
        handle.textContent = "⠇";
        handle.draggable = true;
        const swatch = createEl("input", "gl-isochrone__swatch", { type: "color" });
        const name = createEl("span", "gl-isochrone__name");
        const visibility = rowButton("gl-isochrone__visibility", "◉");
        const up = rowButton("gl-isochrone__up", "▲");
        const down = rowButton("gl-isochrone__down", "▼");
        const remove = rowButton("gl-isochrone__remove", "✕");
        const opacity = createEl("input", "gl-isochrone__opacity", {
            type: "range",
            min: "0",
            max: "1",
            step: "0.05",
        });
        const head = createEl("div", "gl-isochrone__row-head");
        head.append(handle, swatch, name, visibility, up, down, remove);
        item.append(head, opacity);

        swatch.addEventListener("input", () => queueStyle(id, { color: swatch.value }));
        opacity.addEventListener("input", () => queueStyle(id, { opacity: Number(opacity.value) }));
        visibility.addEventListener("click", () => {
            const layer = order[indexOf(id)];
            if (layer) actions.setVisible(id, !layer.visible);
        });
        up.addEventListener("click", () => moveBy(id, -1));
        down.addEventListener("click", () => moveBy(id, 1));
        remove.addEventListener("click", () => {
            const at = indexOf(id);
            actions.remove(id);
            // The focus would fall to the page: it goes to the row that took this one's place.
            const next = order[Math.min(at, order.length - 1)];
            const target = next ? rows.get(next.id)?.remove : undefined;
            if (target) target.focus();
            else actions.leaveFocus();
        });

        handle.addEventListener("dragstart", (e: DragEvent) => {
            dragged = id;
            e.dataTransfer?.setData("text/plain", id);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        });
        handle.addEventListener("dragend", () => {
            dragged = null;
        });
        item.addEventListener("dragover", (e: DragEvent) => {
            if (dragged !== null) e.preventDefault();
        });
        item.addEventListener("drop", (e: DragEvent) => {
            e.preventDefault();
            const moving = dragged;
            dragged = null;
            const to = indexOf(id);
            if (moving !== null && moving !== id && to >= 0) actions.move(moving, to);
        });

        return { item, swatch, name, visibility, up, down, remove, opacity };
    };

    /** Writes a control's value — unless the user is setting it right now. */
    const write = (input: HTMLInputElement, value: string): void => {
        if (document.activeElement !== input && input.value !== value) input.value = value;
    };

    const update = (layers: readonly IsochroneLayer[]): void => {
        order = [...layers];
        const kept = new Set(order.map((l) => l.id));
        for (const [id, row] of rows) {
            if (!kept.has(id)) {
                row.item.remove();
                rows.delete(id);
                pending.delete(id);
            }
        }
        order.forEach((layer, i) => {
            let row = rows.get(layer.id);
            if (!row) {
                row = buildRow(layer.id);
                rows.set(layer.id, row);
            }
            const text = rowLabel(layer.minutes, layer.mode);
            row.name.textContent = text;
            row.item.classList.toggle("gl-isochrone__row--hidden", !layer.visible);
            write(row.swatch, layer.color);
            write(row.opacity, String(layer.opacity));
            row.swatch.setAttribute("aria-label", label("isochrone.list.color", { row: text }));
            row.opacity.setAttribute("aria-label", label("isochrone.list.opacity", { row: text }));
            row.visibility.setAttribute("aria-pressed", String(!layer.visible));
            row.visibility.setAttribute("aria-label", label("isochrone.list.hide", { row: text }));
            row.up.setAttribute("aria-label", label("isochrone.list.up", { row: text }));
            row.down.setAttribute("aria-label", label("isochrone.list.down", { row: text }));
            row.remove.setAttribute("aria-label", label("isochrone.list.remove", { row: text }));
            row.up.disabled = i === 0;
            row.down.disabled = i === order.length - 1;
            // Moved only when out of place: a node taken out of the page loses the focus.
            if (list.children[i] !== row.item)
                list.insertBefore(row.item, list.children[i] ?? null);
        });
        empty.hidden = order.length > 0;
        clear.hidden = order.length === 0;
    };

    return {
        element,
        update,
        destroy: () => {
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            pending.clear();
        },
    };
}
