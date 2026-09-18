/**
 * Witness — `Events.on` and `Events.once` hand back the function that removes the listener.
 *
 * ## What this file pins
 *
 * The published contract `IEventBus.on` promises an unsubscribe function, while the facade
 * integrators actually reach (`GeoLeaf.Events`) returned `void`. A named handler could still
 * be removed through `off(event, handler)`, but an anonymous one never could, and a caller
 * that trusted the contract got `undefined` back — then a `TypeError` at teardown.
 *
 * The removal is `document.removeEventListener(event, handler)` on the SAME reference the
 * facade registered. Wrapping the handler would have given each subscription its own
 * identity, but `off(event, handler)` would then stop removing what `on` added: the
 * non-breaking half of the change is the `off` case below.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IEventBus } from "../../src/contracts/event-bus.contract.js";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { Events } = await import("../../src/api/geoleaf.events.ts");

// The subscription half of the published contract, checked by TTC. Written as an assignment
// and not as `satisfies` on the facade: an object literal checked with `satisfies` rejects
// `once` as an excess property, which the contract does not declare.
const subscriptionContract: Pick<IEventBus, "on" | "off"> = Events;

const TOGGLE = { layerId: "lyr", visible: true, source: "user" } as const;

/** Dispatches `geoleaf:layer:toggle` the way the bus does: a `CustomEvent` on `document`. */
function fireToggle(): void {
    document.dispatchEvent(new CustomEvent("geoleaf:layer:toggle", { detail: TOGGLE }));
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Events.on — the returned function unsubscribes", () => {
    it("removes the listener it registered", () => {
        const handler = vi.fn();
        // Typed as the contract promises: `IEventBus.on(...): () => void`.
        const unsubscribe: () => void = Events.on("geoleaf:layer:toggle", handler);

        fireToggle();
        unsubscribe();
        fireToggle();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("is harmless when called twice, and spares another listener of the same event", () => {
        const removed = vi.fn();
        const kept = vi.fn();
        const unsubscribe = Events.on("geoleaf:layer:toggle", removed);
        const unsubscribeKept = Events.on("geoleaf:layer:toggle", kept);

        unsubscribe();
        unsubscribe();
        fireToggle();
        unsubscribeKept();

        expect(removed).not.toHaveBeenCalled();
        expect(kept).toHaveBeenCalledTimes(1);
    });

    it("honours `IEventBus.on` when reached through the contract type", () => {
        const handler = vi.fn();
        const unsubscribe = subscriptionContract.on("geoleaf:layer:toggle", handler);

        unsubscribe();
        fireToggle();

        expect(handler).not.toHaveBeenCalled();
    });

    it("leaves `off(event, handler)` able to remove what `on` added", () => {
        const handler = vi.fn();
        Events.on("geoleaf:layer:toggle", handler);

        Events.off("geoleaf:layer:toggle", handler);
        fireToggle();

        expect(handler).not.toHaveBeenCalled();
    });
});

describe("Events.once — the returned function cancels a listener that has not fired", () => {
    it("cancels the pending listener", () => {
        const handler = vi.fn();
        const cancel: () => void = Events.once("geoleaf:layer:toggle", handler);

        cancel();
        fireToggle();

        expect(handler).not.toHaveBeenCalled();
    });

    it("still fires exactly once when left alone", () => {
        const handler = vi.fn();
        Events.once("geoleaf:layer:toggle", handler);

        fireToggle();
        fireToggle();

        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe("without a DOM", () => {
    it("`on` and `once` return a callable no-op rather than `undefined`", () => {
        vi.stubGlobal("document", undefined);

        const unsubscribe = Events.on("geoleaf:layer:toggle", vi.fn());
        const cancel = Events.once("geoleaf:layer:toggle", vi.fn());

        expect(typeof unsubscribe).toBe("function");
        expect(typeof cancel).toBe("function");
        expect(() => {
            unsubscribe();
            cancel();
        }).not.toThrow();
    });
});
