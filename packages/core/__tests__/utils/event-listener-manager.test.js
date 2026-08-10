/**
 * @file event-listener-manager.test.js
 * @description Tests for the real EventListenerManager class (imports actual module)
 * @phase Sprint 3 — Lots A-C branch recovery (0% => 80%+)
 */

const mockLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

let EventListenerManager, globalEventManager, events;

// Déféré PORTEUR : le module installe un singleton au chargement
// (`globalEventManager = new EventListenerManager("global")`), donc le MOMENT du chargement compte.
// `await import()` le préserve tout en faisant passer le module par Vite.
beforeAll(async () => {
    const mod = await import("../../src/utils/general/event-listener-manager.js");
    EventListenerManager = mod.EventListenerManager;
    globalEventManager = mod.globalEventManager;
    events = mod.events;
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe("GeoLeaf.Utils.EventListenerManager", () => {
    let manager;
    let mockElement;

    beforeEach(() => {
        manager = new EventListenerManager("test");
        mockElement = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
        };
    });

    afterEach(() => {
        manager.removeAll();
    });

    // --- constructor -----------------------------------------------------------

    describe("constructor", () => {
        test("creates with default name", () => {
            const m = new EventListenerManager();
            expect(m.name).toBe("default");
            expect(m.listeners).toHaveLength(0);
        });

        test("accepts custom name", () => {
            const m = new EventListenerManager("custom");
            expect(m.name).toBe("custom");
        });
    });

    // --- addEventListener ------------------------------------------------------

    describe("addEventListener", () => {
        test("adds listener and returns id", () => {
            const handler = vi.fn();
            const id = manager.addEventListener(mockElement, "click", handler);
            expect(typeof id).toBe("number");
            expect(id).toBeGreaterThan(0);
            expect(mockElement.addEventListener).toHaveBeenCalledWith("click", handler, false);
        });

        test("stores listener metadata", () => {
            const handler = vi.fn();
            const id = manager.addEventListener(mockElement, "click", handler, false, "myLabel");
            expect(manager.getCount()).toBe(1);
            const active = manager.listActiveListeners();
            expect(active[0].id).toBe(id);
            expect(active[0].event).toBe("click");
            expect(active[0].label).toBe("myLabel");
        });

        test("returns null for null target", () => {
            const id = manager.addEventListener(null, "click", vi.fn());
            expect(id).toBeNull();
            expect(mockLog.warn).toHaveBeenCalled();
        });

        test("returns null when target lacks addEventListener", () => {
            const id = manager.addEventListener({ notElement: true }, "click", vi.fn());
            expect(id).toBeNull();
        });

        test("increments id on each call", () => {
            const id1 = manager.addEventListener(mockElement, "click", vi.fn());
            const id2 = manager.addEventListener(mockElement, "mouseover", vi.fn());
            expect(id2).toBe(id1 + 1);
        });

        test("accepts options object", () => {
            const handler = vi.fn();
            const opts = { once: true, capture: false };
            manager.addEventListener(mockElement, "click", handler, opts);
            expect(mockElement.addEventListener).toHaveBeenCalledWith("click", handler, opts);
        });
    });

    // --- addEmitterListener ----------------------------------------------------

    describe("addEmitterListener", () => {
        test("adds Emitter listener and returns id", () => {
            const handler = vi.fn();
            const id = manager.addEmitterListener(mockElement, "moveend", handler, "emitter-label");
            expect(typeof id).toBe("number");
            expect(mockElement.on).toHaveBeenCalledWith("moveend", handler);
        });

        test("stores emitter type in metadata", () => {
            const handler = vi.fn();
            manager.addEmitterListener(mockElement, "zoomend", handler);
            const active = manager.listActiveListeners();
            expect(active[0].type).toBe("emitter");
        });

        test("returns null for null target", () => {
            const id = manager.addEmitterListener(null, "click", vi.fn());
            expect(id).toBeNull();
            expect(mockLog.warn).toHaveBeenCalled();
        });

        test("returns null when target lacks on()", () => {
            const id = manager.addEmitterListener({ noOn: true }, "click", vi.fn());
            expect(id).toBeNull();
        });
    });

    // --- removeListener --------------------------------------------------------

    describe("removeListener", () => {
        test("removes DOM listener by id and calls removeEventListener", () => {
            const handler = vi.fn();
            const id = manager.addEventListener(mockElement, "click", handler);
            const result = manager.removeListener(id);
            expect(result).toBe(true);
            expect(manager.getCount()).toBe(0);
            expect(mockElement.removeEventListener).toHaveBeenCalledWith(
                "click",
                handler,
                undefined
            );
        });

        test("removes Emitter listener by id and calls off()", () => {
            const handler = vi.fn();
            const id = manager.addEmitterListener(mockElement, "moveend", handler);
            const result = manager.removeListener(id);
            expect(result).toBe(true);
            expect(mockElement.off).toHaveBeenCalledWith("moveend", handler);
        });

        test("returns false for unknown id", () => {
            expect(manager.removeListener(9999)).toBe(false);
        });
    });

    // --- removeListenersForTarget ----------------------------------------------

    describe("removeListenersForTarget", () => {
        test("removes all listeners for a given target", () => {
            const handler = vi.fn();
            manager.addEventListener(mockElement, "click", handler);
            manager.addEventListener(mockElement, "mouseover", handler);
            const count = manager.removeListenersForTarget(mockElement);
            expect(count).toBe(2);
            expect(manager.getCount()).toBe(0);
        });

        test("returns 0 when target has no listeners", () => {
            expect(manager.removeListenersForTarget(mockElement)).toBe(0);
        });

        test("only removes listeners for specified target", () => {
            const el2 = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
            manager.addEventListener(mockElement, "click", vi.fn());
            manager.addEventListener(el2, "click", vi.fn());
            manager.removeListenersForTarget(mockElement);
            expect(manager.getCount()).toBe(1);
        });
    });

    // --- removeAll -------------------------------------------------------------

    describe("removeAll", () => {
        test("removes all DOM listeners", () => {
            manager.addEventListener(mockElement, "click", vi.fn());
            manager.addEventListener(mockElement, "keydown", vi.fn());
            manager.removeAll();
            expect(manager.getCount()).toBe(0);
            expect(mockElement.removeEventListener).toHaveBeenCalledTimes(2);
        });

        test("removes Emitter listeners via off()", () => {
            manager.addEmitterListener(mockElement, "moveend", vi.fn());
            manager.removeAll();
            expect(mockElement.off).toHaveBeenCalledTimes(1);
        });

        test("does nothing when no listeners registered", () => {
            expect(() => manager.removeAll()).not.toThrow();
        });
    });

    // --- getCount --------------------------------------------------------------

    describe("getCount", () => {
        test("returns 0 initially", () => {
            expect(manager.getCount()).toBe(0);
        });

        test("returns correct count after adds", () => {
            manager.addEventListener(mockElement, "click", vi.fn());
            manager.addEventListener(mockElement, "keyup", vi.fn());
            expect(manager.getCount()).toBe(2);
        });
    });

    // --- listActiveListeners ---------------------------------------------------

    describe("listActiveListeners", () => {
        test("returns array with id, event, label, type, age", () => {
            manager.addEventListener(mockElement, "click", vi.fn(), false, "lbl");
            const list = manager.listActiveListeners();
            expect(list).toHaveLength(1);
            expect(list[0]).toMatchObject({ event: "click", label: "lbl", type: "dom" });
            expect(typeof list[0].age).toBe("number");
        });

        test("emitter type shows 'emitter'", () => {
            manager.addEmitterListener(mockElement, "zoom", vi.fn());
            const list = manager.listActiveListeners();
            expect(list[0].type).toBe("emitter");
        });
    });

    // --- destroy ---------------------------------------------------------------

    describe("destroy", () => {
        test("calls removeAll and logs", () => {
            manager.addEventListener(mockElement, "click", vi.fn());
            manager.destroy();
            expect(manager.getCount()).toBe(0);
            expect(mockLog.info).toHaveBeenCalled();
        });
    });
});

// --- events shorthand API ------------------------------------------------------

describe("events shorthand API", () => {
    let el;

    beforeEach(() => {
        el = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        };
    });

    afterEach(() => {
        events.offAll();
    });

    test("events.on adds a listener and returns an id", () => {
        const id = events.on(el, "click", vi.fn());
        expect(typeof id).toBe("number");
    });

    test("events.off removes a listener by id", () => {
        const id = events.on(el, "click", vi.fn());
        events.off(id);
        expect(el.removeEventListener).toHaveBeenCalled();
    });

    test("events.getCount returns active listener count", () => {
        const initial = events.getCount();
        events.on(el, "click", vi.fn());
        expect(events.getCount()).toBeGreaterThanOrEqual(initial + 1);
    });

    test("events.listActive returns array", () => {
        expect(Array.isArray(events.listActive())).toBe(true);
    });

    test("events.createManager creates a named EventListenerManager", () => {
        const m = events.createManager("newMgr");
        expect(m).toBeInstanceOf(EventListenerManager);
        expect(m.name).toBe("newMgr");
    });

    test("events.onEmitter adds Emitter listener", () => {
        const leafletEl = { on: vi.fn(), off: vi.fn() };
        const id = events.onEmitter(leafletEl, "moveend", vi.fn(), "emitter-test");
        expect(typeof id).toBe("number");
        expect(leafletEl.on).toHaveBeenCalled();
    });

    test("events.offTarget removes all listeners for element", () => {
        events.on(el, "click", vi.fn());
        events.on(el, "keyup", vi.fn());
        events.offTarget(el);
        expect(el.removeEventListener).toHaveBeenCalled();
    });
});

// --- globalEventManager --------------------------------------------------------

describe("globalEventManager", () => {
    test("is an EventListenerManager instance", () => {
        expect(globalEventManager).toBeInstanceOf(EventListenerManager);
        expect(globalEventManager.name).toBe("global");
    });
});
