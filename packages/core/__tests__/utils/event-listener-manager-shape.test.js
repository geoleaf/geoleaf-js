/**
 * Verifies the EXPORT SURFACE: EventListenerManager, events, globalEventManager.
 *
 * ⚠️ DEBT — strict duplicate of `utils/event-listener-manager.test.js`,
 * which tests the same module over 325 lines where this one fits in a
 * single export-check `it`. The duplicate was masked by the `core/` vs
 * `utils/` split; the mirror realignment lays it bare. The `-shape` suffix
 * is a MARKER, not a resolution: that pass fixed names, it did not merge
 * suites. The merge is filed in the technical backlog.
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
