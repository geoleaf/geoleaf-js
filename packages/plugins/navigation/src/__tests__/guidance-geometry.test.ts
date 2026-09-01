/**
 * Unit tests — projection, track length and heading, exercised on the versioned trace.
 *
 * 🛑 No network calls. The harness replays a file from the repo.
 */
import { describe, it, expect } from "vitest";
import { buildTrack, snapToTrack } from "../engine/snap.js";
import { resolveHeading, normaliseDegrees } from "../engine/heading.js";
import {
    traceLine,
    traceFixes,
    positionAt,
    replay,
    DEPARTURE_INDICES,
} from "./helpers/trace-player.js";

const TRACK = buildTrack(traceLine);

describe("snapToTrack", () => {
    it("refuse une ligne trop courte plutôt que d'inventer une projection", () => {
        // Returning a result on a single point would give `distanceAlong: 0`
        // and `distanceToLine: 0` — indistinguishable from a user exactly at the start.
        expect(snapToTrack(buildTrack([]), [55, -21])).toBeNull();
        expect(snapToTrack(buildTrack([[55, -21]]), [55, -21])).toBeNull();
    });

    it("projette un sommet du tracé sur lui-même", () => {
        const v = traceLine[5] as readonly [number, number];
        const snapped = snapToTrack(TRACK, v);
        expect(snapped).not.toBeNull();
        expect(snapped!.distanceToLine).toBeLessThan(0.5);
    });

    it("`distanceAlong` croît le long du tracé, strictement", () => {
        // 🛑 The property ALL the progress depends on. If it can go backwards,
        // "remaining" climbs, and a climbing counter makes the rest of the screen doubtful.
        let previous = -1;
        for (let i = 0; i < traceLine.length; i++) {
            const s = snapToTrack(
                TRACK,
                traceLine[i] as readonly [number, number],
                previous < 0 ? null : previous
            );
            expect(s).not.toBeNull();
            expect(s!.distanceAlong).toBeGreaterThan(previous);
            previous = s!.distanceAlong;
        }
    });

    it("mesure la distance au tracé, et le décrochage de la trace est VU", () => {
        // The trace's witness: without it, the hysteresis would be exercised
        // on numbers nothing says exceed the threshold.
        const onRoute = snapToTrack(TRACK, [traceFixes[2]!.longitude, traceFixes[2]!.latitude]);
        const away = snapToTrack(TRACK, [
            traceFixes[DEPARTURE_INDICES.peak]!.longitude,
            traceFixes[DEPARTURE_INDICES.peak]!.latitude,
        ]);
        expect(onRoute!.distanceToLine).toBeLessThan(10);
        expect(away!.distanceToLine).toBeGreaterThan(50);
    });
});

describe("buildTrack — la longueur, mesurée une fois", () => {
    it("mesure le tracé par la MÊME projection que snapToLine", () => {
        // 36 segments of 50 m — the trace is generated that way. A wide
        // tolerance: what is exercised is the consistency of the two measures,
        // not turf's geodesic precision.
        expect(TRACK.length).toBeGreaterThan(1700);
        expect(TRACK.length).toBeLessThan(1900);
    });

    it("rend 0 sur une ligne trop courte, sans jeter", () => {
        expect(buildTrack([]).length).toBe(0);
        expect(buildTrack([[55, -21]]).length).toBe(0);
    });

    it("borne `distanceAlong` : aucune projection ne dépasse la longueur", () => {
        const total = TRACK.length;
        for (const pos of replay()) {
            const s = snapToTrack(TRACK, [pos.coords.longitude, pos.coords.latitude]);
            expect(s!.distanceAlong).toBeLessThanOrEqual(total + 1);
        }
    });
});

describe("resolveHeading", () => {
    it("préfère le cap de la plateforme quand elle en donne un", () => {
        expect(resolveHeading(42, [55, -21], [55.001, -21], 100)).toBeCloseTo(42, 5);
    });

    it("traite NaN comme une absence, pas comme un cap", () => {
        // 🛑 Some hosts return NaN rather than null. A single NaN reaching a
        // camera rotation makes it DISAPPEAR — a defect that reads "the map crashed".
        expect(resolveHeading(Number.NaN, null, [55, -21], 0)).toBeNull();
    });

    it("se rabat sur le cap entre deux relevés", () => {
        // Due east: turf returns 90.
        const h = resolveHeading(null, [55.0, -21.0], [55.01, -21.0], 100);
        expect(h).toBeCloseTo(90, 0);
    });

    it("s'abstient sous le plancher de distance plutôt que de rendre du bruit", () => {
        // At a standstill, a heading computed between two fixes SPINS.
        // Abstaining lets the caller keep the last known heading — a map that
        // does not move, instead of one that twirls.
        expect(resolveHeading(null, [55, -21], [55.00001, -21], 1)).toBeNull();
    });

    it("plie le cap dans [0, 360) — et c'est ce qui manquait le plus", () => {
        // 🛑 turf answers in (-180, 180]. Passing the negative form to a camera
        // puts it half a turn off for EVERY westward heading: it reads "broken
        // compass", it is an unconverted convention.
        const west = resolveHeading(null, [55.0, -21.0], [54.99, -21.0], 100);
        expect(west).toBeGreaterThanOrEqual(0);
        expect(west).toBeCloseTo(270, 0);
        expect(normaliseDegrees(-90)).toBe(270);
        expect(normaliseDegrees(450)).toBe(90);
    });

    it("la trace porte bien des relevés SANS cap — sinon le repli ne serait jamais exercé", () => {
        // The harness's witness. A trace whose every fix carries a heading
        // would leave the fallback uncovered while keeping the suite green.
        const missing = traceFixes.filter((f) => f.heading === null).length;
        expect(missing).toBeGreaterThan(0);
        expect(positionAt(0).coords.heading).toBeNull();
    });
});
