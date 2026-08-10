/**
 * @tests built-in/ui/toolbar-dispatch — geoleaf:toolbar:action emission
 *
 * Extracted in KERNEL S8 from two identical blocks (mobile-toolbar +
 * desktop-panel-slots). The eager path is driven end-to-end by
 * `mobile-toolbar-action-dispatch.test.js`; the LAZY branch had no coverage at all
 * (50 % file) — it is the branch that awaits the plugin bundle before emitting, so
 * a regression there would silently drop the action for every lazy plugin.
 */
import { dispatchToolbarAction } from "../../src/kernel/ui/toolbar-dispatch.js";

/** Installs a minimal `GeoLeaf.plugins` with the lazy-resolution surface. */
function stubPlugins(plugins) {
    globalThis.GeoLeaf = { plugins };
}

/**
 * Resolves with the first `geoleaf:toolbar:action` detail, or null after `ms`.
 *
 * ⚠️ The timeout MUST be cleared on the happy path. Without the `clearTimeout`, every
 * successful capture left a 200 ms timer running past the end of the test; when the
 * file finished inside that window, the callback fired against a torn-down happy-dom
 * and threw `ReferenceError: document is not defined`. Vitest reports that as an
 * unhandled error and exits 1 — with all 386 files and 7958 tests green — so the whole
 * pipeline failed intermittently, on timing, with no failing test to point at.
 * Diagnosed while closing KERNEL S13.
 */
function captureAction(ms = 200) {
    return new Promise((resolve) => {
        // `cleanup` is a hoisted function declaration so both branches can share it
        // while `timer` stays initialised at its declaration (prefer-const).
        function cleanup() {
            clearTimeout(timer);
            document.removeEventListener("geoleaf:toolbar:action", on);
        }
        const on = (e) => {
            cleanup();
            resolve(e.detail);
        };
        const timer = setTimeout(() => {
            cleanup();
            resolve(null);
        }, ms);
        document.addEventListener("geoleaf:toolbar:action", on);
    });
}

describe("dispatchToolbarAction", () => {
    let btn;

    beforeEach(() => {
        btn = document.createElement("button");
        document.body.appendChild(btn);
    });

    afterEach(() => {
        document.body.innerHTML = "";
        delete globalThis.GeoLeaf;
        vi.restoreAllMocks();
    });

    describe("eager path", () => {
        it("emits immediately with the action and element", async () => {
            stubPlugins({ isLazyAction: () => false });
            const captured = captureAction();
            dispatchToolbarAction("print", btn);
            const detail = await captured;
            expect(detail).toEqual({ action: "print", element: btn });
        });

        it("emits when no plugin registry is present at all", async () => {
            globalThis.GeoLeaf = {};
            const captured = captureAction();
            dispatchToolbarAction("print", btn);
            expect(await captured).toEqual({ action: "print", element: btn });
        });

        it("does not bubble — listeners are bound on document by contract", async () => {
            stubPlugins({ isLazyAction: () => false });
            let bubbled = false;
            btn.addEventListener("geoleaf:toolbar:action", () => (bubbled = true));
            const captured = captureAction();
            dispatchToolbarAction("print", btn);
            await captured;
            expect(bubbled).toBe(false);
        });
    });

    describe("lazy path", () => {
        it("loads the plugin BEFORE emitting, so its listener is registered in time", async () => {
            const order = [];
            const ensureLoadedForAction = vi.fn(async () => {
                order.push("loaded");
            });
            stubPlugins({ isLazyAction: () => true, ensureLoadedForAction });

            const captured = captureAction(500).then((d) => {
                if (d) order.push("emitted");
                return d;
            });
            dispatchToolbarAction("measure", btn);
            const detail = await captured;

            expect(ensureLoadedForAction).toHaveBeenCalledWith("measure");
            expect(detail).toEqual({ action: "measure", element: btn });
            expect(order).toEqual(["loaded", "emitted"]);
        });

        it("returns synchronously — it is fire-and-forget, callers must keep their own return", () => {
            stubPlugins({
                isLazyAction: () => true,
                ensureLoadedForAction: () => new Promise(() => {}), // never settles
            });
            expect(dispatchToolbarAction("measure", btn)).toBeUndefined();
        });

        it("logs and does not emit when the bundle fails to load", async () => {
            stubPlugins({
                isLazyAction: () => true,
                ensureLoadedForAction: () => Promise.reject(new Error("network down")),
            });
            const captured = captureAction(300);
            dispatchToolbarAction("measure", btn);
            expect(await captured).toBeNull();
        });

        it("does not throw when the load rejects (unhandled rejection guard)", async () => {
            stubPlugins({
                isLazyAction: () => true,
                ensureLoadedForAction: () => Promise.reject(new Error("boom")),
            });
            expect(() => dispatchToolbarAction("measure", btn)).not.toThrow();
            await new Promise((r) => setTimeout(r, 50));
        });
    });
});
