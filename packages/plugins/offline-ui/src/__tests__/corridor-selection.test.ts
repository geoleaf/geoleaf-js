/**
 * Unit tests — the third selection mode and its quota refusal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/** What the database double returns to `_ensureModule("Routes")`. */
let _routes: { listRoutes?: () => Promise<Array<{ id: string; line?: unknown }>> } | null = null;
/** The `Storage.DB` double — `undefined` simulates an absent offline engine. */
let _db: unknown;

vi.mock("../shared/storage-contract.js", () => ({
    StorageContract: {
        get DB() {
            return _db;
        },
    },
}));

const { proposeCorridor } = await import("../cache/corridor-selection.js");

/** A ~10 km line, due east from Réunion. */
function line(points = 30): Array<readonly [number, number]> {
    const span = 10 / (111.32 * Math.cos((-21.09 * Math.PI) / 180));
    return Array.from(
        { length: points },
        (_, i) => [55.4781 + (span * i) / (points - 1), -21.0964] as const
    );
}

beforeEach(() => {
    _routes = { listRoutes: async () => [{ id: "r1", line: line() }] };
    _db = { _ensureModule: (n: string) => (n === "Routes" ? _routes : null) };
});

describe("proposeCorridor — ce qu'il refuse, et comment", () => {
    it("dit `no-engine` quand le moteur hors-ligne n'est pas là", async () => {
        // The `offline` capability is absent or disabled. Not an outage: the mode
        // simply has nothing to exist from, and the UI must be able to keep it
        // quiet.
        _db = undefined;
        expect(await proposeCorridor(500, 12, 14)).toEqual({ ok: false, reason: "no-engine" });
    });

    it("dit `no-route` quand rien n'a été préparé — ce n'est PAS une erreur", async () => {
        _routes = { listRoutes: async () => [] };
        const r = await proposeCorridor(500, 12, 14);
        expect(r).toEqual({ ok: false, reason: "no-route" });
    });

    it("dit `degenerate-line` sur un tracé d'un seul point", async () => {
        // Distinct from `no-route`: an itinerary EXISTS, it just has nothing to
        // form a corridor from. Confusing them would send the user to recompute
        // one that is there.
        _routes = { listRoutes: async () => [{ id: "r1", line: [[55, -21]] }] };
        expect((await proposeCorridor(500, 12, 14)).ok).toBe(false);
        expect(await proposeCorridor(500, 12, 14)).toMatchObject({ reason: "degenerate-line" });
    });

    it("écarte les points malformés du tracé persisté", async () => {
        // The store is opaque: it returns what was put in. A truncated point must
        // disappear, not produce `NaN`s that would climb into an absurd tile
        // count.
        _routes = {
            listRoutes: async () => [{ id: "r1", line: [...line(4), [55.5], "x", null] }],
        };
        const r = await proposeCorridor(500, 13, 13);
        expect(r.ok).toBe(true);
        if (r.ok) expect(Number.isFinite(r.selection.tiles)).toBe(true);
    });

    it("propose un corridor mesuré quand tout va bien", async () => {
        const r = await proposeCorridor(500, 12, 14);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.selection.routeId).toBe("r1");
            expect(r.selection.tiles).toBeGreaterThan(0);
            expect(r.selection.bytes).toBeGreaterThan(0);
        }
    });

    it("🛑 NE refuse PAS quand le quota est inconnu", async () => {
        // Refusing on an unknown would block a download that would have fit. The
        // default is thus `Infinity`, and it is explicit rather than being the
        // absence of a check.
        const r = await proposeCorridor(500, 12, 16);
        expect(r.ok).toBe(true);
    });
});

describe("🛑 le refus de quota nomme SES DEUX LEVIERS, mesurés", () => {
    it("refuse au-delà du quota", async () => {
        const r = await proposeCorridor(500, 12, 16, 1024);
        expect(r).toMatchObject({ ok: false, reason: "over-quota" });
    });

    it("nomme le zoom ET le tampon", async () => {
        // A refusal saying "too large" without saying what to lower is not
        // actionable: the reader sees a wall, not a dial.
        const r = await proposeCorridor(500, 12, 16, 1024);
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.levers?.map((l) => l.kind).sort()).toEqual(["buffer", "zoom"]);
        }
    });

    it("🛑 chaque levier porte le POIDS qu'il rendrait, pas une exhortation", async () => {
        // "Lower the zoom" leaves estimating a gain one has no way to know;
        // "zoom 15 → 220 MB" compares to what is left. Same lesson as the
        // step-cap refusal: a refusal not carrying its limit is not actionable.
        const r = await proposeCorridor(500, 12, 16, 1024);
        expect(r.ok).toBe(false);
        if (!r.ok) {
            for (const lever of r.levers ?? []) {
                expect(lever.bytes).toBeGreaterThan(0);
                expect(Number.isFinite(lever.to)).toBe(true);
            }
        }
    });

    it("le levier de zoom coûte MOINS que le levier de tampon — et les deux sont montrés", async () => {
        // One zoom less divides tiles by ~4, halving the buffer by ~2. Showing
        // only the most effective would lower the resolution for someone who
        // would have preferred a narrower corridor — their arbitration, not
        // ours.
        const r = await proposeCorridor(500, 12, 16, 1024);
        expect(r.ok).toBe(false);
        if (!r.ok) {
            const zoom = r.levers?.find((l) => l.kind === "zoom");
            const buffer = r.levers?.find((l) => l.kind === "buffer");
            // ⚠️ No non-null assertion: the repo's ratchet is decreasing, and a
            // `!` here would mean "I know it is there", while that is precisely
            // what the test establishes. Comparing bytes through `?? -1` fails
            // the assertion if one is missing, which is the wanted behaviour.
            expect(zoom?.kind).toBe("zoom");
            expect(buffer?.kind).toBe("buffer");
            expect(zoom?.bytes ?? Number.POSITIVE_INFINITY).toBeLessThan(buffer?.bytes ?? -1);
        }
    });

    it("N'OFFRE PAS de baisser le zoom quand la plage est déjà d'un seul niveau", async () => {
        // Proposing to go below the floor would yield an EMPTY corridor, i.e. a
        // download that "succeeds" downloading nothing.
        const r = await proposeCorridor(500, 14, 14, 1);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.levers?.some((l) => l.kind === "zoom")).toBe(false);
    });

    it("n'offre pas non plus un tampon qui ne descend pas", async () => {
        const r = await proposeCorridor(1, 14, 14, 1);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.levers).toEqual([]);
    });
});
