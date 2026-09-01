/**
 * Unit tests — the interface wiring: `nextManeuver` and `attachSessionView`.
 *
 * 🛑 These two modules exist because nothing wired `ui/`. The tests that follow
 * are written to turn red on the precise defect that had escaped: a banner not
 * in the DOM, a camera no sample reaches, a subscription surviving the stop.
 *
 * No WebGL: the map is doubled through the `getNativeMap` seam.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RouteLeg, RouteStep } from "@geoleaf-plugins/routing";
import type { GuidanceViewListener } from "../guidance-contract.js";

const { tLabelMock, getNativeMapMock, getGeoLeafMock } = vi.hoisted(() => ({
    tLabelMock: vi.fn(),
    getNativeMapMock: vi.fn(),
    // ⚠️ No implementation: `vi.fn(() => undefined)` would PIN the return type to
    // `undefined`, and every `mockReturnValue({ UI, Core })` below would then be a type
    // error — a doubled host is the whole point of this mock.
    getGeoLeafMock: vi.fn(),
}));
vi.mock("@geoleaf/host-runtime", () => ({
    tLabel: (...a: unknown[]) => tLabelMock(...a),
    getNativeMap: () => getNativeMapMock(),
    // ⚠️ `getGeoLeaf` and `Log` are reached by `ui/immersive.ts` and `ui/position-arrow.ts`.
    // A factory that omits a symbol the module graph imports fails at RESOLUTION, not on an
    // assertion — so the whole file goes red with a message about the mock, never about the
    // behaviour. Kept explicit rather than auto-mocked for exactly that reason.
    getGeoLeaf: () => getGeoLeafMock(),
    Log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    // Reached by `ui/announcer.ts`, pulled in by `session-view.ts`. Same lesson as the two above:
    // a factory missing a symbol the graph imports fails at RESOLUTION, so the file goes red
    // about the mock and never about the behaviour.
    getActiveLang: () => "fr",
}));

const { nextManeuver } = await import("../engine/maneuver.js");
const { attachSessionView } = await import("../ui/session-view.js");

/**
 * A camera framing, as `session.ts` resolves it from the profile.
 *
 * ⚠️ Written here rather than defaulted in `camera.ts`: `config.ts` is the ONE place a
 * threshold of this plugin receives a value, and a default in the module that reads it would
 * diverge from the schema without anything turning red.
 */
const CAM = { pitch: 60, zoom: 17.5, maxTransitionMs: 1000 } as const;
/** Announcement settings, as `session.ts` resolves them. Off by default: the suites that care
 *  about speech turn it on, and jsdom has no `speechSynthesis` to speak with anyway. */
const VOICE = { enabled: false, announceAtMetres: 200 } as const;

/** A normalised step. */
function step(distance: number, over: Record<string, unknown> = {}): RouteStep {
    return {
        distance,
        duration: distance / 10,
        name: "Rue de la Paix",
        maneuver: "turn",
        modifier: "left",
        location: [55, -21],
        ...over,
    } as unknown as RouteStep;
}

/** A leg of three steps, plus the arrival: 100 m, 400 m, 500 m, then `arrive` at 0. */
function leg(): RouteLeg {
    return {
        distance: 1000,
        duration: 100,
        steps: [
            step(100, { maneuver: "depart", modifier: undefined }),
            step(400),
            step(500, { modifier: "right" }),
            step(0, { maneuver: "arrive", modifier: undefined }),
        ],
    } as unknown as RouteLeg;
}

describe("nextManeuver — la manœuvre est la borne SUIVANTE, jamais celle du pas courant", () => {
    it("annonce la manœuvre à venir, pas celle qu'on vient de prendre", () => {
        // At 50 m we are in step 0 (`depart`, 0→100). What must be announced is
        // step 1's turn, 50 m away. Reading the CURRENT step's maneuver would
        // announce "depart" for the whole first street — the defect this test pins.
        const a = nextManeuver(leg(), 50, 1000);
        expect(a.stepIndex).toBe(0);
        expect(a.step?.maneuver).toBe("turn");
        expect(a.distanceToManeuver).toBeCloseTo(50, 6);
    });

    it("décrémente à mesure qu'on approche, sans changer d'annonce", () => {
        const far = nextManeuver(leg(), 10, 1000);
        const near = nextManeuver(leg(), 90, 1000);
        expect(far.step).toEqual(near.step);
        expect(near.distanceToManeuver).toBeLessThan(far.distanceToManeuver);
        expect(near.distanceToManeuver).toBeCloseTo(10, 6);
    });

    it("🛑 sur la borne exacte, la manœuvre est ICI et non derrière", () => {
        // `>` and not `>=`. With `>=`, step 1 would no longer be "upcoming" at
        // exactly 100 m, we would move to step 2, and the banner would skip one
        // announcement at EVERY turn — a one-sample flicker nobody reproduces by hand.
        const a = nextManeuver(leg(), 100, 1000);
        expect(a.stepIndex).toBe(1);
        expect(a.step?.modifier).toBe("right");
        expect(a.distanceToManeuver).toBeCloseTo(400, 6);
    });

    it("annonce l'arrivée par la même règle, sans cas particulier", () => {
        // The `arrive` step has zero distance, so its bound falls at the leg's end.
        const a = nextManeuver(leg(), 900, 1000);
        expect(a.step?.maneuver).toBe("arrive");
        expect(a.distanceToManeuver).toBeCloseTo(100, 6);
    });

    it("🛑 remet les étapes à l'échelle de la ligne MESURÉE", () => {
        // The provider declares 1000 m of steps; the decoded line measures 1100.
        // Without rescaling, the distance to the maneuver and the leg remainder
        // — the same figure, on the same screen — would diverge by 10%.
        const a = nextManeuver(leg(), 0, 1100);
        expect(a.distanceToManeuver).toBeCloseTo(110, 6);
    });

    it("un tronçon sans étapes ne jette pas — il n'a rien à annoncer", () => {
        const empty = { distance: 0, duration: 0, steps: [] } as unknown as RouteLeg;
        const a = nextManeuver(empty, 0, 0);
        expect(a.step).toBeNull();
        expect(a.distanceToManeuver).toBe(0);
    });

    it("des étapes de longueur nulle ne divisent pas par zéro", () => {
        const flat = {
            distance: 0,
            duration: 0,
            steps: [step(0, { maneuver: "depart" }), step(0, { maneuver: "arrive" })],
        } as unknown as RouteLeg;
        expect(() => nextManeuver(flat, 0, 0)).not.toThrow();
    });
});

describe("attachSessionView — le câblage, vu depuis le DOM", () => {
    /** The container the doubled map returns. */
    let container: HTMLElement;
    /** The movements requested from the map. */
    let moves: Record<string, unknown>[];
    /** The subscriber the doubled runtime received, or `null`. */
    let listener: GuidanceViewListener | null;
    /** How many times we unsubscribed. */
    let unsubscribed: number;

    /** A doubled runtime, reduced to what the view consumes. */
    const source = {
        onView(l: GuidanceViewListener): () => void {
            listener = l;
            return () => {
                unsubscribed += 1;
                listener = null;
            };
        },
    };

    /** A view sample. */
    function view(over: Record<string, unknown> = {}) {
        return {
            step: step(400),
            distanceToManeuver: 250,
            position: [55, -21] as const,
            heading: 90,
            elapsedSeconds: 1,
            ...over,
        } as Parameters<GuidanceViewListener>[0];
    }

    beforeEach(() => {
        document.body.replaceChildren();
        container = document.createElement("div");
        document.body.append(container);
        moves = [];
        listener = null;
        unsubscribed = 0;
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
        // Neutral by default: no immersive seam, no map adapter. Every test that cares about
        // either overrides this — and the ones that do not prove a session still runs on a host
        // that offers neither.
        getGeoLeafMock.mockReturnValue(undefined);
    });

    it("🛑 entre en mode immersif à l'attache, et le rend au détachement", () => {
        // The chrome that hid the banner is the application's, not this plugin's: the theme bar
        // sits at the same pixel with a z-index 501 points higher. Asking the host to strip it
        // is what makes the banner readable — and giving it back is what stops a map that ended
        // guidance twenty minutes ago from still missing its controls.
        const setImmersive = vi.fn();
        getGeoLeafMock.mockReturnValue({ UI: { setImmersive }, Core: { getMap: () => undefined } });
        const v = attachSessionView(source, CAM, VOICE);
        expect(setImmersive).toHaveBeenCalledWith(true, { fullscreen: true });
        v.detach();
        expect(setImmersive).toHaveBeenLastCalledWith(false, { fullscreen: true });
    });

    it("dessine la flèche du conducteur, et la retire avec la session", () => {
        const marker = {
            createMarker: vi.fn(),
            removeMarker: vi.fn(),
            updateMarkerPosition: vi.fn(),
            setMarkerRotation: vi.fn(),
        };
        getGeoLeafMock.mockReturnValue({ UI: {}, Core: { getMap: () => marker } });
        const v = attachSessionView(source, CAM, VOICE);
        listener?.(view());
        expect(marker.createMarker).toHaveBeenCalledTimes(1);
        v.detach();
        expect(marker.removeMarker).toHaveBeenCalledWith("gl-nav-position-arrow");
    });

    it("🛑 la flèche suit la position PROJETÉE, la même que la caméra centre", () => {
        // Feeding it the raw fix instead would drift the driver's marker off the line the map is
        // holding under it: two truths about one position, a metre apart, both on screen.
        const marker = {
            createMarker: vi.fn(),
            removeMarker: vi.fn(),
            updateMarkerPosition: vi.fn(),
            setMarkerRotation: vi.fn(),
        };
        getGeoLeafMock.mockReturnValue({ UI: {}, Core: { getMap: () => marker } });
        attachSessionView(source, CAM, VOICE);
        listener?.(view({ position: [55.5, -21.5] as const }));
        expect(marker.createMarker.mock.calls[0]![1]).toEqual({ lng: 55.5, lat: -21.5 });
        expect(moves[0]).toMatchObject({ center: { lng: 55.5, lat: -21.5 } });
    });

    it("🛑 pose le bandeau DANS le conteneur de la carte", () => {
        // The assertion missing through the whole build-out. A test querying
        // only the API — `isGuiding()`, the emitted states — cannot tell
        // "guidance works" from "guidance works and displays nothing". This one can.
        attachSessionView(source, CAM, VOICE);
        expect(container.querySelector(".gl-nav-banner")).not.toBeNull();
    });

    it("le bandeau naît CACHÉ — rien n'est encore annoncé", () => {
        attachSessionView(source, CAM, VOICE);
        const el = container.querySelector<HTMLElement>(".gl-nav-banner");
        expect(el?.hidden).toBe(true);
    });

    it("un échantillon remplit le bandeau et bouge la caméra", () => {
        attachSessionView(source, CAM, VOICE);
        listener?.(view());

        const el = container.querySelector<HTMLElement>(".gl-nav-banner");
        expect(el?.hidden).toBe(false);
        expect(el?.querySelector(".gl-nav-banner__distance")?.textContent).toBe("250 m");
        expect(el?.querySelector(".gl-nav-banner__road")?.textContent).toBe("Rue de la Paix");
        expect(moves).toHaveLength(1);
        expect(moves[0]).toMatchObject({ bearing: 90 });
    });

    it("🛑 un cap NUL n'oriente pas la carte au nord", () => {
        // The platform removes the heading precisely at a standstill. A
        // `bearing: 0` would swing the map at every red light, and the motion
        // would look deliberate.
        attachSessionView(source, CAM, VOICE);
        listener?.(view({ heading: null }));
        expect(moves[0]).not.toHaveProperty("bearing");
    });

    it("détacher retire le bandeau, désabonne, et rend la carte", () => {
        const v = attachSessionView(source, CAM, VOICE);
        v.detach();
        expect(container.querySelector(".gl-nav-banner")).toBeNull();
        expect(unsubscribed).toBe(1);
        // The last movement puts the map back flat and north-up.
        expect(moves.at(-1)).toMatchObject({ pitch: 0, bearing: 0 });
    });

    it("🛑 détaché, la vue ne reçoit PLUS rien — l'abonnement est réellement rendu", () => {
        // ⚠️ This test first claimed to guard `detach`'s ORDER — unsubscribe
        // before releasing the map. Mutation done: swapping the two lines
        // leaves it GREEN, and it could not be otherwise, nothing being able to
        // emit between two synchronous statements. The claim exceeded its
        // proof; it is brought back to what it shows.
        //
        // What it shows is what matters: a detached view keeping its
        // subscription would retain the banner, the camera and their closure
        // for every remaining fix.
        const v = attachSessionView(source, CAM, VOICE);
        v.detach();
        expect(listener).toBeNull();
        const after = moves.length;
        listener?.(view());
        expect(moves).toHaveLength(after);
    });

    it("détacher deux fois ne jette pas et ne rend pas la carte deux fois", () => {
        const v = attachSessionView(source, CAM, VOICE);
        v.detach();
        const after = moves.length;
        v.detach();
        expect(moves).toHaveLength(after);
        expect(unsubscribed).toBe(1);
    });

    it("🛑 sans carte, le guidage tient quand même — c'est le bandeau qu'on perd", () => {
        // A host without a map, a test without map DOM: the session must
        // start. Refusing to guide because a container is missing would break
        // exactly the setups where the engine itself works perfectly.
        getNativeMapMock.mockReturnValue(undefined);
        const v = attachSessionView(source, CAM, VOICE);
        expect(() => listener?.(view())).not.toThrow();
        expect(() => v.detach()).not.toThrow();
    });
});

describe("🛑 L'avertissement de session — la moitié qui n'est pas juridique", () => {
    // 🛑 The second sentence matters more than the first. Background
    // geolocation is IMPOSSIBLE in a browser, so guidance stops as soon as the
    // page stops being what the screen shows. An operator who does not know
    // this pockets their phone and finds out WHILE DRIVING — at the precise
    // moment they cannot respond. The limit was written in the plugin's spec
    // sheet; it was told to the USER nowhere.
    let container: HTMLElement;
    let moves: Record<string, unknown>[];
    let listener: GuidanceViewListener | null;

    /** A doubled runtime, reduced to what the view consumes. */
    const source = {
        onView(l: GuidanceViewListener): () => void {
            listener = l;
            return () => {
                listener = null;
            };
        },
    };

    beforeEach(() => {
        document.body.replaceChildren();
        container = document.createElement("div");
        document.body.append(container);
        moves = [];
        listener = null;
        tLabelMock.mockImplementation((key: string) => `L:${key}`);
        getNativeMapMock.mockReturnValue({
            getContainer: () => container,
            easeTo: (o: Record<string, unknown>) => moves.push(o),
        });
        // Neutral by default: no immersive seam, no map adapter. Every test that cares about
        // either overrides this — and the ones that do not prove a session still runs on a host
        // that offers neither.
        getGeoLeafMock.mockReturnValue(undefined);
    });

    it("🛑 attacher une vue POSE l'avertissement dans la carte", () => {
        attachSessionView(source, CAM, VOICE);
        expect(container.querySelector(".gl-nav-notice")).not.toBeNull();
    });

    it("il porte les DEUX phrases — la route et l'arrière-plan", () => {
        // One of the two alone is not enough, and the second is the one missing everywhere.
        attachSessionView(source, CAM, VOICE);
        expect(container.querySelector(".gl-nav-notice__road")?.textContent).toBe(
            "L:navigation.notice.road"
        );
        expect(container.querySelector(".gl-nav-notice__background")?.textContent).toBe(
            "L:navigation.notice.background"
        );
    });

    it("🛑 il ne PIÈGE pas le focus — `region`, jamais `alertdialog`", () => {
        // A focus trap at the moment someone is about to drive is the worst
        // possible place to set one.
        attachSessionView(source, CAM, VOICE);
        expect(container.querySelector(".gl-nav-notice")?.getAttribute("role")).toBe("region");
    });

    it("le bouton le retire", () => {
        attachSessionView(source, CAM, VOICE);
        container.querySelector<HTMLButtonElement>(".gl-nav-notice__dismiss")?.click();
        expect(container.querySelector(".gl-nav-notice")).toBeNull();
    });

    it("🛑 le retirer NE COUPE PAS le guidage", () => {
        // The acknowledgement dismisses the warning, not the session. A
        // `start()` held behind a tap would open the watch afterwards, and the
        // FIRST fix — the one placing the driver on the line — would be the
        // one nobody waited for.
        attachSessionView(source, CAM, VOICE);
        container.querySelector<HTMLButtonElement>(".gl-nav-notice__dismiss")?.click();
        listener?.({
            step: null,
            distanceToManeuver: 0,
            position: [55, -21],
            heading: 90,
            elapsedSeconds: 1,
        });
        expect(moves).toHaveLength(1);
    });

    it("détacher la vue retire l'avertissement avec elle", () => {
        // A warning outliving its session warns about a guidance that has ended.
        const v = attachSessionView(source, CAM, VOICE);
        v.detach();
        expect(container.querySelector(".gl-nav-notice")).toBeNull();
    });

    it("une seconde session ne LAISSE PAS deux avertissements", () => {
        attachSessionView(source, CAM, VOICE);
        attachSessionView(source, CAM, VOICE);
        expect(container.querySelectorAll(".gl-nav-notice")).toHaveLength(1);
    });
});
