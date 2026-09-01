#!/usr/bin/env node
/**
 * PUB — is what the registry carries still what this repo says it is?
 *
 * ## The direction nothing covered
 *
 * `check-versions.cjs` never contacts the registry: all its invariants are intra-repo. And
 * the doctrine in `CLAUDE.md` §Packages names only ONE of the two directions — "their gap
 * reopens at the first `version` bumped without a publication". That direction is loud: a
 * publish fails, or `npm view` disagrees, and someone notices.
 *
 * The other direction is silent, and it is the dangerous one: **the version stays put while
 * the publishable content moves.** Every commit touching a published package widens it, and
 * an integrator running `npm install` gets a tarball that no longer matches the repo at the
 * same version number — with every gate green, because none of them looked.
 *
 * ## What it compares, and what it deliberately does not
 *
 * Contents, never tarballs: gzip and mtimes are not reproducible, so a byte comparison of
 * two archives says nothing. `npm pack --dry-run` resolves exactly what a publish would send;
 * the published tarball is fetched and extracted; both sides are hashed file by file.
 *
 * Three classes come out of that, and conflating them would make the gate unusable:
 *
 *   - **source** — `src/`, `README.md`, `LICENSE`, anything authored. THIS is the subject.
 *   - **dist** — derived. Its bytes depend on the toolchain version at publish time, so two
 *     identical sources legitimately yield different output months apart. Counted, printed,
 *     never judged.
 *   - **package.json** — npm REWRITES it at publish (it materialises workspace dependency
 *     ranges, and drops keys it does not know). It differs on every package, always, and it
 *     would drown the signal. Counted, printed, never judged.
 *
 * ⚠️ A package that ships no `src/` (`@geoleaf/core`: `files: ["dist/", …]`) has almost no
 * source surface here. The gate says so per package rather than reporting a quiet zero.
 *
 * ## Why a RATCHET and not a red
 *
 * Measured the day this gate was written: **13 published packages, 13 diverged** — 264 source
 * files in total, from a README row to whole translated test suites. A gate that reddened on
 * that state would be red on its first run and disarmed within the week; this repo has
 * measured that outcome more than once.
 *
 * So the baseline freezes the divergence that already exists, and the gate blocks on what is
 * NEW. The debt is visible, named per package, and can only shrink — which is exactly what
 * "make it visible" was asking for. Remedy for any entry: bump the version and publish.
 *
 * ## Codes
 *
 *   PUB-00  SKIP, explicit and named — no registry access, or a package not built.
 *   PUB-01  NOTE — repo version ≠ registry version. A legitimate state (bumped, awaiting
 *           publication, or never published). Named, never red.
 *   PUB-02  RED — a package diverges at an EQUAL version and is not in the baseline.
 *   PUB-03  RED — a baseline entry that no longer diverges. A negative list holding a
 *           falsehood gets ignored wholesale, so it is an error until removal (the invariant
 *           of CC-05 and MH-02, and their wording on purpose).
 *
 * Usage:
 *   node scripts/verify-published-parity.cjs
 *   node scripts/verify-published-parity.cjs --update-baseline
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const registry = require("./lib/packages.cjs");
const {
    alreadyPublished,
    publishedFileHashes,
    localFileHashes,
} = require("./lib/npm-registry.cjs");

const TAG = "PUB";
const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };
const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(ROOT, "scripts", ".baselines", "published-parity.json");
const UPDATE = process.argv.includes("--update-baseline");

/** `dist/**` and `package.json` are derived or rewritten — see the header. */
function classify(rel) {
    if (rel === "package.json") return "pkgjson";
    return rel.startsWith("dist/") ? "dist" : "source";
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoleaf-pub-"));
const notes = [];
const errors = [];
const measured = {};
let unreachable = 0;
let compared = 0;

console.log(`${C.d}── ${TAG} — le registre porte-t-il encore ce que le dépôt dit ? ──${C.x}`);

try {
    for (const pkg of registry.all()) {
        if (pkg.private) continue;
        const { name, version } = pkg.manifest;

        if (!alreadyPublished(name, version)) {
            notes.push(
                `[PUB-01] ${name} — le dépôt déclare ${version}, que le registre ne porte pas. ` +
                    `Version bumpée en attente de publication, ou paquet jamais publié : ` +
                    `les deux sont légitimes, et c'est la direction que la doctrine nomme déjà.`
            );
            continue;
        }

        const published = publishedFileHashes(name, version, tmpRoot);
        if (published === null) {
            unreachable++;
            continue;
        }
        const local = localFileHashes(pkg.absDir);
        if (local === null || local.size === 0) {
            notes.push(
                `[PUB-00] ${name} — \`npm pack --dry-run\` n'a rien rendu : le paquet n'est ` +
                    `pas construit. Ce n'est PAS un vert — rien n'a été comparé.`
            );
            continue;
        }

        compared++;
        const seen = new Set([...local.keys(), ...published.keys()]);
        const diverged = { source: [], dist: 0, pkgjson: 0 };
        for (const rel of seen) {
            if (local.get(rel) === published.get(rel)) continue;
            const cls = classify(rel);
            if (cls === "source") diverged.source.push(rel);
            else diverged[cls]++;
        }
        diverged.source.sort();
        measured[name] = { version, source: diverged.source.length, files: diverged.source };

        const shipsSource = [...local.keys()].some((f) => f.startsWith("src/"));
        const surface = shipsSource ? "" : " (ne publie pas `src/` — surface source réduite)";
        const mark = diverged.source.length > 0 ? `${C.y}⚠${C.x}` : `${C.g}✓${C.x}`;
        console.log(
            `  ${mark} ${name.padEnd(32)} ${version.padEnd(7)} ` +
                `source:${String(diverged.source.length).padStart(3)} · ` +
                `${C.d}dist:${diverged.dist} pkgjson:${diverged.pkgjson}${C.x}${surface}`
        );
    }
} finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
}

// ── PUB-00 — the skip must be LOUD, and it must be the whole run's verdict ────────────────
//
// A gate whose network was down and which prints a green tick is indistinguishable from one
// that compared everything. `verify-consumer-contract.cjs` learned this the same way: it says
// what it did not read, and exits 0 without claiming anything.
if (compared === 0) {
    console.log(
        `⏭️  [${TAG}/PUB-00] SAUTÉ — aucun paquet n'a pu être confronté au registre ` +
            `(${unreachable} téléchargement(s) en échec).\n` +
            `    Ce n'est pas un vert : hors ligne, ou sans accès au registre npm, cette gate ` +
            `ne peut rien\n    établir. Sur le dépôt public c'est le comportement attendu.`
    );
    process.exit(0);
}
if (unreachable > 0) {
    notes.push(
        `[PUB-00] ${unreachable} paquet(s) non téléchargeable(s) — non comparés, donc ni verts ` +
            `ni rouges. Un réseau intermittent suffit ; relancer avant de conclure.`
    );
}

// ── The baseline writer ───────────────────────────────────────────────────────────────────
if (UPDATE) {
    const frozen = {};
    for (const [name, m] of Object.entries(measured)) {
        if (m.source > 0) frozen[name] = { version: m.version, source: m.source };
    }
    fs.writeFileSync(
        BASELINE,
        JSON.stringify(
            {
                _comment:
                    "Divergences GELÉES entre le dépôt et le tarball publié, à version ÉGALE. " +
                    "Cette liste ne peut que RÉTRÉCIR : y ajouter une entrée à la main est le " +
                    "geste qui désarme la gate. Le remède d'une entrée est de bumper la version " +
                    "et de publier — pas de la re-geler.",
                _generated: "node scripts/verify-published-parity.cjs --update-baseline",
                packages: frozen,
            },
            null,
            4
        ) + "\n"
    );
    console.log(
        `${C.g}✅${C.x} [${TAG}] baseline écrite — ${Object.keys(frozen).length} paquet(s) ` +
            `divergent(s) gelé(s).`
    );
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    console.error(
        `\n${C.r}✘ ${TAG}${C.x} : baseline absente (${path.relative(ROOT, BASELINE)}). Sans ` +
            `elle, PUB-02 ne peut distinguer une divergence NEUVE d'une dette connue, et ` +
            `n'aurait rien cliqueté. Régénérez avec --update-baseline.\n`
    );
    process.exit(2);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")).packages ?? {};

// ── PUB-02 — entering ratchet ─────────────────────────────────────────────────────────────
for (const [name, m] of Object.entries(measured)) {
    if (m.source === 0) continue;
    const known = baseline[name];
    if (!known) {
        errors.push(
            `[PUB-02] ${name}@${m.version} — ${m.source} fichier(s) source divergent du ` +
                `tarball PUBLIÉ, à version ÉGALE, et le paquet n'est pas en baseline.\n` +
                `        Un intégrateur qui installe ${m.version} reçoit autre chose que ce ` +
                `dépôt. Bumper la version avant publication, ou expliquer l'écart.\n` +
                `        ${m.files.slice(0, 5).join(", ")}` +
                (m.files.length > 5 ? ` … +${m.files.length - 5}` : "")
        );
        continue;
    }
    if (m.source > known.source) {
        errors.push(
            `[PUB-02] ${name}@${m.version} — la divergence GROSSIT : ${known.source} → ` +
                `${m.source} fichier(s) source. Ce cliquet ne descend que ; la publication ` +
                `d'une version neuve est ce qui le remet à zéro.`
        );
    }
}

// ── PUB-03 — a stale baseline entry ───────────────────────────────────────────────────────
for (const [name, known] of Object.entries(baseline)) {
    const m = measured[name];
    if (m === undefined) continue; // not compared this run (PUB-00/PUB-01 said why)
    if (m.source === 0) {
        errors.push(
            `[PUB-03] ${name} est en baseline pour ${known.source} divergence(s) mais n'en a ` +
                `PLUS aucune. Retirez son entrée : une liste négative qui contient un faux se ` +
                `fait ignorer en bloc, donc c'est une erreur jusqu'au retrait.`
        );
    }
}

for (const n of notes) console.log(`${C.d}   ${n}${C.x}`);

if (errors.length > 0) {
    console.error(`\n${C.r}✘ ${TAG}${C.x} : ${errors.length} violation(s) —\n`);
    for (const e of errors) console.error(`  • ${e}\n`);
    process.exit(1);
}

const dette = Object.values(measured).filter((m) => m.source > 0).length;
console.log(
    `${C.g}✓ ${TAG}${C.x} — ${compared} paquet(s) confronté(s) au registre ; ` +
        `${dette} en dette gelée, aucune divergence neuve.`
);
