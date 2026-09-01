#!/usr/bin/env node
/*!
 * API-SURFACE: the manifest of the derived public surface, and its freshness gate.
 *
 * ## The defect this gate closes
 *
 * The TypeDoc API reference was a **fossil**: its output dated from 07-25, the core
 * had moved until 07-26, and `docs:api` was wired **nowhere** — not the root
 * `package.json`, not `ci.yml`, not `ci-local.cjs`. Meanwhile `API_REFERENCE.md` kept
 * being edited by hand. That was the whole divergence between the repo's two
 * references, and nothing said so.
 *
 * ## Why a MANIFEST, and not the committed rendering
 *
 * The V3 overhaul had decided "the output is committed, a gate fails if it diverges" —
 * on the `docs:tree:check` model, the only regime that has held here. **Measured, that
 * move is infeasible on the rendering**, for two independent reasons:
 *
 *   1. **The rendering has no fixed point.** `typedoc/…/converter/utils/repository.js`
 *      runs `git rev-parse HEAD` and engraves the SHA in the output — census: **29
 *      files out of 54**. The commit's SHA does not exist when writing the output one
 *      wants to put in it: the gate would come out red **at the very commit that just
 *      regenerated**.
 *   2. **The volume.** `expand` on the core alone produces **1,806 files / 24 MB**, at
 *      **one line of HTML per file**. A diff unreviewable by construction.
 *
 * So we gate the **model**, not the rendering — and it is the lesson
 * `generate-docs-tree.cjs` already carries in writing: comparing the RENDERING left
 * its `--check` green while **31 annotations out of 129** were dead, because it
 * compared what is displayed instead of what is described.
 *
 * The manifest satisfies the `docs:tree` regime's three properties:
 *   - **pure function of the source** — no SHA, no date, no absolute path (asserted
 *     at run time);
 *   - **reviewable** — one line per reflection, sorted: a renamed `@param`, an added
 *     export or a rewritten TSDoc produce **one diff line**;
 *   - **out of the formatters' reach** — see the extension choice below.
 *
 * ## Three shape choices, each against a precise failure mode
 *
 * **`.txt` and not `.md`.** A `.md` under `docs/reference/` would enter
 * `check-dead-links.cjs`'s `reference/` scope **and** be rewritten by `lint-staged`'s
 * `"*.{json,md}"` glob at every commit — hence a permanently red gate, without a
 * source moving. Exactly the defect `.prettierignore` documents for
 * `ARBORESCENCE_QUALIFIEE.md`. `.txt` avoids both without adding an exception line.
 *
 * **The comment hash is whitespace-NORMALIZED.** `lint-staged` runs
 * `prettier --write` on `packages/**\/src/**\/*.{js,ts}`: it **re-wraps** TSDoc
 * blocks during the hook. Hashing the raw text would thus have created a new instance
 * of the re-wrap defect — the gate staled by the commit that satisfies it. By
 * collapsing whitespace runs, a re-wrap changes nothing and a **rewrite** changes
 * everything: precisely the wanted discrimination.
 *
 * **The manifest lives outside the generated-artifact shapes.** `docs/reference/`
 * matches no `GENERATED_DIR_FORMS` entry (`docs/api`, `docs/public`, `docs-dist`) —
 * so `.gitignore`, `verify-repo-hygiene`'s checks 4/5/5c and `check-package-files`
 * stay **intact**. That is what allows gating freshness WITHOUT reopening the settled
 * arbitration (the `files[]`'s `!docs/api/` stays, purge refused — a recorded
 * decision).
 *
 * ## What this gate protects, besides freshness
 *
 * The core's perimeter comes from `packages/core/typedoc.json`, which TypeDoc itself
 * reads for that package (a package config wins over `packageOptions`). **Useful
 * consequence: shrinking that file makes this gate go red.** If someone brought
 * `entryPoints` back to `["src/bundle-esm-entry.ts"]` in `resolve`, the manifest
 * would collapse from ~11,600 reflections to ~1,100 and `--check` would say so. The
 * widened configuration is thus not protected by a comment — it is protected by a
 * measurement. ⚠️ And it CANNOT carry a comment: TypeDoc refuses unknown keys
 * (`_comment` → *Unknown option*), and `generated-artifacts.cjs` does a strict
 * `JSON.parse`, so no JSONC either.
 *
 * ## What it does NOT judge
 *
 * The truthfulness of sentences, as everywhere here. A TSDoc can lie: the manifest
 * will only say the lie has not changed since the last commit. And it does not judge
 * the documentation's COMPLETENESS — that is TSD-05, in `check-tsdoc-conformity.cjs`.
 *
 * Usage:
 *   node scripts/gen-api-surface.cjs            # (re)generates the manifest
 *   node scripts/gen-api-surface.cjs --check     # gate: exit 1 if the manifest is stale
 *   node scripts/gen-api-surface.cjs --verbose
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const registry = require("./lib/packages.cjs");
const docsPaths = require("./lib/docs-paths.cjs");

const ROOT = registry.ROOT;
const OUT_FILE = docsPaths.reference("API_SURFACE.txt");
const CHECK = process.argv.includes("--check");
const VERBOSE = process.argv.includes("--verbose");

// TypeDoc is a core devDependency — resolved as Node would FROM the core
// (`require.resolve` with `paths`), never by a physical path. ⚠️ This constant joined
// `node_modules/typedoc/dist/index.js` under the core's directory until 2026-08-24:
// the comment claimed "never a hard-coded path", but the suffix remained an
// assumption about npm's LAYOUT — true while incremental installs left a nested copy,
// false at the first clean `npm ci`, which hoists typedoc to the root. The gate then
// threw "not found" on an installed package. The resolution below walks the ancestor
// node_modules, like a core `import`.
const CORE = registry.requireByDirName("core");
const TYPEDOC_ENTRY = (() => {
    try {
        return require.resolve("typedoc", { paths: [CORE.absDir] });
    } catch {
        return null;
    }
})();

/**
 * The package directories to cover — **derived, never listed**.
 *
 * The criterion is *what is published with an API surface*: a non-`private` package
 * that declares an `exports` map and has a `src/`. It renders today the core, the 13
 * plugins and `@geoleaf/field-renderer` — **15 packages**.
 *
 * ⚠️ **The first draft filtered on `dir.includes("packages/plugins/")` plus the core,
 * and it FORGOT `field-renderer`** — a published package whose surface (391 manifest
 * lines) was thus gated by nothing. Exactly the described class: a path filter does
 * not break on a move, it **silently stops matching**, and the gate goes green having
 * not scanned. The defect was found by deliberately amputating the perimeter to see
 * the gate go red: it rendered the right verdict for the wrong reason, which had the
 * predicate re-read. **A useful mutation is not only the one that reddens.**
 *
 * `host-runtime` is `private: true` — consumed by the plugins, never published on
 * npm, hence outside the shipped surface. `geoleaf-app` and `build-config` likewise.
 *
 * @returns {string[]} absolute paths, sorted — sorting keeps the manifest stable.
 * @throws {Error} if the predicate renders nothing anymore, or no longer the core.
 */
function targets() {
    const dirs = [];
    for (const pkg of registry.all()) {
        const manifest = path.join(pkg.absDir, "package.json");
        if (!fs.existsSync(manifest)) continue;
        const pj = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (pj.private === true) continue;
        if (!pj.exports) continue;
        if (!fs.existsSync(path.join(pkg.absDir, "src"))) continue;
        dirs.push(pkg.absDir);
    }
    dirs.sort();
    // Anti-amputated-perimeter: a predicate rendering nothing would produce an empty
    // manifest comparing to itself; if it no longer renders the core, it no longer
    // renders the essential. In both cases the gate refuses to conclude. (Both
    // branches seen throwing by mutation.)
    if (dirs.length === 0 || !dirs.includes(CORE.absDir)) {
        throw new Error(
            `[API-SURFACE] le prédicat de périmètre rend ${dirs.length} paquet(s) et ` +
                `${dirs.includes(CORE.absDir) ? "inclut" : "N'INCLUT PAS"} le core. Le critère ` +
                "(non-private + carte `exports` + `src/`) ne décrit plus le dépôt — la gate " +
                "refuse de conclure plutôt que de gater un périmètre amputé."
        );
    }
    return dirs;
}

/**
 * A reflection's documentary text, whitespace-normalized.
 *
 * @param {object} reflection - The TypeDoc reflection.
 * @returns {string} concatenated text, whitespace runs collapsed; `""` if no comment.
 */
function commentText(reflection) {
    const c = reflection.comment;
    if (!c) return "";
    const parts = [];
    for (const p of c.summary || []) if (p.text) parts.push(p.text);
    for (const t of c.blockTags || []) {
        parts.push(t.tag || "");
        for (const p of t.content || []) if (p.text) parts.push(p.text);
    }
    // ⚠️ The whitespace collapse is load-bearing: see the top § on `lint-staged`.
    return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Short, stable fingerprint of the documentary text, or `-` if there is none. */
function docFingerprint(reflection) {
    const t = commentText(reflection);
    if (!t) return "-";
    return crypto.createHash("sha256").update(t).digest("hex").slice(0, 12);
}

/** The manifest's header — STATIC, never a date nor a counter. */
const BANNER = [
    "# API_SURFACE — manifeste de la surface publique dérivée par TypeDoc.",
    "#",
    "# GÉNÉRÉ. Ne pas éditer à la main : `npm run gen:api-surface` réécrit ce fichier, et",
    "# `npm run gen:api-surface:check` (câblé dans ci:local et ci.yml) échoue s'il est périmé.",
    "#",
    "# Une ligne par réflexion : <Kind> | <nom qualifié> | doc:<empreinte du TSDoc>",
    "# L'empreinte est un sha256 tronqué du texte documentaire, blancs ÉCRASÉS — un re-wrap de",
    "# Prettier ne la change donc pas, une réécriture oui. `doc:-` = aucun commentaire.",
    "#",
    "# Ce fichier ne porte NI date NI SHA NI chemin absolu, à dessein : c'est ce qui en fait une",
    "# fonction pure de la source, donc gatable. Le rendu HTML, lui, grave le SHA de HEAD et",
    "# n'est pas gatable — motif complet dans l'en-tête de scripts/gen-api-surface.cjs.",
    "",
].join("\n");

/**
 * Builds the manifest content.
 *
 * @returns {Promise<{content: string, stats: object}>}
 * @throws {Error} if TypeDoc is absent, if a package fails to convert, or if the
 *   manifest comes out empty — in all three cases the gate refuses to conclude rather
 *   than come out green.
 */
async function build() {
    if (TYPEDOC_ENTRY === null || !fs.existsSync(TYPEDOC_ENTRY)) {
        throw new Error(
            "[API-SURFACE] TypeDoc irrésoluble depuis packages/core (require.resolve) — " +
                "lancer `npm install`. La gate refuse de conclure sans son convertisseur."
        );
    }
    const { Application, TSConfigReader, TypeDocReader, ReflectionKind } = await import(
        TYPEDOC_ENTRY
    );

    const dirs = targets();
    const shared = {
        skipErrorChecking: true,
        logLevel: "Error",
        readme: "none",
        excludeExternals: true, // without it, `Window` drags in ~220 lib.dom members
        excludePrivate: true,
        excludeInternal: true,
        exclude: ["**/__tests__/**", "**/__mocks__/**", "**/*.test.ts", "**/*.spec.ts"],
    };

    const app = await Application.bootstrapWithPlugins(
        {
            entryPoints: dirs,
            entryPointStrategy: "packages",
            // The 13 plugins have NO `typedoc.json`, and it is intended:
            // `generated-artifacts.cjs#declaredOutputs()` THROWS for any package
            // typedoc.json lacking `out`. Creating 13 would create 13 errors at the
            // hygiene check 5c. `packageOptions` covers them without a byte of
            // per-plugin config. The core, for its part, has its config — TypeDoc
            // reads it and it WINS over these options.
            packageOptions: { ...shared, entryPoints: ["src"], entryPointStrategy: "expand" },
            name: "GeoLeaf API surface",
            ...shared,
        },
        [new TypeDocReader(), new TSConfigReader()]
    );

    const project = await app.convert();
    if (!project) {
        throw new Error(
            "[API-SURFACE] TypeDoc n'a rien converti. La gate refuse de conclure — un " +
                "manifeste vide se comparerait à lui-même et sortirait vert en ne décrivant rien."
        );
    }

    const lines = [];
    project.traverse(function walk(r) {
        lines.push(`${ReflectionKind[r.kind]} | ${r.getFullName()} | doc:${docFingerprint(r)}`);
        r.traverse(walk);
        return true;
    });
    lines.sort();

    const modules = (project.children || []).map((c) => c.name);
    if (lines.length === 0) {
        throw new Error("[API-SURFACE] manifeste vide — voir ci-dessus, même motif.");
    }
    // Anti-shrunken-perimeter: `packages` mode can convert FEWER packages than given
    // without it being a TypeDoc error. An amputated perimeter would produce a
    // shorter manifest, coherent with itself, and the gate would stay green on what
    // it no longer looks at. The failure mode `probe-gate-visibility.cjs` hunts
    // elsewhere.
    if (modules.length !== dirs.length) {
        throw new Error(
            `[API-SURFACE] ${modules.length} paquet(s) converti(s) pour ${dirs.length} ` +
                `demandé(s) — périmètre amputé, la gate refuse de conclure.\n` +
                `    demandés : ${dirs.map((d) => path.relative(ROOT, d)).join(", ")}\n` +
                `    obtenus  : ${modules.join(", ")}`
        );
    }

    return {
        content: BANNER + lines.join("\n") + "\n",
        stats: { packages: modules.length, reflections: lines.length, modules },
    };
}

async function main() {
    const { content, stats } = await build();
    const width = 72;

    if (!CHECK) {
        fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
        fs.writeFileSync(OUT_FILE, content);
        console.log(
            `✅ [API-SURFACE] ${path.relative(ROOT, OUT_FILE)} — ` +
                `${stats.reflections} réflexion(s) sur ${stats.packages} paquet(s).`
        );
        if (VERBOSE) console.log(`   paquets : ${stats.modules.join(", ")}`);
        return 0;
    }

    console.log("─".repeat(width));
    if (!fs.existsSync(OUT_FILE)) {
        console.log(
            `❌ [API-SURFACE] ${path.relative(ROOT, OUT_FILE)} est ABSENT.\n` +
                `   Lancer : npm run gen:api-surface — puis commiter le résultat.`
        );
        console.log("─".repeat(width));
        return 1;
    }
    // BYTE comparison on the in-memory built content, never a re-parse: same pattern
    // as `generate-docs-tree.cjs` and `gen-config-reference.cjs`.
    const onDisk = fs.readFileSync(OUT_FILE, "utf8");
    if (onDisk !== content) {
        const a = onDisk.split("\n");
        const b = content.split("\n");
        const added = b.filter((l) => !a.includes(l)).slice(0, 8);
        const removed = a.filter((l) => !b.includes(l)).slice(0, 8);
        console.log(
            `❌ [API-SURFACE] le manifeste est PÉRIMÉ — la surface publique a bougé depuis la\n` +
                `   dernière génération (${a.length - 14} ligne(s) commitée(s) contre ${b.length - 14} mesurée(s)).\n` +
                `   Lancer : npm run gen:api-surface — puis commiter le résultat.\n`
        );
        if (removed.length) {
            console.log(`   Disparu du code (${removed.length > 8 ? "8 premiers" : "tout"}) :`);
            for (const l of removed) console.log(`     − ${l}`);
        }
        if (added.length) {
            console.log(`   Apparu dans le code (${added.length > 8 ? "8 premiers" : "tout"}) :`);
            for (const l of added) console.log(`     + ${l}`);
        }
        console.log("─".repeat(width));
        return 1;
    }

    console.log(
        `✅ [API-SURFACE] à jour — ${stats.reflections} réflexion(s), ${stats.packages} paquet(s).`
    );
    if (VERBOSE) console.log(`   paquets : ${stats.modules.join(", ")}`);
    console.log("─".repeat(width));
    return 0;
}

main().then(
    (code) => process.exit(code),
    (err) => {
        console.error(String(err && err.message ? err.message : err));
        process.exit(2);
    }
);
