import { describe, it, expect, vi, beforeEach } from "vitest";
import { getEditorConfig, EDITOR_CONFIG_DEFAULTS } from "../config.js";

const mockConfig: Record<string, unknown> = {};

beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).GeoLeaf.Config.get = vi.fn((key: string, def?: unknown) => {
        return mockConfig[key] ?? def;
    });
    for (const k of Object.keys(mockConfig)) delete mockConfig[k];
});

describe("EDITOR_CONFIG_DEFAULTS", () => {
    it("has all expected default values", () => {
        expect(EDITOR_CONFIG_DEFAULTS.enabled).toBe(true);
        expect(EDITOR_CONFIG_DEFAULTS.showButton).toBe(true);
        expect(EDITOR_CONFIG_DEFAULTS.snapPx).toBe(12);
        expect(EDITOR_CONFIG_DEFAULTS.vertexHandleSize).toBe(8);
        expect(EDITOR_CONFIG_DEFAULTS.midpointHandleSize).toBe(5);
        expect(EDITOR_CONFIG_DEFAULTS.minVerticesLineString).toBe(2);
        expect(EDITOR_CONFIG_DEFAULTS.minVerticesPolygon).toBe(3);
        expect(EDITOR_CONFIG_DEFAULTS.api?.timeoutMs).toBe(8000);
        // ANO-079/080 — explicit defaults (were missing, only an implicit runtime fallback)
        expect(EDITOR_CONFIG_DEFAULTS.api?.geometryProperty).toBe("geom");
        expect(EDITOR_CONFIG_DEFAULTS.persistence?.mode).toBe("auto");
        expect(EDITOR_CONFIG_DEFAULTS.persistence?.conflictResolution).toBe("prompt");
        expect(EDITOR_CONFIG_DEFAULTS.persistence?.dialect).toBe("rest");
        expect(EDITOR_CONFIG_DEFAULTS.undoStackSize).toBe(100);
        expect(EDITOR_CONFIG_DEFAULTS.modal?.desktopBreakpointPx).toBe(768);
        expect(EDITOR_CONFIG_DEFAULTS.modal?.maxWidthPx).toBe(640);
        expect(EDITOR_CONFIG_DEFAULTS.confirmDelete).toBe(true);
        expect(EDITOR_CONFIG_DEFAULTS.confirmCancelOnDirty).toBe(true);
        expect(EDITOR_CONFIG_DEFAULTS.defaultLayer).toBeNull();
        expect(EDITOR_CONFIG_DEFAULTS.eventNamespace).toBe("editor");
        expect(EDITOR_CONFIG_DEFAULTS.enabledTools).toHaveLength(8);
    });
});

describe("getEditorConfig — defaults when no profile config", () => {
    it("returns defaults when modules.editor is absent from profile", () => {
        const cfg = getEditorConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.showButton).toBe(true);
        expect(cfg.snapPx).toBe(12);
        expect(cfg.persistence?.mode).toBe("auto");
    });

    it("@anomaly ANO-079/080 résolu — explicit api.geometryProperty and persistence.dialect defaults", () => {
        const cfg = getEditorConfig();
        expect(cfg.api?.geometryProperty).toBe("geom");
        expect(cfg.persistence?.dialect).toBe("rest");
    });
});

describe("getEditorConfig — profile values override defaults", () => {
    it("applies profile modules.editor over defaults", () => {
        mockConfig["modules.editor"] = { snapPx: 20, undoStackSize: 50 };
        const cfg = getEditorConfig();
        expect(cfg.snapPx).toBe(20);
        expect(cfg.undoStackSize).toBe(50);
        expect(cfg.vertexHandleSize).toBe(8); // default kept
    });

    it("deep-merges api sub-object without wiping unset keys", () => {
        mockConfig["modules.editor"] = { api: { baseUrl: "https://api.example.com" } };
        const cfg = getEditorConfig();
        expect(cfg.api?.baseUrl).toBe("https://api.example.com");
        expect(cfg.api?.timeoutMs).toBe(8000); // default preserved
        expect(cfg.api?.authHeader).toBeNull();
    });

    it("deep-merges modal sub-object", () => {
        mockConfig["modules.editor"] = { modal: { maxWidthPx: 800 } };
        const cfg = getEditorConfig();
        expect(cfg.modal?.maxWidthPx).toBe(800);
        expect(cfg.modal?.desktopBreakpointPx).toBe(768); // default preserved
    });
});

describe("getEditorConfig — alias showButton ↔ ui.showEditor", () => {
    it("reads showButton from modules.editor", () => {
        mockConfig["modules.editor"] = { showButton: false };
        const cfg = getEditorConfig();
        expect(cfg.showButton).toBe(false);
    });

    it("falls back to ui.showEditor when showButton absent", () => {
        mockConfig["ui"] = { showEditor: false };
        const cfg = getEditorConfig();
        expect(cfg.showButton).toBe(false);
    });

    it("modules.editor.showButton takes priority over ui.showEditor", () => {
        mockConfig["modules.editor"] = { showButton: true };
        mockConfig["ui"] = { showEditor: false };
        const cfg = getEditorConfig();
        expect(cfg.showButton).toBe(true);
    });
});

describe("getEditorConfig — numeric validation (clamp)", () => {
    it("clamps vertexHandleSize to [4, 24]", () => {
        mockConfig["modules.editor"] = { vertexHandleSize: 0 };
        expect(getEditorConfig().vertexHandleSize).toBe(4);

        mockConfig["modules.editor"] = { vertexHandleSize: 99 };
        expect(getEditorConfig().vertexHandleSize).toBe(24);

        mockConfig["modules.editor"] = { vertexHandleSize: 12 };
        expect(getEditorConfig().vertexHandleSize).toBe(12);
    });

    it("clamps midpointHandleSize to [3, 20]", () => {
        mockConfig["modules.editor"] = { midpointHandleSize: 0 };
        expect(getEditorConfig().midpointHandleSize).toBe(3);

        mockConfig["modules.editor"] = { midpointHandleSize: 50 };
        expect(getEditorConfig().midpointHandleSize).toBe(20);
    });

    it("clamps minVerticesLineString to ≥ 2", () => {
        mockConfig["modules.editor"] = { minVerticesLineString: 0 };
        expect(getEditorConfig().minVerticesLineString).toBe(2);
    });

    it("clamps minVerticesPolygon to ≥ 3", () => {
        mockConfig["modules.editor"] = { minVerticesPolygon: 1 };
        expect(getEditorConfig().minVerticesPolygon).toBe(3);
    });

    it("clamps api.timeoutMs to ≥ 100ms", () => {
        mockConfig["modules.editor"] = { api: { timeoutMs: 0 } };
        expect(getEditorConfig().api?.timeoutMs).toBe(100);
    });

    it("clamps undoStackSize to ≥ 1", () => {
        mockConfig["modules.editor"] = { undoStackSize: -5 };
        expect(getEditorConfig().undoStackSize).toBe(1);
    });
});

describe("getEditorConfig — persistence enum validation", () => {
    it("resets unknown persistence.mode to 'auto'", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        mockConfig["modules.editor"] = { persistence: { mode: "unknown-mode" } };
        const cfg = getEditorConfig();
        expect(cfg.persistence?.mode).toBe("auto");
        expect(spy).toHaveBeenCalledWith(expect.stringContaining("persistence.mode"));
        spy.mockRestore();
    });

    it("resets unknown conflictResolution to 'prompt'", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        mockConfig["modules.editor"] = { persistence: { conflictResolution: "whatever" } };
        const cfg = getEditorConfig();
        expect(cfg.persistence?.conflictResolution).toBe("prompt");
        expect(spy).toHaveBeenCalledWith(expect.stringContaining("conflictResolution"));
        spy.mockRestore();
    });

    it("accepts valid persistence modes", () => {
        for (const mode of ["online", "offline", "auto"] as const) {
            mockConfig["modules.editor"] = { persistence: { mode } };
            expect(getEditorConfig().persistence?.mode).toBe(mode);
        }
    });
});

describe("getEditorConfig — enabledTools filtering", () => {
    it("filters out unknown tool names", () => {
        mockConfig["modules.editor"] = { enabledTools: ["point", "unknown-tool", "polygon"] };
        const tools = getEditorConfig().enabledTools;
        expect(tools).toEqual(["point", "polygon"]);
    });

    it("falls back to all tools if no valid tool is given", () => {
        mockConfig["modules.editor"] = { enabledTools: ["invalid"] };
        const tools = getEditorConfig().enabledTools;
        expect(tools).toHaveLength(8);
    });
});

describe("`getEditableLayers` lit la géométrie sur `geometry` COMME sur `geometryType`", () => {
    /**
     * 🛑 The failure mode is the one `_acceptsGeometry`'s own TSDoc describes
     * as dangerous. It read `layer.geometryType` alone; the schema sets
     * `geometryType` as "alias of `geometry`" (ANO-007) and **18 of the 24**
     * configs in the repo declare only `geometry`. For all of those `own` was
     * falsy, the function fell back to `return true`, and a POLYGON layer
     * became a candidate for placing a POINT.
     *
     * ⚠️ Each case carries its witness as `geometryType`: without it, the
     * guard would pass just as well on a filter that no longer accepted
     * anything at all.
     */
    const layer = (id: string, geom: Record<string, string>): Record<string, unknown> => ({
        id,
        edition: { create: true },
        ...geom,
    });

    function installProfile(layers: unknown[]): void {
        (globalThis as any).GeoLeaf.Config.getActiveProfile = vi.fn(() => ({ layers }));
    }

    it("écarte une couche polygone qui ne déclare que `geometry` d'une capture de POINT", async () => {
        const { getEditableLayers } = await import("../config.js");
        installProfile([
            layer("temoin_polygone", { geometryType: "polygon" }),
            layer("alias_polygone", { geometry: "polygon" }),
        ]);

        const ids = getEditableLayers("Point").map((l) => l.id);
        // The witness was already discarded; the alias was NOT — that was the defect.
        expect(ids).not.toContain("temoin_polygone");
        expect(ids).not.toContain("alias_polygone");
    });

    it("et la retient bien pour une capture de POLYGONE — la garde n'écarte pas tout", async () => {
        const { getEditableLayers } = await import("../config.js");
        installProfile([layer("alias_polygone", { geometry: "polygon" })]);

        expect(getEditableLayers("Polygon").map((l) => l.id)).toContain("alias_polygone");
    });

    it("une couche SANS aucune des deux clés reste ouverte — contrat inchangé", async () => {
        const { getEditableLayers } = await import("../config.js");
        installProfile([layer("sans_geometrie", {})]);

        expect(getEditableLayers("Point").map((l) => l.id)).toContain("sans_geometrie");
    });
});
