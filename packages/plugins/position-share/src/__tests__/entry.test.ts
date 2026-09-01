/**
 * @geoleaf-plugins/position-share — public surface and configuration
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { buildPublicApi } from "../public-api.js";
import { validateConfig, type PluginConfig } from "../config.js";
import {
    registerTransport,
    resolveTransport,
    registeredTransports,
} from "../transports/registry.js";

/** A configuration that is complete for the HTTP transport. */
function cfg(over: Partial<PluginConfig> = {}): PluginConfig {
    return {
        enabled: true,
        mode: "manual",
        transport: "http",
        endpoint: "https://example.test/positions",
        intervalMs: 30000,
        minDistanceM: 10,
        showButton: true,
        receive: { enabled: false },
        ...over,
    };
}

describe("public API", () => {
    it("exposes the documented surface", () => {
        const api = buildPublicApi();
        expect(typeof api.getConfig).toBe("function");
        expect(typeof api.getClientId).toBe("function");
        expect(typeof api.clearClientId).toBe("function");
        expect(typeof api.registerTransport).toBe("function");
        expect(typeof api.listTransports).toBe("function");
    });
});

describe("clearClientId — right to erasure (RGPD art. 17)", () => {
    it("forgets the identifier so a fresh one is minted on the next read", () => {
        const api = buildPublicApi();
        const first = api.getClientId();
        expect(first).toMatch(/^loc:/);

        api.clearClientId();

        const second = api.getClientId();
        expect(second).toMatch(/^loc:/);
        // A cleared identifier must not come back: cache emptied AND storage removed.
        expect(second).not.toBe(first);
    });
});

describe("configuration validation", () => {
    it("accepts an HTTP transport that carries its endpoint", () => {
        expect(validateConfig(cfg())).toEqual([]);
    });

    it("rejects an HTTP transport with no endpoint", () => {
        const problems = validateConfig(cfg({ endpoint: undefined }));
        expect(problems).toHaveLength(1);
        expect(problems[0].key).toBe("endpoint");
    });

    it("rejects a WebSocket transport with no channel", () => {
        const problems = validateConfig(cfg({ transport: "websocket", channel: undefined }));
        expect(problems).toHaveLength(1);
        expect(problems[0].key).toBe("channel");
    });

    // The point of the open registry: a key nobody knows yet is NOT a configuration error,
    // because a third-party transport registers after the profile is read.
    it("does not reject an unknown transport key", () => {
        expect(validateConfig(cfg({ transport: "my-backend" }))).toEqual([]);
    });
});

describe("transport registry", () => {
    beforeEach(() => {
        // Re-registering under the same key replaces the factory — that IS the override path.
        registerTransport("test-transport", () => ({ send: vi.fn(async () => {}) }));
    });

    it("resolves a registered transport", () => {
        const t = resolveTransport(cfg({ transport: "test-transport" }));
        expect(t).not.toBeNull();
        expect(typeof t?.send).toBe("function");
    });

    it("returns null for a key nobody registered", () => {
        expect(resolveTransport(cfg({ transport: "nobody-registered-this" }))).toBeNull();
    });

    it("lists the registered keys", () => {
        expect(registeredTransports()).toContain("test-transport");
    });
});
