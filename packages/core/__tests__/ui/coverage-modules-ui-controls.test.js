/**
 * Coverage — UI Controls
 * Targets: src/capabilities/toast-renderer/notifications.ts
 *
 * Sprint T9 — coverage-modules pattern. `controls.ts` (empty `_UIControls`
 * registry) was removed.
 */
"use strict";

import { domCreateDouble } from "../_helpers/dom-create-double.js";

// ── Shared mocks ──────────────────────────────────────────────────────────────
//
// ⚠️ FIVE `vi.mock`s were removed from here — `config-primitives`,
// `dom-security`, `utils-base`, `haversine`, `propagation-blocker`. They
// were INERT: none appears in the subject's import graph (`notifications.ts`
// + `types.ts` + `constants.ts`, measured closed). A double set on a module
// the subject does not import replaces nothing; it attests a dependency
// that does not exist. The `dom-security` one moreover declared
// `sanitizeText`, a member the real facade does not carry (it carries
// `setTextContent`, `setSafeHTML`, `clearElement`, `clearElementFast`,
// `createSVGIcon`, `getIcon`, `SVG_ICONS`).
//
// 🛑 And the subject ITSELF was doubled: a `vi.mock` of `notifications.js`
// only returned `_UINotifications`, so the `NotificationSystem` import
// THREW, the `beforeEach`'s `catch` swallowed the error, and the first
// block's four tests exited through their `if (!ns) return` — green while
// asserting nothing. The second block, titled "real module", read the
// double. Nine tests, zero assertions on the subject.
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((key) => key),
}));

vi.mock("../../src/utils/general/dom-helpers.js", () => ({
    // `createElement` is the ONLY member `notifications.ts` imports from
    // here. The double only declared `domCreate` and `$create` — two names
    // it does not call —, which did not show while the subject itself was doubled.
    createElement: vi.fn((tag, className, parent) => domCreateDouble(tag, className, parent)),
    domCreate: vi.fn((tag, className, parent) => domCreateDouble(tag, className, parent)),
    $create: vi.fn((tag, cls, parent) => {
        const el = document.createElement(tag);
        if (cls) el.className = Array.isArray(cls) ? cls.join(" ") : cls;
        if (parent) parent.appendChild(el);
        return el;
    }),
}));

// geolocation-state relocated to the in-core `geolocation` capability.

vi.mock("../../src/utils/general/event-listener-manager.js", () => ({
    // ⚠️ The double declared `on` / `off` / `destroy` — three members the
    // subject NEVER calls — and not `createManager`, the only one it calls
    // (`notifications.ts`). It described an imaginary facade, and
    // nothing noticed while the subject was itself doubled. The returned
    // manager carries `destroy()`, called by the subject's `destroy()`.
    events: {
        createManager: vi.fn(() => ({ destroy: vi.fn() })),
    },
}));

vi.mock("../../src/utils/general/timer-manager.js", () => ({
    // ⚠️ Same defect: the double carried `set` / `clear` / `clearAll`, and
    // the subject calls `setTimeout` / `clearTimeout` / `destroy`
    // (`notifications.ts`).
    TimerManager: class {
        setTimeout() {
            return 0;
        }
        clearTimeout() {}
        destroy() {}
    },
}));

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((key) => key),
}));

// ── Notifications System ──────────────────────────────────────────────────────
import { NotificationSystem } from "../../src/capabilities/toast-renderer/notifications.js";

describe("Coverage — NotificationSystem", () => {
    let ns;

    beforeEach(() => {
        // ⚠️ A `try { … } catch {}` wrapped this line, and each test opened
        // on `if (!ns) return`. The pair made the suite INSENSITIVE to the
        // export's absence: it threw at every `beforeEach`, `ns` stayed
        // undefined, and the four tests exited green reading nothing. The
        // instantiation is bare — if the export vanishes, all four turn red.
        ns = new NotificationSystem();
    });

    it("has expected notification type keys when instantiated", () => {
        expect(ns.durations).toBeDefined();
        expect(ns.durations.success).toBeGreaterThan(0);
        expect(ns.durations.error).toBeGreaterThan(0);
    });

    it("durations object covers all 4 types", () => {
        expect(ns.durations).toHaveProperty("success");
        expect(ns.durations).toHaveProperty("error");
        expect(ns.durations).toHaveProperty("warning");
        expect(ns.durations).toHaveProperty("info");
    });

    it("config defaults are set correctly", () => {
        expect(ns.config.enabled).toBe(true);
        expect(ns.config.position).toBe("bottom-center");
        expect(ns.config.animations).toBe(true);
    });

    it("maxVisible and maxPersistent are positive numbers", () => {
        expect(ns.maxVisible).toBeGreaterThan(0);
        expect(ns.maxPersistent).toBeGreaterThan(0);
    });
});

// ── _UINotifications singleton ────────────────────────────────────────────────
import { _UINotifications } from "../../src/capabilities/toast-renderer/notifications.js";

describe("Coverage — _UINotifications singleton (real module, mocked deps)", () => {
    it("exposes an init function", () => {
        expect(typeof _UINotifications?.init).toBe("function");
    });

    // ⚠️ `init({ container })` takes a CSS SELECTOR, not an element —
    // `types.ts` declares it `container?: string` and the body does
    // `document.querySelector(config.container || …)`. The test passed it an
    // `HTMLElement`: `querySelector` stringifies it to `"<div></div>"` and
    // throws a `DOMException`. It attested a contract that never existed,
    // and the subject's double hid it for as long as it lasted.
    it("init resolves its container from a CSS selector and returns true", () => {
        const container = document.createElement("div");
        container.id = "gl-notifications";
        document.body.appendChild(container);
        expect(_UINotifications.init({ container: "#gl-notifications" })).toBe(true);
        container.remove();
    });

    it("init returns false without throwing when the selector matches nothing", () => {
        expect(() => _UINotifications.init({ container: "#absent" })).not.toThrow();
        expect(_UINotifications.init({ container: "#absent" })).toBe(false);
    });

    it("init does not throw with no arguments", () => {
        expect(() => _UINotifications.init()).not.toThrow();
    });

    it("show returns a string id or falsy when not initialized", () => {
        const id = _UINotifications.show?.("info", "Test message");
        // Either a string (UUID/id) or null/undefined if not initialized
        expect(typeof id === "string" || id == null).toBe(true);
    });

    // ⚠️ `dismiss(toastEl)` takes the ELEMENT returned by `show()`, not an
    // identifier — its TSDoc says so and `_remove()` reads
    // `toast.classList`. The test passed it the string `"non-existent-id"`,
    // hence a `TypeError`. Same class as the `init` test above: an invented
    // parameter name, green as long as the fixture accepted anything.
    it("dismiss returns early on a nullish element", () => {
        expect(() => _UINotifications.dismiss(null)).not.toThrow();
        expect(() => _UINotifications.dismiss(undefined)).not.toThrow();
    });

    it("dismiss does not throw on an element that is not a rendered toast", () => {
        const foreign = document.createElement("div");
        expect(() => _UINotifications.dismiss(foreign)).not.toThrow();
    });
});
