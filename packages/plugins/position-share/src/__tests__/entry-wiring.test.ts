/**
 * @geoleaf-plugins/position-share — entry wiring
 *
 * `entry.ts` is excluded from the coverage report (it is glue, not logic), but the wiring it
 * performs is exactly the part that fails SILENTLY: a slot nobody registers, or a listener that
 * calls a method which no longer exists, both look fine from the outside. These assertions run
 * the real module against a mocked namespace.
 *
 * The module is loaded ONCE for the whole file, and that is not a convenience. Its
 * `geoleaf:toolbar:action` listener is permanent — no `{ once: true }` — and `document` survives
 * `vi.resetModules()`, so one load per test would leave a listener behind each time and every
 * exact call count would drift upward with the test order.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

interface RegisteredSlot {
    id: string;
    ui?: {
        mobileIcon?: { profileKey?: string; action?: string; labelKey?: string };
        desktopTabButton?: { profileKey?: string; action?: string; labelKey?: string };
    };
}

const registerDict = vi.fn();
const registerPlugin = vi.fn();
const registerSlot = vi.fn();
const toggle = vi.fn();

beforeAll(async () => {
    (globalThis as Record<string, unknown>).GeoLeaf = {
        I18n: { registerDict },
        plugins: { register: registerPlugin },
        registry: { register: registerSlot },
        Config: { get: () => ({}) },
        Log: { warn: vi.fn(), info: vi.fn() },
    };
    await import("../entry.js");
});

beforeEach(() => {
    toggle.mockClear();
});

afterAll(() => {
    delete (globalThis as Record<string, unknown>).GeoLeaf;
});

describe("entry.ts wiring", () => {
    it("mounts the namespace on the host", () => {
        const host = (globalThis as Record<string, unknown>).GeoLeaf as Record<string, unknown>;
        expect(typeof host.PositionShare).toBe("object");
    });

    it("registers the plugin with the documented manifest", () => {
        expect(registerPlugin).toHaveBeenCalledTimes(1);
        const [id, manifest] = registerPlugin.mock.calls[0] as [
            string,
            { requires: string[]; optional: string[]; label: string },
        ];
        expect(id).toBe("position-share");
        expect(manifest.label).toBe("GeoLeaf Position Share");
        expect(manifest.requires).toEqual([]);
        // Both are CONDITIONAL dependencies, each tied to one configuration key.
        expect(manifest.optional).toEqual(["realtime-layer", "websocket"]);
    });

    it("registers the i18n dictionaries before anything reads a label", () => {
        expect(registerDict).toHaveBeenCalledWith(
            "position-share",
            expect.objectContaining({ fr: expect.anything(), en: expect.anything() })
        );
    });

    // INV-CONFIG: the button must obey the SAME profile branch `config.ts` reads. The scaffold
    // wrote `ui.show<Namespace>` until 08/08/2026 — two keys, two casings, and a button that
    // stayed invisible with nothing in the output to say why.
    it("declares its toolbar slot under modules.<id>, never ui.showXxx", () => {
        expect(registerSlot).toHaveBeenCalledTimes(1);
        const [slot] = registerSlot.mock.calls[0] as [RegisteredSlot];
        expect(slot.id).toBe("position-share");
        for (const variant of [slot.ui?.mobileIcon, slot.ui?.desktopTabButton]) {
            expect(variant?.profileKey).toBe("modules.position-share.showButton");
            expect(variant?.action).toBe("position-share");
        }
    });

    it("toggles emission when the toolbar fires its action", () => {
        const host = (globalThis as Record<string, unknown>).GeoLeaf as Record<string, unknown>;
        (host.PositionShare as Record<string, unknown>).toggle = toggle;

        document.dispatchEvent(
            new CustomEvent("geoleaf:toolbar:action", { detail: { action: "position-share" } })
        );

        expect(toggle).toHaveBeenCalledTimes(1);
    });

    it("ignores toolbar actions addressed to another plugin", () => {
        const host = (globalThis as Record<string, unknown>).GeoLeaf as Record<string, unknown>;
        (host.PositionShare as Record<string, unknown>).toggle = toggle;

        document.dispatchEvent(
            new CustomEvent("geoleaf:toolbar:action", { detail: { action: "table" } })
        );

        expect(toggle).not.toHaveBeenCalled();
    });
});
