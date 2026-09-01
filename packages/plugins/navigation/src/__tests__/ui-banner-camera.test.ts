/**
 * Unit tests — maneuver banner, labels, follow camera.
 *
 * 🛑 No network calls, no WebGL. The map is doubled through the `getNativeMap` seam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const { createManeuverBanner, cssToken } = await import("../ui/maneuver-banner.js");
const { maneuverLabel, formatApproachDistance } = await import("../ui/maneuver-labels.js");
const { createFollowCamera } = await import("../ui/camera.js");

/**
 * A camera framing, as `session.ts` resolves it from the profile.
 *
 * ⚠️ Written here rather than defaulted in `camera.ts`: `config.ts` is the ONE place a
 * threshold of this plugin receives a value, and a default in the module that reads it would
 * diverge from the schema without anything turning red.
 */
const CAM = { pitch: 60, zoom: 17.5, maxTransitionMs: 1000 } as const;

/** A normalised step, as `routing` returns it. */
function step(over: Record<string, unknown> = {}) {
    return {
        distance: 400,
        duration: 40,
        name: "Rue de la Paix",
        maneuver: "turn",
        modifier: "left",
        location: [55, -21] as const,
        ...over,
    } as unknown as import("@geoleaf-plugins/routing").RouteStep;
}

describe("cssToken", () => {
    it("🛑 réduit un modifier À ESPACE en un seul jeton", () => {
        // An OSRM modifier contains a space. In a class name, the space
        // creates a SECOND class: `--slight left` applies `--slight` and
        // `left`. One does not exist, the other could exist elsewhere — not cosmetic.
        expect(cssToken("slight left")).toBe("slight-left");
        expect(cssToken("SHARP  RIGHT")).toBe("sharp-right");
    });

    it("rend `unknown` sur le vide plutôt qu'une classe qui se termine par un tiret", () => {
        expect(cssToken("")).toBe("unknown");
        expect(cssToken(undefined)).toBe("unknown");
        expect(cssToken("  -- ")).toBe("unknown");
    });
});

describe("maneuverLabel", () => {
    beforeEach(() => tLabelMock.mockReset());

    it("compose la clé depuis manœuvre ET modifier quand la manœuvre est directionnelle", () => {
        tLabelMock.mockImplementation((k: string) =>
            k === "navigation.maneuver.turn.left" ? "Tournez à gauche" : ""
        );
        expect(maneuverLabel("turn", "left")).toBe("Tournez à gauche");
    });

    it("normalise le modifier AVANT d'indexer — sinon la clé ne résout pas", () => {
        // 🛑 And it is the worst case: the unresolved key yields the fallback,
        // which the user reads as a correct instruction. A generic sentence
        // believed exact is worse than a blank, which is visible.
        tLabelMock.mockImplementation((k: string) =>
            k === "navigation.maneuver.turn.slight-left" ? "Serrez à gauche" : ""
        );
        expect(maneuverLabel("turn", "slight left")).toBe("Serrez à gauche");
    });

    it("ignore le modifier sur une manœuvre non directionnelle", () => {
        tLabelMock.mockImplementation((k: string) =>
            k === "navigation.maneuver.arrive" ? "Arrivée" : ""
        );
        expect(maneuverLabel("arrive", "left")).toBe("Arrivée");
    });

    it("se rabat sur `unknown` — nommé, jamais sur le jeton brut", () => {
        // Showing `fork` would put an English machine word in a French banner;
        // showing nothing would leave a distance counting down to a blank,
        // which reads as a bug at the precise moment the screen must be trusted.
        tLabelMock.mockImplementation((k: string) =>
            k === "navigation.maneuver.unknown" ? "Poursuivez" : ""
        );
        expect(maneuverLabel("teleport", "sideways")).toBe("Poursuivez");
    });

    it("traite « la clé rendue telle quelle » comme une absence", () => {
        // Some hosts return the KEY when nothing matches. A banner displaying
        // `navigation.maneuver.fork.sharp-left` is the most alarming way to say "unknown".
        tLabelMock.mockImplementation((k: string) =>
            k === "navigation.maneuver.unknown" ? "Poursuivez" : k
        );
        expect(maneuverLabel("fork", "sharp left")).toBe("Poursuivez");
    });
});

describe("formatApproachDistance", () => {
    it("arrondit par bandes — un conducteur lit d'un coup d'œil", () => {
        expect(formatApproachDistance(437, "m", "km")).toBe("450 m");
        expect(formatApproachDistance(96, "m", "km")).toBe("100 m");
        expect(formatApproachDistance(42, "m", "km")).toBe("40 m");
    });

    it("passe au kilomètre au-delà de 1000", () => {
        expect(formatApproachDistance(2340, "m", "km")).toContain("km");
    });

    it("rend une chaîne vide sur une valeur qui n'est pas une distance", () => {
        expect(formatApproachDistance(Number.NaN, "m", "km")).toBe("");
        expect(formatApproachDistance(-5, "m", "km")).toBe("");
    });
});

describe("createManeuverBanner", () => {
    const labels = {
        maneuver: (m: string, d: string | undefined) => `${m}/${d ?? "-"}`,
        distance: (n: number) => `${n} m`,
    };

    it("naît CACHÉ — rien à annoncer n'est pas la même chose qu'un bandeau vide", () => {
        expect(createManeuverBanner(labels).element.hidden).toBe(true);
    });

    it("est une région vivante `polite`, pas `assertive`", () => {
        // The next maneuver must reach a screen reader without it going to
        // fetch it, but without interrupting what it is reading.
        const b = createManeuverBanner(labels);
        expect(b.element.getAttribute("role")).toBe("status");
        expect(b.element.getAttribute("aria-live")).toBe("polite");
    });

    it("affiche distance, manœuvre et route, et se montre", () => {
        const b = createManeuverBanner(labels);
        b.update({ step: step(), distanceMetres: 400 });
        expect(b.element.hidden).toBe(false);
        expect(b.element.querySelector(".gl-nav-banner__distance")!.textContent).toBe("400 m");
        expect(b.element.querySelector(".gl-nav-banner__maneuver")!.textContent).toBe("turn/left");
        expect(b.element.querySelector(".gl-nav-banner__road")!.textContent).toBe("Rue de la Paix");
    });

    it("🛑 un nom de route MALVEILLANT reste du TEXTE, il ne devient pas un élément", () => {
        // The content comes from a provider, hence from data nobody here
        // controls. `textContent` makes escaping unnecessary rather than
        // forgotten: a string assigned this way cannot become an element, an
        // attribute or a handler, whatever it contains.
        const b = createManeuverBanner(labels);
        b.update({ step: step({ name: '<img src=x onerror="alert(1)">' }), distanceMetres: 100 });
        const road = b.element.querySelector(".gl-nav-banner__road")!;
        expect(road.querySelector("img")).toBeNull();
        expect(road.textContent).toBe('<img src=x onerror="alert(1)">');
    });

    it("🛑 le module n'écrit JAMAIS `innerHTML` — la garantie est structurelle", async () => {
        // A rule written in a comment is bypassed in one line. This test reads
        // the source: the day someone adds an `innerHTML`, it turns red and they read why.
        const { readFileSync } = await import("node:fs");
        const { fileURLToPath } = await import("node:url");
        const { dirname, join } = await import("node:path");
        const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "ui");
        for (const f of ["maneuver-banner.ts", "maneuver-labels.ts"]) {
            const src = readFileSync(join(dir, f), "utf8");
            expect(src).not.toMatch(/\.innerHTML\s*=/);
            expect(src).not.toMatch(/insertAdjacentHTML/);
        }
    });

    it("compose les classes d'icône depuis manœuvre ET modifier, normalisés", () => {
        const b = createManeuverBanner(labels);
        b.update({ step: step({ maneuver: "turn", modifier: "slight left" }), distanceMetres: 50 });
        const cls = b.element.querySelector(".gl-nav-banner__icon")!.className;
        expect(cls).toContain("gl-nav-banner__icon--turn");
        expect(cls).toContain("gl-nav-banner__icon--slight-left");
        expect(cls).not.toContain("--slight left");
    });

    it("n'ajoute PAS de classe de modifier quand il n'y en a pas", () => {
        const b = createManeuverBanner(labels);
        b.update({ step: step({ maneuver: "arrive", modifier: undefined }), distanceMetres: 10 });
        const cls = b.element.querySelector(".gl-nav-banner__icon")!.className;
        expect(cls).toBe("gl-nav-banner__icon gl-nav-banner__icon--arrive");
    });

    it("se recache quand il n'y a plus rien à annoncer", () => {
        const b = createManeuverBanner(labels);
        b.update({ step: step(), distanceMetres: 400 });
        b.update({ step: null, distanceMetres: 0 });
        expect(b.element.hidden).toBe(true);
    });

    it("`destroy` est idempotent", () => {
        const b = createManeuverBanner(labels);
        b.destroy();
        expect(() => b.destroy()).not.toThrow();
    });
});

describe("createFollowCamera", () => {
    beforeEach(() => getNativeMapMock.mockReset());
    afterEach(() => vi.clearAllMocks());

    it("ne jette pas quand il n'y a pas de carte", () => {
        getNativeMapMock.mockReturnValue(null);
        const c = createFollowCamera(CAM);
        expect(() => c.follow([55, -21], 90, 1)).not.toThrow();
        expect(() => c.release()).not.toThrow();
    });

    it("centre, oriente et incline en UN SEUL mouvement", () => {
        const easeTo = vi.fn();
        getNativeMapMock.mockReturnValue({ easeTo });
        createFollowCamera(CAM).follow([55, -21], 90, 1);
        const m = easeTo.mock.calls[0]![0];
        expect(m.center).toEqual({ lng: 55, lat: -21 });
        expect(m.bearing).toBe(90);
        expect(m.pitch).toBe(CAM.pitch);
        // 🛑 The zoom is the reason this assertion exists. It used to be optional AND unset by
        // the only caller, so guidance framed nothing: the camera tilted and turned at whatever
        // zoom the user happened to be on. An optional knob nobody sets is indistinguishable
        // from a knob that does not work — pinning it here is what makes the difference visible.
        expect(m.zoom).toBe(CAM.zoom);
        expect(m.essential).toBe(true);
    });

    it("🛑 OMET `bearing` sans cap — il ne le met PAS à zéro", () => {
        // The device removes `heading` precisely at a standstill. Setting 0
        // would swing the map due north at every red light, then back on
        // moving off: it would oscillate.
        const easeTo = vi.fn();
        getNativeMapMock.mockReturnValue({ easeTo });
        createFollowCamera(CAM).follow([55, -21], null, 1);
        expect(easeTo.mock.calls[0]![0]).not.toHaveProperty("bearing");
    });

    it("🛑 PLAFONNE la transition — sinon le retard s'accumule à chaque relevé", () => {
        // A movement lasting longer than the interval is still running when
        // the next begins: each arrives late, and the camera lags more and more.
        const easeTo = vi.fn();
        getNativeMapMock.mockReturnValue({ easeTo });
        const c = createFollowCamera({ ...CAM, maxTransitionMs: 800 });
        c.follow([55, -21], 0, 30);
        expect(easeTo.mock.calls[0]![0].duration).toBe(800);
        c.follow([55, -21], 0, 0.4);
        expect(easeTo.mock.calls[1]![0].duration).toBe(400);
    });

    it("rend la carte à plat et plein nord", () => {
        const easeTo = vi.fn();
        getNativeMapMock.mockReturnValue({ easeTo });
        createFollowCamera(CAM).release();
        expect(easeTo.mock.calls[0]![0]).toMatchObject({ pitch: 0, bearing: 0 });
    });

    it("🛑 n'ouvre AUCUNE boucle de rendu — la source le prouve", async () => {
        // A `requestAnimationFrame` would wake the GPU sixty times a second
        // for the whole trip, on a phone already holding a wake lock and a GPS
        // watch, in a car, often unplugged. It is this plugin's most effective
        // economy measure, and it is only free while nobody puts the loop back
        // "for smoothness".
        const { readFileSync } = await import("node:fs");
        const { fileURLToPath } = await import("node:url");
        const { dirname, join } = await import("node:path");
        const src = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "camera.ts"),
            "utf8"
        );
        expect(src).not.toMatch(/requestAnimationFrame\s*\(/);
        expect(src).not.toMatch(/setInterval\s*\(/);
    });
});
