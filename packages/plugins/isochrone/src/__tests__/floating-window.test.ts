/**
 * @geoleaf-plugins/isochrone — the floating window
 *
 * Every action without a mouse: the form computes from a placed point or from « my position »,
 * cancels, says its state politely and its failures with priority. One Escape does one thing —
 * leave the picking, else abandon the position being sought, else cancel, else close. Opening closes the other floating tools, and
 * their opening closes this one. The window follows the stack whoever changes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listLayers, moveLayer } from "../controller.js";
import { closeIsochrone, destroyIsochrone, openIsochrone } from "../isochrone-api.js";
import type { IsochroneOutcome, IsochroneRequest } from "../model.js";
import { registerProvider } from "../provider.js";
import { createFakeMap, type FakeMap } from "./fake-map.js";

const AREA = { type: "Polygon", coordinates: [] } as const;

const host = globalThis as { GeoLeaf?: unknown };
const previous = host.GeoLeaf;

let map: FakeMap | null;

/** The core's GPS, as `GeoLeaf.Geolocation` exposes it: a fix held by default. */
let gpsEnabled: boolean;
let gps: { active: boolean; userPosition: { lat: number; lng: number } | null };
let answer: (request: IsochroneRequest) => Promise<IsochroneOutcome>;
const asked = vi.fn();

registerProvider("panel-engine", () => ({
    id: "panel-engine",
    attribution: "© Panel data",
    limits: { maxContours: 4, maxMinutes: 60 },
    isochrone: (request) => {
        asked(request);
        return answer(request);
    },
}));

/** An engine that answers every duration. */
async function everyZone(request: IsochroneRequest): Promise<IsochroneOutcome> {
    return { ok: true, contours: request.minutes.map((minutes) => ({ minutes, geometry: AREA })) };
}

/** An engine that answers only once its request is cancelled. */
function untilCancelled(request: IsochroneRequest): Promise<IsochroneOutcome> {
    return new Promise((resolve) =>
        request.signal.addEventListener("abort", () => resolve({ ok: false, reason: "aborted" }))
    );
}

/** Lets the pending promises settle. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** An element of the window, by its class. */
function el<T extends HTMLElement>(className: string): T {
    const found = document.querySelector<T>(`.${className}`);
    if (!found) throw new Error(`no .${className}`);
    return found;
}

/** Presses « My position » and lets the fix reach the form — the computation is then under way. */
async function fromMyPosition(): Promise<void> {
    el<HTMLButtonElement>("gl-isochrone__locate").click();
    await Promise.resolve();
    await Promise.resolve();
}

/** Presses a key on the document. */
function press(key: string): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true });
    document.dispatchEvent(event);
    return event;
}

beforeEach(() => {
    map = createFakeMap();
    document.body.append(map.container);
    answer = everyZone;
    asked.mockClear();
    host.GeoLeaf = {
        Config: {
            get: (key: string, fallback: unknown) =>
                key === "modules.isochrone"
                    ? {
                          provider: "panel-engine",
                          endpoint: "https://engine.test",
                          durations: [5, 10, 15],
                      }
                    : fallback,
        },
        Core: { getMap: () => map },
        Geolocation: { isEnabled: () => gpsEnabled, getState: () => gps },
    };
    gpsEnabled = true;
    gps = { active: true, userPosition: { lat: -21.1, lng: 55.5 } };
});

afterEach(() => {
    destroyIsochrone();
    host.GeoLeaf = previous;
    document.body.replaceChildren();
});

describe("opening", () => {
    it("places the window in the map's container, once", () => {
        openIsochrone();
        openIsochrone();
        expect(map?.container.querySelectorAll(".gl-isochrone__panel")).toHaveLength(1);
    });

    it("opens in the page when no map is mounted, and says so on a gesture", async () => {
        map = null;
        expect(openIsochrone()).toBe(true);
        await fromMyPosition();
        await settle();
        expect(el("gl-isochrone__error").textContent).toBe("isochrone.error.noMap");
        el<HTMLButtonElement>("gl-isochrone__pick").click();
        expect(el("gl-isochrone__pick").getAttribute("aria-pressed")).toBe("false");
    });

    it("is a named, non-modal dialog whose every control has a name", () => {
        openIsochrone();
        const panel = el("gl-isochrone__panel");
        expect(panel.getAttribute("role")).toBe("dialog");
        expect(panel.getAttribute("aria-modal")).toBeNull();
        expect(panel.getAttribute("aria-label")).toBeTruthy();
        const unnamed = [...panel.querySelectorAll("button, input")].filter((c) => {
            const named = c.getAttribute("aria-label") || c.textContent?.trim();
            return !named && !c.closest("label")?.textContent?.trim();
        });
        expect(unnamed).toEqual([]);
    });

    it("offers the profile's modes and durations, its mode chosen, every duration ticked", () => {
        openIsochrone();
        const radios = [...document.querySelectorAll<HTMLInputElement>(".gl-isochrone__radio")];
        expect(radios.map((r) => r.value)).toEqual(["car", "foot", "bike"]);
        expect(radios.find((r) => r.checked)?.value).toBe("car");
        const boxes = [...document.querySelectorAll<HTMLInputElement>(".gl-isochrone__check")];
        expect(boxes.map((b) => [b.value, b.checked])).toEqual([
            ["5", true],
            ["10", true],
            ["15", true],
        ]);
    });

    it("places itself beside the button that opened it", () => {
        const anchor = document.createElement("button");
        document.body.append(anchor);
        openIsochrone(anchor);
        const root = el("gl-isochrone");
        expect(root.style.getPropertyValue("--gl-isochrone-top")).toMatch(/px$/);
        expect(root.style.getPropertyValue("--gl-isochrone-left")).toMatch(/px$/);
    });

    it("stays on a narrow screen, with its gutter, wherever the button is", () => {
        const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
            configurable: true,
            get: () => 358,
        });
        const innerWidth = window.innerWidth;
        window.innerWidth = 390;
        try {
            const anchor = document.createElement("button");
            document.body.append(anchor);
            openIsochrone(anchor);
            expect(el("gl-isochrone").style.getPropertyValue("--gl-isochrone-left")).toBe("16px");
        } finally {
            window.innerWidth = innerWidth;
            if (width) Object.defineProperty(HTMLElement.prototype, "offsetWidth", width);
        }
    });
});

describe("computing", () => {
    it("computes from « my position » with the mode and durations chosen", async () => {
        openIsochrone();
        document.querySelector<HTMLInputElement>('.gl-isochrone__radio[value="foot"]')?.click();
        document.querySelector<HTMLInputElement>('.gl-isochrone__check[value="15"]')?.click();
        await fromMyPosition();
        expect(el("gl-isochrone__status").textContent).toBe("isochrone.status.computing");
        await settle();
        expect(asked).toHaveBeenCalledWith(
            expect.objectContaining({ origin: [55.5, -21.1], mode: "foot", minutes: [5, 10] })
        );
        expect(document.querySelectorAll(".gl-isochrone__row")).toHaveLength(2);
        expect(el("gl-isochrone__status").textContent).toBe("isochrone.status.done");
    });

    it("refuses without a duration, before any request", async () => {
        openIsochrone();
        for (const box of document.querySelectorAll<HTMLInputElement>(".gl-isochrone__check")) {
            box.click();
        }
        await fromMyPosition();
        expect(asked).not.toHaveBeenCalled();
        expect(el("gl-isochrone__error").textContent).toBe("isochrone.error.noDuration");
        expect(el("gl-isochrone__error").hidden).toBe(false);
    });

    it("says a failure with priority, and clears it on the next attempt", async () => {
        answer = async () => ({ ok: false, reason: "http", status: 400, code: 151 });
        openIsochrone();
        await fromMyPosition();
        await settle();
        const error = el("gl-isochrone__error");
        expect(error.getAttribute("role")).toBe("alert");
        expect(error.textContent).toBe("isochrone.error.httpCode");
        answer = everyZone;
        await fromMyPosition();
        expect(error.hidden).toBe(true);
    });

    it("says its state politely", () => {
        openIsochrone();
        const status = el("gl-isochrone__status");
        expect(status.getAttribute("aria-live")).toBe("polite");
        expect(status.getAttribute("role")).toBe("status");
    });

    it("offers « Cancel » while computing, and keeps a second computation from starting", async () => {
        answer = untilCancelled;
        openIsochrone();
        const cancel = el<HTMLButtonElement>("gl-isochrone__cancel");
        expect(cancel.hidden).toBe(true);
        await fromMyPosition();
        expect(cancel.hidden).toBe(false);
        expect(el<HTMLButtonElement>("gl-isochrone__locate").disabled).toBe(true);
        expect(el<HTMLButtonElement>("gl-isochrone__pick").disabled).toBe(true);
        cancel.click();
        await settle();
        expect(cancel.hidden).toBe(true);
        expect(el("gl-isochrone__status").textContent).toBe("isochrone.status.cancelled");
        expect(el("gl-isochrone__error").hidden).toBe(true);
        expect(listLayers()).toEqual([]);
    });
});

describe("my position", () => {
    it("folds on a small screen once the fix is there, its focus on the unfold button", async () => {
        vi.stubGlobal("matchMedia", (query: string) => ({
            matches: query === "(max-width: 480px)",
        }));
        try {
            openIsochrone();
            await fromMyPosition();
            expect(el("gl-isochrone__body").hidden).toBe(true);
            expect(document.activeElement).toBe(el("gl-isochrone__fold"));
            await settle();
            expect(asked).toHaveBeenCalledTimes(1);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("hides the button where the profile turns the GPS off", () => {
        gpsEnabled = false;
        openIsochrone();
        expect(el("gl-isochrone__locate").hidden).toBe(true);
    });

    it("says « position unavailable » when no fix comes, and asks the engine nothing", async () => {
        gps = { active: false, userPosition: null };
        openIsochrone();
        await fromMyPosition();
        await settle();
        expect(asked).not.toHaveBeenCalled();
        expect(el("gl-isochrone__error").textContent).toBe("isochrone.error.noPosition");
        expect(el<HTMLButtonElement>("gl-isochrone__locate").disabled).toBe(false);
    });

    it("switches the GPS on through the core's control, and computes from the first fix", async () => {
        gps = { active: false, userPosition: null };
        const control = document.createElement("div");
        control.className = "geoleaf-ctrl-geolocation";
        const link = document.createElement("a");
        control.append(link);
        document.body.append(control);
        link.addEventListener("click", () => {
            gps = { active: true, userPosition: { lat: -20.9, lng: 55.4 } };
            document.body.dispatchEvent(
                new CustomEvent("geoleaf:geolocation:statechange", {
                    detail: { active: true },
                    bubbles: true,
                })
            );
        });
        openIsochrone();
        el<HTMLButtonElement>("gl-isochrone__locate").click();
        await settle();
        expect(asked).toHaveBeenCalledWith(expect.objectContaining({ origin: [55.4, -20.9] }));
    });

    it("is abandoned by Escape: the buttons come back, and a late fix computes nothing", async () => {
        gps = { active: false, userPosition: null };
        const control = document.createElement("div");
        control.className = "geoleaf-ctrl-geolocation";
        control.append(document.createElement("a"));
        document.body.append(control);
        openIsochrone();
        const locate = el<HTMLButtonElement>("gl-isochrone__locate");
        locate.click();
        expect(el("gl-isochrone__status").textContent).toBe("isochrone.status.locating");
        expect(locate.disabled).toBe(true);
        expect(el<HTMLButtonElement>("gl-isochrone__pick").disabled).toBe(true);
        expect(press("Escape").defaultPrevented).toBe(true);
        expect(locate.disabled).toBe(false);
        expect(document.activeElement).toBe(locate);
        gps = { active: true, userPosition: { lat: -20.9, lng: 55.4 } };
        document.body.dispatchEvent(
            new CustomEvent("geoleaf:geolocation:statechange", {
                detail: { active: true },
                bubbles: true,
            })
        );
        await settle();
        expect(asked).not.toHaveBeenCalled();
        expect(document.querySelector(".gl-isochrone__panel")).not.toBeNull();
    });
});

describe("picking", () => {
    it("arms the picking, folds the window, and computes from the point clicked", async () => {
        openIsochrone();
        const pick = el<HTMLButtonElement>("gl-isochrone__pick");
        const body = el("gl-isochrone__body");
        pick.click();
        expect(pick.getAttribute("aria-pressed")).toBe("true");
        expect(body.hidden).toBe(true);
        expect(el("gl-isochrone__status").textContent).toBe("isochrone.status.picking");
        expect(map?.exclusive.held).toBe(true);
        map?.click(55.45, -20.88);
        expect(pick.getAttribute("aria-pressed")).toBe("false");
        expect(body.hidden).toBe(false);
        expect(map?.exclusive.held).toBe(false);
        expect(document.activeElement).toBe(pick);
        await settle();
        expect(asked).toHaveBeenCalledWith(expect.objectContaining({ origin: [55.45, -20.88] }));
    });

    it("leaves the picking on a second press, without computing", () => {
        openIsochrone();
        const pick = el<HTMLButtonElement>("gl-isochrone__pick");
        pick.click();
        pick.click();
        expect(map?.clickHandlers.size).toBe(0);
        map?.click(1, 2);
        expect(asked).not.toHaveBeenCalled();
    });

    it("stays folded on a small screen once a point is placed, its focus on the unfold button", async () => {
        vi.stubGlobal("matchMedia", (query: string) => ({
            matches: query === "(max-width: 480px)",
        }));
        try {
            openIsochrone();
            el<HTMLButtonElement>("gl-isochrone__pick").click();
            map?.click(55.45, -20.88);
            expect(el("gl-isochrone__body").hidden).toBe(true);
            expect(document.activeElement).toBe(el("gl-isochrone__fold"));
            await settle();
            expect(asked).toHaveBeenCalledWith(
                expect.objectContaining({ origin: [55.45, -20.88] })
            );
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("unfolds on a small screen when the picking is left without a point", () => {
        vi.stubGlobal("matchMedia", () => ({ matches: true }));
        try {
            openIsochrone();
            el<HTMLButtonElement>("gl-isochrone__pick").click();
            press("Escape");
            expect(el("gl-isochrone__body").hidden).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("unfolds as it was: a window folded before the picking stays folded", () => {
        openIsochrone();
        el<HTMLButtonElement>("gl-isochrone__fold").click();
        el<HTMLButtonElement>("gl-isochrone__pick").click();
        press("Escape");
        expect(el("gl-isochrone__body").hidden).toBe(true);
    });
});

describe("Escape — one press, one gesture", () => {
    it("leaves the picking first, and keeps the window open", () => {
        openIsochrone();
        el<HTMLButtonElement>("gl-isochrone__pick").click();
        const event = press("Escape");
        expect(event.defaultPrevented).toBe(true);
        expect(map?.clickHandlers.size).toBe(0);
        expect(document.querySelector(".gl-isochrone__panel")).not.toBeNull();
    });

    it("then cancels the computation, and keeps the window open", async () => {
        answer = untilCancelled;
        openIsochrone();
        await fromMyPosition();
        el<HTMLButtonElement>("gl-isochrone__close").focus();
        press("Escape");
        await settle();
        expect(el("gl-isochrone__status").textContent).toBe("isochrone.status.cancelled");
        expect(document.querySelector(".gl-isochrone__panel")).not.toBeNull();
    });

    it("then closes the window — when the focus is in it", () => {
        openIsochrone();
        el<HTMLButtonElement>("gl-isochrone__fold").focus();
        press("Escape");
        expect(document.querySelector(".gl-isochrone")).toBeNull();
    });

    it("leaves the window open for an Escape meant for something else of the page", () => {
        openIsochrone();
        const event = press("Escape");
        expect(event.defaultPrevented).toBe(false);
        expect(document.querySelector(".gl-isochrone")).not.toBeNull();
    });

    it("is no longer heard once the window is closed", () => {
        openIsochrone();
        el<HTMLButtonElement>("gl-isochrone__pick").click();
        closeIsochrone();
        expect(map?.clickHandlers.size).toBe(0);
        expect(press("Escape").defaultPrevented).toBe(false);
    });
});

describe("one floating tool at a time", () => {
    it("says it opens, and closes when another tool opens", () => {
        const heard = vi.fn();
        document.addEventListener("geoleaf:submenu:open", heard);
        openIsochrone();
        expect(heard).toHaveBeenCalledTimes(1);
        expect((heard.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ id: "isochrone" });
        document.dispatchEvent(
            new CustomEvent("geoleaf:submenu:open", { detail: { id: "measure" } })
        );
        expect(document.querySelector(".gl-isochrone")).toBeNull();
        document.removeEventListener("geoleaf:submenu:open", heard);
    });

    it("keeps the zones when another tool closes it", async () => {
        openIsochrone();
        await fromMyPosition();
        await settle();
        document.dispatchEvent(
            new CustomEvent("geoleaf:submenu:open", { detail: { id: "measure" } })
        );
        expect(map?.layers).toHaveLength(3);
    });
});

describe("following the stack", () => {
    it("shows a change made through the API while it is open", async () => {
        openIsochrone();
        await fromMyPosition();
        await settle();
        const [top = ""] = listLayers().map((l) => l.id);
        moveLayer(top, 2);
        const ids = [...document.querySelectorAll<HTMLElement>(".gl-isochrone__row")].map(
            (r) => r.dataset.id
        );
        expect(ids).toEqual(listLayers().map((l) => l.id));
    });

    it("removes every zone, and says so", async () => {
        openIsochrone();
        await fromMyPosition();
        await settle();
        el<HTMLButtonElement>("gl-isochrone__clear").click();
        expect(map?.layers).toEqual([]);
        expect(el("gl-isochrone__status").textContent).toBe("isochrone.status.cleared");
        expect(document.activeElement).toBe(el("gl-isochrone__pick"));
    });

    it("stops following once closed: a zone drawn afterwards builds no row", async () => {
        openIsochrone();
        const detached = el("gl-isochrone__panel");
        closeIsochrone();
        await import("../controller.js").then((c) => c.computeIsochrone({ origin: [1, 2] }));
        expect(detached.querySelectorAll(".gl-isochrone__row")).toHaveLength(0);
        expect(listLayers()).toHaveLength(3);
    });
});

describe("folding", () => {
    it("folds and unfolds on its button, which says which it does", () => {
        openIsochrone();
        const fold = el<HTMLButtonElement>("gl-isochrone__fold");
        expect(fold.getAttribute("aria-expanded")).toBe("true");
        expect(fold.getAttribute("aria-label")).toBe("isochrone.panel.collapse");
        fold.click();
        expect(el("gl-isochrone__body").hidden).toBe(true);
        expect(fold.getAttribute("aria-expanded")).toBe("false");
        expect(fold.getAttribute("aria-label")).toBe("isochrone.panel.expand");
    });
});
