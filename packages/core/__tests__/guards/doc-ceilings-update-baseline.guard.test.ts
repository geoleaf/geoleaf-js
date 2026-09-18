/**
 * @file doc-ceilings-update-baseline.guard.test.ts
 * @description Guard — `check-doc-ceilings.cjs --update-baseline` writes the baseline back in
 * the format its own reader documents: keyed by LOGICAL name, with its header fields intact.
 *
 * Why this guard exists
 * ------------------------------------------------------------------------------------
 * 🛑 **The generator wrote a format its reader refuses, and nothing turned red.** The reader
 * keys the baseline by logical name, for two reasons written beside it: a workshop path
 * spelled inside `scripts/` is a dead pointer for the public reader, and the workshop root is
 * configurable. The writer, though, spread the map it had already RESOLVED to paths — so one
 * `--update-baseline`, the very gesture the gate recommends, rewrote every key as a path and
 * replaced the file's own warning about formatted sizes. The reader still accepted the result
 * (an unknown key falls through as-is), which is exactly why the regression was silent.
 *
 * How it is locked
 * ------------------------------------------------------------------------------------
 * The real script and its path library are copied into a throwaway tree, next to a copy of the
 * committed baseline, so the gesture runs for real without touching the repository's baseline.
 * The internal root's directory name is derived from `lib/docs-paths.cjs`, never written: this
 * file ships to the public repository, where such a name would be a dead reference.
 *
 * ⚠️ The third case is the anti-tautology lock: a baseline that stayed byte-identical but that
 * the gate no longer read would pass the first two. It must still bite on an oversized file.
 */

import { afterAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const SCRIPT = path.join(ROOT, "scripts/check-doc-ceilings.cjs");
const LIB = path.join(ROOT, "scripts/lib/docs-paths.cjs");
const BASELINE = path.join(ROOT, "scripts/.baselines/doc-ceilings.json");

const trees: string[] = [];
afterAll(() => {
    for (const t of trees) fs.rmSync(t, { recursive: true, force: true });
});

interface CeilingsBaseline {
    readonly _comment?: string;
    readonly ceilings: Record<string, number>;
}

/**
 * The internal root's directory name, read from the resolver's own default.
 *
 * @returns The directory name, as `lib/docs-paths.cjs` spells it.
 */
function internalDirName(): string {
    const src = fs.readFileSync(LIB, "utf8");
    const m = src.match(/resolveRoot\(\s*"GEOLEAF_INTERNAL_DOCS_ROOT"\s*,\s*"([^"]+)"/);
    if (!m?.[1]) throw new Error("docs-paths.cjs — internal root default not found");
    return m[1];
}

/** The committed baseline, parsed. */
function committedBaseline(): { raw: string; parsed: CeilingsBaseline } {
    const raw = fs.readFileSync(BASELINE, "utf8");
    return { raw, parsed: JSON.parse(raw) as CeilingsBaseline };
}

/** A file of exactly `bytes` bytes, with no digit a ratio check could read. */
function writeSized(abs: string, bytes: number): void {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "x".repeat(Math.max(0, bytes - 1)) + "\n", "utf8");
}

/**
 * A throwaway repository shaped like this one for the gate: the script, its library, a copy of
 * the committed baseline, and the three loaded files at the requested sizes.
 *
 * @param sizes - Byte size of each ratcheted subject, by logical name.
 * @returns The tree's root and the path of its baseline copy.
 */
function makeTree(sizes: { claude: number; etat: number }): { root: string; baseline: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-doc-ceil-"));
    trees.push(root);
    const internal = internalDirName();
    fs.mkdirSync(path.join(root, "scripts/lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts/.baselines"), { recursive: true });
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(root, "scripts/check-doc-ceilings.cjs"));
    fs.copyFileSync(LIB, path.join(root, "scripts/lib/docs-paths.cjs"));
    const baseline = path.join(root, "scripts/.baselines/doc-ceilings.json");
    fs.copyFileSync(BASELINE, baseline);
    writeSized(path.join(root, "CLAUDE.md"), sizes.claude);
    writeSized(path.join(root, internal, "ETAT.md"), sizes.etat);
    writeSized(path.join(root, internal, "POSTMORTEMS.md"), 64);
    return { root, baseline };
}

/** Runs the copied gate. `spawnSync`, so a red names its output instead of a stack trace. */
function runGate(root: string, ...args: string[]) {
    return spawnSync("node", [path.join(root, "scripts/check-doc-ceilings.cjs"), ...args], {
        cwd: root,
        // Emptied, not inherited: an override set in the parent would point the copy back at
        // the repository's own roots.
        env: { ...process.env, GEOLEAF_INTERNAL_DOCS_ROOT: "", GEOLEAF_DOCS_ROOT: "" },
        encoding: "utf8",
        timeout: 60_000,
    });
}

describe("DOC-CEIL — `--update-baseline` écrit le format que son lecteur attend", () => {
    const { raw, parsed } = committedBaseline();
    const claude = parsed.ceilings["claude"];
    const etat = parsed.ceilings["etat"];

    test("🛑 la baseline du dépôt est bien clefée par noms logiques — sinon ce fichier ne garde rien", () => {
        expect(typeof claude).toBe("number");
        expect(typeof etat).toBe("number");
    });

    test("régénérer une baseline déjà serrée ne change pas un octet", () => {
        const tree = makeTree({ claude: claude ?? 0, etat: etat ?? 0 });
        const run = runGate(tree.root, "--update-baseline");
        expect({ status: run.status, stderr: (run.stderr ?? "").slice(0, 400) }).toMatchObject({
            status: 0,
        });
        expect(fs.readFileSync(tree.baseline, "utf8")).toBe(raw);
    });

    test("resserrer garde les clés logiques et le commentaire, et ne baisse que le plafond mesuré", () => {
        const smaller = (etat ?? 0) - 100;
        const tree = makeTree({ claude: claude ?? 0, etat: smaller });
        const run = runGate(tree.root, "--update-baseline");
        expect(run.status).toBe(0);
        const written = JSON.parse(fs.readFileSync(tree.baseline, "utf8")) as CeilingsBaseline;
        expect(Object.keys(written.ceilings)).toEqual(Object.keys(parsed.ceilings));
        expect(written.ceilings["etat"]).toBe(smaller);
        expect(written.ceilings["claude"]).toBe(claude);
        expect(written._comment).toBe(parsed._comment);
    });

    test("la baseline régénérée mord encore : un fichier trop gros fait rougir DOC-CEIL-01", () => {
        const tree = makeTree({ claude: claude ?? 0, etat: etat ?? 0 });
        expect(runGate(tree.root, "--update-baseline").status).toBe(0);
        writeSized(path.join(tree.root, internalDirName(), "ETAT.md"), (etat ?? 0) + 1);
        const run = runGate(tree.root);
        expect({ status: run.status, bit: (run.stderr ?? "").includes("DOC-CEIL-01") }).toEqual({
            status: 1,
            bit: true,
        });
    });
});
