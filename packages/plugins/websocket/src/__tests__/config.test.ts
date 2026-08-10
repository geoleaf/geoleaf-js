/**
 * config.test.ts — WsPluginConfig validation
 *
 * Covers CDC §11.4:
 *   - URL ws:// in production → CONNECTION_REFUSED
 *   - Unknown transport → INVALID_TRANSPORT (via TransportRegistry)
 */

import { describe, it, expect } from "vitest";
import { validateConfig, WsConfigError } from "../config.js";
import { createTransport } from "../transports/transport-registry.js";
import type { WsPluginConfig } from "../config.js";

describe("validateConfig", () => {
    it("accepts a valid config with wss:// url", () => {
        const config: WsPluginConfig = { transport: "native-ws", url: "wss://example.com/ws" };
        expect(() => validateConfig(config)).not.toThrow();
    });

    it("accepts ws:// url when NODE_ENV !== production", () => {
        const original = process.env["NODE_ENV"];
        process.env["NODE_ENV"] = "development";
        const config: WsPluginConfig = { transport: "native-ws", url: "ws://localhost:8080" };
        expect(() => validateConfig(config)).not.toThrow();
        process.env["NODE_ENV"] = original;
    });

    it("throws CONNECTION_REFUSED for ws:// url in production", () => {
        const original = process.env["NODE_ENV"];
        process.env["NODE_ENV"] = "production";
        const config: WsPluginConfig = { transport: "native-ws", url: "ws://example.com/ws" };
        try {
            expect(() => validateConfig(config)).toThrow(WsConfigError);
            try {
                validateConfig(config);
            } catch (e) {
                expect(e).toBeInstanceOf(WsConfigError);
                expect((e as WsConfigError).wsError.code).toBe("CONNECTION_REFUSED");
            }
        } finally {
            process.env["NODE_ENV"] = original;
        }
    });

    it("throws CONNECTION_REFUSED when heartbeat.timeoutMs >= intervalMs", () => {
        const config: WsPluginConfig = {
            transport: "native-ws",
            url: "wss://example.com/ws",
            heartbeat: { enabled: true, intervalMs: 5000, timeoutMs: 5000 },
        };
        let caught: unknown;
        try {
            validateConfig(config);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(WsConfigError);
        expect((caught as WsConfigError).wsError.code).toBe("CONNECTION_REFUSED");
    });

    it("passes when heartbeat.timeoutMs < intervalMs", () => {
        const config: WsPluginConfig = {
            transport: "native-ws",
            url: "wss://example.com/ws",
            heartbeat: { enabled: true, intervalMs: 5000, timeoutMs: 4999 },
        };
        expect(() => validateConfig(config)).not.toThrow();
    });

    it("passes when heartbeat is disabled", () => {
        const config: WsPluginConfig = {
            transport: "native-ws",
            url: "wss://example.com/ws",
            heartbeat: { enabled: false, intervalMs: 5000, timeoutMs: 5000 },
        };
        expect(() => validateConfig(config)).not.toThrow();
    });
});

describe("createTransport — INVALID_TRANSPORT", () => {
    it("throws INVALID_TRANSPORT for an unknown transport key", () => {
        let caught: unknown;
        try {
            createTransport("no-such-transport");
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(WsConfigError);
        expect((caught as WsConfigError).wsError.code).toBe("INVALID_TRANSPORT");
    });

    it("succeeds for the built-in native-ws transport", () => {
        expect(() => createTransport("native-ws")).not.toThrow();
    });
});
