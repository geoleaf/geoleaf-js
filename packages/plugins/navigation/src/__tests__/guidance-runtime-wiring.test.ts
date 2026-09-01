/**
 * Unit tests — the wired runtime: recompute, out-of-coverage fallback, resume rule.
 *
 * 🛑 No network calls. The provider is an injected function, which is the
 * design itself and not a test convenience: this package imports only TYPES
 * from `routing`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGuidanceRuntime, type GuidanceConfig } from "../engine/runtime.js";
import { traceLine, traceFixes } from "./helpers/trace-player.js";

const CONFIG: GuidanceConfig = {
    arrivalRadiusMetres: 30,
    offRouteThresholdMetres: 40,
    confirmExit: 3,
    confirmReturn: 2,
    retryAfterFixes: 2,
    maxRetryFixes: 8,
};

/** A route of three legs and four waypoints. */
function makeRoute(tag = "a") {
    return {
        distance: 1800,
        duration: 180,
        geometry: `geom-${tag}`,
        provider: "test",
        waypoints: [
            { coordinates: [55.4781, -21.0964] as const, name: "départ" },
            { coordinates: [55.4835, -21.0964] as const, name: "étape 1" },
            { coordinates: [55.4861, -21.0921] as const, name: "étape 2" },
            { coordinates: [55.4923, -21.0955] as const, name: "arrivée" },
        ],
        legs: [
            { distance: 600, duration: 60, steps: [] },
            { distance: 600, duration: 60, steps: [] },
            { distance: 600, duration: 60, steps: [] },
        ],
    } as unknown as import("@geoleaf-plugins/routing").RouteResult;
}

/** Drives the position watch: returns the function the platform would call. */
function stubGeo() {
    let emit: ((p: GeolocationPosition) => void) | null = null;
    const clearWatch = vi.fn();
    vi.stubGlobal("navigator", {
        geolocation: {
            watchPosition: (f: (p: GeolocationPosition) => void) => ((emit = f), 42),
            clearWatch,
        },
    });
    let clock = 1_755_800_000_000;
    return {
        clearWatch,
        /**
         * Emits an ARBITRARY fix, spaced 10 s from the previous one.
         *
         * ⚠️ Ten seconds, not one: the adapter's jump filter bounds progress to
         * `55 m/s × Δt`. At 1 s intervals, leaving the line by 200 m at once
         * would be an implausible jump — hence DROPPED, rightly — and the
         * scenario would never run. A 10 s spacing is that of a sensor in poor
         * reception, precisely the situation exercised here.
         */
        at(lng: number, lat: number) {
            clock += 10_000;
            emit!({
                coords: {
                    longitude: lng,
                    latitude: lat,
                    accuracy: 8,
                    heading: null,
                    speed: 12,
                    altitude: null,
                    altitudeAccuracy: null,
                    toJSON: () => ({}),
                },
                timestamp: clock,
                toJSON: () => ({}),
            } as GeolocationPosition);
        },
        /** Emits fix `i` of the versioned trace. */
        fix(i: number) {
            const f = traceFixes[i]!;
            emit!({
                coords: {
                    longitude: f.longitude,
                    latitude: f.latitude,
                    accuracy: f.accuracy,
                    heading: f.heading,
                    speed: f.speed,
                    altitude: null,
                    altitudeAccuracy: null,
                    toJSON: () => ({}),
                },
                timestamp: f.timestamp,
                toJSON: () => ({}),
            } as GeolocationPosition);
        },
    };
}

/** A document whose visibility we drive. */
function stubDoc() {
    const l: Record<string, (() => void)[]> = {};
    const doc = {
        visibilityState: "visible",
        addEventListener: (t: string, f: () => void) => void (l[t] ??= []).push(f),
        removeEventListener: (t: string, f: () => void) => {
            l[t] = (l[t] ?? []).filter((x) => x !== f);
        },
    } as unknown as Document;
    return {
        doc,
        hide() {
            (doc as unknown as { visibilityState: string }).visibilityState = "hidden";
            (l["visibilitychange"] ?? []).forEach((f) => f());
        },
        listenerCount: () => (l["visibilitychange"] ?? []).length,
    };
}

describe("createGuidanceRuntime", () => {
    let geo: ReturnType<typeof stubGeo>;
    beforeEach(() => (geo = stubGeo()));
    afterEach(() => vi.unstubAllGlobals());

    it("part en `idle` et passe en `navigating` au démarrage", () => {
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute: vi.fn(),
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        expect(rt.state).toBe("idle");
        rt.start(makeRoute(), traceLine);
        expect(rt.state).toBe("navigating");
    });

    it("émet un échantillon par relevé, avec les deux restants", () => {
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute: vi.fn(),
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        const seen: import("@geoleaf-plugins/routing").NavProgress[] = [];
        rt.onProgress((p) => seen.push(p));
        rt.start(makeRoute(), traceLine);
        geo.fix(0);
        geo.fix(1);
        expect(seen).toHaveLength(2);
        expect(seen[0]!.distanceRemaining).toBeGreaterThan(0);
        expect(seen[0]!.offRouteDistance).toBeGreaterThanOrEqual(0);
    });

    it("un auditeur qui jette n'emporte NI les autres NI le relevé suivant", () => {
        // A rendering bug must not become a guidance outage.
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute: vi.fn(),
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        const good = vi.fn();
        rt.onProgress(() => {
            throw new Error("rendu cassé");
        });
        rt.onProgress(good);
        rt.start(makeRoute(), traceLine);
        expect(() => geo.fix(0)).not.toThrow();
        geo.fix(1);
        expect(good).toHaveBeenCalledTimes(2);
    });

    it("`onProgress` rend un désabonnement qui marche", () => {
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute: vi.fn(),
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        const seen = vi.fn();
        const off = rt.onProgress(seen);
        rt.start(makeRoute(), traceLine);
        geo.fix(0);
        off();
        geo.fix(1);
        expect(seen).toHaveBeenCalledTimes(1);
    });
});

describe("le recalcul", () => {
    let geo: ReturnType<typeof stubGeo>;
    beforeEach(() => (geo = stubGeo()));
    afterEach(() => vi.unstubAllGlobals());

    /** Derails the guidance until the exit is confirmed. */
    function driveOffRoute(fixOne: (i: number) => void) {
        for (let i = 0; i <= 25; i++) fixOne(i);
    }

    it("déclenche un recalcul quand la sortie est CONFIRMÉE, pas au premier écart", async () => {
        const recompute = vi.fn().mockResolvedValue({ ok: false, reason: "network" });
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute,
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        rt.start(makeRoute(), traceLine);
        geo.fix(20); // premier écart franc
        expect(recompute).not.toHaveBeenCalled();
        driveOffRoute((i) => geo.fix(i));
        await Promise.resolve();
        expect(recompute).toHaveBeenCalled();
    });

    it("🛑 recalcule vers les étapes RESTANTES, dérivées du tronçon — pas « tout sauf l'origine »", async () => {
        // Cutting at index 1 is only right on the FIRST leg. On the third, it
        // would send the driver back through an already-passed waypoint, with
        // nothing to explain it.
        const recompute = vi.fn().mockResolvedValue({ ok: false, reason: "network" });
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute,
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        rt.start(makeRoute(), traceLine);
        driveOffRoute((i) => geo.fix(i));
        await Promise.resolve();
        const [, remaining] = recompute.mock.calls[0]!;
        // 🛑 MEASURED, not estimated: the exit confirms at fix 25, on leg 1.
        // So EXACTLY `waypoints[2…]` remain — "étape 2" then "arrivée".
        //
        // ⚠️ `length < 4` was not enough and let the mutation through: cutting
        // at index 1 yields 3 elements, well below 4. A loose bound on a
        // length is the kind of assertion that looks like it checks something.
        expect(remaining.map((w: { name?: string }) => w.name)).toEqual(["étape 2", "arrivée"]);
    });

    it("adopte l'itinéraire recalculé, et repart en `navigating`", async () => {
        const recompute = vi.fn().mockResolvedValue({ ok: true, route: makeRoute("b") });
        const decodeGeometry = vi.fn().mockReturnValue(traceLine);
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute,
            decodeGeometry,
            doc: stubDoc().doc,
        });
        rt.start(makeRoute(), traceLine);
        driveOffRoute((i) => geo.fix(i));
        await Promise.resolve();
        await Promise.resolve();
        expect(decodeGeometry).toHaveBeenCalledWith("geom-b");
        expect(rt.state).toBe("navigating");
    });

    it("🛑 HORS COUVERTURE, le guidage CONTINUE sur l'itinéraire qu'il a", async () => {
        // The offline computation module was REMOVED in v1.0.0 of the spec;
        // what replaced it is "guide out of coverage on a route prepared in
        // coverage". A runtime stopping for want of re-routing would throw
        // away the one thing the design says to keep.
        const recompute = vi.fn().mockResolvedValue({ ok: false, reason: "network" });
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute,
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        const seen: string[] = [];
        rt.onProgress((p) => seen.push(p.state));
        rt.start(makeRoute(), traceLine);
        for (let i = 0; i < traceFixes.length; i++) geo.fix(i);
        await Promise.resolve();
        expect(seen).toContain("rerouting");
        // It kept going: samples are emitted AFTER the excursion, and the state comes back.
        expect(seen[seen.length - 1]).not.toBe("idle");
        expect(seen.length).toBe(traceFixes.length);
    });

    it("🛑 ESPACE ses tentatives après un échec — sinon un tunnel coûte une requête par relevé", async () => {
        // SYNTHETIC fixes: the versioned trace's excursion lasts only two
        // fixes, too short for a second attempt to happen — hence too short to
        // tell "spaced" from "not spaced". Measured: that is what let the
        // mutation through.
        const recompute = vi.fn().mockResolvedValue({ ok: false, reason: "network" });
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute,
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        rt.start(makeRoute(), traceLine);
        // Far from the line, for long: enough to confirm the exit then stay out for 20 fixes.
        for (let k = 0; k < 24; k++) {
            geo.at(55.52, -21.05);
            await Promise.resolve();
            await Promise.resolve();
        }
        // Without spacing, it would be one attempt per fix spent in
        // `rerouting` — 20 and more. With spacing (2, 4, 8, capped at 8), it is a handful.
        expect(recompute.mock.calls.length).toBeGreaterThan(0);
        expect(recompute.mock.calls.length).toBeLessThanOrEqual(6);
    });

    it("🛑 le recalcul RÉINITIALISE le détecteur — sans quoi l'itinéraire neuf naît déjà hors tracé", async () => {
        // The counters were accumulated against the OLD line. Inheriting them
        // would re-confirm the exit at the FIRST fix on the new line, hence
        // request a recompute right away: a route recomputing without end.
        const recompute = vi.fn().mockResolvedValue({ ok: true, route: makeRoute("b") });
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute,
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        rt.start(makeRoute(), traceLine);
        for (let k = 0; k < 4; k++) {
            geo.at(55.52, -21.05);
            await Promise.resolve();
            await Promise.resolve();
        }
        expect(recompute).toHaveBeenCalledTimes(1);

        // ONE more fix still off the line. Detector reset, it cannot confirm
        // an exit: `confirmExit` fixes are needed. Without the reset, this one would suffice.
        geo.at(55.52, -21.05);
        await Promise.resolve();
        await Promise.resolve();
        expect(recompute).toHaveBeenCalledTimes(1);
    });

    it("ne lance pas deux recalculs en parallèle", async () => {
        let resolve!: (v: unknown) => void;
        const recompute = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute,
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        rt.start(makeRoute(), traceLine);
        driveOffRoute((i) => geo.fix(i));
        expect(recompute).toHaveBeenCalledTimes(1);
        resolve({ ok: false, reason: "network" });
    });
});

describe("la règle de reprise, câblée", () => {
    let geo: ReturnType<typeof stubGeo>;
    beforeEach(() => (geo = stubGeo()));
    afterEach(() => vi.unstubAllGlobals());

    it("🛑 perdre le premier plan retombe en `idle` et OUBLIE la projection", () => {
        // The application may have slept twenty minutes. Resuming on the old
        // projection would announce a long-past maneuver, with confidence.
        const d = stubDoc();
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute: vi.fn(),
            decodeGeometry: () => traceLine,
            doc: d.doc,
        });
        rt.start(makeRoute(), traceLine);
        geo.fix(5);
        expect(rt.state).toBe("navigating");
        d.hide();
        expect(rt.state).toBe("idle");
    });

    it("`stop` arrête la veille et retire l'écouteur de visibilité", () => {
        const d = stubDoc();
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute: vi.fn(),
            decodeGeometry: () => traceLine,
            doc: d.doc,
        });
        rt.start(makeRoute(), traceLine);
        expect(d.listenerCount()).toBe(1);
        rt.stop();
        expect(geo.clearWatch).toHaveBeenCalledWith(42);
        expect(d.listenerCount()).toBe(0);
        expect(rt.state).toBe("idle");
    });

    it("`start` deux fois n'empile ni veille ni écouteur", () => {
        const d = stubDoc();
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute: vi.fn(),
            decodeGeometry: () => traceLine,
            doc: d.doc,
        });
        rt.start(makeRoute(), traceLine);
        rt.start(makeRoute("c"), traceLine);
        expect(d.listenerCount()).toBe(1);
        expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    });

    it("un relevé arrivé après `stop` ne fait rien", () => {
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute: vi.fn(),
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        const seen = vi.fn();
        rt.onProgress(seen);
        rt.start(makeRoute(), traceLine);
        rt.stop();
        expect(() => geo.fix(0)).not.toThrow();
        expect(seen).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The out-of-coverage SENTENCE, and the network's return as a HINT.
// ─────────────────────────────────────────────────────────────────────────────

describe("dire POURQUOI le recalcul a échoué", () => {
    let geo: ReturnType<typeof stubGeo>;
    beforeEach(() => (geo = stubGeo()));
    afterEach(() => vi.unstubAllGlobals());

    /** Pushes the guidance off the line until a recompute is attempted. */
    async function driveOff(rt: unknown, times = 5) {
        for (let k = 0; k < times; k++) {
            geo.at(55.52, -21.05);
            await Promise.resolve();
            await Promise.resolve();
        }
        void rt;
    }

    it("🛑 émet le MOTIF de l'échec — « hors trajet » et « hors trajet SANS RÉSEAU » ne sont pas le même état", async () => {
        // Without the reason, the two read the same on screen, and they call
        // for opposite moves from the driver: wait, or turn around.
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute: async () => ({ ok: false, reason: "network" }),
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        const seen: Array<string | undefined> = [];
        rt.onProgress((p) => seen.push((p as { rerouteFailure?: string }).rerouteFailure));
        rt.start(makeRoute(), traceLine);
        await driveOff(rt);
        expect(seen).toContain("network");
    });

    it("N'émet AUCUN motif tant que le guidage suit sa route", async () => {
        // `rerouteFailure: null` in a sample would read "there was a failure,
        // with no cause". Absence is the only honest shape of a guidance doing fine.
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute: vi.fn(),
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        const seen: Array<Record<string, unknown>> = [];
        rt.onProgress((p) => seen.push(p as unknown as Record<string, unknown>));
        rt.start(makeRoute(), traceLine);
        geo.fix(0);
        geo.fix(1);
        expect(seen.every((p) => !("rerouteFailure" in p))).toBe(true);
    });

    it("🛑 EFFACE le motif dès qu'un recalcul aboutit", async () => {
        // A reason outliving its cause would leave a permanent warning under a
        // guidance that has been working again for twenty minutes.
        let fail = true;
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute: async () =>
                fail
                    ? { ok: false as const, reason: "network" as const }
                    : { ok: true as const, route: makeRoute("b") },
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        const seen: Array<string | undefined> = [];
        rt.onProgress((p) => seen.push((p as { rerouteFailure?: string }).rerouteFailure));
        rt.start(makeRoute(), traceLine);
        await driveOff(rt, 6);
        expect(seen).toContain("network");

        fail = false;
        await driveOff(rt, 8);
        expect(seen[seen.length - 1]).toBeUndefined();
    });
});

describe("le retour du réseau est un INDICE, jamais un prédicat", () => {
    let geo: ReturnType<typeof stubGeo>;
    beforeEach(() => (geo = stubGeo()));
    afterEach(() => vi.unstubAllGlobals());

    it("🛑 un `online` RACCOURCIT l'attente au lieu de la laisser courir", async () => {
        // The runtime NEVER asks `navigator.onLine` whether to try — it tries
        // and reads the answer. What the event brings is "something just
        // changed", hence retry now. A false negative would have cost a whole
        // wait while the network was back, and it is the only one of the two
        // the user feels.
        const listeners: Array<() => void> = [];
        vi.stubGlobal("window", {
            addEventListener: (t: string, f: () => void) => {
                if (t === "online") listeners.push(f);
            },
            removeEventListener: () => {},
        });
        const recompute = vi.fn().mockResolvedValue({ ok: false, reason: "network" });
        const rt = createGuidanceRuntime({
            config: { ...CONFIG, retryAfterFixes: 8, maxRetryFixes: 8 },
            recompute,
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        rt.start(makeRoute(), traceLine);
        // A first attempt, then an eight-fix wait.
        for (let k = 0; k < 5; k++) {
            geo.at(55.52, -21.05);
            await Promise.resolve();
            await Promise.resolve();
        }
        const before = recompute.mock.calls.length;
        expect(before).toBeGreaterThan(0);

        // The network comes back: the ongoing wait is cancelled, so the next fix retries.
        listeners.forEach((f) => f());
        geo.at(55.52, -21.05);
        await Promise.resolve();
        await Promise.resolve();
        expect(recompute.mock.calls.length).toBeGreaterThan(before);
    });

    it("se désabonne à l'arrêt", async () => {
        const removed: string[] = [];
        vi.stubGlobal("window", {
            addEventListener: () => {},
            removeEventListener: (t: string) => removed.push(t),
        });
        const rt = createGuidanceRuntime({
            config: CONFIG,
            recompute: vi.fn(),
            decodeGeometry: () => traceLine,
            doc: stubDoc().doc,
        });
        rt.start(makeRoute(), traceLine);
        rt.stop();
        expect(removed).toContain("online");
    });
});
