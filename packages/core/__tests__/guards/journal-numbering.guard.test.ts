/**
 * @file journal-numbering.guard.test.ts
 * @description Guard test — the JOURNAL's entry numbers are UNIQUE, and the
 * 15-entry cap is held.
 *
 * Why this guard exists — and why the JOURNAL itself asks for it
 * ------------------------------------------------------------------------------------
 * The entry number is a **counter shared** between concurrent sessions, and
 * it collided **twice**:
 *
 *   • (42), on 07/08/2026 — two entries with the same number, each having
 *     read the file's top before the other wrote. Repaired by cascade: two renumberings.
 *   • (48), a few days later — **while the file's header already explained
 *     the gesture that avoids it**. Repaired by suffix (`48b`), the cascade
 *     costing ten entries.
 *
 * 🛑 **The second stayed invisible for several days**, and the file says
 * exactly why: "nothing counts the numbers, and two `## 2026-08-07 (48)`
 * fifty lines apart are not seen while reading". It was found **by counting
 * entries for the rotation**, not by reading.
 *
 * Its header draws the conclusion itself: _"if one day nothing blocks,
 * prefer a guard that COUNTS the numbers over a third paragraph asking to
 * pay attention"_. Nothing blocked on 12/08/2026: this file is that guard.
 * Two prose warnings stopped neither the first collision nor the second.
 *
 * ## What is guarded, and what is not
 *
 * ✅ **Uniqueness** — a number seen twice turns red, naming both dates.
 * ✅ **Cap** — more than 15 entries turns red with the gesture (the rotation).
 * 🖐 **NOT the order**: reading is antechronological and the sequence may be
 *    non-integer (`48`, `48b`, `49`), which is the retained remedy and not a
 *    defect. Requiring strict growth would turn red on the repair itself.
 *
 * ## ⚠️ Why this guard SKIPS on the public clone, and why that is not a hole
 *
 * `_docs_projet/` is working apparatus: `port-to-public.cjs`'s partition
 * never carries it into `geoleaf/geoleaf-js`. A guard requiring the file
 * would be permanently red there — and make the public suite red for a
 * reason that concerns nobody there. It therefore skips **saying so**, on
 * the same pattern as `docs-paths.internalRootExists()`.
 *
 * The skip is riskless here: the JOURNAL only exists in the workshop, so the
 * workshop is the only place the property can be false.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../..");
const JOURNAL = path.join(REPO_ROOT, "_docs_projet", "JOURNAL.md");

/** The cap, as the JOURNAL's header declares it. */
const CAP = 15;

/** An entry: its date, its number (suffix included), its line. */
interface Entry {
    date: string;
    num: string;
    line: number;
}

/**
 * The JOURNAL's entries, in file order (antechronological).
 *
 * No silent fallback to an empty array: a file present but whose title shape
 * changed would make this guard green counting nothing — the failure mode
 * this repo hunts everywhere. Hence the anti-empty-corpus assertion in the
 * first test.
 */
function readEntries(): Entry[] {
    const lines = fs.readFileSync(JOURNAL, "utf8").split("\n");
    const out: Entry[] = [];
    lines.forEach((l, i) => {
        const m = /^## (\d{4}-\d{2}-\d{2}) \((\d+[a-z]?)\)/.exec(l);
        if (m) out.push({ date: m[1], num: m[2], line: i + 1 });
    });
    return out;
}

const present = fs.existsSync(JOURNAL);

describe.skipIf(!present)("JOURNAL — numérotation et plafond", () => {
    it("lit un corpus non vide — anti-garde-vide", () => {
        const entries = readEntries();
        expect(
            entries.length,
            `aucune entrée reconnue dans ${path.relative(REPO_ROOT, JOURNAL)} — ` +
                `la forme des titres a changé, ce garde ne compte plus rien. Re-pointer le motif, ` +
                `ne pas le neutraliser.`
        ).toBeGreaterThan(0);
    });

    it("reconnaît TOUS les titres d'entrée — anti-omission partielle", () => {
        const lines = fs.readFileSync(JOURNAL, "utf8").split("\n");
        const unread: string[] = [];
        lines.forEach((l, i) => {
            if (!l.startsWith("## ")) return;
            if (!/^## (\d{4}-\d{2}-\d{2}) \((\d+[a-z]?)\)/.test(l)) {
                unread.push(`l.${i + 1} — ${l.slice(0, 90)}`);
            }
        });
        expect(
            unread,
            `titre(s) d'entrée que le motif ne lit PAS :\n  ${unread.join("\n  ")}\n` +
                `  Un titre non lu n'est pas compté : il ne peut ni entrer en collision, ni ` +
                `peser sur le plafond. Le fichier dépasse alors EN SILENCE.\n` +
                `  Geste : conformer le titre à \`## AAAA-MM-JJ (N) — …\`, jamais élargir le ` +
                `motif — une session à cheval sur deux jours se date par sa CLÔTURE, et dit ` +
                `son ouverture après le tiret.`
        ).toEqual([]);
    });

    it("n'a AUCUN numéro d'entrée en double", () => {
        const entries = readEntries();
        const seen = new Map<string, Entry>();
        const clashes: string[] = [];
        for (const e of entries) {
            const first = seen.get(e.num);
            if (first) {
                clashes.push(`(${e.num}) — ${first.date} l.${first.line} ET ${e.date} l.${e.line}`);
            } else {
                seen.set(e.num, e);
            }
        }
        expect(
            clashes,
            `numéro(s) en double :\n  ${clashes.join("\n  ")}\n` +
                `  Geste : SUFFIXER la plus récente (48 → 48b), ne pas cascader tant que la ` +
                `cascade traverse du travail non committé.`
        ).toEqual([]);
    });

    it(`tient le plafond de ${CAP} entrées`, () => {
        const entries = readEntries();
        expect(
            entries.length,
            `${entries.length} entrées pour un plafond de ${CAP}. Geste : sortir les plus ` +
                `anciennes vers ~/dev/archives-geoleaf-js/JOURNAL-AAAA-MM.md — HORS du dépôt, ` +
                `la rotation ne range pas dans git.`
        ).toBeLessThanOrEqual(CAP);
    });
});
