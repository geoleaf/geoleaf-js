/**
 * @geoleaf-plugins/routing — the controller
 *
 * The one place the parts meet. What is pinned is the mapping every refusal takes on its way to
 * a sentence, and the two formatters — a distance and a duration are the only figures a user
 * reads, and both have one right shape at each magnitude.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PanelLabels, PanelHandlers, ItineraryPanel } from "../ui/itinerary-panel.js";
import type { Waypoint } from "../model.js";

let captured: {
    labels: PanelLabels;
    handlers: PanelHandlers;
    initial: readonly Waypoint[];
} | null = null;
let shown: string[] = [];
let setTo: readonly Waypoint[] | null = null;

vi.mock("../ui/itinerary-panel.js", () => ({
    openItineraryPanel: (labels: PanelLabels, handlers: PanelHandlers, initial: Waypoint[]) => {
        captured = { labels, handlers, initial };
        // The list this double holds, so `addWaypoint` can report a REAL one back.
        let list: readonly Waypoint[] = [...(initial ?? [])];
        const p: ItineraryPanel = {
            setWaypoints: (w) => {
                list = w;
                setTo = w;
            },
            // 🛑 It calls `onChange`, and that is not decoration. The controller keeps its own
            // copy of the itinerary and learns of every edit through this callback — the real
            // panel does exactly this. A no-op double left the controller believing the list
            // was empty, and the first test to depend on a stop added through `openPanel`
            // failed accusing the controller of dropping it.
            addWaypoint: (wp) => {
                list = [...list, wp];
                handlers.onChange(list);
            },
            setRoute: () => {},
            showFailure: (r) => shown.push(String(r)),
            // Required. ⚠️ The controller also calls it from `onClose`, so a
            // double omitting it throws during teardown — not during use.
            setPicking: () => {},
            destroy: () => {},
            // Required. ⚠️ Third member this double has had to track as the
            // panel widens — and each omission reads as a controller defect
            // rather than a double lagging behind.
            setComputing: () => {},
            close: () => {},
        };
        return p;
    },
}));

let _provider: unknown = null;
vi.mock("../provider.js", () => ({ createProvider: () => _provider }));
/** What the doubled publication answers — toggled to exercise both paths of `show()`. */
let _published: unknown = { ok: false, reason: "no-such-layer", layerId: "x" };
vi.mock("../publish.js", () => ({
    publishRoute: () => _published,
    clearRoute: () => ({ ok: true, layerId: "x", features: 0 }),
}));

/** The fit requests the doubled map received. */
const _fits: unknown[][] = [];

let _origin: unknown = { ok: false, reason: "unavailable" };
vi.mock("../origin.js", () => ({ originFromUserPosition: () => _origin }));
/**
 * The plugin registry the double returns.
 *
 * ⚠️ `undefined` by default: with no reachable registry, `guidanceHandler()`
 * provides NO handler and the panel creates no guidance button. It is the
 * state of an integrator who has not installed `navigation`, and the one the
 * existing tests must see — otherwise they would measure a panel different
 * from theirs.
 */
let _plugins: Record<string, unknown> | undefined;

vi.mock("@geoleaf/host-runtime", () => ({
    // ⚠️ Required: `compute()` reaches `travelProfile()`, which reads the
    // configuration. Without this seam it throws BEFORE any decision, and four
    // tests fail accusing the controller of having stopped reporting its
    // refusals. Second time this incomplete mock reads as a defect of the code it doubles.
    coreConfigGet: () => ({}),
    tLabel: (k: string) => k,
    getActiveLang: () => "fr",
    getGeoLeaf: () => (_plugins ? { plugins: _plugins } : undefined),
    // `itinerary.ts` owns the "pick on the map" mode — so it reaches
    // `pick-on-map.ts`, which reads this seam. No map here: the mode comes out
    // inert, which is exactly what this file must exercise of the rest.
    // ⚠️ A map MUTE about its bounds: `fit-route.ts` then fits, which is
    // exactly its intended behaviour on a freshly created map. That is what
    // makes the wiring observable here without reproducing view geometry.
    getNativeMap: () => ({ fitBounds: (...a: unknown[]) => _fits.push(a) }),
    Log: { warn: () => {}, error: () => {}, info: () => {} },
}));

const { clearRouteCache } = await import("../route-cache.js");
const { openPanel, destroyPanel } = await import("../itinerary.js");

beforeEach(() => {
    // ⚠️ The route cache is MODULE STATE, like the panel. Without this reset,
    // a test's second computation serves the answer the first cached — hence
    // no provider call, hence no refusal to observe, and four tests fail
    // accusing the code of having stopped reporting its errors.
    clearRouteCache();

    // ⚠️ The controller REUSES an open panel rather than stacking a second overlay — a
    // deliberate property, and one the harness has to respect: without closing the previous
    // one, `openPanel` returns it and never calls the mocked opener, so `captured` stays null.
    // The failure looks like a broken mock and is the subject under test behaving correctly.
    destroyPanel();
    captured = null;
    shown = [];
    setTo = null;
    _provider = null;
});

describe("the labels it resolves", () => {
    it("names every refusal with its OWN key — dix causes, dix phrases", () => {
        openPanel();
        const f = captured!.labels.failure;
        expect([
            f("timeout"),
            f("network"),
            f("http"),
            f("malformed"),
            f("no-route"),
            f("cap-reached"),
            f("no-layer"),
            f("origin-denied"),
            f("origin-no-fix"),
            f("origin-unavailable"),
        ]).toEqual([
            "routing.error.timeout",
            "routing.error.network",
            "routing.error.http",
            "routing.error.malformed",
            "routing.error.noRoute",
            "routing.error.capReached",
            "routing.error.noLayer",
            "routing.error.originDenied",
            "routing.error.originNoFix",
            "routing.error.originUnavailable",
        ]);
    });

    it("formats a distance in the unit a reader expects at that magnitude", () => {
        openPanel();
        const leg = captured!.labels.leg;
        expect(leg(450, 60)).toContain("450 m");
        expect(leg(1500, 60)).toContain("1.5 km");
    });

    it("formats a duration in whole minutes, then in hours", () => {
        // Whole minutes is the precision a travel estimate can honestly carry: seconds would
        // promise an accuracy no routing engine has.
        openPanel();
        const leg = captured!.labels.leg;
        expect(leg(0, 90)).toContain("2 min");
        expect(leg(0, 3900)).toContain("1 h 05");
    });
});

describe("computing", () => {
    it("says `refused` when no provider could be built", () => {
        // Covers both "no adapter for this id" and "the endpoint was not accepted" — the two the
        // factory answers null for, and both a configuration problem the user cannot fix by
        // retrying.
        openPanel();
        captured!.handlers.onCompute([]);
        expect(shown).toEqual(["refused"]);
    });

    it("passes the engine's own reason through, unchanged", async () => {
        _provider = { id: "x", route: async () => ({ ok: false, reason: "timeout" }) };
        openPanel();
        captured!.handlers.onCompute([]);
        await new Promise((r) => setTimeout(r, 0));
        expect(shown).toEqual(["timeout"]);
    });

    it("🛑 une publication RÉUSSIE fait cadrer la carte — le câblage, pas le mécanisme", async () => {
        // 🛑 This assertion was missing, and its mutation came out GREEN:
        // `fit-route.ts` was fully tested, and nothing proved `show()` calls
        // it. Third time in a row the missing guard is the WIRING's, never the mechanism's.
        _published = { ok: true, layerId: "x", features: 3 };
        _fits.length = 0;
        _provider = {
            id: "x",
            route: async () => ({
                ok: true,
                route: { distance: 1, duration: 1, legs: [], waypoints: [{ coordinates: [1, 2] }] },
            }),
        };
        openPanel();
        captured!.handlers.onCompute([]);
        await new Promise((r) => setTimeout(r, 0));
        expect(_fits).toHaveLength(1);
        _published = { ok: false, reason: "no-such-layer", layerId: "x" };
    });

    it("🛑 une publication ÉCHOUÉE ne cadre PAS", async () => {
        // Moving the map for a line that was not drawn would leave someone in
        // front of an empty frame that just moved to show them nothing.
        _fits.length = 0;
        _provider = {
            id: "x",
            route: async () => ({
                ok: true,
                route: { distance: 1, duration: 1, legs: [], waypoints: [{ coordinates: [1, 2] }] },
            }),
        };
        openPanel();
        captured!.handlers.onCompute([]);
        await new Promise((r) => setTimeout(r, 0));
        expect(_fits).toHaveLength(0);
    });

    it("says `no-layer` when a route computed but could NOT be drawn", async () => {
        // 🛑 Not a success to stay silent about: the user asked for a line on a map and there is
        // none. The message says which of the two steps failed.
        _provider = {
            id: "x",
            route: async () => ({ ok: true, route: { distance: 1, duration: 1, legs: [] } }),
        };
        openPanel();
        captured!.handlers.onCompute([]);
        await new Promise((r) => setTimeout(r, 0));
        expect(shown).toEqual(["no-layer"]);
    });
});

describe("your position", () => {
    it("PREPENDS it — the journey starts there", () => {
        // Appending would make the user their own destination: a route of length zero.
        _origin = { ok: true, waypoint: { coordinates: [1, 2], name: "routing.origin.you" } };
        openPanel([{ coordinates: [3, 4], name: "Cible" }]);
        captured!.handlers.onUseMyPosition();
        expect(setTo?.[0]?.name).toBe("routing.origin.you");
        expect(setTo?.[1]?.name).toBe("Cible");
    });

    it("reports each refusal with its OWN reason, never folded into a routing failure", () => {
        // 🛑 A refused permission is NOT a routing failure. Folding it onto
        // `refused` would tell the user their configuration is at fault, when
        // it is they who said no — and the next step they must know is unrelated.
        for (const [reason, expected] of [
            ["denied", "origin-denied"],
            ["no-fix", "origin-no-fix"],
            ["unavailable", "origin-unavailable"],
        ] as const) {
            shown = [];
            destroyPanel();
            captured = null;
            _origin = { ok: false, reason };
            openPanel();
            captured!.handlers.onUseMyPosition();
            expect(shown).toEqual([expected]);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The guidance trigger. Added BELOW the existing tests, which pass
// unchanged: with no reachable registry, no button is created, and that is
// the state they already measured.
// ─────────────────────────────────────────────────────────────────────────────

describe("le point d'entrée du guidage", () => {
    afterEach(() => {
        _plugins = undefined;
    });

    it("🛑 ne fournit AUCUN handler quand `navigation` est introuvable", () => {
        // Its absence IS the guard: the panel then creates no button at all,
        // stronger than a hidden button. An integrator who has not installed
        // the plugin does not have this feature — showing them its greyed
        // shape would invite hunting for a setting that does not exist.
        _plugins = { isLoaded: () => false, isLazyAvailable: () => false };
        openPanel();
        expect(captured?.handlers.onStartGuidance).toBeUndefined();
    });

    it("🛑 le fournit sur `isLazyAvailable` SEUL — jamais sur `isLoaded`", () => {
        // A lazy plugin only enters the registry after loading, and the one
        // gesture that would load it is this button. Gating on `isLoaded`
        // would hide the entry point behind the condition it serves to satisfy
        // — the exact trap that forces `routing` itself to stay eager, met
        // from the other side.
        _plugins = { isLoaded: () => false, isLazyAvailable: (n: string) => n === "navigation" };
        openPanel();
        expect(typeof captured?.handlers.onStartGuidance).toBe("function");
    });

    it("le fournit aussi quand le plugin est DÉJÀ chargé", () => {
        // Reopening the panel after a guidance session must not make the
        // button vanish: at that point `isLazyAvailable` may answer `false`,
        // the plugin having moved to the loaded side.
        _plugins = { isLoaded: (n: string) => n === "navigation", isLazyAvailable: () => false };
        openPanel();
        expect(typeof captured?.handlers.onStartGuidance).toBe("function");
    });

    it("🛑 un panneau NEUF ne garde AUCUN itinéraire d'une session précédente", async () => {
        const load = vi.fn().mockResolvedValue(undefined);
        const start = vi.fn();
        _plugins = { isLoaded: () => false, isLazyAvailable: () => true, load };
        const g = globalThis as unknown as { GeoLeaf?: unknown };
        const previous = g.GeoLeaf;
        g.GeoLeaf = { Navigation: { start } };
        try {
            openPanel();
            captured?.handlers.onStartGuidance?.();
            await new Promise((r) => setTimeout(r, 0));
            // 🛑 Defect found while writing this test: `lastRoute` is MODULE
            // state, and it survived the panel's closing. Reopening after a
            // session would have started guidance on a line the user no longer
            // sees — the new panel displays no figure, and the button would
            // have left on the old computation. A guidance following a line
            // not before your eyes is the worst of both worlds: it looks like it works.
            expect(start).not.toHaveBeenCalled();
            expect(load).not.toHaveBeenCalled();
        } finally {
            g.GeoLeaf = previous;
        }
    });
});
