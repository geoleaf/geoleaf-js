#!/usr/bin/env node
/**
 * PUB-TYPES: the declarations a package SHIPS must be REACHABLE (ARCHI S6).
 *
 * ## The failure this exists to catch
 *
 * A package can emit `dist/types/**`, list `dist/` in `files[]`, publish the
 * declarations to npm — and still be untyped for every consumer, because nothing
 * points at them. `import "@geoleaf-plugins/table"` then fails with TS7016
 * ("could not find a declaration file"), while the .d.ts sits inside the tarball.
 * Measured at S6: 11 packages were in exactly that state.
 *
 * The load-bearing rule — established by experiment, not by folklore:
 *
 *   A `types` condition must exist INSIDE the exports map (a top-level `"types"`
 *   field is ignored once `exports` is present). Deleting both from `plugin-cog`
 *   and running `typecheck:consumer` produces, on the spot:
 *       error TS7016: Could not find a declaration file for module
 *       '@geoleaf-plugins/cog'. '…/dist/geoleaf-cog.plugin.js' implicitly has an 'any'
 *   That is check 1 below, and it is the state 11 packages were shipping in.
 *
 * ⚠️ What this gate deliberately does NOT claim — "types must come first".
 * The widespread advice is that conditions match in object order, so a `types` placed
 * after `import` is never read. **Measured on this repo's toolchain: false.**
 * `{ "import": …, "types": … }` type-checks green, and so does `{ "default": …,
 * "types": … }` — TypeScript looks the `types` condition up irrespective of position.
 * Ordering is therefore enforced as a CONVENTION (check 2), with a message that says
 * so: it keeps the packages uniform and stays safe for resolvers that ARE positional,
 * but it is not what prevents TS7016. Do not promote that message back into a
 * correctness claim without re-running the experiment.
 *
 * ## The other direction — a hand-written contract creeping back
 *
 * S6 removed a 847-line hand-maintained `index.d.ts` from the repo root: never
 * published (absent from every `files[]`), never type-checked (no root tsconfig),
 * and drifted from the code it claimed to describe (it declared `POI` and `Table`,
 * neither of which the core still exports). Four sprints had invested in it
 * believing it was the published contract. Check 4 keeps that class from returning:
 * the published type contract is GENERATED from the source, never hand-written.
 *
 * ## What this does NOT check
 *
 * That the declarations are CORRECT — that is `typecheck:consumer`, which compiles
 * the published recipe through the exports map. This gate is the cheap structural
 * complement: it reads package.json and the filesystem, no compiler.
 *
 * Usage: node scripts/verify-published-types.cjs (from repo root)
 *        Runs AFTER a build — it resolves declaration targets on disk.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const registry = require("./lib/packages.cjs");
const ROOT = registry.ROOT;

/**
 * Packages that deliberately expose no type surface, with the reason.
 *
 * ⚠️ VIDE depuis l'API publique S4.4c — les 17 paquets publient désormais leurs déclarations.
 *
 * Elle contenait `@geoleaf-plugins/addpoi` et `@geoleaf-plugins/offline-ui`, avec ce motif :
 * « compile ../core/src/** donc ne peut pas porter de rootDir ; les déclarations sortaient
 * racinées sur packages/ (514 fichiers, 2,6 Mo, dont 483 du CORE) ». Le constat était juste,
 * et la dette qu'il nommait — le couplage plugin → sources du core — a été payée : les deux
 * paquets n'ont plus aucun import `@core/*`, portent `rootDir: src`, et émettent
 * respectivement 34 et 36 déclarations, **0 du core**.
 *
 * Laisser la constante en place plutôt que de la supprimer : c'est l'endroit documenté où
 * inscrire une exemption future, avec sa raison. Un vide explicite se relit ; une constante
 * absente se réinvente.
 */
const NO_TYPES_BY_DESIGN = {};

const errors = [];
const checked = [];

// ── Checks 1-3: every package that EMITS declarations must make them reachable ──
for (const pkg of registry.all()) {
    const pkgJsonPath = path.join(pkg.dir, "package.json");
    const pj = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    const rel = path.relative(ROOT, pkg.dir);

    // A private package is never published — its types cannot be a consumer's problem.
    // `host-runtime` is private-but-typed on purpose (bundled into consumers at build
    // time), so we still check it when it declares something; we just never REQUIRE it.
    const isPrivate = pj.private === true;

    const typesDir = path.join(pkg.dir, "dist", "types");
    const emits = fs.existsSync(typesDir) && fs.readdirSync(typesDir).length > 0;

    const dot = pj.exports && pj.exports["."];
    const hasExportsObject = dot && typeof dot === "object" && !Array.isArray(dot);
    const conditionKeys = hasExportsObject ? Object.keys(dot) : [];
    const typesCondition = hasExportsObject ? dot.types : undefined;

    if (emits && !typesCondition && !isPrivate) {
        if (NO_TYPES_BY_DESIGN[pj.name]) {
            errors.push(
                `${rel} — declared "no types by design" but dist/types/ is NOT empty. ` +
                    `Either the exemption is stale, or emission came back on.`
            );
        } else {
            errors.push(
                `${rel} — emits dist/types/ and publishes dist/, but exports["."] declares ` +
                    `no "types" condition. The declarations ship and no consumer can reach ` +
                    `them (TS7016). Add: "types": "./dist/types/<entry>.d.ts" as the FIRST key.`
            );
        }
        continue;
    }

    if (!typesCondition) {
        // Not emitting and not declaring: consistent. Record the by-design ones so the
        // exemption list cannot silently outlive the situation it describes.
        if (NO_TYPES_BY_DESIGN[pj.name]) checked.push(`${pj.name} (no types by design)`);
        continue;
    }

    // Check 2 — CONVENTION, not correctness. TypeScript resolves `types` wherever it
    // sits (measured — see the header). This keeps the 15 typed packages uniform and
    // stays safe for positional resolvers. If it ever blocks something legitimate,
    // deleting this check costs nothing: check 1 is the one that guards TS7016.
    if (conditionKeys[0] !== "types") {
        errors.push(
            `${rel} — exports["."] lists "types" after "${conditionKeys[0]}". CONVENTION: ` +
                `"types" goes first, as in every other package here. (This is a uniformity ` +
                `rule — TypeScript itself resolves it either way, verified by experiment. ` +
                `Not a TS7016 risk.)`
        );
        continue;
    }

    // Check 3 — the target must exist. A `types` pointing at nothing is worse than
    // no `types` at all: it reads as typed and resolves to nothing.
    const target = path.join(pkg.dir, typesCondition);
    if (!fs.existsSync(target)) {
        errors.push(
            `${rel} — exports["."].types → "${typesCondition}" does not exist on disk. ` +
                `(Run a build first; if the build genuinely does not produce it, the ` +
                `condition is a promise the package cannot keep.)`
        );
        continue;
    }

    // A top-level `types` is a harmless fallback for pre-exports resolvers, but it must
    // not contradict the condition that actually governs.
    if (
        pj.types &&
        path.normalize(pj.types) !== path.normalize(typesCondition.replace(/^\.\//, ""))
    ) {
        errors.push(
            `${rel} — top-level "types" (${pj.types}) and exports["."].types ` +
                `(${typesCondition}) disagree. The exports condition governs; the field is ` +
                `read only by older resolvers. Two answers to one question.`
        );
        continue;
    }

    checked.push(pj.name);
}

// ── Check 4: no hand-written declaration file may sit at the repo root ─────────
// The published contract is generated. See the header for what this replaced.
const rootDeclarations = fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith(".d.ts"))
    .filter((f) => fs.statSync(path.join(ROOT, f)).isFile());

if (rootDeclarations.length > 0) {
    errors.push(
        `repo root — hand-written declaration file(s) found: ${rootDeclarations.join(", ")}. ` +
            `The published type contract is GENERATED into each package's dist/types/. A root ` +
            `.d.ts reaches no npm consumer (it is in no files[]) and no compiler (there is no ` +
            `root tsconfig), so it drifts silently — which is why the previous one was removed ` +
            `at ARCHI S6.`
    );
}

if (errors.length > 0) {
    console.error("ERROR [PUB-TYPES]: published declarations are unreachable or inconsistent:");
    for (const e of errors) console.error(`  ${e}`);
    console.error("");
    console.error("A package whose .d.ts ship but cannot be resolved is untyped for consumers.");
    process.exit(1);
}

const byDesign = Object.keys(NO_TYPES_BY_DESIGN).length;
console.log(
    `✅ [PUB-TYPES] ${checked.length - byDesign} packages expose reachable declarations ` +
        `(types condition first, target present), ${byDesign} expose none by design; ` +
        `no hand-written .d.ts at the repo root.`
);
process.exit(0);
