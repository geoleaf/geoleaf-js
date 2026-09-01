/**
 * @file registry-crossrefs.guard.test.ts
 * @description Guard test — a `B-nnn`/`D-nn` reference in the registers
 * points to a section that exists, or it is frozen.
 *
 * Why this guard exists
 * ------------------------------------------------------------------------------------
 * Since 18/08/2026, a settled line is **removed** from its register — no
 * longer struck through there. The convention is good: a register two thirds
 * struck through no longer reads. But it has a side effect **nothing**
 * guarded: the prose citing the line stays in place and now points to an
 * absent section.
 *
 * Measured on 21/08/2026 — the backlog's lead callout, the only one read
 * BEFORE deciding what to open, named in the present tense four lines
 * removed three days earlier, including **three security proofs**. A
 * good-faith reader reopened work that no longer existed. The same day, an
 * open line referred in its body to a line settled that very morning.
 *
 * 🛑 **And the symmetric defect is worse**: a register two closures behind is
 * indistinguishable, at grep, from a register two openings ahead. Both yield
 * the same gap, and only the second reading makes one reopen work already
 * done — the mistake made while instructing this very guard.
 *
 * `check-dead-links` could do nothing: its ten scopes are all public docs,
 * `_docs_projet/` is not among them. No gate read these files.
 *
 * ## The two tiers, and why the second does not turn red
 *
 * ✅ **RX-01, blocking — the POINTERS.» `voir B-nnn`, `cf. B-nnn`, `Dépend de
 *    B-nnn`, `→ B-nnn`, the definition bullet `- **B-nnn** — …`. The form
 *    says the reader must go look; if the target does not exist, they follow
 *    an arrow into the void.
 * ✅ **RX-02, frozen — the MENTIONS.» Any other reference. "Derived from
 *    B-nnn, settled the same day" is right and self-sufficient; "B-nnn is
 *    exercised by nothing" is not. **Both have the same shape**, and no
 *    machine separates them. The corpus carries 111 at the pose: turning red
 *    on them would make this guard permanently red, hence disarmed within
 *    the week — the motive that made `PARITY-13` notifying, and it holds here.
 *
 * The freeze is **itemised by identifier**, not counted: it catches what
 * matters, a **newly removed** identifier whose prose did not follow. The
 * real defect, observed twice.
 *
 * ## 🖐 What this guard does NOT say
 *
 * Nothing about a sentence's **truth**. "B-nnn carries 18 tails" on a line
 * carrying only 3 resolves perfectly and stays false. This guard verifies an
 * arrow leads somewhere, never that what is read there is true.
 *
 * ## ⚠️ Why this guard SKIPS on the public clone
 *
 * `_docs_projet/` is working apparatus: `port-to-public.cjs`'s partition
 * never carries it into `geoleaf/geoleaf-js`. A guard requiring the files
 * would be permanently red there, for a reason that concerns nobody there.
 * It therefore skips **saying so**, on `journal-numbering.guard.test.ts`'s
 * pattern. The skip is riskless: the registers only exist in the workshop,
 * the only place the property can be false.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const requireCjs = createRequire(import.meta.url);

interface Pointer {
    file: string;
    line: number;
    id: string;
    form: string;
    text: string;
}
interface CrossRefs {
    registriesPresent(): boolean;
    scan(): {
        known: Set<string>;
        pointers: Pointer[];
        mentions: { file: string; line: number; id: string }[];
        resolvedPointers: number;
        calloutCitations: number;
        perFile: Record<string, number>;
        keys: string[];
    };
    calloutZoneWitness(): { file: string; callout: number; prose: number; zone: string }[];
    patternWitnesses(): { form: string; sample: string; matched: boolean }[];
    readBaseline(): { count: number; entries: string[] };
}

const lib: CrossRefs = requireCjs("../../../../scripts/lib/registry-crossrefs.cjs");
const present = lib.registriesPresent();

describe.skipIf(!present)("REGISTRY-CROSSREFS — les renvois internes des registres", () => {
    it("RX-00 — le corpus n'est pas vide, et les motifs de pointeur MORDENT encore", () => {
        const { known, pointers, mentions, resolvedPointers } = lib.scan();

        expect(
            known.size,
            `aucune section reconnue dans les registres — la forme des titres a changé et ce ` +
                `garde ne résout plus rien. Re-pointer le motif, ne pas le neutraliser.`
        ).toBeGreaterThan(0);

        expect(
            pointers.length + mentions.length + resolvedPointers,
            `aucun renvoi relevé — le découpage en zones a dérivé et le corpus est vide. ` +
                `Une gate qui ne lit rien sort verte.`
        ).toBeGreaterThan(0);

        // 🛑 Corpus membership is declared HERE, and it is deliberately a
        // DUPLICATE of `CORPUS`: the test states the contract, the module the
        // implementation. Without the duplicate, removing a file from
        // `CORPUS` only turns the ratchet red, by ricochet — and
        // `--update-baseline` would silence it. Proven: taking `CLAUDE.md`
        // out left five assertions green, including a first draft of this
        // one, which looked for files YIELDING ZERO — yet a removed file does
        // not appear at all, hence does not yield zero.
        const ATTENDUS = ["backlog_technique.md", "dette_technique.md", "CLAUDE.md"];
        const perFile = lib.scan().perFile;
        const manquants = ATTENDUS.filter((f) => !(perFile[f] > 0));
        expect(
            manquants,
            `fichier(s) attendu(s) que la gate ne lit pas :\n  ${manquants.join("\n  ")}\n` +
                `  Soit le fichier est sorti de CORPUS, soit le découpage en zones l'avale ` +
                `entièrement. Dans les deux cas il n'est plus gardé. Relevé : ` +
                `${JSON.stringify(perFile)}`
        ).toEqual([]);

        // 🛑 The assertion that really matters. Without it, a broken pointer
        // pattern would leave RX-01 green searching for nothing any more —
        // exactly what happened to the first draft: `callout`s were classed
        // "code", so the header left the perimeter and the original defect's
        // three bullets were not seen.
        expect(
            resolvedPointers,
            `aucun pointeur RÉSOLU dans le corpus : les motifs de RX-01 ne reconnaissent plus ` +
                `aucune forme (« voir B-nnn », « Dépend de B-nnn », la puce de définition…). ` +
                `Le test suivant serait vert en ne cherchant rien.`
        ).toBeGreaterThan(0);
    });

    // 🛑 The two assertions below guard THE classification decision that made
    // this module miss the defect it is written for: a `callout` is PROSE.
    // Without them, reclassing it as "code" removes the registers' whole
    // header — the most-read zone — from the perimeter, and the four other
    // assertions stay GREEN on a shrunken corpus. Proven on that exact
    // mutation: only the ratchet turned red, by ricochet, and an
    // `--update-baseline` would have silenced it.
    it("RX-00 bis — la prose des `callout` est encore DANS le périmètre", () => {
        const witness = lib.calloutZoneWitness();
        expect(
            witness.length,
            `aucun bloc \`callout\` trouvé dans les registres — le témoin ne témoigne de rien.`
        ).toBeGreaterThan(0);

        const misread = witness.filter((w) => w.zone !== "live");
        expect(
            misread.map((w) => `${w.file}:${w.prose} classée « ${w.zone} »`),
            `la prose d'un \`callout\` est classée hors zone vive : le découpage traite les ` +
                `\`callout\` comme du code. C'est la régression qui rend ce garde aveugle à ` +
                `l'en-tête des registres — exactement là où le défaut d'origine vivait.`
        ).toEqual([]);

        expect(
            lib.scan().calloutCitations,
            `aucune citation relevée à l'intérieur d'un \`callout\` : le témoin structurel ` +
                `peut être vert et la chaîne complète muette quand même. Vérifier que ` +
                `scanFile retient bien ces lignes.`
        ).toBeGreaterThan(0);
    });

    // 🛑 The global resolved-pointer counter AGGREGATES: one form can stop
    // biting without moving it. The "status" form has by construction no
    // resolved witness in the corpus — every "open" assertion found there
    // bears on absent lines, its reason to exist — so it would be the first
    // to rot silently.
    it("RX-00 ter — chaque forme de pointeur reconnaît encore son exemple canonique", () => {
        const witnesses = lib.patternWitnesses();
        expect(
            witnesses.length,
            `aucune forme relevée — la table POINTERS est vide.`
        ).toBeGreaterThan(0);
        const mute = witnesses.filter((w) => !w.matched).map((w) => `${w.form} ← ${w.sample}`);
        expect(
            mute,
            `forme(s) de pointeur qui ne mordent plus sur leur propre exemple :\n  ${mute.join("\n  ")}\n` +
                `  RX-01 serait vert en ne cherchant plus cette forme. Réparer le motif, ` +
                `ou retirer la forme ET son exemple — jamais l'un sans l'autre.`
        ).toEqual([]);
    });

    it("RX-01 — aucun POINTEUR ne mène vers une section absente", () => {
        const { pointers } = lib.scan();
        const details = pointers.map(
            (p) => `${p.file}:${p.line} [${p.form}] → ${p.id} · ${p.text.slice(0, 100)}`
        );
        expect(
            details,
            `renvoi(s) pointant vers une section qui n'existe plus :\n  ${details.join("\n  ")}\n` +
                `  Geste : réécrire LA PHRASE, jamais retirer le jeton — chaque identifiant est ` +
                `enchâssé dans une phrase qui porte un motif, et retirer le jeton laisserait une ` +
                `phrase cassée là où retirer la phrase retirerait la raison. Si la ligne est ` +
                `soldée, le dire sur place ; son récit vit dans git log et JOURNAL.md.`
        ).toEqual([]);
    });

    it("RX-02 — aucune MENTION morte nouvelle par rapport au gel", () => {
        const { keys } = lib.scan();
        const frozen = new Set(lib.readBaseline().entries);
        const fresh = keys.filter((k) => !frozen.has(k));
        expect(
            fresh,
            `mention(s) morte(s) NEUVE(s) :\n  ${fresh.join("\n  ")}\n` +
                `  Une ligne vient d'être retirée et la prose qui la cite n'a pas suivi. ` +
                `Corriger la phrase ; ne geler que si la mention est un récit daté, juste ` +
                `et complet.`
        ).toEqual([]);
    });

    it("RX-03 — le gel ne porte AUCUNE entrée périmée (le cliquet descend)", () => {
        const { keys } = lib.scan();
        const live = new Set(keys);
        const stale = lib.readBaseline().entries.filter((k) => !live.has(k));
        expect(
            stale,
            `entrée(s) du gel qui ne désignent plus rien :\n  ${stale.join("\n  ")}\n` +
                `  C'est une BONNE nouvelle — la prose a été corrigée. Geste : ` +
                `node scripts/lib/registry-crossrefs.cjs --update-baseline`
        ).toEqual([]);
    });
});
