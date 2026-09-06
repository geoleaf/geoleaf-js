/**
 * @file workshop-gates-skip-public.guard.test.ts
 * @description Guard — every gate `ci.yml` runs that reads the INTERNAL documentation root
 * must SKIP, exiting 0, on a corpus where that root is absent.
 *
 * Why this guard exists
 * ------------------------------------------------------------------------------------
 * 🛑 **A skip that is written but never reached is dead code that looks alive.**
 * `check-doc-ceilings.cjs` carried its own skip message, and `ci.yml` carried the matching
 * comment saying the step skips where its subjects do not ship. Both were true statements of
 * intent, and the gate still crashed: two module-level constants ABOVE the guard called
 * `docsPaths.internal()`, which throws when the root is missing. The guard was never reached
 * on the only corpus where it does anything.
 *
 * ⚠️ **Nothing local could see it.** The workshop always has that root, so the local pipelines
 * were green on every run. It took a real push to the published mirror — whose partition keeps
 * those documents back — to turn the pipeline red on a stack trace.
 *
 * What it locks, and how
 * ------------------------------------------------------------------------------------
 * The list is **derived from `ci.yml`**, never copied: a gate wired in tomorrow is covered the
 * day it is wired. The root's directory name is derived too, from `lib/docs-paths.cjs`, so this
 * file names no path that a reader of the published mirror could not resolve.
 *
 * Each script runs with `GEOLEAF_INTERNAL_DOCS_ROOT` pointed at a path that does not exist —
 * the same shape the mirror presents — and must not CRASH on that absence.
 *
 * 🛑 **The assertion is "did not throw for lack of the root", NOT "exited 0", and the first
 * draft got that wrong.** It asserted exit 0, and went red on `check-workshop-refs.cjs` — which
 * had exited 1 because it found a REAL violation, in this very file, unrelated to any missing
 * root. Conflating "crashed" with "found something" makes the guard fire for reasons that are
 * not its subject, and every such red costs an investigation that leads nowhere. So the marker
 * is the thrower's own frame: `requireRoot`, in `lib/docs-paths.cjs`. A gate that runs and
 * reports a violation has proven exactly what this guard wants — it did not die on the absence.
 */

import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");
const CI_YML = resolve(ROOT, ".github/workflows/ci.yml");
/** A path that cannot exist — the shape a corpus without the internal root presents. */
const ABSENT_ROOT = resolve(ROOT, "__no_such_internal_root__");

/**
 * The internal root's directory name, derived rather than written.
 *
 * ⚠️ Spelling it here would make this file a carrier of a reference the published mirror cannot
 * resolve, which its own hygiene gate refuses — rightly: such a name is dead for the reader who
 * has no such directory. `docsPaths.internal()` resolves it, and does not throw here because
 * the suite runs where the root exists.
 */
function internalDirName(): string {
    // 🛑 READ, never `require`d. PC-04-WIDE forbids CommonJS syntax across the repo, and its one
    // exception — a `require()` naming a genuinely CommonJS module — is recognised on a LITERAL
    // `.cjs` specifier. A computed path defeats that recognition, so the honest route is the
    // source text: the default is written once, in the resolver's own call.
    const src = readFileSync(resolve(ROOT, "scripts/lib/docs-paths.cjs"), "utf8");
    const m = src.match(/resolveRoot\(\s*"GEOLEAF_INTERNAL_DOCS_ROOT"\s*,\s*"([^"]+)"/);
    if (!m?.[1]) throw new Error("docs-paths.cjs — internal root default not found");
    return m[1];
}

/** Every `node scripts/<x>.cjs` invoked by `ci.yml`, deduplicated. */
function ciScripts(): string[] {
    const yml = readFileSync(CI_YML, "utf8");
    const found = yml.match(/node scripts\/[A-Za-z0-9._-]+\.cjs/g) ?? [];
    return [...new Set(found.map((m) => m.replace("node ", "")))];
}

/** Those that reach for the internal root — the only ones this guard concerns. */
function internalRootGates(): string[] {
    const dir = internalDirName();
    return ciScripts().filter((rel) => {
        const abs = resolve(ROOT, rel);
        if (!existsSync(abs)) return false;
        const src = readFileSync(abs, "utf8");
        return (
            src.includes("docsPaths.internal") ||
            src.includes("internalRootExists") ||
            src.includes(dir)
        );
    });
}

describe("les gates lisant la racine interne sautent là où elle est absente", () => {
    const gates = internalRootGates();

    test("🛑 le corpus n'est pas vide — sinon ce fichier ne garde rien", () => {
        // A derived list that silently matches nothing is the failure mode this repository
        // names most often: a gate exiting green having scanned nothing.
        expect(gates.length).toBeGreaterThan(0);
    });

    test.each(gates)("%s ne plante pas sans la racine interne", (rel) => {
        const run = spawnSync("node", [resolve(ROOT, rel)], {
            cwd: ROOT,
            env: { ...process.env, GEOLEAF_INTERNAL_DOCS_ROOT: ABSENT_ROOT },
            encoding: "utf8",
            timeout: 120_000,
        });
        // 🛑 `spawnSync` and NOT `execFileSync`, and the reason is READABILITY OF THE RED.
        // `execFileSync` throws, and the thrown Error carries the child's stack trace; the
        // runner then tries to source-map it, chokes, and reports one unhandled error WITHOUT
        // naming which gate failed. Measured on the very mutation this guard exists to catch:
        // the run went red — correctly — and said nothing about why. A guard whose red cannot
        // be read costs a second investigation every time it fires.
        const stderr = run.stderr ?? "";
        expect({
            script: rel,
            // `null` means the child died on a signal — a crash by another name.
            died: run.status === null,
            // The thrower's own frame. Its presence IS the defect: the gate reached for the
            // root instead of noticing it was gone.
            threwOnMissingRoot: stderr.includes("requireRoot"),
            stderr: stderr.slice(0, 400),
        }).toMatchObject({ died: false, threwOnMissingRoot: false });
    });
});
