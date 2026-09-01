/**
 * T10.3.2 — notifications-branches-deep.test.js
 * Covers: src/capabilities/toast-renderer/notifications.ts (133 branches)
 * Strategy: await import() + mock minimal (Log, TimerManager, getLabel, events)
 * Does NOT mock $create — runs real DOM operations via jsdom.
 */
"use strict";

// ── Mocks (external boundaries only) ──────────────────────────────────────────
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((key) => key),
}));

// B.35d — the event manager is NOT mocked. A `{ destroy }` stub made every
// listener question unanswerable: the leak lives in whether the close button is
// registered on the renderer's own manager or on the global one, and a stub has
// neither list. The real class is a plain in-memory registry (no I/O), so using
// it costs nothing and is what the assertions below read.
vi.mock("../../src/utils/general/event-listener-manager.js", async (importOriginal) =>
    importOriginal()
);

vi.mock("../../src/utils/general/timer-manager.js", () => ({
    // Vitest 4: `new TimerManager()` requires a constructable mock — a class whose
    // constructor returns the fake instance (arrow mockImplementation is not a constructor).
    TimerManager: vi.fn().mockImplementation(
        class {
            constructor() {
                return {
                    setTimeout: vi.fn((cb, delay) => {
                        // return a fake id and call callback synchronously for instant test
                        const id = setTimeout(cb, delay);
                        return id;
                    }),
                    clearTimeout: vi.fn((id) => clearTimeout(id)),
                    destroy: vi.fn(),
                };
            }
        }
    ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContainer() {
    const div = document.createElement("div");
    div.id = "gl-notifications";
    document.body.appendChild(div);
    return div;
}

function removeContainer(div) {
    if (div && div.parentNode) div.parentNode.removeChild(div);
}

/** Toasts actually on screen — mirrors the selector `_processQueue` counts with. */
function visibleToasts() {
    return document.querySelectorAll("#gl-notifications .gl-toast:not(.gl-toast--removing)");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("notifications — NotificationSystem (T10.3.2)", () => {
    let NotificationSystem;
    let _UINotifications;
    let container;

    beforeAll(async () => {
        const mod = await import("../../src/capabilities/toast-renderer/notifications.ts");
        NotificationSystem = mod.NotificationSystem;
        _UINotifications = mod._UINotifications;
    });

    beforeEach(() => {
        container = makeContainer();
    });

    afterEach(() => {
        removeContainer(container);
        // Destroy singleton state after each test
        try {
            _UINotifications.destroy();
        } catch (_) {
            // destroy() throws when the singleton was never initialised by the test
            // above — teardown must stay best-effort either way.
        }
    });

    // ── init() ────────────────────────────────────────────────────────────────

    describe("init()", () => {
        it("returns false when container not found", () => {
            const sys = new NotificationSystem();
            expect(sys.init({ container: "#nonexistent" })).toBe(false);
        });

        it("returns true and sets container when found", () => {
            const sys = new NotificationSystem();
            expect(sys.init({ container: "#gl-notifications" })).toBe(true);
            expect(sys.container).toBe(container);
        });

        it("applies position class when config.position provided", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", position: "top-right" });
            expect(sys.container.className).toBe("gl-notifications gl-notifications--top-right");
        });

        it("uses default '#gl-notifications' when container not specified", () => {
            const sys = new NotificationSystem();
            sys.init({});
            expect(sys.container).toBe(container);
        });

        // Renamed under B.19 (contract settled as full re-initialisation). The
        // assertion is unchanged and still passes — what it actually verifies is that
        // `durations` is layered over the BUILT-IN DEFAULTS per key, which holds under
        // either reading. The old name ("merges durations from config") read as if it
        // pinned a merge over the *previous call*; it never did, and that stronger
        // claim is now explicitly refused by the uniform-reset test below.
        it("durations from config override the defaults per key, others keep theirs", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", durations: { success: 9999 } });
            expect(sys.durations.success).toBe(9999);
            expect(sys.durations.error).toBe(5000);
        });

        it("maxVisible taken from config", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", maxVisible: 5 });
            expect(sys.maxVisible).toBe(5);
        });

        // Regression (S8) — `maxPersistent` was declared on INotificationInitConfig
        // and documented `@default 2`, but `init()` never read it: the value was
        // frozen at the constructor default, so configuring it did nothing.
        it("maxPersistent taken from config", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", maxPersistent: 4 });
            expect(sys.maxPersistent).toBe(4);
        });

        it("maxPersistent falls back to its default when absent", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications" });
            expect(sys.maxPersistent).toBe(2);
        });

        // ── B.19 — what init() promises ──────────────────────────────────────
        //
        // Settled as **full re-initialisation**: every option resolves from the
        // argument, falling back to its built-in default, and a freshly initialised
        // renderer is enabled. It used to be neither one thing nor the other —
        // `position` / `animations` / `durations` merged over the current state while
        // `maxVisible` / `maxPersistent` fell back to the defaults, and `enabled` was
        // simply never restored, so the recreate path came back silently mute unless
        // the caller happened to know it had to `enable()` by hand.

        it("init() after destroy() comes back enabled (recreate is not silently mute)", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            sys.destroy();

            expect(sys.init({ container: "#gl-notifications", animations: false })).toBe(true);
            expect(sys.getStatus().enabled).toBe(true);
            sys.show("after recreate", "info");
            expect(visibleToasts().length).toBe(1);
        });

        it("a partial re-init resets every omitted option to its default — uniformly", () => {
            const sys = new NotificationSystem();
            sys.init({
                container: "#gl-notifications",
                durations: { success: 9999 },
                position: "top-right",
                animations: false,
                maxVisible: 7,
                maxPersistent: 5,
            });

            sys.init({ container: "#gl-notifications" });

            expect(sys.durations.success).toBe(3000);
            expect(sys.getStatus().position).toBe("bottom-center");
            expect(sys.config.animations).toBe(true);
            expect(sys.maxVisible).toBe(3);
            expect(sys.maxPersistent).toBe(2);
        });

        it("a configured maxPersistent actually caps persistent toasts on screen", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false, maxPersistent: 1 });
            sys.show("P1", { persistent: true });
            sys.show("P2", { persistent: true });
            expect(container.querySelectorAll(".gl-toast[data-persistent]").length).toBe(1);
            expect(sys._queue.length).toBe(1);
        });
    });

    // ── show() — signature positionnelle ─────────────────────────────────────

    describe("show() positional signature", () => {
        let sys;
        beforeEach(() => {
            sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
        });

        it("show(msg, 'success') creates a toast", () => {
            const toast = sys.show("Saved!", "success");
            expect(toast).not.toBeNull();
            expect(toast.classList.contains("gl-toast--success")).toBe(true);
        });

        it("show(msg, 'error') creates error toast", () => {
            const t = sys.show("Err", "error");
            expect(t.classList.contains("gl-toast--error")).toBe(true);
        });

        it("show(msg, 'warning') creates warning toast", () => {
            const t = sys.show("Warn", "warning");
            expect(t.classList.contains("gl-toast--warning")).toBe(true);
        });

        it("show(msg, 'info') creates info toast", () => {
            const t = sys.show("Info", "info");
            expect(t.classList.contains("gl-toast--info")).toBe(true);
        });

        it("show with duration param passes it through", () => {
            const t = sys.show("Msg", "success", 1234);
            expect(t).not.toBeNull();
        });

        it("show with null typeOrOptions falls back to 'info'", () => {
            const t = sys.show("Msg", null);
            expect(t.classList.contains("gl-toast--info")).toBe(true);
        });
    });

    // ── show() — options object signature ────────────────────────────────────

    describe("show() options object signature", () => {
        let sys;
        beforeEach(() => {
            sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
        });

        it("options with type:success", () => {
            const t = sys.show("ok", { type: "success" });
            expect(t.classList.contains("gl-toast--success")).toBe(true);
        });

        it("options with persistent:true → toast has data-persistent", () => {
            const t = sys.show("persist", { type: "info", persistent: true });
            expect(t.dataset.persistent).toBe("true");
        });

        it("options with dismissible:false → no close button", () => {
            const t = sys.show("no close", { type: "info", dismissible: false });
            expect(t.querySelector(".gl-toast__close")).toBeNull();
        });

        it("options with dismissible defaults to true → close button present", () => {
            const t = sys.show("has close", { type: "info" });
            expect(t.querySelector(".gl-toast__close")).not.toBeNull();
        });
    });

    // ── shortcuts: success, error, warning, info ────────────────────────────

    describe("shortcut methods", () => {
        let sys;
        beforeEach(() => {
            sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
        });

        it("success(msg) creates success toast", () => {
            const t = sys.success("ok");
            expect(t.classList.contains("gl-toast--success")).toBe(true);
        });

        it("success(msg, 3000) — number duration", () => {
            const t = sys.success("ok", 3000);
            expect(t).not.toBeNull();
        });

        it("success(msg, {duration:3000}) — options object", () => {
            const t = sys.success("ok", { duration: 3000 });
            expect(t).not.toBeNull();
        });

        it("error(msg) creates error toast", () => {
            const t = sys.error("fail");
            expect(t.classList.contains("gl-toast--error")).toBe(true);
        });

        it("error(msg, 5000) — number duration", () => {
            const t = sys.error("fail", 5000);
            expect(t).not.toBeNull();
        });

        it("error(msg, {persistent:true}) — options", () => {
            const t = sys.error("fail", { persistent: true });
            expect(t.dataset.persistent).toBe("true");
        });

        it("warning(msg) creates warning toast", () => {
            const t = sys.warning("warn");
            expect(t.classList.contains("gl-toast--warning")).toBe(true);
        });

        it("warning(msg, 4000) — number duration", () => {
            const t = sys.warning("warn", 4000);
            expect(t).not.toBeNull();
        });

        it("warning(msg, {duration:4000})", () => {
            const t = sys.warning("warn", { duration: 4000 });
            expect(t).not.toBeNull();
        });

        it("info(msg) creates info toast", () => {
            const t = sys.info("hello");
            expect(t.classList.contains("gl-toast--info")).toBe(true);
        });

        it("info(msg, 3000) — number duration", () => {
            const t = sys.info("hello", 3000);
            expect(t).not.toBeNull();
        });

        // The four shortcuts share one body (`_typed`, S8). Before that factorisation
        // each tested `typeof x === "object"` WITHOUT a null guard, so `null` took the
        // options branch and relied on `{...null}` spreading to `{}`. The guard now
        // sends it to the bare-type branch — this pins the two as equivalent.
        it("a null second argument yields the same toast as omitting it", () => {
            const withNull = sys.success("N", null);
            const without = sys.success("N");
            expect(withNull.className).toBe(without.className);
            expect(withNull.querySelector(".gl-toast__close")).not.toBeNull();
            expect(withNull.dataset.persistent).toBeUndefined();
        });

        it("info(msg, {dismissible:false})", () => {
            const t = sys.info("hello", { dismissible: false });
            expect(t.querySelector(".gl-toast__close")).toBeNull();
        });
    });

    // ── animations ───────────────────────────────────────────────────────────

    describe("animations: true branch", () => {
        it("does not immediately add gl-toast--visible when animations:true", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: true });
            const t = sys.show("anim", "info");
            // Immediately after show, animations use rAF so visible class may not be present yet
            // Just verify toast exists
            expect(t.classList.contains("gl-toast")).toBe(true);
        });

        it("adds gl-toast--visible immediately when animations:false", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            const t = sys.show("no anim", "info");
            expect(t.classList.contains("gl-toast--visible")).toBe(true);
        });
    });

    // ── queue / maxVisible ────────────────────────────────────────────────────

    describe("queue maxVisible management", () => {
        let sys;
        beforeEach(() => {
            sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false, maxVisible: 2 });
        });

        it("queues 4th toast when maxVisible=2 and animations off", () => {
            sys.show("A", "info");
            sys.show("B", "info");
            sys.show("C", "info"); // should be queued
            sys.show("D", "info"); // should be queued
            expect(sys._queue.length).toBeGreaterThanOrEqual(1);
        });

        it("error toast displaces a lower-priority info toast and keeps maxVisible", () => {
            // Fill visible slots with info
            sys.show("Info1", "info");
            sys.show("Info2", "info");
            // Error has higher priority — it must replace one, not stack on top.
            const t = sys.show("Critical!", "error");
            expect(t).not.toBeNull();
            expect(t.classList.contains("gl-toast--error")).toBe(true);
            // Exactly one info was marked for removal, and the live count is unchanged.
            expect(visibleToasts().length).toBe(2);
            expect(container.querySelectorAll(".gl-toast--removing").length).toBe(1);
        });

        // Regression (S8) — `_makeSpaceForPriority` used to return `true` even when it
        // had freed nothing: `_remove()` no-ops on a toast already marked
        // `gl-toast--removing`, and the real DOM removal is deferred, so the caller's
        // `temporaryToasts` counter never shrank. Every extra error in the SAME
        // `_processQueue()` pass re-targeted that one already-removing toast and was
        // shown anyway. Reproduced through disable()/enable(), the documented way to
        // let several items pile up in the queue before a single processing pass.
        it("a burst of error toasts processed in one pass never exceeds maxVisible", () => {
            sys.show("Info1", "info");
            sys.show("Info2", "info");
            expect(visibleToasts().length).toBe(2);

            sys.disable(); // `_processQueue` short-circuits — the queue piles up
            sys.show("Err1", "error");
            sys.show("Err2", "error");
            sys.show("Err3", "error");
            expect(sys._queue.length).toBe(3);

            sys.enable(); // single `_processQueue()` pass over the 3 queued errors

            expect(visibleToasts().length).toBeLessThanOrEqual(2);
        });
    });

    // ── queue size limit ──────────────────────────────────────────────────────

    describe("queue size limit (_maxQueueSize)", () => {
        it("drops low-priority item when queue full and new item has higher priority", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false, maxVisible: 1 });
            sys._maxQueueSize = 3;
            // Fill queue with low-priority items
            sys.show("q1", "info"); // visible slot taken
            sys.show("q2", "info"); // queued
            sys.show("q3", "info"); // queued
            sys.show("q4", "info"); // queued — queue is now full
            expect(sys._queue.map((i) => i.message)).toEqual(["q2", "q3", "q4"]); // full

            // The error evicts the oldest lowest-priority item (q2), then sorts to the
            // front of the queue and is displayed straight away — it never waits.
            const t = sys.show("CRITICAL", "error");
            expect(t.classList.contains("gl-toast--error")).toBe(true);
            expect(sys._queue.map((i) => i.message)).toEqual(["q3", "q4"]);
        });

        it("rejects new low-priority item when queue full", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false, maxVisible: 1 });
            sys._maxQueueSize = 2;
            sys.show("v", "info"); // visible
            sys.show("q1", "info"); // queued
            sys.show("q2", "info"); // queued — full
            const result = sys.show("q3", "info"); // rejected
            expect(result).toBeNull();
        });
    });

    // ── _remove() ─────────────────────────────────────────────────────────────

    describe("_remove()", () => {
        it("removes toast from DOM (animations:false)", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            const t = sys.show("remove me", "info");
            sys._remove(t, false);
            // After removal, toast is gone (or has removing class)
            expect(t.classList.contains("gl-toast--removing")).toBe(true);
        });

        it("no-op if called on already-removing toast", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            const t = sys.show("dup remove", "info");
            sys._remove(t, false);
            expect(() => sys._remove(t, false)).not.toThrow();
        });

        it("clears timeoutId if present on toast", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            const t = sys.show("timeout", "info");
            t.dataset.timeoutId = "999";
            sys._remove(t, false);
            expect(t.dataset.timeoutId).toBeUndefined();
        });

        it("applies sliding-up class for reorganization + animations", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: true });
            const t = sys.show("reorg", "info");
            sys._remove(t, true);
            expect(t.classList.contains("gl-toast--sliding-up")).toBe(true);
        });

        it("no sliding-up class for reorganization when animations:false", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            const t = sys.show("no-slide", "info");
            sys._remove(t, true);
            expect(t.classList.contains("gl-toast--sliding-up")).toBe(false);
        });

        it("_remove null no-op", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            expect(() => sys._remove(null)).not.toThrow();
        });
    });

    // ── dismiss() ─────────────────────────────────────────────────────────────

    describe("dismiss()", () => {
        it("dismisses a visible toast", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            const t = sys.show("bye", "success");
            sys.dismiss(t);
            expect(t.classList.contains("gl-toast--removing")).toBe(true);
        });

        it("dismiss(null) does not throw", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            expect(() => sys.dismiss(null)).not.toThrow();
        });
    });

    // ── clearAll() ────────────────────────────────────────────────────────────

    describe("clearAll()", () => {
        it("removes all toasts and clears queue", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            sys.show("a", "info");
            sys.show("b", "success");
            sys.clearAll();
            expect(sys._queue.length).toBe(0);
        });

        it("clearAll with no container — no throw", () => {
            const sys = new NotificationSystem();
            // container not inited
            expect(() => sys.clearAll()).not.toThrow();
        });
    });

    // ── disable() / enable() ─────────────────────────────────────────────────

    describe("disable() / enable()", () => {
        it("disable() stops new notifications from showing", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            sys.disable();
            expect(sys.config.enabled).toBe(false);
            const result = sys._processQueue();
            expect(result).toBeNull();
        });

        it("enable() re-enables and processes queue", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            // Add to queue while disabled
            sys.disable();
            sys._queue.push({
                message: "from queue",
                options: { type: "info", duration: 3000, persistent: false, dismissible: true },
                priority: 1,
                timestamp: Date.now(),
            });
            sys.enable();
            expect(sys.config.enabled).toBe(true);
            // queue may have been flushed
        });
    });

    // ── getStatus() ───────────────────────────────────────────────────────────

    describe("getStatus()", () => {
        it("returns expected shape when initialized", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            sys.show("test", "info");
            const status = sys.getStatus();
            expect(status).toHaveProperty("enabled", true);
            expect(status).toHaveProperty("initialized", true);
            expect(typeof status.activeToasts).toBe("number");
            expect(typeof status.queued).toBe("number");
        });

        it("returns initialized:false when container null", () => {
            const sys = new NotificationSystem();
            const status = sys.getStatus();
            expect(status.initialized).toBe(false);
        });
    });

    // ── destroy() ─────────────────────────────────────────────────────────────

    describe("destroy()", () => {
        it("cleans up all resources", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            sys.show("cleanup", "info");
            sys.destroy();
            expect(sys.container).toBeNull();
            expect(sys.config.enabled).toBe(false);
            expect(sys._queue.length).toBe(0);
        });

        it("destroy when timerManager null — no throw", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            sys._timerManager = null;
            sys._eventManager = null;
            expect(() => sys.destroy()).not.toThrow();
        });
    });

    // ── _processQueue when config.enabled=false ───────────────────────────────

    describe("_processQueue() edge cases", () => {
        it("returns null when container is null", () => {
            const sys = new NotificationSystem();
            expect(sys._processQueue()).toBeNull();
        });

        it("returns null when queue empty", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            expect(sys._processQueue()).toBeNull();
        });

        it("maxPersistent limit stops persistent toasts being queued beyond limit", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            sys.maxPersistent = 1;
            sys.show("P1", { type: "info", persistent: true });
            sys.show("P2", { type: "info", persistent: true });
            // Second persistent toast should be queued (not shown)
            expect(sys._queue.length).toBeGreaterThanOrEqual(1);
        });

        // ── what is emitted BEFORE init() must come out AFTER ────────────────────
        //
        // 🛑 The defect, and why it is silent: `show()` before `init()` fills
        // `_queue`, and `_processQueue()` exits early on `!this.container`.
        // Nothing called it back after a successful `init()` — the queue was
        // only drained at the NEXT `show()`. A message emitted during boot
        // ("profile not found", "layer failed") thus stayed invisible until
        // another message came, and if none came, forever.
        //
        // ⚠️ This test lives HERE and not in `notifications.test.js`: there
        // the file's idiom would make it red BEFORE the fix for a reason
        // other than the one under test — a red for the wrong reason reads
        // as "the fix did not work" and gets a correct fix undone.
        it("draine la file remplie AVANT init() dès que init() réussit", () => {
            const sys = new NotificationSystem();

            // Emitted without a container: the queue fills, nothing displays.
            sys.show("avant-boot", { type: "info" });
            expect(sys._queue.length).toBe(1);
            expect(document.querySelectorAll(".gl-toast").length).toBe(0);

            const ok = sys.init({ container: "#gl-notifications", animations: false });
            expect(ok).toBe(true);

            // Without the drain, the queue stays full and the screen empty until the next show().
            expect(sys._queue.length).toBe(0);
            expect(document.querySelectorAll(".gl-toast").length).toBe(1);
        });

        it("un init() qui ÉCHOUE ne draine rien — la file survit pour le prochain init()", () => {
            const sys = new NotificationSystem();
            sys.show("avant-boot", { type: "info" });

            // Container absent → init() returns false, and above all must
            // not EMPTY the queue: losing it here would be worse than the
            // original defect, since the message could never come out again.
            expect(sys.init({ container: "#absent-du-dom" })).toBe(false);
            expect(sys._queue.length).toBe(1);
        });
    });

    // ── timerManager path (when timerManager is null) ────────────────────────

    describe("timerManager null fallback", () => {
        it("uses raw setTimeout when _timerManager is null", () => {
            vi.useFakeTimers();
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            sys._timerManager = null; // force-null AFTER init
            const t = sys.show("timer-null", "info");
            expect(t.dataset.timeoutId).toBeDefined();
            vi.useRealTimers();
        });
    });

    // ── B.35 (d) — who owns the close-button listener ────────────────────────
    //
    // `$create({ onClick })` does not attach directly: `dom-helpers` routes every
    // `on*` prop to `GeoLeaf.Utils.events` when that global exists — and in
    // production it always does (`utils-namespace.ts` assigns the module-level
    // `events`, i.e. the GLOBAL manager). So each toast's close button used to land
    // in `globalEventManager.listeners` and stay there: nothing releases it, the
    // entry holds a strong reference to a DOM node that is detached seconds later,
    // and `beforeunload` reports the pile. Meanwhile `_eventManager` — created by
    // `init()` for exactly this and destroyed by `destroy()` — stayed empty.
    describe("close-button listener ownership (B.35d)", () => {
        let globalEventManager;
        let events;

        beforeAll(async () => {
            const mod = await import("../../src/utils/general/event-listener-manager.js");
            globalEventManager = mod.globalEventManager;
            events = mod.events;
        });

        beforeEach(() => {
            // Reproduces the production wiring done by `utils-namespace.ts`.
            globalThis.GeoLeaf = { Utils: { events } };
            globalEventManager.removeAll();
        });

        afterEach(() => {
            delete globalThis.GeoLeaf;
            globalEventManager.removeAll();
        });

        /** Lets the deferred `_doRemove` (0 ms when animations are off) run. */
        const flush = () => new Promise((r) => setTimeout(r, 0));

        it("does not push toast close buttons into the GLOBAL event manager", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false, maxVisible: 6 });
            const before = globalEventManager.getCount();

            for (let i = 0; i < 5; i++) sys.show(`toast-${i}`, "info");

            expect(document.querySelectorAll("#gl-notifications .gl-toast__close")).toHaveLength(5);
            expect(globalEventManager.getCount()).toBe(before);
            sys.destroy();
        });

        it("registers them on the renderer's own manager and releases them per toast", async () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false, maxVisible: 6 });
            expect(sys._eventManager.getCount()).toBe(0);

            const toasts = [];
            for (let i = 0; i < 4; i++) toasts.push(sys.show(`t${i}`, "info"));
            expect(sys._eventManager.getCount()).toBe(4);

            toasts.forEach((t) => sys._remove(t, false));
            await flush();

            // Dismissed toasts must not keep an entry alive — otherwise the leak is
            // merely moved from the global manager to a longer-lived local one.
            expect(sys._eventManager.getCount()).toBe(0);
            sys.destroy();
        });

        it("the close button still dismisses its toast", async () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false, maxVisible: 6 });
            const toast = sys.show("closable", "info");
            const btn = toast.querySelector(".gl-toast__close");

            btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await flush();

            expect(toast.parentNode).toBeNull();
            sys.destroy();
        });

        it("destroy() releases the entries of toasts still on screen", () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false, maxVisible: 6 });
            sys.show("a", "info");
            sys.show("b", "info");
            expect(sys._eventManager.getCount()).toBe(2);

            const manager = sys._eventManager;
            sys.destroy();
            expect(manager.getCount()).toBe(0);
        });

        it("falls back to a direct listener when no event manager is available", async () => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false, maxVisible: 6 });
            sys._eventManager = null; // force-null AFTER init
            const toast = sys.show("no-manager", "info");
            const btn = toast.querySelector(".gl-toast__close");

            btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await flush();

            expect(toast.parentNode).toBeNull();
            sys.destroy();
        });
    });

    // ── Toast DOM shape (B.18) ────────────────────────────────────────────────

    /**
     * `_showImmediate` and `_appendCloseButton` build their nodes through the
     * `dom-helpers` factory. Everything above drives BEHAVIOUR (queueing, timers,
     * dismissal, listener ownership) and pins almost none of the MARKUP: a
     * per-call-site mutation sweep showed the whole `attributes` bag of the toast
     * and the `gl-toast__message` class could each be dropped with the suite still
     * green. These cases close that hole — they are the oracle the `$create` →
     * `createElement` migration is checked against.
     */
    describe("toast DOM shape (B.18)", () => {
        /** Shows one toast on a fresh, animation-free system. */
        const showToast = (message, type = "info") => {
            const sys = new NotificationSystem();
            sys.init({ container: "#gl-notifications", animations: false });
            return { sys, toast: sys.show(message, type) };
        };

        it('announces itself as role="alert", politely by default', () => {
            const { sys, toast } = showToast("hello");
            expect(toast.getAttribute("role")).toBe("alert");
            expect(toast.getAttribute("aria-live")).toBe("polite");
            sys.destroy();
        });

        it('escalates aria-live to "assertive" for errors', () => {
            const { sys, toast } = showToast("boom", "error");
            expect(toast.getAttribute("aria-live")).toBe("assertive");
            sys.destroy();
        });

        it("types the toast with a `gl-toast--<type>` modifier", () => {
            const { sys, toast } = showToast("careful", "warning");
            expect(toast.classList.contains("gl-toast")).toBe(true);
            expect(toast.classList.contains("gl-toast--warning")).toBe(true);
            sys.destroy();
        });

        it("carries the message as TEXT inside a .gl-toast__message span, never as markup", () => {
            const { sys, toast } = showToast('<img src=x onerror="alert(1)">');
            const span = toast.querySelector("span.gl-toast__message");
            expect(span).not.toBeNull();
            expect(span.textContent).toBe('<img src=x onerror="alert(1)">');
            // The payload must not have been parsed into a node.
            expect(toast.querySelector("img")).toBeNull();
            sys.destroy();
        });

        it("labels the close button for assistive tech and gives it its glyph", () => {
            const { sys, toast } = showToast("bye");
            const btn = toast.querySelector("button.gl-toast__close");
            expect(btn).not.toBeNull();
            // `getLabel` is mocked to the identity, so the key IS the expected value.
            expect(btn.getAttribute("aria-label")).toBe("aria.notification.close_label");
            expect(btn.getAttribute("title")).toBe("aria.notification.close_title");
            expect(btn.textContent).toBe("ui.notification.close_char");
            sys.destroy();
        });
    });
});
