/**
 * Tests for flow.ts — the print flow, and what closes it.
 *
 * ## The defect this pins
 *
 * A print flow is an overlay in the map container, with listeners on `document`, then a modal
 * in `<body>`. `GeoLeaf.mount()` unmounts the application by destroying the core's module
 * registry, and nothing of it reached a flow left open: measured in a real browser, the area
 * selector was still DISPLAYED over the place the map had been, and still there after the next
 * mount. `closePrintFlows()` is what the module the entry registers calls.
 *
 * The selector and the modal are the real ones' neighbours: the selector is real, the modal is
 * a stub whose promise the test settles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getNativeMap: vi.fn<() => unknown>(() => null),
    openModal: vi.fn(),
    closeOpenModal: vi.fn(),
}));

vi.mock("../internal.js", () => ({ _getNativeMap: mocks.getNativeMap }));
vi.mock("../modal-open.js", () => ({
    openModal: mocks.openModal,
    closeOpenModal: mocks.closeOpenModal,
}));

import { closePrintFlows, openPrintFlow } from "../flow.js";

const RECT = { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 };

let container: HTMLElement;
/** Settles the stubbed modal — what the user does in it. */
let settleModal: (result: Blob | null | "redefine") => void;

function overlays(): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>(".gl-emprise-overlay")];
}

function displayed(): number {
    return overlays().filter((el) => el.style.display !== "none").length;
}

function mouse(type: string, target: EventTarget, clientX: number, clientY: number): void {
    target.dispatchEvent(new MouseEvent(type, { clientX, clientY, button: 0, bubbles: true }));
}

/** Draws an area and confirms it: the flow moves on to the modal. */
function drawAndValidate(): void {
    const overlay = overlays()[0]!;
    mouse("mousedown", overlay, 50, 50);
    mouse("mousemove", document, 250, 200);
    mouse("mouseup", document, 250, 200);
    (container.querySelector(".gl-emprise-ok") as HTMLButtonElement).click();
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    container = document.createElement("div");
    container.getBoundingClientRect = () => RECT as DOMRect;
    document.body.appendChild(container);
    mocks.getNativeMap.mockReturnValue({
        getContainer: () => container,
        unproject: () => ({ lng: 2.35, lat: 48.85 }),
        getZoom: () => 12,
        getCenter: () => ({ lng: 2.35, lat: 48.85 }),
        getBearing: () => 0,
    });
    mocks.openModal.mockImplementation(
        () =>
            new Promise((resolve) => {
                settleModal = resolve;
            })
    );
    // The real `closeOpenModal` resolves the modal's promise with `null`.
    mocks.closeOpenModal.mockImplementation(() => settleModal?.(null));
});

afterEach(() => {
    closePrintFlows();
    document.body.innerHTML = "";
});

describe("openPrintFlow", () => {
    it("opens the area selector in the map container", () => {
        void openPrintFlow();
        expect(displayed()).toBe(1);
    });

    it("resolves null without a map", async () => {
        mocks.getNativeMap.mockReturnValue(null);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(await openPrintFlow()).toBeNull();
        expect(overlays()).toHaveLength(0);
    });

    it("🛑 a cancelled flow leaves NO overlay behind — it used to hide it, one per flow", async () => {
        const flow = openPrintFlow();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(await flow).toBeNull();
        expect(overlays()).toHaveLength(0);
    });

    it("an exported flow resolves with the blob, and removes its overlay", async () => {
        const flow = openPrintFlow();
        drawAndValidate();
        expect(mocks.openModal).toHaveBeenCalledTimes(1);
        const blob = new Blob(["x"]);
        settleModal(blob);
        expect(await flow).toBe(blob);
        expect(overlays()).toHaveLength(0);
    });

    it("« redefine » shows the selector again, and keeps the flow open", async () => {
        void openPrintFlow();
        drawAndValidate();
        expect(displayed()).toBe(0);
        settleModal("redefine");
        await Promise.resolve();
        await Promise.resolve();
        expect(displayed()).toBe(1);
    });
});

describe("closePrintFlows — the application is unmounted", () => {
    it("🛑 closes a flow whose SELECTOR is open: overlay removed, listeners released, null", async () => {
        const flow = openPrintFlow();
        expect(displayed()).toBe(1);

        closePrintFlows();

        expect(await flow).toBeNull();
        expect(overlays()).toHaveLength(0);
        // The selector no longer hears `document`: nothing is left to cancel.
        expect(() =>
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
        ).not.toThrow();
    });

    it("🛑 closes a flow whose MODAL is open, and the selector with it", async () => {
        const flow = openPrintFlow();
        drawAndValidate();

        closePrintFlows();

        expect(mocks.closeOpenModal).toHaveBeenCalledTimes(1);
        expect(await flow).toBeNull();
        expect(overlays()).toHaveLength(0);
    });

    it("closes every flow still open", async () => {
        const first = openPrintFlow();
        const second = openPrintFlow();
        expect(overlays()).toHaveLength(2);

        closePrintFlows();

        expect(await first).toBeNull();
        expect(await second).toBeNull();
        expect(overlays()).toHaveLength(0);
    });

    it("does nothing when no flow is open — and forgets a flow that already ended", async () => {
        expect(() => closePrintFlows()).not.toThrow();
        const flow = openPrintFlow();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await flow;
        closePrintFlows();
        expect(mocks.closeOpenModal).not.toHaveBeenCalled();
    });

    it("the next flow opens normally after a teardown", async () => {
        void openPrintFlow();
        closePrintFlows();
        void openPrintFlow();
        expect(displayed()).toBe(1);
    });
});
