"use strict";
/**
 * ci-parity.cjs — `ci.yml`'s perimeter, compared LEAF BY LEAF to `ci:local`'s.
 *
 * ## What this module exists to make true
 *
 * `ci-local.cjs` declares at its head the property `ci:local ⊇ ci.yml`,
 * and calls it "verified, not conventioned". That was an over-claim:
 * `lib/test-scope.cjs` verifies the UNIT TESTS' perimeter, and nothing
 * verified the GATE LIST. A single comment line ("Keep this list in sync
 * with .github/workflows/ci.yml") stood in for a guard, i.e. a manual
 * gesture where the file announced a guarantee. The cost is direct: the
 * GitHub Actions quota is scarce, and the push protocol makes the local
 * green the ONLY criterion before spending any.
 *
 * ## Why by LEAF and never by step
 *
 * A `ci.yml` step can chain several commands, and they do not fall into
 * the same category. The E2E step chains four:
 *
 *     node scripts/build-deploy.cjs           → equivalent to `build:deploy:all` (witness)
 *     node scripts/build-deploy-coverage.cjs  → covered, but under `--e2e` only
 *     playwright install --with-deps chromium → environment, not a gate
 *     playwright test                         → covered, but under `--e2e` only
 *
 * A per-step classification would have declared it "covered" on two leaves
 * out of four and lost the other two silently. The per-leaf classification
 * is the CONDITION for the "not covered" category to be able to be empty
 * without lying.
 *
 * ## Why a homemade parser rather than `yaml`
 *
 * `js-yaml` is absent, and `yaml` only resolves TRANSITIVELY (hoisted from
 * knip/lint-staged). Using it would be a ghost dependency: knip's
 * "undeclared imports" category would flag it — this gate would thus break
 * the `dead-code` gate that runs before it — and an `npm install` that
 * de-hoists `yaml` would kill it in `MODULE_NOT_FOUND`, i.e. a gate that
 * disappears.
 *
 * ⚠️ The serious objection is that this is exactly the "textual parser
 * that stops matching" that `verify-ci-scripts-tracked.cjs` forbids in its
 * own header. The answer is NOT "this parser will be good". It is that the
 * property is not carried by the parser, but by three instruments around it:
 *
 *   1. It is STRICT — it never skips. Any line of the `jobs:` block it
 *      cannot classify THROWS. Skipping is going blind silently; throwing
 *      is refusing to conclude.
 *   2. A COUNTER-INSTRUMENT of a different nature, on the same corpus: a
 *      raw grep count must return exactly as many `run:`/`uses:` as the
 *      structured walk. A parser that stops matching returns FEWER, the
 *      grep returns as many, and the gap turns red. A declared `yaml`
 *      would not excuse this check: it returns a correct tree, not the
 *      proof that the tree really is the whole file.
 *   3. WITNESS FLOORS, for the collapse strictness does not see (all the
 *      indentation shifted one notch, uniformly and validly).
 *
 * ## This module executes nothing at import
 *
 * Same constraint as `lib/hygiene-patterns.cjs`, extracted from
 * `verify-repo-hygiene.cjs` so a second reader could query it:
 * `ci-local.cjs` reads this data for its end-of-run statement, and must
 * neither spawn nor risk a `process.exit` at import. No function here
 * calls `process.exit` — they throw, the caller decides.
 */

const fs = require("node:fs");
const path = require("node:path");
const registry = require("./packages.cjs");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * Workflow directory. Overridable so the gate is PROVABLE: without this
 * hook, the only way to see it turn red would be to modify the real
 * `ci.yml` — so it would be done once, at laying, and never again.
 * Precedent established ×3 in the repo (`GEOLEAF_NYC_OUTPUT`,
 * `GEOLEAF_DOCS_SITE_ROOT`, `GEOLEAF_LOAD_AUDIT_DIR`).
 *
 * ⚠️ The corpus is READ, never hardcoded file by file: a hardcoded path
 * silently stops matching at the slightest rename, and the gate exits
 * green having scanned nothing.
 */
function workflowDir() {
    const override = process.env.GEOLEAF_CI_WORKFLOW_DIR;
    return override ? path.resolve(ROOT, override) : path.join(ROOT, ".github", "workflows");
}

/**
 * Does this workflow DELIVER, rather than VERIFY?
 *
 * Criterion derived from the trigger, and deliberately narrow: an `on:`
 * block carrying `tags:` (or a `release:`) **and no** `branches:`. A
 * workflow triggered on a branch or a pull request stays a validation,
 * even if it also delivers.
 *
 * ⚠️ **The doubt's direction is the subject.» Wrongly classifying a
 * validation as delivery takes it out of the comparison **silently**;
 * wrongly classifying a delivery as validation only turns it red, hence
 * gets looked at. The second error is seen, the first is not — hence a
 * criterion that refuses to conclude at the slightest `branches:`. Without
 * that narrowness, `ci.yml` would become exemptable by adding a `tags:` to
 * it, i.e. the gate would be disarmed through the door it just opened.
 *
 * @param {string} text The workflow file's content.
 * @returns {boolean} `true` if the workflow delivers and leaves the comparison.
 */
function isDeliveryWorkflow(text) {
    // The `on:` block alone — up to the next top-level key.
    const onBlock = text.match(/^on:\s*$([\s\S]*?)^[a-z]/m);
    const scope = onBlock ? onBlock[1] : "";
    if (!scope) return false;
    const hasTags = /^\s{2,}(tags|release):/m.test(scope);
    const hasBranches = /^\s{2,}branches:/m.test(scope);
    return hasTags && !hasBranches;
}

/**
 * Witness floors — 30/07/2026 measure: 1 workflow, 1 job, 55 steps
 * (48 `run:`, 7 `uses:`), and 56 entries in `STEPS`.
 *
 * ⚠️ They bear on the CORPUS, never the VERDICT. A floor on "N covered
 * steps" would be a coverage ratchet: it would turn red at the first gate
 * rightly removed, which `verify-ci-scripts-tracked.cjs`'s `MIN_RESOLVED`
 * explicitly refuses. They are deliberately UNDER the measure — they
 * detect a collapse, not a unit — and do not re-ratchet at each gate
 * added: `ci.yml` gained one during the writing.
 */
const FLOOR = {
    workflows: 1,
    jobs: 1,
    steps: 45,
    runKeys: 38,
    ciLeaves: 35,
    localSteps: 45,
};

// ── Parseur strict ───────────────────────────────────────────────────────────

/** YAML shapes this parser does not model, and on which it refuses to guess. */
const UNMODELLED = [
    [/(^|\s)&[A-Za-z0-9_-]+\s*$/, "ancre YAML (`&nom`)"],
    [/:\s*\*[A-Za-z0-9_-]+\s*$/, "alias YAML (`*nom`)"],
    [/^\s*<<\s*:/, "clé de fusion (`<<:`)"],
    [/^\s*[A-Za-z0-9_.-]+:\s*\{/, "mapping en flot (`{…}`)"],
];

/**
 * Parses a workflow into `{ jobs: [{ id, steps: [...] }] }`.
 *
 * @param {string} text The file's content.
 * @param {string} file The file's name, for error messages.
 * @returns {{jobs: {id: string, line: number, steps: object[]}[]}} The job tree.
 * @throws {Error} On any `jobs:` block line the parser cannot classify.
 */
function parseWorkflow(text, file) {
    const raw = text.split(/\r?\n/);
    const err = (i, msg) => {
        throw new Error(`${file}:${i + 1} — ${msg}`);
    };

    // Comments are stripped BEFORE any shape detection: `ci.yml` carries
    // French comments with markdown **bold**, and a `*word*` there would
    // trigger a false "YAML alias". Only fully commented lines are removed;
    // a `# v4` at the end of a `uses:` is handled by the value reader, not here.
    const lines = raw.map((l) => (/^\s*#/.test(l) ? "" : l));

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        for (const [re, what] of UNMODELLED) {
            if (re.test(lines[i])) err(i, `${what} — non modélisé, ce parseur refuse de deviner`);
        }
    }

    const indentOf = (l) => l.match(/^ */)[0].length;
    const isBlank = (l) => !l.trim();

    // `jobs:` at root indentation.
    let jobsLine = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^jobs:\s*$/.test(lines[i])) {
            jobsLine = i;
            break;
        }
    }
    if (jobsLine === -1) throw new Error(`${file} — aucun bloc \`jobs:\` à l'indentation 0`);

    // The `jobs:` block's bounds: up to the next indentation-0 key.
    let jobsEnd = lines.length;
    for (let i = jobsLine + 1; i < lines.length; i++) {
        if (!isBlank(lines[i]) && indentOf(lines[i]) === 0) {
            jobsEnd = i;
            break;
        }
    }

    // The job identifiers' indentation — DERIVED, never assumed to be 4.
    let jobIdIndent = -1;
    for (let i = jobsLine + 1; i < jobsEnd; i++) {
        if (isBlank(lines[i])) continue;
        jobIdIndent = indentOf(lines[i]);
        break;
    }
    if (jobIdIndent <= 0) throw new Error(`${file} — bloc \`jobs:\` vide`);

    const jobs = [];
    for (let i = jobsLine + 1; i < jobsEnd; i++) {
        if (isBlank(lines[i])) continue;
        if (indentOf(lines[i]) !== jobIdIndent) continue;
        const m = lines[i].match(/^\s*([A-Za-z0-9_.-]+):\s*$/);
        if (!m) err(i, `identifiant de job attendu à l'indentation ${jobIdIndent}`);
        let end = jobsEnd;
        for (let j = i + 1; j < jobsEnd; j++) {
            if (!isBlank(lines[j]) && indentOf(lines[j]) <= jobIdIndent) {
                end = j;
                break;
            }
        }
        jobs.push({ id: m[1], line: i + 1, steps: parseSteps(lines, i + 1, end, file, err) });
    }

    if (!jobs.length) throw new Error(`${file} — aucun job`);
    return { jobs };
}

/** Extracts a job block's steps. A job WITHOUT `steps:` turns red rather than being skipped. */
function parseSteps(lines, from, to, file, err) {
    const indentOf = (l) => l.match(/^ */)[0].length;
    const isBlank = (l) => !l.trim();

    let stepsLine = -1;
    for (let i = from; i < to; i++) {
        if (/^\s*steps:\s*$/.test(lines[i])) {
            stepsLine = i;
            break;
        }
    }
    if (stepsLine === -1) {
        // A job without `steps:` is a reusable workflow
        // (`jobs.<id>.uses:`): its content is beyond this parser's reach.
        // Skipping it silently would put half the CI out of the field while
        // displaying "0 not covered" — the "empty perimeter" failure mode
        // this whole file exists to forbid.
        throw new Error(
            `${file}:${from} — job sans \`steps:\` (workflow réutilisable ?). Ce parseur ne le ` +
                `modélise pas, et le sauter mettrait ses gates hors du champ sans le dire.`
        );
    }

    // The sequence elements' indentation — DERIVED from the first dash met.
    let itemIndent = -1;
    for (let i = stepsLine + 1; i < to; i++) {
        if (isBlank(lines[i])) continue;
        if (/^\s*- /.test(lines[i])) {
            itemIndent = indentOf(lines[i]);
            break;
        }
        err(i, "élément de séquence attendu sous `steps:`");
    }
    if (itemIndent === -1) err(stepsLine, "`steps:` sans aucune étape");

    const steps = [];
    for (let i = stepsLine + 1; i < to; i++) {
        if (isBlank(lines[i]) || indentOf(lines[i]) !== itemIndent) continue;
        if (!/^\s*- /.test(lines[i]))
            err(i, `élément de séquence attendu à l'indentation ${itemIndent}`);
        let end = to;
        for (let j = i + 1; j < to; j++) {
            if (!isBlank(lines[j]) && indentOf(lines[j]) <= itemIndent) {
                end = j;
                break;
            }
        }
        steps.push(parseStep(lines, i, end, itemIndent, file, err));
    }
    return steps;
}

/** A step: `name`, `run` (full command, block scalars included), `uses`, `if`. */
function parseStep(lines, start, end, itemIndent, file, err) {
    const indentOf = (l) => l.match(/^ */)[0].length;
    const keyIndent = itemIndent + 2; // YAML: a mapping's keys align after the "- "
    const step = {
        line: start + 1,
        name: null,
        run: null,
        uses: null,
        hasIf: false,
        hasEnv: false,
    };

    for (let i = start; i < end; i++) {
        if (!lines[i].trim()) continue;
        const ind = i === start ? itemIndent : indentOf(lines[i]);
        // The first `- key:` and the following keys live at the same logical level.
        if (i !== start && ind !== keyIndent) continue; // sub-block (`with:`, `env:`) — ignored
        const body = i === start ? lines[i].replace(/^\s*- /, "") : lines[i].trim();
        const m = body.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
        if (!m) err(i, "clé d'étape attendue");
        const [, key, rest] = m;

        if (key === "run") step.run = readScalar(lines, i, rest, keyIndent);
        else if (key === "uses") step.uses = stripTrailingComment(rest).trim();
        else if (key === "name")
            step.name = stripTrailingComment(rest)
                .trim()
                .replace(/^["']|["']$/g, "");
        // ⚠️ The CONDITION is retained, not only its presence. `hasIf`
        // alone could not tell `if: always()` from
        // `if: github.event_name == 'workflow_dispatch'`, and that is
        // exactly the distinction PARITY-11 needs to verify the E2E steps
        // stay out of the `push` path.
        else if (key === "if") {
            step.hasIf = true;
            step.ifCond = stripTrailingComment(rest).trim();
        } else if (key === "env") step.hasEnv = true;
        // `with:`, `id:`, `continue-on-error:`… — without effect on the perimeter.
    }

    if (!step.run && !step.uses) {
        err(start, "étape sans `run:` ni `uses:` — forme non modélisée");
    }
    return step;
}

/** Reads a scalar value, absorbing a block scalar (`|`, `>`) if there is one. */
function readScalar(lines, i, inline, keyIndent) {
    const head = inline.trim();
    if (!/^[|>][-+]?$/.test(head)) return stripTrailingComment(head).trim();
    const parts = [];
    for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].trim()) continue;
        if (lines[j].match(/^ */)[0].length <= keyIndent) break;
        parts.push(lines[j].trim());
    }
    return parts.join(" ");
}

/**
 * Removes a trailing line comment (` # v4`).
 *
 * ⚠️ Only cuts on a `#` preceded by a space AND outside quotes — otherwise
 * `--flag=a#b` or a string containing a `#` would be truncated, and the
 * produced leaf would not be the command really executed.
 */
function stripTrailingComment(s) {
    let quote = null;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quote) {
            if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === "#" && i > 0 && /\s/.test(s[i - 1])) {
            return s.slice(0, i);
        }
    }
    return s;
}

/**
 * Counter-instrument: RAW count of the `run:`/`uses:` keys, without going
 * through the parser.
 *
 * ⚠️ The `- run:` form (first key of a sequence element) counts as much as
 * ` run:`. A `grep '^\s*uses:'` misses two out of seven in the current
 * `ci.yml` — exactly the measurement error this module must refuse to commit.
 */
function rawCounts(text) {
    const body = text
        .split(/\r?\n/)
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
    return {
        runKeys: (body.match(/^ +(?:- )?run:/gm) || []).length,
        usesKeys: (body.match(/^ +(?:- )?uses:/gm) || []).length,
    };
}

// ── Leaf resolver ────────────────────────────────────────────────────────────

const NPM_RUN_RE = /^npm run ([\w:.-]+)(.*)$/;
const WORKSPACE_RE = /(?:-w|--workspace)[= ]([@\w./-]+)/;

/** Splits a shell command on its top-level chainings. */
function splitChain(cmd) {
    return cmd
        .split(/&&|\|\||;/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Normalises a command segment to a comparable canonical form.
 *
 * Each normalisation has a cost, named here:
 *  • `npx ` removed — `npx eslint` and `eslint` resolve the same local
 *    binary. Cost: an `npx package@version` aiming at a NOT-installed
 *    binary would become indistinguishable from the local one. No case
 *    today; to re-decide if one appears.
 *  • `npm test` / `npm t` → `npm run test`, otherwise the local unit gate does not resolve.
 *  • whitespace collapsed. Nothing else: the argv's ORDER and CONTENT stay
 *    significant, and that is what keeps `--plugins=addpoi` from matching `--plugins=all`.
 */
function normalize(seg) {
    let s = seg.replace(/\s+/g, " ").trim();
    s = s.replace(/^npx (?:--yes |-y )?/, "");
    s = s.replace(/^npm (?:test|t)\b/, "npm run test");
    return s;
}

function scriptsOf(pkgDir) {
    const file = path.join(pkgDir, "package.json");
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8")).scripts || {};
}

/**
 * Unfolds a command to its canonical LEAF commands.
 *
 * An `npm run <x>` is replaced by the script's body, resolved in the RIGHT
 * `package.json`: `-w`/`--workspace` moves the resolution to the named
 * package, and without this case `test:bundle --workspace=@geoleaf/core`
 * (CI) and `test:bundle -w @geoleaf/core` (local) would be two different
 * leaves — three false reds from the start.
 *
 * An `npm run` nothing defines becomes `UNRESOLVED:<name>` rather than an
 * ordinary leaf. The distinction counts: classified "not covered", a
 * parity defect would be read where the real defect is a broken `ci.yml`,
 * which will die with "Missing script" on the runner.
 *
 * @param {string} cmd Full command, chainings included.
 * @param {string|null} [ws] Current resolution package.
 * @param {Set<string>} [seen] Recursion guard for cyclic npm scripts.
 * @returns {string[]} Canonical leaves, in execution order.
 */
function resolveLeaves(cmd, ws = null, seen = new Set()) {
    const out = [];
    for (const rawSeg of splitChain(cmd)) {
        const seg = normalize(rawSeg);
        const m = seg.match(NPM_RUN_RE);
        if (!m) {
            out.push(ws ? `${seg} @${ws}` : seg);
            continue;
        }
        const [, name, tail] = m;
        const wsMatch = tail.match(WORKSPACE_RE);
        const nextWs = wsMatch ? wsMatch[1] : ws;
        const key = `${name} @${nextWs || ""}`;
        if (seen.has(key)) continue; // cycle — already unfolded
        seen.add(key);

        let dir = ROOT;
        if (nextWs) {
            const entry = registry.byName(nextWs);
            if (!entry) {
                out.push(`UNRESOLVED:${name} @${nextWs}`);
                continue;
            }
            dir = entry.absDir;
        }
        const body = scriptsOf(dir)[name];
        if (body === undefined) {
            out.push(`UNRESOLVED:${name}${nextWs ? ` @${nextWs}` : ""}`);
            continue;
        }
        out.push(...resolveLeaves(body, nextWs, seen));
    }
    return out;
}

/** Leaves reached by a `ci-local.cjs` step table. */
function leavesOfSteps(steps) {
    const set = new Set();
    for (const step of steps) {
        for (const leaf of resolveLeaves(step.run.join(" "))) set.add(leaf);
    }
    return set;
}

// ── The four tables ──────────────────────────────────────────────────────────
//
// A hardcoded allowlist would become again the "Keep this list in sync"
// being replaced, under a nobler name. Hence two properties, on all four tables:
//
//   • they are KEYED on a canonical leaf — a key designating nothing any
//     more turns RED (same asymmetry as test-scope.cjs's
//     `assertExclusionKeysAlive`: a key that no longer excuses anything is
//     always an error, while a step absent from the tables is the normal case);
//   • each entry carries a WITNESS, evaluated at every run, returning
//     `false` when the exemption's CAUSE falls. The inversion of
//     `probe-gate-visibility.cjs`'s `PENDING`: there an expected-red item
//     turning green turns red "so it does not rot into a lie"; here it is
//     an excuse whose reason for being vanished.
//
// ⚠️ **On WHICH leaf they are keyed is NOT uniform, and writing "all four
// are keyed on `ci.yml`" would be false.» The first three are, because
// they all answer "why is this remote leaf not launched locally". The
// fourth, `LOCAL_ONLY`, is keyed on a `ci:local` leaf: it carries the
// INVERSE question, and that asymmetry is precisely why it was missing so long.
//
// `gateReelle` separates "uncoverable and inert" (installing Node,
// publishing an artefact) from "uncoverable but a real gate" (gitleaks).
// The end-of-run statement only counts the latter: mixing in the former
// would inflate the announced figure, and nobody would read it any more.

/** @type {Record<string, {classe: string, gateReelle: boolean, motif: string, temoin: (ctx: object) => boolean}>} */
const EXEMPTIONS = {
    "npm ci": {
        classe: "ENV",
        gateReelle: false,
        motif: "installation des dépendances — le poste local les a déjà.",
        // If `npm ci` stops being the workflow's first command, the order
        // changed enough for this excuse to deserve rereading rather than renewal.
        temoin: (ctx) => ctx.firstLeaf === "npm ci",
    },
    "playwright install --with-deps chromium": {
        classe: "ENV",
        gateReelle: false,
        motif: "runner neuf à chaque run ; le poste local présuppose les navigateurs installés.",
        // Without a local E2E suite, installing browsers no longer excuses anything.
        temoin: (ctx) => ctx.e2eLeaves.has("playwright test"),
    },
    "vitest run --reporter=json --outputFile=test-results.json --reporter=verbose": {
        classe: "FORME",
        gateReelle: false,
        motif:
            "même corpus, ordonnanceur différent — `ci.yml` lance vitest en mode `projects`, " +
            "`ci:local` essaime par turbo. L'INCLUSION des périmètres est vérifiée par " +
            "test-scope.cjs, pas conventionnée.",
        temoin: () => {
            const ts = require("./test-scope.cjs");
            ts.assertUnitScopeCoversRoot(); // throws if the inclusion falls
            // ⚠️ …and the inclusion is true ON EMPTY if both perimeters
            // shrink in concert. A witness must verify what it delegates to
            // is not empty, otherwise the doctrine stops one level too early.
            return ts.rootProjectScope().length >= 8;
        },
    },
    "node scripts/check-test-failures.cjs": {
        classe: "CI-SEULE",
        gateReelle: true,
        motif:
            "parse `test-results.json`, que seul le reporter JSON de `ci.yml` produit. " +
            "`ci:local` se fie aux codes de sortie de turbo/vitest.",
        temoin: (ctx) =>
            [...ctx.ciLeaves].some((l) => l.includes("--outputFile=test-results.json")),
    },
    "node scripts/build-deploy.cjs": {
        classe: "ÉQUIVALENCE",
        gateReelle: false,
        motif:
            "PAS un surensemble de `build:deploy:all` — la MÊME exécution. Sans argument, " +
            'resolvePluginMode rend null, et `buildsAllVariants(null) === buildsAllVariants("all")`.',
        // The witness calls the predicate the build ITSELF uses
        // (build-deploy.cjs exports it and derives BUILD_ALL_VARIANTS from
        // it): a copy of the formula here would keep saying "equivalent"
        // after the rule changed.
        temoin: () => {
            const { resolvePluginMode, buildsAllVariants } = require("../build-deploy.cjs");
            return (
                buildsAllVariants(resolvePluginMode([])) === true &&
                buildsAllVariants(resolvePluginMode(["--plugins=all"])) === true
            );
        },
    },
};

/**
 * External actions. KEYED on `owner/repo`, NEVER on the SHA: pinning the
 * SHA would turn the gate red at every dependabot bump, and a noisy gate
 * ends up disarmed. The SHA is printed in the report — visible without blocking.
 *
 * ⚠️ `uses:` is NOT an automatic exemption, and that is this design's main
 * hole: migrating `npm run lint` to a `uses: reviewdog/action-eslint`
 * would make a REAL gate disappear into a mute category. An unlisted
 * action turns RED. Uncloseable residual: someone adding it here with a
 * false motive. Only a rereading catches that — write it rather than claim
 * it solved.
 */
const ACTION_EXEMPTIONS = {
    "actions/checkout": {
        gateReelle: false,
        motif: "récupération des sources — sans objet en local.",
    },
    "actions/setup-node": {
        gateReelle: false,
        motif: "provisionne Node depuis .nvmrc — le poste l'a déjà.",
    },
    "actions/upload-artifact": {
        gateReelle: false,
        motif: "publication de rapports — ne contrôle rien, ne peut pas faire échouer une gate.",
    },
    // 🗑️ `gitleaks/gitleaks-action` — entry REMOVED on 11/08/2026, with the action itself.
    //
    // It carried the file's only `partialMotif`: the action covered a
    // `pull_request` path the local could not replay. **That split no
    // longer exists** — the gate is now
    // `run: node scripts/gitleaks-local.cjs` on BOTH sides, hence an
    // ordinary step, covered by PARITY without an exemption.
    //
    // The removal's motive is not elegance: `gitleaks-action` is **paid
    // for organisations**, and it failed on 100% of the public repo's runs
    // (`[geoleaf] is an organization. License key is required.`). The
    // binary, itself, is free.
    //
    // 📌 PARITY-04 is what required this deletion, the same day: an
    // exemption no step uses any more is stale, and the gate turned red on
    // it. Exactly what it exists to catch — a statement surviving its object.
};

/**
 * `ci.yml` steps `ci:local` only covers under `--e2e`.
 *
 * The set is DERIVED (membership of `E2E_STEPS`); this table is its
 * AUTHORISATION. Both gaps turn red: derived ∖ declared (a gate slid under
 * `--e2e` without it being written), declared ∖ derived (stale entry).
 *
 * ⚠️ **Those three are no longer a GAP since 01/08/2026, but a SYMMETRY.»
 * While `ci.yml` launched them at every push and `ci:local` reserved them
 * for `--e2e`, this table documented the only structural hole in the
 * "local green ⟹ push green" promise: the flag is local, GitHub does not
 * know it, and no discipline could fill that. The three steps now carry
 * `if: github.event_name == 'workflow_dispatch'` on the workflow side —
 * both sides are thus manual, and the gap is closed BY CONSTRUCTION.
 *
 * The price is named in `ci.yml` beside the step: the runner was the only
 * place exercising the suite on a fresh clone AND on 2-4 cores.
 */
const DEFERRED_TO_E2E = {
    "node scripts/build-deploy-coverage.cjs":
        "construit l'application instrumentée Istanbul — une seconde build complète, hors du mode rapide.",
    "playwright test":
        "la suite E2E et ses navigateurs — le coût qui justifie l'existence du drapeau.",
    "node scripts/verify-e2e-coverage.cjs":
        "⚠️ étape TOP-LEVEL de ci.yml, PAS un morceau de la chaîne E2E — mais elle en lit la " +
        "sortie (`.nyc_output/`), donc elle suit le même déclencheur manuel depuis le " +
        "01/08/2026. Cette entrée a affirmé « la CI la lance à CHAQUE run » jusqu'à cette date : " +
        "c'était vrai, ça ne l'est plus. Sans données, elle refuse de conclure.",
};

/**
 * The FOURTH table — leaves whose lack of a remote counterpart is DELIBERATE.
 *
 * 🛑 It is the only one of the four KEYED ON A `ci:local` LEAF, and that
 * asymmetry IS its object. The other three (`EXEMPTIONS`,
 * `ACTION_EXEMPTIONS`, `DEFERRED_TO_E2E`) are keyed on `ci.yml` because
 * they all answer the same question — "why is this REMOTE leaf not
 * launched locally". None could thus carry the inverse question, and that
 * is exactly why this one was missing: a local step without a remote
 * equivalent was possible, and **undeclarable**.
 *
 * ⚠️ The defect's "SILENT" half has already fallen: PARITY-13, laid on
 * 16/08/2026, NOTES each local leaf without a counterpart. What stayed
 * open is the DECLARATION — without it, a wanted absence and an oversight
 * render the same note, indistinguishable. An entry here says "wanted",
 * and removes the leaf from the PARITY-13 notes.
 *
 * **An entry's shape**, on `EXEMPTIONS`' pattern:
 *
 * ```js
 * "node scripts/exemple.cjs": {
 *     motif: "why this check makes no sense on a runner.",
 *     temoin: (ctx) => ctx.localLeaves.has("…"), // what must stay true
 * }
 * ```
 *
 * 🛑 **IT IS EMPTY, AND THAT IS A MEASURED CHOICE — not unfinished work.»
 * As of 17/08/2026 the gate notes 14 local leaves without a remote
 * equivalent. Deciding a leaf STAYS local is a CI design judgement;
 * deciding it must join `ci.yml` commits the remote-run quota, which is
 * scarce on this account. Writing 14 motives without that arbitration
 * would produce a FALSE perimeter, and drop the 14 notes to zero — the gap
 * would stop being visible **at the very moment** it is claimed treated.
 * The mechanism is thus laid and the triage stays open, in the register,
 * in that order.
 *
 * ⚠️ Corollary to know before writing the first entry: each line added
 * here REMOVES a note. The table is a silence budget, not a shopping list.
 */
const LOCAL_ONLY = {
    // ── The gates that JUDGE the CI itself (arbitrated with Mattieu, 17/08/2026) ──────
    //
    // 🛑 The motive is common to all four, and it is STRUCTURAL — not a
    // preference: these gates have `ci.yml` (or the test harness) as their
    // SUBJECT. Running them on the runner would amount to verifying the
    // workflow FROM the workflow: a `ci.yml` broken to the point of no
    // longer launching its steps would take down with it the gate meant to
    // flag it. The control must live upstream of the controlled.
    //
    // ⚠️ This motive does NOT extend to the other local leaves without a
    // counterpart: those stay as PARITY-13 notes, visible and untriaged.
    // The table is a silence budget.
    "node scripts/verify-ci-parity.cjs": {
        motif:
            "juge la parité `ci.yml ⊆ ci:local` — la lancer depuis `ci.yml` la rendrait aveugle " +
            "au cas qu'elle existe pour voir : un workflow qui ne lance plus ses étapes.",
        // If `ci.yml` vanished from the corpus, this gate would have no
        // subject left and its locality no motive.
        temoin: (ctx) => ctx.ciLeaves.size > 0,
    },
    "node scripts/verify-ci-scripts-tracked.cjs": {
        motif:
            "vérifie que les scripts appelés par la CI sont SUIVIS PAR GIT. Sur le runner la " +
            "question ne se pose pas — le clone ne contient que ce que git suit, donc la gate " +
            "y serait vraie par construction. Elle n'a de sens que là où un fichier non suivi " +
            "peut exister : le poste de travail.",
        temoin: (ctx) => ctx.ciLeaves.size > 0,
    },
    "node scripts/probe-gate-visibility.cjs": {
        motif:
            "sonde méta : vérifie que les gates VOIENT ce qu'elles prétendent scanner (classe " +
            "des chemins en dur qui cessent de matcher). Son oracle est un paquet imbriqué " +
            "fabriqué localement ; elle éprouve l'outillage, pas le produit.",
        temoin: (ctx) => ctx.localLeaves.has("node scripts/probe-gate-visibility.cjs"),
    },
    "node scripts/verify-test-load-mode.cjs": {
        motif:
            "juge la FORME des suites de test (aucun `require()` de source). Le runner exécute " +
            "déjà ces suites ; leur mode de chargement est une propriété du dépôt, pas de " +
            "l'environnement, et un second passage à distance n'ajouterait aucune information.",
        temoin: (ctx) => ctx.localLeaves.has("node scripts/verify-test-load-mode.cjs"),
    },

    // ── 24/08/2026 arbitration ───────────────────────────────────────────────────────
    //
    // ⚠️ The motive first retained for this entry was THE WRONG
    // NEIGHBOUR'S — "like `verify-ci-scripts-tracked`: on a fresh clone the
    // gate would be true by construction". False, and re-measured before
    // writing: `GUARD-CACHE` does NOT look at the turbo cache's state, it
    // reads `turbo.json` and `ci-local.cjs`'s text. On a fresh clone it
    // would render the SAME verdict, not an empty one. The right motive is
    // `verify-test-load-mode`'s just above: the judged property is the
    // REPO's, not the environment's.
    "node scripts/verify-guards-uncached.cjs": {
        motif:
            "juge des DÉCLARATIONS et non un état : `GC-01` qu'une garde à sujet hors paquet " +
            "appartienne à un paquet déclarant `test:guards`, `GC-02` que cette tâche porte " +
            "`cache: false` dans `turbo.json`, `GC-03` que `ci:local` l'appelle. Les trois " +
            "lisent des fichiers versionnés, donc le verdict est identique sur tout clone — un " +
            "second passage à distance n'ajouterait aucune information, il en recopierait une.",
        // If the leaf left `ci:local`, `GC-03` would have no subject left
        // and this entry no object — PARITY-04 will say so.
        temoin: (ctx) => ctx.localLeaves.has("node scripts/verify-guards-uncached.cjs"),
    },
};

/**
 * The FIFTH table — local leaves `ci.yml` covers UNDER ANOTHER INVOCATION.
 *
 * 🛑 It answers a third question, which neither `LOCAL_ONLY` nor the three
 * `ci.yml` tables ask. `LOCAL_ONLY` says "this gate stays local ON
 * PURPOSE"; this one says "this gate does run remotely, but under a
 * command the leaf comparison does not recognise". Both remove a PARITY-13
 * note and they are NOT interchangeable: filing a silence case in the
 * other's budget makes the triage false both ways — a choice would be
 * believed where there is coverage, and coverage where there is a choice.
 *
 * ⚠️ **PARITY-13 compares COMMANDS, not coverages**, and its own header
 * says so: its count is an UPPER BOUND. This table is what brings the
 * bound down towards the measure, case by case and without ever asserting
 * it in prose.
 *
 * 📌 **Measured when laying it**: of 12 notes, **ONE SINGLE** belonged to
 * this class. The gap between the two counts was thus not made of false
 * positives — it was made of real absences, and that is what the triage
 * established. Do not start from the idea that the bound is well above:
 * here it was by one unit.
 *
 * **An entry's shape**:
 *
 * ```js
 * "node scripts/exemple.cjs": {
 *     couvertePar: "node scripts/exemple.cjs --with-a-flag", // leaf of `ci.yml`
 *     motif: "how the remote leaf does AT LEAST what the local one does.",
 * }
 * ```
 *
 * 🛑 **The witness is STRUCTURAL and not written prose, and that is the
 * property that counts**: the leaf named by `couvertePar` must exist in
 * `ci.yml`. If it disappears from it, the entry dies and the PARITY-13
 * note comes back by itself. None of the four other tables can offer that
 * — their witnesses are functions that must be written right; this one is
 * the coverage itself.
 */
const COVERED_REMOTELY = {
    // ── 24/08/2026 arbitration ───────────────────────────────────────────────────────
    //
    // 🛑 THE WITNESS THE QUESTION ANNOUNCED WAS FALSE, and it was in the
    // direction that counts — it named `npx vitest run` (`ci.yml:524`) as
    // a "strict superset". Measured before writing: that run goes through
    // the root's `projects`, whose perimeter is `rootProjectScope()` —
    // **13 packages**, which include NEITHER `@geoleaf-plugins/editor` NOR
    // `@geoleaf-plugins/offline-ui` (`EXCLUDED_FROM_ROOT_RUN`). Yet those
    // are two of the three packages declaring `test:guards`, and they
    // carry **3 guard files**: `conflict-strategies`, `editor-events`,
    // `templated-layer-selector`. The announced witness would thus have
    // declared covered a leaf a third of whose corpus was not.
    //
    // The REAL carrier is `run-tests.cjs --coverage`
    // (= `npm run test:coverage:all`, `ci.yml`), whose perimeter is
    // `unitScope()` — **18 packages**, the three included — and whose
    // per-package task is `vitest run --coverage`, a superset of
    // `vitest run guard.test`. The same leaf as the one covering
    // `run-tests.cjs` below; the two entries thus stand or fall together,
    // which is correct.
    "turbo run test:guards": {
        couvertePar: "node scripts/run-tests.cjs --coverage",
        motif:
            "`test:guards` lance `vitest run guard.test` dans les 3 paquets qui la déclarent " +
            "(core, editor, offline-ui). La feuille distante lance `vitest run --coverage` " +
            "dans les 18 paquets d'`unitScope()` — elle exécute donc les mêmes suites de garde " +
            "et davantage. ⚠️ Ce n'est PAS `npx vitest run` qui la couvre : son périmètre " +
            "racine exclut `editor` et `offline-ui`, soit 3 des fichiers de garde.",
    },
    "node scripts/run-tests.cjs": {
        couvertePar: "node scripts/run-tests.cjs --coverage",
        motif:
            "même script, même corpus de paquets, un drapeau de plus : la feuille distante " +
            "exécute les suites ET les instrumente. Elle fait donc strictement plus que la " +
            "locale, jamais moins. Les deux ne diffèrent que par le coût, qui est précisément " +
            "la raison pour laquelle le local ne l'instrumente pas à chaque passe.",
    },
};

/**
 * 🛑 **WHAT STAYS AS A PARITY-13 NOTE, AND WHY IT IS NOT AN OVERSIGHT** — 24/08/2026.
 *
 * A single local leaf has no remote counterpart:
 * `node scripts/check-build-determinism.cjs --deploy --reuse-built`. It is
 * **deliberately** neither carried in `ci.yml` nor declared in the two
 * tables above, and this sentence's two halves are distinct decisions.
 *
 * **Why it is not carried**: its cost is the only real one — **56.4 s**
 * recorded on one run, against 0.0 to 4.2 s for the three other leaves
 * triaged the same day. Yet the non-determinism it guards has a **known
 * cause independent of the environment** (a `Map` serialisation order in a
 * PostCSS plugin). Paying a remote minute to re-verify, on another
 * processor, a property the workstation already establishes — and whose
 * cause does not depend on the workstation — buys little.
 *
 * **Why it is not DECLARED `LOCAL_ONLY` either**: writing an entry there
 * would remove its note, and `LOCAL_ONLY` is a silence budget. A cost
 * arbitration can reopen — a run's price changes, the root cause can be
 * fixed — while a structurally local gate does not reopen. Leaving it as a
 * note keeps it **visible and re-litigable**, which is exactly the
 * difference between "decided" and "silenced". The note is thus not a
 * debt: it is the chosen form of rest. **Arbitrated and dated 24/08/2026**
 * — not a defect by default: the two halves were posed as two distinct
 * questions, and both received an answer. Reopening it requires a NEW fact
 * (a run's price changes, or the root cause is fixed), not a rereading.
 *
 * ⚠️ Corollary for whoever adds a gate: the count only stays low through a
 * **laying rule** — wire both sides when writing the gate —, never through
 * a periodic triage. Measured: between two triages five days apart, the
 * count climbed from 1 to 4 because three gates had been laid locally only.
 */

/** Steps carrying their own `env:`, tolerated because measured and motivated. */
const ENV_ALLOWLIST = new Set(["Secret scan (gitleaks)"]);

// ── Classement ───────────────────────────────────────────────────────────────

/**
 * Reads the corpus, classifies each leaf, and returns the facts AND the problems.
 *
 * ⚠️ The caller must handle the floors and the parser/grep agreement
 * BEFORE reading the classification: on a collapsed corpus, "0 uncovered
 * leaves" is true by accident. The order of the codes below follows that
 * requirement.
 *
 * @returns {{corpus: object, entries: object[], problems: object[], notes: object[], remoteOnly: object[]}} The report — `notes` carries the NON-blocking findings (PARITY-13).
 * @throws {Error} If the workflow directory is unreadable, or a file unparsable.
 */
function classify() {
    const dir = workflowDir();
    if (!fs.existsSync(dir)) throw new Error(`répertoire de workflows introuvable : ${dir}`);
    const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

    const corpus = {
        dir,
        workflows: files.length,
        validationWorkflows: 0,
        deliveryWorkflows: [],
        jobs: 0,
        steps: 0,
        runKeys: 0,
        usesKeys: 0,
        rawRunKeys: 0,
        rawUsesKeys: 0,
    };
    const problems = [];
    /** NOTED, non-blocking findings. See PARITY-13 for the motive. */
    const notes = [];
    const ciSteps = [];

    for (const f of files) {
        const txt = fs.readFileSync(path.join(dir, f), "utf8");

        // ── Validation or delivery? (12/08/2026) ─────────────────────────────────
        //
        // The property guarded here is "`ci:local` ⊇ CI". It holds for what
        // VERIFIES: any gate running remotely must be able to run locally.
        // It makes no sense for what DELIVERS — `npm publish` has no
        // business in `ci:local`, and exempting it command by command would
        // write six times "publishing is not a gate" instead of saying it once.
        //
        // The classification is DERIVED from the trigger, never a name
        // list: a workflow triggered by a tag or a release delivers; one
        // triggered by a branch push or a PR validates. An exempted-file
        // list would be the "Keep this list in sync" this module exists to
        // replace.
        //
        // ⚠️ The criterion is DELIBERATELY strict — `push:` with `tags:`
        // AND WITHOUT `branches:`. A workflow also triggering on a branch
        // stays a validation: the slightest tolerance here would make
        // `ci.yml` exemptable by adding a `tags:` to it, i.e. would disarm
        // the gate through the door it just opened.
        if (isDeliveryWorkflow(txt)) {
            corpus.deliveryWorkflows.push(f);
            continue;
        }
        corpus.validationWorkflows++;

        const wf = parseWorkflow(txt, f);
        const raw = rawCounts(txt);
        corpus.rawRunKeys += raw.runKeys;
        corpus.rawUsesKeys += raw.usesKeys;
        for (const job of wf.jobs) {
            corpus.jobs++;
            for (const s of job.steps) {
                corpus.steps++;
                if (s.run) corpus.runKeys++;
                if (s.uses) corpus.usesKeys++;
                ciSteps.push({ ...s, file: f });
            }
        }
    }

    // 🛑 NO "no validation workflow" CODE HERE — and its absence is a
    // RESULT, not an oversight. One had been written (PARITY-12) on
    // 12/08/2026, then removed the same day: the mutation meant to make it
    // bite — `ci.yml` reclassified as delivery — turns the **PARITY-01
    // floors** red first (`jobs = 0`, `steps = 0`, `runKeys = 0`,
    // `ciLeaves = 0`), which refuse to conclude on an empty corpus.
    // Emptying the comparison through the classification empties the
    // corpus; the case is thus already covered, and a code that can never
    // bite would have given the illusion of one more protection.
    //
    // What was really missing was not an assertion but a DIAGNOSIS: the
    // floors say "jobs = 0" without pointing at the classification.
    // `verify-ci-parity.cjs`'s "hors comparaison" line carries it, printed
    // BEFORE the verdict to stay readable when the floors cut the report.

    // PARITY-07 — the two instruments' agreement, before any verdict.
    if (corpus.runKeys !== corpus.rawRunKeys || corpus.usesKeys !== corpus.rawUsesKeys) {
        problems.push({
            code: "PARITY-07",
            message:
                `parseur désaccordé du grep — structuré ${corpus.runKeys} run:/${corpus.usesKeys} uses:, ` +
                `brut ${corpus.rawRunKeys}/${corpus.rawUsesKeys}. Le périmètre lu n'est pas le fichier.`,
        });
    }

    // CI leaves, in order, with the steps carrying them.
    const ciLeaves = new Map();
    /** @type {Map<string, object[]>} leaf → structured steps (to read their `if:`). */
    const ciLeafSteps = new Map();
    let firstLeaf = null;
    for (const s of ciSteps) {
        if (!s.run) continue;
        for (const leaf of resolveLeaves(s.run)) {
            if (firstLeaf === null) firstLeaf = leaf;
            if (!ciLeaves.has(leaf)) ciLeaves.set(leaf, []);
            ciLeaves.get(leaf).push(s.name || "(anonyme)");
            // The STEP itself, and not only its name: PARITY-11 must read its `if:`.
            if (!ciLeafSteps.has(leaf)) ciLeafSteps.set(leaf, []);
            ciLeafSteps.get(leaf).push(s);
        }
    }
    corpus.ciLeaves = ciLeaves.size;

    const { STEPS, E2E_STEPS } = require("../ci-local.cjs");
    corpus.localSteps = STEPS.length;
    corpus.e2eSteps = E2E_STEPS.length;
    const localLeaves = leavesOfSteps(STEPS);
    const e2eLeaves = leavesOfSteps(E2E_STEPS);

    const ctx = { ciLeaves: new Set(ciLeaves.keys()), localLeaves, e2eLeaves, firstLeaf };

    // PARITY-01 — witness floors. Under the floor, we REFUSE TO CONCLUDE.
    for (const [key, min] of Object.entries(FLOOR)) {
        const got = corpus[key];
        if (typeof got === "number" && got < min) {
            problems.push({
                code: "PARITY-01",
                message:
                    `témoin en échec — ${key} = ${got} (plancher ${min}). REFUSE DE CONCLURE : ` +
                    `un « 0 feuille non couverte » depuis ce corpus serait vrai et vide de sens.`,
            });
        }
    }

    // Classement, feuille par feuille.
    const entries = [];
    for (const [leaf, owners] of ciLeaves) {
        const steps = [...new Set(owners)];
        if (leaf.startsWith("UNRESOLVED:")) {
            problems.push({
                code: "PARITY-02",
                message:
                    `\`${leaf.slice("UNRESOLVED:".length)}\` — \`npm run\` défini nulle part, ` +
                    `atteint depuis « ${steps.join(" | ")} ». L'étape mourra sur le runner en ` +
                    `« Missing script » : ce n'est pas un défaut de parité, c'est un ci.yml cassé.`,
            });
            entries.push({ leaf, category: "UNRESOLVED", steps });
            continue;
        }
        if (localLeaves.has(leaf)) {
            entries.push({ leaf, category: "COVERED", steps });
            continue;
        }
        const ex = EXEMPTIONS[leaf];
        if (ex) {
            let alive = false;
            let why = "";
            try {
                alive = ex.temoin(ctx) === true;
            } catch (err) {
                why = ` (${err.message})`;
            }
            if (!alive) {
                problems.push({
                    code: "PARITY-05",
                    message:
                        `EXEMPTIONS[« ${leaf} »] — TÉMOIN EN ÉCHEC${why}. La cause qui justifiait ` +
                        `la dispense est tombée : « ${ex.motif} » n'est plus vrai, et la feuille ` +
                        `redevient non couverte sans que personne ne l'ait décidé.`,
                });
            }
            entries.push({ ...ex, leaf, category: "EXEMPT", steps, alive });
            continue;
        }
        if (e2eLeaves.has(leaf)) {
            const declared = DEFERRED_TO_E2E[leaf];
            if (!declared) {
                problems.push({
                    code: "PARITY-08",
                    message:
                        `« ${leaf} » est couverte SEULEMENT sous \`--e2e\` mais n'est pas déclarée ` +
                        `dans DEFERRED_TO_E2E. Une gate a glissé hors du mode par défaut sans que ` +
                        `ce soit écrit — c'est-à-dire sans que le vert par défaut le dise.`,
                });
            }
            entries.push({
                leaf,
                category: "E2E",
                steps,
                motif: declared || null,
                gateReelle: true,
            });
            continue;
        }
        problems.push({
            code: "PARITY-03",
            message:
                `« ${leaf} » — NON COUVERTE ET NON EXPLIQUÉE.\n` +
                `      portée par : ${steps.join(" | ")}\n` +
                `      La CI exécutera cette commande ; \`ci:local\` ne la lance dans aucun mode.\n` +
                `      Trois issues, et une seule serait un mensonge : l'ajouter à STEPS, ` +
                `l'ajouter à E2E_STEPS + DEFERRED_TO_E2E, ou écrire une entrée d'EXEMPTIONS ` +
                `avec son témoin.`,
        });
        entries.push({ leaf, category: "ORPHAN", steps, gateReelle: true });
    }

    // ── PARITY-13 — THE INVERSE DIRECTION, never laid until now ─────────────────
    //
    // 🛑 WHAT WAS MISSING. Everything above walks `ci.yml`'s leaves and
    // verifies `ci:local` covers them — hence `ci.yml ⊆ ci:local`.
    // **Nothing looked the other way**: a gate added to `ci:local` and
    // forgotten in `ci.yml` passed without a word, and the repo believed
    // in an equivalence of which it had demonstrated only one half.
    //
    // ⚠️ The defect is ORIENTED in the dangerous direction: the local is
    // the easiest to enrich — that is where a gate is added while
    // developing it — and the remote is the only one judging a fresh
    // clone. A gate living only locally will never see the defect family
    // only the runner renders (fresh clone, 2-4 cores).
    //
    // 📌 NOT the same question as PARITY-11, which verifies the E2E steps
    // stay out of the `push` path. This one bears on a counterpart's
    // EXISTENCE, that one on its trigger CONDITION.
    for (const leaf of localLeaves) {
        if (ctx.ciLeaves.has(leaf)) continue;
        // Declared LOCAL ON PURPOSE: the absence is a written choice, not
        // an oversight. Its witness is exercised below — a declaration
        // whose cause fell must turn red, not keep silencing the note.
        if (LOCAL_ONLY[leaf]) continue;
        // Declared REMOTELY COVERED under another invocation: not a
        // locality choice, an instrument limit — it compares commands. The
        // declaration's check is below — and it bears on the coverage itself.
        if (COVERED_REMOTELY[leaf]) continue;
        notes.push({
            code: "PARITY-13",
            message: `« ${leaf} » — dans \`ci:local\`, sans feuille équivalente dans \`ci.yml\`.`,
        });
    }

    // LOCAL_ONLY — dead key (PARITY-04) and failing witness (PARITY-05),
    // on the three other tables' pattern. ⚠️ The key compares against
    // `ci:local`'s leaves, NEVER `ci.yml`'s: the only one of the four
    // tables whose referential is the local.
    for (const [leaf, decl] of Object.entries(LOCAL_ONLY)) {
        if (!localLeaves.has(leaf)) {
            problems.push({
                code: "PARITY-04",
                message:
                    `LOCAL_ONLY[« ${leaf} »] — PÉRIMÉE : la clé ne désigne plus aucune feuille ` +
                    `de \`ci:local\`. Elle taisait une note PARITY-13 pour une étape qui ` +
                    `n'existe plus.`,
            });
            continue;
        }
        // A declared local-on-purpose leaf THAT GAINED a remote counterpart
        // no longer needs declaring: keeping it would make the table carry
        // a dead exception.
        if (ctx.ciLeaves.has(leaf)) {
            problems.push({
                code: "PARITY-04",
                message:
                    `LOCAL_ONLY[« ${leaf} »] — SANS OBJET : la feuille a désormais un ` +
                    `équivalent dans \`ci.yml\`. La déclaration « locale à dessein » est ` +
                    `devenue fausse.`,
            });
            continue;
        }
        let alive = false;
        let why = "";
        try {
            alive = decl.temoin(ctx) === true;
        } catch (err) {
            why = ` (${err.message})`;
        }
        if (!alive) {
            problems.push({
                code: "PARITY-05",
                message:
                    `LOCAL_ONLY[« ${leaf} »] — TÉMOIN EN ÉCHEC${why}. La cause qui justifiait ` +
                    `de garder cette gate hors de \`ci.yml\` est tombée : « ${decl.motif} » ` +
                    `n'est plus vrai, et l'absence de contrepartie distante redevient un ` +
                    `écart non décidé.`,
            });
        }
    }

    // COVERED_REMOTELY — dead key, vanished coverage, and declaration
    // become useless. ⚠️ Like LOCAL_ONLY, the key compares against
    // `ci:local`'s leaves; but `couvertePar` compares against `ci.yml`'s.
    // The only table reading BOTH sides, and that is what lets it have a
    // structural witness instead of a written one.
    for (const [leaf, decl] of Object.entries(COVERED_REMOTELY)) {
        if (!localLeaves.has(leaf)) {
            problems.push({
                code: "PARITY-04",
                message:
                    `COVERED_REMOTELY[« ${leaf} »] — PÉRIMÉE : la clé ne désigne plus aucune ` +
                    `feuille de \`ci:local\`. Elle taisait une note PARITY-13 pour une étape ` +
                    `qui n'existe plus.`,
            });
            continue;
        }
        if (ctx.ciLeaves.has(leaf)) {
            problems.push({
                code: "PARITY-04",
                message:
                    `COVERED_REMOTELY[« ${leaf} »] — SANS OBJET : la feuille a désormais un ` +
                    `équivalent EXACT dans \`ci.yml\`. La déclaration ne tait plus rien et ` +
                    `masque désormais la vraie raison de la couverture.`,
            });
            continue;
        }
        if (!ctx.ciLeaves.has(decl.couvertePar)) {
            problems.push({
                code: "PARITY-05",
                message:
                    `COVERED_REMOTELY[« ${leaf} »] — COUVERTURE DISPARUE : la feuille ` +
                    `« ${decl.couvertePar} » n'est plus dans \`ci.yml\`. Le motif « ` +
                    `${decl.motif} » reposait sur elle ; sans elle la gate n'est plus jouée ` +
                    `à distance du tout, et l'écart redevient un écart.`,
            });
        }
    }

    // PARITY-11 — the steps deferred to `--e2e` must stay OUT of the `push` path.
    //
    // ⚠️ The witness of the "ci:local green ⟹ push green" promise, and
    // without it that promise would be a sentence. While `ci.yml` launched
    // the E2E at every push and `ci:local` reserved it for `--e2e`, the
    // gap was STRUCTURAL: the flag is local, GitHub does not know it. On
    // 01/08/2026 the three steps moved under `workflow_dispatch` — but
    // removing that `if:` would reopen the hole SILENTLY, and the
    // DEFERRED_TO_E2E table would keep announcing "3 under --e2e" as if
    // nothing happened. An excuse whose condition is not verified is an
    // excuse that rots.
    const DISPATCH_RE = /github\.event_name\s*==\s*['"]workflow_dispatch['"]/;
    for (const leaf of Object.keys(DEFERRED_TO_E2E)) {
        for (const s of ciLeafSteps.get(leaf) || []) {
            if (DISPATCH_RE.test(s.ifCond || "")) continue;
            problems.push({
                code: "PARITY-11",
                message:
                    `« ${leaf} » est déclarée dans DEFERRED_TO_E2E — donc NON lancée par ` +
                    `\`ci:local\` sans \`--e2e\` — mais son étape « ${s.name || "(anonyme)"} » ` +
                    `de ci.yml tourne sur le chemin \`push\`` +
                    (s.ifCond ? ` (if: ${s.ifCond})` : " (aucun `if:`)") +
                    `.\n      C'est le trou exact que le 01/08/2026 a fermé : un push exécute ` +
                    `alors une gate qu'aucun vert local n'a éprouvée.\n      Deux issues : ` +
                    `poser \`if: github.event_name == 'workflow_dispatch'\` sur l'étape, ou ` +
                    `sortir la feuille de E2E_STEPS pour que \`ci:local\` la lance par défaut.`,
            });
        }
    }

    // PARITY-04 — dead keys of the `ci.yml`-keyed tables. An excuse no
    // longer excusing anything is always an error: nobody would know, and
    // it would survive its cause. (`LOCAL_ONLY` undergoes the same check
    // above, against the LOCAL leaves.)
    const seenLeaves = new Set(ciLeaves.keys());
    for (const key of Object.keys(EXEMPTIONS)) {
        if (!seenLeaves.has(key)) {
            problems.push({
                code: "PARITY-04",
                message: `EXEMPTIONS[« ${key} »] — PÉRIMÉE : la clé ne désigne plus aucune feuille de ci.yml.`,
            });
        }
    }
    for (const key of Object.keys(DEFERRED_TO_E2E)) {
        if (!seenLeaves.has(key)) {
            problems.push({
                code: "PARITY-04",
                message: `DEFERRED_TO_E2E[« ${key} »] — PÉRIMÉE : la clé ne désigne plus aucune feuille de ci.yml.`,
            });
        }
    }

    // External actions — PARITY-06 for any unlisted action, and dead key for the inverse.
    const actions = [];
    const seenActions = new Set();
    for (const s of ciSteps) {
        if (!s.uses) continue;
        const [ref, sha] = s.uses.split("@");
        seenActions.add(ref);
        const known = ACTION_EXEMPTIONS[ref];
        if (!known) {
            problems.push({
                code: "PARITY-06",
                message:
                    `action externe non listée : \`${ref}\` (« ${s.name || "(anonyme)"} »). Une ` +
                    `action n'est PAS une exemption automatique : si celle-ci porte une gate ` +
                    `réelle, elle vient de disparaître du champ sans un mot.`,
            });
        }
        actions.push({ ref, sha: sha || "", step: s.name || "(anonyme)", ...(known || {}) });

        // PARITY-10 — a local-equivalent promise must be KEPT. The
        // statement says "→ npm run gitleaks:local"; if that gate left
        // STEPS, the sentence would keep displaying while designating a
        // coverage that no longer exists. An assertion displayed on its
        // word is exactly what the EXEMPTIONS witnesses forbid elsewhere in
        // this file, and there is no reason it be tolerated here.
        if (known && known.localLeaf && !localLeaves.has(known.localLeaf)) {
            problems.push({
                code: "PARITY-10",
                message:
                    `ACTION_EXEMPTIONS[« ${ref} »] promet l'équivalent local ` +
                    `« ${known.localEquivalent} », mais la feuille « ${known.localLeaf} » n'est ` +
                    `atteinte par AUCUNE entrée de STEPS. L'énonciation annoncerait une ` +
                    `couverture qui n'existe pas.`,
            });
        }
    }
    for (const key of Object.keys(ACTION_EXEMPTIONS)) {
        if (!seenActions.has(key)) {
            problems.push({
                code: "PARITY-04",
                message: `ACTION_EXEMPTIONS[« ${key} »] — PÉRIMÉE : plus aucune étape n'utilise cette action.`,
            });
        }
    }

    // PARITY-09 — a step `env:` makes the leaves identical and the
    // executions different. The gate cannot compare the environments; it
    // can require that a new `env:` be a decision, not a drift.
    for (const s of ciSteps) {
        if (s.hasEnv && !ENV_ALLOWLIST.has(s.name)) {
            problems.push({
                code: "PARITY-09",
                message:
                    `« ${s.name || "(anonyme)"} » porte un \`env:\` non recensé. Deux exécutions ` +
                    `aux feuilles identiques peuvent différer par leur environnement, et cette ` +
                    `gate ne le voit pas — donc un nouvel env: doit être décidé, pas glissé.`,
            });
        }
    }

    // What the CI will execute that did not run here. The ACTIONS are part
    // of it — gitleaks is the lot's most important remote gate, and
    // filtering it out with the `run:`s would have left it out of the
    // statement, i.e. out of sight precisely where it counts. Deduplicated
    // by LABEL: a step carrying two remote leaves (the E2E step carries
    // two) is one thing to say, not two.
    const remoteOnly = [];
    const seenLabel = new Set();
    const push = (label, kind, motif, localEquivalent) => {
        if (seenLabel.has(label)) return;
        seenLabel.add(label);
        remoteOnly.push({ label, kind, motif, localEquivalent });
    };
    for (const e of entries) {
        if (e.category === "COVERED" || e.category === "UNRESOLVED") continue;
        if (e.gateReelle === false) continue;
        push(
            e.steps[0] || e.leaf,
            e.category === "E2E" ? "sous --e2e" : e.classe || "non couverte",
            e.motif
        );
    }
    for (const a of actions) {
        if (a.gateReelle === false) continue;
        push(a.step, a.partialMotif || "action externe", a.motif, a.localEquivalent);
    }
    return { corpus, entries, problems, notes, actions, remoteOnly };
}

/**
 * The lines of `ci:local`'s end-of-run statement.
 *
 * NARRATION, never VERDICT — the verdict belongs to the
 * `verify-ci-parity.cjs` gate. Two paths able to fail the same property is
 * one path too many, and it is the one people forget to prove.
 *
 * Derived from `ci.yml` + the tables, and NOT from the list of gates that
 * just ran: it thus stays true under `--bail`, where the parity gate may
 * never have run — precisely the run where this line counts most.
 *
 * @param {{withE2E?: boolean}} [options] `withE2E` removes the gates `--e2e` covered.
 * @returns {string[]} Lines ready to print (empty if there is nothing to say).
 */
function formatRemoteOnly(options = {}) {
    const withE2E = options.withE2E === true;
    const { remoteOnly } = classify();
    const shown = remoteOnly.filter((e) => !(withE2E && e.kind === "sous --e2e"));
    if (!shown.length) return [];

    const C = { y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };
    const width = Math.max(...shown.map((e) => e.label.length));
    // "not ENTIRELY covered" and not "did not run": gitleaks does have a
    // local equivalent for its `push` path. Over-warning wears out a
    // warning as surely as silencing it, and this one must stay read.
    const out = [
        `  ${C.y}⚠ ${shown.length} gate(s) de la CI que ce run ne couvre pas entièrement :${C.x}`,
    ];
    for (const e of shown) {
        // A local equivalent is named in place: saying "not covered"
        // without saying what covers it leaves the reader before a finding,
        // not a gesture.
        const hint = e.localEquivalent ? ` ${C.d}→ ${e.localEquivalent}${C.x}` : "";
        out.push(`      ${C.d}•${C.x} ${e.label.padEnd(width)}  ${C.d}${e.kind}${C.x}${hint}`);
    }
    const deferred = shown.filter((e) => e.kind === "sous --e2e").length;
    if (deferred > 0) {
        out.push(
            `    ${C.d}\`--e2e\` en couvrirait ${deferred} sur ${shown.length} ; ` +
                `le reste n'est vu qu'à distance.${C.x}`
        );
    }
    return out;
}

module.exports = {
    ROOT,
    FLOOR,
    workflowDir,
    parseWorkflow,
    parseSteps,
    rawCounts,
    normalize,
    splitChain,
    resolveLeaves,
    leavesOfSteps,
    EXEMPTIONS,
    ACTION_EXEMPTIONS,
    DEFERRED_TO_E2E,
    LOCAL_ONLY,
    classify,
    formatRemoteOnly,
};
