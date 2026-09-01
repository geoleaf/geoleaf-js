/**
 * Unit tests — two-level progress, exit hysteresis, state machine.
 *
 * 🛑 No network calls.
 */
import { describe, it, expect } from "vitest";
import { computeProgress } from "../engine/progress.js";
import { OffRouteDetector } from "../engine/off-route.js";
import { GuidanceMachine } from "../engine/state-machine.js";
import { buildTrack, snapToTrack } from "../engine/snap.js";
import { traceLine, traceFixes, DEPARTURE_INDICES } from "./helpers/trace-player.js";

/** Three legs of 600 m / 60 s — two intermediate waypoints, one destination. */
const ROUTE = {
    distance: 1800,
    duration: 180,
    geometry: "",
    legs: [
        { distance: 600, duration: 60, steps: [] },
        { distance: 600, duration: 60, steps: [] },
        { distance: 600, duration: 60, steps: [] },
    ],
} as unknown as import("@geoleaf-plugins/routing").RouteResult;

describe("computeProgress — deux niveaux, simultanément", () => {
    it("au départ, tout reste", () => {
        const p = computeProgress(ROUTE, 0, 1800);
        expect(p.legIndex).toBe(0);
        expect(p.distanceRemaining).toBeCloseTo(1800, 5);
        expect(p.durationRemaining).toBeCloseTo(180, 5);
        expect(p.legDistanceRemaining).toBeCloseTo(600, 5);
    });

    it("à mi-premier-tronçon, les DEUX niveaux diffèrent — c'est tout l'intérêt", () => {
        // 🛑 The assertion that justifies the module. If the two levels were
        // derivable from each other, one would suffice; they answer two
        // different questions.
        const p = computeProgress(ROUTE, 300, 1800);
        expect(p.legDistanceRemaining).toBeCloseTo(300, 5);
        expect(p.distanceRemaining).toBeCloseTo(1500, 5);
        expect(p.legDurationRemaining).toBeCloseTo(30, 5);
        expect(p.durationRemaining).toBeCloseTo(150, 5);
    });

    it("passe au tronçon suivant à la frontière", () => {
        const p = computeProgress(ROUTE, 700, 1800);
        expect(p.legIndex).toBe(1);
        expect(p.legDistanceRemaining).toBeCloseTo(500, 5);
    });

    it("mise à l'échelle du tracé : les restants ne dépassent JAMAIS la ligne mesurée", () => {
        // ⚠️ The provider announces 1800 m; the geometry it returns measures
        // 1500. Without rescaling, "travelled + remaining" drifts by a gap
        // that grows with the route.
        const p = computeProgress(ROUTE, 1500, 1500);
        expect(p.distanceRemaining).toBeCloseTo(0, 5);
        expect(p.legIndex).toBe(2);
    });

    it("ne jette pas sur un itinéraire dégénéré", () => {
        // A guidance crashing on odd data is worse than one announcing
        // nothing: the first takes the page down, the second is visible and fixable.
        const empty = { ...ROUTE, legs: [] } as unknown as typeof ROUTE;
        expect(() => computeProgress(empty, 0, 0)).not.toThrow();
        expect(computeProgress(empty, 0, 0).distanceRemaining).toBe(0);
    });

    it("ne rend jamais de restant négatif, même au-delà de la fin", () => {
        const p = computeProgress(ROUTE, 5000, 1800);
        expect(p.distanceRemaining).toBeGreaterThanOrEqual(0);
        expect(p.legDistanceRemaining).toBeGreaterThanOrEqual(0);
    });
});

describe("OffRouteDetector — l'hystérésis, et elle joue dans les DEUX sens", () => {
    const cfg = { thresholdMetres: 40, confirmExit: 3, confirmReturn: 2 };

    it("un seul relevé hors seuil ne déclenche RIEN", () => {
        // 🛑 The module's core. Without it, a noisy GPS triggers bursts of
        // recomputes and empties a provider quota in minutes.
        const d = new OffRouteDetector(cfg);
        expect(d.accept(200).off).toBe(false);
        expect(d.accept(200).off).toBe(false);
    });

    it("confirme la sortie au N-ième relevé, et signale l'ARÊTE une seule fois", () => {
        const d = new OffRouteDetector(cfg);
        d.accept(200);
        d.accept(200);
        const third = d.accept(200);
        expect(third.off).toBe(true);
        expect(third.changed).toBe(true);
        expect(d.accept(200).changed).toBe(false);
    });

    it("un relevé favorable REMET le compteur de sortie à zéro", () => {
        const d = new OffRouteDetector(cfg);
        d.accept(200);
        d.accept(200);
        d.accept(5);
        d.accept(200);
        d.accept(200);
        expect(d.off).toBe(false);
    });

    it("le retour est confirmé lui aussi — sinon l'oscillation se déplace, elle ne disparaît pas", () => {
        const d = new OffRouteDetector(cfg);
        d.accept(200);
        d.accept(200);
        d.accept(200);
        expect(d.off).toBe(true);
        expect(d.accept(5).off).toBe(true);
        expect(d.accept(5).off).toBe(false);
    });

    it("une séquence ALTERNÉE tient l'état plutôt que de le faire vibrer", () => {
        // Two separate counters, and that is what this test pins: a single
        // counter would let two opposite fixes cancel out, and the state would
        // freeze with no telling on what.
        const d = new OffRouteDetector(cfg);
        for (let i = 0; i < 12; i++) d.accept(i % 2 === 0 ? 200 : 5);
        expect(d.off).toBe(false);
    });

    it("`reset` oublie tout — et ne pas le faire après un recalcul fait rerouter sans fin", () => {
        const d = new OffRouteDetector(cfg);
        d.accept(200);
        d.accept(200);
        d.reset();
        d.accept(200);
        expect(d.off).toBe(false);
    });

    it("sur la trace versionnée : le décrochage est confirmé, puis le retour l'est aussi", () => {
        // The module exercised on a trace structured like a real one, not on
        // numbers chosen to please it.
        const d = new OffRouteDetector(cfg);
        const track = buildTrack(traceLine);
        const seen: boolean[] = [];
        let near: number | null = null;
        for (const f of traceFixes) {
            const s = snapToTrack(track, [f.longitude, f.latitude], near);
            const v = d.accept(s!.distanceToLine);
            // ⚠️ The anchor is released as soon as the exit is confirmed — what
            // the runtime does, because a recompute yields a new line. Without
            // that release, the anchor stays behind through the whole excursion
            // and reads the user 198 m from the line when they have returned to
            // it: the RETURN would never be confirmed, and this test would say
            // the hysteresis only works one way when it is the wiring that is missing.
            near = v.off ? null : s!.distanceAlong;
            seen.push(v.off);
        }
        expect(seen.slice(0, DEPARTURE_INDICES.first)).not.toContain(true);
        expect(seen).toContain(true);
        expect(seen[seen.length - 1]).toBe(false);
    });
});

describe("GuidanceMachine — cinq états, et la règle de reprise", () => {
    const cfg = { arrivalRadiusMetres: 30 };
    const onRoute = { off: false, legIndex: 0, legDistanceRemaining: 500, isFinalLeg: false };

    it("démarre en `navigating` depuis `idle`", () => {
        const m = new GuidanceMachine(cfg);
        expect(m.state).toBe("idle");
        expect(m.start()).toBe("navigating");
    });

    it("passe en `rerouting` sur une sortie CONFIRMÉE, et en revient", () => {
        const m = new GuidanceMachine(cfg);
        m.start();
        expect(m.accept({ ...onRoute, off: true })).toBe("rerouting");
        expect(m.accept(onRoute)).toBe("navigating");
    });

    it("tient à une étape intermédiaire, et n'y va qu'UNE fois", () => {
        // 🛑 Without the per-leg-index guard, a fix lingering in the radius
        // re-announces the waypoint at every sample — the arrival chime once a second.
        const m = new GuidanceMachine(cfg);
        m.start();
        expect(m.accept({ ...onRoute, legDistanceRemaining: 10 })).toBe("waypoint-reached");
        expect(m.accept({ ...onRoute, legDistanceRemaining: 10 })).toBe("waypoint-reached");
        expect(m.continueToNextLeg()).toBe("navigating");
        expect(m.accept({ ...onRoute, legDistanceRemaining: 10 })).toBe("navigating");
    });

    it("tient l'étape MÊME hors tracé — on se gare rarement sur la route", () => {
        const m = new GuidanceMachine(cfg);
        m.start();
        m.accept({ ...onRoute, legDistanceRemaining: 5 });
        expect(m.accept({ ...onRoute, off: true, legDistanceRemaining: 5 })).toBe(
            "waypoint-reached"
        );
    });

    it("`arrived` est TERMINAL — dépasser la destination ne relance pas le guidage", () => {
        const m = new GuidanceMachine(cfg);
        m.start();
        expect(m.accept({ ...onRoute, legDistanceRemaining: 5, isFinalLeg: true })).toBe("arrived");
        expect(m.accept({ ...onRoute, legDistanceRemaining: 900 })).toBe("arrived");
        expect(m.accept({ ...onRoute, off: true })).toBe("arrived");
    });

    it("la destination n'est PAS une étape — elle ne tient pas, elle termine", () => {
        const m = new GuidanceMachine(cfg);
        m.start();
        expect(
            m.accept({ ...onRoute, legIndex: 2, legDistanceRemaining: 5, isFinalLeg: true })
        ).toBe("arrived");
    });

    it("🛑 la suspension retombe en `idle` et OUBLIE — jamais de restauration d'état", () => {
        // The validated spec's resume rule, and the bug class it prevents:
        // "guidance resumes three kilometres back". The application may have
        // slept twenty minutes; restoring would announce a long-past maneuver,
        // with confidence.
        const m = new GuidanceMachine(cfg);
        m.start();
        m.accept({ ...onRoute, legDistanceRemaining: 10 });
        expect(m.state).toBe("waypoint-reached");
        expect(m.suspend()).toBe("idle");
        // And the forgetting is REAL: the same waypoint can be re-announced after re-projection.
        expect(m.accept({ ...onRoute, legDistanceRemaining: 10 })).toBe("waypoint-reached");
    });

    it("il n'existe AUCUN `resume` — et c'est ce qui rend la règle inviolable", () => {
        // A `resume()` would be the shortcut the rule forbids. This test pins
        // its absence: the day someone adds one, it turns red and they read why.
        const m = new GuidanceMachine(cfg) as unknown as Record<string, unknown>;
        expect(m["resume"]).toBeUndefined();
    });

    it("`continueToNextLeg` ne relance pas un itinéraire terminé", () => {
        const m = new GuidanceMachine(cfg);
        m.start();
        m.accept({ ...onRoute, legDistanceRemaining: 5, isFinalLeg: true });
        expect(m.continueToNextLeg()).toBe("arrived");
    });

    it("`stop` est idempotent", () => {
        const m = new GuidanceMachine(cfg);
        m.start();
        expect(m.stop()).toBe("idle");
        expect(m.stop()).toBe("idle");
    });
});

describe("le tout ensemble, sur la trace rejouée", () => {
    it("guide du départ à l'arrivée sans jamais faire reculer le restant EN GUIDAGE", () => {
        // 🛑 The property a user SEES. A "remaining" that climbs back makes the
        // whole screen doubtful, and it is the kind of defect no unit
        // assertion renders.
        //
        // ⚠️ The assertion is gated by the STATE, and that is not a softening:
        // in `rerouting`, the remainder MAY legitimately climb — we are being
        // re-routed, and the followed line is no longer the one we followed.
        // An ungated assertion demands of the guidance a promise it does not make.
        //
        // 🛑 And the anchor is RELEASED on a confirmed exit, because that is
        // what the runtime will do: a confirmed exit requests a recompute, the
        // recompute yields a new line, and an anchor inherited from the old
        // one would point to a place that no longer exists. Without that
        // release, the anchor stays behind through the whole excursion and
        // reads the user 198 m from the line when they have returned — measured.
        const track = buildTrack(traceLine);
        const total = track.length;
        const detector = new OffRouteDetector({
            thresholdMetres: 40,
            confirmExit: 3,
            confirmReturn: 2,
        });
        const machine = new GuidanceMachine({ arrivalRadiusMetres: 30 });
        machine.start();

        let near: number | null = null;
        let previousRemaining = Number.POSITIVE_INFINITY;
        let previousTimestamp: number | null = null;
        let sawRerouting = false;
        let guidedSamples = 0;

        for (const f of traceFixes) {
            const elapsed =
                previousTimestamp === null ? null : (f.timestamp - previousTimestamp) / 1000;
            previousTimestamp = f.timestamp;

            const snapped = snapToTrack(track, [f.longitude, f.latitude], near, elapsed);
            const verdict = detector.accept(snapped!.distanceToLine);
            const p = computeProgress(ROUTE, snapped!.distanceAlong, total);
            const state = machine.accept({
                off: verdict.off,
                legIndex: p.legIndex,
                legDistanceRemaining: p.legDistanceRemaining,
                isFinalLeg: p.legIndex === ROUTE.legs.length - 1,
            });

            if (state === "rerouting") {
                sawRerouting = true;
                near = null;
                previousRemaining = Number.POSITIVE_INFINITY;
            } else {
                near = snapped!.distanceAlong;
                if (state === "navigating") {
                    guidedSamples += 1;
                    expect(p.distanceRemaining).toBeLessThanOrEqual(previousRemaining + 1);
                    previousRemaining = p.distanceRemaining;
                }
            }
            if (state === "waypoint-reached") machine.continueToNextLeg();
        }

        expect(sawRerouting).toBe(true);
        expect(machine.state).toBe("arrived");
        // The witness: without it, a too-broad state gate would make the test
        // green while NEVER asserting anything — the exact defect found just before.
        expect(guidedSamples).toBeGreaterThan(20);
    });

    it("la projection n'avance jamais plus vite que physiquement possible", () => {
        // The jump filter, exercised on the trace. Without a speed-bounded
        // window, a 90° corner advances the projection 171 m in 1.2 s —
        // 513 km/h — then backs it up 147 m. Measured before the bound existed.
        const track = buildTrack(traceLine);
        let near: number | null = null;
        let previousTimestamp: number | null = null;
        let worst = 0;
        for (const f of traceFixes) {
            const elapsed =
                previousTimestamp === null ? null : (f.timestamp - previousTimestamp) / 1000;
            previousTimestamp = f.timestamp;
            const s = snapToTrack(track, [f.longitude, f.latitude], near, elapsed);
            if (near !== null && elapsed)
                worst = Math.max(worst, (s!.distanceAlong - near) / elapsed);
            near = s!.distanceAlong;
        }
        expect(worst).toBeLessThan(56);
    });
});
