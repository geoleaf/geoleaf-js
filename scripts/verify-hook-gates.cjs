#!/usr/bin/env node
/**
 * verify-hook-gates.cjs — the `pre-commit` hook's oracle: each gate, PLAYED or SKIPPED.
 *
 * 🛑 **Why this instrument exists, and why it did not.** The hook launches nineteen
 * commands. The nineteenth — `verify-consumer-contract.cjs` — **skips at every
 * commit** on this machine, for lack of `GEOLEAF_CONSUMERS` in the hook's
 * environment, while the same gate BITES under `ci:local`. The difference is not
 * the gate, it is the calling environment. It announces it — correct behaviour —
 * but **nothing rendered the overview**: nineteen outputs scroll by, and nobody
 * knows which one actually read something.
 *
 * ⚠️ A verdict that cannot be re-measured does not go stale: it fossilises. That is
 * what is repaired here.
 *
 * ## The four assertions, and what each catches
 *
 * ✅ **HOOK-01 — the list is DERIVED from the hook, never copied.** Non-empty
 *    (floor), and each named script exists on disk. A hard list would stop
 *    matching after a hook refactor: it would find zero gates, declare them all
 *    played, and go green.
 *
 * ✅ **HOOK-02 — BOTH hook branches declare the same list.** Each gate is written
 *    TWICE there: once behind the WSL trampoline (Windows workstation on a
 *    UNC-mounted repo), once natively. Nothing compared the two. A gate added to a
 *    single branch **skips silently for a whole platform** — the costliest form of
 *    the defect this instrument measures, because it is invisible from the
 *    platform that works.
 *
 * ✅ **HOOK-03 — the skip vocabulary still BITES.** `--run`'s classification rests
 *    on a marker printed by the skipping gate. If that marker is reworded, `--run`
 *    would class as "played" a gate that read nothing, and render a green more
 *    reassuring than reality. Each emitter is therefore named, with the literal it
 *    must still carry.
 *
 * ✅ **HOOK-04 (`--run`) — the oracle proper.** Executes the hook's verdict gates
 *    and classes each: played, skipped (named motive), or SKIPPED IN SILENCE.
 *    Exits 1 on a red gate or a silent skip.
 *
 * ## 🖐 What this instrument does NOT settle
 *
 * It does not say whether the 19th gate MUST bite at commit. Making
 * `verify-consumer-contract.cjs` blocking in the hook would make it depend on a
 * file **outside the repo**, usually in `M` state downstream: a hook that reddens
 * because another project's file moved gets disabled within the week, and
 * `--no-verify` would disarm the eighteen others with it. It is an arbitration,
 * not a fix, and it belongs to Mattieu. This instrument makes it VISIBLE, the
 * condition for settling it — not the settling.
 *
 * ## ⚠️ Why the oracle is a SEPARATE script and not a summary added to the hook
 *
 * The hook holds through `set -e`: without it, only the LAST command's exit code
 * counts, and ten of the eleven gates of the time were decorative. Capturing each
 * gate's output to classify it would require command substitution — which
 * **neutralises `set -e`** on the captured command. The instrument measuring the
 * hook must not start by disarming it.
 *
 * Usage :
 *   node scripts/verify-hook-gates.cjs          # HOOK-01…03, static, instant
 *   node scripts/verify-hook-gates.cjs --run    # + HOOK-04: plays the gates and classes them
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const HOOK = path.join(ROOT, ".husky", "pre-commit");
const RUN = process.argv.includes("--run");

const C = {
    r: "\x1b[31m",
    g: "\x1b[32m",
    y: "\x1b[33m",
    c: "\x1b[36m",
    d: "\x1b[2m",
    x: "\x1b[0m",
};

/**
 * Non-emptiness floor. Well below the day's reading (18 scripts), on purpose: it
 * catches "the pattern no longer matches anything", not "the hook lost a gate" —
 * that second question belongs to HOOK-02 and review, not a threshold.
 */
const PLANCHER = 12;

/**
 * Hook commands that render NO verdict, with the motive for which `--run` does not
 * execute them. They are listed in the report: a silent omission would suggest the
 * hook carries two gates fewer than it does.
 */
const NON_VERDICT = {
    "generate-docs-tree.cjs":
        "PRODUCTEUR — il écrit l'arbre qualifié puis le `git add`. L'exécuter hors commit modifierait l'index.",
    "npx lint-staged":
        "FORMATEUR — il réécrit les fichiers indexés. Hors d'un commit il n'a rien à traiter.",
};

/**
 * The sources that EMIT a skip marker, and the literal each must still carry.
 *
 * Itemised, not derived: the marker is printed by a library
 * (`lib/consumer-manifest`), not by the hook gate that loads it — a sweep of the
 * gate's file alone would not see it. Adding a skip-capable gate is a two-place
 * gesture, deliberately.
 */
const EMETTEURS_DE_SAUT = [
    {
        fichier: "scripts/lib/consumer-manifest.cjs",
        litteraux: ["⏭️", "SAUTÉ"],
        gate: "verify-consumer-contract.cjs",
        pourquoi:
            "CC-00 saute quand `GEOLEAF_CONSUMERS` n'est pas défini — attendu sur le clone public, HÉRITÉ SANS INTENTION dans le hook de ce poste",
    },
];

/**
 * The skip marker is STRUCTURAL — a line that STARTS with `⏭` — not lexical.
 *
 * 🛑 **The first version looked for the words "SAUTÉ", "SAUTE", "SKIP" anywhere in
 * the output, and it was WRONG.** Proven in both directions on 2026-08-23:
 * `verify-consumer-contract.cjs`, launched WITH `GEOLEAF_CONSUMERS`, BITES — it
 * reads a manifest — yet it was classed "SKIPPED", because its CC-10 note contains
 * the sentence "there `GEOLEAF_CONSUMERS` is not defined and this gate SKIPS". A
 * gate that TALKS about skipping is indistinguishable, to a lexical pattern, from
 * a gate that skips.
 *
 * ⚠️ The defect would not have been seen by a one-direction check: without a
 * manifest the classification was right, and that is the case one spontaneously
 * proves. Same lesson as `probe-gate-visibility.cjs`'s header — "the probe was
 * wrong, not the gate" — and it holds for the instrument written here.
 */
const MARQUEUR_SAUT = /^\s*⏭/;

const echecs = [];
const notes = [];

// ─── HOOK-01 — the list, derived from the hook ────────────────────────────────

/**
 * The hook's commands, in order, derived from its NATIVE branch.
 *
 * @returns {{ ordre: string[], scripts: string[] }} `ordre` carries the 19 commands
 *          as written; `scripts` keeps only the `scripts/*.cjs`.
 */
function listerBrancheNative(src) {
    const ordre = [];
    for (const ligne of src.split("\n")) {
        const m = /^\s*(npx lint-staged|node (scripts\/[\w.-]+\.cjs)(.*))\s*$/.exec(ligne);
        if (!m) continue;
        ordre.push(m[1].replace(/\s*>\/dev\/null\s*$/, "").trim());
    }
    return {
        ordre,
        scripts: ordre.filter((c) => c.startsWith("node ")).map((c) => c.split(/\s+/)[1]),
    };
}

/** The scripts named in the TRAMPOLINE (WSL) branch, for HOOK-02's symmetry. */
function listerBrancheWsl(src) {
    const out = [];
    const re = /ROOT_WSL\\" && node (scripts\/[\w.-]+\.cjs)/g;
    let m;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
    return out;
}

if (!fs.existsSync(HOOK)) {
    console.error(`${C.r}✗ [HOOK-01]${C.x} .husky/pre-commit est introuvable — rien à mesurer.`);
    process.exit(1);
}
const SRC = fs.readFileSync(HOOK, "utf8");
const { ordre, scripts } = listerBrancheNative(SRC);
const wsl = listerBrancheWsl(SRC);

if (ordre.length < PLANCHER) {
    echecs.push(
        `[HOOK-01] ${ordre.length} commande(s) dérivée(s) du hook, plancher ${PLANCHER}. ` +
            `Le motif de dérivation ne mord plus : il rendrait « tout joué » sur un hook qu'il ne lit plus.`
    );
}
const absents = scripts.filter((s) => !fs.existsSync(path.join(ROOT, s)));
if (absents.length > 0) {
    echecs.push(
        `[HOOK-01] ${absents.length} gate(s) du hook nomment un script qui n'existe pas :\n` +
            absents.map((s) => `      ${s}`).join("\n")
    );
}

// ─── HOOK-02 — both branches declare the same list ────────────────────────────

const setNatif = [...new Set(scripts)].sort();
const setWsl = [...new Set(wsl)].sort();
const natifSeul = setNatif.filter((s) => !setWsl.includes(s));
const wslSeul = setWsl.filter((s) => !setNatif.includes(s));
if (natifSeul.length > 0 || wslSeul.length > 0) {
    echecs.push(
        `[HOOK-02] les deux branches du hook DIVERGENT — une gate présente d'un seul côté saute\n` +
            `      EN SILENCE pour la plateforme qui prend l'autre branche :\n` +
            natifSeul
                .map((s) => `      • ${s} — natif seulement (perdue sur Windows/UNC)`)
                .join("\n") +
            (natifSeul.length && wslSeul.length ? "\n" : "") +
            wslSeul
                .map((s) => `      • ${s} — trampoline WSL seulement (perdue sur Linux/CI)`)
                .join("\n")
    );
}

// ─── HOOK-03 — the skip vocabulary still bites ────────────────────────────────

for (const e of EMETTEURS_DE_SAUT) {
    const abs = path.join(ROOT, e.fichier);
    if (!fs.existsSync(abs)) {
        echecs.push(
            `[HOOK-03] ${e.fichier} a disparu — le marqueur de saut de ${e.gate} n'a plus d'émetteur.`
        );
        continue;
    }
    const src = fs.readFileSync(abs, "utf8");
    const manquants = e.litteraux.filter((l) => !src.includes(l));
    if (manquants.length > 0) {
        echecs.push(
            `[HOOK-03] ${e.fichier} ne porte plus ${manquants.map((l) => `« ${l} »`).join(" ni ")} — ` +
                `le classement de --run rendrait « jouée » une gate qui n'a rien lu.`
        );
    }
}

// ─── The classification, and its witness ──────────────────────────────────────

/**
 * Classes a gate from its BARE output and return code.
 *
 * Pure function, which is what lets HOOK-05 prove it on known-answer witnesses
 * rather than the day's environment — which does not exist on the public clone.
 *
 * @param {string} sortie Merged output, ANSI-stripped, already trimmed.
 * @param {number|null} code Process return code.
 * @returns {{ etat: "rouge"|"silence"|"sautee"|"jouee", detail: string }}
 */
function classer(sortie, code) {
    if (code !== 0) return { etat: "rouge", detail: `exit ${code}` };
    if (sortie === "") return { etat: "silence", detail: "exit 0 sans rien imprimer" };
    const l = sortie.split("\n").find((x) => MARQUEUR_SAUT.test(x));
    if (l) return { etat: "sautee", detail: l.trim().slice(0, 100) };
    return { etat: "jouee", detail: sortie.split("\n")[0].slice(0, 80) };
}

// ─── HOOK-05 — the classification is proven on known-answer witnesses ─────────

const TEMOINS = [
    {
        quoi: "la ligne de saut réelle de CC-00",
        sortie: "⏭️  [CONSUMER-CONTRACT/CC-00] SAUTÉ — le crochet `GEOLEAF_CONSUMERS` n'est pas défini.",
        code: 0,
        attendu: "sautee",
    },
    {
        quoi: "une gate qui MORD en PARLANT du saut (le faux positif du 23/08/2026)",
        sortie:
            "── 🔁 Contrat inverse : ce dont l'aval dépend a-t-il disparu ? ──\n" +
            "📄 [CONSUMER-CONTRACT] 1 manifeste(s) lu(s)\n" +
            "   [CC-10] Aucune gate du clone public ne verra cette dérive : là-bas `GEOLEAF_CONSUMERS`\n" +
            "   n'est pas défini et cette gate SAUTE.",
        code: 0,
        attendu: "jouee",
    },
    { quoi: "une gate muette", sortie: "", code: 0, attendu: "silence" },
    { quoi: "une gate qui mord", sortie: "✗ [XX-01] 3 violations", code: 1, attendu: "rouge" },
];

for (const t of TEMOINS) {
    const rendu = classer(t.sortie, t.code).etat;
    if (rendu !== t.attendu) {
        echecs.push(
            `[HOOK-05] témoin « ${t.quoi} » classé « ${rendu} », attendu « ${t.attendu} » — ` +
                `le classement de --run ne dit plus la vérité.`
        );
    }
}

// ─── HOOK-04 — play the gates and class them ──────────────────────────────────

/**
 * Strips ANSI sequences, so "printed nothing" is not fooled by colour.
 *
 * ⚠️ The pattern is CONSTRUCTED, not literal: `ESLint no-control-regex` refuses a
 * control character in a literal regex, and it is right to by default. Disarming
 * it for a case where escaping is the very subject would be an unmotivated rule
 * lowering — the form the repo forbids by name.
 */
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const nu = (s) => s.replace(ANSI, "").trim();

const lignes = [];
if (RUN) {
    for (const cmd of ordre) {
        const nom = cmd.startsWith("node ") ? cmd.slice(5) : cmd;
        const cle = cmd.startsWith("node ") ? path.basename(cmd.split(/\s+/)[1]) : cmd;
        if (NON_VERDICT[cle]) {
            lignes.push({ nom, etat: "non-verdict", detail: NON_VERDICT[cle] });
            continue;
        }
        const argv = cmd.split(/\s+/).slice(1);
        const r = spawnSync("node", argv, { cwd: ROOT, encoding: "utf8" });
        lignes.push({ nom, ...classer(nu(`${r.stdout || ""}${r.stderr || ""}`), r.status) });
    }
    const rouges = lignes.filter((l) => l.etat === "rouge");
    const silences = lignes.filter((l) => l.etat === "silence");
    if (rouges.length > 0) {
        echecs.push(
            `[HOOK-04] ${rouges.length} gate(s) du hook sont ROUGES :\n` +
                rouges.map((l) => `      ${l.nom} — ${l.detail}`).join("\n")
        );
    }
    if (silences.length > 0) {
        echecs.push(
            `[HOOK-04] ${silences.length} gate(s) sortent 0 SANS RIEN DIRE — indiscernables d'une\n` +
                `      gate qui a réellement vérifié quelque chose :\n` +
                silences.map((l) => `      • ${l.nom}`).join("\n")
        );
    }
    for (const l of lignes.filter((x) => x.etat === "sautee")) {
        notes.push(`${l.nom} SAUTE — ${l.detail}`);
    }
}

// ─── Rapport ──────────────────────────────────────────────────────────────────

console.log(`${C.c}── HOOK-GATES — ce que le hook pre-commit joue réellement ──${C.x}`);
console.log(
    `  ${ordre.length} commande(s) dérivée(s) de .husky/pre-commit · ` +
        `${setNatif.length} script(s) distinct(s) · les deux branches ${natifSeul.length + wslSeul.length === 0 ? "s'accordent" : "DIVERGENT"}`
);

if (RUN) {
    const tag = {
        jouee: `${C.g}jouée   ${C.x}`,
        sautee: `${C.y}SAUTÉE  ${C.x}`,
        silence: `${C.r}SILENCE ${C.x}`,
        rouge: `${C.r}ROUGE   ${C.x}`,
        "non-verdict": `${C.d}—       ${C.x}`,
    };
    console.log("");
    for (const l of lignes) {
        console.log(`  ${tag[l.etat]} ${l.nom.padEnd(48)} ${C.d}${l.detail}${C.x}`);
    }
    const n = (e) => lignes.filter((l) => l.etat === e).length;
    console.log(
        `\n  ${n("jouee")} jouée(s) · ${n("sautee")} sautée(s) avec motif · ` +
            `${n("silence")} sautée(s) EN SILENCE · ${n("rouge")} rouge(s) · ${n("non-verdict")} hors verdict`
    );
} else {
    console.log(`  ${C.d}statique — ajouter --run pour classer chaque gate jouée / sautée${C.x}`);
}

for (const nt of notes) console.log(`  ${C.y}NOTE${C.x} ${nt}`);

if (echecs.length > 0) {
    console.error("");
    for (const e of echecs) console.error(`${C.r}✗${C.x} ${e}`);
    process.exit(1);
}
console.log(`${C.g}✓ HOOK-GATES${C.x} — aucune gate du hook ne saute en silence.`);
