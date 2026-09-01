/**
 * @file public-partition.guard.test.ts
 * @description Guard test — the workshop/public boundary bites BOTH ways, and
 * refuses to let through a batch it could not read.
 *
 * Why this guard exists (11/08/2026)
 * --------------------------------------
 * `scripts/lib/public-partition.cjs` decides what leaves for
 * `geoleaf/geoleaf-js`. A decision **irreversible by diffusion**: a workshop
 * file pushed to a public repo has been cloned, forked and indexed before
 * anyone notices, and making it private again recalls nothing.
 *
 * Yet this boundary has exactly the shape this repo knows to be failing: a
 * guard that, by ceasing to bite, **comes out green**. A renamed
 * `_docs_projet/`, a `git ls-files` launched in the wrong place, a pattern
 * anchored by mistake — in all three cases the partition removes nothing,
 * the port succeeds, and the workshop leaves. Nothing downstream would see
 * it: the clone is ephemeral, and no gate runs on it before the push.
 *
 * ## What is guarded, and why each case is there
 *
 * ① **The shapes reintroduction would take.** `CLAUDE.md` is read by its
 *    harness in any subdirectory: `packages/core/CLAUDE.md` is the return's
 *    most likely shape, and an anchored pattern (`/CLAUDE.md`) would let it
 *    through. The reason three patterns out of four are UN-anchored, and
 *    this test is what keeps them from being "fixed" by anchoring.
 *
 * ② **The false positives.** A too-wide pattern grabbing
 *    `docs/CLAUDE_GUIDE.md` would remove public docs with nothing saying so
 *    — the symmetric failure, silent too.
 *
 * ③ **The three refusals.** Plausibility floor, sterile pattern, and a fully
 *    blind partition. Each was seen biting the day it was set; this test is
 *    what guarantees it still bites.
 *
 * ## A guard never seen red guards nothing
 *
 * Anti-empty-guard assertion: the four declared patterns must all be
 * exercised by at least one case. Without it, removing a pattern from the
 * module would make this guard green testing nothing any more.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The shape of the CommonJS module under test, described here because it emits no types. */
interface PublicPartition {
    INTERNAL_PATTERNS: ReadonlyArray<{ pattern: string; dir: boolean; why: string }>;
    MIN_PUBLIC_FILES: number;
    classify(relPath: string): { internal: boolean; pattern?: string };
    isInternal(relPath: string): boolean;
    split(files: string[]): {
        publicFiles: string[];
        internalFiles: string[];
        byPattern: Map<string, string[]>;
    };
    assertPartitionSane(parts: ReturnType<PublicPartition["split"]>): void;
    gitignoreFragment(): string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../..");
const requireCjs = createRequire(import.meta.url);

const partition: PublicPartition = requireCjs(
    path.join(REPO_ROOT, "scripts/lib/public-partition.cjs")
) as PublicPartition;

/**
 * Classification cases: `[path, kept in the workshop?, case motive]`.
 * The first seven exercise the four patterns; the next six are the false
 * positives a too-wide pattern would produce.
 */
const CASES: ReadonlyArray<[string, boolean, string]> = [
    ["CLAUDE.md", true, "racine"],
    ["packages/core/CLAUDE.md", true, "motif NON ancré — la forme la plus probable du retour"],
    ["packages/plugins/table/CLAUDE.md", true, "même forme, profondeur 3"],
    ["_docs_projet/JOURNAL.md", true, "atelier"],
    ["_docs_projet/registres/backlog_technique.md", true, "atelier, profond"],
    [".claude/commands/audit.md", true, "harnais"],
    [".github/copilot-instructions.md", true, "ancré par sa barre oblique"],
    ["README.md", false, "vitrine"],
    ["docs/specs/CDC_kernel.md", false, "doc publique"],
    ["packages/core/src/index.ts", false, "source"],
    ["scripts/lib/public-partition.cjs", false, "le module lui-même part au public"],
    ["docs/CLAUDE_GUIDE.md", false, "contient CLAUDE, n'est pas CLAUDE.md"],
    ["packages/core/docs/claude.md", false, "casse différente — le harnais ne le lit pas"],
];

/** A plausibly sized batch, carrying the four patterns. */
function plausibleLot(): string[] {
    const files: string[] = [];
    for (let i = 0; i < partition.MIN_PUBLIC_FILES + 400; i++) {
        files.push(`packages/core/src/f${i}.ts`);
    }
    files.push(
        "CLAUDE.md",
        "_docs_projet/ETAT.md",
        ".claude/commands/x.md",
        ".github/copilot-instructions.md"
    );
    return files;
}

describe("public-partition — la frontière atelier/public", () => {
    it.each(CASES)("%s → %s (%s)", (file: string, internal: boolean) => {
        expect(partition.isInternal(file)).toBe(internal);
    });

    it("exerce les QUATRE motifs déclarés — anti-garde-vide", () => {
        const exercised = new Set<string>();
        for (const [file] of CASES) {
            const { internal, pattern } = partition.classify(file);
            if (internal) exercised.add(pattern);
        }
        const declared = partition.INTERNAL_PATTERNS.map((p) => p.pattern);
        expect(declared.length).toBeGreaterThan(0);
        // A pattern added to the module without a case here would be a pattern nothing exercises.
        expect([...exercised].sort()).toEqual([...declared].sort());
    });

    it("laisse passer un lot plausible", () => {
        expect(() => partition.assertPartitionSane(partition.split(plausibleLot()))).not.toThrow();
    });

    it("REFUSE un lot sous le plancher — `git ls-files` n'a pas lu ce qu'on croit", () => {
        const maigre = ["README.md", "CLAUDE.md", "_docs_projet/a.md", ".claude/b.md"];
        expect(() => partition.assertPartitionSane(partition.split(maigre))).toThrow(/plancher/);
    });

    it("REFUSE quand un motif ne retire RIEN — cible renommée, partition aveugle", () => {
        const sansAtelier = plausibleLot().filter((f) => !f.startsWith("_docs_projet/"));
        expect(() => partition.assertPartitionSane(partition.split(sansAtelier))).toThrow(
            /_docs_projet\//
        );
    });

    it("REFUSE quand AUCUN motif ne mord — l'atelier partirait en entier", () => {
        const rienDInterne = plausibleLot().filter((f) => !partition.isInternal(f));
        expect(() => partition.assertPartitionSane(partition.split(rienDInterne))).toThrow(
            /4 motif\(s\)/
        );
    });

    it("le fragment `.gitignore` porte les quatre motifs", () => {
        const fragment = partition.gitignoreFragment();
        for (const { pattern } of partition.INTERNAL_PATTERNS) {
            expect(fragment).toContain(pattern);
        }
    });
});
