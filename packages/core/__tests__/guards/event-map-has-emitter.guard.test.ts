/**
 * Guard EM-04 — every `GeoLeafEventMap` key has an EMITTER in the repo.
 *
 * ## Why this guard, and why it did not exist before
 *
 * Its order was constrained: "**after** the poi:click arbitration, never
 * before". The motive is mechanical — as long as `geoleaf:poi:click`'s fate
 * was unsettled, the invariant had no stable form: set earlier, it would
 * either have turned red on a key perhaps about to be wired, or exempted a
 * key perhaps about to be removed.
 *
 * 🛑 **The invariant as the roadmap states it — "every key has an emitter" —
 * is FALSE by construction since the arbitration of 17/08/2026**, which
 * retained leaving `geoleaf:poi:click` typed WITHOUT an emitter and
 * documenting it as such. Posing it literally would turn red at once on a
 * decision taken. The guard is therefore set with **a named exemption
 * carrying its motive** — the only form that stays true after the decision.
 *
 * ## What it catches, and what it does not
 *
 * ✅ A key ADDED to the map with nothing emitting it — the defect that took
 * three sprints to make visible, and ended with three documents asserting in
 * the present tense a subscription that never fires.
 *
 * ⚠️ It says NOTHING of the reciprocal: an emitted literal not in the map is
 * `EM-03`'s subject, and the two guards do not replace each other.
 *
 * ⚠️ It looks for the literal, so an emitter building its name by
 * concatenation would escape it. Owned: `EM-03` forbids precisely that form.
 *
 * 🛑 **THE CHARACTER CLASS INCLUDES UPPERCASE, AND THAT IS NOT DECORATIVE.**
 * This guard's first draft used `[a-z0-9:._-]` and yielded **SIX false
 * orphans** — all the camelCase keys (`geoleaf:table:selectionChanged`,
 * `…:exportSelection`, …) were truncated to their lowercase prefix, hence
 * never recognised as cited while `packages/plugins/table/src/` emits them.
 * **The guard carried exactly the blindness it measured** — the method
 * corollary `CLAUDE.md` states, met while writing it. Do not shrink this class.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "../../../..");
const CONTRACT = "packages/core/src/contracts/event-bus.contract.ts";

/**
 * Keys deliberately declared without an emitter. Every entry MUST carry its
 * motive and date: a motiveless exemption is indistinguishable from an
 * oversight six months later.
 */
const EXEMPTEES = new Map([
    [
        "geoleaf:poi:click",
        "Arbitrage du 17/08/2026 : la clé reste typée sans émetteur et c'est " +
            "DOCUMENTÉ comme tel. Le sous-système POI a été dissous au S9 ; les POI émettent " +
            "`geoleaf:feature:click`, avec plus d'information. La retirer serait une rupture sur " +
            "une carte publiée en 3.0.0.",
    ],
]);

/** The keys the map declares, read from DISK — never copied. */
function clesDeLaCarte(): string[] {
    const src = readFileSync(path.join(REPO, CONTRACT), "utf8");
    const i = src.indexOf("interface GeoLeafEventMap");
    expect(i, `\`interface GeoLeafEventMap\` introuvable dans ${CONTRACT}`).toBeGreaterThan(-1);
    const bloc = src.slice(i, src.indexOf("\n}", i));
    // A map key is a line-leading literal, followed by `:`.
    return [...new Set([...bloc.matchAll(/^\s*"(geoleaf:[^"]+)"\s*:/gm)].map((m) => m[1]))];
}

/** The literals cited ELSEWHERE than the contract — hence by emitting or calling code. */
function citesHorsContrat(): Set<string> {
    const out = execFileSync(
        "git",
        ["grep", "-hoE", '"geoleaf:[A-Za-z0-9:._-]+"', "--", "*.ts", "*.js", "*.mjs", "*.cjs"],
        { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    const horsContrat = execFileSync(
        "git",
        [
            "grep",
            "-hoE",
            '"geoleaf:[A-Za-z0-9:._-]+"',
            "--",
            "*.ts",
            "*.js",
            "*.mjs",
            "*.cjs",
            `:(exclude)${CONTRACT}`,
        ],
        { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    expect(
        out.length,
        "le balayage global n'a rien rendu — la garde ne garderait rien"
    ).toBeGreaterThan(0);
    return new Set(
        horsContrat
            .split("\n")
            .filter(Boolean)
            .map((l) => l.slice(1, -1))
    );
}

describe("EM-04 — toute clé de `GeoLeafEventMap` a un émetteur", () => {
    it("le corpus est non vide, des DEUX côtés", () => {
        const cles = clesDeLaCarte();
        expect(cles.length, "aucune clé lue : le motif ne mord plus sur la carte").toBeGreaterThan(
            30
        );
        expect(
            citesHorsContrat().size,
            "aucun littéral hors contrat : le balayage est cassé"
        ).toBeGreaterThan(30);
    });

    it("aucune clé déclarée n'est orpheline, hors exemptions nommées", () => {
        const cites = citesHorsContrat();
        const orphelines = clesDeLaCarte().filter((k) => !cites.has(k) && !EXEMPTEES.has(k));
        expect(
            orphelines,
            `Clé(s) déclarée(s) dans \`GeoLeafEventMap\` que RIEN n'émet : ${orphelines.join(", ")}.\n` +
                "S'y abonner ne déclenchera jamais rien. Soit brancher l'émetteur, soit inscrire la " +
                "clé dans EXEMPTEES **avec son motif et sa date** — jamais la laisser muette."
        ).toEqual([]);
    });

    it("toute exemption porte un motif, et la clé exemptée existe encore", () => {
        const cles = new Set(clesDeLaCarte());
        for (const [cle, motif] of EXEMPTEES) {
            expect(
                cles.has(cle),
                `\`${cle}\` est exemptée mais n'est plus dans la carte — exemption morte`
            ).toBe(true);
            expect(motif.length, `exemption sans motif : \`${cle}\``).toBeGreaterThan(80);
        }
    });
});
