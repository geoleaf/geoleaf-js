#!/usr/bin/env node
/**
 * @fileoverview ESM-PURITY — no BARE specifier may survive in a `dist/`.
 *
 * ## The defect this guard catches
 *
 * A published module carrying `import … from 'gtfs-realtime-bindings'` is
 * **unresolvable in a browser**: without an import map, a bare specifier has no URL.
 * The file loads on the integrator's side, and it breaks — silently for CI, loudly
 * for the user.
 *
 * The historical witness was real:
 * `realtime-layer/dist/geoleaf-realtime-layer.gtfs-rt-BMaf7NPc.js`, 3.3 KB, referenced
 * by nothing, **copied as-is into the 4 `deploy/` variants**. It has since been swept
 * away by `purge-dist.cjs`, which makes this guard impossible to see red on the repo
 * as-is: its witness is **fabricated** by mutation (cf. §How to see it red).
 *
 * ## The dividing line: `peerDependencies` YES, `dependencies` NO
 *
 * Not every bare specifier is a defect. `maplibre-gl` is a legitimate, intended case:
 * a WebGL engine **external to the bundle**, declared in the package's
 * `peerDependencies` AND in the rollup's `external:`
 * (`packages/core/rollup.config.mjs`). The integrator provides it; leaving it bare is
 * the contract, not the accident.
 *
 * Hence the allowlist, and its exact shape:
 *
 *   - **DERIVED**, never hard-coded — the `peerDependencies` keys read off the
 *     manifest, via `packages.cjs` (which **throws** if a package cannot be found). A
 *     hard-coded path does not break on a move: it silently stops matching, and the
 *     gate goes green guarding nothing. Class watched by
 *     `probe-gate-visibility.cjs`.
 *   - **PER PACKAGE**, not global. `maplibre-gl` is tolerated in the 6 packages that
 *     declare it, and refused everywhere else. A global allowlist would make the
 *     declaration decorative.
 *
 * And it is indeed `peerDependencies` that draws the line, not `dependencies`: the
 * historical witness `gtfs-realtime-bindings` is a **`dependencies`** of
 * `realtime-layer`. A runtime dependency leaking as a bare specifier is exactly the
 * defect; a pair declared as `peer` is the contract. The rule would not have let the
 * witness through.
 *
 * ## The three rules
 *
 *   ESM-00   **The corpus cannot be empty.** Evaluated FIRST, on the DIST-03 pattern
 *            (`check-dist-integrity.cjs`): before any build there is NO `dist/`, and
 *            the gate would come out green looking at nothing. A guard never seen red
 *            guards nothing.
 *   ESM-00b  **The corpus cannot be PARTIAL.** Every workspace declaring a `build`
 *            script must have produced at least one `.js`. 🛑 Added the very day of
 *            the landing, on a real incident: an `npm run build` launched by a
 *            concurrent session had this gate run while `purge-dist.cjs` had emptied
 *            the `dist/`, and it came out **✅ green on 101 files instead of 584** —
 *            17 % of the corpus, without a word. **ESM-00 could not see it: 101 is
 *            not 0.** The criterion derives from the manifests, never a hard
 *            threshold — an "at least N" would go stale at the first added package
 *            and would not say WHICH one is missing.
 *   ESM-01   **No bare specifier** in an `import … from`, `export … from`,
 *            `import "x"` or `import("x")` — outside the perimeter's allowlist.
 *
 * ## Why a scanner, and not a grep
 *
 * A `grep` on `from ['"]…` produces **two false positives on the repo as-is**, both
 * measured at the 2026-08-07 preflight:
 *
 *   1. `packages/core/dist/esm/capabilities/legend/legend.js` carries
 *      `* import maplibregl from "maplibre-gl";` — inside a **TSDoc** `@example`.
 *   2. `geoleaf-print.plugin.js` carries
 *      `"[GeoLeaf.Print] maplibre-gl global not found."` — inside a **string**.
 *
 * A noisy gate learns to be ignored, which is worse than an absent one — the repo
 * already wrote that after DIST-01's `maplibre-layer-builders` incident. The scanner
 * below thus neutralizes comments, strings and regex literals **before** searching,
 * and only judges real import positions. Those two occurrences are, by construction,
 * its permanent non-regression: they live on disk, and a green passes through them.
 *
 * ## Perimeter
 *
 * Derived from `packages.cjs` (`all()`), never from a `packages/*​/dist` glob — which
 * matches neither `packages/plugins/*` nor `packages/libs/*`. **Recursive** walk: the
 * flat glob `packages/*​/*​/dist/*.js` of the original statement left
 * `packages/core/dist/esm/**` — half the deliverable — out of scope. `deploy/` is
 * scanned separately, with the **union** of `peerDependencies`: a deploy variant is
 * an assembly of package `dist/`s, it inherits its sources' externals contract.
 *
 * Only the `.js` are read: the `.d.ts` are declarations (TypeScript resolves bares),
 * and there is neither `.mjs` nor `.cjs` in the `dist/`s.
 *
 * ## How to see it red
 *
 * ```bash
 * # ① ESM-01 witness — a leaking `dependencies` ⟹ exit 1
 * echo "export * from 'gtfs-realtime-bindings';" > packages/plugins/realtime-layer/dist/_witness.js
 * node scripts/verify-esm-purity.cjs; rm packages/plugins/realtime-layer/dist/_witness.js
 *
 * # ② allowlist witness — the same pair, in a package that does NOT declare it ⟹ exit 1
 * echo "export * from 'maplibre-gl';" > packages/plugins/realtime-layer/dist/_witness.js
 * node scripts/verify-esm-purity.cjs; rm packages/plugins/realtime-layer/dist/_witness.js
 *
 * # ③ counter-witness — the same pair in a package that declares it ⟹ exit 0
 * echo "export * from 'maplibre-gl';" > packages/core/dist/_witness.js
 * node scripts/verify-esm-purity.cjs; rm packages/core/dist/_witness.js
 * ```
 *
 * ② and ③ go as a pair: the gap between the two is what proves the allowlist is
 * **per package**. An allowlist never proven is indistinguishable from a
 * `return true`.
 *
 * ```bash
 * # ④ ESM-00b witness — a single missing dist/ ⟹ exit 1, naming the package
 * mv packages/plugins/table/dist /tmp/d && node scripts/verify-esm-purity.cjs
 * mv /tmp/d packages/plugins/table/dist
 * ```
 *
 * @see scripts/check-dist-integrity.cjs — DIST-03, the anti-empty-gate pattern
 * @see scripts/check-subpath-resolve.cjs — sets bares aside ("not ours to check");
 *   this gate closes that very hole
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packages = require("./lib/packages.cjs");

const ROOT = packages.ROOT;

/** Keywords after which a `/` opens a regex literal, never a division. */
const REGEX_AFTER_KEYWORD =
    /\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

/**
 * Does a `/` open a regex literal, or is it a division?
 *
 * The standard heuristic: after a value (identifier, literal, `)`, `]`, `}`) it is a
 * division; after an operator, a separator or a keyword, it is a regex. Getting it
 * wrong has no consequence on the verdict — at worst a regex literal is read as code,
 * and it would have to contain a complete import position to produce a false
 * positive.
 *
 * @param {string} maskedSoFar The already-neutralized text, whose tail is read.
 * @returns {boolean}
 */
function opensRegex(maskedSoFar) {
    const t = maskedSoFar.replace(/\s+$/, "");
    if (t === "") return true;
    if ("([{,;:=!&|?+-*%~^<>".includes(t[t.length - 1])) return true;
    return REGEX_AFTER_KEYWORD.test(t);
}

/**
 * Neutralizes comments, strings and regex literals, preserving offsets.
 *
 * The returned text has **exactly the same length** as the input: each neutralized
 * character becomes a space (or an `x` in a string's body, so the quote positions
 * stay readable), and the `\n` are kept so the line computation stays right. That
 * offset conservation is what allows recovering a string's real value from the
 * position of its opening quote.
 *
 * ⚠️ Known, accepted limit: a template `${…}` is treated as string body. An `import`
 * living inside an interpolation would not be seen. The case does not exist in
 * bundler output, and the error goes toward silence, not noise.
 *
 * @param {string} text Source of a `.js` file.
 * @returns {{masked: string, strings: Map<number, string>}} The neutralized text, and
 *   the strings' literal values indexed by their opening quote's position.
 */
function neutralise(text) {
    /** @type {Map<number, string>} */
    const strings = new Map();
    let masked = "";
    let i = 0;
    const n = text.length;

    while (i < n) {
        const c = text[i];
        const c2 = i + 1 < n ? text[i + 1] : "";

        // Line comment.
        if (c === "/" && c2 === "/") {
            while (i < n && text[i] !== "\n") {
                masked += " ";
                i++;
            }
            continue;
        }

        // Block comment — it carries the TSDoc, hence false positive #1.
        if (c === "/" && c2 === "*") {
            masked += "  ";
            i += 2;
            while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
                masked += text[i] === "\n" ? "\n" : " ";
                i++;
            }
            if (i < n) {
                masked += "  ";
                i += 2;
            }
            continue;
        }

        // Regex literal — consumed whole, otherwise a `"` or a `//` inside would
        // derail the scanner on ALL the rest of the file.
        if (c === "/" && opensRegex(masked)) {
            masked += " ";
            i++;
            let inClass = false;
            while (i < n) {
                const r = text[i];
                if (r === "\\") {
                    masked += "  ";
                    i += 2;
                    continue;
                }
                if (r === "\n") break; // unterminated regex: hand back rather than swallow everything
                if (r === "[") inClass = true;
                else if (r === "]") inClass = false;
                else if (r === "/" && !inClass) break;
                masked += " ";
                i++;
            }
            if (i < n && text[i] === "/") {
                masked += " ";
                i++;
            }
            continue;
        }

        // String — it carries false positive #2.
        if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            const openedAt = i;
            let value = "";
            masked += quote;
            i++;
            while (i < n && text[i] !== quote) {
                if (text[i] === "\\") {
                    value += text[i] + (i + 1 < n ? text[i + 1] : "");
                    masked += i + 1 < n ? "xx" : "x";
                    i += 2;
                    continue;
                }
                value += text[i];
                masked += text[i] === "\n" ? "\n" : "x";
                i++;
            }
            if (i < n) {
                masked += quote;
                i++;
            }
            strings.set(openedAt, value);
            continue;
        }

        masked += c;
        i++;
    }

    return { masked, strings };
}

/**
 * A file's import positions, with the specifier actually written.
 *
 * The two patterns cover the four ESM forms: `import … from "x"`,
 * `export … from "x"`, `import "x"` (side effect) and `import("x")` (dynamic). They
 * are searched in the NEUTRALIZED text, hence never in a comment nor a string; the
 * value, for its part, is re-read from the string table at the quote's position.
 *
 * @param {string} text Source d'un fichier `.js`.
 * @returns {{spec: string, line: number}[]}
 */
function specifiers(text) {
    const { masked, strings } = neutralise(text);

    // Line-start offsets, to render a clickable line number.
    const lineStarts = [0];
    for (let k = 0; k < masked.length; k++) if (masked[k] === "\n") lineStarts.push(k + 1);
    const lineOf = (idx) => {
        let lo = 0;
        let hi = lineStarts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (lineStarts[mid] <= idx) lo = mid;
            else hi = mid - 1;
        }
        return lo + 1;
    };

    /** @type {{spec: string, line: number}[]} */
    const out = [];
    const patterns = [/\bfrom\s*["']/g, /\bimport\s*\(?\s*["']/g];

    for (const re of patterns) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(masked)) !== null) {
            const quoteAt = m.index + m[0].length - 1;
            const spec = strings.get(quoteAt);
            if (spec === undefined) continue; // not a recognized string: we do not guess
            out.push({ spec, line: lineOf(quoteAt) });
        }
    }
    return out;
}

/**
 * Is a specifier BARE?
 *
 * Bare = neither relative (`./`, `../`), nor absolute (`/`), nor an absolute URL.
 * Everything else demands a resolution the browser cannot do without an import map —
 * including `node:fs`, which in a browser bundle is a defect and not an edge case.
 *
 * @param {string} spec
 * @returns {boolean}
 */
function isBare(spec) {
    if (spec.startsWith(".") || spec.startsWith("/")) return false;
    if (/^(https?|data|blob):/.test(spec)) return false;
    return true;
}

/**
 * Recursively scans a `dist/` and returns the ESM-01 violations.
 *
 * @param {string} label Readable name of the perimeter.
 * @param {string} distDir Absolute path of the `dist/`.
 * @param {Set<string>} allow Tolerated bare specifiers — the perimeter's `peerDependencies`.
 * @returns {{label: string, scanned: number, allow: string[], violations: object[]}}
 */
function analyse(label, distDir, allow) {
    const violations = [];
    let scanned = 0;

    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const q = path.join(dir, e.name);
            if (e.isDirectory()) {
                walk(q);
                continue;
            }
            if (!e.name.endsWith(".js")) continue;
            scanned++;
            for (const { spec, line } of specifiers(fs.readFileSync(q, "utf8"))) {
                if (!isBare(spec) || allow.has(spec)) continue;
                violations.push({ file: path.relative(ROOT, q), line, spec });
            }
        }
    })(distDir);

    return { label, scanned, allow: [...allow].sort(), violations };
}

// ── Perimeters ────────────────────────────────────────────────────────────────
// One per package, with ITS peerDependencies; then one per `deploy/` variant, with
// the union.

/** @type {object[]} */
const results = [];
/** @type {Set<string>} */
const unionPeers = new Set();

for (const p of packages.all()) {
    for (const k of Object.keys(p.manifest.peerDependencies || {})) unionPeers.add(k);
}

/** Packages declaring a `build` whose `dist/` contains no `.js`. */
const notBuilt = [];

for (const p of packages.all()) {
    const dist = path.join(p.absDir, "dist");
    const declaresBuild = Boolean(p.manifest.scripts && p.manifest.scripts.build);

    if (!fs.existsSync(dist)) {
        if (declaresBuild) notBuilt.push(`${p.name} — aucun dist/`);
        continue;
    }

    const r = analyse(p.name, dist, new Set(Object.keys(p.manifest.peerDependencies || {})));
    if (declaresBuild && r.scanned === 0) notBuilt.push(`${p.name} — dist/ sans aucun .js`);
    results.push(r);
}

const deployRoot = path.join(ROOT, "deploy");
if (fs.existsSync(deployRoot)) {
    for (const variant of fs.readdirSync(deployRoot)) {
        const dist = path.join(deployRoot, variant, "dist");
        if (!fs.existsSync(dist)) continue;
        results.push(analyse("deploy/" + variant, dist, unionPeers));
    }
}

// ── Verdict ───────────────────────────────────────────────────────────────────

const totalScanned = results.reduce((n, r) => n + r.scanned, 0);
const offenders = results.filter((r) => r.violations.length);

const BAR = "─".repeat(72);
console.log(BAR);

let failed = false;

// ESM-00 — anti-empty-gate, evaluated FIRST: without it, a never-built repo comes
// out green having looked at nothing, the most misleading result possible.
if (totalScanned === 0) {
    console.error("❌ [ESM-00] corpus VIDE — aucun fichier .js scanné dans aucun dist/.");
    console.error("   Une gate verte qui n'a rien scanné ne garde rien. Lancer un build d'abord :");
    console.error("     npx turbo run build");
    failed = true;
}

// ESM-00b — PARTIAL corpus. Absolute zero is not the only possible silence, and not
// even the most likely.
//
// 🛑 Observed on 2026-08-07, the day of the landing: an `npm run build` launched in
// parallel by another session had this gate run while `purge-dist.cjs` had emptied
// the `dist/`s and turbo was rebuilding. It came out **✅ green on 101 files instead
// of 584** — 17 % of the corpus, without a word. ESM-00 could not see it: 101 is not
// 0.
//
// The criterion is therefore DERIVED, not a threshold: every workspace declaring a
// `build` script must have produced at least one `.js`. A hard number ("at least N
// files") would go stale at the first added package, and would not say WHICH one is
// missing.
if (notBuilt.length) {
    console.error(
        "❌ [ESM-00b] corpus PARTIEL — des paquets déclarent `build` sans avoir produit :"
    );
    for (const n of notBuilt) console.error(`     ${n}`);
    console.error("   La gate ne peut pas répondre pour ce qu'elle n'a pas lu. Builder d'abord :");
    console.error("     npx turbo run build");
    failed = true;
}

for (const r of offenders) {
    failed = true;
    console.error(
        `❌ [ESM-01] ${r.label} — spécificateur(s) NU(S), irrésoluble(s) en navigateur :`
    );
    for (const v of r.violations) {
        console.error(`     ${v.file}:${v.line} → ${JSON.stringify(v.spec)}`);
    }
    console.error(
        `     Toléré ici : ${r.allow.length ? r.allow.join(", ") : "(aucune peerDependency déclarée)"}`
    );
}

if (failed) {
    // The remedy only prints when it ANSWERS what failed. ESM-00 already carries its
    // own ("run a build"); appending ESM-01's would offer declaring a peerDependency
    // to someone whose only fault is not having built. A gate that advises beside the
    // point learns to be ignored, which this file exists to avoid.
    if (offenders.length) {
        console.error("");
        console.error("   Deux issues, et une seule est la bonne selon le cas :");
        console.error("     • la paire est un EXTERNAL voulu  → la déclarer en `peerDependencies`");
        console.error("       du paquet ET en `external:` de son rollup — l'allowlist en dérive.");
        console.error("     • sinon, c'est une fuite          → la bundler, ou couper l'import.");
    }
    console.error(BAR);
    process.exit(1);
}

console.log(
    `✅ [ESM-PURITY] ${totalScanned} fichier(s) .js scanné(s) sur ${results.length} périmètre(s) — ` +
        `0 spécificateur nu hors allowlist (${unionPeers.size} paire(s) déclarée(s) en peer).`
);
console.log(BAR);
