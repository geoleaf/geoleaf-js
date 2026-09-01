/**
 * Witness — a boot that FAILED to load its configuration must not announce a success.
 *
 * ## Why this is not the guard next door
 *
 * `config-load-failure-attribution.test.ts` pins that the failure NAMES its consequence. It
 * deliberately does not change the control flow, and says so on its face. This file pins the
 * other half — the half that makes the failure legible rather than merely documented.
 *
 * ## The defect, measured
 *
 * `Config.loadUrl`'s `catch` RESOLVES instead of rejecting (`config-loaders.ts`). The
 * whole chain above it already rejects correctly — `_initFromUrl` re-throws, the
 * initialisation manager re-throws, `bootWithPreset` has its abort path. That single `catch`
 * is therefore the one site where a failure turns into a success, and
 * `initialization-manager.ts` is where the success is announced. An integrator reads
 * "Configuration loaded successfully", then five consequence errors, and goes hunting the map.
 *
 * 🛑 **RED on purpose until the loader stops swallowing.** Seeing it red is what proves the
 * contradiction is real rather than argued.
 */
vi.mock("../../src/utils/log/index.ts", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

const { APIInitializationManager } = await import("../../src/kernel/api/initialization-manager.ts");
const { Config } = await import("../../src/kernel/config/geoleaf-config/config-loaders.ts");
const { ConfigLoader } = await import("../../src/kernel/config/loader.ts");
const { Log } = await import("../../src/utils/log/index.ts");

describe("config load — the contradiction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("does not announce a success after the loader has failed", async () => {
        vi.spyOn(ConfigLoader, "loadUrl").mockRejectedValue(new Error("Content-Type invalide"));
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});

        const manager = new APIInitializationManager();
        const getModule = (name: string) => (name === "Config" ? Config : null);

        await manager
            .loadConfig({ url: "/profiles/geoleaf.config.json" }, getModule as never)
            .catch(() => undefined);

        errors.mockRestore();

        const announced = (Log.info as unknown as { mock: { calls: unknown[][] } }).mock.calls
            .map((c) => c.map(String).join(" "))
            .join("\n");

        expect(announced).not.toContain("Configuration loaded successfully");
    });
});
