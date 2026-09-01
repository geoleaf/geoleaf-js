#!/usr/bin/env node
/**
 * @fileoverview SPECS-FRESH — the `verifie_contre` field of a `docs/specs/` sheet must name a
 * commit after which its subject code has NOT moved.
 *
 * ## What this closes
 *
 * Every spec sheet declares two things in its own header: the commit it was verified against
 * (`verifie_contre:` in the frontmatter) and the code it describes (`**Code :** \`path\``).
 * Nothing read either one. The field therefore certified whatever it happened to say: one
 * sheet asserted five false statements for ten days and prescribed a change that would have
 * created two competing drains.
 *
 * The measure is purely structural, and that is the whole point of choosing it: the number of
 * commits touching the subject path strictly after the recorded commit. Zero means the sheet
 * was verified against the current state of its subject. Anything else means the subject moved
 * and the sheet did not follow.
 *
 * ## What it deliberately does NOT guarantee
 *
 * A sheet whose count is zero is *structurally* fresh, never *true*. Someone can bump the
 * field without rereading a line. No gate can tell those apart — rereading the prose stays a
 * human act. What this gate removes is the other failure: a sheet that certifies against a
 * commit from three weeks ago while claiming to be current, with nothing able to say so.
 *
 * ## Why a shrinking baseline rather than a hard fail
 *
 * At the time this gate was written every single sheet of the corpus was behind its subject.
 * A gate that failed on all of them would have been switched off the same day, and removing
 * the field instead would have destroyed the only place where the verification date lives.
 * The baseline freezes the known-behind sheets, refuses any NEW one, and must shrink whenever
 * a frozen sheet is re-verified. The count can therefore only go down.
 *
 * ⚠️ Note the asymmetry, because it is what makes the gate liveable: a sheet already in the
 * baseline that falls further behind stays silent. Only crossing the fresh→behind boundary
 * fails. Draining is opt-in, regression is not.
 *
 * ## The rules
 *
 *   VC-00  Refuse to conclude on an implausibly small corpus (a broken glob reads as a clean
 *          repository otherwise).
 *   VC-01  A sheet typed `spec-*` must carry `verifie_contre:`. Without this, dropping the
 *          field would silently remove a sheet from the corpus and look like progress.
 *   VC-02  A sheet must declare a `**Code :**` path that exists on disk. An unresolvable
 *          subject makes the count meaningless — and a count over a vanished path is 0, i.e.
 *          reads as fresh.
 *   VC-03  The recorded commit must exist in the history being measured.
 *   VC-04  A sheet behind its subject and absent from the baseline is a NEW staleness.
 *   VC-05  A baseline entry whose sheet is now fresh must be removed.
 *
 * ## Truncated histories
 *
 * When NONE of the recorded commits resolve, the history is truncated rather than wrong — the
 * public clone is born from a single commit, so no earlier commit exists there. The gate then
 * skips with a named motive instead of failing, and says so. The discriminator matters: if
 * some commits resolve and others do not, the unresolvable ones are typos and DO fail.
 *
 * Usage :
 *   node scripts/check-specs-verified-against.cjs                    # gate (exit 1 on gap)
 *   node scripts/check-specs-verified-against.cjs --list             # prints the drift
 *   node scripts/check-specs-verified-against.cjs --update-baseline  # creates/regenerates the freeze
 */

"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const CODE = "SPECS-FRESH";
const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(ROOT, "scripts", ".baselines", "specs-verified-against.json");
const UPDATE = process.argv.includes("--update-baseline");
const LIST = process.argv.includes("--list");

/** Minimum plausible corpus size — the repository ships 21 capabilities, 12 plugins, 2 libs. */
const CORPUS_FLOOR = 30;

/**
 * Runs git and returns stdout, or null when git itself refuses (unknown revision, no repo).
 *
 * @param {string[]} args Arguments passed to git, already split.
 * @returns {string|null} Trimmed stdout, or null when the command failed.
 */
function git(args) {
    try {
        return execFileSync("git", args, {
            cwd: ROOT,
            encoding: "utf8",
            maxBuffer: 1 << 26,
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        return null;
    }
}

/**
 * True when two package.json documents differ ONLY in their `devDependencies` section.
 *
 * ## Why this exists — VC-04 versus Dependabot, two correct contracts (settled 24/08/2026)
 *
 * VC-04 counts every commit touching a sheet's subject: right, since any code change can
 * falsify a sentence. A Dependabot bump touches each plugin's `package.json`: right,
 * that is its job. And `verifie_contre` is a HUMAN attestation the bot will never stamp.
 * The collision made every weekly dependency pass red here, and the manual re-stamp behind
 * each merge was on its way to becoming a reflex — a stamp posed without re-reading, which
 * is worth less than no stamp.
 *
 * The exemption is deliberately narrower than "touches only package.json": it compares the
 * PARSED documents with `devDependencies` removed. A bump of `dependencies`,
 * `peerDependencies`, `exports`, `sideEffects` — anything a sheet may assert — still counts.
 * ⚠️ Classifying by file NAME instead of by section would exempt real API changes: a
 * `package.json` edit can rename the package or rewrite its exports map.
 *
 * @param {unknown} before Parsed package.json before the commit.
 * @param {unknown} after Parsed package.json after the commit.
 * @returns {boolean} True when nothing outside `devDependencies` moved.
 */
function sameOutsideDevDeps(before, after) {
    if (typeof before !== "object" || before === null) return false;
    if (typeof after !== "object" || after === null) return false;
    const strip = (o) => {
        const { devDependencies, ...rest } = /** @type {Record<string, unknown>} */ (o);
        void devDependencies;
        return rest;
    };
    const canon = (v) =>
        JSON.stringify(v, (_k, val) =>
            typeof val === "object" && val !== null && !Array.isArray(val)
                ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
                : val
        );
    return canon(strip(before)) === canon(strip(after));
}

// Witness — the classifier is FED a defect of each kind on every run, so a broken comparison
// cannot stay green. Same pattern as `patternWitnesses()` in lib/registry-crossrefs.cjs: a
// guard never seen red guards nothing, and this one is seen red by construction.
{
    const base = { name: "x", dependencies: { a: "1" }, devDependencies: { b: "1" } };
    if (!sameOutsideDevDeps(base, { ...base, devDependencies: { b: "2" } }))
        throw new Error("[SPECS-FRESH] témoin : un bump de devDependencies devrait être exempt");
    if (sameOutsideDevDeps(base, { ...base, dependencies: { a: "2" } }))
        throw new Error(
            "[SPECS-FRESH] témoin : un bump de dependencies ne doit JAMAIS être exempt"
        );
    if (sameOutsideDevDeps(base, { ...base, name: "y" }))
        throw new Error("[SPECS-FRESH] témoin : un renommage de paquet ne doit JAMAIS être exempt");
}

/**
 * True when `sha`'s whole effect under `subject` is the `devDependencies` section of
 * `package.json` files. Conservative on everything else: merge commits, created or deleted
 * files, unparseable JSON all count as real changes.
 *
 * @param {string} sha The commit.
 * @param {string} subject Repository-relative subject directory.
 * @returns {boolean} True when the commit is toolchain-only for this subject.
 */
function isDevDepsOnly(sha, subject) {
    if (git(["rev-parse", "--verify", "--quiet", `${sha}^2`]) !== null) return false;
    const listed = git(["show", "--name-only", "--format=", sha, "--", subject]);
    if (listed === null) return false;
    const files = listed.split("\n").filter(Boolean);
    if (files.length === 0) return false;
    for (const f of files) {
        if (path.basename(f) !== "package.json") return false;
        const beforeRaw = git(["show", `${sha}^:${f}`]);
        const afterRaw = git(["show", `${sha}:${f}`]);
        if (beforeRaw === null || afterRaw === null) return false;
        let before, after;
        try {
            before = JSON.parse(beforeRaw);
            after = JSON.parse(afterRaw);
        } catch {
            return false;
        }
        if (!sameOutsideDevDeps(before, after)) return false;
    }
    return true;
}

/**
 * Corpus = markdown tracked by git under `docs/specs/`.
 *
 * Tracked rather than walked: an untracked sheet never reaches the public clone and is judged
 * by no CI, so judging it here would make the workshop diverge from the public repository with
 * nobody able to see it.
 *
 * @returns {string[]} Repository-relative paths.
 */
function trackedSpecs() {
    const out = git(["ls-files", "--", "docs/specs/*.md", "docs/specs/**/*.md"]);
    if (out === null) {
        console.error(
            `\n❌ [${CODE}/VC-00] REFUS DE CONCLURE — le corpus n'a pas pu être listé par git.\n` +
                `   Une gate qui ne sait pas ce qu'elle lit ne rend pas de verdict.`
        );
        process.exit(1);
    }
    return out
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Frontmatter `type:` value, or null. */
function frontmatterType(src) {
    const m = src.match(/^type:\s*(\S+)\s*$/m);
    return m ? m[1] : null;
}

/**
 * Recorded commit, tolerating a `+<note>` suffix.
 *
 * One sheet carries `f21f1113+B-190`: the suffix records that the verification also covered a
 * change that had no commit of its own yet. Splitting on `+` keeps that convention readable
 * instead of turning it into an unresolvable revision.
 */
function verifiedAgainst(src) {
    // Two linear passes rather than one regex with an optional suffix group: a bounded hex
    // repeat followed by an optional `\+\S*` reads as ambiguous to the unsafe-regex rule, and
    // the rule is right to be conservative about a pattern run over every file of a corpus.
    const line = src.match(/^verifie_contre:[^\n]*/m);
    if (!line) return null;
    const raw = line[0].slice("verifie_contre:".length).trim();
    const plus = raw.indexOf("+");
    const sha = plus === -1 ? raw : raw.slice(0, plus);
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return null;
    return { sha, suffix: plus === -1 ? "" : raw.slice(plus) };
}

/** Subject path, read from the `**Code :** \`…\`` line of the sheet body. */
function subjectPath(src) {
    const m = src.match(/\*\*Code :\*\*\s*`([^`]+)`/);
    return m ? m[1].replace(/\/+$/, "") + "/" : null;
}

/**
 * One sheet of the corpus, with every field declared at construction.
 *
 * The measured fields are filled in later passes but declared here on purpose: assigning them
 * onto an inferred object literal makes them invisible to `checkJs`, which is how eighteen
 * typing errors were introduced by a file whose own gate was about to be wired next to the
 * ratchet that counts them.
 *
 * @typedef {object} Sheet
 * @property {string} rel Repository-relative path of the sheet.
 * @property {string} sha Commit recorded by `verifie_contre`.
 * @property {string} suffix Free-text `+…` note attached to the commit, or an empty string.
 * @property {string} subject Repository-relative subject directory, trailing slash included.
 * @property {boolean} resolved Whether `sha` exists in the history being measured.
 * @property {number|null} behind Commits touching `subject` after `sha`; null when unmeasured.
 * @property {string|null} head Newest commit touching `subject` — what a re-verification records.
 */

/** Baseline entries, or an empty set when the file does not exist yet. */
function readBaseline() {
    if (!fs.existsSync(BASELINE)) return null;
    return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
}

// ── Mesure ───────────────────────────────────────────────────────────────────

const files = trackedSpecs();
const sheets = [];
const missingField = [];
const badSubject = [];
const unknownSha = [];
let candidates = 0;

for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const type = frontmatterType(src);
    // Only the four sheet families carry the field. `contrats/` and `rfc/` are prose without a
    // single subject directory, and forcing one on them would invent a corpus.
    if (!type || !/^spec-/.test(type)) continue;
    candidates += 1;

    const v = verifiedAgainst(src);
    if (!v) {
        missingField.push(rel);
        continue;
    }
    const subject = subjectPath(src);
    if (!subject || !fs.existsSync(path.join(ROOT, subject))) {
        badSubject.push({ rel, subject });
        continue;
    }
    sheets.push({
        rel,
        sha: v.sha,
        suffix: v.suffix,
        subject,
        resolved: false,
        behind: null,
        head: null,
        exempted: 0,
    });
}

// 🛑 Anti-empty-corpus assertion, BEFORE any other conclusion — including before
// the truncated-history skip. The order was found backwards while proving the
// probe: a collapsed corpus ON a truncated history skipped, hence exited 0,
// having read only 3 sheets of 36. A skip is not a green, but it must not mask a
// broken glob either.
if (candidates < CORPUS_FLOOR) {
    console.error(
        `\n❌ [${CODE}/VC-00] REFUS DE CONCLURE — ${candidates} fiche(s) typée(s) \`spec-*\` seulement ` +
            `(${files.length} document(s) suivi(s) balayé(s)).\n` +
            `   Le corpus attendu est d'au moins ${CORPUS_FLOOR}. Un compte aussi bas signale un\n` +
            `   glob cassé ou un répertoire déplacé, pas un dépôt propre.`
    );
    process.exit(1);
}

// VC-03 — resolve every recorded commit before measuring anything against it.
for (const s of sheets) {
    s.resolved = git(["cat-file", "-e", `${s.sha}^{commit}`]) !== null;
    if (!s.resolved) unknownSha.push(s);
}

// A history that resolves NONE of the recorded commits is truncated, not wrong. Failing there
// would make the public clone permanently red for a reason that has nothing to do with it.
if (sheets.length > 0 && unknownSha.length === sheets.length) {
    console.log(
        `⏭️  [${CODE}] SAUTÉ — aucun des ${sheets.length} commits cités n'existe dans cette histoire.`
    );
    console.log(
        "    Ce n'est PAS un vert : aucune fiche n'a été confrontée à son sujet. C'est le\n" +
            "    comportement attendu sur un clone à histoire tronquée (le dépôt public naît\n" +
            "    d'un commit unique). Ailleurs, c'est un clone superficiel : `fetch-depth: 0`."
    );
    process.exit(0);
}

for (const s of sheets) {
    if (!s.resolved) continue;
    const out = git(["rev-list", `${s.sha}..HEAD`, "--", s.subject]);
    if (out === null) {
        s.behind = null;
        continue;
    }
    const commits = out.split("\n").filter(Boolean);
    // Toolchain-only commits (devDependencies alone) do not stale a sheet — nothing a sheet
    // may assert can move there. Counted and PRINTED below rather than silently dropped.
    const real = commits.filter((c) => !isDevDepsOnly(c, s.subject));
    s.exempted = commits.length - real.length;
    s.behind = real.length;
    // The commit a re-verification should record: the newest one that touched the subject.
    s.head = git(["log", "-1", "--format=%h", "--", s.subject]);
}

const measured = sheets.filter((s) => s.resolved && s.behind !== null);
const behind = measured.filter((s) => s.behind > 0);
const fresh = measured.filter((s) => s.behind === 0);

// ── Sorties ──────────────────────────────────────────────────────────────────

if (LIST) {
    for (const s of measured.sort((a, b) => a.behind - b.behind)) {
        console.log(`${String(s.behind).padStart(4)}  ${s.sha}  ${s.rel}`);
    }
    console.log(
        `\n${measured.length} fiche(s) mesurée(s) · ${behind.length} en retard · ${fresh.length} à jour.`
    );
    process.exit(0);
}

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        JSON.stringify(
            {
                _comment:
                    "SPECS-FRESH — fiches docs/specs/ dont `verifie_contre` est en retard sur leur sujet. " +
                    "Gel DÉCROISSANT (VC-05) : une fiche re-vérifiée doit SORTIR de cette liste. " +
                    "Ne jamais régénérer pour faire taire une péremption neuve — c'est le geste que VC-04 existe pour voir.",
                _generated: "node scripts/check-specs-verified-against.cjs --update-baseline",
                count: behind.length,
                entries: behind.map((s) => s.rel).sort(),
            },
            null,
            4
        ) + "\n"
    );
    console.log(`✅ [${CODE}] baseline écrite — ${behind.length} fiche(s) gelée(s).`);
    process.exit(0);
}

console.log(`── ${CODE} ──`);
console.log(
    `  ${sheets.length} fiche(s) typée(s) \`spec-*\` sur ${files.length} document(s) suivi(s) de docs/specs/`
);

const problems = [];

if (missingField.length > 0) {
    problems.push(
        `❌ [${CODE}/VC-01] ${missingField.length} fiche(s) \`spec-*\` sans \`verifie_contre:\` :\n` +
            missingField.map((f) => `   • ${f}`).join("\n") +
            `\n   Retirer le champ sort la fiche du corpus SANS que le compte de dette bouge —\n` +
            `   ça se lit comme un progrès. Le champ est obligatoire sur les quatre familles.`
    );
}

if (badSubject.length > 0) {
    problems.push(
        `❌ [${CODE}/VC-02] ${badSubject.length} fiche(s) dont le sujet est introuvable :\n` +
            badSubject
                .map((b) => `   • ${b.rel} → ${b.subject || "aucune ligne `**Code :**`"}`)
                .join("\n") +
            `\n   Un décompte de commits sur un chemin disparu rend 0, c'est-à-dire « à jour ».\n` +
            `   Une fiche dont le sujet a bougé se corrige, elle ne se mesure pas.`
    );
}

if (unknownSha.length > 0) {
    problems.push(
        `❌ [${CODE}/VC-03] ${unknownSha.length} fiche(s) citant un commit inconnu de cette histoire :\n` +
            unknownSha.map((s) => `   • ${s.rel} → ${s.sha}`).join("\n") +
            `\n   D'autres fiches résolvent le leur, donc l'histoire n'est pas tronquée : ce sont\n` +
            `   des coquilles. Un commit qu'on ne peut pas atteindre ne certifie rien.`
    );
}

const baseline = readBaseline();
if (baseline === null) {
    problems.push(
        `❌ [${CODE}/VC-04] aucune baseline — ${path.relative(ROOT, BASELINE)} est absent.\n` +
            `   La créer avec \`--update-baseline\` APRÈS avoir constaté que le gisement gelé est\n` +
            `   bien celui qu'on accepte de geler.`
    );
} else {
    const frozen = new Set(baseline.entries || []);
    const fraiches = behind.filter((s) => !frozen.has(s.rel));
    const guerie = [...frozen].filter((k) => !behind.some((s) => s.rel === k));

    if (fraiches.length > 0) {
        problems.push(
            `❌ [${CODE}/VC-04] ${fraiches.length} péremption(s) NEUVE(S) — la fiche était à jour, son sujet a bougé :\n` +
                fraiches
                    .map(
                        (s) =>
                            `   • ${s.rel}\n` +
                            `     ${s.behind} commit(s) sur ${s.subject} depuis ${s.sha} — re-vérifier, puis \`verifie_contre: ${s.head}\``
                    )
                    .join("\n") +
                `\n   Le gel ne s'élargit pas : une fiche sortie de la baseline y reste sortie.`
        );
    }

    if (guerie.length > 0) {
        problems.push(
            `❌ [${CODE}/VC-05] ${guerie.length} entrée(s) de baseline sans retard — la dette a été\n` +
                `   soldée, la baseline doit suivre. Retirer ces lignes :\n` +
                guerie.map((k) => `   • ${k}`).join("\n")
        );
    }
}

if (problems.length > 0) {
    console.error("");
    for (const p of problems) console.error(p + "\n");
    process.exit(1);
}

// Anti-empty-gate: the ACTUALLY measured deposit prints at every run, so it
// cannot fossilise in a document. The three worst first: the output IS the
// drainage order.
console.log(
    `  ${measured.length} fiche(s) mesurée(s) · ${fresh.length} à jour · ${behind.length} gelée(s) (décroissantes)` +
        (measured.some((s) => s.exempted > 0)
            ? `\n  ${measured.reduce((n, s) => n + (s.exempted || 0), 0)} commit(s) exemptés — devDependencies seul, rien qu'une fiche puisse affirmer n'y bouge`
            : "")
);
const worst = [...behind].sort((a, b) => b.behind - a.behind).slice(0, 3);
for (const s of worst) {
    console.log(
        `    ↳ ${String(s.behind).padStart(4)} commit(s) de retard — ${s.rel} (à re-vérifier contre ${s.head})`
    );
}
console.log(`✓ ${CODE} — aucune péremption neuve, aucune entrée de gel périmée.`);
