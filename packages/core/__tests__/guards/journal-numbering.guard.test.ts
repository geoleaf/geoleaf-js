/**
 * @file journal-numbering.guard.test.ts
 * @description Test-garde — les numéros d'entrée du JOURNAL sont UNIQUES, et le plafond
 * de 15 entrées est tenu.
 *
 * Pourquoi ce garde existe — et pourquoi c'est le JOURNAL lui-même qui le réclame
 * ------------------------------------------------------------------------------------
 * Le numéro d'entrée est un **compteur partagé** entre sessions concurrentes, et il a
 * collisionné **deux fois** :
 *
 *   • (42), le 07/08/2026 — deux entrées du même numéro, chacune ayant lu le sommet du
 *     fichier avant que l'autre n'écrive. Réparée par cascade : deux renumérotations.
 *   • (48), quelques jours plus tard — **pendant que l'en-tête du fichier expliquait déjà
 *     le geste qui l'évite**. Réparée par suffixe (`48b`), la cascade coûtant dix entrées.
 *
 * 🛑 **La seconde est restée invisible plusieurs jours**, et le fichier dit exactement
 * pourquoi : « rien ne compte les numéros, et deux `## 2026-08-07 (48)` à cinquante lignes
 * d'écart ne se voient pas à la lecture ». Elle a été trouvée **en comptant les entrées
 * pour la rotation**, pas en lisant.
 *
 * Son en-tête tire lui-même la conclusion : _« si un jour rien ne bloque, préférer une
 * garde qui COMPTE les numéros à un troisième paragraphe qui demande d'y faire
 * attention »_. Rien ne bloquait au 12/08/2026 : ce fichier est cette garde. Deux
 * avertissements en prose n'ont arrêté ni la première collision ni la seconde.
 *
 * ## Ce qui est gardé, et ce qui ne l'est pas
 *
 * ✅ **Unicité** — un numéro vu deux fois fait rougir, en nommant les deux dates.
 * ✅ **Plafond** — plus de 15 entrées fait rougir avec le geste (la rotation).
 * 🖐 **PAS l'ordre** : la lecture est antéchronologique et la suite peut être non entière
 *    (`48`, `48b`, `49`), ce qui est le remède retenu et non un défaut. Exiger une
 *    croissance stricte rougirait sur la réparation elle-même.
 *
 * ## ⚠️ Pourquoi ce garde SAUTE sur le clone public, et pourquoi ce n'est pas un trou
 *
 * `_docs_projet/` est de l'appareil d'atelier : la partition de `port-to-public.cjs` ne le
 * porte jamais dans `geoleaf/geoleaf-js`. Un garde qui exigerait le fichier y serait rouge
 * en permanence — et rendrait la suite publique rouge pour une raison qui ne regarde
 * personne là-bas. Il saute donc **en le disant**, sur le même patron que
 * `docs-paths.internalRootExists()`.
 *
 * Le saut est sans risque ici : le JOURNAL n'existe que dans l'atelier, donc l'atelier est
 * le seul endroit où la propriété puisse être fausse.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../..");
const JOURNAL = path.join(REPO_ROOT, "_docs_projet", "JOURNAL.md");

/** Le plafond, tel que l'en-tête du JOURNAL le déclare. */
const CAP = 15;

/** Une entrée : sa date, son numéro (suffixe compris), sa ligne. */
interface Entry {
    date: string;
    num: string;
    line: number;
}

/**
 * Les entrées du JOURNAL, dans l'ordre du fichier (antéchronologique).
 *
 * Aucun repli silencieux sur un tableau vide : un fichier présent mais dont la forme des
 * titres aurait changé rendrait ce garde vert en ne comptant rien — le mode d'échec que
 * ce dépôt traque partout. D'où l'assertion anti-corpus-vide dans le premier test.
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
