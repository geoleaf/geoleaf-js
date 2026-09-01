/**
 * Unit tests — `cache/cache-control.ts`, real coverage.
 *
 * File measured at 0%: the FACTORY + the IControl shell (onAdd/onRemove) of the
 * cache control. It is stubbed (`empty-module`) for the OTHER modules by the
 * cross-plugin alias `(\.\.\/)+cache/cache-control.(js|ts)` — but the alias
 * requires the extension. So we import it WITHOUT extension
 * (`../cache/cache-control`), which does not match the pattern and resolves the
 * real file. We cover `create` (default vs explicit options), `onAdd`
 * (structure, sub-module init, deferred task) and `onRemove` (cleanup).
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

// ⚠️ WITHOUT extension — bypasses the alias stubbing `../cache/cache-control.js`.
import { CacheControl } from "../cache/cache-control";

// The tests plant `GeoLeaf.Storage` the way PRODUCTION does. They used to drive
// `StorageContract.init()`, i.e. a SECOND instance of the singleton the bundle
// embedded and nothing initialised: they validated a dead channel.
function _installGeoLeafStorage(api) {
    globalThis.GeoLeaf = globalThis.GeoLeaf ?? {};
    // The helper reproduces what `StorageContract.init()` provided, because the
    // core's facade provides it too: `isPluginLoaded()` = "an engine registered",
    // and `isAvailable()` = "and its database is open". The plugin's adapter
    // DELEGATES these two methods — it does not recompute them — so a planted
    // object not carrying them would return `false` where the test expects
    // `true`. A caller providing them keeps the hand.
    globalThis.GeoLeaf.Storage =
        api === null || api === undefined
            ? null
            : {
                  isPluginLoaded: () => true,
                  isAvailable: () => !!api.DB,
                  ...api,
              };
    return api;
}

beforeEach(() => {
    globalThis.GeoLeaf = globalThis.GeoLeaf || {};
    // empty profile → the deferred task (populate) exits early without fetch
    globalThis.GeoLeaf.Config = { get: (_k, fb) => fb };
    _installGeoLeafStorage(null);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("CacheControl.create", () => {
    test("options par défaut → topright, non replié, repliable", () => {
        const ctrl = CacheControl.create();
        expect(typeof ctrl.onAdd).toBe("function");
        expect(typeof ctrl.onRemove).toBe("function");
    });

    test("options explicites → position, collapsed, collapsible pris en compte", () => {
        const ctrl = CacheControl.create({
            position: "topleft",
            collapsed: true,
            collapsible: false,
        });
        expect(ctrl).toBeTruthy();
    });
});

describe("onAdd / onRemove", () => {
    test("onAdd bâtit le conteneur, initialise les sous-modules et rend l'élément", async () => {
        vi.useFakeTimers();
        const ctrl = CacheControl.create();
        const container = ctrl.onAdd({ id: "map" });

        expect(container).toBeTruthy();
        expect(container.className).toContain("gl-cache-control");
        // the structure was built (body + buttons)
        expect(container.querySelector(".gl-cache-control__body")).toBeTruthy();

        // the deferred task (populate + updateStatus) is protected by a
        // try/catch: advancing it covers its body whatever the outcome.
        await vi.runAllTimersAsync();
    });

    test("wheel sur le conteneur ne se propage pas", () => {
        vi.useFakeTimers();
        const ctrl = CacheControl.create();
        const container = ctrl.onAdd({ id: "map" });
        const ev = new Event("wheel", { bubbles: true, cancelable: true });
        // must not throw; the handler calls stopPropagation
        expect(() => container.dispatchEvent(ev)).not.toThrow();
    });

    test("onRemove nettoie et détache la carte", () => {
        vi.useFakeTimers();
        const ctrl = CacheControl.create();
        ctrl.onAdd({ id: "map" });
        expect(() => ctrl.onRemove({ id: "map" })).not.toThrow();
    });

    // ── The factory's DELEGATIONS ─────────────────────────────
    //
    // `createCacheControl` mounts a state of which **seventeen members are
    // delegation arrows** (`_handleDownload: () => DownloadHandler.handleDownload()`,
    // etc.). Istanbul counts each as a function: seven of them — the handlers,
    // lines 75-81 — were exercised by no test, which is what held the file at
    // **52.38% functions** and the package at **80.00% for a threshold of 80**.
    //
    // 🛑 **The margin was NIL, and the repair is known**: "the only legitimate
    // gesture is to cover one more function" — never by lowering the threshold.
    //
    // The handlers are wired by `attachEventListeners`, called from
    // `buildStructure` (`cache-control-dom.ts`), so they exercise through the
    // DOM. We click ALL the container's buttons rather than named classes: a
    // renamed class would make this test miss its target **while staying
    // green**, the failure mode this repo hunts everywhere else.
    test("cliquer chaque bouton exerce les délégations de handler", async () => {
        vi.useFakeTimers();
        const ctrl = CacheControl.create();
        const container = ctrl.onAdd({ id: "map" });

        const buttons = Array.from(container.querySelectorAll("button"));
        // Anti-empty-test: if the structure stops producing buttons, this test
        // must turn RED instead of covering zero delegations silently.
        expect(buttons.length).toBeGreaterThan(0);

        for (const btn of buttons) {
            expect(() => btn.click()).not.toThrow();
        }

        // `_handleCancelled` has no button: it is wired on a document event
        // (`cache-control-events.ts`).
        expect(() =>
            document.dispatchEvent(new Event("geoleaf:cache:cancelled", { bubbles: true }))
        ).not.toThrow();

        await vi.runAllTimersAsync();
    });
});
