/**
 * Guard — a living roadmap's `## Backlog` carries POINTERS, never stranded open work.
 *
 * ## The loss this prevents (decided 25/08/2026)
 *
 * A closed roadmap is archived by a plain `mv` no hook can see; its `## Backlog` — "what this
 * roadmap leaves open" — goes with it. Measured once: 8 lines out of 9 lost. The loss is not
 * detectable afterwards (nothing remains to compare), only preventable before: if the section
 * never holds anything but pointers, archiving can lose nothing. So this guard holds the
 * INVARIANT on living roadmaps rather than gating the archive gesture itself.
 *
 * The rule: any Backlog table row whose status is an OPEN-work marker ("À arbitrer",
 * "À trancher", "Non planifié", "À faire", "À planifier") must name a `B-nnn` that is an OPEN
 * section of the register — work that deserves to survive is VERSED first. Rows with terminal
 * or scope markers (Fait, Soldée, Versée, Rendue, Hors périmètre) are narrative: they may die
 * with the document. Scope tables that carry no status column simply have no open rows.
 *
 * Atelier-only by nature: `_docs_projet/` never reaches the public clone, so the whole suite
 * skips there — same pattern as the registry-crossrefs guard.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ROADMAPS = path.join(ROOT, "_docs_projet", "travail", "roadmaps");
const REGISTER = path.join(ROOT, "_docs_projet", "registres", "backlog_technique.md");
const present = fs.existsSync(ROADMAPS) && fs.existsSync(REGISTER);

const OPEN_MARKERS = /À arbitrer|À trancher|Non planifié|À faire|À planifier/i;

describe.skipIf(!present)("ROADMAP-BACKLOG — le §Backlog ne porte que des renvois", () => {
    it("aucun rang au statut ouvert sans identifiant B-nnn OUVERT au registre", () => {
        const openIds = new Set(
            [...fs.readFileSync(REGISTER, "utf8").matchAll(/^#{2,3} (B-\d+) — /gm)].map((m) => m[1])
        );
        // Anti-vacuity on the register side — and NOT a floor on the count: the whole point
        // of a settlement run is to empty the register, so a low count is success, never
        // vacuity (this assertion was `> 3` and reddened the day the run reached 3 open
        // lines). What must be caught is a BROKEN TITLE PATTERN: zero ids while the file
        // still carries section-shaped titles means the regex stopped matching the format.
        if (openIds.size === 0) {
            const registerText = fs.readFileSync(REGISTER, "utf8");
            expect(
                /^#{2,3} B-\d+/m.test(registerText),
                "0 ligne ouverte lue alors que le fichier porte encore des titres de section — " +
                    "le motif de titre ne matche plus le format, refus de conclure."
            ).toBe(false);
        }

        const offenders: string[] = [];
        let sectionsSeen = 0;
        for (const f of fs.readdirSync(ROADMAPS)) {
            if (!f.startsWith("roadmap_") || !f.endsWith(".md")) continue;
            const src = fs.readFileSync(path.join(ROADMAPS, f), "utf8");
            // Split on section heads so a Backlog that ENDS the file is still captured —
            // a lookahead-to-next-section regex silently returns empty there.
            const sections = ("\n" + src).split(/\n(?=## )/);
            const body = sections.find((sec) => /^## Backlog\s*$/m.test(sec.split("\n")[0] ?? ""));
            if (body === undefined) continue;
            sectionsSeen++;
            for (const line of body.split("\n")) {
                if (!/^\|/.test(line.trim())) continue;
                if (!OPEN_MARKERS.test(line)) continue;
                const ids = [...line.matchAll(/B-(\d+)/g)].map((x) => `B-${x[1]}`);
                const anchored = ids.some((id) => openIds.has(id));
                if (!anchored) offenders.push(`${f} :: ${line.trim().slice(0, 90)}`);
            }
        }
        // Anti-vacuity, RE-DERIVED on 2026-08-26 — and the premise it rested on is gone.
        //
        // It read `>= 3`, motivated by "the repo carries several by construction". That was
        // true while roadmaps lived here; on 2026-08-26 the eleven of them were closed and
        // archived out of the repo, and the directory survives only for `ARCHIVEES.md`.
        // Leaving `>= 3` would have made this guard red forever on an empty-by-design corpus,
        // and a permanently red guard gets disarmed — the exact failure this repo measures.
        //
        // 🛑 The threshold is NOT simply lowered: a constant cannot tell "the extractor broke"
        // from "there is legitimately nothing to check". So the corpus size is measured
        // FIRST, from the disk, and the two cases are separated:
        //   · zero roadmap files  → nothing to check, and that is verifiable, not assumed;
        //   · one or more         → every one of them must yield a §Backlog, or the section
        //                           reader stopped matching.
        // The second branch is STRICTER than `>= 3` ever was: it compares against what is
        // actually on disk instead of a number that ages.
        const roadmapFiles = fs
            .readdirSync(ROADMAPS)
            .filter((f) => f.startsWith("roadmap_") && f.endsWith(".md"));
        if (roadmapFiles.length === 0) {
            expect(sectionsSeen).toBe(0);
        } else {
            expect(
                sectionsSeen,
                `${roadmapFiles.length} roadmap(s) on disk but ${sectionsSeen} §Backlog section(s) ` +
                    `read — the section reader stopped matching, it did not find nothing.`
            ).toBeGreaterThan(0);
        }
        expect(
            offenders,
            "rang(s) de §Backlog au statut OUVERT sans ligne de registre ouverte — verser " +
                "d'abord (registre pour du travail, fiche specs/ pour un fait produit), puis " +
                "pointer. La convention vit en tête d'ARCHIVEES.md."
        ).toEqual([]);
    });
});
