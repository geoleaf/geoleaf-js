/**
 * @geoleaf-plugins/routing — the two engines register themselves
 *
 * The registry is a door for engines this package does not know. These assertions pin that the
 * two it DOES know come through it without the host being asked to do anything: a plugin whose
 * built-ins only work once someone reads the README has a configuration that silently does
 * nothing.
 */
import { describe, it, expect, vi } from "vitest";

// `const` and not `let`: the mock returns this same object at every call, and
// no case below needs to replace it — the configuration travels through `createProvider`'s argument.
const _cfg: Record<string, unknown> = {};
vi.mock("@geoleaf/host-runtime", () => ({ coreConfigGet: () => _cfg }));

// Side-effect import: this is what registers them. Importing it IS the subject.
await import("../providers/builtins.js");
const { registeredProviders, createProvider } = await import("../provider.js");

/** A configuration with only the keys that matter here. */
function cfg(over: Record<string, unknown> = {}) {
    return {
        enabled: true,
        showButton: false,
        provider: "valhalla",
        endpoint: "",
        timeoutMs: 10000,
        ...over,
    } as never;
}

describe("built-in providers", () => {
    it("registers both engines, with no call from the host", () => {
        expect(registeredProviders().sort()).toEqual(["osrm", "valhalla"]);
    });

    it("builds each of them from the configuration alone", () => {
        expect(createProvider(cfg({ provider: "valhalla" }))?.id).toBe("valhalla");
        expect(createProvider(cfg({ provider: "osrm" }))?.id).toBe("osrm");
    });

    it("still refuses an engine nobody registered", () => {
        // The door being open does not mean anything walks through it.
        expect(createProvider(cfg({ provider: "tomtom" }))).toBeNull();
    });

    it("still refuses a non-HTTPS endpoint, registered engine or not", () => {
        expect(createProvider(cfg({ endpoint: "http://insecure.example" }))).toBeNull();
    });
});
