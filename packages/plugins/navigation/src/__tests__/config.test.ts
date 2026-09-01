/**
 * @geoleaf-plugins/navigation — configuration reader
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

const { getPluginConfig } = await import("../config.js");

beforeEach(() => {
    _branch = null;
    _raw = {};
});

describe("@geoleaf-plugins/navigation — getPluginConfig", () => {
    it("reads `modules.navigation`, and no other branch", () => {
        getPluginConfig();
        // INV-CONFIG: one plugin, one branch. A plugin that reads its config in one place and
        // obeys another renders a control that never appears, with nothing in the output saying
        // why — the defect measured on a scaffolded plugin on 08/08/2026.
        expect(_branch).toBe("modules.navigation");
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

// ─────────────────────────────────────────────────────────────────────────────
// The guidance thresholds. Added BELOW the existing tests, which pass
// unchanged.
// ─────────────────────────────────────────────────────────────────────────────

describe("les seuils, et ce qu'une valeur aberrante ne doit PAS faire", () => {
    beforeEach(() => {
        _raw = {};
    });

    it("rend les six seuils du runtime, plus la voix et l'écran", () => {
        const c = getPluginConfig();
        expect(c.arrivalRadiusMetres).toBe(30);
        expect(c.offRouteThresholdMetres).toBe(40);
        expect(c.confirmExit).toBe(3);
        expect(c.confirmReturn).toBe(2);
        expect(c.retryAfterFixes).toBe(2);
        expect(c.maxRetryFixes).toBe(8);
        expect(c.voiceAnnounceAtMetres).toBe(200);
        expect(c.voiceEnabled).toBe(true);
        expect(c.keepScreenAwake).toBe(true);
    });

    it("🛑 le seuil de sortie est PLUS LARGE que le rayon d'arrivée", () => {
        // A vehicle parked at a delivery is routinely farther from the road
        // than from the waypoint. If the two thresholds cross, every arrival
        // reads as an off-route exit — and the guidance recomputes at the
        // precise moment the user has arrived.
        const c = getPluginConfig();
        expect(c.offRouteThresholdMetres).toBeGreaterThan(c.arrivalRadiusMetres);
    });

    it("honore une valeur légitime d'un profil", () => {
        _raw = { arrivalRadiusMetres: 15, confirmExit: 5 };
        const c = getPluginConfig();
        expect(c.arrivalRadiusMetres).toBe(15);
        expect(c.confirmExit).toBe(5);
        // And the others keep their default: a partial profile erases nothing.
        expect(c.confirmReturn).toBe(2);
    });

    it("🛑 `confirmExit: 0` retombe sur le défaut — zéro n'est pas une confirmation plus courte", () => {
        // It is the ABSENCE of confirmation: every noisy fix would become a
        // confirmed exit, hence a provider request, hence a quota emptied in minutes.
        _raw = { confirmExit: 0 };
        expect(getPluginConfig().confirmExit).toBe(3);
    });

    it("refuse le négatif, le zéro, le non-fini et le non-nombre — chacun retombe", () => {
        // A negative arrival radius makes the arrival UNREACHABLE: the
        // guidance never ends, and nothing says so.
        for (const bad of [-5, 0, Number.NaN, Number.POSITIVE_INFINITY, "30", null]) {
            _raw = { arrivalRadiusMetres: bad };
            expect(getPluginConfig().arrivalRadiusMetres).toBe(30);
        }
    });

    it("ne LÈVE pas sur une valeur aberrante — la carte survit à une coquille", () => {
        // A profile is written by hand, sometimes months before anyone drives
        // with it. Throwing would take down the whole map for a comfort setting.
        _raw = { confirmExit: -1, offRouteThresholdMetres: "loin", maxRetryFixes: null };
        expect(() => getPluginConfig()).not.toThrow();
    });

    it("🛑 relève `maxRetryFixes` sous `retryAfterFixes` — ce n'est PAS hors bornes", () => {
        // Each value is individually valid; only their RELATION is wrong. Left
        // as-is, the wait would shrink at each failure instead of growing —
        // the exact opposite of what spacing is for.
        _raw = { retryAfterFixes: 6, maxRetryFixes: 2 };
        const c = getPluginConfig();
        expect(c.maxRetryFixes).toBe(6);
        expect(c.maxRetryFixes).toBeGreaterThanOrEqual(c.retryAfterFixes);
    });

    it("le contrôle de relation passe APRÈS celui des bornes", () => {
        // An aberrant ceiling is first brought back to its default (8), and
        // THAT default is then compared to the floor. Doing the opposite would
        // compare a value about to be discarded.
        _raw = { retryAfterFixes: 4, maxRetryFixes: -3 };
        expect(getPluginConfig().maxRetryFixes).toBe(8);
    });

    it("les trois clés de caméra ont leurs défauts", () => {
        _raw = {};
        const c = getPluginConfig();
        expect(c.followZoom).toBe(17.5);
        expect(c.followPitch).toBe(60);
        expect(c.cameraMaxTransitionMs).toBe(1000);
    });

    it("🛑 un PLAFOND dépassé retombe sur le défaut — ce n'est pas un réglage, c'est une limite du moteur", () => {
        // A pitch of 95 or a zoom of 40 is not an aggressive setting: it is a number the
        // renderer refuses. Honouring it would hand MapLibre a camera it cannot build, on the
        // say-so of a typo in a comfort setting.
        _raw = { followPitch: 95, followZoom: 40, cameraMaxTransitionMs: 60000 };
        const c = getPluginConfig();
        expect(c.followPitch).toBe(60);
        expect(c.followZoom).toBe(17.5);
        expect(c.cameraMaxTransitionMs).toBe(1000);
    });

    it("un pitch de ZÉRO est honoré — à plat est une inclinaison, pas une valeur hors bornes", () => {
        _raw = { followPitch: 0 };
        expect(getPluginConfig().followPitch).toBe(0);
    });

    it("une valeur de caméra sous le plancher retombe aussi", () => {
        _raw = { followZoom: 0, cameraMaxTransitionMs: -5 };
        const c = getPluginConfig();
        expect(c.followZoom).toBe(17.5);
        expect(c.cameraMaxTransitionMs).toBe(1000);
    });

    it("🛑 `CameraOptions` n'a AUCUN membre optionnel — la source le prouve", async () => {
        // This is the invariant that actually broke. `zoom` was optional AND unset by the only
        // caller, so guidance framed nothing: the camera tilted and turned at whatever zoom the
        // user happened to be on, for the whole journey. An optional knob nobody sets is
        // indistinguishable from a knob that does not work — and no test could see it, because
        // "the default is elsewhere" and "there is no default" read the same from inside.
        const { readFileSync } = await import("node:fs");
        const { fileURLToPath } = await import("node:url");
        const { dirname, join } = await import("node:path");
        const src = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "camera.ts"),
            "utf8"
        );
        const body = src.slice(
            src.indexOf("export interface CameraOptions"),
            src.indexOf("interface CameraCapableMap")
        );
        expect(body).not.toBe("");
        expect(body).not.toMatch(/readonly\s+\w+\?:/);
    });

    it("aucun module du moteur NI DE L'INTERFACE ne redéclare un seuil — la valeur vit ICI, une seule fois", async () => {
        // 🛑 The rule that makes this table trustworthy. A default written both
        // here and in the module that reads it diverges with nothing turning
        // red, on a quantity nobody re-measures because both sides look authoritative.
        const { readFileSync, readdirSync } = await import("node:fs");
        const { fileURLToPath } = await import("node:url");
        const { dirname, join } = await import("node:path");
        // ⚠️ A resolved path, not a `URL` passed to `readdirSync`: under
        // vitest, the module is transformed and the URL does not always point
        // to a file on disk.
        // 🛑 `ui` is scanned too, and its absence is what let the defect through. The guard
        // existed, it was trusted, and its corpus stopped one directory short: `ui/camera.ts`
        // held a hard-coded pitch of 50 and a hard-coded transition ceiling for as long as the
        // rule has existed, in plain sight, under a green test. A guard is only as wide as what
        // it reads.
        const root = join(dirname(fileURLToPath(import.meta.url)), "..");
        const offenders: string[] = [];
        const files = ["engine", "ui"].flatMap((d) =>
            readdirSync(join(root, d)).map((f) => join(d, f))
        );
        for (const f of files) {
            if (!f.endsWith(".ts")) continue;
            const src = readFileSync(join(root, f), "utf8");
            // A default set on a threshold parameter: `= 30`, `?? 40`…
            for (const key of [
                "arrivalRadius",
                "offRouteThreshold",
                "confirmExit",
                "confirmReturn",
                "retryAfterFixes",
                "maxRetryFixes",
                "followZoom",
                "followPitch",
                "cameraMaxTransitionMs",
            ]) {
                if (new RegExp(`${key}\\w*\\s*[:?]?[^,;)]*[=?]{1,2}\\s*\\d`).test(src)) {
                    offenders.push(`${f} → ${key}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
