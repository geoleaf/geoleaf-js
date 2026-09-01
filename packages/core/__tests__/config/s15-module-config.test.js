/**
 * Config-contract Phase C / C6 — B7 plugins modules.<id> (config read path).
 *
 * Scope: CONFIG ONLY (plugin behaviour is a separate concern).
 *
 * The generic read MECHANISM is already covered elsewhere:
 *   - getModuleConfig (façade)            → config-accessors.test.js
 *   - Config.init / set / modular merge   → module-config-integration.test.js
 * This file adds the per-VALUE seam contract that those do not lock:
 *   - resolveModuleConfig default-fallback + FALSY-preservation (a configured
 *     false/0/"" must NOT be replaced by the caller's default),
 *   - mergeModulesBag malformed-input guards + bag creation,
 *   - the CORE consumer of modules.addpoi.defaultPosition (ANO-077),
 * and tracks the plugin-owned default anomalies (ANO-079/080/081) as
 * it.todo pointing at the plugin packages (no core seam to assert).
 *
 * modules.<id> has NO schema (profile.schema.json: additionalProperties:true,
 * owned by the plugin) → there is no AJV-reject half here, unlike B3/B6. The
 * lock is the live read path + cross-ref to registre_anomalies_config.md.
 *
 * Inventory B7 (S9). Source of truth = profiles/_reference (REFERENCE_MODULE_*).
 */

import {
    resolveModuleConfig,
    mergeModulesBag,
} from "../../src/kernel/config/geoleaf-config/module-config.js";
import { ConfigStore } from "../../src/kernel/config/storage.ts";
import { installConfig, resetConfig, REFERENCE_MODULE_OFFLINE } from "./_helpers/config-harness.js";

// ─── resolveModuleConfig — canonical read path (module-config.ts) ──────────

describe("config B7 — resolveModuleConfig(reader, id, key?, default?)", () => {
    afterEach(() => resetConfig());

    it("no key → returns the whole module block (default ignored when block exists)", () => {
        installConfig({ modules: { storage: REFERENCE_MODULE_OFFLINE } });
        expect(resolveModuleConfig(ConfigStore, "storage")).toEqual(REFERENCE_MODULE_OFFLINE);
        expect(resolveModuleConfig(ConfigStore, "storage", undefined, "IGNORED")).toEqual(
            REFERENCE_MODULE_OFFLINE
        );
    });

    it("nested dot-notation key resolves into the block", () => {
        installConfig({ modules: { storage: REFERENCE_MODULE_OFFLINE } });
        // fixture sets cache flags to false (non-default) — see ANO-078
        expect(resolveModuleConfig(ConfigStore, "storage", "cache.enableProfileCache")).toBe(false);
        expect(resolveModuleConfig(ConfigStore, "storage", "enabled")).toBe(true);
    });

    it("a configured FALSY value (false/0/'') is NOT overwritten by the default", () => {
        installConfig({ modules: { m: { flag: false, count: 0, label: "" } } });
        expect(resolveModuleConfig(ConfigStore, "m", "flag", true)).toBe(false);
        expect(resolveModuleConfig(ConfigStore, "m", "count", 99)).toBe(0);
        expect(resolveModuleConfig(ConfigStore, "m", "label", "x")).toBe("");
    });

    it("missing key inside an existing block → default", () => {
        installConfig({ modules: { storage: REFERENCE_MODULE_OFFLINE } });
        expect(resolveModuleConfig(ConfigStore, "storage", "cache.nope", "DFLT")).toBe("DFLT");
    });

    it("missing module block → default (or undefined when no default given)", () => {
        installConfig({ modules: { storage: {} } });
        expect(resolveModuleConfig(ConfigStore, "absent", "x", "DFLT")).toBe("DFLT");
        expect(resolveModuleConfig(ConfigStore, "absent", "x")).toBeUndefined();
    });
});

// ─── mergeModulesBag — guards not covered by the integration happy-path ───────

describe("config B7 — mergeModulesBag(target, incoming) guards", () => {
    it("merges entry by entry without clobbering other plugins' entries", () => {
        const target = { modules: { addpoi: { x: 1 } } };
        mergeModulesBag(target, { storage: { y: 2 } });
        expect(target.modules).toEqual({ addpoi: { x: 1 }, storage: { y: 2 } });
    });

    it("same-id incoming replaces the entry by reference", () => {
        const target = { modules: { storage: { old: true } } };
        const next = { fresh: true };
        mergeModulesBag(target, { storage: next });
        expect(target.modules.storage).toBe(next);
    });

    it("creates target.modules when absent / malformed", () => {
        const blank = {};
        mergeModulesBag(blank, { storage: { a: 1 } });
        expect(blank.modules).toEqual({ storage: { a: 1 } });
        const bad = { modules: [1, 2] };
        mergeModulesBag(bad, { storage: { a: 1 } });
        expect(bad.modules).toEqual({ storage: { a: 1 } });
    });

    it("malformed target or incoming → no-op, no throw", () => {
        expect(() => mergeModulesBag(null, { a: 1 })).not.toThrow();
        expect(() => mergeModulesBag([1], { a: 1 })).not.toThrow();
        const target = { modules: { a: { x: 1 } } };
        mergeModulesBag(target, null);
        mergeModulesBag(target, [1, 2]);
        mergeModulesBag(target, "str");
        expect(target.modules).toEqual({ a: { x: 1 } });
    });
});

// ─── Plugin-owned defaults — deferred to the plugin packages (registre B7) ────

describe("config B7 — plugin-owned anomalies (deferred to plugin-validation)", () => {
    // ANO-076 CLOSED: the orphan flag `modules.addpoi.enabled` vanishes with
    // the config block that carried it. No deposit left to track.
    // ANO-079/080 RÉSOLU (Archi S3) — explicit defaults api.geometryProperty:"geom" +
    // persistence.dialect:"rest" added to EDITOR_CONFIG_DEFAULTS (config.ts) ; asserted in the
    // plugin-editor suite (config-only, plugin-owned): packages/plugin-editor/src/__tests__/config.test.ts.
    // ANO-081: print/measure read modules.print/measure but NO profile ships those blocks
    // (0 profile, ~42 inert keys). Config-available / plugin-not-deployed → plugin-validation.
    it.todo(
        "@anomaly ANO-081 — print/measure config inert (0 profile) → plugin-validation roadmap"
    );
});
