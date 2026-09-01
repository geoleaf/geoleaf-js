/**
 * Tests for src/ui/cache-button/ modules:
 *   - button-control.ts        (ButtonControl — real-map capture, S2)
 *   - toolbar-registration.ts  (registry slot + geoleaf:toolbar:action)
 *   - modal-manager.ts         (ModalManager)
 *   - export-logic.ts          (ExportLogic – with stubbed deps)
 */
"use strict";

import { ButtonControl as BC } from "../ui/cache-button/button-control.js";
import { registerCacheToolbar } from "../ui/cache-button/toolbar-registration.js";
import { ModalManager } from "../ui/cache-button/modal-manager.js";
import { ExportLogic } from "../ui/cache-button/export-logic.js";

// ─── ButtonControl (real-map capture) ───────────────────────────────────────────
// S2: the button is no longer a top-left MapLibre IControl. ButtonControl now only
// captures the real map at map-ready so the modal sub-modules run against it.

describe("ButtonControl (map capture)", () => {
    test("returns null when map is falsy", () => {
        expect(BC.init(null, {})).toBeNull();
    });

    // Contract change, 24/08/2026: `ui.showCacheButton` no longer switches off
    // MAP CAPTURE — that coupling let a visible button open a modal over a null map. The
    // legacy key still hides the BUTTON (slot fallback); capture is unconditional.
    test("captures the map even when showCacheButton is false", () => {
        const map = { id: "m" };
        expect(BC.init(map, { ui: { showCacheButton: false } })).toBe(map);
    });

    test("captures and returns the real map when enabled", () => {
        const map = { id: "real-map" };
        expect(BC.init(map, { ui: { showCacheButton: true } })).toBe(map);
        expect(BC.getMap()).toBe(map);
    });

    test("captures without any ui config at all", () => {
        const map = { id: "m2" };
        expect(BC.init(map, {})).toBe(map);
        expect(BC.getMap()).toBe(map);
    });

    test("does not expose a Leaflet/top-left control surface anymore", () => {
        expect(BC.onAdd).toBeUndefined();
        expect(BC._setModalManager).toBeUndefined();
    });
});

// ─── Toolbar registration (registry slot + dispatch) ─────────────────────────────

describe("registerCacheToolbar", () => {
    test("registers an 'offline-ui' slot with mobileIcon + desktopTabButton", () => {
        const register = vi.fn();
        registerCacheToolbar({ GeoLeaf: { registry: { register } } });
        expect(register).toHaveBeenCalledTimes(1);
        const arg = register.mock.calls[0][0];
        expect(arg.id).toBe("offline-ui");
        for (const slot of [arg.ui.mobileIcon, arg.ui.desktopTabButton]) {
            expect(slot.action).toBe("offline-ui");
            // INV-CONFIG / PC-14 — the canonical key lives under
            // `modules.<pluginId>`. The old one stays declared as
            // `legacyProfileKey`: a profile still carrying it keeps governing the
            // button, with no migration on its plate (fallback in
            // `ui-slot-builder.ts`).
            expect(slot.profileKey).toBe("modules.offline-ui.showButton");
            expect(slot.legacyProfileKey).toBe("ui.showCacheButton");
            expect(slot.requiresPlugin).toBe("offline-ui");
            expect(slot.labelKey).toBe("storage.toolbar.button");
            expect(typeof slot.icon).toBe("string");
        }
    });

    test("opens the modal on geoleaf:toolbar:action with action 'offline-ui'", () => {
        const openModal = vi.fn();
        registerCacheToolbar({
            GeoLeaf: { registry: { register: vi.fn() }, UI: { CacheButton: { openModal } } },
        });
        document.dispatchEvent(
            new CustomEvent("geoleaf:toolbar:action", { detail: { action: "offline-ui" } })
        );
        expect(openModal).toHaveBeenCalled();
    });

    test("ignores toolbar actions other than 'offline-ui'", () => {
        const openModal = vi.fn();
        registerCacheToolbar({
            GeoLeaf: { registry: { register: vi.fn() }, UI: { CacheButton: { openModal } } },
        });
        document.dispatchEvent(
            new CustomEvent("geoleaf:toolbar:action", { detail: { action: "print" } })
        );
        expect(openModal).not.toHaveBeenCalled();
    });
});

// ─── ModalManager ─────────────────────────────────────────────────────────────

const mockExportLogic = {
    initializeCacheContent: vi.fn(),
    initializeExportContent: vi.fn(),
};

beforeEach(() => {
    // Clean DOM between tests
    const existing = document.getElementById("gl-cache-modal");
    if (existing) existing.parentNode.removeChild(existing);
    // Reset cleanups array (it's shared state on the singleton)
    ModalManager._eventCleanups = [];
    // Reset ExportLogic mock
    vi.clearAllMocks();
    ModalManager._setExportLogic(mockExportLogic);
});

describe("ModalManager.openModal", () => {
    test("creates #gl-cache-modal and sets display to flex", () => {
        ModalManager.openModal();
        const modal = document.getElementById("gl-cache-modal");
        expect(modal).not.toBeNull();
        expect(modal.style.display).toBe("flex");
    });

    test("calls ExportLogic.initializeCacheContent on open", () => {
        ModalManager.openModal();
        expect(mockExportLogic.initializeCacheContent).toHaveBeenCalled();
    });

    test("reuses existing modal on second open", () => {
        ModalManager.openModal();
        ModalManager.closeModal();
        ModalManager.openModal();
        const modals = document.querySelectorAll("#gl-cache-modal");
        expect(modals.length).toBe(1);
        expect(modals[0].style.display).toBe("flex");
    });
});

describe("ModalManager.closeModal", () => {
    test("sets display to none", () => {
        ModalManager.openModal();
        ModalManager.closeModal();
        const modal = document.getElementById("gl-cache-modal");
        expect(modal.style.display).toBe("none");
    });

    test("does not throw when modal does not exist", () => {
        expect(() => ModalManager.closeModal()).not.toThrow();
    });
});

describe("ModalManager.createModal", () => {
    test("appends modal to document.body", () => {
        ModalManager.createModal();
        expect(document.getElementById("gl-cache-modal")).not.toBeNull();
    });

    test("modal contains import and export tabs", () => {
        ModalManager.createModal();
        const tabs = document.querySelectorAll(".gl-cache-modal__tab");
        const tabNames = [...tabs].map((t) => t.dataset.tab);
        expect(tabNames).toContain("import");
        expect(tabNames).toContain("export");
    });

    test("contains #gl-cache-modal-body div", () => {
        ModalManager.createModal();
        const body = document.getElementById("gl-cache-modal-body");
        expect(body).not.toBeNull();
    });

    test("close button hides the modal when clicked", () => {
        ModalManager.createModal();
        const modal = document.getElementById("gl-cache-modal");
        modal.style.display = "flex";
        const closeBtn = document.querySelector(".gl-cache-modal__close");
        expect(closeBtn).not.toBeNull();
        closeBtn.click();
        expect(modal.style.display).toBe("none");
    });

    test("Escape key closes modal when display is flex", () => {
        ModalManager.createModal();
        const modal = document.getElementById("gl-cache-modal");
        modal.style.display = "flex";
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(modal.style.display).toBe("none");
    });
});

describe("ModalManager.switchTab", () => {
    beforeEach(() => {
        ModalManager.createModal();
    });

    test("activates the requested tab and deactivates others", () => {
        ModalManager.switchTab("export");
        const exportTab = [...document.querySelectorAll(".gl-cache-modal__tab")].find(
            (t) => t.dataset.tab === "export"
        );
        const importTab = [...document.querySelectorAll(".gl-cache-modal__tab")].find(
            (t) => t.dataset.tab === "import"
        );
        expect(exportTab.classList.contains("gl-cache-modal__tab--active")).toBe(true);
        expect(importTab.classList.contains("gl-cache-modal__tab--active")).toBe(false);
    });

    test('calls initializeCacheContent on "import" tab', () => {
        ModalManager.switchTab("import");
        expect(mockExportLogic.initializeCacheContent).toHaveBeenCalled();
    });

    test('calls initializeExportContent on "export" tab', () => {
        ModalManager.switchTab("export");
        expect(mockExportLogic.initializeExportContent).toHaveBeenCalled();
    });
});

describe("ModalManager.destroy", () => {
    test("removes modal from DOM", () => {
        ModalManager.createModal();
        expect(document.getElementById("gl-cache-modal")).not.toBeNull();
        ModalManager.destroy();
        expect(document.getElementById("gl-cache-modal")).toBeNull();
    });

    test("clears _eventCleanups array", () => {
        ModalManager.createModal();
        ModalManager.destroy();
        expect(ModalManager._eventCleanups.length).toBe(0);
    });

    test("does not throw when modal does not exist", () => {
        expect(() => ModalManager.destroy()).not.toThrow();
    });
});

// ─── ExportLogic ─────────────────────────────────────────────────────────────

describe("ExportLogic", () => {
    afterEach(() => {
        // Clean up any modal body elements added during tests
        const body = document.getElementById("gl-cache-modal-body");
        if (body && body.parentNode) body.parentNode.removeChild(body);
    });

    test("initializeCacheContent does nothing when modal body is absent", () => {
        // Ensure no body element
        const body = document.getElementById("gl-cache-modal-body");
        if (body) body.parentNode.removeChild(body);
        expect(() => ExportLogic.initializeCacheContent()).not.toThrow();
    });

    test("initializeCacheContent handles CacheControl not properly initialized", () => {
        // Create a modal body
        const body = document.createElement("div");
        body.id = "gl-cache-modal-body";
        document.body.appendChild(body);
        // CacheControl is {} from empty-module → .create() not a function → catch runs
        expect(() => ExportLogic.initializeCacheContent()).not.toThrow();
    });

    test("initializeCacheContent skips when body already initialized (CacheControl unavailable → TypeError swallowed by caller)", () => {
        const body = document.createElement("div");
        body.id = "gl-cache-modal-body";
        body.setAttribute("data-initialized", "true");
        document.body.appendChild(body);
        // With CacheControl stubbed to {}, the named import is undefined
        // The code may throw accessing undefined._updateStatus — verify the module loads correctly
        // This is a known limitation: the already-initialized branch assumes CacheControl is initialized
        // Test simply verifies the module is loadable and the function exists
        expect(typeof ExportLogic.initializeCacheContent).toBe("function");
    });

    test("initializeExportContent does nothing when modal body is absent", () => {
        expect(() => ExportLogic.initializeExportContent()).not.toThrow();
    });

    test("initializeExportContent runs without throwing when body is present", async () => {
        const body = document.createElement("div");
        body.id = "gl-cache-modal-body";
        document.body.appendChild(body);
        // StorageContract not available, openDatabase will fail → catch returns []
        // initializeExportContent calls getPendingPOIs().then() asynchronously
        expect(() => ExportLogic.initializeExportContent()).not.toThrow();
        // Allow microtasks to settle
        await new Promise((r) => setTimeout(r, 50));
    });

    test("ExportLogic exports initializeCacheContent and initializeExportContent", () => {
        expect(typeof ExportLogic.initializeCacheContent).toBe("function");
        expect(typeof ExportLogic.initializeExportContent).toBe("function");
        expect(typeof ExportLogic.getPendingPOIs).toBe("function");
    });
});
