/**
 * Unit tests — what a SESSION wires, seen from the DOM.
 *
 * 🛑 This file exists because it did not exist. `session.ts` decides what a
 * session owns, and nothing tested it: exactly why the banner and the camera
 * could be written, tested, typed and published without anyone plugging them
 * in. The `ui/` tests proved the banner fills up; none proved a session sets one.
 *
 * The lesson is scope, not oversight: a unit-tested module can be entirely
 * correct and entirely unreachable. Only a test starting from the PUBLIC
 * ENTRY sees it.
 *
 * The runtime is doubled — what is exercised here is the wiring, not the
 * engine, which has its own suites. No WebGL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RouteResult, RouteStep } from "@geoleaf-plugins/routing";
import type { GuidanceViewListener } from "../guidance-contract.js";

const {
    tLabelMock,
    getNativeMapMock,
    createRuntimeMock,
    getGeoLeafMock,
    lockMock,
    createLockMock,
} = vi.hoisted(() => ({
    tLabelMock: vi.fn(),
    getNativeMapMock: vi.fn(),
    createRuntimeMock: vi.fn(),
    // ⚠️ No implementation: `vi.fn(() => undefined)` would PIN the return type to
    // `undefined`, and every `mockReturnValue({ UI, Core })` below would then be a type
    // error — a doubled host is the whole point of this mock.
    getGeoLeafMock: vi.fn(),
    lockMock: {
        held: false,
        acquire: vi.fn(() => Promise.resolve()),
        release: vi.fn(() => Promise.resolve()),
    },
    createLockMock: vi.fn(),
}));
vi.mock("@geoleaf/host-runtime", () => ({
    tLabel: (...a: unknown[]) => tLabelMock(...a),
    getNativeMap: () => getNativeMapMock(),
    // `session.ts` reads the configuration at start; the profile default
    // suffices here, what is exercised is the wiring and not the thresholds,
    // which have their own suite.
    coreConfigGet: () => ({}),
    // ⚠️ Reached by `ui/immersive.ts` and `ui/position-arrow.ts`, both pulled in by
    // `session-view.ts`. A factory missing a symbol the graph imports fails at RESOLUTION —
    // the file goes red about the mock, never about the behaviour under test.
    getGeoLeaf: () => getGeoLeafMock(),
    Log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    // Reached by `ui/announcer.ts`, pulled in by `session-view.ts`. Same lesson as the two above:
    // a factory missing a symbol the graph imports fails at RESOLUTION, so the file goes red
    // about the mock and never about the behaviour.
    getActiveLang: () => "fr",
}));
vi.mock("../engine/runtime.js", () => ({
    createGuidanceRuntime: (...a: unknown[]) => createRuntimeMock(...a),
}));
// The lock's own behaviour — the unconditional re-acquisition on `visibilitychange` — has its
// own suite. What is under test HERE is that a session takes one at all, and lets it go.
vi.mock("../platform/wake-lock.js", () => ({
    createScreenWakeLock: (...a: unknown[]) => {
        createLockMock(...a);
        return lockMock;
    },
}));

const { startSession, stopSession, isGuiding } = await import("../session.js");

/** What the doubled runtime received and recorded. */
interface FakeRuntime {
    viewListener: GuidanceViewListener | null;
    started: number;
    stopped: number;
    unsubscribed: number;
}

/** The minimal route `startSession` forwards without reading it. */
const ROUTE = { legs: [], distance: 0, duration: 0 } as unknown as RouteResult;

/** A step to announce. */
const STEP = {
    distance: 400,
    duration: 40,
    name: "Boulevard Vauban",
    maneuver: "turn",
    modifier: "left",
    location: [55, -21],
} as unknown as RouteStep;

/** The two functions the caller provides as closures. */
const DEPS = {
    recompute: async () => ({ ok: false, reason: "refused" }) as never,
    decodeGeometry: () => [],
};

describe("le verrou d'écran — pris avec la session, rendu avec elle", () => {
    beforeEach(() => {
        createLockMock.mockReset();
        lockMock.acquire.mockClear();
        lockMock.release.mockClear();
        getNativeMapMock.mockReturnValue(null);
        getGeoLeafMock.mockReturnValue(undefined);
        tLabelMock.mockImplementation(() => "");
        createRuntimeMock.mockImplementation(() => ({
            state: "navigating",
            start: vi.fn(),
            stop: vi.fn(),
            onProgress: vi.fn(() => vi.fn()),
            onView: vi.fn(() => vi.fn()),
        }));
    });

    it("prend un verrou au démarrage, et le rend à l'arrêt", () => {
        startSession(ROUTE, [], DEPS);
        expect(createLockMock).toHaveBeenCalledTimes(1);
        expect(lockMock.acquire).toHaveBeenCalledTimes(1);
        stopSession();
        expect(lockMock.release).toHaveBeenCalled();
    });

    it("🛑 RELÂCHE l'ancien verrou avant d'en prendre un neuf", () => {
        // The lock installs a `visibilitychange` listener. A restart that skipped the release
        // would leave one live listener per session for the life of the page, each re-requesting
        // a lock for a journey that ended — and none of them reachable to stop.
        startSession(ROUTE, [], DEPS);
        startSession(ROUTE, [], DEPS);
        expect(lockMock.release).toHaveBeenCalled();
        expect(createLockMock).toHaveBeenCalledTimes(2);
    });

    it("un arrêt sans démarrage ne jette pas", () => {
        expect(() => stopSession()).not.toThrow();
    });

    it("le guidage ne dépend PAS du verrou — un refus est avalé", () => {
        // Refused on an insecure origin, on a low battery, under a policy: all ordinary. A
        // session that waited on it, or warned, would be worse than a screen that dims.
        lockMock.acquire.mockImplementationOnce(() => Promise.reject(new Error("refusé")));
        expect(() => startSession(ROUTE, [], DEPS)).not.toThrow();
        stopSession();
    });
});

describe("startSession — l'interface est posée, et c'est vérifiable dans le DOM", () => {
    let container: HTMLElement;
    let fake: FakeRuntime;
    let moves: Record<string, unknown>[];

    beforeEach(() => {
        // ⚠️ `session.ts` holds ONE session for the page — its property, not a
        // defect: two runtimes would hold two position watches. It thus
        // survives from one test to the next, and without this reset a test's
        // unsubscribe counter also counts the session the previous one left
        // open. Seen: "expected 1, received 2".
        stopSession();
        document.body.replaceChildren();
        container = document.createElement("div");
        document.body.append(container);
        moves = [];

        tLabelMock.mockImplementation((key: string) =>
            key === "navigation.unit.metres"
                ? "m"
                : key === "navigation.unit.kilometres"
                  ? "km"
                  : ""
        );
        getNativeMapMock.mockReturnValue({
            getContainer: () => container,
            easeTo: (o: Record<string, unknown>) => moves.push(o),
        });

        fake = { viewListener: null, started: 0, stopped: 0, unsubscribed: 0 };
        createRuntimeMock.mockImplementation(() => ({
            state: "idle",
            start: () => {
                fake.started += 1;
            },
            stop: () => {
                fake.stopped += 1;
            },
            onProgress: () => () => {},
            onView: (l: GuidanceViewListener) => {
                fake.viewListener = l;
                return () => {
                    fake.unsubscribed += 1;
                    fake.viewListener = null;
                };
            },
        }));
    });

    it("🛑 démarrer une session POSE le bandeau dans le conteneur de la carte", () => {
        // The missing assertion. Without it, a guidance drawing nothing is
        // indistinguishable from one that draws — and that is the state this plugin lived in.
        expect(container.querySelector(".gl-nav-banner")).toBeNull();
        startSession(ROUTE, [], DEPS);
        expect(container.querySelector(".gl-nav-banner")).not.toBeNull();
    });

    it("🛑 l'interface est attachée AVANT que la veille ne démarre", () => {
        // `start()` opens the position watch. A fix arriving before the banner
        // exists would be the one sample nobody sees — and the defect would
        // only show at the first fix, hence never in tests unless the order is watched.
        let bannerAtStart: Element | null = null;
        createRuntimeMock.mockImplementation(() => ({
            state: "idle",
            start: () => {
                bannerAtStart = container.querySelector(".gl-nav-banner");
            },
            stop: () => {},
            onProgress: () => () => {},
            onView: () => () => {},
        }));
        startSession(ROUTE, [], DEPS);
        expect(bannerAtStart).not.toBeNull();
    });

    it("un échantillon de vue traverse jusqu'au bandeau", () => {
        startSession(ROUTE, [], DEPS);
        fake.viewListener?.({
            step: STEP,
            distanceToManeuver: 300,
            position: [55, -21],
            heading: 45,
            elapsedSeconds: 1,
        });
        const el = container.querySelector<HTMLElement>(".gl-nav-banner");
        expect(el?.hidden).toBe(false);
        expect(el?.querySelector(".gl-nav-banner__road")?.textContent).toBe("Boulevard Vauban");
        expect(moves.at(-1)).toMatchObject({ bearing: 45 });
    });

    it("arrêter retire le bandeau et rend la carte", () => {
        startSession(ROUTE, [], DEPS);
        stopSession();
        expect(container.querySelector(".gl-nav-banner")).toBeNull();
        expect(fake.unsubscribed).toBe(1);
        expect(moves.at(-1)).toMatchObject({ pitch: 0, bearing: 0 });
    });

    it("🛑 redémarrer ne laisse PAS deux bandeaux sur la carte", () => {
        // Two successive sessions with no explicit stop: the first view must
        // go. Otherwise the old one stays, frozen on its last maneuver, and reads as current.
        startSession(ROUTE, [], DEPS);
        startSession(ROUTE, [], DEPS);
        expect(container.querySelectorAll(".gl-nav-banner")).toHaveLength(1);
    });

    it("arrêter deux fois ne jette pas", () => {
        startSession(ROUTE, [], DEPS);
        stopSession();
        expect(() => stopSession()).not.toThrow();
    });

    it("🛑 arrêter SANS avoir démarré ne jette pas non plus", () => {
        // `runtime` and `view` are set on different paths. A `stopSession()`
        // called by an interface tearing down before any guidance must pass.
        expect(() => stopSession()).not.toThrow();
        expect(isGuiding()).toBe(false);
    });
});
