/**
 * Guard — a configuration that failed to load says SO, and says what follows.
 *
 * ## What the measurement actually found
 *
 * The register entry that opened this said the failure was silent: "no exception, no error code,
 * no trace". 🔻 **That is false, and measuring it mattered.** Simulated in a real browser with a
 * host router answering its own HTML in HTTP 200 on the configuration path, the console carries
 * two precise errors — the content-type check does its job and names what it received.
 *
 * 🛑 **The real defect is worse than silence: it is a CONTRADICTION.** Because the loader's
 * `catch` RESOLVES instead of rejecting, the initialisation manager then reports "Configuration
 * loaded successfully", and five consequence errors follow — no active profile, no map bounds,
 * adapter missing, UI skipped, registry failed. **None of them names the cause.** An integrator
 * reads a success, then five map failures, and goes hunting the map.
 *
 * ## 🔻 AMENDED on 19/08/2026 — the control flow WAS restored
 *
 * This guard used to pin that the loader RESOLVES, and said in as many words that restoring
 * the control flow "is a decision rather than a fix". The decision was taken: the `catch` now
 * rejects, the boot stops instead of degrading, and the contradiction is impossible rather
 * than merely legible. It is a breaking change, and it is assumed.
 *
 * 🛑 **What that forced, and it is the part worth reading.** The failure message used to say
 * "the boot continues on the configuration in place […] the errors that follow are its
 * CONSEQUENCES". Once the boot stops, that sentence is FALSE — there are no consequence
 * errors any more. A stale sentence inside an error message is worse than no message: it
 * sends the reader looking for failures that will not happen. So the message was rewritten
 * with the behaviour, and this guard follows it. No gate could have caught that — nothing
 * checks whether a sentence is still true.
 *
 * What survives unchanged is the reason this guard exists: the failure must NAME the cause,
 * so that whoever reads the console knows which request failed and why.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { Config } = await import("../../src/kernel/config/geoleaf-config/config-loaders.ts");
const { ConfigLoader } = await import("../../src/kernel/config/loader.ts");

describe("config load failure — attribution", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("rejects rather than resolving — a failed load must not read as a success", async () => {
        vi.spyOn(ConfigLoader, "loadUrl").mockRejectedValue(new Error("Content-Type invalide"));
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        await expect(Config.loadUrl("/profiles/geoleaf.config.json")).rejects.toThrow(
            "Content-Type invalide"
        );
        errors.mockRestore();
    });

    it("names the URL, says the boot STOPS, and points at the probable cause", async () => {
        vi.spyOn(ConfigLoader, "loadUrl").mockRejectedValue(new Error("Content-Type invalide"));
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});

        await Config.loadUrl("/profiles/geoleaf.config.json").catch(() => undefined);

        const said = errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
        errors.mockRestore();

        // The URL: without it the reader cannot tell WHICH fetch failed on a page that makes
        // several.
        expect(said).toContain("/profiles/geoleaf.config.json");
        // What actually happens now. "Not applied" alone reads as "degraded"; the reader must
        // know the boot went no further, or they will hunt for a map that was never built.
        expect(
            said,
            "l'échec ne dit pas que le boot S'ARRÊTE : « pas appliquée » se lit comme une " +
                "dégradation, et le lecteur ira chercher une carte qui n'a jamais été construite."
        ).toMatch(/S'ARRÊTE|s'arrête/);
        // The probable cause — the one an integrator cannot guess from a 200 response.
        expect(said).toMatch(/HTTP 200/);
    });

    it("says nothing of the sort when the load succeeds", async () => {
        vi.spyOn(ConfigLoader, "loadUrl").mockResolvedValue({ data: {} });
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        await Config.loadUrl("/profiles/geoleaf.config.json");
        const said = errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
        errors.mockRestore();
        expect(said).toBe("");
    });
});
