/**
 * `modules.labels.enabled: false` switches labels off — all of them.
 *
 * The switch gated only the capability's lifecycle (the 🏷️ button seam, the catch-up of layers
 * already drawn). The namespace is mounted unconditionally, and the GeoJSON and vector-tile
 * loaders reach `Labels.initializeLayerLabels()` through it: labels kept being painted, and the
 * button reappeared at the first `syncImmediate()` (a visibility, style or theme change). The
 * fiche documented the half-switch; the sorting retained « make the switch hold ».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { configGet } = vi.hoisted(() => ({ configGet: vi.fn() }));

vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (...a: unknown[]) => configGet(...a) },
}));

const { Labels } = await import("../../../src/capabilities/labels/labels.js");
const { LabelButtonManager } =
    await import("../../../src/capabilities/labels/label-button-manager.js");

beforeEach(() => {
    configGet.mockReset();
});

describe("labels — l'interrupteur de la capacité tient", () => {
    it("éteinte : initializeLayerLabels ne construit rien", () => {
        configGet.mockImplementation((k: string, d: unknown) =>
            k === "modules.labels" ? { enabled: false } : d
        );
        const read = vi.spyOn(
            Labels as unknown as { _getLayerData: (id: string) => unknown },
            "_getLayerData"
        );
        Labels.initializeLayerLabels("villes");
        expect(read).not.toHaveBeenCalled();
        read.mockRestore();
    });

    it("éteinte : syncImmediate ne crée aucun bouton", () => {
        configGet.mockImplementation((k: string, d: unknown) =>
            k === "modules.labels" ? { enabled: false } : d
        );
        const sync = vi.spyOn(
            LabelButtonManager as unknown as { _doSync: (id: string) => void },
            "_doSync"
        );
        LabelButtonManager.syncImmediate("villes");
        expect(sync).not.toHaveBeenCalled();
        sync.mockRestore();
    });

    it("allumée (défaut, clé absente) : la construction a lieu", () => {
        configGet.mockImplementation((_k: string, d: unknown) => d);
        const read = vi
            .spyOn(Labels as unknown as { _getLayerData: (id: string) => unknown }, "_getLayerData")
            .mockReturnValue(null);
        Labels.initializeLayerLabels("villes");
        expect(read).toHaveBeenCalled();
        read.mockRestore();
    });
});
