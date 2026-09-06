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
 *           of CC-05 and MH-02, and their wording on purpose). Asked PER DIMENSION.
 *   PUB-04  RED — a declaration this repo would ship is ABSENT from the published tarball at
 *           an equal version. Judged on PRESENCE, never on bytes, and ratcheted like PUB-02.
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

/**
 * A shipped DECLARATION — judged on PRESENCE, never on bytes.
 *
 * 🛑 This is the hole the "dist is derived, never judged" rule left open, and it cost a
 * published tarball. `@geoleaf/core@3.1.0` shipped **0** `*.css.d.ts` against **21** on
 * disk, because `npm publish` ran a `prepublishOnly` that purged `dist/` and rebuilt
 * without the stub emitter. Every gate stayed green: this one because it does not judge
 * `dist/`, and `npm pack --dry-run` because it triggers `prepack`, not `prepublishOnly` —
 * so the `dist/` it measures is never the one a publish reconstructs.
 *
 * ⚠️ The bytes stay unjudged, and that part of the rule was right: two identical sources
 * legitimately emit different declarations months apart. What is NOT legitimate is a
 * declaration that exists here and is ABSENT there — the consumer then gets `TS2882` or
 * `TS7016` on a file we believe we shipped. Presence is toolchain-independent; bytes are not.
 *
 * ⚠️ One direction only. "Published but no longer local" is a normal consequence of a
 * refactor between two versions and would make this noisy for nothing.
 */
function isShippedDeclaration(rel) {
    return rel.startsWith("dist/types/") && rel.endsWith(".d.ts");
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
        /** Declarations we would ship and the registry does not carry. */
        const absentes = [];
        for (const rel of seen) {
            // PUB-04 — presence, and it is asked BEFORE the hash test: a file absent from
            // the tarball also "differs", and the `dist` class would have swallowed it
            // into an unjudged counter. That is exactly how 21 missing stubs came out green.
            if (isShippedDeclaration(rel) && local.has(rel) && !published.has(rel)) {
                absentes.push(rel);
            }
            if (local.get(rel) === published.get(rel)) continue;
            const cls = classify(rel);
            if (cls === "source") diverged.source.push(rel);
            else diverged[cls]++;
        }
        diverged.source.sort();
        absentes.sort();
        measured[name] = {
            version,
            source: diverged.source.length,
            files: diverged.source,
            absentes,
        };

        const shipsSource = [...local.keys()].some((f) => f.startsWith("src/"));
        const surface = shipsSource ? "" : " (ne publie pas `src/` — surface source réduite)";
        const mark =
            absentes.length > 0
                ? `${C.r}✘${C.x}`
                : diverged.source.length > 0
                  ? `${C.y}⚠${C.x}`
                  : `${C.g}✓${C.x}`;
        console.log(
            `  ${mark} ${name.padEnd(32)} ${version.padEnd(7)} ` +
                `source:${String(diverged.source.length).padStart(3)} · ` +
                `${C.d}dist:${diverged.dist} pkgjson:${diverged.pkgjson} ` +
                `decl-absentes:${absentes.length}${C.x}${surface}`
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
        const decls = m.absentes ? m.absentes.length : 0;
        // Two dimensions, one entry — a package can carry either, or both. Writing the
        // key only when it is non-zero keeps the baseline readable AND makes PUB-03's
        // question well-posed: an absent key means "nothing was frozen here", never
        // "zero was frozen here".
        if (m.source > 0 || decls > 0) {
            frozen[name] = { version: m.version };
            if (m.source > 0) frozen[name].source = m.source;
            if (decls > 0) frozen[name].declarations = decls;
        }
    }
    fs.writeFileSync(
        BASELINE,
        JSON.stringify(
            {
                _comment:
                    "Divergences GELÉES entre le dépôt et le tarball publié, à version ÉGALE. " +
                    "`source` = fichiers authorés dont le contenu diverge (PUB-02). " +
                    "`declarations` = déclarations que le dépôt livrerait et que le tarball " +
                    "publié n'a PAS (PUB-04) — dette d'avant le correctif des stubs CSS du " +
                    "18/08/2026, plus les modules d'un paquet dont le contenu a bougé sans bump. " +
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

// ── PUB-04 — a shipped declaration is MISSING from the published tarball ──────────────────
//
// 🛑 RATCHETED like PUB-02, and this paragraph first said the opposite. It claimed the
// state was "EMPTY at laying, so there is nothing to freeze" — written BEFORE running it.
// The first run measured **4 packages, 8 declarations**: `geocoding@1.0.0`,
// `measure@1.0.3`, `print@1.2.2` and `offline-ui@1.4.0`, all published on 12 or 15/08/2026,
// i.e. BEFORE the CSS stub emitter was fixed on the 18th. Their tarballs are pre-fix debt,
// not a live regression, and a hard red would sit on packages nobody is about to bump —
// permanently red, hence disarmed within the week. The exact outcome PUB-02's header
// describes, which I was about to re-commit one code below it.
//
// ⚠️ Two distinct classes come out of the same measurement, and the ratchet holds both:
//   • missing STUBS (6 of the 8) — the class `--ignore-scripts` and the emitter close;
//   • missing MODULES (`offline-ui`'s `corridor-selection.d.ts` and `corridor-tiles.d.ts`)
//     — content that moved without a version bump, i.e. PUB-02's own subject seen from
//     the declaration side. That package already carries 54 source files in the baseline.
//
// Remedy for any entry, and it is the same as PUB-02's: bump the version and publish.
// ⚠️ NEVER re-freeze. If a NEW entry appears, the cause is upstream — `--ignore-scripts`
// having left `publish-one.cjs`, or the CSS stub step having left `publish.yml`. Read those
// two before touching this file.
for (const [name, m] of Object.entries(measured)) {
    const count = m.absentes ? m.absentes.length : 0;
    if (count === 0) continue;
    const known = baseline[name];
    const gele = known && typeof known.declarations === "number" ? known.declarations : 0;
    if (count <= gele) continue;
    errors.push(
        `[PUB-04] ${name}@${m.version} — ${count} déclaration(s) que le dépôt livrerait sont ` +
            `ABSENTES du tarball publié, à version égale` +
            (gele > 0
                ? ` (${gele} gelée(s) en baseline, la dette GROSSIT)`
                : ` et rien n'est gelé`) +
            `.\n        L'intégrateur qui compile en \`skipLibCheck: false\` reçoit un TS2882 ` +
            `ou un TS7016 sur un fichier que nous croyons avoir expédié.\n` +
            `        ${m.absentes.slice(0, 5).join(", ")}` +
            (count > 5 ? ` … +${count - 5}` : "") +
            `\n        ⚠️ La cause est en AMONT : \`--ignore-scripts\` retiré de ` +
            `\`publish-one.cjs\`, ou l'étape « Stubs de type CSS » retirée de \`publish.yml\`.`
    );
}

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
    // ⚠️ Asked PER DIMENSION, and it has to be: a package frozen on both, whose sources
    // have realigned while its declarations have not, would have gone unnoticed under a
    // single test — the half-truth surviving inside an entry that still looks justified.
    const stale = [];
    if (typeof known.source === "number" && known.source > 0 && m.source === 0) {
        stale.push(`${known.source} divergence(s) source`);
    }
    const decls = m.absentes ? m.absentes.length : 0;
    if (typeof known.declarations === "number" && known.declarations > 0 && decls === 0) {
        stale.push(`${known.declarations} déclaration(s) absente(s)`);
    }
    if (stale.length > 0) {
        errors.push(
            `[PUB-03] ${name} est en baseline pour ${stale.join(" et ")}, ` +
                `mais ne les a PLUS. Corrigez ou retirez son entrée : une liste négative qui ` +
                `contient un faux se fait ignorer en bloc, donc c'est une erreur jusqu'au ` +
                `retrait. \`--update-baseline\` fait descendre le cliquet.`
        );
    }
}

for (const n of notes) console.log(`${C.d}   ${n}${C.x}`);

if (errors.length > 0) {
    console.error(`\n${C.r}✘ ${TAG}${C.x} : ${errors.length} violation(s) —\n`);
    for (const e of errors) console.error(`  • ${e}\n`);
    process.exit(1);
}

const dette = Object.values(measured).filter(
    (m) => m.source > 0 || (m.absentes && m.absentes.length > 0)
).length;
const declDette = Object.values(measured).reduce(
    (n, m) => n + (m.absentes ? m.absentes.length : 0),
    0
);
console.log(
    `${C.g}✓ ${TAG}${C.x} — ${compared} paquet(s) confronté(s) au registre ; ` +
        `${dette} en dette gelée (dont ${declDette} déclaration(s) absente(s) des tarballs ` +
        `publiés), aucune divergence neuve.`
);
