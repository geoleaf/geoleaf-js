/**
 * channel-manager.test.ts — Channel subscription and re-subscription
 *
 * Covers CDC §11.4:
 *   - Channels subscribed before disconnect → re-subscribed after reconnect
 */

import { describe, it, expect, vi } from "vitest";
import { ChannelManager } from "../channel-manager.js";
import { MockTransport } from "../../test-utils/mock-transport.js";

describe("ChannelManager", () => {
    it("subscribes a handler and calls it on incoming messages", () => {
        const transport = new MockTransport();
        const manager = new ChannelManager();
        manager.attach(transport);

        const handler = vi.fn();
        manager.subscribe("chan-a", handler);

        transport.simulateMessage("chan-a", { x: 1 });
        expect(handler).toHaveBeenCalledWith({ x: 1 });
    });

    it("replaces handler when subscribing to the same channel twice", () => {
        const transport = new MockTransport();
        const manager = new ChannelManager();
        manager.attach(transport);

        const h1 = vi.fn();
        const h2 = vi.fn();
        manager.subscribe("chan-a", h1);
        manager.subscribe("chan-a", h2);

        transport.simulateMessage("chan-a", "hello");
        expect(h1).not.toHaveBeenCalled();
        expect(h2).toHaveBeenCalledWith("hello");
    });

    it("unsubscribe function is idempotent", () => {
        const transport = new MockTransport();
        const manager = new ChannelManager();
        manager.attach(transport);

        const handler = vi.fn();
        const unsub = manager.subscribe("chan-a", handler);
        unsub();
        unsub(); // second call must not throw
        transport.simulateMessage("chan-a", "x");
        expect(handler).not.toHaveBeenCalled();
    });

    it("unsubscribe() by name is a no-op for unknown channel", () => {
        const manager = new ChannelManager();
        expect(() => manager.unsubscribe("not-subscribed")).not.toThrow();
    });

    it("resubscribeAll() wires active subscriptions to new transport instance", () => {
        const transport1 = new MockTransport();
        const transport2 = new MockTransport();
        const manager = new ChannelManager();
        manager.attach(transport1);

        const handler = vi.fn();
        manager.subscribe("chan-b", handler);

        // Simulate reconnect: attach new transport and resubscribe
        manager.attach(transport2);
        manager.resubscribeAll();

        // Old transport no longer delivers
        transport1.simulateMessage("chan-b", "old");
        expect(handler).not.toHaveBeenCalled();

        // New transport delivers
        transport2.simulateMessage("chan-b", "new");
        expect(handler).toHaveBeenCalledWith("new");
    });

    it("getSubscriptions() returns names of all active channels", () => {
        const manager = new ChannelManager();
        manager.subscribe("a", vi.fn());
        manager.subscribe("b", vi.fn());
        expect(manager.getSubscriptions()).toEqual(expect.arrayContaining(["a", "b"]));
    });

    it("clear() removes all subscriptions", () => {
        const transport = new MockTransport();
        const manager = new ChannelManager();
        manager.attach(transport);
        manager.subscribe("a", vi.fn());
        manager.clear();
        expect(manager.getSubscriptions()).toHaveLength(0);
    });
});
