/**
 * `modules.theme-palette.enabled: false` hides the button and still applies `default`.
 *
 * The capability has two halves and only the second is opt-in: (1) apply the configured palette,
 * always — an integrator fixes a brand colour and offers no choice, the majority production
 * case; (2) mount the selector button, only on `enabled: true`. The DECLARATION gate read the
 * same `enabled` key: `false` left the module unregistered, so half (1) never ran — the interface
 * stayed orange, no `data-gl-palette`. Red on the code before the fix: no attribute.
 *
 * Driven through the real preset pass (`registerPresetModules`), where the defect lived: the
 * lifecycle alone was right all along.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { modulesBlock } = vi.hoisted(() => ({
    modulesBlock: { value: {} as Record<string, unknown> },
}));

vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: {
        get: (path: string, def?: unknown) =>
            path === "modules.theme-palette" ? modulesBlock.value : def,
    },
}));

const { THEME_PALETTE_INSTALLER } =
    await import("../../../src/capabilities/theme-palette/install.js");
const { ThemePaletteLifecycle } =
    await import("../../../src/capabilities/theme-palette/lifecycle.js");
const { registerPresetModules } = await import("../../../src/presets/apply-preset.js");
const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.js");

interface Registered {
    init(adapter: unknown, config: unknown): unknown;
}

function boot(block: Record<string, unknown>): void {
    modulesBlock.value = block;
    CapabilityRegistry.register(THEME_PALETTE_INSTALLER.declaration);
    const registered: Registered[] = [];
    registerPresetModules(
        { capabilities: [THEME_PALETTE_INSTALLER] } as never,
        CapabilityRegistry,
        { register: (m: Registered) => registered.push(m) } as never
    );
    const config = { modules: { "theme-palette": block } };
    for (const m of registered) m.init({}, config);
}

beforeEach(() => {
    delete document.documentElement.dataset.glPalette;
    try {
        localStorage.clear();
    } catch {
        /* storage may be unavailable — the palette then reads the config only */
    }
});

afterEach(() => {
    ThemePaletteLifecycle._reset();
    CapabilityRegistry._reset();
});

describe("theme-palette — enabled: false applique quand même la palette par défaut", () => {
    it("enabled: false + default: green → palette verte, aucun bouton", () => {
        boot({ enabled: false, default: "green" });
        expect(document.documentElement.dataset.glPalette).toBe("green");
        expect(document.querySelector(".gl-rp-palette-btn")).toBeNull();
    });

    it("clé absente + default: green → palette verte (inchangé)", () => {
        boot({ default: "green" });
        expect(document.documentElement.dataset.glPalette).toBe("green");
    });
});
