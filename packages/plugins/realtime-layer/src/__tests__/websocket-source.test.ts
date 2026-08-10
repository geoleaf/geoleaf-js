/**
 * websocket-source.test.ts — tests for WebSocketSource (GeoLeaf.Ws bridge).
 * The websocket plugin (GeoLeaf.Ws) is mocked on globalThis.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketSource } from "../sources/websocket-source.js";

type GLGlobal = { GeoLeaf?: { Ws?: { subscribe?: unknown } } };

describe("WebSocketSource", () => {
    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete (globalThis as GLGlobal).GeoLeaf;
    });

    it("subscribes to the channel and forwards data to the handler", () => {
        let captured: ((d: unknown) => void) | undefined;
        const unsubscribe = vi.fn();
        const subscribe = vi.fn((_ch: string, cb: (d: unknown) => void) => {
            captured = cb;
            return unsubscribe;
        });
        (globalThis as GLGlobal).GeoLeaf = { Ws: { subscribe } };

        const handler = vi.fn();
        const src = new WebSocketSource("vehicles");
        src.onData(handler);
        src.start();

        expect(subscribe).toHaveBeenCalledWith("vehicles", expect.any(Function));
        captured?.({ id: 1 });
        expect(handler).toHaveBeenCalledWith({ id: 1 });

        src.stop();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("logs an error when the websocket plugin is not loaded", () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        delete (globalThis as GLGlobal).GeoLeaf;
        const src = new WebSocketSource("vehicles");
        src.onData(vi.fn());
        src.start();
        expect(err).toHaveBeenCalled();
    });

    it("logs an error when GeoLeaf.Ws.subscribe is not a function", () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        (globalThis as GLGlobal).GeoLeaf = { Ws: { subscribe: 42 } };
        const src = new WebSocketSource("vehicles");
        src.onData(vi.fn());
        src.start();
        expect(err).toHaveBeenCalled();
    });

    it("does nothing when no handler is registered", () => {
        const subscribe = vi.fn();
        (globalThis as GLGlobal).GeoLeaf = { Ws: { subscribe } };
        const src = new WebSocketSource("vehicles");
        src.start();
        expect(subscribe).not.toHaveBeenCalled();
    });

    it("stop() is a no-op when never started", () => {
        const src = new WebSocketSource("vehicles");
        expect(() => src.stop()).not.toThrow();
    });
});
