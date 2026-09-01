/**
 * Unit tests — THE QUOTA: how many requests a scenario really emits.
 *
 * 🛑 **This suite is worth more than the two fixes it guards.** "The cache
 * works" and "the debounce works" are unverifiable sentences as long as
 * nothing COUNTS the requests — hence unfalsifiable, hence fossilisable. The
 * preflight's failure mode no. 5 in full.
 *
 * ⚠️ And the counter first served to disprove the claim that motivated the
 * work. The backlog line said "a composition modified three times emits three
 * computations". Measured: it emits **zero** — `compute()` is only reached by
 * the button. What emits three is three presses, and nothing prevented that.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PanelHandlers, PanelLabels } from "../ui/itinerary-panel.js";
import type { Waypoint } from "../model.js";

/** The requests the doubled provider received. */
const _requests: unknown[] = [];
/** What the doubled panel captured. */
let captured: { handlers: PanelHandlers; labels: PanelLabels } | null = null;
/** How many times the button was disarmed then rearmed. */
const _computingStates: boolean[] = [];

vi.mock("@geoleaf/host-runtime", () => ({
    // ⚠️ Required: `compute()` reaches `travelProfile()` before any request,
    // and without this seam the configuration throws — hence ZERO requests,
    // and seven tests failing without saying why. An incomplete mock reads as
    // a defect of the code it doubles.
    coreConfigGet: () => ({}),
    tLabel: (k: string) => k,
    getActiveLang: () => _lang,
    getGeoLeaf: () => undefined,
    getNativeMap: () => undefined,
    Log: { warn: () => {}, error: () => {}, info: () => {} },
}));

let _lang = "fr";
let _answer: unknown = null;

vi.mock("../provider.js", () => ({
    createProvider: () => ({
        id: "x",
        attribution: "© Test",
        route: async (req: unknown) => {
            _requests.push(req);
            return _answer;
        },
    }),
}));

vi.mock("../publish.js", () => ({
    publishRoute: () => ({ ok: true, layerId: "x", features: 1 }),
    clearRoute: () => ({ ok: true, layerId: "x", features: 0 }),
}));

vi.mock("../ui/itinerary-panel.js", () => ({
    openItineraryPanel: (labels: PanelLabels, handlers: PanelHandlers) => {
        captured = { labels, handlers };
        return {
            setWaypoints: () => {},
            addWaypoint: () => {},
            setRoute: () => {},
            showFailure: () => {},
            setPicking: () => {},
            destroy: () => {},
            setComputing: (b: boolean) => _computingStates.push(b),
            // ⚠️ Calls `onClose` back, like the real panel: IT is what resets
            // the controller's module reference to `null`. A double omitting it
            // lets `openPanel()` exit through its "already open" branch at the
            // next test, and seven tests return zero requests with none saying why.
            close: () => handlers.onClose?.(),
        };
    },
}));

const { openPanel, destroyPanel } = await import("../itinerary.js");
const { clearRouteCache, routeCacheSize, routeKey } = await import("../route-cache.js");

/** A two-point trip. */
const TRIP: Waypoint[] = [{ coordinates: [55.4, -21.1] }, { coordinates: [55.5, -21.2] }];

/** A successful answer. */
const OK = {
    ok: true,
    route: {
        distance: 1,
        duration: 1,
        geometry: "",
        provider: "x",
        attribution: "© Test",
        legs: [],
        waypoints: TRIP,
    },
};

/** Lets the promises settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("🛑 Le compteur de requêtes — sans lui, « le cache marche » est infalsifiable", () => {
    beforeEach(() => {
        _requests.length = 0;
        _computingStates.length = 0;
        clearRouteCache();
        _answer = OK;
        _lang = "fr";
        // The controller holds ONE panel for the page — its property, not a
        // defect. So the previous test's must be closed before opening a new one.
        destroyPanel();
        captured = null;
        openPanel();
    });

    it("un calcul émet UNE requête", async () => {
        captured?.handlers.onCompute(TRIP);
        await settle();
        expect(_requests).toHaveLength(1);
    });

    it("🛑 le MÊME itinéraire recalculé n'en émet pas une seconde", async () => {
        captured?.handlers.onCompute(TRIP);
        await settle();
        captured?.handlers.onCompute(TRIP);
        await settle();
        expect(_requests).toHaveLength(1);
        expect(routeCacheSize()).toBe(1);
    });

    it("🛑 TROIS appuis rapides n'émettent qu'UNE requête", async () => {
        // The real defect, the one measurement found: the button was only
        // disarmed on routability. Three presses while an answer keeps you
        // waiting all three went out — and the provider's public instance caps
        // at one request per second.
        captured?.handlers.onCompute(TRIP);
        captured?.handlers.onCompute(TRIP);
        captured?.handlers.onCompute(TRIP);
        await settle();
        expect(_requests).toHaveLength(1);
    });

    it("le bouton est désarmé PENDANT le calcul, puis réarmé", async () => {
        captured?.handlers.onCompute(TRIP);
        await settle();
        expect(_computingStates).toEqual([true, false]);
    });

    it("🛑 un échec RÉARME le bouton — une garde coincée est pire qu'aucune", async () => {
        // A flag left raised turns a passing outage into a permanently
        // unusable panel. Hence the `finally`.
        _answer = { ok: false, reason: "network" };
        captured?.handlers.onCompute(TRIP);
        await settle();
        expect(_computingStates).toEqual([true, false]);
        _answer = OK;
        captured?.handlers.onCompute(TRIP);
        await settle();
        expect(_requests).toHaveLength(2);
    });

    it("🛑 un échec n'est PAS mis en cache", async () => {
        // Caching it would make a network outage permanent for the rest of
        // the session, with a "retry" that never leaves the page.
        _answer = { ok: false, reason: "network" };
        captured?.handlers.onCompute(TRIP);
        await settle();
        expect(routeCacheSize()).toBe(0);
    });

    it("un itinéraire DIFFÉRENT émet bien une requête", async () => {
        captured?.handlers.onCompute(TRIP);
        await settle();
        captured?.handlers.onCompute([...TRIP, { coordinates: [55.6, -21.3] }]);
        await settle();
        expect(_requests).toHaveLength(2);
    });

    it("🛑 changer de LANGUE émet une requête — le narratif vient du moteur", async () => {
        // A key without the language would serve a French driver the English
        // instructions computed a minute earlier: the same line, the wrong
        // voice, and nothing on screen to explain it.
        captured?.handlers.onCompute(TRIP);
        await settle();
        _lang = "en";
        captured?.handlers.onCompute(TRIP);
        await settle();
        expect(_requests).toHaveLength(2);
    });
});

describe("routeKey — ce qui distingue deux demandes", () => {
    it("l'ORDRE des étapes compte", () => {
        const a = routeKey({ waypoints: TRIP, profile: "car" } as never);
        const b = routeKey({ waypoints: [...TRIP].reverse(), profile: "car" } as never);
        expect(a).not.toBe(b);
    });

    it("le MODE compte", () => {
        expect(routeKey({ waypoints: TRIP, profile: "car" } as never)).not.toBe(
            routeKey({ waypoints: TRIP, profile: "foot" } as never)
        );
    });

    it("🛑 le bruit de flottant NE compte PAS — sinon le cache ne touche jamais", () => {
        // A stop picked on the map carries a float's full precision:
        // re-picking the "same" place would give a different key, and the
        // cache would be decorative.
        const a = routeKey({
            waypoints: [{ coordinates: [55.4000001, -21.1] }],
            profile: "car",
        } as never);
        const b = routeKey({
            waypoints: [{ coordinates: [55.4000002, -21.1] }],
            profile: "car",
        } as never);
        expect(a).toBe(b);
    });

    it("un mètre de différence compte encore", () => {
        // ⚠️ This test exercised `0.0001`, i.e. ELEVEN metres, under a name
        // announcing one. It passed, and it would not have turned red had the
        // rounding been set to four decimals instead of five — that is, on
        // exactly the error it claims to guard. Fixed at `0.00001` (≈ 1.11 m),
        // the precision the constant announces.
        const a = routeKey({
            waypoints: [{ coordinates: [55.4, -21.1] }],
            profile: "car",
        } as never);
        const b = routeKey({
            waypoints: [{ coordinates: [55.40001, -21.1] }],
            profile: "car",
        } as never);
        expect(a).not.toBe(b);
    });
});
