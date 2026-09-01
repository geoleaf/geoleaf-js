#!/usr/bin/env node
/**
 * TSDOC-CONFORMITY: the TSDoc must describe the signature it sits above.
 *
 * ## The defect this gate closes
 *
 * The repo has a principle: *every verifiable fact carries its verifier, or it is not
 * written*. TSDoc escaped it entirely. A `@param` survives its parameter's rename, a
 * `@throws` survives its `throw`'s deletion — and nothing says so.
 *
 * This is not theoretical. The V3 documentation overhaul measured, on `CDC_technique.md`
 * alone, **287 dead paths out of 452**. TSDoc is exposed to the same drift, with an
 * aggravating circumstance: since a later stage of that overhaul, it is destined to
 * become **the source of the API reference published on npm**. A false sentence in an
 * internal `.md` misleads a project developer; the same in an `@example` is shipped to
 * integrators.
 *
 * ## What this gate CAN judge, and what it cannot
 *
 * It does not read meaning. It compares a declaration to what documents it, and that is
 * all.
 *
 *   TSD-01  Every `@param <name>` must name a real parameter of the signature.
 *           → catches the rename and the parameter removal not carried over.
 *   TSD-02  A block documenting AT LEAST one parameter must document them ALL.
 *           → catches the parameter added without updating the block. Deliberately mute
 *             on blocks documenting no parameter: partial documentation is a defect,
 *             not documenting is a choice MH-01 handles elsewhere.
 *   TSD-03  A `@throws` requires a `throw` in the function body.
 *           → catches the documented exception that no longer exists.
 *   TSD-04  The baseline must SHRINK. An entry whose violation has vanished is an ERROR
 *           until it is removed from the baseline.
 *           → otherwise a baseline is a permit, not a debt register. Same reasoning as
 *             MH-02 in `check-module-headers.cjs`.
 *   TSD-05  A top-level export must carry a TSDoc block.
 *           → catches the export published WITHOUT a word of documentation, and forbids
 *             creating new ones. Detail and rationale in the next §.
 *   TSD-06  An `@example` cannot name a symbol that exists nowhere.
 *           → catches the copy-pastable ghost class. Detail in § TSD-06.
 *   TSD-07  A `{@link …}` cannot designate a target that exists nowhere.
 *           → same class as TSD-06, on the other half of TSDoc. Detail in § TSD-07.
 *
 * ## TSD-05 — why a rule here, and not a counter elsewhere
 *
 * The V3 overhaul's plan priced this pool at "~173 missing exports, 89-92 % coverage,
 * 1,582 existing blocks". **No instrument in this repo produced those three numbers**,
 * and the "~173" served four times to size a sub-task before being withdrawn (a number
 * that cannot be re-measured does not expire, it fossilizes — and it carries authority
 * in proportion to its precision). TSD-05 is what replaces those three numbers: the
 * **nominative** list, reprinted at every run. The real measurement, at the first run,
 * gave **199** — neither 173 nor the ~255 a regex approximation suggested.
 *
 * **Two populations, and they do not cost the same.** The distinction is written here
 * because the "~173" conflated them, which made the sub-task uncuttable:
 *
 *   - **published surface** — the files a `package.json`'s `exports` map makes
 *     reachable, **wildcards included** (`"./capabilities/*"` publishes the WHOLE
 *     subtree: an integrator can import each of those files). A missing TSDoc there is
 *     **shipped**, and its reader is outside the repo — they cannot notice the drift.
 *     It is the same argument, one storey down. **15 exports** are bare there.
 *   - **the rest of `src/`** — an internal cost, real but with no external reader.
 *
 * The output separates the two and **drains the published one first**. ⚠️ The initial
 * plan said "`utils/` first (52 %, 65 exports)": that order derived from the withdrawn
 * number, not from a decision. If `utils/` is on the published surface, it rises on its
 * own.
 *
 * **No percentage as a ratchet.** The rationale is that of
 * `check-namespace-typing-coverage.cjs`, and it is stronger here: a percentage climbs
 * when a key is REMOVED, and on TSDoc **the denominator is not even stable** — deleting
 * a barrel `export` would raise the rate without a sentence being written.
 *
 * **The ratchet is TSD-04, as-is.** ⚠️ The written specification announced a `TSD-05a`
 * ("an export absent from the baseline must carry a block") and a `TSD-05b` ("the
 * baseline can only shrink"). At writing time, both turned out to be **already there**:
 * TSD-05a is the baseline mechanism itself, and TSD-05b **is** TSD-04, which operates
 * over all rules without knowing any. Doubling them would have created two authorities
 * for one invariant. One rule, not three — and the written spec was corrected in the
 * same commit, so specification and code do not diverge from day one.
 *
 * **What TSD-05 does not judge**: a block's PRESENCE, not its quality. A block holding
 * only a "TODO" satisfies the rule. Same boundary as everywhere here.
 *
 * ## TSD-06 — the "real surface" as oracle, and why it takes TWO
 *
 * The header of `validate-docs-examples.cjs` has long said its deny-list only sees a
 * ghost *once the rule has been written for it*, and that **deriving from the real
 * surface would be better**. The cost of that hole is measured: an `@example` of
 * `core-module.contract.ts` documented `new POIModule()` — a class dissolved long
 * before — on code **published on npm**.
 *
 * ⚠️ **The first attempt was REFUSED on measurement, and rightly so.** Taking the
 * surface manifest (`API_SURFACE.txt`) as the sole oracle gave **3 false positives for
 * 0 true**: `StorageHelper` and `LayersDB` are **real but NOT exported**, hence absent
 * from a manifest that only renders the exported; `MyDecoder` is a **placeholder**. A
 * gate that must be silenced three times on day one is not a gate.
 *
 * **What changed the decision: a SECOND oracle.** A symbol declared anywhere in the
 * sources — exported or not — is real. The two together discriminate the three cases:
 *
 *   | In the manifest | Declared in AST | Verdict                                   |
 *   | --------------- | --------------- | ----------------------------------------- |
 *   | yes             | —               | exported — nothing to say                 |
 *   | no              | yes             | **private** — legitimate in internal docs |
 *   | no              | no              | **GHOST** — TSD-06                        |
 *
 * ⚠️ **And the AST ALONE is not enough either** — measured: **1,571 of the 4,233**
 * manifest symbols are not found by that pass (namespace members, re-exports,
 * properties of exported objects). Using it alone produced **7 false ghosts**
 * including `COG`, `Geocoding` and `FlatGeobuf`. The two oracles compensate each
 * other; neither replaces the other.
 *
 * **Placeholders.** An example is allowed to name a class the READER is meant to write
 * (`registerDecoder("my-format", new MyDecoder())`). The exemption is a **naming
 * convention** — `My` / `Your` / `Custom` / `Sample` / `Example` prefix — and not a
 * symbol list: a nominative list would outlive its rationale; that is the dead-citation
 * lesson.
 *
 * ⚠️ **The rule lives HERE and not in `validate-docs-examples.cjs`**, even though that
 * is where the class was found. Measured rationale: this gate **already** walks the 847
 * files in AST (0.5 s); the other is a 0.06 s regex pass. Grafting a second full walk
 * onto it would have multiplied its cost tenfold to redo work already done.
 *
 * ## TSD-07 — the `{@link}` reference, and why it takes a THIRD oracle
 *
 * A `{@link X}` is a reference the documentation tool turns into a LINK. When `X` does
 * not exist, TypeDoc renders the bare text: the reader sees a word, not an error, and
 * nothing in the chain says the reference is dead. The gate resolved none of these — a
 * `grep -c '@link'` on this file returned **0**, while the sources carry hundreds.
 *
 * ⚠️ **TSD-06's two oracles are NOT enough here, and that is measured, not assumed.** A
 * `{@link}` legitimately designates a **module** —
 * `{@link module:contracts/preset.contract}`,
 * `{@link desktop-panel-theme.appendThemeToggleToTabs}` — and a module is neither an
 * exported symbol nor a declaration. With the two oracles alone, the first measurement
 * returned **10 unresolved targets of which 8 were perfectly alive modules**: a gate
 * that would have had to be silenced eight times on day one, i.e. not a gate. The third
 * oracle is the corpus's module list, derived from the files themselves.
 *
 * 🛑 **And the name splitting is the second thing that nearly lied.** A target splits
 * on `.`, `#` and `(` to isolate its head — except a module of this repo is called
 * `preset.contract`, and the naive split made it `preset`, hence an unknown module. The
 * dot is ambiguous: it separates a member from its carrier AND it belongs to the file
 * name. Resolution therefore tries the WHOLE target before splitting it.
 *
 * ✅ **What the first measurement returned, once the three oracles were in place: TWO
 * real ghosts**, both in the core. `{@link setupUI}` designated a function named
 * `setupUIKernel`; `{@link EXCLUSIVE_MODE_KEY}` designated a constant that **never
 * existed** — and the paragraph right above the reference explains why it does not
 * exist (a named constant would turn every write into a dynamic-key write, which the
 * prototype-pollution gate rejects). The reference was the vestige of an explicitly
 * abandoned choice, and it survived in a published `.d.ts`.
 *
 * 📌 **The register line said "there is nothing to fix, only something to keep from
 * coming back": that was false, and only the gate could say so.** The class was
 * believed purged; it carried two live instances.
 *
 * ## TSD-06's perimeter — two shapes, and that is MEASURED sufficient
 *
 * It only reads `new X()` and `X.method()`. This bound is not caution on principle: a
 * census of the five other shapes a PascalCase name can take across the 106 `@example`
 * blocks returns **0 ghosts**, on 2026-07-30:
 *
 *   | Shape                          | Real symbols   | Ghosts   |
 *   | ------------------------------ | -------------- | -------- |
 *   | `new X()`          **covered** | 3              | **0**    |
 *   | `X.method()`       **covered** | 32             | **0**    |
 *   | `X.PROPERTY`                   | 14             | **0**    |
 *   | `: X` / `as X`                 | 6              | **0**    |
 *   | `import { X }`                 | 3              | **0**    |
 *   | `implements` / `extends X`     | 1              | **0**    |
 *   | `f(X)` (argument)              | 1              | **0**    |
 *
 * **And the riskiest uncovered shape is taken by ANOTHER gate**: `import { X }` naming
 * a non-existent export is `TS2305` — in the `DEFECT_CODES` of
 * `typecheck-docs-examples.cjs`, with `TS2307` for the module path. Widening here would
 * duplicate a check the compiler does better.
 *
 * ⚠️ **Widening to type positions (`: X`) would be a REGRESSION, and that is measured
 * too.** TypeScript's utility types — `Partial`, `Record`, `Omit`, `Pick`, `Readonly` —
 * are neither in the manifest, nor declared in the sources, nor runtime globals. They
 * would thus fall through all three filters and **redden at the first `: Partial<X>`
 * written**. The current bound is not what the rule did not have time to do: it is
 * where it stops being right.
 *
 * **What stays out of reach for good**: a ghost cited in a TSDoc's PROSE, outside
 * `@example`. That is another corpus and another tool — `audit-report-freshness.cjs`
 * already knows how to handle prose paths and symbols, it is simply not wired to TSDoc.
 *
 * **What it does NOT judge, and never will: the sentence's truthfulness.** "Caches for
 * 5 minutes" on a function that caches 10 is indistinguishable, for any tool here, from
 * a right sentence. That is the structural limit of everything "generated" — TypeDoc
 * guarantees the **signature**, never the **sentence**. That half stays human and lives
 * in the project instructions' end-of-session rule.
 *
 * ## What is NOT covered today, and why it is said rather than silent
 *
 * - **`@returns` ↔ return type**: set aside from this version. The repo widely writes
 *   `@returns` on `void` functions and the reverse; making it a rule would produce
 *   noise that would drown TSD-01, the high-value check. To reopen with a measurement,
 *   not on principle.
 * - **`@example` that compiles**: the most useful missing check, and it is not here
 *   because it requires the published `.d.ts` and the `typecheck-docs-examples.cjs`
 *   engine. ⚠️ **137 `@example` blocks live in the code** (109 core, 21 plugins,
 *   7 libs) and **none** is verified. It is this gate's immediate sequel.
 * - **Paths cited in TSDoc prose**: `audit-report-freshness.cjs` already knows how, it
 *   is simply not wired to TSDoc.
 * - **Class and interface members**: TSD-05 only judges **top-level** exports. An
 *   undocumented public method of an exported class passes. Widening is possible and
 *   would multiply the pool; to do with a prior measurement, as here.
 *
 * Usage:
 *   node scripts/check-tsdoc-conformity.cjs                  # gate (exit 1 si violation neuve)
 *   node scripts/check-tsdoc-conformity.cjs --update-baseline
 *   node scripts/check-tsdoc-conformity.cjs --verbose
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const registry = require("./lib/packages.cjs");
const docsPaths = require("./lib/docs-paths.cjs");
const { extractTsdocExamples } = require("./lib/tsdoc-examples.cjs");

const ROOT = registry.ROOT;
const BASELINE = path.join(ROOT, "scripts", ".baselines", "tsdoc-conformity.json");
const VERBOSE = process.argv.includes("--verbose");
const UPDATE = process.argv.includes("--update-baseline");

/** Out-of-perimeter files: tests document their intent, not an API. */
const EXCLUDED = /(\/__tests__\/|\/__mocks__\/|\.test\.ts$|\.spec\.ts$|\.d\.ts$)/;

// ---------------------------------------------------------------------------
// File collection — through the registry, never a hard-coded path.
// ---------------------------------------------------------------------------

/** @returns {string[]} absolute paths of every package's `src/` `.ts` files. */
function sourceFiles() {
    const out = [];
    for (const pkg of registry.all()) {
        const src = path.join(pkg.absDir, "src");
        if (!fs.existsSync(src)) continue;
        walk(src, out);
    }
    return out.filter((f) => !EXCLUDED.test(f.replace(/\\/g, "/")));
}

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (e.name.endsWith(".ts")) out.push(full);
    }
}

/**
 * The `src/` files the `exports` map makes reachable by an integrator — TSD-05's
 * "published surface" population.
 *
 * The map points at `dist/`, which does not exist on a clean checkout: it is folded back
 * to `src/` through the build layout (`dist/{types,esm}/X.{d.ts,js}` → `src/X.ts`).
 * ⚠️ The mapping is **assertive**: if it resolves nothing anymore, the function THROWS
 * instead of returning an empty Set. An empty published surface would let TSD-05 go
 * green having classified every export "internal" — i.e. green having prioritized
 * nothing, the defect class `probe-gate-visibility.cjs` watches elsewhere. (Seen
 * throwing by prefix mutation.)
 *
 * @returns {Set<string>} absolute paths.
 * @throws {Error} if the `exports` map no longer resolves any source file.
 */
function publishedSurface() {
    const set = new Set();
    for (const pkg of registry.all()) {
        const manifest = path.join(pkg.absDir, "package.json");
        if (!fs.existsSync(manifest)) continue;
        const pj = JSON.parse(fs.readFileSync(manifest, "utf8"));
        for (const cond of Object.values(pj.exports || {})) {
            const target =
                typeof cond === "string" ? cond : cond.types || cond.import || cond.default;
            if (typeof target !== "string") continue;
            const rel = target
                .replace(/^\.\//, "")
                .replace(/^dist\/(?:types|esm)\//, "src/")
                .replace(/\.d\.ts$/, ".ts")
                .replace(/\.js$/, ".ts");
            if (!rel.startsWith("src/")) continue;

            if (rel.includes("*")) {
                // A wildcard subpath publishes its whole subtree. The core's
                // `"./capabilities/*"` makes every file of `src/capabilities/` importable
                // — counting only one would be wrong in the other direction.
                const dir = path.join(pkg.absDir, rel.slice(0, rel.indexOf("*")));
                if (fs.existsSync(dir)) {
                    const found = [];
                    walk(dir, found);
                    for (const f of found) set.add(f);
                }
            } else {
                const abs = path.join(pkg.absDir, rel);
                if (fs.existsSync(abs)) set.add(abs);
            }
        }
    }
    if (set.size === 0) {
        throw new Error(
            "[TSDOC/TSD-05] la carte `exports` ne résout plus aucun fichier de `src/` — le " +
                "layout de build a changé, ou le registre de paquets ne rend plus rien. La " +
                "gate refuse de conclure : sans surface publiée, elle classerait TOUT en " +
                "interne et sortirait verte en n'ayant plus rien priorisé."
        );
    }
    return set;
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

/**
 * A declaration's parameter names, ignoring destructuring patterns:
 * `function f({a, b})` has no name to compare, and the TSDoc then documents it as
 * `@param options.a`. Counting them would produce a false positive every time.
 *
 * @returns {{names: string[], hasBindingPattern: boolean}}
 */
function paramNames(node) {
    const names = [];
    let hasBindingPattern = false;
    for (const p of node.parameters || []) {
        if (ts.isIdentifier(p.name)) names.push(p.name.text);
        else hasBindingPattern = true;
    }
    return { names, hasBindingPattern };
}

/** True if the body contains a `throw`, including inside a nested closure. */
function bodyThrows(node) {
    if (!node.body) return false;
    let found = false;
    const visit = (n) => {
        if (found) return;
        if (ts.isThrowStatement(n)) {
            found = true;
            return;
        }
        ts.forEachChild(n, visit);
    };
    visit(node.body);
    return found;
}

/** The declarations we know how to pair with a TSDoc block. */
function isDocumentable(n) {
    return (
        ts.isFunctionDeclaration(n) ||
        ts.isMethodDeclaration(n) ||
        ts.isConstructorDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n)
    );
}

// ── TSD-05 ──────────────────────────────────────────────────────────────────
//
// The export natures TSD-05 judges. `ExportDeclaration` (`export { X } from "…"`) and
// `export *` are ABSENT on purpose: they declare nothing, they forward. Requiring a
// block on a re-export barrel would copy documentation next to its source — the exact
// duplication the V3 overhaul removes elsewhere.
const EXPORTED_DECL_KINDS = [
    ts.isFunctionDeclaration,
    ts.isClassDeclaration,
    ts.isInterfaceDeclaration,
    ts.isTypeAliasDeclaration,
    ts.isEnumDeclaration,
    ts.isVariableStatement,
];

/** True if the declaration carries a TSDoc block — its PRESENCE, never its quality. */
function hasDocBlock(node) {
    return (ts.getJSDocCommentsAndTags(node) || []).some((d) => ts.isJSDoc(d));
}

/** True if the statement carries the `export` modifier. */
function isExported(node) {
    if (!ts.canHaveModifiers(node)) return false;
    return (ts.getModifiers(node) || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * The name(s) declared by an exported statement. An `export const a = 1, b = 2;`
 * declares two — merging them into one symbol would make the nominative list
 * incomplete, and an incomplete nominative list is the defect it is meant to close.
 *
 * @returns {string[]}
 */
function exportedNames(node, sf) {
    if (ts.isVariableStatement(node)) {
        return node.declarationList.declarations
            .map((d) => (ts.isIdentifier(d.name) ? d.name.text : null))
            .filter(Boolean);
    }
    if (node.name && typeof node.name.getText === "function") return [node.name.getText(sf)];
    return ["<anonyme>"];
}

// ── TSD-06 ──────────────────────────────────────────────────────────────────

const MANIFEST = docsPaths.reference("API_SURFACE.txt");

/** Placeholder convention: a name the READER is meant to write themselves. */
const PLACEHOLDER_RE = /^(My|Your|Custom|Sample|Example)[A-Z]/;

/** JS/DOM globals — an example is allowed to name them. */
const HOST_GLOBALS = new Set([
    ...Object.getOwnPropertyNames(globalThis),
    "CustomEvent",
    "HTMLElement",
    "Element",
    "Event",
    "Blob",
    "File",
    "FormData",
    "Headers",
    "Request",
    "Response",
    "URL",
    "URLSearchParams",
    "AbortController",
    "IntersectionObserver",
    "ResizeObserver",
    "MutationObserver",
    "Worker",
    "IDBDatabase",
    "ImageData",
    "Image",
    "Node",
    "Document",
    "Window",
]);

/**
 * Oracle 1 — the symbols the surface manifest renders, hence EXPORTED.
 *
 * Absent = the gate cannot conclude, and it says so: without the manifest, every private
 * symbol would become a false ghost. Better not to judge than to judge blind.
 *
 * @returns {Set<string>|null} `null` if the manifest is absent.
 */
function readManifestSymbols() {
    if (!fs.existsSync(MANIFEST)) return null;
    const txt = fs.readFileSync(MANIFEST, "utf8");
    const out = new Set();
    for (const m of txt.matchAll(/^\w+ \| [^|]*\.([A-Za-z_$][\w$]*) \|/gm)) out.add(m[1]);
    for (const m of txt.matchAll(/^\w+ \| ([A-Za-z_$][\w$]*) \|/gm)) out.add(m[1]);
    return out;
}

/** Collects a file's declared names — oracle 2 (the PRIVATE, which the manifest ignores). */
function collectDeclared(sf, into) {
    const visit = (n) => {
        if (
            (ts.isClassDeclaration(n) ||
                ts.isInterfaceDeclaration(n) ||
                ts.isTypeAliasDeclaration(n) ||
                ts.isEnumDeclaration(n) ||
                ts.isFunctionDeclaration(n)) &&
            n.name
        )
            into.add(n.name.text);
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) into.add(n.name.text);
        ts.forEachChild(n, visit);
    };
    visit(sf);
}

/**
 * A file's `{@link …}` targets, with their line.
 *
 * The recognized shape covers the corpus's three spellings: `{@link X}`,
 * `{@link X | text}` and `{@link X text}`. The `module:` prefix and the quotes are
 * removed — writing conventions, not parts of the name.
 *
 * @param {string} text Full source of the file.
 * @returns {{target: string, line: number}[]} One entry per reference.
 */
function linkTargets(text) {
    const out = [];
    // 🛑 THE LINE CONTINUATION IS PART OF THE PATTERN, and omitting it produced a false
    // positive at the very first run. Prettier breaks a long TSDoc after `{@link`, and
    // the target ends up on the next line, behind the border asterisk. A naive `\s+`
    // crosses the newline and captures that asterisk as if it were the target. Exactly
    // the class this repo has already paid for twice — a pattern that "silently stops
    // matching" after a reformat — and it reproduced here, in the very instrument that
    // guards it.
    //
    // ⚠️ The skip is done in CODE and not in the regex. Any regular spelling of "spaces,
    // then maybe a comment border, then spaces" is ambiguous, hence refused by the rule
    // hunting combinatorial-blowup regexes — rightly. Advancing by hand is linear by
    // construction and reads better.
    for (const m of text.matchAll(/\{@link\b/g)) {
        let k = m.index + m[0].length;
        while (k < text.length && (text[k] === " " || text[k] === "\t")) k++;
        if (text[k] === "\r") k++;
        if (text[k] === "\n") {
            k++;
            while (k < text.length && (text[k] === " " || text[k] === "\t")) k++;
            if (text[k] === "*") k++;
            while (k < text.length && (text[k] === " " || text[k] === "\t")) k++;
        }
        let end = k;
        while (end < text.length && !" \t\r\n}|".includes(text[end])) end++;
        const target = text
            .slice(k, end)
            .replace(/^module:/, "")
            .replace(/^["']|["']$/g, "");
        if (!target || target.startsWith("http:") || target.startsWith("https:")) continue;
        out.push({ target, line: text.slice(0, m.index).split("\n").length });
    }
    return out;
}

/**
 * Is a reference resolved by one of the three oracles?
 *
 * The try order is not indifferent: the WHOLE target first (a module can carry a dot in
 * its name), then its head once split on `.`, `#` and `(`, then the last segment of its
 * path (`a/b/c` → `c`). Splitting first would make `preset.contract` pass for an
 * unknown `preset`.
 *
 * @param {string} target Cleaned target of the reference.
 * @param {{exported: Set<string>, declared: Set<string>, modules: Set<string>}} o The oracles.
 * @returns {boolean} true when the target designates something real.
 */
function linkResolves(target, o) {
    const candidates = [target];

    // A reference to a NEIGHBOURING module is written as a relative path, with its
    // extension — `./convert.js`, `../kernel/map/facade.ts`. The module name is its last
    // segment without extension; without this unfolding, ten perfectly alive references
    // passed for dead.
    const lastSegment = target
        .replace(/^\.{1,2}\//, "")
        .split(/[#(]/)[0]
        .split("/")
        .pop()
        .replace(/\.[cm]?[jt]s$/, "");
    // ⚠️ The dot is AMBIGUOUS in a last segment: it separates a member from its module
    // (`data-origins.publishDataOrigins`) AND it belongs to some file names
    // (`preset.contract`). We therefore offer the WHOLE segment then each of its
    // prefixes, longest to shortest — the longest wins, which preserves dotted names.
    if (lastSegment) {
        const parts = lastSegment.split(".");
        for (let i = parts.length; i > 0; i--) candidates.push(parts.slice(0, i).join("."));
    }

    const head = target.split(/[.#(]/)[0];
    if (head) candidates.push(head);
    for (const c of [...candidates]) {
        const last = c.split("/").pop();
        if (last && last !== c) candidates.push(last);
    }
    return candidates.some(
        (c) =>
            HOST_GLOBALS.has(c) ||
            o.exported.has(c) ||
            o.declared.has(c) ||
            o.modules.has(c) ||
            PLACEHOLDER_RE.test(c)
    );
}

/** The PascalCase symbols an `@example` uses as constructor or method carrier. */
function exampleSymbols(code) {
    const out = new Set();
    for (const m of code.matchAll(/\bnew\s+([A-Z][A-Za-z0-9_]*)\s*\(/g)) out.add(m[1]);
    for (const m of code.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s*\.\s*[a-z][A-Za-z0-9_]*\s*\(/g))
        out.add(m[1]);
    return out;
}

/** The nature label shown in the detail — stable, it enters the baseline key. */
function declLabel(node) {
    if (ts.isFunctionDeclaration(node)) return "fonction";
    if (ts.isClassDeclaration(node)) return "classe";
    if (ts.isInterfaceDeclaration(node)) return "interface";
    if (ts.isTypeAliasDeclaration(node)) return "type";
    if (ts.isEnumDeclaration(node)) return "enum";
    if (ts.isVariableStatement(node)) return "const";
    return "export";
}

/**
 * Analyses a file and returns its violations.
 *
 * @param {string} absFile - Absolute path of the `.ts` to analyse.
 * @param {Set<string>} published - Published surface, for TSD-05's population.
 * @returns {{rule: string, file: string, line: number, symbol: string, detail: string, published?: boolean}[]}
 */
function analyse(absFile, published, oracles) {
    const text = fs.readFileSync(absFile, "utf8");
    const sf = ts.createSourceFile(absFile, text, ts.ScriptTarget.ES2022, true);
    const rel = path.relative(ROOT, absFile).replace(/\\/g, "/");
    const found = [];
    const isPublished = published.has(absFile);

    // TSD-05 — a top-level export without a TSDoc block. Separate pass over the head
    // statements: the recursive `visit` below descends into function bodies, where an
    // `export` cannot live.
    //
    // ⚠️ The grouping by NAME is load-bearing, not an optimization. An overloaded
    // function is written as N signatures + 1 implementation, all `export function f`,
    // and the TypeScript convention — the one TypeDoc follows for its rendering — puts
    // the block on ONE of them only. Judging each declaration separately accused
    // `domCreate` (3 declarations, 1 block) of TWO non-existent violations, and a
    // baseline key duplicate is what revealed it. Same reasoning for interface
    // declaration merging. The rule is therefore: for an exported name, AT LEAST one
    // declaration carries a block.
    const groups = new Map();
    for (const st of sf.statements) {
        if (!EXPORTED_DECL_KINDS.some((k) => k(st))) continue;
        if (!isExported(st)) continue;
        const line = sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1;
        const documented = hasDocBlock(st);
        for (const name of exportedNames(st, sf)) {
            const g = groups.get(name) || { line, label: declLabel(st), documented: false };
            g.documented = g.documented || documented;
            g.line = Math.min(g.line, line);
            groups.set(name, g);
        }
    }
    for (const [name, g] of groups) {
        if (g.documented) continue;
        found.push({
            rule: "TSD-05",
            file: rel,
            line: g.line,
            symbol: name,
            // The population enters the detail, hence the baseline key: if an
            // undocumented internal export becomes PUBLISHED (the `exports` map
            // changes), its key changes, the old one goes stale and TSD-04 reddens.
            // Intended — the promotion of a bare export to shipped surface is exactly
            // the event we want to see.
            detail: `export \`${name}\` (${g.label}) sans bloc TSDoc — ${
                isPublished ? "surface publiée" : "interne"
            }`,
            published: isPublished,
        });
    }

    // TSD-06 — an `@example` naming a symbol absent from BOTH oracles.
    // `oracles` is `null` when the manifest cannot be found: the rule then stays silent
    // rather than turning every private symbol into a false ghost.
    if (oracles) {
        for (const ex of extractTsdocExamples(text)) {
            for (const name of exampleSymbols(ex.code)) {
                if (HOST_GLOBALS.has(name)) continue;
                if (PLACEHOLDER_RE.test(name)) continue;
                if (oracles.exported.has(name) || oracles.declared.has(name)) continue;
                found.push({
                    rule: "TSD-06",
                    file: rel,
                    line: ex.startLine,
                    symbol: name,
                    detail: `@example nomme \`${name}\`, absent de la surface exportée ET des déclarations des sources — symbole fantôme`,
                });
            }
        }
    }

    // TSD-07 — a `{@link}` whose target is neither a symbol, nor a module, nor a
    // global. Same guard as TSD-06: without the manifest, the rule stays silent rather
    // than inventing.
    if (oracles) {
        for (const link of linkTargets(text)) {
            if (linkResolves(link.target, oracles)) continue;
            found.push({
                rule: "TSD-07",
                file: rel,
                line: link.line,
                symbol: link.target,
                detail: `{@link ${link.target}} ne désigne ni un symbole exporté, ni une déclaration des sources, ni un module du corpus — renvoi mort`,
            });
        }
    }

    const visit = (node) => {
        if (isDocumentable(node)) {
            const tags = ts.getJSDocTags(node) || [];
            if (tags.length) {
                const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
                const symbol =
                    (node.name && node.name.getText && node.name.getText(sf)) ||
                    (ts.isConstructorDeclaration(node) ? "constructor" : "<anonyme>");
                const { names, hasBindingPattern } = paramNames(node);

                const paramTags = tags.filter((t) => t.tagName.text === "param");
                // A `@param options.a` documents a property, not a parameter: we keep
                // only the root segment, and ignore dotted forms when the signature
                // carries a destructuring pattern.
                const documented = paramTags
                    .map((t) => (t.name && t.name.getText ? t.name.getText(sf) : null))
                    .filter(Boolean);
                const rootDocumented = [...new Set(documented.map((d) => d.split(".")[0]))];

                // TSD-01 — a `@param` naming no real parameter.
                if (!hasBindingPattern) {
                    for (const d of rootDocumented) {
                        if (!names.includes(d)) {
                            found.push({
                                rule: "TSD-01",
                                file: rel,
                                line,
                                symbol,
                                detail: `@param \`${d}\` ne correspond à aucun paramètre (réels : ${names.join(", ") || "aucun"})`,
                            });
                        }
                    }
                    // TSD-02 — partial parameter documentation.
                    if (rootDocumented.length > 0) {
                        const missing = names.filter((n) => !rootDocumented.includes(n));
                        if (missing.length) {
                            found.push({
                                rule: "TSD-02",
                                file: rel,
                                line,
                                symbol,
                                detail: `paramètre(s) non documenté(s) alors que d'autres le sont : ${missing.join(", ")}`,
                            });
                        }
                    }
                }

                // TSD-03 — `@throws` sans `throw`.
                const throwsTags = tags.filter((t) =>
                    ["throws", "throw", "exception"].includes(t.tagName.text)
                );
                if (throwsTags.length && !bodyThrows(node)) {
                    found.push({
                        rule: "TSD-03",
                        file: rel,
                        line,
                        symbol,
                        detail: "@throws documenté mais aucun `throw` dans le corps",
                    });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

// ---------------------------------------------------------------------------
// Baseline — the key ignores the LINE NUMBER, on purpose.
//
// A key carrying the line goes stale at the first import added above, and the gate then
// reddens on a violation it had already tolerated. The key is therefore
// `rule|file|symbol|detail`: it survives a move and does not survive the fix, which is
// exactly what one wants from a debt register.
// ---------------------------------------------------------------------------

const keyOf = (v) => `${v.rule}|${v.file}|${v.symbol}|${v.detail}`;

function readBaseline() {
    if (!fs.existsSync(BASELINE)) return { entries: [] };
    return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
}

// ---------------------------------------------------------------------------

function main() {
    const files = sourceFiles();
    const published = publishedSurface();
    // Oracle 2 (declarations): a single walk, reused — the AST pass happens below
    // anyway. Oracle 1 (manifest): one file read.
    const exportedSyms = readManifestSymbols();
    let oracles = null;
    if (exportedSyms) {
        const declared = new Set();
        for (const f of files) {
            collectDeclared(
                ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.ES2022, true),
                declared
            );
        }
        // Oracle 3 (modules) — derived from the corpus files, never from a written
        // list: a renamed module must bring down the references naming it, not linger
        // in a list that outlives its subject.
        const modules = new Set(files.map((f) => path.basename(f).replace(/\.[cm]?ts$/, "")));
        oracles = { exported: exportedSyms, declared, modules };
    }
    // `files.flatMap(analyse)` would pass the INDEX as 2nd argument — the lambda is explicit.
    const violations = files.flatMap((f) => analyse(f, published, oracles));
    const seen = new Set(violations.map(keyOf));

    if (UPDATE) {
        fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
        fs.writeFileSync(
            BASELINE,
            JSON.stringify(
                {
                    _comment:
                        "TSDOC-CONFORMITY — dette gelée. Ne peut que RÉTRÉCIR (TSD-04). " +
                        "Régénérer avec --update-baseline UNIQUEMENT après avoir corrigé, jamais pour faire taire.",
                    _generated: "scripts/check-tsdoc-conformity.cjs --update-baseline",
                    count: violations.length,
                    entries: [...seen].sort(),
                },
                null,
                4
            ) + "\n"
        );
        console.log(`✅ [TSDOC] baseline écrite — ${violations.length} entrée(s).`);
        return 0;
    }

    const baseline = new Set(readBaseline().entries || []);
    const fresh = violations.filter((v) => !baseline.has(keyOf(v)));
    const stale = [...baseline].filter((k) => !seen.has(k));

    const width = 72;
    console.log("─".repeat(width));

    if (fresh.length) {
        console.log(`❌  [TSDOC] ${fresh.length} violation(s) NEUVE(S) :\n`);
        // Published surface first: a missing TSDoc there is shipped to a reader who
        // cannot notice the drift. The output order IS the drainage priority.
        const ordered = [...fresh].sort((a, b) => (b.published ? 1 : 0) - (a.published ? 1 : 0));
        for (const v of ordered) {
            const tag = v.published ? " ⟨surface publiée⟩" : "";
            console.log(`  ${v.rule}  ${v.file}:${v.line}  ${v.symbol}${tag}`);
            console.log(`        ${v.detail}\n`);
        }
    }

    if (stale.length) {
        console.log(
            `❌  [TSDOC-04] ${stale.length} entrée(s) de baseline sans violation — la dette a été\n` +
                `    corrigée, la baseline doit suivre. Retirer ces lignes (ou --update-baseline) :\n`
        );
        for (const k of stale.slice(0, 20)) console.log(`  ${k}`);
        if (stale.length > 20) console.log(`  … et ${stale.length - 20} de plus`);
        console.log("");
    }

    if (!fresh.length && !stale.length) {
        const byRule = {};
        for (const v of violations) byRule[v.rule] = (byRule[v.rule] || 0) + 1;
        const nu = violations.filter((v) => v.rule === "TSD-05");
        const nuPub = nu.filter((v) => v.published).length;

        console.log(
            `✅  [TSDOC] conformité TSDoc — 0 violation neuve.\n` +
                `    ${files.length} fichier(s) analysé(s) · ${violations.length} entrée(s) en baseline (décroissantes).`
        );
        // Anti-empty-gate: we print the corpus ACTUALLY read, not just the verdict.
        // This tally is what replaces the withdrawn "89-92 %" and "~173" — and it is
        // reprinted at every run, so it cannot fossilize.
        console.log(
            `    TSD-05 — ${published.size} fichier(s) sur la surface publiée · ` +
                `${nu.length} export(s) sans bloc TSDoc, dont ${nuPub} publié(s).`
        );
        if (nuPub > 0) {
            console.log(
                `    ⚠️  Drainer les ${nuPub} publié(s) d'abord — leur lecteur est extérieur au dépôt.`
            );
        }
        if (VERBOSE) {
            console.log(`    Détail baseline : ${JSON.stringify(byRule)}`);
            for (const v of nu.filter((x) => x.published)) {
                console.log(`      ⟨publié⟩ ${v.file}:${v.line}  ${v.symbol}`);
            }
        }
    }

    console.log("─".repeat(width));
    return fresh.length || stale.length ? 1 : 0;
}

process.exit(main());
