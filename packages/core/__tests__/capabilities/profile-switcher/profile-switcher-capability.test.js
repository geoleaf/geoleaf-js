/**
 * Unit tests — profile-switcher-capability.ts + config.ts (in-core capability, S1).
 *
 * Validates the declaration, its gate semantics (registration-only opt-out, real
 * user-facing default OFF) and the two config readers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { PROFILE_SWITCHER_CAPABILITY } =
    await import("../../../src/capabilities/profile-switcher/profile-switcher-capability.ts");
const { Config } = await import("../../../src/kernel/config/config-primitives.ts");
const { getProfileSwitcherConfig, getAvailableProfiles } =
    await import("../../../src/capabilities/profile-switcher/config.ts");

/** Mirrors the capConfig adapter created in boot.ts for the gate. */
function makeCapConfig(baseCfg) {
    return {
        get: (key, def = undefined) => {
            const parts = key.split(".");
            return parts.reduce((o, k) => o?.[k], baseCfg) ?? def;
        },
    };
}

/**
 * Stubs `Config.get` with a dotted-path reader over `cfg`.
 *
 * Assigned rather than spied: `get` is augmented onto the Config singleton at boot
 * (`config-accessors.ts`), so it does not exist on the bare import and `vi.spyOn`
 * would throw "property is not defined".
 */
const _originalGet = Config.get;
function stubConfig(cfg) {
    Config.get = (path, def) => {
        const v = path.split(".").reduce((o, k) => o?.[k], cfg);
        return v === undefined ? def : v;
    };
}

beforeEach(() => {
    CapabilityRegistry._reset();
    vi.restoreAllMocks();
});

afterEach(() => {
    if (_originalGet === undefined) delete Config.get;
    else Config.get = _originalGet;
});

describe("PROFILE_SWITCHER_CAPABILITY declaration", () => {
    it("has id 'profile-switcher'", () => {
        expect(PROFILE_SWITCHER_CAPABILITY.id).toBe("profile-switcher");
    });

    it("has a non-empty label and description", () => {
        expect(PROFILE_SWITCHER_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(PROFILE_SWITCHER_CAPABILITY.description.length).toBeGreaterThan(0);
    });

    it("gates on modules.profile-switcher.enabled", () => {
        expect(PROFILE_SWITCHER_CAPABILITY.gate.configPath).toBe(
            "modules.profile-switcher.enabled"
        );
    });

    it("registers when the block is absent (enableWhenAbsent — registration only)", () => {
        // Profile-level block: the pre-merge boot gate must still register the module,
        // otherwise a late opt-in in the profile could never take effect.
        expect(PROFILE_SWITCHER_CAPABILITY.gate.enableWhenAbsent).toBe(true);
        CapabilityRegistry.register(PROFILE_SWITCHER_CAPABILITY);
        expect(CapabilityRegistry.isEnabled("profile-switcher", makeCapConfig({}))).toBe(true);
    });

    it("declares a schema whose user-facing default is OFF", () => {
        // The registration gate says "true when absent"; the SCHEMA says the selector
        // itself defaults off. Both are needed — see the late gate test below.
        expect(PROFILE_SWITCHER_CAPABILITY.configSchema.enabled.default).toBe(false);
    });

    it("is disabled when the profile sets enabled:false", () => {
        CapabilityRegistry.register(PROFILE_SWITCHER_CAPABILITY);
        const cfg = makeCapConfig({ modules: { "profile-switcher": { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("profile-switcher", cfg)).toBe(false);
    });
});

describe("getProfileSwitcherConfig()", () => {
    it("defaults to disabled when nothing is configured", () => {
        stubConfig({});
        expect(getProfileSwitcherConfig().enabled).toBe(false);
    });

    it("reads enabled:true from the merged config", () => {
        stubConfig({ modules: { "profile-switcher": { enabled: true } } });
        expect(getProfileSwitcherConfig().enabled).toBe(true);
    });
});

describe("getAvailableProfiles()", () => {
    it("returns [] when data.availableProfiles is absent (app served from sources)", () => {
        stubConfig({});
        expect(getAvailableProfiles()).toEqual([]);
    });

    it("returns [] when the key is not an array", () => {
        stubConfig({ data: { availableProfiles: "tourism" } });
        expect(getAvailableProfiles()).toEqual([]);
    });

    it("returns the harvested entries", () => {
        stubConfig({
            data: {
                availableProfiles: [
                    { id: "tourism", displayLabel: "Tourisme", icon: "🏖️" },
                    { id: "france-rail", displayLabel: "France Rail" },
                ],
            },
        });
        const list = getAvailableProfiles();
        expect(list).toHaveLength(2);
        expect(list[0].id).toBe("tourism");
        expect(list[1].icon).toBeUndefined();
    });

    it("drops malformed entries rather than surfacing them", () => {
        // The list is generated, but it lands in a JSON an integrator can edit.
        stubConfig({
            data: {
                availableProfiles: [
                    { id: "tourism", displayLabel: "Tourisme" },
                    null,
                    { displayLabel: "no id" },
                    { id: "", displayLabel: "empty id" },
                ],
            },
        });
        expect(getAvailableProfiles().map((e) => e.id)).toEqual(["tourism"]);
    });
});
