/**
 * A new service worker WAITS, and the page is told — the page half of the consent.
 *
 * `sw-core.js` no longer takes the page at an update (`sw-core.test.js`, block `install`).
 * A worker that waits and says nothing waits for every tab to be closed: this module is what
 * says it — `geoleaf:sw:update-waiting`, `isUpdateWaiting()` — and what carries the gesture
 * back, `applyUpdate()`.
 *
 * Cases marked 🛑 are TARGETS, seen red before the code; plain titles are guards against
 * over-reach — a first install is not an update, and no page reloads unasked.
 *
 * ⚠️ The module keeps its state at MODULE level (what was announced, what is followed): every
 * case loads a fresh copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** A worker, as far as a page sees one: a state, its changes, a mailbox. */
class FakeWorker extends EventTarget {
    postMessage = vi.fn();
    constructor(public state: string) {
        super();
    }
    become(state: string): void {
        this.state = state;
        this.dispatchEvent(new Event("statechange"));
    }
}

class FakeRegistration extends EventTarget {
    scope = "/";
    installing: FakeWorker | null = null;
    waiting: FakeWorker | null = null;
    active: FakeWorker | null = null;
}

class FakeContainer extends EventTarget {
    controller: FakeWorker | null = null;
    register = vi.fn();
}

type Register = typeof import("../../src/kernel/storage/sw-register.js").SWRegister;

let container: FakeContainer;
let registration: FakeRegistration;
let SWRegister: Register;
let reload: ReturnType<typeof vi.fn>;
let heard: { waiting: number; updated: number };
let detach: () => void;

/** The worker that holds the page before anything happens. */
function heldBy(): FakeWorker {
    const old = new FakeWorker("activated");
    registration.active = old;
    container.controller = old;
    return old;
}

/** The browser finds a new version: `updatefound`, then the install completes. */
function installUpdate(): FakeWorker {
    const next = new FakeWorker("installing");
    registration.installing = next;
    registration.dispatchEvent(new Event("updatefound"));
    registration.installing = null;
    registration.waiting = next;
    next.become("installed");
    return next;
}

/** The waiting worker activates and takes the page — what `SKIP_WAITING` leads to. */
function takeOver(next: FakeWorker): void {
    registration.waiting = null;
    registration.active = next;
    next.become("activating");
    container.controller = next;
    container.dispatchEvent(new Event("controllerchange"));
    next.become("activated");
}

beforeEach(async () => {
    vi.resetModules();
    container = new FakeContainer();
    registration = new FakeRegistration();
    container.register.mockResolvedValue(registration);
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });

    reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });

    heard = { waiting: 0, updated: 0 };
    const onWaiting = () => (heard.waiting += 1);
    const onUpdated = () => (heard.updated += 1);
    document.addEventListener("geoleaf:sw:update-waiting", onWaiting);
    document.addEventListener("geoleaf:sw:updated", onUpdated);
    detach = () => {
        document.removeEventListener("geoleaf:sw:update-waiting", onWaiting);
        document.removeEventListener("geoleaf:sw:updated", onUpdated);
    };

    ({ SWRegister } = await import("../../src/kernel/storage/sw-register.js"));
});

afterEach(() => {
    detach();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("an update installed behind the worker that holds the page", () => {
    it("🛑 is announced — once", async () => {
        heldBy();
        await SWRegister.register();
        expect(SWRegister.isUpdateWaiting()).toBe(false);

        const next = installUpdate();

        expect(heard.waiting).toBe(1);
        expect(SWRegister.isUpdateWaiting()).toBe(true);
        // A worker changes state more than once; the announcement is not a state echo.
        next.dispatchEvent(new Event("statechange"));
        expect(heard.waiting).toBe(1);
        // And nothing took the page: no activation, no reload.
        expect(heard.updated).toBe(0);
        expect(reload).not.toHaveBeenCalled();
    });

    it("🛑 is said again by a page that boots onto it — the previous page's event is gone", async () => {
        heldBy();
        registration.waiting = new FakeWorker("installed");

        await SWRegister.register();

        expect(heard.waiting).toBe(1);
        expect(SWRegister.isUpdateWaiting()).toBe(true);
    });

    it("🛑 is followed when its install was already under way at registration", async () => {
        // The browser checks for an update at navigation; `register()` is called at idle.
        // `updatefound` may be long gone.
        heldBy();
        const next = new FakeWorker("installing");
        registration.installing = next;
        await SWRegister.register();
        expect(heard.waiting).toBe(0);

        registration.installing = null;
        registration.waiting = next;
        next.become("installed");

        expect(heard.waiting).toBe(1);
    });

    it("is not announced again by a second registration — an application mounted again", async () => {
        heldBy();
        await SWRegister.register();
        installUpdate();
        await SWRegister.register();
        await SWRegister.register();
        expect(heard.waiting).toBe(1);
        // The state, on the other hand, is still there to be read.
        expect(SWRegister.isUpdateWaiting()).toBe(true);
    });
});

describe("a first install is not an update", () => {
    it("announces nothing: no worker held the page", async () => {
        await SWRegister.register();
        const first = new FakeWorker("installing");
        registration.installing = first;
        registration.dispatchEvent(new Event("updatefound"));
        registration.installing = null;
        registration.waiting = first;
        first.become("installed");

        expect(heard.waiting).toBe(0);
        expect(SWRegister.isUpdateWaiting()).toBe(false);
    });

    it("its taking the page neither reloads it nor marks it outdated", async () => {
        await SWRegister.register();
        const first = new FakeWorker("installing");
        registration.installing = first;
        registration.dispatchEvent(new Event("updatefound"));
        registration.installing = null;
        takeOver(first);

        expect(reload).not.toHaveBeenCalled();
        expect(SWRegister.isUpdateWaiting()).toBe(false);
        expect(SWRegister.applyUpdate()).toBe(false);
        // The activation is still announced, as it always was.
        expect(heard.updated).toBe(1);
    });
});

describe("the gesture", () => {
    it("🛑 tells the waiting worker to take over, and reloads once it holds the page", async () => {
        heldBy();
        await SWRegister.register();
        const next = installUpdate();

        expect(SWRegister.applyUpdate()).toBe(true);

        expect(next.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
        // Not before the new worker holds the page: reloading now would boot the old one again.
        expect(reload).not.toHaveBeenCalled();

        takeOver(next);

        expect(reload).toHaveBeenCalledTimes(1);
        expect(heard.updated).toBe(1);
    });

    it("🛑 reloads ONCE — a second change of controller does not ask again", async () => {
        // Measured in a browser that installs a worker at every navigation (DevTools'
        // « Update on reload »): the reload's own navigation brought a new controller, the
        // listener called `reload()` again, and a second `reload()` ABORTS the navigation
        // under way. The page never reloaded — a loop of aborted navigations, each one
        // installing a worker.
        heldBy();
        await SWRegister.register();
        const next = installUpdate();
        SWRegister.applyUpdate();
        takeOver(next);
        expect(reload).toHaveBeenCalledTimes(1);

        const again = new FakeWorker("activating");
        container.controller = again;
        container.dispatchEvent(new Event("controllerchange"));
        // And a gesture repeated while the page is leaving asks for nothing more either.
        SWRegister.applyUpdate();

        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("applies nothing when nothing waits", async () => {
        heldBy();
        await SWRegister.register();
        expect(SWRegister.applyUpdate()).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });

    it("is false before any registration, and without service workers at all", async () => {
        expect(SWRegister.isUpdateWaiting()).toBe(false);
        expect(SWRegister.applyUpdate()).toBe(false);
        Reflect.deleteProperty(navigator, "serviceWorker");
        expect(SWRegister.isUpdateWaiting()).toBe(false);
        expect(SWRegister.applyUpdate()).toBe(false);
    });

    it("🛑 made in ANOTHER tab, it leaves this page outdated — not reloaded, and still offered", async () => {
        // One worker serves every tab: the gesture made in one activates it for all. This
        // page did not ask; it must not reload under its user — and its own gesture, which
        // has no waiting worker left to tell, must still lead somewhere.
        heldBy();
        await SWRegister.register();
        const next = installUpdate();

        takeOver(next);

        expect(reload).not.toHaveBeenCalled();
        expect(SWRegister.isUpdateWaiting()).toBe(true);

        expect(SWRegister.applyUpdate()).toBe(true);
        expect(next.postMessage).not.toHaveBeenCalled();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("🛑 the activation of a worker found waiting at boot is announced too", async () => {
        heldBy();
        const next = new FakeWorker("installed");
        registration.waiting = next;
        await SWRegister.register();

        SWRegister.applyUpdate();
        takeOver(next);

        expect(heard.updated).toBe(1);
        expect(reload).toHaveBeenCalledTimes(1);
    });
});

// An update whose pre-cache failed rejects its install (`sw-core.test.js`): the browser discards
// it. Nothing is offered — and the page says so in its log, since nothing else will: a file
// missing for good from the pre-cache list would otherwise hold every update back in silence.
describe("an update that fails to install", () => {
    it("🛑 is logged, and neither announced nor counted as waiting", async () => {
        const { Log } = await import("../../src/utils/log/index.js");
        heldBy();
        await SWRegister.register();
        const next = new FakeWorker("installing");
        registration.installing = next;
        registration.dispatchEvent(new Event("updatefound"));
        vi.mocked(Log.warn).mockClear();

        registration.installing = null;
        next.become("redundant");

        expect(Log.warn).toHaveBeenCalledTimes(1);
        expect(heard.waiting).toBe(0);
        expect(SWRegister.isUpdateWaiting()).toBe(false);
    });

    it("a worker REPLACED after it installed is not a failed install", async () => {
        const { Log } = await import("../../src/utils/log/index.js");
        heldBy();
        await SWRegister.register();
        const next = installUpdate();
        vi.mocked(Log.warn).mockClear();

        next.become("redundant");

        expect(Log.warn).not.toHaveBeenCalled();
    });
});
