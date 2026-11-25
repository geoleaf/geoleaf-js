/**
 * The absence of an in-core capability becomes a fact — K-12 held for what the core can know.
 *
 * ## The defect
 *
 * `GeoLeaf.Capabilities.onUnavailable` was documented as the channel through which the absence
 * of a capability becomes a fact. Only `ensureLoaded("offline")` ever fed it: a bundle that
 * does not embark `filter`, `legend` or any other in-core capability produced no fact at all,
 * while the profile named it and its consumers waited for it — three timed waits (3 s for the
 * offline engine, at every layer read, pull and edit; 5 s for the scale wrapper) stood where a
 * fact should have been.
 *
 * ## What the gate demands
 *
 * - The in-core capability ids form a closed list, equal to the full manifest's: an in-core
 *   capability is declared at boot pass 1 or never, so its absence has a defined answer —
 *   unlike a plugin capability, which may register lazily, long after boot.
 * - At boot, each in-core capability that the configuration names (`modules.<id>`, not switched
 *   off) and the bundle does not embark is declared unavailable, with its motif.
 * - The offline engine is expected only when `offline` and `pwa` are both embarked and on.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    IN_CORE_CAPABILITY_IDS,
    declareConfiguredAbsences,
} from "../../src/kernel/api/configured-absences.js";
import { isOfflineEngineExpected } from "../../src/kernel/api/offline-engine-expected.js";
import { CapabilityRegistry } from "../../src/kernel/api/capability-registry.js";
import { Capabilities } from "../../src/kernel/api/unavailable-capabilities.js";
import { FULL } from "../../src/presets/manifest.full.js";
import { FILTER_CAPABILITY } from "../../src/capabilities/filter/filter-capability.js";
import { OFFLINE_CAPABILITY } from "../../src/capabilities/offline/offline-capability.js";
import { PWA_CAPABILITY } from "../../src/capabilities/pwa/pwa-capability.js";

const globalView = globalThis as unknown as { GeoLeaf?: unknown };

function facts(): string[] {
    const ids: string[] = [];
    Capabilities.onUnavailable(({ id }) => ids.push(id))();
    return ids;
}

beforeEach(() => {
    CapabilityRegistry._reset();
});

afterEach(() => {
    CapabilityRegistry._reset();
    delete globalView.GeoLeaf;
});

describe("K-12 — la liste des capacités in-core", () => {
    it("est exactement celle du manifeste complet, dans les deux sens", () => {
        const manifest = FULL.capabilities.map((i) => i.declaration.id).sort();
        expect([...IN_CORE_CAPABILITY_IDS].sort()).toEqual(manifest);
    });
});

describe("K-12 — une capacité nommée par la configuration et absente du bundle devient un fait", () => {
    it("nommée, non éteinte, non embarquée : déclarée indisponible avec son motif", () => {
        const seen: { id: string; motif: string }[] = [];
        Capabilities.onUnavailable((f) => seen.push(f));

        declareConfiguredAbsences({ modules: { filter: { title: "Filtrer" } } });

        expect(seen.map((f) => f.id)).toEqual(["filter"]);
        expect(seen[0]?.motif).toMatch(/bundle/);
    });

    it("embarquée : aucun fait", () => {
        CapabilityRegistry.register(FILTER_CAPABILITY);
        declareConfiguredAbsences({ modules: { filter: {} } });
        expect(facts()).toEqual([]);
    });

    it("éteinte par la configuration : aucun fait — rien ne la réclame", () => {
        declareConfiguredAbsences({ modules: { legend: { enabled: false } } });
        expect(facts()).toEqual([]);
    });

    it("un identifiant de plugin n'est jamais accusé — il peut arriver plus tard", () => {
        declareConfiguredAbsences({ modules: { routing: {}, editor: { enabled: true } } });
        expect(facts()).toEqual([]);
    });

    it("non nommée : aucun fait — l'absence se tait quand rien ne la réclame", () => {
        declareConfiguredAbsences({ modules: {} });
        declareConfiguredAbsences({});
        expect(facts()).toEqual([]);
    });
});

describe("le moteur hors ligne n'est attendu que s'il peut venir", () => {
    function config(values: Record<string, unknown>): void {
        globalView.GeoLeaf = { Config: { get: (k: string, d?: unknown) => values[k] ?? d } };
    }

    it("ni offline ni pwa embarquées : non attendu", () => {
        config({ "modules.offline.enabled": true, "modules.pwa.enabled": true });
        expect(isOfflineEngineExpected()).toBe(false);
    });

    it("embarquées et allumées : attendu", () => {
        CapabilityRegistry.register(OFFLINE_CAPABILITY);
        CapabilityRegistry.register(PWA_CAPABILITY);
        config({ "modules.offline.enabled": true, "modules.pwa.enabled": true });
        expect(isOfflineEngineExpected()).toBe(true);
    });

    it("embarquées, pwa éteinte : non attendu — le moteur ne se charge pas sans elle", () => {
        CapabilityRegistry.register(OFFLINE_CAPABILITY);
        CapabilityRegistry.register(PWA_CAPABILITY);
        config({ "modules.offline.enabled": true, "modules.pwa.enabled": false });
        expect(isOfflineEngineExpected()).toBe(false);
    });
});
