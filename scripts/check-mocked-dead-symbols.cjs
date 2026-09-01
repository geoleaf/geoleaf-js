#!/usr/bin/env node
/**
 * check-mocked-dead-symbols.cjs — MDS-01…03: a suite does not DOUBLE a symbol no
 * source carries anymore.
 *
 * 🛑 **The class, and what it cost.** A test mounts a double on a member, calls
 * it, and verifies the double was called: **its oracle is its own fixture**. The
 * suite is green and attests an API that no longer exists. The founding case
 * lived **forty days** — `Config.getIconsConfig`, removed from the sources on
 * 2026-07-11, still mocked in two suites on 08-20 — while a neighbouring guard,
 * `extracted-features.guard`, proved its absence **by scanning `src/` and
 * skipping `__tests__`**. Two corpora, no link. This gate is that link.
 *
 * ## MDS-01 — the corpus is not empty
 *
 * Floors well below the day's reading (737 suites, 2,828 doubled keys). They
 * catch "the pattern no longer matches anything": a detector finding zero
 * symbols on zero files goes green, and it also goes green on a sick repo.
 *
 * ## MDS-02 — no NEW symbol, and the baseline can only DESCEND
 *
 * ⚠️ It is born **non-empty**, a choice: the landing survey carries 6
 * occurrences. Reddening on them would make the gate red at landing, hence
 * disarmed within the week — the motive that made `PARITY-13` notifying, and it
 * holds here. Each entry carries its reading verdict, because an unmotivated
 * baseline is indistinguishable from an oversight six months later.
 *
 * 🛑 **THREE of the four frozen symbols are REAL defects of the class**, read
 * one by one:
 *   · `initPOI` (3 suites) — the `vi.mock("src/app/init-features.js")` factory
 *     declares this export; it exists in NONE of the 930 sources. The POI
 *     subsystem was dissolved.
 *   · `loadProfile` —
 *     `expect(GL._GeoJSONLoader.loadProfile).toBe(mocks.LoaderProfile.loadProfile)`:
 *     **both sides of the `toBe` come from the fixture**. The assertion cannot
 *     fail.
 *   · `attachFilterInputEvents` — `expect(…).not.toHaveBeenCalled()` on a
 *     nonexistent member: **true by vacuity, forever**.
 * The fourth, `someOtherMethod`, is a deliberate fixture meaning "any other
 * method": assumed false positive, frozen with its motive.
 *
 * ⚠️ **They are FROZEN and not repaired, deliberately.** Rewiring an oracle onto
 * the source can make it redden **rightly** — that is the defect being hunted,
 * not a regression — and doing it in the same diff as the gate would make a
 * batch that proves nothing anymore. They are recorded as findings, and the
 * ratchet holds them.
 *
 * ## Two STOREYS, because the first was blind to a case the register NAMES
 *
 * **Storey 1** — doubled, treated as a MEMBER (`.name`), absent from every
 * source. The "the oracle is my fixture" form: the test calls the double and
 * asserts on it.
 *
 * **Storey 2** — member of a NAMESPACE literal (`Baselayers: { … }`), absent
 * from every source, **even if never asserted**. `Baselayers.setBaselayer` is
 * exactly that case: named in the register, mounted without being exercised, and
 * **invisible to storey 1**. An instrument blind to a known instance of its own
 * class is the defect called *the instrument carries the blindness it measures*.
 * Landing survey: 2, against ~60 if every literal were retained.
 *
 * ## MDS-03 — the detector still designates the case it was written for
 *
 * Proven on a witness COPIED INLINE, not on the real file: that one is fixed
 * since 2026-08-20, so reading it would prove nothing anymore. And a NEGATIVE
 * witness holds the other edge — a local alias must not be retained, without
 * which the survey goes from 6 to 68 and the gate becomes a false-positive
 * machine.
 *
 * Usage :
 *   node scripts/check-mocked-dead-symbols.cjs
 *   node scripts/check-mocked-dead-symbols.cjs --update-baseline   # ONLY to DESCEND
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const lib = require("./lib/mocked-symbols.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(ROOT, "scripts/.baselines/mocked-dead-symbols.json");
const UPDATE = process.argv.includes("--update-baseline");

const PLANCHER_SUITES = 400;
const PLANCHER_CLES = 1000;

const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };
const echecs = [];

const r = lib.scan();
const cle = (t) => `${t.symbole}@${t.fichier}`;
const releve = r.trouves.map(cle).sort();

console.log(`${C.d}── MDS — symboles doublés que plus aucune source ne porte ──${C.x}`);
console.log(
    `  ${r.tests} suite(s) · ${r.sources} source(s) · ${r.cles} clé(s) doublée(s) · ` +
        `${releve.length} retenue(s)`
);

// ── MDS-01 ────────────────────────────────────────────────────────────────────
if (r.tests < PLANCHER_SUITES || r.cles < PLANCHER_CLES) {
    echecs.push(
        `[MDS-01] corpus sous plancher — ${r.tests} suites (min ${PLANCHER_SUITES}), ` +
            `${r.cles} clés doublées (min ${PLANCHER_CLES}). Le motif ne mord plus : ` +
            `il rendrait « aucun symbole mort » sur un dépôt qu'il ne lit plus.`
    );
}

// ── MDS-03 — the two witnesses ───────────────────────────────────────────────
const positif = lib.deadMockedSymbols(lib.TEMOIN_HISTORIQUE, () => false);
if (!positif.includes("getIconsConfig")) {
    echecs.push(
        `[MDS-03] le témoin HISTORIQUE n'est plus désigné (rendu : ${JSON.stringify(positif)}). ` +
            `Le détecteur ne voit plus le défaut pour lequel il a été écrit.`
    );
}
const TEMOIN_ALIAS = `
const h = vi.hoisted(() => ({ proximityInit: vi.fn() }));
vi.mock("../x.js", () => ({ FilterPanelProximity: { initProximityFilter: h.proximityInit } }));
expect(h.proximityInit).toHaveBeenCalled();
`;
const negatif = lib.deadMockedSymbols(TEMOIN_ALIAS, () => false);
const TEMOIN_NAMESPACE = `
globalThis.GeoLeaf = { Baselayers: { init: vi.fn(), setBaselayer: vi.fn() } };
`;
const etage2 = lib.deadNamespaceMembers(TEMOIN_NAMESPACE, (n) => n === "init");
if (!etage2.includes("Baselayers.setBaselayer")) {
    echecs.push(
        `[MDS-03] le témoin d'ÉTAGE 2 n'est plus désigné (rendu : ${JSON.stringify(etage2)}). ` +
            `C'est le cas que le registre NOMME et que l'étage 1 ne voit pas — monté, jamais asserté.`
    );
}
if (negatif.length !== 0) {
    echecs.push(
        `[MDS-03] le témoin NÉGATIF est retenu à tort (${JSON.stringify(negatif)}) — un alias ` +
            `local n'est pas un membre. Sans ce bord, le relevé passe de 6 à 68 et la gate se désarme.`
    );
}

// ── MDS-02 ────────────────────────────────────────────────────────────────────
if (UPDATE) {
    const actuel = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
    if (actuel && releve.length > actuel.count) {
        console.error(
            `${C.r}✗${C.x} [MDS-02] refus de MONTER la baseline : ${actuel.count} → ${releve.length}. ` +
                `Une baseline ne se régénère que pour DESCENDRE, après correction réelle (interdit I3).`
        );
        process.exit(1);
    }
    const out = {
        _comment:
            "MDS-02 — symboles doublés qu'AUCUNE source du registre ne porte, sur DEUX étages. Étage 1 : `{ nom: vi.fn() }` traité comme MEMBRE (`.nom`) et hors alias local — la forme « l'oracle est ma fixture ». Étage 2 : membre d'un littéral de NAMESPACE (`Baselayers: { … }`), même jamais asserté — l'étage 1 y est aveugle, et c'est là que vit `setBaselayer`, le cas que le registre NOMME. Cette liste ne peut que RÉTRÉCIR. ⚠️ CINQ des six symboles gelés à la pose sont de VRAIS défauts de la classe « oracle auto-référent » : `initPOI` (export déclaré par un facteur `vi.mock`, inexistant dans les 930 sources — sous-système POI dissous), `loadProfile` (les DEUX côtés d'un `toBe` viennent de la fixture), `attachFilterInputEvents` (`.not.toHaveBeenCalled()` vrai par vacuité), `Baselayers.setBaselayer` (RENOMMAGE — la façade porte `setBaseLayer`), `DOMSecurity.sanitizeText` (membre absent de toute source). Le sixième, `someOtherMethod`, est une fixture délibérée signifiant « n'importe quelle autre méthode » — faux positif assumé. ⚠️ Ils sont GELÉS et NON réparés, délibérément : rebrancher un oracle sur la source peut le faire rougir À JUSTE TITRE — c'est le défaut qu'on cherche, pas une régression — et le faire dans le diff qui pose la gate ferait un lot qui n'éprouve plus rien. `Baselayers.setBaselayer` porte en plus un 🖐 du registre : le rebrancher CHANGE ce que le test exerce.",
        _generated: "node scripts/check-mocked-dead-symbols.cjs --update-baseline",
        count: releve.length,
        entries: releve,
    };
    fs.writeFileSync(BASELINE, JSON.stringify(out, null, 4) + "\n");
    console.log(`${C.g}✓${C.x} baseline écrite — ${releve.length} entrée(s).`);
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    console.error(`${C.r}✗${C.x} [MDS-02] baseline absente — poser avec --update-baseline.`);
    process.exit(1);
}
const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const gelees = new Set(base.entries);
const neufs = releve.filter((e) => !gelees.has(e));
const partis = base.entries.filter((e) => !releve.includes(e));

if (neufs.length > 0) {
    echecs.push(
        `[MDS-02] ${neufs.length} symbole(s) NOUVEAU(X) doublé(s) sans exister en source :\n` +
            neufs.map((e) => `      + ${e}`).join("\n") +
            `\n\n      Une suite qui double un symbole absent de toute source atteste une API qui\n` +
            `      n'existe plus : son oracle est sa propre fixture, et elle restera verte. Rebrancher\n` +
            `      l'oracle sur la source. ⚠️ Le test peut alors rougir À JUSTE TITRE — c'est le défaut\n` +
            `      qu'on cherche, pas une régression : le consigner, ne pas remettre la fixture.`
    );
}
if (partis.length > 0) {
    console.log(
        `  ${C.g}${partis.length} entrée(s) de baseline ne se retrouvent plus${C.x} — resserrer :`
    );
    for (const e of partis) console.log(`      − ${e}`);
    console.log(`      ${C.d}node scripts/check-mocked-dead-symbols.cjs --update-baseline${C.x}`);
}

if (echecs.length > 0) {
    console.error("");
    for (const e of echecs) console.error(`${C.r}✗${C.x} ${e}`);
    process.exit(1);
}
console.log(
    `${C.g}✓ MDS${C.x} — aucun symbole mort nouvellement doublé ` +
        `(${gelees.size} gelé(s), témoins positif et négatif tenus).`
);
