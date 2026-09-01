#!/usr/bin/env node
/*!
 * GeoLeaf — RC: does a removed roadmap's closure exist INSIDE the repo?
 * © 2026 Mattieu Pottier — MIT
 *
 * ## The defect this gate makes visible
 *
 * Closing a roadmap means bumping its `version:`, adding its revision line, then
 * copying it out of the repo and removing it from the index. Done in **one tree
 * operation**, the deletion swallows the edit: git records only a deletion, and
 * the closure content never transits through a commit. It then exists only in an
 * out-of-repo file, unversioned, unbacked.
 *
 * 🛑 **And the gate guarding the `version:` / revision-table pair cannot see
 * it**, for a structural reason: it derives its corpus from `git ls-files`. A
 * file removed from the index LEAVES the corpus — it judges nothing anymore, and
 * its silence is indistinguishable from agreement.
 *
 * ## What this gate does, and what it cannot do
 *
 * It cannot read the archived copy: that one lives outside the repo, hence out
 * of a clone's reach. What it does is **bring the fact into the repo**:
 * `ARCHIVEES.md` carries, for each removed roadmap, the `version:` of its LAST
 * COMMITTED STATE. Someone reconstructing history from the repo alone now reads
 * what git knows, instead of having to guess something is missing.
 *
 * ⚠️ **The gap between that version and the archived copy's is NOT guarded** —
 * it cannot be. It is noted by hand, dated, in the document's "Écarts relevés"
 * section. A gate claiming to verify it would lie about its own reach.
 *
 * ⚠️ **THE INDEX IS ONE COMMIT BEHIND, AND THAT IS STRUCTURAL — measured by
 * using it on 2026-08-19.** The survey goes through `git log --diff-filter=D`,
 * which only sees HISTORY: a merely *staged* deletion is invisible to it. The
 * archiving commit thus reddens `RC-01`, and a THIRD commit is needed to
 * regenerate the index.
 *
 * 🛑 **This is not a defect to fix, and one must not try.** Making it read the
 * git index rather than history would make the survey depend on what is staged
 * at run time — two successive launches would no longer render the same table,
 * and `RC-01`, which compares to the byte, would become uninterpretable. One
 * more commit is the price of a reproducible survey.
 *
 *   RC-01  `ARCHIVEES.md` is current — regenerated, it must be identical.
 *   RC-02  Anti-empty-gate: the survey must find closures. Zero = refusal to
 *          conclude.
 *   RC-03  A MOVE is not a closure. A roadmap moved inside the repo keeps its
 *          closure visible; confusing it with a deletion would inflate the tally
 *          and pass off as lost what is simply elsewhere.
 *
 * Usage :
 *   node scripts/check-roadmap-closures.cjs            # verifies
 *   node scripts/check-roadmap-closures.cjs --write    # regenerates
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const docsPaths = require("./lib/docs-paths.cjs");
const { closedRoadmaps, ROADMAPS_REL } = require("./lib/roadmap-closures.cjs");

const CODE = "ROADMAP-CLOSURES";
const WRITE = process.argv.includes("--write");

// ⚠️ EXPLICIT, MOTIVATED skip, on the DOC-VERSIONS pattern. Without it, the gate
// would read 0 closures and go GREEN having guarded nothing — the false-green
// this repo names its costliest class.
if (!docsPaths.internalRootExists()) {
    console.log(
        `⏭️  [${CODE}] SAUTÉ — la racine INTERNE est absente : ${docsPaths.rel(docsPaths.INTERNAL_ROOT)}`
    );
    console.log(
        "    Ce n'est PAS un vert : aucune clôture n'a été relevée. Sur le dépôt public c'est le\n" +
            "    comportement attendu — `_docs_projet/` y est retiré par décision."
    );
    process.exit(0);
}

const TARGET = path.join(docsPaths.REPO_ROOT, ROADMAPS_REL, "ARCHIVEES.md");
const MIN_CLOSURES = 20;

/**
 * Renders the generated body of `ARCHIVEES.md`.
 *
 * @param {ReturnType<typeof closedRoadmaps>} rows - Every roadmap that left `roadmaps/`.
 * @returns {string} The document body, between the generation markers.
 */
function render(rows) {
    const pure = rows.filter((r) => !r.movedTo);
    const moved = rows.filter((r) => r.movedTo);
    const out = [];
    out.push(
        `**${pure.length} roadmaps retirées** du dépôt, et **${moved.length} déplacées** dans le dépôt.`
    );
    out.push("");
    out.push("| Retirée le | Roadmap | Dernier `version:` DANS git | Commit de retrait |");
    out.push("| ---------- | ------- | --------------------------- | ----------------- |");
    for (const r of pure) {
        out.push(
            `| ${r.date} | \`${r.name}\` | ${r.versionInGit ? `\`${r.versionInGit}\`` : "— *(aucune)*"} | \`${r.sha}\` |`
        );
    }
    out.push("");
    out.push("### Déplacées, non retirées — leur clôture est restée visible");
    out.push("");
    out.push("| Déplacée le | Roadmap | Destination |");
    out.push("| ----------- | ------- | ----------- |");
    for (const r of moved) {
        out.push(`| ${r.date} | \`${r.name}\` | \`${r.movedTo}\` |`);
    }
    return out.join("\n");
}

const rows = closedRoadmaps();

// ── RC-02 ────────────────────────────────────────────────────────────────────────────────
if (rows.length < MIN_CLOSURES) {
    console.error(
        `❌ [${CODE}/RC-02] REFUS DE CONCLURE — ${rows.length} clôture(s) relevée(s), attendu ≥ ${MIN_CLOSURES}.\n` +
            "   Le relevé passe par `git log --diff-filter=D` sur les roadmaps. Un compte aussi bas\n" +
            "   signale un dépôt sans historique (clone superficiel) ou un glob qui ne mord plus.\n" +
            "   Une gate qui n'a rien lu ne garde rien."
    );
    process.exit(2);
}

// ── RC-03 ────────────────────────────────────────────────────────────────────────────────
const bothWays = rows.filter((r) => r.movedTo && !r.movedTo.startsWith("_docs_projet/"));
if (bothWays.length > 0) {
    console.error(
        `❌ [${CODE}/RC-03] ${bothWays.length} déplacement(s) hors de \`_docs_projet/\` :`
    );
    for (const r of bothWays) console.error(`     ${r.name} → ${r.movedTo}`);
    console.error(
        "\n   Une roadmap qui sort de l'arborescence d'atelier n'est ni close ni déplacée : c'est\n" +
            "   un troisième cas, et il doit être décidé plutôt que classé par défaut."
    );
    process.exit(1);
}

const MARK_A = "<!-- GEOLEAF:ROADMAP-CLOSURES:START -->";
const MARK_B = "<!-- GEOLEAF:ROADMAP-CLOSURES:END -->";
const body = render(rows);

if (!fs.existsSync(TARGET)) {
    if (!WRITE) {
        console.error(
            `❌ [${CODE}/RC-01] \`${docsPaths.rel(TARGET)}\` est absent.\n` +
                "   Le générer : node scripts/check-roadmap-closures.cjs --write"
        );
        process.exit(1);
    }
    console.error(
        `❌ [${CODE}] \`${docsPaths.rel(TARGET)}\` est absent — le créer à la main d'abord (l'en-tête et la section « Écarts relevés » ne se génèrent pas).`
    );
    process.exit(2);
}

const current = fs.readFileSync(TARGET, "utf8");
const iA = current.indexOf(MARK_A);
const iB = current.indexOf(MARK_B);
if (iA === -1 || iB === -1 || iB < iA) {
    console.error(
        `❌ [${CODE}/RC-01] Marqueurs de génération absents ou inversés dans ${docsPaths.rel(TARGET)}.\n` +
            `   Attendus : ${MARK_A} … ${MARK_B}`
    );
    process.exit(1);
}

const rebuilt = current.slice(0, iA + MARK_A.length) + "\n\n" + body + "\n\n" + current.slice(iB);

if (WRITE) {
    fs.writeFileSync(TARGET, rebuilt);
    console.log(`✅ [${CODE}] ${docsPaths.rel(TARGET)} régénéré — ${rows.length} clôture(s).`);
    process.exit(0);
}

if (rebuilt !== current) {
    console.error(
        `❌ [${CODE}/RC-01] ${docsPaths.rel(TARGET)} n'est pas à jour.\n` +
            "   Régénérer : node scripts/check-roadmap-closures.cjs --write\n" +
            "   ⚠️ La section « Écarts relevés » est HORS génération : elle relève ce que git ne\n" +
            "   peut pas voir, et une régénération ne doit jamais la réécrire."
    );
    process.exit(1);
}

const pure = rows.filter((r) => !r.movedTo).length;
console.log(
    `✅ [${CODE}] ${docsPaths.rel(TARGET)} à jour — ${pure} roadmap(s) retirée(s), ${rows.length - pure} déplacée(s).`
);
