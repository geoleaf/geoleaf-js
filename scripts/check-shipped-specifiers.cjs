#!/usr/bin/env node
/**
 * @fileoverview SHIP-SPEC — the BARE specifiers the tarball carries must resolve on
 * the integrator's side, not only in this monorepo.
 *
 * ## The defect this gate exists to catch
 *
 * Six publishable `.d.ts` imported packages that return **404 on npm**. No gate could
 * see it, and the reason is structural: **npm workspaces' symlinks mask the entire
 * class.** `@geoleaf/host-runtime` resolves perfectly here — it sits in
 * `node_modules/` via symlink — and it exists nowhere on the registry. Green locally,
 * `TS2307` on the integrator's side.
 *
 * The two neighbouring gates miss it, each for its own reason, and one must keep them
 * in mind not to believe this one is redundant:
 *
 *   - `verify-published-types.cjs` (PUB-TYPES) **compiles nothing**: it reads
 *     `package.json` and the disk. It verifies the `types` entry's REACHABILITY,
 *     never the RESOLVABILITY of its transitive imports.
 *   - `typecheck:consumer` does compile, but it compiles from
 *     `packages/core/examples/`, hence **inside the monorepo**: the symlinks are
 *     there, and `@geoleaf/host-runtime` resolves. The compiler cannot see what will
 *     only be absent at someone else's.
 *
 * The only way to decide offline is to compare the specifier to the CONTRACT the
 * package publishes — its `dependencies` — and to what the repo knows of the target:
 * a `private` workspace will never be on the registry, however it is declared.
 *
 * ## 🛑 THE TARBALL GATES' OVERLAP — written HERE, and nowhere else
 *
 * Four instruments judge what ships in a tarball. **None said what it does NOT
 * cover**, and that silence is what cost: one reads a green, one infers a guarantee
 * wider than its own. The table is here because this file is the most recent of the
 * four and the only one already comparing its neighbours; the other three point here.
 *
 * | Gate | The question it asks | What it CANNOT see |
 * | --- | --- | --- |
 * | **SHIP-SPEC** (here) | does a BARE specifier of a reachable file resolve on the integrator's side? | a symbol's VISIBILITY — an unexported type reaching the published `.d.ts` surfaces no foreign specifier |
 * | **PUB-TYPES** (`verify-published-types.cjs`) | is the `types` entry reachable? | what that entry IMPORTS, transitively — it compiles nothing |
 * | **check 4** (`check-versions.cjs`) | are the dependency maps coherent? | the `.d.ts` — it reads `package.json` files, never emitted code |
 * | **`typecheck:consumer`** | does the package compile for a consumer? | what is only absent OUTSIDE the monorepo: it compiles from `packages/core/examples/`, where workspace symlinks resolve everything |
 *
 * ⚠️ **THE EMPTY CELL IS KNOWN, AND NO FOURTH GATE WILL FILL IT BY ADDITION.** An
 * internal, unexported type reaching the published declaration is invisible to
 * SHIP-SPEC **by construction** — it introduces no foreign specifier, so its zero
 * says nothing about it. SHIP-SPEC's empty baseline (`entries: 0`) can thus coexist
 * with that entire class open: **two different questions on the same file**, one
 * about an import's TARGET, the other about a symbol's VISIBILITY.
 *
 * 📌 This table is the requested move — "the overlap itself is what must be written,
 * not a fourth gate". A green is only worth what its question is worth, and a
 * question one cannot read reads as a guarantee.
 *
 * ## The three rules
 *
 *   SHIP-SPEC-01  Every BARE specifier of a REACHABLE file must be declared in the
 *                 package's runtime dependencies (`dependencies`, `peerDependencies`,
 *                 `optionalDependencies`). A specifier absent from all three only
 *                 resolves on the integrator's side by luck — a transitive hoist no
 *                 contract promises. Ratchet: a baseline that can only SHRINK.
 *                 ⚠️ ONE single equivalence, and it is CONDITIONED on the file type:
 *                 in a DECLARATION file (`.d.ts`/`.d.mts`/`.d.cts`), declaring
 *                 `@types/X` satisfies the specifier `X`. See "The DefinitelyTyped
 *                 equivalence" below — without it, the gate demanded something
 *                 IMPOSSIBLE.
 *   SHIP-SPEC-02  No reachable file may name a `private: true` workspace.
 *                 **No baseline, no exemption**: that target will never be on the
 *                 registry, so declaring it in `dependencies` would repair nothing —
 *                 it would satisfy 01 while making the package uninstallable. It is
 *                 exactly the false exit 02 closes, and why the two rules exist
 *                 separately rather than as one.
 *   SHIP-SPEC-03  Corpus floor. A gate going green having scanned nothing is the
 *                 worst outcome — and here the risk is concrete: the corpus is
 *                 `dist/`, which does not exist before a build. Without a floor, a
 *                 pre-build run would announce "0 leaks" reading zero bytes.
 *
 * ## What defines the corpus, and why it is NOT `files[]`
 *
 * The corpus is DERIVED from each package's `exports` map: the root of each target
 * (`./dist/types/index.d.ts` → `dist/`). It is the set of what a consumer can reach,
 * and it is what gives the verdict its meaning.
 *
 * `files[]` is wider, and the difference is not a detail: **13 of the 14 publishable
 * packages ship `src/` in their tarball**, where 82 files import
 * `@geoleaf/host-runtime`. Measured on 2026-08-09: **none of those 14 packages
 * exposes a `./src/*` subpath** — their `exports` map only carries `.` and
 * `./package.json`. Those 82 files are thus TARBALL WEIGHT, not type leaks: neither
 * `tsc` (in `node16`/`bundler` resolution) nor Node can open them. Conflating them
 * would mean announcing 84 leaks where an integrator's compiler meets only 2.
 *
 * ⚠️ The distinction is WATCHED, not assumed: the count of shipped-but-unreachable
 * files carrying a dubious specifier prints at every run, and the day a package
 * exposed `./src/*`, the derivation above widens the corpus on its own — without
 * anyone having to think of it. The fate of `src/` in the tarball is a separate
 * decision, not this gate's.
 *
 * ## Why PRIVATE packages are scanned too
 *
 * The natural filter would be `registry.publishable()` — a private package has no
 * tarball. The corpus is nonetheless `registry.all()`, for two reasons, the first
 * substantive: **`@geoleaf/host-runtime` is BUNDLED INLINE into the 12 published
 * plugins.** A 404 specifier in ITS sources thus travels into published bundles,
 * without ever appearing in its own tarball — which does not exist. Restricting to
 * publishables would leave that path unguarded. Measured on 2026-08-09: the widening
 * adds 18 files and **0 violations** — it costs nothing today and closes a real path.
 * The second reason is instrumental: it makes the gate PROBEABLE. The
 * `probe-gate-visibility.cjs` probe plants a `private: true` package; with the narrow
 * filter, the fixture would have been invisible and the assertion would have passed
 * green proving nothing.
 *
 * ## AST, never grep — and it is not a style preference
 *
 * A grep census on this same corpus surfaces `@geoleaf-plugins/table` as an
 * undeclared import of `@geoleaf/core` — i.e. a violation of the boundary the project
 * instructions call non-negotiable. **It is a false positive**: the five sites are
 * `import('@geoleaf-plugins/table')` inside a TSDoc `@example`. A comment stripper
 * would suffice, but the repo's (`lib/test-load-sites.cjs`) also blanks string
 * CONTENT — correct for its use, fatal for this one, where the string IS the data.
 * The TypeScript reader has neither defect: it does not see comments, and it returns
 * the specifier as-is.
 *
 * ## Usage
 *
 *        node scripts/check-shipped-specifiers.cjs
 *        node scripts/check-shipped-specifiers.cjs --update-baseline
 *
 * ⚠️ Runs AFTER a build — the corpus is `dist/`. `--update-baseline` runs AFTER
 * fixing, never to silence: each entry must carry its owner in `_proprietaires`,
 * failing which the list becomes a permit instead of a register. That field is TAKEN
 * BACK from the file at each regeneration and pruned of settled specifiers — it came
 * from a template coded here until 2026-08-10, which silently cancelled the
 * hand-written owner correction (see the `if (UPDATE)` block).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");

const ROOT = registry.ROOT;
const BASELINE = path.join(ROOT, "scripts", ".baselines", "shipped-specifiers.json");
const UPDATE = process.argv.includes("--update-baseline");

const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };
const err = (m) => console.error(`${C.r}${m}${C.x}`);
const dim = (m) => console.error(`${C.d}${m}${C.x}`);

/**
 * Witness floors — 2026-08-09 measurement: 15 contributing packages, 1,361 corpus
 * files.
 *
 * Deliberately BELOW the measurement: they detect a COLLAPSE (empty corpus, registry
 * ceasing to enumerate, absent build), not one unit fewer. A floor flush with the
 * measurement gets re-ratcheted at every build and ends up raised without a thought —
 * i.e. disarmed.
 *
 * ⚠️ This floor, and not a fixture, is what guards the BLINDNESS TO NESTED PACKAGES.
 * 14 of the 15 contributors live under `packages/plugins/**` or `packages/libs/**`:
 * the day the registry stopped enumerating them, `packagesScanned` would drop to 1
 * and the floor would go red instead of announcing "0 leaks" on an amputated corpus.
 */
const FLOOR = { packages: 12, files: 800 };

/** Extensions of a module TypeScript or Node can open. `.map` and `.css` are out of scope. */
const CODE_EXT = /\.(d\.[cm]?ts|[cm]?ts|[cm]?js)$/;

// ─── Corpus ──────────────────────────────────────────────────────────────────

/**
 * Every target of an `exports` map, whatever its shape (string, condition object,
 * subpaths, fallback arrays).
 *
 * @param {unknown} node An `exports` value.
 * @param {string[]} [out] Accumulator.
 * @returns {string[]} The relative target paths, `./` included.
 */
function exportTargets(node, out = []) {
    if (typeof node === "string") {
        out.push(node);
    } else if (Array.isArray(node)) {
        for (const v of node) exportTargets(v, out);
    } else if (node && typeof node === "object") {
        for (const v of Object.values(node)) exportTargets(v, out);
    }
    return out;
}

/**
 * The directories a consumer can reach through the `exports` map.
 *
 * We climb to each target's ROOT (`./dist/types/index.d.ts` → `dist`) rather than
 * follow the imports' closure: following the closure would make the corpus depend on
 * a resolution which is, precisely, what is in doubt. Taking the directory is wider,
 * hence safer — a gate must never shrink its corpus through refinement.
 *
 * @param {object} manifest The package's `package.json`.
 * @returns {Set<string>} Relative roots, POSIX separators (e.g. `"dist"`).
 */
function reachableRoots(manifest) {
    const roots = new Set();
    for (const target of exportTargets(manifest.exports)) {
        if (typeof target !== "string" || !target.startsWith(".")) continue;
        const rel = target.replace(/^\.\//, "");
        const first = rel.split("/")[0];
        if (!first || first === "." || first === "..") continue;
        roots.add(first);
    }
    return roots;
}

/** @param {string} dir @param {string[]} [out] @returns {string[]} */
function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs, out);
        else if (CODE_EXT.test(entry.name)) out.push(abs);
    }
    return out;
}

// ─── Reading the specifiers ──────────────────────────────────────────────────

/**
 * Every module specifier of a file, read off the AST.
 *
 * Five forms carry a specifier, and all five count — a `.d.ts` does not use the same
 * ones as a bundle. `import("x").T` (`ImportTypeNode`) is the easiest form to forget:
 * it is the one `tsc` emits when inlining an imported type.
 *
 * @param {string} file Absolute path.
 * @returns {string[]} The specifiers, in reading order.
 */
function specifiersOf(file) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, /* setParentNodes */ false);
    const found = [];
    const push = (node) => {
        if (node && ts.isStringLiteralLike(node)) found.push(node.text);
    };
    const visit = (node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            push(node.moduleSpecifier);
        } else if (ts.isImportTypeNode(node)) {
            if (ts.isLiteralTypeNode(node.argument)) push(node.argument.literal);
        } else if (ts.isImportEqualsDeclaration(node)) {
            if (ts.isExternalModuleReference(node.moduleReference))
                push(node.moduleReference.expression);
        } else if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === "require"))
        ) {
            push(node.arguments[0]);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

/**
 * Builtins without the `node:` prefix — a package never declares them.
 *
 * DERIVED from Node itself, never copied: a hand-written list ages in silence, and
 * the day it misses a name the gate demands a `dependencies` on a core module.
 */
const NODE_BUILTINS = new Set(require("node:module").builtinModules);

/**
 * The DefinitelyTyped equivalence — `geojson` ⇐ `@types/geojson`.
 *
 * ## Why this function exists, and what it REPAIRS
 *
 * Measured on 2026-08-10: the gate compared the `geojson` specifier to the KEYS of
 * `dependencies`, where the package to declare is named `@types/geojson`. The two
 * strings can never be equal — **the move the error message prescribed thus could
 * NOT make the gate green**, and the 6 baseline entries would have stayed for good
 * whatever one declared. This is not a loosening: it is the resolution rule the gate
 * claimed to model. `tsc` resolves `import type { … } from "geojson"` by opening
 * `node_modules/@types/geojson` — the correct contract is indeed `@types/geojson` in
 * `dependencies`, and that is what this function makes recognizable.
 *
 * ## 🛑 What it does NOT do, and why the restriction is the rule's core
 *
 * It is only consulted for DECLARATION files. `@types/X` publishes **no runtime**: a
 * `require("geojson")` in a shipped `.js` remains a violation, and it MUST — otherwise
 * the line below would be an escape hatch that would whitewash, over the whole corpus,
 * the very class SHIP-SPEC-01 exists to catch. The restriction is proven by mutation:
 * a `.js` planting `require("geojson")` in a package declaring `@types/geojson` makes
 * the gate go red (anti-escape witness).
 *
 * @param {string} name Package name (`"geojson"`, `"@scope/nom"`).
 * @returns {string} The matching DefinitelyTyped name (`"@types/geojson"`,
 *   `"@types/scope__nom"`) — DefinitelyTyped's naming convention.
 */
function typesPackageOf(name) {
    return name.startsWith("@") ? `@types/${name.slice(1).replace("/", "__")}` : `@types/${name}`;
}

/** A DECLARATION file — the only place where the `@types/` equivalence holds. */
const DECL_EXT = /\.d\.[cm]?ts$/;

/**
 * A specifier's PACKAGE NAME, or `null` if it designates none.
 *
 * @param {string} spec Raw specifier.
 * @returns {string|null} `"@scope/nom"`, `"nom"`, or `null` (relative, absolute, builtin, URL).
 */
function packageOf(spec) {
    if (!spec) return null;
    // `#imports` = internal imports (`package.json#imports`): never a registry package.
    if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("#")) return null;
    // `node:fs`, `data:…`, `https://…` — a protocol, not a package.
    if (/^[a-z][a-z0-9.+-]*:/i.test(spec)) return null;
    const parts = spec.split("/");
    const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    if (!name || NODE_BUILTINS.has(name)) return null;
    return name;
}

// ─── Balayage ────────────────────────────────────────────────────────────────

const privateWorkspaces = new Set(
    registry
        .all()
        .filter((p) => p.private)
        .map((p) => p.name)
);

/** @type {{code: string, key: string, message: string}[]} */
const violations02 = [];
/** @type {string[]} */
const found01 = [];
/** @type {Map<string, string>} 01 key → readable message. */
const detail01 = new Map();
/** @type {string[]} Packages with a reachable root missing on disk. */
const missingRoots = [];

let packagesScanned = 0;
let filesScanned = 0;
/** SHIPPED yet UNREACHABLE files carrying a dubious specifier — see the header. */
let shippedUnreachable = 0;

for (const pkg of registry.all()) {
    const manifest = pkg.manifest;
    const declared = new Set([
        ...Object.keys(manifest.dependencies || {}),
        ...Object.keys(manifest.peerDependencies || {}),
        ...Object.keys(manifest.optionalDependencies || {}),
    ]);

    const roots = reachableRoots(manifest);
    /** @type {string[]} */
    const corpus = [];
    for (const root of roots) {
        const abs = path.join(pkg.absDir, root);
        if (!fs.existsSync(abs)) {
            // An `exports` target can be a FILE (`./package.json`) — normal.
            if (!/\.[a-z]+$/i.test(root)) missingRoots.push(`${pkg.dir}/${root}`);
            continue;
        }
        if (fs.statSync(abs).isDirectory()) corpus.push(...walk(abs));
    }
    if (corpus.length > 0) packagesScanned += 1;
    filesScanned += corpus.length;

    for (const file of corpus) {
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        for (const spec of new Set(specifiersOf(file))) {
            const name = packageOf(spec);
            if (!name || name === manifest.name) continue;

            if (privateWorkspaces.has(name)) {
                violations02.push({
                    code: "SHIP-SPEC-02",
                    key: `${rel} → ${name}`,
                    message:
                        `${rel}\n        importe \`${spec}\` — workspace \`private: true\`, ` +
                        `donc 404 sur le registre pour TOUJOURS.\n        Le déclarer en ` +
                        `\`dependencies\` ne répare rien : ça rendrait le paquet non installable.`,
                });
                continue;
            }
            // The DefinitelyTyped equivalence, CONDITIONED on the declaration file —
            // see `typesPackageOf` for the rationale and what it refuses to cover.
            const viaTypes = DECL_EXT.test(file) && declared.has(typesPackageOf(name));

            if (!declared.has(name) && !viaTypes) {
                const key = `${rel} → ${name}`;
                found01.push(key);
                detail01.set(
                    key,
                    `${rel}\n        importe \`${spec}\` — \`${name}\` n'est ni dependency, ` +
                        `ni peerDependency, ni optionalDependency de ${manifest.name}` +
                        (DECL_EXT.test(file)
                            ? `,\n        et \`${typesPackageOf(name)}\` non plus.`
                            : `.`)
                );
            }
        }
    }

    // ── The out-of-corpus, counted and named (never blocking here) ───────────
    const shippedRoots = new Set(
        (manifest.files || [])
            .filter((f) => typeof f === "string" && !f.startsWith("!"))
            .map((f) => f.replace(/^\.\//, "").replace(/\/$/, "").split("/")[0])
    );
    for (const root of shippedRoots) {
        if (roots.has(root)) continue;
        const abs = path.join(pkg.absDir, root);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
        for (const file of walk(abs)) {
            const suspect = [...new Set(specifiersOf(file))].some((spec) => {
                const name = packageOf(spec);
                return (
                    Boolean(name) &&
                    name !== manifest.name &&
                    (privateWorkspaces.has(name) || !declared.has(name))
                );
            });
            if (suspect) shippedUnreachable += 1;
        }
    }
}

// ─── SHIP-SPEC-03 — the floor, BEFORE any verdict ────────────────────────────

if (missingRoots.length > 0) {
    err(
        `\n❌ [SHIP-SPEC-03] ${missingRoots.length} racine(s) atteignable(s) absente(s) du disque :`
    );
    for (const m of missingRoots) err(`     - ${m}`);
    dim("  Le corpus de cette gate est `dist/` : elle tourne APRÈS un build.");
    dim("  Lancer `npx turbo run build`, puis relancer. REFUSE DE CONCLURE.");
    process.exit(1);
}
if (packagesScanned < FLOOR.packages || filesScanned < FLOOR.files) {
    err(
        `\n❌ [SHIP-SPEC-03] corpus sous le plancher — ${packagesScanned} paquet(s) ` +
            `(plancher ${FLOOR.packages}), ${filesScanned} fichier(s) (plancher ${FLOOR.files}).`
    );
    dim("  Un « 0 fuite » depuis ce corpus serait vrai et vide de sens. REFUSE DE CONCLURE.");
    process.exit(1);
}

// ─── Baseline regeneration ───────────────────────────────────────────────────

if (UPDATE) {
    const entries = [...new Set(found01)].sort();

    // ── `_proprietaires`: TAKEN BACK from the file, never rewritten from a template ──
    //
    // 🛑 This block was HARD-CODED here, and it is a trap that bit. The owner of the
    // `geojson` class had been corrected by hand IN the JSON — the original pointer
    // was wrong, re-read at the recipient's. The first regeneration silently replaced
    // it with the original template, hence with the false statement: a documentary
    // correction cancelled by an `--update-baseline`, without a word. A field the
    // tool rewrites cannot carry a fact the human corrects.
    //
    // And the carry-over alone would not suffice: an owner whose debt is SETTLED
    // would become a comment describing a vanished state — exactly the documented
    // staleness class. Hence the pruning: an owner only survives while at least one
    // entry concerns it.
    let proprietaires = {};
    if (fs.existsSync(BASELINE)) {
        try {
            const prev = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
            for (const [spec, motif] of Object.entries(prev._proprietaires || {})) {
                if (entries.some((e) => e.endsWith(`→ ${spec}`))) proprietaires[spec] = motif;
            }
        } catch (_e) {
            proprietaires = {}; // baseline illisible — on repart d'un registre vide, jamais d'un gabarit
        }
    }

    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        JSON.stringify(
            {
                _comment: [
                    "Specifiers NUS non déclarés, CONNUS, de SHIP-SPEC-01 — un permis daté, pas un droit acquis.",
                    "",
                    "⚠️ SHIP-SPEC-02 n'a PAS de baseline et n'en aura pas : un workspace `private` ne sera",
                    "jamais sur le registre, donc aucune entrée ne pourrait être autre chose qu'un renoncement.",
                    "",
                    "Cette liste ne peut que RÉTRÉCIR. Régénérer avec --update-baseline APRÈS correction,",
                    "jamais pour faire taire. Chaque entrée doit nommer son propriétaire ci-dessous —",
                    "`_proprietaires` est REPRIS de ce fichier à chaque régénération, et élagué des",
                    "specifiers qui n'ont plus d'entrée. Un motif écrit ici survit donc à l'outil.",
                    "",
                    "📌 Elle est tombée à ZÉRO le 10/08/2026 : la classe `geojson` — 6 `.d.ts`",
                    "publiés d'editor, file-import et flatgeobuf — a été soldée en déclarant",
                    "`@types/geojson` en `dependencies` sur les trois manifestes. Une entrée qui",
                    "réapparaîtrait ici serait donc une RÉGRESSION, pas une première observation.",
                ],
                _proprietaires: proprietaires,
                _generated: "node scripts/check-shipped-specifiers.cjs --update-baseline",
                entries,
            },
            null,
            4
        ) + "\n"
    );
    console.log(
        `✅ [SHIP-SPEC] baseline régénérée — ${new Set(found01).size} entrée(s) SHIP-SPEC-01.`
    );
    process.exit(0);
}

// ─── Verdict ─────────────────────────────────────────────────────────────────

if (!fs.existsSync(BASELINE)) {
    err("\n❌ [SHIP-SPEC] baseline absente.");
    dim("  Une baseline absente n'est PAS une liste vide : ce serait déclarer propre");
    dim("  tout le corpus. Run: node scripts/check-shipped-specifiers.cjs --update-baseline");
    process.exit(1);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
const seen = new Set(found01);
const fresh = [...seen].filter((k) => !baseline.has(k)).sort();
const stale = [...baseline].filter((k) => !seen.has(k)).sort();

let failed = false;

if (violations02.length > 0) {
    failed = true;
    err(
        `\n❌ [SHIP-SPEC-02] ${violations02.length} fichier(s) atteignable(s) nomment un workspace PRIVÉ :`
    );
    for (const v of violations02) err(`     - ${v.message}`);
    dim("  Geste : remplacer le symbole importé par une déclaration LOCALE (interface ou");
    dim("  enveloppe à signature écrite). Ne pas dériver par `typeof` — ça re-référencerait");
    dim("  l'import, donc la fuite.");
}

if (fresh.length > 0) {
    failed = true;
    err(`\n❌ [SHIP-SPEC-01] ${fresh.length} specifier(s) NON DÉCLARÉ(S) et hors baseline :`);
    for (const k of fresh) err(`     - ${detail01.get(k)}`);
    dim("  Deux issues, et une seule est honnête selon le cas : déclarer le paquet dans");
    dim("  `dependencies`, ou cesser de l'importer depuis un fichier atteignable.");
    dim("  Pour un import de TYPE dans un `.d.ts`, le paquet à déclarer est `@types/<nom>` —");
    dim("  c'est ce que `tsc` ouvre, et la gate le reconnaît (jamais dans un `.js`).");
}

if (stale.length > 0) {
    failed = true;
    err(`\n❌ [SHIP-SPEC-01/cliquet] ${stale.length} entrée(s) de baseline PÉRIMÉE(S) :`);
    for (const k of stale) err(`     - ${k}`);
    dim("  La baseline est un registre de dette, pas un droit acquis : elle ne peut que");
    dim("  rétrécir. node scripts/check-shipped-specifiers.cjs --update-baseline");
}

if (failed) process.exit(1);

console.log(
    `✅ [SHIP-SPEC] ${filesScanned} fichier(s) atteignable(s) sur ${packagesScanned} paquet(s) du ` +
        `registre — 0 workspace privé (SHIP-SPEC-02), ${baseline.size} specifier(s) non ` +
        `déclaré(s) en baseline (SHIP-SPEC-01).`
);
console.log(
    `${C.d}   ${shippedUnreachable} fichier(s) EMBARQUÉ(S) mais non atteignable(s) par \`exports\` ` +
        `portent un specifier douteux — poids de tarball, pas fuite de types ; le sort de \`src/\` ` +
        `dans le tarball est tranché à part.${C.x}`
);
process.exit(0);
