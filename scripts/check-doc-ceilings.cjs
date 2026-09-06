#!/usr/bin/env node
/**
 * DOC-CEIL — the files read BEFORE any source stay small, and carry no copied count.
 *
 * Usage:
 *   node scripts/check-doc-ceilings.cjs
 *   node scripts/check-doc-ceilings.cjs --update-baseline   # tighten, never loosen
 *
 * ## What this gates, and why a ratchet rather than a fixed limit
 *
 * `CLAUDE.md` and `ETAT.md` are loaded at the start of every session, before a single
 * line of source. `CLAUDE.md` doubled in six weeks — and it did so DURING sessions that
 * were closing recommendations, so no single moment ever looked like a decision.
 *
 * The target is 15 KB per file. The ceiling is NOT that target: it is whatever the file
 * actually measures at the last tightening, and it can only go DOWN. A fixed 15 KB laid
 * before the measurement would have been red on the day it was laid, and a gate that is
 * red on arrival gets disarmed rather than satisfied. The ratchet makes every pass a
 * one-way door instead.
 *
 * ⚠️ Below its ceiling, the gate is GREEN and prints the invitation to tighten. It does
 * not tighten by itself: re-freezing is a gesture someone makes knowingly, exactly as for
 * every other decreasing baseline here.
 *
 * ## DOC-CEIL-02 — no copied count in a loaded file
 *
 * `CLAUDE.md` carried four false counts in the very paragraph forbidding copied numbers.
 * The worst was wrong by a factor of twenty and commanded a cleanup that did not exist.
 * A count in prose has no verifier and no expiry: it just stops being true.
 *
 * ⚠️ Dates are excluded before matching — `12/08/2026` is not a ratio. So is a short date
 * introduced by one of the French date prefixes the second regex below lists.
 *
 * ⚠️ `POSTMORTEMS.md` is exempt from 02, with its motive: that file EXISTS to record the
 * counts that were false, so forbidding them there would forbid the record itself. It
 * stays governed by 01 — without a ceiling it would simply become the new dumping ground,
 * which is moving the defect rather than closing it.
 *
 * 🛑 MEASURE THE FORMATTED BYTES, and this cost a red on the day the gate was laid.
 * `lint-staged` runs Prettier on `*.md` at commit time, and Prettier ADDS bytes — it pads
 * table cells and rewraps. A baseline laid on the working copy therefore freezes a size the
 * repository can never hold: `CLAUDE.md` gained 2726 bytes between `git add` and the commit,
 * so the gate went red on its own subject, immediately and permanently. And `--update-baseline`
 * cannot repair that — it takes the MINIMUM, by design, so it kept the unreachable value.
 * **Lay a new ceiling after `npx prettier --write`, never before.** Same family as the repo's
 * standing "`git add` THEN the gate": the state a gate must judge is the state that lands.
 *
 * 🛑 This gate SKIPS on the public clone, where none of its subjects exist. That makes it
 * a workshop gate: it carries `workshop: true` in `ci-local.cjs`, and `PARITY-14` verifies
 * that flag against this very condition.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const docsPaths = require("./lib/docs-paths.cjs");
const BASELINE = path.join(__dirname, ".baselines", "doc-ceilings.json");

/** The aim, in bytes. Named in every message so a green never hides the goal. */
const TARGET = 15 * 1024;

// 🛑 BEFORE the two constants below, and the order is EVERYTHING — it cost a red public CI.
// `NO_COUNTS` and `ROTATING` both call `docsPaths.internal()`, which THROWS when the workshop
// root is missing; this guard used to live UNDER them, so it was never reached on the only
// corpus where it does anything. The skip was written, and `ci.yml` carried a comment saying
// this step skips where its subjects do not ship — and it was dead all the same: the mirror
// crashed on a stack trace instead of skipping. A guard never SEEN doing its job guards
// nothing. Locked by `__tests__/guards/workshop-gates-skip-public.guard.test.ts`.
//
// ⚠️ `internalRootExists()` never throws, by contract (`lib/docs-paths.cjs`) — which is
// precisely why it is the one call that may precede everything else.
if (!docsPaths.internalRootExists()) {
    console.log("⏭️  [DOC-CEIL] SAUTÉ — la racine d'atelier est absente.");
    console.log(
        "    Ce n'est pas un vert : aucun fichier n'a été pesé. Sur le clone public c'est\n" +
            "    le comportement attendu — ces documents n'y partent pas."
    );
    process.exit(0);
}

/** Files whose prose must carry no ratio. See DOC-CEIL-02 above for the exemption. */
const NO_COUNTS = new Set(["CLAUDE.md", docsPaths.rel(docsPaths.internal("ETAT.md"))]);

/**
 * Files whose ceiling is FIXED with rotation, not a decreasing ratchet.
 *
 * 🛑 A decreasing ratchet on an append-only record is self-defeating, and this was found
 * by trying to use it: `POSTMORTEMS.md` exists to RECEIVE the narratives taken out of the
 * loaded files, so its size is supposed to grow. Freezing it at what it measures today
 * would make the next post-mortem red, and the cheapest way out of that red would be to
 * leave the narrative in `CLAUDE.md` — the exact defect this whole gate exists to close.
 *
 * So it gets `JOURNAL.md`'s regime instead: a fixed ceiling, and when it is reached the
 * OLDEST entry leaves for the private archive. The ceiling still binds — an unbounded
 * record would just move the weight one file over — but it binds on TURNOVER rather than
 * on growth.
 */
const ROTATING = new Map([[docsPaths.rel(docsPaths.internal("POSTMORTEMS.md")), 24 * 1024]]);

if (!fs.existsSync(BASELINE)) {
    console.error(`❌ [DOC-CEIL] baseline absente : ${path.relative(ROOT, BASELINE)}`);
    console.error("   Refus de conclure — un plafond absent n'est pas un plafond tenu.");
    process.exit(2);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
// 🛑 The baseline is keyed by LOGICAL name, not by path, and for two reasons that both
// matter: a workshop path written literally in `scripts/` is a dead pointer for the public
// reader (WREF), and the workshop root is configurable — a hardcoded key would simply be
// wrong under `GEOLEAF_INTERNAL_DOCS_ROOT`. Resolution happens here, once.
const SUBJECTS = {
    claude: "CLAUDE.md",
    etat: docsPaths.rel(docsPaths.internal("ETAT.md")),
    postmortems: docsPaths.rel(docsPaths.internal("POSTMORTEMS.md")),
};
const ceilings = Object.fromEntries(
    Object.entries(baseline.ceilings || {}).map(([k, v]) => [SUBJECTS[k] || k, v])
);
if (Object.keys(ceilings).length === 0) {
    console.error("❌ [DOC-CEIL] baseline vide — elle ne garderait rien.");
    process.exit(2);
}

const UPDATE = process.argv.includes("--update-baseline");
const errors = [];
const notes = [];
const measured = {};

// The corpus is the UNION of both regimes: a rotating file has no ratchet entry, so a
// loop over the decreasing ceilings alone would never visit it — it would leave the
// perimeter in silence, which is the very defect this whole gate exists to prevent.
const SUBJECTS_ALL = [...new Set([...Object.keys(ceilings), ...ROTATING.keys()])];
for (const rel of SUBJECTS_ALL) {
    const ceiling = ceilings[rel] ?? Infinity;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
        errors.push(`DOC-CEIL-01  ${rel} — sous plafond mais ABSENT du disque.`);
        continue;
    }
    const size = fs.statSync(abs).size;
    measured[rel] = size;

    const rotating = ROTATING.get(rel);
    if (rotating !== undefined) {
        // Rotation regime: the ceiling is FIXED, and it is held by taking the OLDEST
        // entry out, never by refusing the next one.
        if (size > rotating) {
            errors.push(
                `DOC-CEIL-01  ${rel} — ${size} o pour un plafond FIXE de ${rotating} o.\n` +
                    `             Ce fichier est en régime de ROTATION : sortir la ou les entrées\n` +
                    `             les plus anciennes vers l'enregistrement privé, comme \`JOURNAL.md\`.`
            );
        }
        continue;
    }

    if (size > ceiling) {
        errors.push(
            `DOC-CEIL-01  ${rel} — ${size} o pour un plafond de ${ceiling} o (+${size - ceiling}).\n` +
                `             Le plafond ne remonte pas. Sortir le récit vers ` +
                `le registre de post-mortems,\n` +
                `             ou convertir un paragraphe-motif en impératif d'une ligne + un renvoi.`
        );
    } else if (size < ceiling) {
        notes.push(
            `${rel} — ${size} o sous un plafond de ${ceiling} o : resserrer avec ` +
                `\`--update-baseline\`.`
        );
    }

    if (!NO_COUNTS.has(rel)) continue;

    // Dates first, then ratios: `12/08/2026` is not a count, and neither is `le 19/08`.
    const prose = fs
        .readFileSync(abs, "utf8")
        .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, " ")
        .replace(/(?:le|du|au|dès|depuis|jusqu'au)\s+\d{1,2}\/\d{1,2}\b/gi, " ");
    const hits = [...prose.matchAll(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g)].map((m) => m[0]);
    if (hits.length > 0) {
        errors.push(
            `DOC-CEIL-02  ${rel} — ${hits.length} compte(s) recopié(s) en prose : ` +
                `${hits.join(", ")}.\n` +
                `             Un compte en prose n'a ni vérificateur ni date de péremption.\n` +
                `             Le RETIRER et citer la commande qui le rend — ne pas le corriger.`
        );
    }
}

if (UPDATE) {
    const next = { ...ceilings };
    for (const [rel, size] of Object.entries(measured)) {
        if (ROTATING.has(rel)) continue;
        next[rel] = Math.min(next[rel], size);
    }
    fs.writeFileSync(
        BASELINE,
        JSON.stringify(
            {
                _comment:
                    "Plafonds de taille (octets) des documents lus avant toute source. DÉCROISSANTS " +
                    "uniquement (DOC-CEIL-01) : ne jamais les remonter à la main. Cible : 15360 o par " +
                    "fichier. Régénérer avec --update-baseline APRÈS avoir allégé, jamais pour faire taire.",
                _generated: "node scripts/check-doc-ceilings.cjs --update-baseline",
                _target: TARGET,
                ceilings: next,
            },
            null,
            4
        ) + "\n"
    );
    console.log("✅ [DOC-CEIL] plafonds resserrés :");
    for (const [rel, size] of Object.entries(next)) console.log(`   ${rel} → ${size} o`);
    process.exit(0);
}

console.log("── DOC-CEIL — les fichiers lus avant toute source ──");
for (const [rel, size] of Object.entries(measured)) {
    const pct = Math.round((size / TARGET) * 100);
    console.log(`  ${String(size).padStart(6)} o  (${pct} % de la cible)  ${rel}`);
}

if (errors.length > 0) {
    console.error(`\n❌ [DOC-CEIL] ${errors.length} défaut(s) :\n`);
    for (const e of errors) console.error("  • " + e);
    process.exit(1);
}

for (const n of notes) console.log(`  ℹ ${n}`);
console.log(
    `\n✅ [DOC-CEIL] plafonds tenus — cible ${TARGET} o par fichier, jamais atteinte par le haut.`
);
