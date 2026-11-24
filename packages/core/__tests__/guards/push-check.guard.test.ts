/**
 * @file push-check.guard.test.ts
 * @description Guard test — the push check never takes the short path when the push carries
 * a public file, and never stands on a green it cannot trust.
 *
 * Why this guard exists (22/11/2026)
 * --------------------------------------
 * `scripts/push-check.cjs` lets a push that carries only workshop files skip the full
 * `ci:local`. That shortcut is only safe if the decision is exact: one public path in the
 * diff, a green run on a dirty tree, or a green that is not an ancestor of `HEAD`, and the
 * full run is required. A decision that drifts towards "short" would come out green on every
 * push while judging nothing the public receives — the shape this repo knows to be failing.
 *
 * The decision is tested against the REAL partition (`public-partition.cjs`), not a stub: the
 * shortcut is defined by that boundary, and a pattern that stops biting must make this guard
 * red, not pass unnoticed.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface Run {
    sha?: string | null;
    clean?: boolean;
    results?: Array<{ ok: boolean }>;
}
interface Decision {
    verdict: "ci-local" | "court";
    reason: string;
    publicFiles: string[];
}
interface PushCheck {
    findBase(runs: Run[], isAncestor: (sha: string) => boolean): string | null;
    decide(input: {
        base: string | null;
        files: string[];
        isInternal: (f: string) => boolean;
    }): Decision;
    shortSet(files: string[]): Array<{ name: string; run: string[] }>;
}
interface Partition {
    isInternal(relPath: string): boolean;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../..");
const requireCjs = createRequire(import.meta.url);
const pushCheck = requireCjs(path.join(REPO_ROOT, "scripts/push-check.cjs")) as PushCheck;
const partition = requireCjs(path.join(REPO_ROOT, "scripts/lib/public-partition.cjs")) as Partition;

const green = (sha: string, clean = true): Run => ({
    sha,
    clean,
    results: [{ ok: true }, { ok: true }],
});
const red = (sha: string): Run => ({ sha, clean: true, results: [{ ok: true }, { ok: false }] });
const decide = (base: string | null, files: string[]): Decision =>
    pushCheck.decide({ base, files, isInternal: partition.isInternal });

describe("push-check — la décision", () => {
    it("exige ci:local sans vert de base", () => {
        expect(decide(null, [".claude/kit.md"]).verdict).toBe("ci-local");
    });

    it("prend le chemin court quand tout est de l'atelier", () => {
        const d = decide("abc1234", [
            "CLAUDE.md",
            "STATUS.md",
            "docs/recette/sprint-00/recette.json",
            ".claude/kit.md",
        ]);
        expect(d.verdict).toBe("court");
    });

    it("🛑 exige ci:local dès UN fichier public, et le nomme", () => {
        const d = decide("abc1234", [
            ".claude/kit.md",
            "scripts/lib/public-partition.cjs",
            "STATUS.md",
        ]);
        expect(d.verdict).toBe("ci-local");
        expect(d.publicFiles).toEqual(["scripts/lib/public-partition.cjs"]);
    });

    it("compte un fichier public SUPPRIMÉ comme un fichier public", () => {
        // `git diff --name-only` lists deletions: a removed public doc is a public change.
        expect(decide("abc1234", ["docs/guides/supprime.md"]).verdict).toBe("ci-local");
    });

    it("un document public qui parle de recette n'est pas de l'atelier", () => {
        expect(decide("abc1234", ["docs/reference/recette.md"]).verdict).toBe("ci-local");
    });
});

describe("push-check — le vert de base", () => {
    const all = () => true;

    it("prend le vert le plus récent, ancêtre de HEAD", () => {
        expect(pushCheck.findBase([green("a1"), green("b2")], all)).toBe("b2");
    });

    it("🛑 ignore un vert sur arbre SALE, et une ligne sans la mention `clean`", () => {
        const noFlag: Run = { sha: "c3", results: [{ ok: true }] };
        expect(pushCheck.findBase([green("a1"), green("b2", false), noFlag], all)).toBe("a1");
    });

    it("ignore un run rouge, même plus récent", () => {
        expect(pushCheck.findBase([green("a1"), red("b2")], all)).toBe("a1");
    });

    it("ignore un vert qui n'est pas un ancêtre de HEAD", () => {
        expect(pushCheck.findBase([green("a1"), green("b2")], (sha) => sha === "a1")).toBe("a1");
    });

    it("rend null quand rien ne qualifie", () => {
        expect(pushCheck.findBase([red("a1"), green("b2", false)], all)).toBeNull();
    });
});

describe("push-check — l'ensemble court", () => {
    it("🛑 porte toujours la recherche de secrets : publier un secret ne se rattrape pas", () => {
        const runs = pushCheck.shortSet([]).map((s) => s.run.join(" "));
        expect(runs).toContain("node scripts/gitleaks-local.cjs");
        expect(runs).toContain("node scripts/atelier-check.cjs");
    });

    it("lint les scripts de l'atelier du diff, pas sa prose", () => {
        const set = pushCheck.shortSet(["docs/recette/outils/cellules.mjs", ".claude/kit.md"]);
        const eslint = set.find((s) => s.run.includes("eslint"));
        expect(eslint?.run).toContain("docs/recette/outils/cellules.mjs");
        expect(eslint?.run).not.toContain(".claude/kit.md");
    });
});
