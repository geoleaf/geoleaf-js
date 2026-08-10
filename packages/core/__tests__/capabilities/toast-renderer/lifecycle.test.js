/**
 * S7 — toast-renderer capability lifecycle.
 *
 * Covers: container creation, notify-primitive `registerRenderer` wiring, boot
 * loading toast (geoleaf:theme:applying/applied), profile toast
 * (geoleaf:profile:loaded), the opt-out config gate, and `_reset` teardown.
 *
 * Replaces the notification-boot tests formerly in app/init.test.js — the renderer
 * left UIModule/setupNotifications for this in-core capability (driven by
 * ToastRendererModule via the registry).
 */

const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock("../../../src/capabilities/toast-renderer/config.js", () => ({
    getToastRendererConfig: () => ({ enabled: gate.enabled }),
}));

import { ToastRendererLifecycle } from "../../../src/capabilities/toast-renderer/lifecycle.js";
import { _UINotifications } from "../../../src/capabilities/toast-renderer/notifications.js";
import { notifyPrimitive } from "../../../src/utils/notify/notify.primitive.js";

describe("toast-renderer capability — lifecycle", () => {
    beforeEach(() => {
        gate.enabled = true;
        document.body.innerHTML = "";
        ToastRendererLifecycle._reset();
    });

    afterEach(() => {
        ToastRendererLifecycle._reset();
        vi.restoreAllMocks();
    });

    it("creates the toast container and registers the renderer with the primitive on init", () => {
        const registerSpy = vi.spyOn(notifyPrimitive, "registerRenderer");
        ToastRendererLifecycle.init();
        expect(document.getElementById("gl-notifications")).toBeTruthy();
        expect(registerSpy).toHaveBeenCalled();
    });

    it("renders a kernel primitive notify() through the registered renderer", () => {
        const infoSpy = vi.spyOn(_UINotifications, "info");
        ToastRendererLifecycle.init();
        notifyPrimitive.notify("hello world", "info");
        expect(infoSpy).toHaveBeenCalledWith("hello world");
    });

    it("shows a persistent loading toast on theme:applying and dismisses it on theme:applied", () => {
        const infoSpy = vi
            .spyOn(_UINotifications, "info")
            .mockReturnValue(document.createElement("div"));
        const dismissSpy = vi.spyOn(_UINotifications, "dismiss");
        ToastRendererLifecycle.init();

        document.dispatchEvent(new CustomEvent("geoleaf:theme:applying"));
        expect(infoSpy).toHaveBeenCalled();

        document.dispatchEvent(
            new CustomEvent("geoleaf:theme:applied", { detail: { themeName: "t", layerCount: 1 } })
        );
        expect(dismissSpy).toHaveBeenCalled();
    });

    it("emits a profile toast through the primitive on profile:loaded", () => {
        const notifySpy = vi.spyOn(notifyPrimitive, "notify");
        ToastRendererLifecycle.init();
        document.dispatchEvent(
            new CustomEvent("geoleaf:profile:loaded", {
                detail: { data: { profile: { label: "My profile" } } },
            })
        );
        expect(notifySpy).toHaveBeenCalledWith(expect.any(String), "success");
    });

    it("is inert when the capability is disabled (opt-out gate)", () => {
        gate.enabled = false;
        const registerSpy = vi.spyOn(notifyPrimitive, "registerRenderer");
        ToastRendererLifecycle.init();
        expect(document.getElementById("gl-notifications")).toBeFalsy();
        expect(registerSpy).not.toHaveBeenCalled();
    });

    it("_reset detaches listeners and tears down the renderer", () => {
        ToastRendererLifecycle.init();
        const destroySpy = vi.spyOn(_UINotifications, "destroy");
        const infoSpy = vi.spyOn(_UINotifications, "info");
        ToastRendererLifecycle._reset();
        expect(destroySpy).toHaveBeenCalled();
        // Listener detached: a theme:applying event no longer shows a toast.
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applying"));
        expect(infoSpy).not.toHaveBeenCalled();
    });

    // ── B.27d — teardown symmetry ────────────────────────────────────────────
    //
    // `_reset()` destroyed the singleton but left the notify primitive pointing at
    // it, and left the container element it had created in `document.body`. The
    // primitive therefore kept routing every `notify()` into a renderer with no
    // container — where `_processQueue` drops it on the floor. Not "the toast does
    // not show": the message is *lost*, and the console fallback that exists for
    // exactly this case never runs, because the primitive believes it has a renderer.

    it("_reset() unregisters the renderer — notify() no longer reaches the destroyed singleton", () => {
        ToastRendererLifecycle.init();
        ToastRendererLifecycle._reset();
        const infoSpy = vi.spyOn(_UINotifications, "info");
        notifyPrimitive.notify("after teardown", "info");
        expect(infoSpy).not.toHaveBeenCalled();
    });

    it("a notify() after teardown is buffered, not swallowed", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        ToastRendererLifecycle.init();
        ToastRendererLifecycle._reset();

        notifyPrimitive.notify("late message", "error");

        // The primitive is back to its pre-boot behaviour: buffer + console fallback,
        // and hand the backlog to whoever registers next.
        const seen = [];
        notifyPrimitive.registerRenderer((message, level) => seen.push([message, level]));
        expect(seen).toEqual([["late message", "error"]]);
    });

    it("_reset() removes the container it created", () => {
        ToastRendererLifecycle.init();
        expect(document.getElementById("gl-notifications")).toBeTruthy();
        ToastRendererLifecycle._reset();
        expect(document.getElementById("gl-notifications")).toBeNull();
    });

    it("_reset() leaves a host-provided container alone", () => {
        // Bounds the removal above: the capability may only take back what it created.
        const host = document.createElement("div");
        host.id = "gl-notifications";
        document.body.appendChild(host);

        ToastRendererLifecycle.init();
        ToastRendererLifecycle._reset();

        expect(document.getElementById("gl-notifications")).toBe(host);
    });

    it("is idempotent — a second init() does not re-register the renderer", () => {
        ToastRendererLifecycle.init();
        const registerSpy = vi.spyOn(notifyPrimitive, "registerRenderer");
        ToastRendererLifecycle.init();
        expect(registerSpy).not.toHaveBeenCalled();
    });

    it("re-enables the renderer on recreate (init → _reset → init) so toasts still render", () => {
        // _reset() calls _UINotifications.destroy(), which disables the singleton.
        // On recreate, lifecycle.init() must re-enable it, else _processQueue no-ops.
        ToastRendererLifecycle.init();
        ToastRendererLifecycle._reset();
        ToastRendererLifecycle.init();
        notifyPrimitive.notify("after recreate", "error");
        const container = document.getElementById("gl-notifications");
        expect(container?.querySelector(".gl-toast")).toBeTruthy();
    });
});
