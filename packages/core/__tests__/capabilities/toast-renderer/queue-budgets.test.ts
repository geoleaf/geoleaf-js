/**
 * The toast queue serves each budget on its own, and every emission returns what the contract
 * says — the toast, `null` (refused), or `undefined` (nothing to render it).
 *
 * ## The defects
 *
 * 1. **A persistent toast waited behind temporaries.** `_processQueue` stopped at the head of the
 *    queue as soon as it could not show it: five `info` filled the temporary budget, and a
 *    persistent one queued after them — its own budget free — waited until they faded, about 3 s.
 * 2. **The caller could get another toast.** The pass returned the LAST toast it showed, not the
 *    caller's: a `dismiss()` on it would close somebody else's message.
 * 3. **Switched off, the capability swallowed messages.** With `modules.toast-renderer.enabled:
 *    false`, `Notifications.warning()` returned `null` — the value reserved for a refusal — and
 *    piled the message into a queue nothing would ever drain, with no console trace. The
 *    primitive `GeoLeaf.notify` already fell back to the console.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { block } = vi.hoisted(() => ({ block: { value: {} as Record<string, unknown> } }));

vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: {
        get: (path: string, def?: unknown) =>
            path === "modules.toast-renderer" ? block.value : def,
    },
}));

const { NotificationSystem } =
    await import("../../../src/capabilities/toast-renderer/notifications.js");

type System = InstanceType<typeof NotificationSystem>;

function mounted(): System {
    const host = document.createElement("div");
    host.id = "gl-notifications";
    document.body.appendChild(host);
    const sys = new NotificationSystem();
    sys.init({ container: "#gl-notifications", animations: false });
    return sys;
}

beforeEach(() => {
    document.body.innerHTML = "";
    block.value = {};
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("file des toasts — deux budgets servis chacun à son tour", () => {
    it("cinq temporaires puis un persistant : le persistant est rendu au premier passage", () => {
        const sys = mounted();
        for (let i = 0; i < 5; i++) sys.info(`message ${i}`);
        const persistent = sys.show("En cours…", { type: "info", persistent: true });
        expect(persistent).toBeInstanceOf(HTMLElement);
        expect((persistent as HTMLElement).dataset.persistent).toBeTruthy();
        expect((persistent as HTMLElement).textContent).toContain("En cours…");
    });

    it("non-régression : un temporaire qui attend rend null et reste en file", () => {
        const sys = mounted();
        const max = sys.maxVisible;
        for (let i = 0; i < max; i++) sys.info(`plein ${i}`);
        const waiting = sys.info("en attente");
        expect(waiting).toBeNull();
        expect(sys.getStatus().queued).toBe(1);
    });
});

describe("capacité éteinte — repli console, comme la primitive", () => {
    it("rend undefined, écrit en console, et n'empile rien", () => {
        block.value = { enabled: false };
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const sys = new NotificationSystem();
        expect(sys.warning("Couche introuvable")).toBeUndefined();
        expect(warn).toHaveBeenCalledWith("[GeoLeaf]", "Couche introuvable");
        expect(sys.getStatus().queued).toBe(0);
    });

    it("allumée mais pas encore montée : rend undefined et garde le message pour init()", () => {
        const sys = new NotificationSystem();
        expect(sys.info("au démarrage")).toBeUndefined();
        expect(sys.getStatus().queued).toBe(1);
    });
});
