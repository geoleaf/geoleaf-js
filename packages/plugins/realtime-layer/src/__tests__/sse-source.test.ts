/**
 * sse-source.test.ts — tests for SseSource (EventSource bridge).
 * EventSource is mocked since it is a browser-only global.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SseSource } from "../sources/sse-source.js";

class MockEventSource {
    static instances: MockEventSource[] = [];
    url: string;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;

    constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
    }

    close(): void {
        this.closed = true;
    }
}

describe("SseSource", () => {
    beforeEach(() => {
        MockEventSource.instances = [];
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("opens an EventSource and forwards message data to the handler", () => {
        vi.stubGlobal("EventSource", MockEventSource);
        const handler = vi.fn();
        const src = new SseSource("https://sse/stream");
        src.onData(handler);
        src.start();

        expect(MockEventSource.instances).toHaveLength(1);
        const es = MockEventSource.instances[0];
        expect(es.url).toBe("https://sse/stream");

        es.onmessage?.({ data: "payload" });
        expect(handler).toHaveBeenCalledWith("payload");
    });

    it("does not throw on message when no handler is registered", () => {
        vi.stubGlobal("EventSource", MockEventSource);
        const src = new SseSource("https://sse/stream");
        src.start();
        const es = MockEventSource.instances[0];
        expect(() => es.onmessage?.({ data: "x" })).not.toThrow();
    });

    it("is idempotent — a second start() does not open a new EventSource", () => {
        vi.stubGlobal("EventSource", MockEventSource);
        const src = new SseSource("https://sse/stream");
        src.start();
        src.start();
        expect(MockEventSource.instances).toHaveLength(1);
    });

    it("logs a warning on connection error", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubGlobal("EventSource", MockEventSource);
        const src = new SseSource("https://sse/stream");
        src.start();
        MockEventSource.instances[0].onerror?.();
        expect(warn).toHaveBeenCalled();
    });

    it("closes the EventSource on stop() and allows reopening afterwards", () => {
        vi.stubGlobal("EventSource", MockEventSource);
        const src = new SseSource("https://sse/stream");
        src.start();
        const first = MockEventSource.instances[0];
        src.stop();
        expect(first.closed).toBe(true);
        src.start();
        expect(MockEventSource.instances).toHaveLength(2);
    });

    it("stop() is a no-op when never started", () => {
        const src = new SseSource("https://sse/stream");
        expect(() => src.stop()).not.toThrow();
    });

    it("logs an error and does nothing when EventSource is unavailable", () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.stubGlobal("EventSource", undefined);
        const handler = vi.fn();
        const src = new SseSource("https://sse/stream");
        src.onData(handler);
        src.start();
        expect(err).toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
    });
});
