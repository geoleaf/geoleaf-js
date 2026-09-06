/**
 * @file internal-member-migration.guard.test.js
 * @description Guard test — every public route named by
 * `docs/reference/consumers/INTERNAL_MEMBER_MIGRATION.md` actually RESOLVES on the
 * namespace, and every internal member it names still exists.
 *
 * Why this guard exists (04/09/2026)
 * -------------------------------------------
 * That page tells an integrator which public path replaces an internal `_`
 * member. Unverified, it is exactly the artefact its own subject warns about: a
 * prose note ABOUT a surface, which cannot go red when the surface moves. A page
 * that says "use `Layers.isVisible` instead" and is wrong is worse than no page —
 * the reader migrates onto something that is not there, and finds out at runtime.
 *
 * So the page is held to the SAME oracle the consumption contract uses
 * (`scripts/lib/namespace-surface.mjs`): the frozen facade keys and their frozen
 * depth-2 members.
 *
 * ## Which half of the chain this is — measured, not assumed
 *
 * It closes ONE link: **table ↔ frozen surface**. Rename or drop a path in the
 * table and it turns red naming the row. It does NOT see a member removed from
 * the runtime facade while the frozen list still carries it — verified by
 * mutation on 04/09/2026: deleting `syncLayerControl` from `buildPublicApi()`
 * left this guard green and turned `boot-golden-master` red, which is the other
 * link, **runtime ↔ frozen surface**. Both being gated is what makes
 * table ↔ runtime hold transitively; neither one alone would.
 *
 * Written down because the reverse assumption is the natural one, and a guard
 * credited with a reach it does not have is how a gap stays invisible.
 *
 * ## What it does NOT verify
 *
 * The **truth of the motive column**. That a route renders the same service as
 * the internal member it replaces is a judgement, and no oracle carries it —
 * the same partition `CLAUDE.md` draws between what a machine checks and what
 * re-reading must.
 *
 * 🛑 And on the internal side, verification stops at the HEAD for `_`-prefixed
 * members at depth 2: the surface oracle drops any `_`-prefixed member **by
 * construction**, so `_GeoJSONLoader._loadSingleLayer` can be neither confirmed
 * nor denied by it. Named here rather than silently skipped — it is the same
 * limit the consumption contract declares at each run, and the very reason that
 * member needed a public route rather than a measurement.
 *
 * ## A guard never seen red guards nothing
 *
 * Three anti-empty-guard assertions: no rows parsed, no public routes parsed, or
 * an empty oracle each make this THROW rather than come out green.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `scripts/lib/` is tooling and ships no declarations, so this import is the one
// thing here TypeScript cannot check. The suppression is narrow — one line, this
// module only — and the three shapes are named immediately below rather than
// left as `any`, so a change in what the oracle exports surfaces as a type error
// at the use sites. Shipping a `.d.mts` beside the oracle was the alternative and
// was declined: it would be a SECOND description of exports that already exist,
// free to drift from them, which is the defect that file's own header exists to
// warn about.
// @ts-expect-error — untyped tooling module, shapes asserted on the next lines
const oracle = (await import("../../../../scripts/lib/namespace-surface.mjs")) as {
    EXPECTED_FACADE_KEYS: string[];
    EXPECTED_FACADE_MEMBERS: Record<string, string[]>;
    DEPTH2_FACADES: string[];
};
const { EXPECTED_FACADE_KEYS, EXPECTED_FACADE_MEMBERS, DEPTH2_FACADES } = oracle;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DOC = path.join(REPO_ROOT, "docs/reference/consumers/INTERNAL_MEMBER_MIGRATION.md");

/** A backticked `Foo` or `Foo.bar`, optionally written as a call — `Foo.bar()`. */
const PATH_RE = /`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)(?:\([^`]*\))?`/g;

/** One row of the migration table, as this guard reads it. */
interface MigrationRow {
    internal: string;
    routes: string[];
    motive: string;
}

/** Every `| a | b | c |` row of the table, header and separator excluded. */
function readRows(markdown: string): MigrationRow[] {
    const rows: MigrationRow[] = [];
    for (const line of markdown.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("|")) continue;
        const cells = trimmed.slice(1, -1).split("|");
        if (cells.length < 3 || cells[0] === undefined || cells[1] === undefined) continue;
        const internal = [...cells[0].matchAll(PATH_RE)].map((m) => m[1] as string);
        // The header row (`Membre interne`) carries no backticks, the separator
        // row none either — so "no backticked path in cell 1" is what excludes
        // them, rather than counting lines.
        if (internal.length !== 1) continue;
        rows.push({
            internal: internal[0] as string,
            routes: [...cells[1].matchAll(PATH_RE)].map((m) => m[1] as string),
            motive: (cells[2] ?? "").trim(),
        });
    }
    return rows;
}

/**
 * Resolves one namespace path against the surface oracle.
 *
 * Mirrors the consumption contract's resolver, including its refusal to pretend:
 * a depth-2 `_` member yields `out-of-scope`, never a verdict.
 */
function resolve(p: string): { verdict: string; why?: string } {
    const [head, member] = p.split(".");
    if (head === undefined) return { verdict: "absent", why: `\`${p}\`` };
    if (!EXPECTED_FACADE_KEYS.includes(head)) return { verdict: "absent", why: `\`${head}\`` };
    if (member === undefined) return { verdict: "present" };
    if (!DEPTH2_FACADES.includes(head)) {
        return { verdict: "out-of-scope", why: `\`${head}\` n'est pas descendue` };
    }
    if (member.charAt(0) === "_") {
        return { verdict: "out-of-scope", why: `\`${member}\` est \`_\`-préfixé` };
    }
    return (EXPECTED_FACADE_MEMBERS[head] ?? []).includes(member)
        ? { verdict: "present" }
        : { verdict: "absent", why: `\`${p}\`` };
}

const ROWS = readRows(fs.readFileSync(DOC, "utf8"));

describe("test-garde — la table de migration nomme des routes qui résolvent", () => {
    // ── Anti-garde-vide ─────────────────────────────────────────────────────────
    it("lit des lignes dans la table (sinon ce garde ne garde rien)", () => {
        expect(ROWS.length, `aucune ligne lue dans ${DOC}`).toBeGreaterThan(0);
    });

    it("lit au moins une route publique (sinon tout passerait par le tiret)", () => {
        const withRoute = ROWS.filter((r) => r.routes.length > 0);
        expect(withRoute.length, "aucune route publique citée").toBeGreaterThan(0);
    });

    it("lit un oracle non vide (sinon tout serait déclaré « absent »)", () => {
        expect(EXPECTED_FACADE_KEYS.length).toBeGreaterThan(0);
        expect(Object.keys(EXPECTED_FACADE_MEMBERS).length).toBeGreaterThan(0);
    });

    // ── Les deux sens ───────────────────────────────────────────────────────────
    it("chaque route publique citée résout sur la surface", () => {
        const broken: string[] = [];
        for (const row of ROWS) {
            for (const route of row.routes) {
                const r = resolve(route);
                // A public route MUST be measurable: an `out-of-scope` here would
                // mean the table points at something the oracle cannot see, which
                // is not a supported route whatever the page claims.
                if (r.verdict !== "present") {
                    broken.push(
                        `${row.internal} → ${route} (${r.verdict}${r.why ? " : " + r.why : ""})`
                    );
                }
            }
        }
        expect(
            broken,
            `routes publiques qui ne résolvent plus :\n  ${broken.join("\n  ")}`
        ).toEqual([]);
    });

    it("chaque membre interne cité existe encore, au moins par sa tête", () => {
        const gone: string[] = [];
        for (const row of ROWS) {
            const r = resolve(row.internal);
            // `out-of-scope` is accepted here and ONLY here: the head resolved and
            // the member is one the oracle drops by construction.
            if (r.verdict === "absent") gone.push(`${row.internal} (${r.why})`);
        }
        expect(gone, `membres internes disparus :\n  ${gone.join("\n  ")}`).toEqual([]);
    });

    it("une ligne sans route publique porte un motif écrit", () => {
        const mute = ROWS.filter((r) => r.routes.length === 0 && r.motive.length < 40);
        expect(
            mute.map((r) => r.internal),
            "un tiret sans motif est un oubli déguisé en verdict"
        ).toEqual([]);
    });
});
