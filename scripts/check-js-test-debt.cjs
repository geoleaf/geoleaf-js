#!/usr/bin/env node
/**
 * @fileoverview JS-TEST-DEBT — the ratchet that keeps the `.js` test debt from
 * growing, and the guard that keeps its conversion from losing a test IN SILENCE.
 *
 * ## Why this gate exists, and why it did not
 *
 * The debt register spelled it out since 2026-07-31:
 *
 *     "What keeps the debt from growing: NOTHING, and that is assumed. […] The
 *       gesture that would make this cost truly flat is known — a
 *       decreasing-baseline ratchet on the number of `.js` test files, on the
 *       NONNULL-ASSERTION-DEBT / EXACT-OPTIONAL-DEBT pattern, seen red before
 *       being believed. It has not been set."
 *
 * It is here. And the drift it freezes is not hypothetical: the core's
 * measurement gives **431 on 07-24**, **447 on 07-31**, and a preflight **457 on
 * 08-05** — i.e. +10 in five days, while the register line said "~2 files a day".
 *
 * ## 🛑 The rule that counts is NOT the counter — it is JTD-04
 *
 * A ratchet on a file count has a failure mode that turns it against itself, and
 * it is **measured** in this repo:
 *
 *     `packages/plugins/offline-ui/vitest.config.ts` declares
 *     `include: ["**​/__tests__/**​/*.test.js"]` — the extension is in the pattern.
 *
 * Renaming `a.test.js` to `a.test.ts` without touching the config makes the file
 * **invisible to vitest**. The suite stays **green with one test fewer**, the
 * baseline **shrinks**, and the ratchet applauds a regression. Exactly the class
 * "a guard never seen red guards nothing", applied to the guard itself.
 *
 * Hence **JTD-04**, no baseline and no exception: every test file present on
 * disk must be **collected by at least one vitest config of its package**. The
 * only rule here that protects the conversion; the other three protect only its
 * pace.
 *
 * ## The four rules
 *
 *   JTD-04  **Zero collection-orphan tests** — each `*.test.*` / `*.spec.*` must
 *           be matched by a package vitest config's `include`, and not removed by
 *           its `exclude`. No baseline, by construction: an uncollected test
 *           proves nothing, and nothing else in the repo sees it.
 *   JTD-01  A `.js` test file cannot be BORN as debt. Absent from the baseline
 *           ⟹ error.
 *   JTD-02  The baseline can only SHRINK. An entry without a file on disk is an
 *           error until removed.
 *   JTD-03  The corpus cannot be empty. A green gate that scanned nothing is the
 *           worst outcome (same class as NNA-03 and EOD-03).
 *
 * ## Three design decisions
 *
 * **The perimeter comes from the registry** (`scripts/lib/packages.cjs`), never a
 * hard-coded `packages/<name>` glob nor `packages/*​/src` — which matches NEITHER
 * `packages/plugins/*` NOR `packages/libs/*`, hence would put all the plugins off
 * the counter with nothing turning red. Class watched by
 * `probe-gate-visibility.cjs`.
 *
 * **The default pattern is DERIVED from `build-config/vitest/base.mjs`, not
 * copied here.** Eleven packages of sixteen have no local `include` and inherit
 * the shared factory. Copying `"**​/__tests__/**​/*.test.ts"` into this file would
 * make it a two-home value, hence a divergence biding its time.
 *
 * **The debt counts SUITES, not support files.** `*.test.js` and `*.spec.js`
 * only, so the figure stays comparable to the debt register, which counts the
 * same. The `__mocks__/` and `.js` helpers are **printed separately**: they are
 * part of a conversion's real cost — the `3125e0f6` precedent had to replace
 * `config-harness.js` — but adding them in would make the counter incomparable to
 * the two register lines it serves.
 *
 * ## Usage
 *
 *        node scripts/check-js-test-debt.cjs
 *        node scripts/check-js-test-debt.cjs --update-baseline
 *
 * ⚠️ `--update-baseline` is run AFTER converting a batch, never to silence a new
 * file — which must be written in TypeScript, not frozen. And it can do NOTHING
 * for JTD-04, which has no baseline.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(ROOT, "scripts", ".baselines", "js-test-debt.json");
const BASE_CONFIG = path.join(ROOT, "packages", "build-config", "vitest", "base.mjs");
const UPDATE = process.argv.includes("--update-baseline");

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".turbo", ".vite"]);
const SUITE_RE = /\.(test|spec)\.(js|mjs|cjs|ts|mts|cts|tsx)$/;
const JS_SUITE_RE = /\.(test|spec)\.(js|mjs|cjs)$/;

/**
 * Converts a vitest glob into an anchored regular expression.
 *
 * The patterns handled here are vitest `include` / `exclude` ones, relative to
 * the package root: `**​/__tests__/**​/*.test.js`, `**​/node_modules/**`,
 * `**​/__tests__/bundle.test.js`.
 *
 * ⚠️ A globstar followed by a separator translates into an OPTIONAL group, not
 * "at least one directory": the segment must be able to match **zero**
 * directories, without which `__tests__/foo.test.js` would escape the core's
 * pattern — i.e. the gate would declare its 457 files orphans, which sit
 * precisely at that depth.
 *
 * @param {string} glob vitest pattern
 * @returns {RegExp} anchored on the whole string
 */
function globToRegExp(glob) {
    let out = "";
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === "*") {
            if (glob[i + 1] === "*") {
                if (glob[i + 2] === "/") {
                    out += "(?:.*/)?";
                    i += 2;
                } else {
                    out += ".*";
                    i += 1;
                }
            } else {
                out += "[^/]*";
            }
        } else if (c === "?") {
            out += "[^/]";
        } else {
            out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${out}$`);
}

/**
 * Reads the **direct** `include` / `exclude` arrays of a vitest config's `test` object.
 *
 * ⚠️ The visit stops at `test`'s direct properties. `test.coverage.include`
 * carries the same name and designates something else entirely — the measured
 * sources, not the collected suites. Confusing them would judge a test's
 * collection on the coverage perimeter.
 *
 * @param {string} file absolute path of a vitest config
 * @returns {{ include: string[] | null, exclude: string[] | null }} `null` = not
 *   declared, meaning "inherited from the factory", distinct from an empty array
 */
function readTestGlobs(file) {
    const sf = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.ES2022,
        true
    );

    /** @type {{ include: string[] | null, exclude: string[] | null }} */
    const found = { include: null, exclude: null };

    /**
     * @param {import("typescript").ObjectLiteralExpression} obj
     * @returns {void}
     */
    const readDirect = (obj) => {
        for (const prop of obj.properties) {
            if (!ts.isPropertyAssignment(prop) || !prop.name) continue;
            const key = prop.name.getText(sf).replace(/['"]/g, "");
            if (key !== "include" && key !== "exclude") continue;
            if (!ts.isArrayLiteralExpression(prop.initializer)) continue;
            const values = prop.initializer.elements
                .filter((el) => ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el))
                .map((el) => el.text);
            found[key] = values;
        }
    };

    const visit = (node) => {
        if (
            ts.isPropertyAssignment(node) &&
            node.name &&
            node.name.getText(sf).replace(/['"]/g, "") === "test" &&
            ts.isObjectLiteralExpression(node.initializer)
        ) {
            readDirect(node.initializer);
            return; // do not descend: `coverage.include` lives below
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);

    return found;
}

/**
 * The default collection pattern, **read in the shared factory** rather than copied.
 *
 * @returns {{ include: string[], exclude: string[] }}
 * @throws {Error} if the factory no longer declares an `include` — in which case
 *   this gate is what would become silently false, and it is better it stops.
 */
function inheritedGlobs() {
    const globs = readTestGlobs(BASE_CONFIG);
    if (!globs.include || globs.include.length === 0) {
        throw new Error(
            `[JS-TEST-DEBT] ${path.relative(ROOT, BASE_CONFIG)} ne déclare plus de ` +
                "`test.include` — le défaut hérité ne peut plus être dérivé. Corriger la " +
                "lecture plutôt que recopier un motif ici."
        );
    }
    return { include: globs.include, exclude: globs.exclude ?? [] };
}

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]} all the subtree's files, artifacts excluded
 */
function collectFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            collectFiles(path.join(dir, entry.name), out);
        } else {
            out.push(path.join(dir, entry.name));
        }
    }
    return out;
}

/**
 * @param {import("./lib/packages.cjs")} pkg
 * @returns {{ include: RegExp[], exclude: RegExp[] }[]} one pattern set per vitest config
 */
function collectConfigs(pkgDirAbs, fallback) {
    const configs = fs
        .readdirSync(pkgDirAbs)
        .filter((f) => /^vitest(\..+)?\.config\.(ts|mts|cts|js|mjs|cjs)$/.test(f))
        .sort();

    return configs.map((name) => {
        const globs = readTestGlobs(path.join(pkgDirAbs, name));
        const include = globs.include ?? fallback.include;
        const exclude = globs.exclude ?? fallback.exclude;
        return {
            name,
            include: include.map(globToRegExp),
            exclude: exclude.map(globToRegExp),
        };
    });
}

/**
 * @returns {{ debt: string[], orphans: string[], support: string[], scanned: number,
 *   packages: number }}
 */
function scan() {
    const fallback = inheritedGlobs();
    const debt = [];
    const orphans = [];
    const support = [];
    let scanned = 0;
    let packages = 0;

    for (const pkg of registry.all()) {
        const pkgDirAbs = path.join(ROOT, pkg.dir);
        if (!fs.existsSync(pkgDirAbs)) continue;
        packages++;

        const configs = collectConfigs(pkgDirAbs, fallback);

        for (const file of collectFiles(pkgDirAbs)) {
            const rel = path.relative(ROOT, file).split(path.sep).join("/");
            const relPkg = path.relative(pkgDirAbs, file).split(path.sep).join("/");
            const base = path.basename(file);
            const inTestDir = /(^|\/)(__tests__|__mocks__)(\/|$)/.test(relPkg);

            if (SUITE_RE.test(base)) {
                scanned++;

                // JTD-04 — collected by at least one package config?
                const collected = configs.some(
                    (c) =>
                        c.include.some((re) => re.test(relPkg)) &&
                        !c.exclude.some((re) => re.test(relPkg))
                );
                if (!collected) {
                    orphans.push(
                        `${rel}  (configs du paquet : ${configs.map((c) => c.name).join(", ") || "AUCUN"})`
                    );
                }

                if (JS_SUITE_RE.test(base)) debt.push(rel);
            } else if (inTestDir && /\.(js|mjs|cjs)$/.test(base)) {
                support.push(rel);
            }
        }
    }

    return {
        debt: debt.sort(),
        orphans: orphans.sort(),
        support: support.sort(),
        scanned,
        packages,
    };
}

const { debt, orphans, support, scanned, packages } = scan();
const bar = "─".repeat(72);

// ── JTD-03 — a gate that scanned nothing proved nothing ──────────────────────────────────
if (scanned === 0) {
    console.error("ERROR [JS-TEST-DEBT/JTD-03]: corpus vide — 0 suite de test scannée.");
    console.error(
        `  ${packages} paquet(s) parcouru(s) depuis le registre. Si le dépôt a des tests,\n` +
            "  c'est la gate qui est aveugle, pas le dépôt qui est propre."
    );
    process.exit(2);
}

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        // Indentation 4: Prettier owns `scripts/**/*.json` at `tabWidth: 4` and
        // would reformat the whole file at commit, making one line's removal
        // unreadable.
        JSON.stringify(
            {
                _comment:
                    "JS-TEST-DEBT — suites de test encore en JavaScript (dette gelée " +
                    "au registre). Cette liste ne peut que RÉTRÉCIR (JTD-02) et aucune entrée ne " +
                    "peut y NAÎTRE (JTD-01) : un test neuf s'écrit en TypeScript. Elle ne " +
                    "contient PAS les fichiers de support (`__mocks__/`, helpers) — ils " +
                    "sont imprimés à part par la gate, pour que ce compteur reste " +
                    "comparable au registre de dette, qui compte les suites. ⚠️ Elle ne dit " +
                    "rien de JTD-04, qui n'a pas de baseline : convertir un fichier sans " +
                    "élargir le `include` de son vitest.config le rend INVISIBLE, et " +
                    "rétrécit cette liste en perdant un test. Régénérer avec " +
                    "--update-baseline UNIQUEMENT après conversion, jamais pour faire taire.",
                _generated: "node scripts/check-js-test-debt.cjs --update-baseline",
                count: debt.length,
                entries: debt,
            },
            null,
            4
        ) + "\n"
    );
    console.log(`✅ [JS-TEST-DEBT] baseline régénérée — ${debt.length} suite(s) JS.`);
    process.exit(0);
}

// ── JTD-04 — no baseline, no exception ───────────────────────────────────────────────────
if (orphans.length > 0) {
    console.log(bar);
    console.error(
        `❌ [JS-TEST-DEBT/JTD-04] ${orphans.length} suite(s) que vitest NE COLLECTE PAS :`
    );
    for (const o of orphans) console.error(`     ${o}`);
    console.error(
        "\n  Ce fichier ne tourne nulle part. Sa suite est verte parce qu'elle n'existe pas\n" +
            "  pour le runner — pas parce qu'elle passe. Cause la plus fréquente : une\n" +
            "  conversion `.test.js` → `.test.ts` sans élargir le `include` du config, qui\n" +
            "  porte l'extension dans son motif. Corriger le `include`, ou le nom du fichier."
    );
    console.log(bar);
    process.exit(1);
}

if (!fs.existsSync(BASELINE)) {
    // An absent baseline is NOT an empty list: it would declare the debt settled.
    // Same refusal as `check-nonnull-assertion-debt.cjs`.
    console.error("ERROR [JS-TEST-DEBT]: baseline absente.");
    console.error("  Run: node scripts/check-js-test-debt.cjs --update-baseline");
    process.exit(2);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
const seen = new Set(debt);

const fresh = debt.filter((k) => !baseline.has(k)); // JTD-01
const stale = [...baseline].filter((k) => !seen.has(k)).sort(); // JTD-02

console.log(bar);

if (fresh.length === 0 && stale.length === 0) {
    console.log(
        `✅ [JS-TEST-DEBT] 0 suite non collectée (JTD-04) · ${debt.length} suite(s) JS gelée(s) ` +
            `— baseline à jour (${scanned} suites, ${packages} paquets).`
    );
    console.log(
        `   ℹ ${support.length} fichier(s) de support \`.js\` sous \`__tests__\`/\`__mocks__\` —`
    );
    console.log(
        "     hors compteur (la dette compte les suites), mais dans le coût d'une conversion."
    );
    console.log(bar);
    process.exit(0);
}

if (fresh.length > 0) {
    console.error(`❌ [JS-TEST-DEBT/JTD-01] ${fresh.length} suite(s) JS NOUVELLE(S) :`);
    for (const k of fresh) console.error(`     + ${k}`);
    console.error(
        "\n  Un test neuf s'écrit en TypeScript. La dette `.js` est gelée, pas ouverte :\n" +
            "  elle a dérivé de +10 fichiers en 5 jours faute de ce cliquet. Convertir le\n" +
            "  fichier, ou motiver le gel sur place avec --update-baseline."
    );
}

if (stale.length > 0) {
    console.error(
        `\n❌ [JS-TEST-DEBT/JTD-02] ${stale.length} entrée(s) de baseline sans fichier :`
    );
    for (const k of stale) console.error(`     - ${k}`);
    console.error(
        "\n  Ces suites ont quitté le JavaScript — bonne nouvelle, mais la baseline doit\n" +
            "  l'enregistrer : `--update-baseline`. ⚠️ Vérifier D'ABORD que la conversion est\n" +
            "  bien COLLECTÉE (JTD-04 est passée) et que le nombre de tests n'a pas baissé :\n" +
            "  une suite renommée hors du `include` disparaît d'ici en ayant l'air d'un progrès."
    );
}

console.log(bar);
process.exit(1);
