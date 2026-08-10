/**
 * heartbeat-manager.test.ts — Ping/pong keep-alive
 *
 * Covers CDC §11.4:
 *   - Ping resolves → no heartbeat-timeout
 *   - ping() never resolves within timeoutMs → heartbeat-timeout + disconnect triggered
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { HeartbeatManager } from "../heartbeat-manager.js";
import { MockTransport } from "../../test-utils/mock-transport.js";

describe("HeartbeatManager", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("does not emit heartbeat-timeout when ping resolves successfully", async () => {
        const transport = new MockTransport();
        transport.pingLatencyMs = 5;

        const mgr = new HeartbeatManager();
        mgr.attach(transport, { enabled: true, intervalMs: 50, timeoutMs: 30 }, "native-ws");

        const timeoutEvents: Event[] = [];
        const handler = (e: Event) => timeoutEvents.push(e);
        document.addEventListener("geoleaf:ws:heartbeat-timeout", handler);

        mgr.start();
        // Wait for one interval + ping round-trip
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        mgr.stop();

        expect(timeoutEvents).toHaveLength(0);
        document.removeEventListener("geoleaf:ws:heartbeat-timeout", handler);
    });

    it("emits heartbeat-timeout and calls disconnect when ping never resolves", async () => {
        const transport = new MockTransport();
        // Make ping never resolve — simulate infinite timeout
        vi.spyOn(transport, "ping").mockReturnValue(new Promise(() => {}));
        const disconnectSpy = vi.spyOn(transport, "disconnect");

        const timeoutEvents: CustomEvent[] = [];
        const evtHandler = (e: Event) => timeoutEvents.push(e as CustomEvent);
        document.addEventListener("geoleaf:ws:heartbeat-timeout", evtHandler);

        const mgr = new HeartbeatManager();
        // Short timeout so the test finishes fast
        mgr.attach(transport, { enabled: true, intervalMs: 30, timeoutMs: 20 }, "my-transport");
        mgr.start();

        // Wait for interval + timeout to elapse
        await new Promise<void>((resolve) => setTimeout(resolve, 120));
        mgr.stop();

        expect(timeoutEvents.length).toBeGreaterThanOrEqual(1);
        expect(disconnectSpy).toHaveBeenCalledWith("heartbeat-timeout");
        // The event reports the CONFIGURED transport key, not a hardcoded "native-ws".
        expect(timeoutEvents[0].detail).toMatchObject({ transport: "my-transport" });

        document.removeEventListener("geoleaf:ws:heartbeat-timeout", evtHandler);
    });

    it("is a no-op when disabled", async () => {
        const transport = new MockTransport();
        const pingSpy = vi.spyOn(transport, "ping");

        const mgr = new HeartbeatManager();
        mgr.attach(transport, { enabled: false, intervalMs: 30, timeoutMs: 10 }, "native-ws");
        mgr.start();

        await new Promise<void>((resolve) => setTimeout(resolve, 80));
        mgr.stop();

        expect(pingSpy).not.toHaveBeenCalled();
    });

    it("stop() prevents further ticks after being called", async () => {
        const transport = new MockTransport();
        const pingSpy = vi.spyOn(transport, "ping").mockResolvedValue(undefined);

        const mgr = new HeartbeatManager();
        mgr.attach(transport, { enabled: true, intervalMs: 30, timeoutMs: 20 }, "native-ws");
        mgr.start();

        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        mgr.stop();
        const callsBefore = pingSpy.mock.calls.length;

        await new Promise<void>((resolve) => setTimeout(resolve, 80));
        expect(pingSpy.mock.calls.length).toBe(callsBefore);
    });
});
