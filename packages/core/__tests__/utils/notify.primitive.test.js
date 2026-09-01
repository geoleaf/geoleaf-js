/**
 * notify.primitive.ts unit tests.
 * Tests: file before renderer, flush, console fallback, registerRenderer idempotency.
 */
"use strict";

import { createNotifyPrimitive } from "../../src/utils/notify/notify.primitive.js";

describe("notify.primitive", () => {
    let primitive;

    beforeEach(() => {
        primitive = createNotifyPrimitive();
    });

    // ── Console fallback ────────────────────────────────────────────────────

    it("console.info appelé pour level 'info' sans renderer", () => {
        const spy = vi.spyOn(console, "info").mockImplementation(() => {});
        primitive.notify("hello", "info");
        expect(spy).toHaveBeenCalledWith("[GeoLeaf]", "hello");
        spy.mockRestore();
    });

    it("console.warn appelé pour level 'warning' sans renderer", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        primitive.notify("attention", "warning");
        expect(spy).toHaveBeenCalledWith("[GeoLeaf]", "attention");
        spy.mockRestore();
    });

    it("console.error appelé pour level 'error' sans renderer", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        primitive.notify("crash", "error");
        expect(spy).toHaveBeenCalledWith("[GeoLeaf]", "crash");
        spy.mockRestore();
    });

    it("level par défaut est 'info'", () => {
        const spy = vi.spyOn(console, "info").mockImplementation(() => {});
        primitive.notify("default level");
        expect(spy).toHaveBeenCalledWith("[GeoLeaf]", "default level");
        spy.mockRestore();
    });

    // ── File (buffering) ────────────────────────────────────────────────────

    it("messages mis en file avant registerRenderer", () => {
        vi.spyOn(console, "info").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});

        primitive.notify("msg1", "info");
        primitive.notify("msg2", "warning");

        const renderer = vi.fn();
        primitive.registerRenderer(renderer);

        expect(renderer).toHaveBeenCalledTimes(2);
        expect(renderer).toHaveBeenNthCalledWith(1, "msg1", "info");
        expect(renderer).toHaveBeenNthCalledWith(2, "msg2", "warning");

        vi.restoreAllMocks();
    });

    it("file vide après flush", () => {
        vi.spyOn(console, "info").mockImplementation(() => {});

        primitive.notify("queued");

        const renderer = vi.fn();
        primitive.registerRenderer(renderer);
        expect(renderer).toHaveBeenCalledTimes(1);

        // Second call should not re-flush
        primitive.flush();
        expect(renderer).toHaveBeenCalledTimes(1);

        vi.restoreAllMocks();
    });

    // ── Renderer direct ─────────────────────────────────────────────────────

    it("renderer appelé directement après enregistrement", () => {
        const renderer = vi.fn();
        primitive.registerRenderer(renderer);

        primitive.notify("direct msg", "success");

        expect(renderer).toHaveBeenCalledWith("direct msg", "success");
    });

    it("messages post-registerRenderer ne passent pas par la file", () => {
        vi.spyOn(console, "info").mockImplementation(() => {});

        const renderer = vi.fn();
        primitive.registerRenderer(renderer);

        primitive.notify("live", "info");
        // flush should find nothing new to send
        primitive.flush();

        expect(renderer).toHaveBeenCalledTimes(1);
        expect(renderer).toHaveBeenCalledWith("live", "info");

        vi.restoreAllMocks();
    });

    // ── registerRenderer idempotency ────────────────────────────────────────

    it("registerRenderer remplace le renderer précédent", () => {
        const renderer1 = vi.fn();
        const renderer2 = vi.fn();

        primitive.registerRenderer(renderer1);
        primitive.registerRenderer(renderer2);

        primitive.notify("after swap", "error");

        expect(renderer1).not.toHaveBeenCalledWith("after swap", "error");
        expect(renderer2).toHaveBeenCalledWith("after swap", "error");
    });

    // ── flush sans renderer ─────────────────────────────────────────────────

    it("flush sans renderer est sans effet", () => {
        // Should not throw
        expect(() => primitive.flush()).not.toThrow();
    });

    // ── Renderer that throws an exception ───────────────────────────────────

    it("renderer qui lève une exception → fallback console (notify direct)", () => {
        const faultyRenderer = vi.fn().mockImplementation(() => {
            throw new Error("renderer failure");
        });
        primitive.registerRenderer(faultyRenderer);

        const spy = vi.spyOn(console, "info").mockImplementation(() => {});
        expect(() => primitive.notify("fail msg", "info")).not.toThrow();
        expect(spy).toHaveBeenCalledWith("[GeoLeaf]", "fail msg");

        spy.mockRestore();
    });

    it("renderer qui lève une exception lors du flush → fallback console", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        primitive.notify("buffered", "warning");

        const faultyRenderer = vi.fn().mockImplementation(() => {
            throw new Error("flush failure");
        });

        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(() => primitive.registerRenderer(faultyRenderer)).not.toThrow();
        expect(spy).toHaveBeenCalledWith("[GeoLeaf]", "buffered");

        vi.restoreAllMocks();
    });
});
