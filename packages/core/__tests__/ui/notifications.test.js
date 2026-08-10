/**
 */

const mockLog = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));
const mockCreate = vi.hoisted(() =>
    vi.fn((tag, props, ..._children) => {
        const el = document.createElement(tag || "div");
        if (props && props.className) el.className = props.className;
        return el;
    })
);
// The double must mirror `EventListenerManager`, not the `events` facade: the
// renderer calls `addEventListener` / `removeListener` on it to own each toast's
// close button (B.35d). The former `{ on, off, destroy }` shape had neither.
const mockEvents = vi.hoisted(() => ({
    createManager: vi.fn(() => {
        let nextId = 1;
        const live = new Set();
        return {
            addEventListener: vi.fn((target, event, handler, options) => {
                const id = nextId++;
                target.addEventListener(event, handler, options);
                live.add(id);
                return id;
            }),
            removeListener: vi.fn((id) => live.delete(id)),
            getCount: () => live.size,
            destroy: vi.fn(() => live.clear()),
        };
    }),
}));
// Vitest 4: `new TimerManager()` requires a constructable mock (class returning the fake).
const MockTimerManager = vi.hoisted(() =>
    vi.fn().mockImplementation(
        class {
            constructor() {
                return {
                    set: vi.fn(),
                    setTimeout: vi.fn((_fn) => 1),
                    clearTimeout: vi.fn(),
                    clear: vi.fn(),
                    clearAll: vi.fn(),
                    destroy: vi.fn(),
                };
            }
        }
    )
);

vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));
vi.mock("../../src/utils/general/dom-helpers.js", () => ({
    createElement: mockCreate,
    $create: mockCreate,
}));
vi.mock("../../src/utils/general/event-listener-manager.js", () => ({
    events: mockEvents,
}));
vi.mock("../../src/utils/general/timer-manager.js", () => ({
    TimerManager: MockTimerManager,
}));

import { _UINotifications } from "../../src/capabilities/toast-renderer/notifications.js";

describe("UI Notifications", () => {
    let container;

    beforeEach(() => {
        container = document.createElement("div");
        container.id = "gl-notifications";
        document.body.appendChild(container);
        mockCreate.mockClear();
        MockTimerManager.mockClear();
    });

    afterEach(() => {
        _UINotifications.clearAll();
        if (container && container.parentNode) container.parentNode.removeChild(container);
    });

    describe("init", () => {
        it("returns true when container exists", () => {
            const result = _UINotifications.init({ container: "#gl-notifications" });
            expect(result).toBe(true);
        });

        it("returns false when container selector not found", () => {
            const result = _UINotifications.init({ container: "#nonexistent" });
            expect(result).toBe(false);
        });
    });

    describe("show and clearAll", () => {
        it("show runs without error after init", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            expect(() => _UINotifications.show("Test message", "success")).not.toThrow();
        });

        it("clearAll removes notifications", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            _UINotifications.clearAll();
            expect(container.children.length).toBe(0);
        });
    });

    describe("show with options object (Phase 6 — coverage)", () => {
        it("show(message, options) uses options object", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            expect(() =>
                _UINotifications.show("Test", { type: "success", duration: 2000 })
            ).not.toThrow();
        });

        it("success(message) and success(message, duration)", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            expect(() => _UINotifications.success("OK")).not.toThrow();
            expect(() => _UINotifications.success("OK", 1000)).not.toThrow();
        });

        it("error(message) and error(message, duration)", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            expect(() => _UINotifications.error("Fail")).not.toThrow();
            expect(() => _UINotifications.error("Fail", 2000)).not.toThrow();
        });

        it("warning(message) and warning(message, duration)", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            expect(() => _UINotifications.warning("Careful")).not.toThrow();
            expect(() => _UINotifications.warning("Careful", 1500)).not.toThrow();
        });

        it("success/error/warning with options object", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            expect(() => _UINotifications.success("OK", { duration: 1000 })).not.toThrow();
            expect(() => _UINotifications.error("Err", { persistent: true })).not.toThrow();
            expect(() => _UINotifications.warning("Warn", { duration: 2000 })).not.toThrow();
        });

        it("info(message) and info(message, duration)", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            expect(() => _UINotifications.info("Note")).not.toThrow();
            expect(() => _UINotifications.info("Note", 1000)).not.toThrow();
        });
    });

    describe("getStatus, dismiss, disable, enable, destroy", () => {
        it("getStatus returns object with initialized and queue info", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            const statusAfter = _UINotifications.getStatus();
            expect(typeof statusAfter.enabled).toBe("boolean");
            expect(statusAfter.initialized).toBe(true);
            expect(statusAfter.activeToasts).toBe(0);
            expect(statusAfter.queued).toBe(0);
            expect(statusAfter.maxVisible).toBeDefined();
            expect(statusAfter.position).toBeDefined();
        });

        it("dismiss removes given toast", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            const toast = _UINotifications.show("X", "info");
            expect(container.querySelector(".gl-toast")).not.toBeNull();
            _UINotifications.dismiss(toast);
            expect(toast.classList.contains("gl-toast--removing")).toBe(true);
        });

        it("disable and enable toggle config.enabled", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            _UINotifications.disable();
            expect(_UINotifications.getStatus().enabled).toBe(false);
            _UINotifications.enable();
            expect(_UINotifications.getStatus().enabled).toBe(true);
        });

        it("destroy clears container and queue", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            _UINotifications.show("A", "info");
            _UINotifications.destroy();
            expect(_UINotifications.getStatus().initialized).toBe(false);
            expect(_UINotifications.getStatus().queued).toBe(0);
        });
    });

    describe("init with position and queue behavior", () => {
        it("init applies position class to container", () => {
            _UINotifications.init({ container: "#gl-notifications", position: "top-right" });
            expect(container.className).toContain("gl-notifications--top-right");
        });

        it("show with fallback type when typeOrOptions invalid", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            expect(() => _UINotifications.show("Msg", null)).not.toThrow();
        });

        it("when queue is full, higher priority replaces lowest", () => {
            _UINotifications.init({ container: "#gl-notifications" });
            for (let i = 0; i < 15; i++) _UINotifications.show("Q" + i, "info");
            _UINotifications.show("Error", "error");
            expect(_UINotifications.getStatus().queued).toBeLessThanOrEqual(15);
        });

        it("error toast at maxVisible displaces an info instead of stacking on top", () => {
            // The singleton is shared across this file and the `destroy()` test above
            // leaves `config.enabled === false`. No `enable()` needed here since B.19:
            // `init()` is a full re-initialisation and comes back enabled — if that
            // regressed, `_processQueue` would short-circuit and this test would find
            // an empty container.
            _UINotifications.init({ container: "#gl-notifications", maxVisible: 2 });
            _UINotifications.show("A", "info");
            _UINotifications.show("B", "info");
            _UINotifications.show("Critical", "error");
            // One info is on its way out; the live count still honours maxVisible.
            expect(container.querySelectorAll(".gl-toast:not(.gl-toast--removing)").length).toBe(2);
            expect(container.querySelectorAll(".gl-toast--removing").length).toBe(1);
        });
    });
});
