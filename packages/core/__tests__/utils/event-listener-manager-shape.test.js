/**
 * Phase 60 — Step 1.2: src/utils/general/event-listener-manager.ts (0% → 60%)
 * Vérifie la SURFACE D'EXPORT : EventListenerManager, events, globalEventManager.
 *
 * ⚠️ DETTE (STRUCT S7) — doublon strict avec `utils/event-listener-manager.test.js`,
 * qui teste le même module sur 325 lignes là où celui-ci tient en un `it` de contrôle
 * d'export. Le doublon était masqué par la séparation `core/` vs `utils/` ; le
 * réalignement du miroir le met à nu. Le suffixe `-shape` est un MARQUEUR, pas une
 * résolution : S7 corrige des noms, il ne fusionne pas de suites (S7.4). Fusion
 * inscrite au backlog technique.
 */
import {
    EventListenerManager,
    events,
    globalEventManager,
} from "../../src/utils/general/event-listener-manager.js";

describe("utils/event-listener-manager — surface d'export (step 1.2)", () => {
    it("exporte EventListenerManager, events et globalEventManager", () => {
        expect(EventListenerManager).toBeDefined();
        expect(typeof EventListenerManager).toBe("function");
        expect(events).toBeDefined();
        expect(globalEventManager).toBeDefined();
    });

    it("EventListenerManager est une classe instantiable", () => {
        const m = new EventListenerManager("test");
        expect(m).toBeInstanceOf(EventListenerManager);
        expect(m.name).toBe("test");
    });
});
