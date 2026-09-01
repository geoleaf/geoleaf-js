#!/usr/bin/env node
/**
 * audit-test-load-conversion.cjs — triage and sensitivity proofs (coverage conversion).
 *
 * ## What it serves, and why it is not a gate
 *
 * `verify-test-load-mode.cjs` freezes the debt: it forbids one MORE
 * `require()` site. This one accompanied its repayment — it says **what to
 * convert** (`--triage`), and it proves the conversion extinguished
 * neither a mock's sensitivity (`--prove-mocks`) nor a reload
 * (`--prove-reload`).
 *
 * It is deliberately NOT wired into `ci:local`: the durable property is
 * the decreasing baseline; these proofs are **punctual**, to replay on demand.
 *
 * ## The trap these checks exist to avoid
 *
 * A converted test stays **green** even if its mock no longer bites, or a
 * reload stopped reloading. Greenness proves nothing. The `--prove-mocks`
 * and `--prove-reload` harnesses freeze a sensitivity record the first
 * time, then refuse any batch where a file LOST it: the invariant is
 * before/after EQUALITY, proven by mutation (neutralising the mock or
 * breaking the reload must turn red), not "it must turn red".
 *
 * ## One package at a time
 *
 * The subcommands bear on **the package designated by `--pkg`** (default:
 * `@geoleaf/core`). The package used to be hardcoded; the `SCOPE` could
 * widen without the records following.
 *
 * Usage :
 *   node scripts/audit-test-load-conversion.cjs --triage                          # what to convert
 *   node scripts/audit-test-load-conversion.cjs --prove-mocks  <name> [files…]  # mock sensitivity
 *   node scripts/audit-test-load-conversion.cjs --prove-reload <name> [files…]  # reload sensitivity
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ts = require("typescript");
const registry = require("./lib/packages.cjs");
const sites = require("./lib/test-load-sites.cjs");

const ROOT = path.resolve(__dirname, "..");

/**
 * Where the records live — `GEOLEAF_LOAD_AUDIT_DIR`, default `_archive_local/load-conversion/`.
 *
 * ⚠️ The path was `tmp_load-conversion/`, HARDCODED, at the root. Two defects, not one:
 *
 *   • the UNIVERSAL hygiene checklist forbids a permanent `tmp_*` at the
 *     root. The repo was thus in violation of its own end-of-sprint rule —
 *     and that is exactly HOW 126.8 MB stagnated there: gitignored by
 *     `tmp_*`, hence invisible in review, and nobody to reconcile the
 *     folder with the rule;
 *   • 99.94% of those 126.8 MB no longer had a producer. The 8 `run-*`
 *     directories (117.6 MiB) and the 9 `<pkg>--<nom>.json` records were
 *     written by `--snapshot`, deleted at commit 3285f48e (provider
 *     unified on istanbul). The residue of a dead subcommand, not a
 *     retention policy.
 *
 * `_archive_local/` is the sanctioned place for purely local artefacts:
 * already gitignored, already outside the perimeter of ESLint and
 * `verify-repo-hygiene`'s checks 1/1b.
 *
 * ⚠️ The destination is VERIFIED git-ignored, not hoped so. Stronger than
 * the `tmp_*` name net being lost: that one bit at commit, for a prefix;
 * this one bites at WRITE, for any path.
 */
function resolveSnapDir() {
    const raw = process.env.GEOLEAF_LOAD_AUDIT_DIR;
    const abs = raw
        ? path.resolve(ROOT, raw)
        : path.join(ROOT, "_archive_local", "load-conversion");
    const shown = path.relative(ROOT, abs) || abs;

    // `git check-ignore -q`: 0 = ignored, 1 = not ignored. An already
    // TRACKED path returns 1 — the wanted behaviour here, not a bug:
    // writing records there would bring them into the index.
    if (spawnSync("git", ["check-ignore", "-q", abs], { cwd: ROOT }).status !== 0) {
        console.error(
            `✘ audit-test-load-conversion : « ${shown} » n'est pas ignoré par git.\n` +
                `  Les relevés sont des artefacts locaux — le lot du 22/07 pesait 117,6 Mio.\n` +
                `  Y écrire sous un chemin suivi les ferait entrer dans l'index au premier\n` +
                `  « git add -A » : l'accident est déjà enregistré deux fois au CHANGELOG.\n` +
                `  Ajoutez une règle à .gitignore, ou pointez GEOLEAF_LOAD_AUDIT_DIR ailleurs.`
        );
        process.exit(1);
    }
    return abs;
}

/**
 * Announces the destination and what it already weighs.
 *
 * A banal remedy: `tmp_load-conversion/` reached 126.8 MB because NOTHING
 * ever named it. A gitignored folder no tool mentions only gets noticed at
 * `du -sh` — i.e. never. Two output lines suffice to close that.
 */
function announceSnapDir(dir) {
    let files = 0;
    let bytes = 0;
    const walk = (d) => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full);
            else {
                files++;
                bytes += fs.statSync(full).size;
            }
        }
    };
    walk(dir);
    const size =
        bytes > 1024 * 1024
            ? `${(bytes / 1024 / 1024).toFixed(1)} Mio`
            : `${Math.round(bytes / 1024)} Kio`;
    const shown = path.relative(ROOT, dir) || dir;
    console.log(
        `ℹ relevés : ${shown}  (${files} fichier(s), ${size}) — GEOLEAF_LOAD_AUDIT_DIR pour déplacer`
    );
}

const SNAP_DIR = resolveSnapDir();
announceSnapDir(SNAP_DIR);

/**
 * Packages whose conversion this script instructs — the three the 22/07
 * measure designates. The other 14 are already at zero source `require()`.
 */
const SCOPE = ["@geoleaf/core", "@geoleaf-plugins/editor", "@geoleaf-plugins/offline-ui"];

/** Package measured by default, when `--pkg` is not given. */
const DEFAULT_PKG = "@geoleaf/core";

/**
 * The package a subcommand targets (`--pkg`, default `@geoleaf/core`).
 *
 * ⚠️ The name is verified against the registry: an out-of-perimeter
 * `--pkg` fails rather than letting a check bear on something other than
 * what it announces.
 *
 * @param {string} name Manifest name.
 * @returns {object} Registry entry.
 */
function requirePkg(name) {
    if (!SCOPE.includes(name)) {
        console.error(
            `✘ audit-test-load-conversion: « ${name} » est hors périmètre.\n` +
                `  Périmètre : ${SCOPE.join(", ")}`
        );
        process.exit(1);
    }
    const pkg = registry.byName(name);
    if (!pkg) {
        console.error(`✘ audit-test-load-conversion: paquet « ${name} » absent du registre.`);
        process.exit(1);
    }
    return pkg;
}

/**
 * Logging calls tolerated at a module's load.
 *
 * Exemption **written rather than silent**:
 * `Log.debug("[StorageDB] Module loaded")` is a call, hence code executed
 * at import — but it reads nothing the test installs and has no effect a
 * test can observe. Counting it as a "load effect" would classify half of
 * `capabilities/offline/` as C and forbid hoists that are safe. Any other
 * call form remains an effect.
 */
const INERT_CALLEES = new Set(["Log", "console"]);

/** Environment objects: touching them at load makes hoisting dangerous. */
const ENV_GLOBALS = new Set(["self", "window", "globalThis", "document", "navigator"]);

/** @param {string} abs @returns {string} Repo-relative path, POSIX separators. */
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

// ── Site inventory ───────────────────────────────────────────────────────────
//
// `walkTests`, specifier resolution (relative AND bare) and family
// classification live in `lib/test-load-sites.cjs`, shared with the
// `verify-test-load-mode.cjs` gate. They were extracted there: this script
// and the gate each carried a copy, and they had already diverged once —
// the classifier ranking a file "mechanical" had to be fixed IN BOTH
// (`vi.isolateModules`).

// ── Load-inertia analysis (AST) ──────────────────────────────────────────────

/**
 * Is an expression inert, i.e. evaluable without executing anything observable?
 *
 * ⚠️ **We never descend into a function body.» `const DB = { get() { … } }`
 * is inert whatever its methods do: they do not run at import. Descending
 * would classify almost any non-trivial module "active", and the triage
 * would lose its meaning.
 *
 * @param {ts.Node} node Expression to judge.
 * @returns {boolean}
 */
function isInertExpression(node) {
    if (!node) return true;

    // A function body does not execute at import: the value itself is inert.
    if (
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isClassExpression(node) ||
        ts.isMethodDeclaration(node)
    ) {
        return true;
    }

    if (ts.isCallExpression(node)) return isInertCall(node);

    // ⚠️ **An ASSIGNMENT is an effect** — and this guard was missing here
    // while it exists, 350 lines away, in {@link precedingEffects}'s
    // `inert()`. Two neighbouring analyses of the same script diverging on
    // the same judgement: exactly the defect the ADR already records twice
    // (`new Map()`, the family classifier), and which earned the
    // extraction of `lib/test-load-sites.cjs`.
    //
    // What it let through, measured: `built-in/api/geoleaf-api.ts` opens
    // with `_g.GeoLeaf = _g.GeoLeaf || {};` — the public namespace's
    // installation, at load. {@link loadTimeEffects} declared it INERT, so
    // the `geoleaf.api.ts` facade came out "decorative reload" on the R2
    // axis: the opposite of the truth, on the side that makes a
    // load-bearing load get hoisted.
    if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken.kind;
        if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) {
            return false;
        }
    }
    if (ts.isDeleteExpression(node) || ts.isPostfixUnaryExpression(node)) return false;

    // `new Map()`, `new Set()`, `new WeakMap()` — constructions sans effet de bord externe.
    if (ts.isNewExpression(node)) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text : "";
        if (!/^(Map|Set|WeakMap|WeakSet|Date|Error|RegExp|Array|Object)$/.test(name)) return false;
        return (node.arguments || []).every(isInertExpression);
    }

    // Reading an environment global at load counts as an effect: the module
    // then depends on what the test installed BEFORE loading it.
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        let root = node;
        while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) {
            root = root.expression;
        }
        if (ts.isIdentifier(root) && ENV_GLOBALS.has(root.text)) return false;
    }

    let inert = true;
    node.forEachChild((child) => {
        if (!inert) return;
        if (
            ts.isFunctionExpression(child) ||
            ts.isArrowFunction(child) ||
            ts.isMethodDeclaration(child) ||
            ts.isClassExpression(child)
        ) {
            return;
        }
        if (!isInertExpression(child)) inert = false;
    });
    return inert;
}

/**
 * Is a call tolerable at load? Only logging is — see {@link INERT_CALLEES}
 * for the justification, which is written and not assumed.
 *
 * @param {ts.CallExpression} node
 * @returns {boolean}
 */
function isInertCall(node) {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
        return INERT_CALLEES.has(callee.expression.text);
    }
    return false;
}

/**
 * Is a top-level STATEMENT inert?
 *
 * ⚠️ Exists because the {@link INERT_CALLEES} exemption **did not survive
 * a guard**. `Log.info("… Module loaded")` was tolerated;
 * `if (Log) Log.info("… Module loaded")` was not — not by decision, but
 * because an `IfStatement` fell into {@link loadTimeEffects}'s final
 * `flag()`, which only recognised expressions and declarations. Yet it is
 * the repo's MOST common shape: the four `ui/cache-button/` modules carry
 * it, and the plan had drawn "conditional Log.info" from it as a real
 * load-bearing case — a false positive inherited from the tool, not a
 * property of the code.
 *
 * @param {ts.Statement} st
 * @returns {boolean}
 */
function isInertStatement(st) {
    if (ts.isBlock(st)) return st.statements.every(isInertStatement);
    if (ts.isEmptyStatement(st)) return true;
    if (ts.isExpressionStatement(st)) {
        // Directive de fichier (`"use strict";`) — inerte.
        return ts.isStringLiteral(st.expression) || isInertExpression(st.expression);
    }
    if (ts.isIfStatement(st)) {
        return (
            isInertExpression(st.expression) &&
            isInertStatement(st.thenStatement) &&
            (!st.elseStatement || isInertStatement(st.elseStatement))
        );
    }
    return false;
}

/**
 * What a module executes at import — the question that decides whether it can be hoisted.
 *
 * If a module executes nothing at load, the **moment** of its load cannot
 * count: raising its deferred `require()` to a head `import` is safe **by
 * derivation**, not by reading judgement. This function's whole reason for being.
 *
 * @param {string} file Absolute path of a `.ts` module.
 * @returns {{line: number, text: string}[]} Recorded effects, empty if the module is inert.
 */
function loadTimeEffects(file) {
    const src = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const effects = [];

    const flag = (node) => {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        effects.push({ line, text: node.getText(sf).split("\n")[0].slice(0, 90) });
    };

    for (const st of sf.statements) {
        if (
            ts.isImportDeclaration(st) ||
            ts.isImportEqualsDeclaration(st) ||
            ts.isExportDeclaration(st) ||
            ts.isInterfaceDeclaration(st) ||
            ts.isTypeAliasDeclaration(st) ||
            ts.isEnumDeclaration(st) ||
            ts.isFunctionDeclaration(st) ||
            ts.isClassDeclaration(st)
        ) {
            continue;
        }

        if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
                if (!isInertExpression(d.initializer)) {
                    flag(d);
                    break;
                }
            }
            continue;
        }

        if (!isInertStatement(st)) flag(st);
    }

    return effects;
}

/**
 * A target module's module-level state — the R2 axis.
 *
 * ⚠️ **This is NOT {@link loadTimeEffects}, and confusing them inverts the
 * verdict.» Inertia answers "can we hoist?"; R2 answers "does the reload
 * carry anything?". The two diverge on the repo's most common shape:
 *
 *     let _cache = null;   // INERT at load — and yet the WHOLE reason to
 *                          // reload: that is where the state a test wants fresh lives.
 *
 * A module without any module-level state makes its reload **decorative**:
 * the `vi.resetModules()` preceding it changes nothing observable. A
 * finding to write down — the `--prove-reload` harness will confirm it by
 * finding it insensitive on both sides — and not a defect to fix in this
 * sprint.
 *
 * ⚠️ Reservation taken over as-is: **never judge on a MOCKED target.» A
 * factory replaces the module; the real module's state does not exist. The
 * caller excludes it.
 *
 * @param {string} file Absolute path of a `.ts` module.
 * @returns {{line: number, text: string}[]} State carriers, empty if the module is stateless.
 */
function ownModuleState(file) {
    const src = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const held = [];

    const note = (node) =>
        held.push({
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            text: node.getText(sf).split("\n")[0].slice(0, 90),
        });

    /** Does an initialiser create a container whose content can change? */
    const isMutableContainer = (init) => {
        if (!init) return false;
        if (ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init)) return true;
        if (ts.isNewExpression(init)) {
            const name = ts.isIdentifier(init.expression) ? init.expression.text : "";
            return /^(Map|Set|WeakMap|WeakSet)$/.test(name);
        }
        return false;
    };

    for (const st of sf.statements) {
        // A load effect is state by construction: `LayerManagerModule = {…}`,
        // `globalEventManager = new EventListenerManager("global")`,
        // `Object.assign(LS, …)`. The three modules left in class C are
        // exactly of this shape.
        if (!ts.isVariableStatement(st)) {
            if (
                !isInertStatement(st) &&
                !ts.isImportDeclaration(st) &&
                !ts.isExportDeclaration(st)
            ) {
                if (
                    !ts.isInterfaceDeclaration(st) &&
                    !ts.isTypeAliasDeclaration(st) &&
                    !ts.isEnumDeclaration(st) &&
                    !ts.isFunctionDeclaration(st) &&
                    !ts.isClassDeclaration(st)
                ) {
                    note(st);
                }
            }
            continue;
        }

        // Module `let` / `var`: rebindable, hence state — whatever the
        // initial value. The case the inertia analysis (rightly) declares inert.
        const isLet = !(st.declarationList.flags & ts.NodeFlags.Const);
        for (const d of st.declarationList.declarations) {
            if (isLet || isMutableContainer(d.initializer)) {
                note(d);
                break;
            }
        }
    }

    return held;
}

/**
 * Graph-follow depth for {@link moduleState}.
 *
 * ⚠️ **Not a comfort setting, the axis's arbitration** — and there is no
 * "right" depth: R2 degrades continuously with it. Measured on the 21
 * reloading files, in files declared CARRIERS:
 *
 *     depth 0 → 11 · depth 1 → **20** · depth 2 → 21 · depth 3 → 21 out of 21
 *
 * From 2 hops the axis discriminates nothing any more: every module
 * reaches a state carrier if followed far enough. The defect fixed three
 * times on another axis ("71 files out of 84"), and here it is structural,
 * not accidental.
 *
 * **1 is retained because it is the smallest depth that fixes a DERIVABLE
 * defect** — the `geoleaf.*.ts` facades, whose side-effect `import` does
 * the work one hop away (see {@link moduleState}). Beyond, no correctness
 * is bought, separating power is eroded.
 *
 * ⚠️ Consequence to remember: **R2 is an EXPECTATION, not a criterion.»
 * The criterion is `--prove-reload`, which measures instead of deriving. A
 * disagreement between the two settles in the harness's favour, and reads
 * as a correction to bring to R2.
 */
const STATE_DEPTH = 1;

/**
 * A target's module-level state, **following its static imports**.
 *
 * ⚠️ Without that follow, the axis was wrong on exactly the perimeter's
 * most frequent shape. `geoleaf.api.ts` only holds a `"use strict"`, an
 * import and a re-export — R2 declared it "stateless, decorative reload".
 * False: its comment writes that the import is a **side effect** and the
 * real work, `Object.assign(GeoLeaf, {…})`, runs in
 * `built-in/api/geoleaf-api.js`, one hop away. The facade's module is
 * indeed inert; **the facade's load is not**, and that is what the test reloads.
 *
 * The 3rd of the four limits already written in the ADR — "it does not
 * follow the transitive graph". Tolerable while the analysis served to
 * decide a hoist; no longer when it serves to say "reloading this serves
 * nothing".
 *
 * @param {string} file Absolute path of a `.ts` module.
 * @param {object} pkg The package's registry entry.
 * @returns {{line: number, text: string, via: string|null}[]} Empty if nothing has state.
 */
function moduleState(file, pkg) {
    const seen = new Set();

    const visit = (abs, depth, via) => {
        if (seen.has(abs) || !fs.existsSync(abs)) return [];
        seen.add(abs);

        const own = ownModuleState(abs);
        if (own.length) return own.map((h) => ({ ...h, via }));
        if (depth >= STATE_DEPTH) return [];

        const src = fs.readFileSync(abs, "utf8");
        const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
        for (const st of sf.statements) {
            const isImp = ts.isImportDeclaration(st);
            const isExp = ts.isExportDeclaration(st) && st.moduleSpecifier;
            if (!isImp && !isExp) continue;
            const spec = st.moduleSpecifier;
            if (!spec || !ts.isStringLiteral(spec)) continue;
            const hit = sites.resolveSource(abs, spec.text, pkg);
            if (!hit) continue;
            const found = visit(hit.abs, depth + 1, rel(hit.abs));
            if (found.length) return found;
        }
        return [];
    };

    return visit(file, 0, null);
}

// ── TEST-file analysis (the two axes) ────────────────────────────────────────

/**
 * A test file's `vi.mock()` / `vi.doMock()` targets, resolved.
 *
 * ⚠️ **This axis replaces the arbitration the plan announces.» It frames
 * the triage as "**load-bearing** `require()` (bypasses `vi.mock`'s
 * hoisting) vs **habit** `require()`" — yet in this repo `require()`
 * bypasses nothing: the core's `setup.js` intercepts `Module._load` and
 * **serves** the factories to the `require()`s. Proven: on
 * `config/config-loaders.test.js`, neutralising the `vi.mock()`s turns 6
 * tests out of 6 red **before** conversion. The mock was already in force.
 *
 * The useful question is thus not an intention but a specifier
 * resolution: **is this `require()`'s target mocked in the same file?**
 *
 * @param {string} tf Absolute path of the test file.
 * @param {string} src The test file's source.
 * @param {object} pkg The package's registry entry.
 * @returns {Set<string>} Repo-relative paths of the mocked modules.
 */
function mockTargets(tf, src, pkg) {
    const out = new Set();
    for (const m of src.matchAll(/vi\.(?:mock|doMock)\(\s*(['"])([^'"]+)\1/g)) {
        const hit = sites.resolveSource(tf, m[2], pkg);
        if (hit) out.add(rel(hit.abs));
    }
    return out;
}

/**
 * The module variables a `vi.mock()` factory captures — hence the TDZ.
 *
 * ⚠️ **The dominant pattern, and it is neither in the plan nor its
 * schedule.» `vi.mock()` is hoisted above the file's body: a factory
 * closing over a module `const` thus executes **before that `const`
 * exists**. The deferred `require()` masked the defect by calling the
 * factory late. Measured by converting
 * `config/config-loaders.test.js`'s head `require()` to `import`:
 *
 *     ReferenceError: Cannot access 'mockLog' before initialization
 *
 * The gesture is `vi.hoisted()`, which initialises the fixtures before any
 * factory. A declaration whose initialiser IS a `vi.hoisted(...)` is thus
 * safe: it does not count.
 *
 * @param {string} file Absolute path of the test file.
 * @param {string} src The test file's source.
 * @returns {string[]} Captured names — empty if the static import is safe.
 */
function hoistCaptures(file, src) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

    const isHoistedCall = (init) =>
        !!init &&
        ts.isCallExpression(init) &&
        ts.isPropertyAccessExpression(init.expression) &&
        init.expression.name.text === "hoisted";

    /** Names declared at module level, `vi.hoisted()` excluded. */
    const moduleScope = new Set();
    const addNames = (name) => {
        if (ts.isIdentifier(name)) {
            moduleScope.add(name.text);
            return;
        }
        if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
            for (const el of name.elements) if (ts.isBindingElement(el)) addNames(el.name);
        }
    };
    for (const st of sf.statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) {
            if (isHoistedCall(d.initializer)) continue;
            addNames(d.name);
        }
    }
    if (!moduleScope.size) return [];

    const captured = new Set();
    // Only READS count: the `Log` of `{ Log: mockLog }` is a key, and the
    // `b` of `a.b` a property name. Counting them would fabricate captures
    // that do not exist.
    //
    // ⚠️ And only IMMEDIATE reads: we do not descend into a nested
    // function. `() => ({ Log: mockLog })` reads `mockLog` when the
    // factory is called, hence during the hoisted phase — TDZ.
    // `() => ({ get state() { return _sharedState } })` only reads it at
    // the first `.state` access, long after: no TDZ. Same principle as
    // {@link isInertExpression}, which does not descend into a function
    // body either.
    const isFunctionLike = (n) =>
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isMethodDeclaration(n) ||
        ts.isGetAccessorDeclaration(n) ||
        ts.isSetAccessorDeclaration(n);

    const readIdents = (node) => {
        if (isFunctionLike(node)) return;
        if (ts.isPropertyAssignment(node)) return readIdents(node.initializer);
        if (ts.isPropertyAccessExpression(node)) return readIdents(node.expression);
        if (ts.isIdentifier(node)) {
            if (moduleScope.has(node.text)) captured.add(node.text);
            return;
        }
        node.forEachChild(readIdents);
    };
    const scan = (node) => {
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "mock" &&
            node.arguments.length > 1
        ) {
            const factory = node.arguments[1];
            // The factory itself is a function: we enter ITS body, then
            // stop at any deeper function.
            if (isFunctionLike(factory)) {
                if (factory.body) readIdents(factory.body);
            } else {
                readIdents(factory);
            }
        }
        node.forEachChild(scan);
    };
    scan(sf);

    return [...captured].sort();
}

/**
 * What executes at module level BEFORE the test file's first `require()`.
 *
 * ⚠️ **"All `require()`s at top level" does NOT mean "order does not
 * count".» The ADR writes it in black and white — the second of its four
 * triage limits — and one batch held three cases at once:
 * `api/geoleaf-api.test.js` installs `globalThis.GeoLeaf._APIController`
 * before loading, `ui/ui-api.test.js` sets `_g.GeoLeaf._UITheme`, and
 * `ui/desktop-panel-branches.test.js` redefines `window.matchMedia`. All
 * three modules read that environment **at load**: a static `import`,
 * hoisting above, would load before the environment exists.
 *
 * The question is thus derivable, like the target module's inertia — but
 * it bears on the TEST file, and its inert shapes are not the same
 * (`vi.fn()` creates a fixture, `vi.spyOn()` installs a spy). Hence a
 * distinct analysis rather than one more parameter on
 * {@link isInertExpression}, which judges a production module.
 *
 * @param {string} file Absolute path of the test file.
 * @param {string} src The test file's source.
 * @returns {{line: number, text: string}[]} Recorded effects, empty if hoisting is safe.
 */
function precedingEffects(file, src) {
    if (!/require\(\s*['"]\.\.?\//.test(src)) return [];

    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

    // ⚠️ The bound is the statement CARRYING the first `require`, not the
    // word's index. Bounded to the index, the analysis included
    // `const { X } = require(…)` itself and flagged its own `require` as an
    // effect — 72 files out of 84, an axis that discriminates no more.
    const LOAD = /require\(\s*['"]\.\.?\//;
    const loadIdx = sf.statements.findIndex((st) => LOAD.test(st.getText(sf)));
    // No module-level `require`: loading is already deferred, the question
    // does not arise — the case of classes B and C.
    if (loadIdx === -1) return [];

    /** `vi.*` calls without an observable effect: they create a fixture or are hoisted. */
    const VI_INERT = new Set(["fn", "hoisted", "mock", "doMock", "unmock"]);

    /**
     * Suite registrations: `beforeAll(fn)` registers a callback, it does
     * not execute it. The body runs after the module's evaluation, hence
     * never before the head `require`.
     */
    const REGISTRARS = new Set([
        "describe",
        "it",
        "test",
        "beforeAll",
        "beforeEach",
        "afterAll",
        "afterEach",
    ]);

    /**
     * Is a call a mere fixture fabrication?
     *
     * ⚠️ Two shapes, and forgetting the second massively over-flags:
     * `vi.fn()` on one hand, and the CHAIN `vi.fn().mockReturnValue(null)`
     * on the other, which is the normal way to arm a double. The first
     * version counted 71 files out of 84 — nearly the whole perimeter,
     * hence an axis that discriminates nothing any more.
     */
    const isFixtureCall = (node) => {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && REGISTRARS.has(callee.text)) return true;
        if (!ts.isPropertyAccessExpression(callee)) return false;
        if (ts.isIdentifier(callee.expression) && callee.expression.text === "vi") {
            return VI_INERT.has(callee.name.text);
        }
        // `.mockReturnValue(…)`, `.mockImplementation(…)`, … chained on a fixture.
        return (
            callee.name.text.startsWith("mock") &&
            ts.isCallExpression(callee.expression) &&
            isFixtureCall(callee.expression)
        );
    };

    const inert = (node) => {
        if (!node) return true;
        if (
            ts.isFunctionExpression(node) ||
            ts.isArrowFunction(node) ||
            ts.isClassExpression(node)
        ) {
            return true;
        }
        // ⚠️ An ASSIGNMENT is the very effect this axis hunts —
        // `_g.GeoLeaf._UITheme = {…}` installs the environment the module
        // will read at load. The first version descended into it without
        // recognising it and rendered it "inert": a false negative on
        // exactly the case to catch.
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            return false;
        }
        if (ts.isDeleteExpression(node) || ts.isPostfixUnaryExpression(node)) return false;
        if (ts.isCallExpression(node)) {
            return isFixtureCall(node) && node.arguments.every((a) => inert(a));
        }
        // ⚠️ Same allowlist as {@link isInertExpression}, and for the same
        // reason: `new Map()` touches nothing external. The first version
        // refused ANY `new`, so `const state = { layers: new Map() }` — a
        // pure fixture — came out "effect" on seven files. Two neighbouring
        // analyses of the same script diverging on the same judgement is
        // exactly the defect this repo collects.
        if (ts.isNewExpression(node)) {
            const name = ts.isIdentifier(node.expression) ? node.expression.text : "";
            if (!/^(Map|Set|WeakMap|WeakSet|Date|Error|RegExp|Array|Object)$/.test(name)) {
                return false;
            }
            return (node.arguments ?? []).every((a) => inert(a));
        }
        let ok = true;
        node.forEachChild((child) => {
            if (!ok) return;
            if (
                ts.isFunctionExpression(child) ||
                ts.isArrowFunction(child) ||
                ts.isClassExpression(child)
            ) {
                return;
            }
            if (!inert(child)) ok = false;
        });
        return ok;
    };

    const effects = [];
    for (const st of sf.statements.slice(0, loadIdx)) {
        if (
            ts.isImportDeclaration(st) ||
            ts.isFunctionDeclaration(st) ||
            ts.isClassDeclaration(st) ||
            ts.isInterfaceDeclaration(st) ||
            ts.isTypeAliasDeclaration(st)
        ) {
            continue;
        }
        let effectful = false;
        if (ts.isVariableStatement(st)) {
            effectful = st.declarationList.declarations.some((d) => !inert(d.initializer));
        } else if (ts.isExpressionStatement(st)) {
            if (ts.isStringLiteral(st.expression)) continue;
            effectful = !inert(st.expression);
        } else {
            effectful = true;
        }
        if (!effectful) continue;
        effects.push({
            line: sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1,
            text: st.getText(sf).split("\n")[0].slice(0, 76),
        });
    }
    return effects;
}

/**
 * Which of a file's `require()`s are RELOAD sites — the R1 axis.
 *
 * ## Why this axis runs before all the others
 *
 * The family (`classify`) is a **file** attribute: one `vi.resetModules()`
 * somewhere suffices for the whole file to be ranked "reload". The
 * **gesture** is decided at the **site**. Measured on the perimeter: 44
 * sites reload, **15 do not** — ordinary `require()`s cohabiting with a
 * reload located elsewhere in the file, and 3 files out of 25 only have those.
 *
 * Without this axis, the A/B/C classification decides alone — and it
 * decides **badly, on the costly side**. It judges the target's inertia
 * and ranks most of the 44 in class B, "SAFE raise to static `import`".
 * Exact on inertia and false on intention: hoisting would destroy the
 * reload, and **the test would stay green testing the first instance**.
 * The failure mode this whole sprint exists to avoid, and the 1st of the
 * four limits already written in the ADR — "it judges the TARGET module,
 * not the hook's intention".
 *
 * ## What is derived
 *
 * A site reloads if its `require()` is lexically inside a
 * `vi.isolateModules(…)`, if a `vi.resetModules()` precedes it in one of
 * its enclosing blocks, or if it lives in a **module-level helper** —
 * third case, added after seeing it missed.
 *
 * ⚠️ The climb covers ALL enclosing blocks, not only the nearest:
 * `geojson-core.test.js`'s `vi.resetModules()` opens the `beforeEach` and
 * the `require()`s it covers sit in a loop nested two levels below.
 *
 * ⚠️ **The indirect case, and why it counts as a reload.»
 * `utils/runtime-metrics` carries `function loadModule() { … require(…) }`
 * at module level, called from the tests AFTER the `beforeEach`'s
 * `vi.resetModules()`. Lexically, no reset precedes that `require` — the
 * analysis rendered it "collateral", hence hoistable, which would have
 * destroyed the reload leaving the suite green. A helper's calls are
 * elsewhere: one canNOT prove no reset precedes them, and the rule settles
 * that way — "`await import()` costs one word to preserve the order to the letter".
 *
 * @param {string} file Absolute path of the test file.
 * @param {string} src The test file's source.
 * @returns {Map<number, "iso"|"reset"|"indirect">} `require()` line → what reloads it.
 */
function reloadSites(file, src) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

    const requires = [];
    const isolators = [];
    const resets = [];

    const collect = (node) => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            if (ts.isIdentifier(callee) && callee.text === "require") {
                requires.push(node);
            } else if (
                ts.isPropertyAccessExpression(callee) &&
                ts.isIdentifier(callee.expression) &&
                callee.expression.text === "vi"
            ) {
                // ⚠️ `vi.isolateModules` **does not exist in Vitest**
                // (4.1.8: `grep` returns zero). The 5 files calling it only
                // run because `packages/core/__tests__/setup.js`
                // DEFINES it — and its "use Jest's native isolateModules
                // when available" is dead code, `setup.js` setting
                // `globalThis.jest = vi`. What the shim does fits in two
                // lines: `clearCJSCache(); fn();`. The target announced by
                // the plan and the ADR, `vi.isolateModulesAsync()`, does
                // not exist either: the only ESM gesture is
                // `vi.resetModules()` then `await import()`.
                if (/^isolateModules(Async)?$/.test(callee.name.text)) isolators.push(node);
                if (callee.name.text === "resetModules") resets.push(node);
            }
        }
        ts.forEachChild(node, collect);
    };
    collect(sf);

    const covers = (outer, inner) =>
        inner.getStart(sf) >= outer.getStart(sf) && inner.getEnd() <= outer.getEnd();

    /** Suite registrations: their callback executes IN the flow, not elsewhere. */
    const REGISTRARS = new Set([
        "describe",
        "it",
        "test",
        "beforeAll",
        "beforeEach",
        "afterAll",
        "afterEach",
    ]);
    const isFn = (n) =>
        ts.isArrowFunction(n) ||
        ts.isFunctionExpression(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isMethodDeclaration(n);

    /**
     * Does the `require()` live in a module-level helper, rather than a
     * hook's flow? The OUTERMOST function is judged: a `forEach` nested in
     * a `beforeEach` stays flow, and taking it for a helper would over-flag.
     */
    const inModuleHelper = (req) => {
        let outermost = null;
        for (let c = req.parent; c; c = c.parent) if (isFn(c)) outermost = c;
        if (!outermost) return false;
        const par = outermost.parent;
        const isCallback =
            par &&
            ts.isCallExpression(par) &&
            ((ts.isIdentifier(par.expression) && REGISTRARS.has(par.expression.text)) ||
                (ts.isPropertyAccessExpression(par.expression) &&
                    ts.isIdentifier(par.expression.expression) &&
                    par.expression.expression.text === "vi"));
        return !isCallback;
    };

    const out = new Map();
    for (const req of requires) {
        const line = sf.getLineAndCharacterOfPosition(req.getStart(sf)).line + 1;
        if (isolators.some((iso) => covers(iso, req))) {
            out.set(line, "iso");
            continue;
        }
        let verdict = null;
        for (let scope = req.parent; scope && !verdict; scope = scope.parent) {
            if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
            if (resets.some((r) => covers(scope, r) && r.getEnd() < req.getStart(sf))) {
                verdict = "reset";
            }
        }
        if (!verdict && inModuleHelper(req)) verdict = "indirect";
        if (verdict) out.set(line, verdict);
    }
    return out;
}

// ── Triage ───────────────────────────────────────────────────────────────────

/**
 * Classifies the perimeter's "mechanical" test files by conversion gesture.
 *
 * ⚠️ "Mechanical" in `verify-test-load-mode.cjs`'s sense is a NEGATIVE
 * definition — neither `vi.mock()` nor `resetModules()`. It says nothing
 * of the site's SHAPE, and the plan wrongly drew from it that the
 * conversion would be "a specifier replacement". Measured: it only is for
 * class A.
 *
 * @returns {{files: object[], witnesses: string[], loads: Map<string, {req: Set, imp: Set}>}}
 */
function triage() {
    const packages = SCOPE.map(requirePkg);

    /** module source → { req: Set<testFile>, imp: Set<testFile> } — tous paquets confondus. */
    const loads = new Map();
    const touch = (mod) => {
        if (!loads.has(mod)) loads.set(mod, { req: new Set(), imp: new Set() });
        return loads.get(mod);
    };

    // The load graph is computed over the WHOLE repo: a core module can be
    // imported by another package's test, and that decides whether it is a
    // clean witness. The triage only bears on the perimeter.
    const inScope = new Set(packages.map((p) => p.name));
    const files = [];

    for (const p of registry.all()) {
        /** The package's `require()` sites, relative AND bare specifiers (shared lib). */
        const byFile = new Map();
        for (const s of sites.collectSites(p)) {
            if (!byFile.has(s.file)) byFile.set(s.file, []);
            byFile.get(s.file).push(s);
        }

        for (const tf of sites.walkTests(p.absDir)) {
            const relTf = rel(tf);
            const src = fs.readFileSync(tf, "utf8");
            const scrubbed = sites.scrubMocks(src);

            const mySites = (byFile.get(relTf) ?? []).filter((s) => s.mod);
            for (const s of mySites) touch(path.join(ROOT, s.mod)).req.add(tf);

            // The graph's `import` side: relative AND bare, same resolution rules.
            const impSpecs = [
                ...scrubbed.matchAll(/(?:^|\s)import\s[^;]*?from\s*(['"])([^'"]+)\1/g),
                ...scrubbed.matchAll(/(?:await\s+)?import\(\s*(['"])([^'"]+)\1\s*\)/g),
                ...scrubbed.matchAll(/importActual\(\s*(['"])([^'"]+)\1\s*\)/g),
            ].map((m) => m[2]);
            for (const spec of impSpecs) {
                const hit = sites.resolveSource(tf, spec, p);
                if (hit) touch(hit.abs).imp.add(tf);
            }

            if (!mySites.length) continue;
            if (!inScope.has(p.name)) continue;
            // The family definition lives in `lib/test-load-sites.cjs`, not
            // here: it once had to be fixed in TWO scripts at once.
            //
            // ⚠️ The `if (family === "reload") continue;` filter fell, as
            // the "mock" family's had before it. While it held, these 25
            // files were in NO inventory of the tool: neither triage nor
            // `--prove-mocks` (0 of the 16 that nonetheless carry
            // `vi.mock()` appear in that record), and that is where the —
            // false — assertion comes from that the `Module._load` shim
            // would have no consumer left. It has 14, all here.
            const family = sites.classify(src);

            // The mock axes. On the "mechanical" family they are empty by
            // construction — no `vi.mock()`, hence neither mocked target nor capture.
            const hasMocks = family === "mock" || /vi\.(?:do)?mock\(/.test(src);
            const mocked = hasMocks ? mockTargets(tf, src, p) : new Set();

            // The R1 axis — and it MUST run before the A/B/C
            // classification, which ranks a reload site "safe raise": exact
            // on inertia, false on intention, and green once broken.
            const reloading = family === "reload" ? reloadSites(tf, src) : new Map();
            const reloadOf = (s) => reloading.get(s.line) ?? null;
            const reload = mySites.filter((s) => reloadOf(s));

            const deferred = mySites.filter((s) => s.deferred);
            const active = [];
            for (const s of deferred) {
                // ⚠️ A target MOCKED in this file is never evaluated: the
                // factory replaces the module, and what the real module
                // would do at load no longer happens. Judging it "active"
                // ranks the file C — hence "keep the deferred" — for an
                // effect that will not occur. Measured: 4 files out of 7
                // were C only through mocked targets (`config/profile.ts`,
                // `geojson/core.ts`, `basemap-selector.ts`).
                if (mocked.has(s.mod)) continue;
                const eff = loadTimeEffects(path.join(ROOT, s.mod));
                if (eff.length) active.push({ mod: s.mod, effect: eff[0] });
            }

            // ⚠️ These two axes were guarded by `family === "mock"`, which
            // blinded them to the 16 files that ALSO carry `vi.mock()` —
            // yet they are exactly as necessary there: the TDZ does not
            // depend on a `resetModules` elsewhere in the file.
            const captures = hasMocks ? hoistCaptures(tf, src) : [];
            const preceding = hasMocks ? precedingEffects(tf, src) : [];

            // The R2 axis — on the RELOADED targets only, and never on a
            // mocked target (same reservation as above: the real module is
            // not evaluated).
            const stateful = [];
            const stateless = [];
            for (const s of reload) {
                if (mocked.has(s.mod)) continue;
                const held = moduleState(path.join(ROOT, s.mod), p);
                if (held.length) stateful.push({ mod: s.mod, held: held[0] });
                else if (!stateless.includes(s.mod)) stateless.push(s.mod);
            }

            files.push({
                pkg: p.name,
                family,
                file: relTf,
                sites: mySites.length,
                bare: mySites.filter((s) => s.kind === "bare").length,
                modules: [...new Set(mySites.map((s) => s.mod))],
                klass: deferred.length === 0 ? "A" : active.length ? "C" : "B",
                active,
                // Sites whose target is mocked in THIS file: the deferred
                // can be load-bearing there if a mock is configured between
                // the hoisting and the load.
                m1: mySites.filter((s) => mocked.has(s.mod)).length,
                captures,
                preceding,
                // Reload axes. `reload` counts the sites that RELOAD; the
                // file's other sites are ordinary `require()`s, to convert
                // with the standard gesture.
                reload: reload.length,
                reloadIso: mySites.filter((s) => reloadOf(s) === "iso").length,
                stateful,
                stateless,
            });
        }
    }

    // Modules NO test loads through `import`: istanbul only sees a residue
    // for them (`LH:1` to `4`, the import line), so their conversion makes
    // A1 rise frankly. A batch containing none can come out "nothing more
    // than before" while being right — hence this count, which serves to
    // COMPOSE the batches and not to judge them.
    for (const f of files) {
        f.reqOnly = f.modules.filter((m) => {
            const L = loads.get(path.join(ROOT, m));
            return L && !L.imp.size;
        }).length;
    }

    // Clean witnesses: after conversion they will have only ONE load path,
    // so their record is unambiguous. On them A1 has the most probative value.
    const mechFiles = new Set(files.map((f) => f.file));
    const witnesses = [];
    for (const f of files) {
        for (const mod of f.modules) {
            const abs = path.join(ROOT, mod);
            const L = loads.get(abs);
            if (!L || L.imp.size) continue;
            if ([...L.req].some((t) => !mechFiles.has(rel(t)))) continue;
            if (!witnesses.includes(mod)) witnesses.push(mod);
        }
    }

    return { files, witnesses: witnesses.sort(), loads };
}

/** @param {ReturnType<typeof triage>} t */
function printTriage(t) {
    const nSites = (a) => a.reduce((n, f) => n + f.sites, 0);
    const nBare = (a) => a.reduce((n, f) => n + f.bare, 0);
    const line = (label, a, geste) => {
        console.log(`  ${label} : ${a.length} fichiers / ${nSites(a)} sites`);
        console.log(`      → ${geste}`);
    };

    const mech = t.files.filter((f) => f.family === "mechanical");
    const mock = t.files.filter((f) => f.family === "mock");

    console.log("ℹ audit-test-load-conversion — triage\n");
    console.log("  ══ Mécaniques — sprints 2 et 5 ══\n");

    for (const name of SCOPE) {
        const own = mech.filter((f) => f.pkg === name);
        const bare = nBare(own);
        console.log(
            `  ${name.padEnd(26)} ${String(own.length).padStart(3)} fichiers / ` +
                `${String(nSites(own)).padStart(3)} sites` +
                (bare ? `   (dont ${bare} par specifier NU)` : "")
        );
    }

    const by = (k) => mech.filter((f) => f.klass === k);
    const A = by("A"),
        B = by("B"),
        C = by("C");

    console.log("");
    line("A — require() tous au top level ", A, "import statique, remplacement de specifier");
    line(
        "B — différé, module cible INERTE",
        B,
        "remontée en import statique SÛRE (dérivée, pas supposée)"
    );
    line("C — différé, module cible ACTIF ", C, "garder le déféré : await import() dans le hook");
    console.log(
        `\n  TOTAL : ${mech.length} fichiers / ${nSites(mech)} sites` +
            `  ·  ${t.witnesses.length} modules témoins propres (un seul chemin après conversion)`
    );

    if (C.length) {
        console.log("\n  ── Classe C, à instruire un par un ──");
        for (const f of C) {
            console.log(`  • ${f.file}`);
            for (const a of f.active) {
                console.log(`      ${a.mod}:${a.effect.line}  ${a.effect.text}`);
            }
        }
    }

    // ⚠️ `printReloadTriage` is called HERE, not at the function's end: the
    // return below exits as soon as the "mock" family is empty — the case
    // since that debt was settled. Placed after it, the reload section
    // would never have displayed, and the tool would have announced an
    // empty perimeter having simply stopped looking.
    printReloadTriage(t);

    if (!mock.length) return;

    // ── Two axes beyond the position, and they are what decides the gesture.
    // The plan announced an arbitration ("load-bearing vs habit"); both are
    // derived from the source, like the inertia analysis.
    const tdz = mock.filter((f) => f.captures.length);
    const clean = mock.filter((f) => !f.captures.length);
    const m1Sites = mock.reduce((n, f) => n + f.m1, 0);

    console.log("\n\n  ══ vi.mock() — sprint 3 ══\n");
    console.log(`  ${mock.length} fichiers / ${nSites(mock)} sites\n`);

    console.log("  Axe 1 — une factory vi.mock() capture-t-elle une variable de module ?");
    console.log(
        `    OUI  : ${String(tdz.length).padStart(3)} fichiers / ${nSites(tdz)} sites` +
            "   → vi.hoisted() AVANT tout import statique, sinon TDZ"
    );
    console.log(
        `    non  : ${String(clean.length).padStart(3)} fichiers / ${nSites(clean)} sites` +
            "   → import statique direct"
    );

    console.log("\n  Axe 2 — la cible du require() est-elle mockée dans le MÊME fichier ?");
    console.log(
        `    M1   : ${String(m1Sites).padStart(3)} sites` +
            "               → vérifier qu'aucun mock n'est configuré avant le chargement"
    );
    console.log(
        `    M0   : ${String(nSites(mock) - m1Sites).padStart(3)} sites` +
            "               → le triage A/B/C ci-dessus s'applique tel quel"
    );

    const mby = (k) => mock.filter((f) => f.klass === k);
    console.log("\n  Position / inertie, mêmes classes qu'au S2 :");
    console.log(
        `    A ${mby("A").length} fichiers / ${nSites(mby("A"))} sites` +
            `  ·  B ${mby("B").length} / ${nSites(mby("B"))}` +
            `  ·  C ${mby("C").length} / ${nSites(mby("C"))}`
    );

    const pre = mock.filter((f) => f.preceding.length);
    console.log("\n  Axe 3 — quelque chose s'exécute-t-il AVANT le premier require() ?");
    console.log(
        `    OUI  : ${String(pre.length).padStart(3)} fichiers / ${nSites(pre)} sites` +
            "   → garder le déféré : await import(), un import se hisserait au-dessus"
    );

    if (tdz.length) {
        console.log("\n  ── Capture de module, à faire passer par vi.hoisted() ──");
        for (const f of tdz) {
            console.log(`  • ${f.file}  ← ${f.captures.join(", ")}`);
        }
    }

    if (pre.length) {
        console.log("\n  ── Environnement posé avant le chargement, à NE PAS hisser ──");
        for (const f of pre) {
            console.log(`  • ${f.file}`);
            for (const e of f.preceding.slice(0, 3)) console.log(`      :${e.line}  ${e.text}`);
        }
    }
}

/**
 * The "reload" family.
 *
 * @param {ReturnType<typeof triage>} t
 */
function printReloadTriage(t) {
    const reload = t.files.filter((f) => f.family === "reload");
    if (!reload.length) return;

    const nSites = (a) => a.reduce((n, f) => n + f.sites, 0);
    const nReload = reload.reduce((n, f) => n + f.reload, 0);
    const nIso = reload.reduce((n, f) => n + f.reloadIso, 0);

    console.log("\n\n  ══ resetModules() / isolateModules() — sprint 4 ══\n");
    console.log(`  ${reload.length} fichiers / ${nSites(reload)} sites\n`);

    console.log("  Axe R1 — ce require() RECHARGE-t-il, ou cohabite-t-il avec un rechargement ?");
    console.log(
        `    reload      : ${String(nReload).padStart(3)} sites` +
            `  (dont ${nIso} en isolateModules)   → vi.resetModules() + await import() EN PLACE`
    );
    console.log(
        `    collatéral  : ${String(nSites(reload) - nReload).padStart(3)} sites` +
            "                            → geste ordinaire S2/S3 : import statique"
    );
    console.log(
        "    ⚠️ Le classement A/B/C ci-dessus rangerait la plupart des sites « reload » en\n" +
            "       classe B — remontée SÛRE. Exact sur l'inertie, faux sur l'intention : hisser\n" +
            "       détruit le rechargement, et le test reste VERT sur la première instance."
    );

    const pureCollateral = reload.filter((f) => f.reload === 0);
    if (pureCollateral.length) {
        console.log(
            `\n    ${pureCollateral.length} fichier(s) 100 % collatéraux — leur resetModules() ne couvre aucun require() :`
        );
        for (const f of pureCollateral) console.log(`      • ${f.file}`);
    }

    const stateful = reload.filter((f) => f.stateful.length);
    const decorative = reload.filter((f) => !f.stateful.length && f.stateless.length);

    console.log("\n  Axe R2 — le module rechargé porte-t-il un état de niveau module ?");
    console.log(
        `    OUI  : ${String(stateful.length).padStart(3)} fichiers` +
            "   → le rechargement est porteur, --prove-reload doit les voir SENSIBLES"
    );
    console.log(
        `    non  : ${String(decorative.length).padStart(3)} fichiers` +
            "   → rechargement décoratif : insensible AVANT comme APRÈS, donc CONFORME"
    );
    console.log(
        "    ⚠️ R2 n'est pas l'inertie du S2 : `let _cache = null` est inerte au chargement\n" +
            "       et c'est pourtant TOUTE la raison de recharger.\n" +
            "    ⚠️ Et R2 discrimine PEU — il suffit d'un hop de plus pour qu'il déclare tout\n" +
            "       porteur (20/21 ici, 21/21 à depth 2). C'est une ATTENTE posée avant mesure,\n" +
            "       PAS un critère : le critère est --prove-reload, et son invariant l'ÉGALITÉ."
    );

    if (decorative.length) {
        console.log("\n  ── Rechargement sans état à recharger, à confirmer par --prove-reload ──");
        for (const f of decorative) {
            console.log(`  • ${f.file}  ← ${f.stateless.join(", ")}`);
        }
    }
}

// ── Proof that the mocks are in force ────────────────────────────────────────

/** The probe files' suffix. Transient: written, run, deleted. */
const PROBE_SUFFIX = ".__probe.test.js";

/**
 * Deletes the probes an interrupted run would have left.
 *
 * Called BEFORE each campaign: a forgotten probe would be one more test
 * file in the repo, which the baseline gate would count and `git status`
 * would pass off as work.
 *
 * @param {object} pkg Registry entry.
 * @returns {number} Probes deleted.
 */
function sweepProbes(pkg) {
    let n = 0;
    for (const f of sites.walkTests(pkg.absDir)) {
        if (f.endsWith(PROBE_SUFFIX)) {
            fs.rmSync(f, { force: true });
            n += 1;
        }
    }
    return n;
}

/**
 * Neutralises a file's `vi.mock()` WITHOUT touching anything else.
 *
 * Renaming the call suffices and is the safest gesture: Vitest's transform
 * only looks for `vi.mock(`, so the renamed call is no longer hoisted, and
 * the stub makes it inert. The factories stay in place — arrow functions,
 * they do not execute. Everything else in the file, fixtures and
 * assertions included, is **unchanged**.
 *
 * ⚠️ `vi.mocked(` does not match: the regex requires the parenthesis right
 * after `mock`.
 *
 * @param {string} src The test file's source.
 * @returns {{code: string, mocks: number}}
 */
function neutraliseMocks(src) {
    // Same fix as at {@link neutraliseReload}: a `vi.mock(` cited in a
    // comment fabricated an empty probe.
    const mocks = (sites.stripComments(src).match(/vi\.mock\(/g) ?? []).length;
    return {
        code: `vi.__disabled_mock = () => {};\n${src.replace(/vi\.mock\(/g, "vi.__disabled_mock(")}`,
        mocks,
    };
}

/**
 * Runs test files and returns their verdict, file by file.
 *
 * A single Vitest invocation for the whole batch: the cost is dominated by
 * startup, and an exploding file does not keep the others from rendering
 * their result.
 *
 * @param {string[]} files Absolute paths.
 * @param {object} pkg Registry entry.
 * @returns {Map<string, boolean>} file → failed (hence sensitive).
 */
function runAndCollect(files, pkg) {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    const outFile = path.join(SNAP_DIR, `probe-run-${pkg.dirName}.json`);
    fs.rmSync(outFile, { force: true });

    spawnSync(
        "npx",
        [
            "vitest",
            "run",
            "--config",
            path.join(pkg.absDir, "vitest.config.ts"),
            "--reporter=json",
            `--outputFile=${outFile}`,
            ...files,
        ],
        {
            cwd: ROOT,
            encoding: "utf8",
            env: { ...process.env, CI: "true" },
            maxBuffer: 64 * 1024 * 1024,
        }
    );

    const verdict = new Map();
    if (!fs.existsSync(outFile)) return verdict;
    const report = JSON.parse(fs.readFileSync(outFile, "utf8"));
    for (const r of report.testResults ?? []) {
        verdict.set(path.resolve(ROOT, r.name), r.status === "failed");
    }
    fs.rmSync(outFile, { force: true });
    return verdict;
}

/**
 * Neutralises a file's `vi.resetModules()` / `vi.isolateModules()` — the
 * reload check, and {@link neutraliseMocks}'s exact counterpart.
 *
 * ⚠️ **The `isolateModules` stub still executes `fn()`.» The isolation is
 * removed, NOT the load: otherwise the file would no longer load anything
 * and would turn red for a reason unrelated to the reload. That is what
 * makes the probe **symmetric** before and after conversion — before, the
 * `require()` returns the CJS cache's instance; after, `await import()`
 * returns the ESM registry's. On both sides: stale instance → red.
 *
 * ⚠️ `vi.isolateModulesAsync` is handled separately and **first**: the
 * `isolateModules` regex requires the parenthesis, so it would not capture
 * it, and it would come out of the neutralisation intact — a probe letting
 * live what it claims to cut.
 *
 * ⚠️ Neither exists in Vitest 4.1.8: `packages/core/__tests__/setup.js` is
 * what defines them. The shape is kept so the probe stays right **after**
 * that shim's dismantling, when only `resetModules` will remain.
 *
 * @param {string} src The test file's source.
 * @returns {{code: string, count: number}}
 */
function neutraliseReload(src) {
    // ⚠️ Counted on the COMMENT-STRIPPED source. A `vi.isolateModules()`
    // cited in a comment produced a probe neutralising nothing, hence an
    // "insensitive" file in the record — then a RED "device vanished" the
    // day the comment left. Measured on `app/helpers.test.js`, converted
    // without a defect.
    const bare = sites.stripComments(src);
    const count =
        (bare.match(/vi\.resetModules\(/g) ?? []).length +
        (bare.match(/vi\.isolateModules(?:Async)?\(/g) ?? []).length;
    const code =
        "vi.__disabled_reset = () => {};\n" +
        "vi.__disabled_iso = (fn) => fn();\n" +
        "vi.__disabled_isoAsync = async (fn) => { await fn(); };\n" +
        src
            .replace(/vi\.resetModules\(/g, "vi.__disabled_reset(")
            .replace(/vi\.isolateModulesAsync\(/g, "vi.__disabled_isoAsync(")
            .replace(/vi\.isolateModules\(/g, "vi.__disabled_iso(");
    return { code, count };
}

/**
 * Each file's sensitivity to a device of its own — the check common to the
 * mock (`vi.mock()`) and reload (`vi.resetModules()`) campaigns.
 *
 * ## What it catches, and no green suite distinguishes
 *
 * Converting a `require()` to `import` changes the implementation serving
 * the mocks (`packages/core/__tests__/setup.js`'s `Module._load` shim
 * yields to the native mocker) **and** the one reloading a module
 * (`vi.resetModules`'s CJS patch yields to the ESM registry). If either
 * stopped acting in the process, the test **would stay green testing
 * something else** — the real module instead of the mock, or the first
 * instance instead of a fresh one.
 *
 * ## The invariant, and why it is not "must turn red"
 *
 * The record is taken BEFORE conversion then replayed AFTER, and what is
 * required is **equality**. A file insensitive on both sides is
 * conformant: its device was decorative before, it still is, the
 * conversion changed nothing. What is refused is the passage from
 * sensitive to insensitive. "Must turn red" would condemn the first case,
 * which is a finding to write — 25 files — and not a defect to fix in this
 * sprint.
 *
 * ⚠️ **NEVER exits through `process.exit()`.» A `process.exit()` in the
 * `try` short-circuits the `finally`: the function then left its probes on
 * disk at the precise moment it flags a defect — a check that dirties the
 * repo when it turns red ends up bypassed. Found by proving it by
 * mutation, not by rereading it. The exit code is returned to the caller,
 * who exits after the cleanup.
 *
 * ⚠️ **A single implementation for both campaigns.» Each would have
 * carried a copy, and the ADR already records three times what two twin
 * analyses end up doing: diverging on the judgement they were supposed to share.
 *
 * @param {object} spec What distinguishes the two checks.
 * @param {string} spec.cmd Subcommand name, for the messages.
 * @param {string} spec.slug On-disk record prefix.
 * @param {string} spec.what What is neutralised, plural.
 * @param {(src: string) => {code: string, count: number}} spec.neutralise
 * @param {string} spec.lost What a regression means, in one sentence.
 * @param {string} name Record name.
 * @param {string[]} files Absolute paths of the files to probe.
 * @param {object} pkg Registry entry.
 * @returns {boolean} `false` if a file LOST its sensitivity.
 */
function proveSensitivity(spec, name, files, pkg) {
    const relevePath = path.join(SNAP_DIR, `${spec.slug}-${name}.json`);
    const swept = sweepProbes(pkg);
    if (swept) console.log(`ℹ ${swept} sonde(s) d'une exécution interrompue supprimée(s).`);

    /** What THIS batch claims to cover — the "device vanished" check's bound. */
    const targeted = new Set(files.map((f) => rel(f)));

    const probes = new Map();
    try {
        for (const f of files) {
            const { code, count } = spec.neutralise(fs.readFileSync(f, "utf8"));
            if (!count) continue;
            // The probe lives BESIDE the original: relative specifiers and
            // Vite aliases resolve identically there. A file moved elsewhere
            // would test something else.
            const probe = f.replace(/\.test\.(js|ts)$/, PROBE_SUFFIX);
            fs.writeFileSync(probe, code);
            probes.set(probe, { origin: rel(f), count });
        }

        // ⚠️ **The VANISHED device — found by mutation, and it made the
        // check harmless on exactly the defect it exists to catch.» A file
        // without any `count` is ignored by the loop above, hence absent
        // from `now`, hence never compared to the record: the campaign
        // exited **green** on a batch where a file had lost ALL its
        // `resetModules()`, and advanced the record over it. Measured on
        // `ui/ui-main.test.js` deprived of its reload: "sensitivity
        // preserved", exit 0.
        //
        // A file explicitly targeted, known to the record as carrying the
        // device, and no longer carrying it, is a REGRESSION — not an
        // absence. The distinction from a file simply outside the batch
        // hangs on `targeted`: without it, each batch would accuse the 20
        // files it does not probe.
        const priorReleve = fs.existsSync(relevePath)
            ? JSON.parse(fs.readFileSync(relevePath, "utf8"))
            : null;
        const probed = new Set([...probes.values()].map((m) => m.origin));
        const vanished = priorReleve
            ? [...targeted].filter((f) => priorReleve[f]?.count > 0 && !probed.has(f))
            : [];

        if (vanished.length) {
            console.error(
                `\n✘ ${spec.cmd}: ${vanished.length} fichier(s) ne déclarent PLUS de ` +
                    `${spec.what}, alors que le relevé « ${name} » les y connaît :\n` +
                    vanished.map((f) => `      ${f}`).join("\n") +
                    "\n\n  Le dispositif n'a pas changé de sensibilité, il a DISPARU — et c'est\n" +
                    "  la forme la plus directe du défaut : plus rien ne recharge, et la suite\n" +
                    "  reste verte sur la première instance."
            );
            return false;
        }

        if (!probes.size) {
            console.error(`✘ ${spec.cmd}: aucun fichier ne déclare de ${spec.what}.`);
            return false;
        }

        // ⚠️ **A verdict only holds on a file green WITHOUT mutation** —
        // and forgetting that evidence polluted the record mid-sprint.
        // `globals/globals-core` was probed while already failing for
        // another reason (an incomplete mock the native mocker refuses):
        // its probe failed too, hence "sensitive", and the record was
        // ADVANCED with that value. The next batch, once the mock repaired,
        // saw "sensitivity LOST" on a perfectly converted file.
        //
        // A pristine pass separates the two causes. It costs one Vitest
        // invocation — a few seconds — against a false record no check
        // catches afterwards.
        const brokenBefore = runAndCollect(
            [...probes.values()].map((m) => path.join(ROOT, m.origin)),
            pkg
        );
        const inconclusive = [...probes.entries()].filter(([, m]) =>
            brokenBefore.get(path.join(ROOT, m.origin))
        );
        if (inconclusive.length) {
            console.error(
                `\n✘ ${spec.cmd}: ${inconclusive.length} fichier(s) sont ROUGES sans aucune ` +
                    "mutation. Leur sensibilité n'est pas mesurable, et l'inscrire au relevé\n" +
                    "  y figerait une valeur fausse :\n" +
                    inconclusive.map(([, m]) => `      ${m.origin}`).join("\n") +
                    "\n\n  Réparer le lot d'abord, puis rejouer ce contrôle."
            );
            return false;
        }

        console.log(`ℹ ${spec.cmd}: ${probes.size} fichier(s), ${spec.what} neutralisés…`);
        const failed = runAndCollect([...probes.keys()], pkg);

        const now = {};
        for (const [probe, meta] of probes) {
            // A file absent from the record produced no test: without its
            // device, it could not even be collected. The strongest
            // sensitivity signal.
            now[meta.origin] = { count: meta.count, sensitive: failed.get(probe) ?? true };
        }

        const sensitive = Object.values(now).filter((v) => v.sensitive).length;
        console.log(
            `  sensibles : ${sensitive} / ${Object.keys(now).length}` +
                `  ·  insensibles : ${Object.keys(now).length - sensitive}`
        );

        if (!priorReleve) {
            fs.mkdirSync(SNAP_DIR, { recursive: true });
            fs.writeFileSync(relevePath, JSON.stringify(now, null, 4) + "\n");
            console.log(`\n✔ relevé « ${name} » figé — à rejouer APRÈS conversion.`);
            for (const [f, v] of Object.entries(now)) {
                if (!v.sensitive) {
                    console.log(
                        `  ℹ insensible à ses ${v.count} ${spec.what} AVANT conversion : ${f}`
                    );
                }
            }
            return true;
        }

        const before = priorReleve;
        const regressions = [];
        const gained = [];
        for (const [f, v] of Object.entries(now)) {
            const b = before[f];
            if (!b) continue;
            if (b.sensitive && !v.sensitive) regressions.push(f);
            if (!b.sensitive && v.sensitive) gained.push(f);
        }

        console.log(`\n── Bulletin ${spec.cmd}, contre le relevé « ${name} » ──\n`);
        console.log(`  sensibilité PERDUE : ${regressions.length}  ·  gagnée : ${gained.length}`);
        for (const f of gained) {
            console.log(`  ℹ ${f} — insensible avant, sensible après`);
        }

        if (regressions.length) {
            console.error(
                `\n✘ ${spec.cmd}: ${regressions.length} fichier(s) ont PERDU leur sensibilité.\n` +
                    `  ${spec.lost}\n` +
                    "  C'est exactement l'échec qu'une suite verte ne distingue pas :\n" +
                    regressions.map((f) => `      ${f}`).join("\n") +
                    "\n\n  Règle de l'ADR : la conversion change le MODE de chargement, jamais ce\n" +
                    "  qui est testé. Laisser le site en require(), écrire la raison sur place,\n" +
                    "  et router en backlog comme B.10."
            );
            return false;
        }

        // ⚠️ MERGE, not replacement. The record covers the whole sprint and
        // the batches only probe a slice: overwriting it with `now` would
        // erase the "before" state of the not-yet-converted files, and the
        // next batches would have nothing left to compare to — a check that
        // disarms itself through its own use.
        fs.writeFileSync(relevePath, JSON.stringify({ ...before, ...now }, null, 4) + "\n");
        console.log(`\n✔ sensibilité préservée — le relevé « ${name} » est avancé.`);
        return true;
    } finally {
        for (const probe of probes.keys()) fs.rmSync(probe, { force: true });
    }
}

/**
 * The mock-campaign check — pattern proven by hand on
 * `config/config-loaders.test.js`: 6 tests out of 6 turn red with the
 * mocks neutralised, before conversion **as** after.
 *
 * @param {string} name @param {string[]} files @param {object} pkg @returns {boolean}
 */
const proveMocks = (name, files, pkg) =>
    proveSensitivity(
        {
            cmd: "prove-mocks",
            slug: "mocks",
            what: "mock(s)",
            neutralise: (src) => {
                const { code, mocks } = neutraliseMocks(src);
                return { code, count: mocks };
            },
            lost: "Un mock a cessé de s'appliquer : le test reste vert en testant le VRAI module.",
        },
        name,
        files,
        pkg
    );

/**
 * The reload-campaign check — and **the trap does not have the shape the plan gives it**.
 *
 * ## What three mutations measured, before any conversion
 *
 * The plan states: "a test that no longer reloads STILL PASSES, greenness
 * does not distinguish this case". True for one half of the perimeter
 * only, and the cut is exactly the one the record gives — 11 sensitive
 * files, 14 insensitive:
 *
 * ```
 * SENSITIVE file   → reload destroyed → the SUITE turns red by itself
 *     ui/ui-main : resetModules removed       →  3 tests out of 5 fall
 *     api/api    : load hoisted to import     → 11 tests out of 25 fall
 * INSENSITIVE file → reload destroyed → the suite stays GREEN
 *     legend/legend-extended : its 6 resetModules removed → 37 out of 37 PASS
 * ```
 *
 * **That is where the trap lives, and nowhere else**: on the 11 sensitive,
 * the suite is its own guardrail; on the 14 insensitive, nothing says
 * something was broken.
 *
 * ## Consequence: the equality invariant did not suffice
 *
 * Inherited from the mock campaign, it precisely does not protect those 14
 * files — "insensitive before, insensitive after" is conformant by
 * construction. What covers them is the **VANISHED device** check (see
 * {@link proveSensitivity}), absent from the mock harness and added here
 * after seeing it missed: without it, the `legend-extended` mutation
 * exited green on BOTH sides, suite and check alike.
 *
 * The three mechanisms split the work, and none is redundant:
 *
 * ```
 * resetModules DELETED                 → "vanished" check   (the 14's only net)
 * reload BROKEN but present            → the suite, if sensitive; harmless otherwise
 * sensitivity LOST without deletion    → the equality invariant
 * ```
 *
 * @param {string} name @param {string[]} files @param {object} pkg @returns {boolean}
 */
const proveReload = (name, files, pkg) =>
    proveSensitivity(
        {
            cmd: "prove-reload",
            slug: "reload",
            what: "rechargement(s)",
            neutralise: neutraliseReload,
            lost: "Le rechargement n'a plus lieu : le test passe sur la PREMIÈRE instance du module.",
        },
        name,
        files,
        pkg
    );

// ── Execution ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (n) => {
    const i = argv.indexOf(n);
    return i === -1 ? null : (argv[i + 1] ?? "");
};

if (argv.includes("--triage")) {
    const t = triage();
    // `--json` serves to COMPOSE the batches: a batch must contain at least
    // one `reqOnly` module, otherwise A1 can come out empty on a
    // nonetheless correct conversion. Composing that by eye over 84 files
    // means getting it wrong.
    if (argv.includes("--json")) console.log(JSON.stringify(t.files, null, 2));
    else printTriage(t);
    process.exit(0);
}

const targetPkg = () => requirePkg(flag("--pkg") || DEFAULT_PKG);

/**
 * The two sensitivity checks share their command line: a record name, and
 * an optional file list which, left empty, falls back on the sprint's perimeter.
 *
 * @param {string} cmdFlag The subcommand's flag.
 * @param {string} family Default `lib/test-load-sites.cjs` family.
 * @param {(name: string, files: string[], pkg: object) => boolean} run
 */
function dispatchProve(cmdFlag, family, run) {
    const name = flag(cmdFlag);
    if (name === null) return;
    if (!name) {
        console.error(`✘ ${cmdFlag} exige un nom : ${cmdFlag} lot1 [fichiers…]`);
        process.exit(1);
    }
    const pkg = targetPkg();
    // The files are the free arguments — anything neither a flag nor its value.
    const reserved = new Set([cmdFlag, name, "--pkg", flag("--pkg") ?? ""]);
    const given = argv.filter((a) => !reserved.has(a)).map((f) => path.resolve(ROOT, f));
    // Without a list, the sprint's whole perimeter for this package: the triage already knows who.
    const targets = given.length
        ? given
        : triage()
              .files.filter((f) => f.pkg === pkg.name && f.family === family)
              .map((f) => path.join(ROOT, f.file));
    // The exit code is decided AFTER the probe cleanup — see proveSensitivity().
    process.exit(run(name, targets, pkg) ? 0 : 1);
}

dispatchProve("--prove-mocks", "mock", proveMocks);
dispatchProve("--prove-reload", "reload", proveReload);

console.error(
    "Usage :\n" +
        "  node scripts/audit-test-load-conversion.cjs --triage\n" +
        "  node scripts/audit-test-load-conversion.cjs --prove-mocks  <nom> [fichiers…]\n" +
        "  node scripts/audit-test-load-conversion.cjs --prove-reload <nom> [fichiers…]\n" +
        "\n  Les deux --prove-* figent un relevé la 1ʳᵉ fois, puis COMPARENT : ils refusent un\n" +
        "  lot où un fichier a PERDU sa sensibilité. L'invariant est l'ÉGALITÉ, pas le rouge —\n" +
        "  un fichier insensible des deux côtés est conforme. Sans liste de fichiers, ils\n" +
        "  prennent tout le périmètre de leur sprint (mock → S3, reload → S4).\n" +
        `\n  --pkg défaut : ${DEFAULT_PKG}\n` +
        `  périmètre    : ${SCOPE.join(", ")}`
);
process.exit(1);
