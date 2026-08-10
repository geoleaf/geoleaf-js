/**
 * Tests for config/geoleaf-config/module-config.ts (Plugin Contract v1)
 * Canonical modules.<id> read path + modular bag merge.
 * (S0 legacy-key mirror/fallback removed in S14 — frozen contract.)
 */

import { ConfigStore } from "../../src/kernel/config/storage.ts";
import {
    resolveModuleConfig,
    mergeModulesBag,
} from "../../src/kernel/config/geoleaf-config/module-config.ts";

describe("config/module-config — Plugin Contract v1", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        ConfigStore._config = null;
    });

    // ────────────────────────────────────────────────────────────────────────
    // Deep dot-notation on modules.* (roadmap S0 task 1 — lock-in tests)
    // ────────────────────────────────────────────────────────────────────────

    describe("dot-notation modules.* (ConfigStore)", () => {
        it("reads a 3-level deep modules path", () => {
            ConfigStore.init({
                modules: { storage: { cache: { enableProfileCache: true } } },
            });
            expect(ConfigStore.get("modules.storage.cache.enableProfileCache")).toBe(true);
        });

        it("reads a whole module block", () => {
            const block = { enabled: false };
            ConfigStore.init({ modules: { addpoi: block } });
            expect(ConfigStore.get("modules.addpoi")).toBe(block);
        });

        it("returns the default value when the path is absent", () => {
            ConfigStore.init({ modules: {} });
            expect(ConfigStore.get("modules.print.format", "A4")).toBe("A4");
        });

        it("set() creates intermediate modules nodes", () => {
            ConfigStore.init({});
            ConfigStore.set("modules.measure.units", "metric");
            expect(ConfigStore.get("modules.measure.units")).toBe("metric");
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // resolveModuleConfig — canonical modules.<id> read path (no fallback)
    // ────────────────────────────────────────────────────────────────────────

    describe("resolveModuleConfig()", () => {
        it("returns the modules.<id> value", () => {
            ConfigStore.init({ modules: { print: { format: "A3" } } });
            expect(resolveModuleConfig(ConfigStore, "print", "format")).toBe("A3");
        });

        it("returns the whole block when key is omitted", () => {
            const block = { enabled: true };
            ConfigStore.init({ modules: { addpoi: block } });
            expect(resolveModuleConfig(ConfigStore, "addpoi")).toBe(block);
        });

        it("returns defaultValue when the module block is absent", () => {
            ConfigStore.init({});
            expect(resolveModuleConfig(ConfigStore, "measure", "units", "metric")).toBe("metric");
        });

        it("returns defaultValue when a key inside the block is absent", () => {
            ConfigStore.init({ modules: { print: { format: "A3" } } });
            expect(resolveModuleConfig(ConfigStore, "print", "margin", "none")).toBe("none");
        });

        it("does NOT read a legacy root key (mirror removed in S14)", () => {
            // A profile declaring the old root key no longer resolves — the
            // modules.<id> block is the only supported form.
            ConfigStore.init({ printConfig: { format: "A5" } });
            expect(resolveModuleConfig(ConfigStore, "print", "format", "default")).toBe("default");
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // mergeModulesBag — per-entry merge of a modules bag (modular plumbing)
    // ────────────────────────────────────────────────────────────────────────

    describe("mergeModulesBag()", () => {
        it("merges entries without dropping existing ones", () => {
            const printBlock = { format: "A3" };
            const storageBlock = { cache: true };
            const target = { modules: { print: printBlock } };
            mergeModulesBag(target, { storage: storageBlock });
            expect(target.modules.print).toBe(printBlock);
            expect(target.modules.storage).toBe(storageBlock);
        });

        it("overrides the same module id by reference and creates the bag when absent", () => {
            const incoming = { print: { format: "A4" } };
            const target = { modules: { print: { format: "A3" } } };
            mergeModulesBag(target, incoming);
            expect(target.modules.print).toBe(incoming.print);

            const empty = {};
            mergeModulesBag(empty, incoming);
            expect(empty.modules.print).toBe(incoming.print);
        });

        it("is a no-op on invalid input", () => {
            const target = { modules: { print: { format: "A3" } } };
            mergeModulesBag(target, null);
            mergeModulesBag(target, [1]);
            expect(Object.keys(target.modules)).toEqual(["print"]);
            expect(() => mergeModulesBag(null, { a: {} })).not.toThrow();
        });
    });
});
