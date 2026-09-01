#!/usr/bin/env node
/**
 * INTERNAL register cross-references — `B-nnn` and `D-nn` cited outside their section.
 *
 * Readers: `packages/core/__tests__/guards/registry-crossrefs.guard.test.ts`. A second
 * census would diverge — same rationale as `lib/packages.cjs` and `lib/docs-paths.cjs`.
 *
 * ## The defect this module makes visible
 *
 * Since 2026-08-18, a settled line is **removed** from its register — no longer struck
 * through. The convention is sound (a register two-thirds crossed out no longer reads),
 * but it has a side effect nothing guarded: **the prose that cited the line stays, and
 * now points at an absent section.**
 *
 * Measured on 2026-08-21: the backlog's head callout — the only one read BEFORE deciding
 * what to open — named in the present tense four lines removed three days earlier, three
 * of them security proofs. A good-faith reader was reopening work that no longer existed.
 * `check-dead-links` could not see it: its ten scopes are all public docs,
 * `_docs_projet/` is not among them.
 *
 * ## 🛑 Why the discriminant is STRUCTURAL and not linguistic
 *
 * The first oracle written for this defect looked for "any identifier that does not
 * resolve". It returned **28 dead references where 5 are** — it accused the history rows,
 * which are *right* to cite removed lines since their object is to say what happened on a
 * date. A gate with that false-positive rate is disarmed the day it lands.
 *
 * Classifying French prose by verb tense is a dead end. This module therefore classifies
 * by SHAPE, on two stages:
 *
 *   ① **POINTER** — the sentence DIRECTS the reader elsewhere: `voir B-nnn`, `cf. B-nnn`,
 *      `Dépend de B-nnn`, `→ B-nnn`, or the definition bullet `- **B-nnn** — …`.
 *      If the target does not exist, the reader follows an arrow into the void.
 *      **Blocking.**
 *   ② **MENTION** — every other reference. "Derived from B-nnn, settled the same day" is
 *      right and self-sufficient; "B-nnn is proven by nothing" is not. The two have the
 *      same shape, and **no machine separates them**. Frozen as an itemized set,
 *      **advisory**.
 *
 * ⚠️ **Stage ② is deliberately NON-BLOCKING**, for the exact reason that made
 * `PARITY-13` advisory: the live zone carries **116 dead mentions** at the time of
 * landing. Reddening on them would make the gate permanently red, hence disarmed within
 * the week. The itemized freeze catches what matters — **a newly removed identifier
 * whose prose did not follow**, i.e. the defect actually observed, twice.
 *
 * ## What is EXEMPT, and why it is not a concession
 *
 * The `## Historique des révisions` section is **narrative by construction**: a row there
 * says what a given day produced, and it must be able to name a closed line. Exempting it
 * weakens nothing — it acknowledges the document has two regimes. It alone carries
 * **868 dead references**; counting them would be measuring the wrong thing very hard.
 *
 * ⚠️ The narrative zone stops at the NEXT `##`, not at the end of the file. In the
 * backlog, `## Historique des révisions` sits **in the middle** (l. 843) and sections
 * resume after it (l. 988). This module's first census classified the whole bottom of
 * the file as "history" and thus saw no defect there — the instrument carried the
 * blindness it measured.
 *
 * **Code blocks** are exempt too: `grep -E '^#{2,3} B-[0-9]+'` is a command, not a
 * reference.
 */
const fs = require("node:fs");
const path = require("node:path");

const { INTERNAL_ROOT, REPO_ROOT, rel } = require("./docs-paths.cjs");

/**
 * The two registers — **the RESOLUTION source**: there, and nowhere else, is where a
 * `B-nnn` or a `D-nn` has a section.
 */
const REGISTRIES = ["backlog_technique.md", "dette_technique.md"].map((f) =>
    path.join(INTERNAL_ROOT, "registres", f)
);

/**
 * The CORPUS — the files whose references are guarded. Distinct from the resolver, and
 * the distinction is not cosmetic: a file can cite a line without ever carrying one.
 *
 * 🛑 **`CLAUDE.md` entered the corpus on 2026-08-23, and it should have been there
 * first.** The initial landing only guarded the registers, with the closing reservation
 * that "the other documents are read by nothing". Two days later, a concurrent session's
 * commit cited two dead identifiers: the census showed **ten dead identifiers in
 * `CLAUDE.md`**, one of them asserted **in the present tense** while the line no longer
 * exists.
 *
 * ⚠️ **And the reach is wider there than in a register**: `CLAUDE.md` is loaded at EVERY
 * session, before any decision. A dead reference there is read by every piece of work,
 * not only by whoever opens the register. The gate had thus been laid on the less exposed
 * file of the two.
 *
 * 📌 The rest — roadmaps, `ETAT.md`, `vision/` — does NOT enter, and the decision is
 * INSTRUCTED. ⚠️ **Its measurement is DATED and its subject is GONE**: taken 2026-08-25 on
 * `travail/roadmaps/`, which was emptied of its roadmaps on 2026-08-26. The exclusion does
 * NOT reopen for that reason — it rests on the narrative regime described below, which any
 * future roadmap would reproduce, not on a stock that happened to exist. Re-measure before
 * citing the figures again. As measured then: 450 mentions in travail/roadmaps/, 339 dead (75 %),
 * of which 250 in the settlement run's roadmaps — born to NARRATE closures, their stock
 * of dead mentions GROWS at every tick by construction. A "shrink-only" freeze is thus
 * impossible there: the narrative regime is rejected on measurement, not on principle.
 * The DIRECTIVE stage, meanwhile, is held elsewhere:
 * `roadmap-backlog-pointers.guard.test.ts` demands that an open-status §Backlog row point
 * at an OPEN line — that is the half of the registers' regime that carried the
 * information, and it is in place. Reopening this choice takes a new fact, not a
 * re-reading.
 */
const CORPUS = [...REGISTRIES, path.join(REPO_ROOT, "CLAUDE.md")];

/** A section title — struck through or not; the title is authoritative, and it alone. */
const TITLE = /^#{2,3}\s+~?~?((?:B|D)-\d+)\b/;

/** A citation. Bounded on both sides so as not to bite into `B-12b` nor `AB-12`. */
const CITE = /(?<![\w-])((?:B|D)-\d+)(?![\w-])/g;

const ID = "(?:B|D)-\\d+";

/**
 * The POINTER shapes — the blocking stage.
 *
 * ⚠️ `→` excludes RANGES: `B-nnn→B-nnn` (tight or spaced) enumerates an interval, it
 * directs nobody. Without this exclusion the census returned 5 pointers of which 2 were
 * false — and two false out of five is enough to get a gate deactivated.
 */
/** @type {[string, RegExp][]} */
const POINTERS = [
    ["voir", new RegExp(`\\bvoir\\s+(?:la\\s+ligne\\s+|l['’]entr[ée]e\\s+)?\\*{0,2}(${ID})`, "gi")],
    ["cf", new RegExp(`\\bcf\\.?\\s+\\*{0,2}(${ID})`, "gi")],
    ["dépend", new RegExp(`\\bd[ée]pend(?:e|ent)?\\s+de\\s+\\*{0,2}(${ID})`, "gi")],
    ["flèche", new RegExp(`→\\s*\\*{0,2}(${ID})`, "g")],
    // 🛑 THE STATUS ASSERTION: "(B-nnn, ouverte)". Added on 2026-08-23, because the five
    // shapes above missed it — and it was the one carrying `CLAUDE.md`'s only real
    // defect. Its semantics are sharper than a pointer's: **declaring OPEN a line that
    // has no section is false in every case**, with no verb tense to judge. We only take
    // "ouverte" — asserting a line closed or removed stays true once it is gone; that is
    // even what the 08-18 convention produces.
    [
        "statut",
        new RegExp(
            `\\*{0,2}(${ID})\\*{0,2}\\s*[,;:—–)-]?\\s*(?:est\\s+|reste\\s+)?(?:encore\\s+)?ouverte?\\b`,
            "gi"
        ),
    ],
    // The DEFINITION bullet: `- **B-nnn** — …`. A short qualifier may slip in
    // (`- **B-nnn** (versée le 31/07/2026) — …`), and without this tolerance the most
    // exposed shape of the corpus escapes: of the original defect's three bullets, only
    // two were caught. Capped at 48 characters so as not to bite into an ordinary
    // sentence.
    ["puce", new RegExp(`^\\s*[-*]\\s+\\*\\*(${ID})\\*\\*[^—–\\n]{0,48}[—–]`, "gm")],
];

/** Are both registers on disk? False on the public clone — see the guard. */
const registriesPresent = () => CORPUS.every((p) => fs.existsSync(p));

/**
 * The identifiers that have a SECTION, all registers merged.
 *
 * Merged deliberately: a line migrates from one register to the other (measured on
 * 08-20). Resolving file by file would redden on a legitimate reclassification.
 *
 * @returns {Set<string>}
 */
function sectionIds() {
    const out = new Set();
    for (const p of REGISTRIES) {
        for (const line of fs.readFileSync(p, "utf8").split("\n")) {
            const m = TITLE.exec(line);
            if (m) out.add(m[1]);
        }
    }
    return out;
}

/**
 * Cuts a file into zones: `"hist"` inside `## Historique des révisions`, `"live"`
 * everywhere else. The narrative zone closes at the next `##`.
 *
 * @param {string[]} lines
 * @returns {string[]} one zone per line
 */
function zonesOf(lines) {
    const zones = [];
    let cur = "live";
    // 🛑 ONLY LANGUAGE-TAGGED BLOCKS ARE CODE. We track neither the `callout`s nor
    // marker pairing — and both decisions were paid for:
    //
    //  ① **A `callout` is PROSE.** The entire head of both registers is made of them.
    //     Excluding them removed from the perimeter the most-read zone of the document,
    //     and that is what made this module miss the very defect it is written for — it
    //     went green on the version predating the 08-21 fix. Info-string census:
    //     29 `bash`, 7 `callout`, 2 `ts`, 1 `js`; only `callout` carries prose.
    //  ② **These files' fences are UNBALANCED**, and it is not fixable from here: the
    //     backlog carries an orphan ```` (l. 138) closing what another already closed.
    //     Any state machine that pairs markers desynchronizes on it and classifies
    //     hundreds of prose lines as "code" — measured: three of the four dead pointers
    //     vanished from the census. **A gate that shrinks its corpus goes green**, and
    //     that is the failure mode this repo hunts everywhere.
    //
    // Hence the minimal automaton: open only on a language, close at the next bare
    // marker. It cannot drift further than one code block, and the corpus's 32 are
    // well-formed.
    let inCode = false;
    for (const line of lines) {
        const lang = /^\s*`{3,}\s*([A-Za-z][\w-]*)/.exec(line);
        const bare = /^\s*`{3,}\s*$/.test(line);
        if (!inCode && lang && !/^callout$/i.test(lang[1])) {
            inCode = true;
        } else if (inCode && bare) {
            zones.push("code");
            inCode = false;
            continue;
        }
        if (!inCode && /^## /.test(line)) {
            cur = /^## Historique des r[ée]visions/.test(line) ? "hist" : "live";
        }
        zones.push(inCode ? "code" : cur);
    }
    return zones;
}

/**
 * The line numbers sitting INSIDE a `callout` block.
 *
 * 🛑 This census is deliberately separate from `zonesOf` and enters no verdict: its sole
 * role is to make RX-00 able to see that `callout` prose is still in the perimeter.
 * Without it, reclassifying the `callout`s as "code" — the regression that made this
 * module miss the defect it is written for — leaves every assertion GREEN on a shrunken
 * corpus. Proven: on that mutation, only a ratchet gone stale reddened, by ricochet, and
 * an `--update-baseline` would have silenced it.
 *
 * @param {string[]} lines
 * @returns {Set<number>} 1-indexed line numbers
 */
function calloutRegions(lines) {
    const out = new Set();
    let open = 0;
    lines.forEach((line, i) => {
        const f = /^\s*(`{3,})\s*(.*)$/.exec(line);
        if (f) {
            if (open === 0 && /^callout\b/i.test(f[2])) open = f[1].length;
            else if (open !== 0 && f[1].length >= open && f[2].trim() === "") {
                open = 0;
                return;
            }
        }
        if (open !== 0) out.add(i + 1);
    });
    return out;
}

/**
 * Collects a register's references.
 *
 * @param {string} file absolute path
 * @param {Set<string>} known the identifiers that have a section
 * @returns {{pointers: object[], mentions: object[], resolved: number,
 *            allLive: {file: string, line: number, id: string}[], calloutLines: Set<number>}}
 */
function scanFile(file, known) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const zones = zonesOf(lines);
    const short = path.basename(file);
    const pointers = [];
    const mentions = [];
    const allLive = [];
    let resolved = 0;

    lines.forEach((line, i) => {
        if (zones[i] !== "live" || TITLE.test(line)) return;

        // ① pointers — the shape says the reader must go look
        const seenAsPointer = new Set();
        for (const [form, rx] of POINTERS) {
            rx.lastIndex = 0;
            let m;
            while ((m = rx.exec(line)) !== null) {
                // A RANGE is not a pointer: `B-nnn → B-nnn` enumerates an interval.
                // The lookbehind was not enough (`\s*` moves the anchor point) — we look
                // at what really precedes the arrow.
                if (form === "flèche" && new RegExp(`${ID}\\s*$`).test(line.slice(0, m.index))) {
                    continue;
                }
                seenAsPointer.add(m[1]);
                if (known.has(m[1])) resolved += 1;
                else pointers.push({ file: short, line: i + 1, id: m[1], form, text: line.trim() });
            }
        }

        // ② mentions — everything else
        CITE.lastIndex = 0;
        let c;
        while ((c = CITE.exec(line)) !== null) {
            allLive.push({ file: short, line: i + 1, id: c[1] });
            if (seenAsPointer.has(c[1]) || known.has(c[1])) continue;
            mentions.push({ file: short, line: i + 1, id: c[1], text: line.trim() });
        }
    });

    return { pointers, mentions, resolved, allLive, calloutLines: calloutRegions(lines) };
}

/**
 * The complete census.
 *
 * @returns {{known: Set<string>, pointers: object[], mentions: object[],
 *            resolvedPointers: number, calloutCitations: number,
 *            perFile: Record<string, number>, keys: string[]}}
 */
function scan() {
    const known = sectionIds();
    const pointers = [];
    const mentions = [];
    let resolvedPointers = 0;
    let calloutCitations = 0;
    // 🛑 Count per FILE, not only globally. Removing a file from the corpus otherwise
    // only reddens the ratchet, by ricochet — and `--update-baseline` would silence it.
    // Measured on that exact mutation: dropping `CLAUDE.md` left five assertions green.
    /** @type {Record<string, number>} */
    const perFile = {};
    for (const p of CORPUS) {
        perFile[path.basename(p)] = 0;
        const r = scanFile(p, known);
        perFile[path.basename(p)] = r.allLive.length;
        pointers.push(...r.pointers);
        mentions.push(...r.mentions);
        resolvedPointers += r.resolved;
        calloutCitations += r.allLive.filter((c) => r.calloutLines.has(c.line)).length;
    }
    // Freeze key: `file:identifier`, no line number — a line moves at every edit, the
    // identifier does not. What the freeze must catch is a NEWLY removed identifier
    // whose prose did not follow, and that key renders exactly that.
    const keys = [...new Set(mentions.map((m) => `${m.file}:${m.id}`))].sort();
    return { known, pointers, mentions, resolvedPointers, calloutCitations, perFile, keys };
}

/**
 * Self-proof of the patterns: does each pointer shape still recognize its canonical
 * example?
 *
 * 🛑 Without it, a shape can stop biting with nothing turning red. The global counter of
 * resolved pointers is not enough: it aggregates. The "statut" shape, added on
 * 2026-08-23, has **no resolved witness in the corpus** — every "ouverte" assertion found
 * there bears on absent lines; that is its very reason to exist. It would thus be the
 * first to rot in silence, and it is the one guarding the sharpest defect.
 *
 * The proof is a unit test of the patterns, independent of what the corpus contains on
 * any given day — so it does not expire when the prose changes.
 *
 * @returns {{form: string, sample: string, matched: boolean}[]}
 */
function patternWitnesses() {
    /** @type {Record<string, string>} */
    const SAMPLES = {
        voir: "marquant _flaky_ (voir **B-118**).",
        cf: "le geste est ailleurs (cf. B-93) et il tient.",
        dépend: "**Dépend de B-174** (le descripteur), qui porte la plomberie.",
        flèche: "le tri renvoie → B-269 pour la suite.",
        statut: "juge l'existence sur le disque (**B-230**, ouverte). Ne jamais économiser.",
        puce: "- **B-92** (versée le 31/07/2026) — la règle est éteinte sans motif écrit.",
    };
    return POINTERS.map(([form, rx]) => {
        const sample = SAMPLES[form] ?? "";
        rx.lastIndex = 0;
        return { form, sample, matched: sample !== "" && rx.test(sample) };
    });
}

/**
 * STRUCTURAL witness of the classifier: is `callout` prose still in the live zone?
 *
 * 🛑 Complementary to `calloutCitations`, not redundant with it. This one proves
 * `zonesOf` directly — it reddens even if the witness `callout` cites no identifier,
 * where the citation counter depends on what the prose contains on a given day. The
 * other proves the WHOLE chain, up to the census really keeping those lines. Neither
 * replaces the other, and the first draft had neither: reclassifying the `callout`s as
 * "code" then left all four assertions green.
 *
 * @returns {{file: string, callout: number, prose: number, zone: string}[]}
 */
function calloutZoneWitness() {
    const out = [];
    for (const file of REGISTRIES) {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        const zones = zonesOf(lines);
        const at = lines.findIndex((l) => /^\s*`{3,}\s*callout\b/i.test(l));
        if (at < 0) continue;
        // The first non-empty line AFTER the opening: prose, by construction.
        let j = at + 1;
        while (j < lines.length && lines[j].trim() === "") j += 1;
        out.push({ file: path.basename(file), callout: at + 1, prose: j + 1, zone: zones[j] });
    }
    return out;
}

/** The itemized freeze of stage ② — see the header for why a freeze rather than a red. */
const BASELINE = path.join(REPO_ROOT, "scripts", ".baselines", "registry-crossrefs.json");

/** @returns {{_comment: string, _generated: string, count: number, entries: string[]}} */
function readBaseline() {
    return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
}

/**
 * Rewrites the freeze from the current census.
 *
 * ⚠️ To run AFTER fixing prose, never to silence a red: the ratchet is only worth
 * anything if going down is a deliberate move, visible in review.
 */
function writeBaseline() {
    const { keys } = scan();
    const payload = {
        _comment:
            "REGISTRY-CROSSREFS — mentions mortes gelées (RX-02). Ne peut que RÉTRÉCIR. " +
            "Régénérer avec `node scripts/lib/registry-crossrefs.cjs --update-baseline` " +
            "UNIQUEMENT après avoir corrigé de la prose, jamais pour faire taire un rouge.",
        _generated: "node scripts/lib/registry-crossrefs.cjs --update-baseline",
        count: keys.length,
        entries: keys,
    };
    fs.writeFileSync(BASELINE, `${JSON.stringify(payload, null, 4)}\n`, "utf8");
    return payload;
}

if (require.main === module) {
    if (!process.argv.includes("--update-baseline")) {
        console.error("usage : node scripts/lib/registry-crossrefs.cjs --update-baseline");
        process.exit(2);
    }
    if (!registriesPresent()) {
        console.error("registres absents — rien à geler (clone public ?).");
        process.exit(2);
    }
    const p = writeBaseline();
    console.log(`gel réécrit : ${p.count} mention(s) morte(s) · ${rel(BASELINE)}`);
}

module.exports = {
    BASELINE,
    CORPUS,
    REGISTRIES,
    REPO_ROOT,
    rel,
    registriesPresent,
    sectionIds,
    calloutZoneWitness,
    patternWitnesses,
    scan,
    readBaseline,
    writeBaseline,
};
