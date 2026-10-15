/**
 * @geoleaf-plugins/isochrone — the rows of the zones
 *
 * The rows follow the stack, top first, and are moved in place rather than rebuilt; ▲ and ▼
 * are disabled at the ends, the focus follows the moved row and its new place is said; a
 * control being set is not written to; the settings go once per frame; every control is named.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IsochroneLayer } from "../model.js";
import { createLayerList } from "../ui/layer-list.js";

type LayerList = ReturnType<typeof createLayerList>;
type LayerListActions = Parameters<typeof createLayerList>[0];

/** A zone. */
function zone(id: string, minutes: number, extra: Partial<IsochroneLayer> = {}): IsochroneLayer {
    return {
        id,
        origin: [55, -21],
        mode: "car",
        minutes,
        color: "#3987e5",
        opacity: 0.25,
        visible: true,
        attribution: "© Test",
        ...extra,
    };
}

let stack: IsochroneLayer[];
let list: LayerList;
let actions: LayerListActions & Record<string, ReturnType<typeof vi.fn>>;

/** Waits for the next frame. */
function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** The row of a zone. */
function row(id: string): HTMLElement {
    const item = list.element.querySelector<HTMLElement>(`li[data-id="${id}"]`);
    if (!item) throw new Error(`no row for ${id}`);
    return item;
}

/** A control of a row, by its class. */
function control<T extends HTMLElement>(id: string, className: string): T {
    const el = row(id).querySelector<T>(`.${className}`);
    if (!el) throw new Error(`no ${className} in ${id}`);
    return el;
}

beforeEach(() => {
    stack = [zone("a", 5), zone("b", 10), zone("c", 15)];
    actions = {
        setStyle: vi.fn(),
        setVisible: vi.fn(),
        // Like the controller: the stack changes, then the list is told.
        move: vi.fn((id: string, to: number) => {
            const from = stack.findIndex((l) => l.id === id);
            const [moved] = stack.splice(from, 1);
            if (moved) stack.splice(to, 0, moved);
            list.update(stack);
        }),
        remove: vi.fn((id: string) => {
            stack = stack.filter((l) => l.id !== id);
            list.update(stack);
        }),
        clear: vi.fn(() => {
            stack = [];
            list.update(stack);
        }),
        announce: vi.fn(),
        leaveFocus: vi.fn(),
    };
    list = createLayerList(actions);
    document.body.append(list.element);
    list.update(stack);
});

afterEach(() => {
    list.destroy();
    document.body.replaceChildren();
});

/** The ids of the rows, in the page's order. */
function rowIds(): string[] {
    return [...list.element.querySelectorAll<HTMLElement>("li")].map((li) => li.dataset.id ?? "");
}

describe("the rows", () => {
    it("follow the stack, top first, with the label of each zone", () => {
        expect(rowIds()).toEqual(["a", "b", "c"]);
        expect(control("a", "gl-isochrone__name").textContent).toBe("isochrone.list.row");
    });

    it("are moved in place, never rebuilt", () => {
        const before = row("c");
        list.update([
            stack[2] as IsochroneLayer,
            stack[0] as IsochroneLayer,
            stack[1] as IsochroneLayer,
        ]);
        expect(rowIds()).toEqual(["c", "a", "b"]);
        expect(row("c")).toBe(before);
    });

    it("drop the row of a zone gone, and say when there is none", () => {
        const empty = list.element.querySelector<HTMLElement>(".gl-isochrone__empty");
        const clear = list.element.querySelector<HTMLElement>(".gl-isochrone__clear");
        expect(empty?.hidden).toBe(true);
        list.update([]);
        expect(rowIds()).toEqual([]);
        expect(empty?.hidden).toBe(false);
        expect(clear?.hidden).toBe(true);
    });

    it("name every control", () => {
        const unnamed = [...list.element.querySelectorAll("button, input")].filter(
            (el) => !el.getAttribute("aria-label") && !el.textContent?.trim()
        );
        expect(unnamed).toEqual([]);
        for (const el of row("a").querySelectorAll("button, input")) {
            expect(el.getAttribute("aria-label")).toBeTruthy();
        }
    });

    it("show a hidden zone as pressed, and keep its place", () => {
        list.update([
            stack[0] as IsochroneLayer,
            zone("b", 10, { visible: false }),
            stack[2] as IsochroneLayer,
        ]);
        expect(control("b", "gl-isochrone__visibility").getAttribute("aria-pressed")).toBe("true");
        expect(row("b").classList.contains("gl-isochrone__row--hidden")).toBe(true);
        expect(rowIds()).toEqual(["a", "b", "c"]);
        control<HTMLButtonElement>("b", "gl-isochrone__visibility").click();
        expect(actions.setVisible).toHaveBeenCalledWith("b", true);
    });
});

describe("moving a row", () => {
    it("disables ▲ on the top row and ▼ on the bottom one — disabled, not hidden", () => {
        const upA = control<HTMLButtonElement>("a", "gl-isochrone__up");
        const downC = control<HTMLButtonElement>("c", "gl-isochrone__down");
        expect(upA.disabled).toBe(true);
        expect(upA.hidden).toBe(false);
        expect(downC.disabled).toBe(true);
        expect(control<HTMLButtonElement>("b", "gl-isochrone__up").disabled).toBe(false);
    });

    it("keeps the focus on the moved row's button, and says its new place", () => {
        const down = control<HTMLButtonElement>("a", "gl-isochrone__down");
        down.focus();
        down.click();
        expect(actions.move).toHaveBeenCalledWith("a", 1);
        expect(rowIds()).toEqual(["b", "a", "c"]);
        expect(document.activeElement).toBe(down);
        expect(actions.announce).toHaveBeenCalledWith("isochrone.list.moved");
    });

    it("gives the focus to the other button when the row reached an end", () => {
        const down = control<HTMLButtonElement>("b", "gl-isochrone__down");
        down.click();
        expect(rowIds()).toEqual(["a", "c", "b"]);
        expect(document.activeElement).toBe(control("b", "gl-isochrone__up"));
    });

    it("moves by a drop the same way as by the buttons", () => {
        const handle = control("c", "gl-isochrone__handle");
        handle.dispatchEvent(new Event("dragstart"));
        const over = new Event("dragover", { cancelable: true });
        row("a").dispatchEvent(over);
        expect(over.defaultPrevented).toBe(true);
        row("a").dispatchEvent(new Event("drop", { cancelable: true }));
        expect(actions.move).toHaveBeenCalledWith("c", 0);
        expect(rowIds()).toEqual(["c", "a", "b"]);
    });

    it("ignores a drop that carries no row of its own", () => {
        const over = new Event("dragover", { cancelable: true });
        row("a").dispatchEvent(over);
        expect(over.defaultPrevented).toBe(false);
        row("a").dispatchEvent(new Event("drop", { cancelable: true }));
        expect(actions.move).not.toHaveBeenCalled();
    });
});

describe("setting a zone", () => {
    it("sends the settings once per frame, merged", async () => {
        const opacity = control<HTMLInputElement>("a", "gl-isochrone__opacity");
        const swatch = control<HTMLInputElement>("a", "gl-isochrone__swatch");
        for (const v of ["0.3", "0.4", "0.5"]) {
            opacity.value = v;
            opacity.dispatchEvent(new Event("input"));
        }
        swatch.value = "#d95926";
        swatch.dispatchEvent(new Event("input"));
        expect(actions.setStyle).not.toHaveBeenCalled();
        await nextFrame();
        expect(actions.setStyle).toHaveBeenCalledTimes(1);
        expect(actions.setStyle).toHaveBeenCalledWith("a", { opacity: 0.5, color: "#d95926" });
    });

    it("does not write to a control the user is setting", () => {
        const opacity = control<HTMLInputElement>("a", "gl-isochrone__opacity");
        opacity.focus();
        opacity.value = "0.6";
        list.update([
            zone("a", 5, { opacity: 0.25 }),
            stack[1] as IsochroneLayer,
            stack[2] as IsochroneLayer,
        ]);
        expect(opacity.value).toBe("0.6");
        opacity.blur();
        list.update([
            zone("a", 5, { opacity: 0.25 }),
            stack[1] as IsochroneLayer,
            stack[2] as IsochroneLayer,
        ]);
        expect(opacity.value).toBe("0.25");
    });

    it("drops the frame pending when it is destroyed", async () => {
        const opacity = control<HTMLInputElement>("a", "gl-isochrone__opacity");
        opacity.value = "0.9";
        opacity.dispatchEvent(new Event("input"));
        list.destroy();
        await nextFrame();
        expect(actions.setStyle).not.toHaveBeenCalled();
    });
});

describe("removing", () => {
    it("removes a zone, and gives the focus to the row that took its place", () => {
        control<HTMLButtonElement>("a", "gl-isochrone__remove").click();
        expect(actions.remove).toHaveBeenCalledWith("a");
        expect(document.activeElement).toBe(control("b", "gl-isochrone__remove"));
    });

    it("hands the focus over once the last row is gone", () => {
        stack = [zone("a", 5)];
        list.update(stack);
        control<HTMLButtonElement>("a", "gl-isochrone__remove").click();
        expect(actions.leaveFocus).toHaveBeenCalledTimes(1);
    });

    it("asks to remove every zone, then hands the focus over", () => {
        list.element.querySelector<HTMLButtonElement>(".gl-isochrone__clear")?.click();
        expect(actions.clear).toHaveBeenCalledTimes(1);
        expect(actions.leaveFocus).toHaveBeenCalledTimes(1);
    });
});
