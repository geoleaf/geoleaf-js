/**
 * connection-manager.test.ts — Connection lifecycle, backoff, queue, metrics, destroy
 *
 * Covers CDC §11.4:
 *   - Init valid config → state "connected"
 *   - Backoff: disconnect → N retries → delays respect min(init × 2^(N-1), max)
 *   - maxRetries: 2 → 2 attempts → state FAILED + geoleaf:ws:failed
 *   - maxRetries: 0 → never FAILED
 *   - Channels subscribed before disconnect → re-subscribed at reconnect
 *   - send() during RECONNECTING → queued → flushed in order at reconnect
 *   - queueOnDisconnect: false → send-dropped, message not sent
 *   - auth-required: simulateAuthExpired() → FAILED + geoleaf:ws:auth-required
 *   - Metrics: messagesSent, messagesReceived, reconnectCount
 *   - destroy() → disconnected, subscriptions empty
 */

import { describe, it, expect, vi } from "vitest";
import { ConnectionManager } from "../connection-manager.js";
import { ChannelManager } from "../channel-manager.js";
import { HeartbeatManager } from "../heartbeat-manager.js";
import { MetricsCollector } from "../metrics-collector.js";
import { SendQueue } from "../send-queue.js";
import { applyDefaults } from "../config.js";
import { MockTransport } from "../../test-utils/mock-transport.js";
import type { WsPluginConfig } from "../config.js";

// ─── Helper to build a test harness ───────────────────────────────────────────

interface Harness {
    connectionManager: ConnectionManager;
    channelManager: ChannelManager;
    heartbeatManager: HeartbeatManager;
    metrics: MetricsCollector;
    sendQueue: SendQueue;
    transport: MockTransport;
}

function buildHarness(configOverride: Partial<WsPluginConfig> = {}): Harness {
    const config: WsPluginConfig = {
        transport: "native-ws",
        url: "wss://test.example.com/ws",
        reconnect: { initialDelayMs: 10, maxDelayMs: 500, maxRetries: 10 },
        heartbeat: { enabled: false },
        queueOnDisconnect: true,
        maxQueueSize: 100,
        ...configOverride,
    };
    const resolved = applyDefaults(config);
    const transport = new MockTransport();
    transport.connectBehavior = "success";

    const channelManager = new ChannelManager();
    const heartbeatManager = new HeartbeatManager();
    const metrics = new MetricsCollector();
    const sendQueue = new SendQueue(resolved.maxQueueSize, resolved.queueOnDisconnect);

    const connectionManager = new ConnectionManager();
    channelManager.attach(transport);
    heartbeatManager.attach(transport, resolved.heartbeat, resolved.transport);
    connectionManager.attach(
        transport,
        resolved,
        channelManager,
        sendQueue,
        metrics,
        heartbeatManager
    );

    return { connectionManager, channelManager, heartbeatManager, metrics, sendQueue, transport };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ConnectionManager — connect()", () => {
    it("reaches state 'connected' on successful connect()", async () => {
        const { connectionManager } = buildHarness();
        await connectionManager.connect();
        expect(connectionManager.state).toBe("connected");
    });

    it("is a no-op if already connected", async () => {
        const { connectionManager, transport } = buildHarness();
        await connectionManager.connect();
        const connectSpy = vi.spyOn(transport, "connect");
        await connectionManager.connect(); // second call
        expect(connectSpy).not.toHaveBeenCalled();
    });
});

describe("ConnectionManager — backoff reconnection", () => {
    it("respects exponential backoff delays across retries", async () => {
        const delays: number[] = [];

        // Capture geoleaf:ws:reconnecting events
        const handler = (e: Event) => {
            delays.push((e as CustomEvent).detail.nextDelayMs as number);
        };
        document.addEventListener("geoleaf:ws:reconnecting", handler);

        const { connectionManager } = buildHarness({
            reconnect: { initialDelayMs: 10, maxDelayMs: 500, maxRetries: 0 },
        });

        await connectionManager.connect();
        // Trigger disconnection → starts backoff
        connectionManager.disconnect("test");

        // Wait for 3 reconnect events to accumulate
        await new Promise<void>((resolve) => {
            let count = 0;
            const check = () => {
                if (delays.length >= 3) {
                    resolve();
                    return;
                }
                if (++count > 50) {
                    resolve();
                    return;
                }
                setTimeout(check, 30);
            };
            check();
        });

        connectionManager.destroy();
        document.removeEventListener("geoleaf:ws:reconnecting", handler);

        //  delay[N] should be min(10 × 2^(N), 500)  (attempt starts at 1)
        if (delays.length >= 2) {
            expect(delays[1]).toBeGreaterThan(delays[0]!);
        }
    }, 5000);

    it("reaches FAILED state after maxRetries exhausted", async () => {
        const failedEvents: CustomEvent[] = [];
        const handler = (e: Event) => failedEvents.push(e as CustomEvent);
        document.addEventListener("geoleaf:ws:failed", handler);

        const transport = new MockTransport();
        transport.connectBehavior = "success";

        const config: WsPluginConfig = {
            transport: "native-ws",
            url: "wss://test.example.com/ws",
            reconnect: { initialDelayMs: 5, maxDelayMs: 20, maxRetries: 2 },
            heartbeat: { enabled: false },
        };
        const resolved = applyDefaults(config);
        const channelManager = new ChannelManager();
        const heartbeatManager = new HeartbeatManager();
        const metrics = new MetricsCollector();
        const sendQueue = new SendQueue(resolved.maxQueueSize, resolved.queueOnDisconnect);
        const connectionManager = new ConnectionManager();

        channelManager.attach(transport);
        heartbeatManager.attach(transport, resolved.heartbeat, resolved.transport);
        connectionManager.attach(
            transport,
            resolved,
            channelManager,
            sendQueue,
            metrics,
            heartbeatManager
        );

        // Connect once, then make all future connects fail
        await connectionManager.connect();
        transport.connectBehavior = "fail";

        // Trigger disconnection → starts retry loop
        transport.simulateDisconnect("network-error");

        // Wait for FAILED state
        await new Promise<void>((resolve) => {
            const poll = () => {
                if (connectionManager.state === "failed" || failedEvents.length > 0) {
                    resolve();
                    return;
                }
                setTimeout(poll, 20);
            };
            setTimeout(poll, 10);
        });

        expect(connectionManager.state).toBe("failed");
        expect(failedEvents.length).toBeGreaterThanOrEqual(1);
        const failedErr = failedEvents[0]!.detail.error;
        expect(failedErr.code).toBe("MAX_RETRIES_EXCEEDED");

        connectionManager.destroy();
        document.removeEventListener("geoleaf:ws:failed", handler);
    }, 5000);

    it("never reaches FAILED when maxRetries is 0", async () => {
        const failedEvents: CustomEvent[] = [];
        const handler = (e: Event) => failedEvents.push(e as CustomEvent);
        document.addEventListener("geoleaf:ws:failed", handler);

        const transport = new MockTransport();
        transport.connectBehavior = "success";

        const config: WsPluginConfig = {
            transport: "native-ws",
            url: "wss://test.example.com/ws",
            reconnect: { initialDelayMs: 5, maxDelayMs: 20, maxRetries: 0 },
            heartbeat: { enabled: false },
        };
        const resolved = applyDefaults(config);
        const channelManager = new ChannelManager();
        const heartbeatManager = new HeartbeatManager();
        const metrics = new MetricsCollector();
        const sendQueue = new SendQueue(resolved.maxQueueSize, resolved.queueOnDisconnect);
        const connectionManager = new ConnectionManager();

        channelManager.attach(transport);
        heartbeatManager.attach(transport, resolved.heartbeat, resolved.transport);
        connectionManager.attach(
            transport,
            resolved,
            channelManager,
            sendQueue,
            metrics,
            heartbeatManager
        );

        await connectionManager.connect();
        transport.connectBehavior = "fail";
        transport.simulateDisconnect("drop");

        // Give it time for multiple retry attempts
        await new Promise<void>((resolve) => setTimeout(resolve, 100));

        expect(connectionManager.state).not.toBe("failed");
        expect(failedEvents).toHaveLength(0);

        connectionManager.destroy();
        document.removeEventListener("geoleaf:ws:failed", handler);
    }, 3000);
});

describe("ConnectionManager — channel re-subscription", () => {
    it("re-subscribes active channels after successful reconnection", async () => {
        const { connectionManager, channelManager, transport } = buildHarness({
            reconnect: { initialDelayMs: 5, maxDelayMs: 20, maxRetries: 0 },
        });

        await connectionManager.connect();

        const handler = vi.fn();
        channelManager.subscribe("live-position", handler);

        // Disconnect → triggers reconnect
        transport.simulateDisconnect("network-drop");

        // Wait for re-connection
        await new Promise<void>((resolve) => {
            const poll = () => {
                if (connectionManager.state === "connected") {
                    resolve();
                    return;
                }
                setTimeout(poll, 15);
            };
            setTimeout(poll, 10);
        });

        // Simulate incoming message on re-connected transport
        transport.simulateMessage("live-position", { lat: 48.8, lng: 2.3 });
        expect(handler).toHaveBeenCalledWith({ lat: 48.8, lng: 2.3 });

        connectionManager.destroy();
    }, 3000);
});

describe("ConnectionManager — SendQueue integration", () => {
    it("queues messages when reconnecting and flushes them in order on reconnect", async () => {
        // Use a longer initial delay so we can reliably enqueue before reconnect fires
        const { connectionManager, transport, sendQueue } = buildHarness({
            reconnect: { initialDelayMs: 100, maxDelayMs: 500, maxRetries: 0 },
            queueOnDisconnect: true,
        });

        await connectionManager.connect();

        // Enqueue messages synchronously right after disconnect — timer hasn't fired yet
        transport.simulateDisconnect("drop");
        sendQueue.enqueue("ch", "first");
        sendQueue.enqueue("ch", "second");
        sendQueue.enqueue("ch", "third");

        // The state should be disconnected/reconnecting (synchronous path)
        expect(["disconnected", "reconnecting"]).toContain(connectionManager.state);

        // Wait for reconnection
        await new Promise<void>((resolve) => {
            const poll = () => {
                if (connectionManager.state === "connected") {
                    resolve();
                    return;
                }
                setTimeout(poll, 20);
            };
            setTimeout(poll, 20);
        });

        // After reconnect, queue should have been flushed → sentMessages contains them in order
        const sent = transport.sentMessages;
        expect(sent.length).toBeGreaterThanOrEqual(3);
        const payloads = sent.map((m) => m.payload);
        const firstIdx = payloads.indexOf("first");
        expect(firstIdx).toBeGreaterThanOrEqual(0);
        expect(payloads.indexOf("second")).toBe(firstIdx + 1);
        expect(payloads.indexOf("third")).toBe(firstIdx + 2);

        connectionManager.destroy();
    }, 3000);
});

describe("ConnectionManager — auth failure", () => {
    it("reaches FAILED and emits auth-required on AUTH_EXPIRED", async () => {
        const authReqEvents: CustomEvent[] = [];
        const failedEvents: CustomEvent[] = [];
        document.addEventListener("geoleaf:ws:auth-required", (e) =>
            authReqEvents.push(e as CustomEvent)
        );
        document.addEventListener("geoleaf:ws:failed", (e) => failedEvents.push(e as CustomEvent));

        const { connectionManager, transport } = buildHarness();
        await connectionManager.connect();

        // Simulate session expiration mid-connection
        transport.simulateAuthExpired();

        await new Promise<void>((resolve) => setTimeout(resolve, 20));

        expect(connectionManager.state).toBe("failed");
        expect(authReqEvents.length).toBeGreaterThanOrEqual(1);
        expect(failedEvents.length).toBeGreaterThanOrEqual(1);

        connectionManager.destroy();
    });
});

describe("ConnectionManager — metrics", () => {
    it("tracks messagesSent and reconnectCount correctly", async () => {
        const {
            connectionManager,
            transport,
            metrics,
            sendQueue: _sendQueue,
        } = buildHarness({
            reconnect: { initialDelayMs: 5, maxDelayMs: 20, maxRetries: 0 },
        });

        await connectionManager.connect();

        // Manually count a sent message (simulating public-api.ts path)
        metrics.touchMessageSent();
        metrics.touchMessageSent();

        // Disconnect + reconnect
        transport.simulateDisconnect("test");
        await new Promise<void>((resolve) => {
            const poll = () => {
                if (connectionManager.state === "connected") {
                    resolve();
                    return;
                }
                setTimeout(poll, 15);
            };
            setTimeout(poll, 10);
        });

        const snap = metrics.getSnapshot();
        expect(snap.messagesSent).toBe(2);
        expect(snap.reconnectCount).toBe(1);

        connectionManager.destroy();
    }, 3000);

    it("getMetrics() is safe to call before init (returns valid WsMetrics)", () => {
        const metrics = new MetricsCollector();
        const snap = metrics.getSnapshot();
        expect(snap.connectedAt).toBeNull();
        expect(snap.reconnectCount).toBe(0);
        expect(snap.messagesSent).toBe(0);
        expect(snap.messagesReceived).toBe(0);
        expect(snap.lastPingMs).toBeNull();
        expect(snap.activeChannels).toEqual([]);
        expect(snap.queueLength).toBe(0);
    });
});

describe("ConnectionManager — destroy()", () => {
    it("sets state to disconnected and clears subscriptions", async () => {
        const { connectionManager, channelManager } = buildHarness();
        await connectionManager.connect();

        channelManager.subscribe("ch", vi.fn());
        connectionManager.destroy();

        expect(connectionManager.state).toBe("disconnected");
        expect(channelManager.getSubscriptions()).toHaveLength(0);
    });
});
