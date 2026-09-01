/**
 * @geoleaf-plugins/routing — configuration reader
 *
 * `getPluginConfig()` is three lines, and each of the three has already been a defect somewhere
 * in this repository: reading the WRONG profile branch, losing the built-in defaults under a
 * partial override, and dropping keys the current version does not know about. The assertions
 * below pin those three, not the line count.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/** What the mocked core was asked for — the branch is the assertion, not a detail. */
let _branch: string | null = null;
/** What the mocked core answers. `undefined` means "the core returned nothing". */
let _raw: unknown = {};

vi.mock("@geoleaf/host-runtime", () => ({
    coreConfigGet: (path: string) => {
        _branch = path;
        return _raw;
    },
}));

const { getPluginConfig, travelProfile } = await import("../config.js");

beforeEach(() => {
    _branch = null;
    _raw = {};
});

describe("@geoleaf-plugins/routing — getPluginConfig", () => {
    it("reads `modules.routing`, and no other branch", () => {
        getPluginConfig();
        // INV-CONFIG: one plugin, one branch. A plugin that reads its config in one place and
        // obeys another renders a control that never appears, with nothing in the output saying
        // why — the defect measured on a scaffolded plugin on 08/08/2026.
        expect(_branch).toBe("modules.routing");
    });

    it("applies the built-in defaults when the profile says nothing", () => {
        const cfg = getPluginConfig();
        expect(cfg.enabled).toBe(true);
        // `false` on purpose while there is no panel to open: a visible control that does
        // nothing does not announce itself, it gets clicked.
        expect(cfg.showButton).toBe(false);
    });

    it("lets a PARTIAL override win without dropping the other defaults", () => {
        _raw = { showButton: true };
        const cfg = getPluginConfig();
        expect(cfg.showButton).toBe(true);
        expect(cfg.enabled).toBe(true);
    });

    it("keeps a key the current version does not know", () => {
        // Not permissiveness: dropping it at the type boundary would make an unknown key
        // indistinguishable from a typo, and the reader would see neither.
        _raw = { futureKey: 42 };
        expect(getPluginConfig().futureKey).toBe(42);
    });

    it("falls back to the defaults when the core answers `undefined`", () => {
        // This is the `?? {}` branch, and it is not decoration: `coreConfigGet` answers
        // `undefined` on a profile that never mentions this module — the common case, not the
        // edge one. Spreading `undefined` would throw before the defaults were ever applied.
        _raw = undefined;
        const cfg = getPluginConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.showButton).toBe(false);
    });
});

describe("travelProfile — un jeton inconnu RETOMBE, il ne part pas au fournisseur", () => {
    it("rend le mode configuré quand il est connu", () => {
        for (const mode of ["car", "foot", "bike"] as const) {
            _raw = { profile: mode };
            expect(travelProfile(), mode).toBe(mode);
        }
    });

    it("le défaut est la voiture", () => {
        _raw = {};
        expect(travelProfile()).toBe("car");
    });

    it("🛑 un mode INCONNU retombe sur `car` plutôt que d'être transmis", () => {
        // The three engines name their modes differently. Letting an
        // unrecognised token through produces either a provider error or —
        // worse — a route computed for a mode nobody asked for, with nothing
        // on screen to contradict it.
        _raw = { profile: "hovercraft" };
        expect(travelProfile()).toBe("car");
    });

    it("un type qui n'est pas une chaîne retombe aussi", () => {
        _raw = { profile: 42 };
        expect(travelProfile()).toBe("car");
        _raw = { profile: null };
        expect(travelProfile()).toBe("car");
    });
});
