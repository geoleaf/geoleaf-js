#!/usr/bin/env node
/**
 * LIC-HEADERS: is the licence REALLY carried by what ships?
 *
 * Two distinct objects, often confused, and that is why they are gated separately:
 * the **distributed bundle's notice** and the **sources' header**. The root
 * `LICENSE`, line 12, requires the notice to accompany "all copies or substantial
 * portions of the Software". The npm tarball satisfies it through `files[]`; **a
 * `.js` served alone from a CDN or copied into a client's `deploy/`, no**. That is
 * the hole LIC-04 closes.
 *
 *   LIC-01  Every `.ts` source of the `collect()` corpus opens on a canonical `/*!`
 *           block — a title, `© <year> Mattieu Pottier`, an MIT mention, and the
 *           project URL.
 *   LIC-02  No competing attribution: neither a second copyright holder, nor a
 *           title naming ANOTHER package of the repo.
 *   LIC-03  Anti-empty-gate floor, on BOTH corpora. A lone green is ambiguous
 *           between "0 bare files" and "0 scanned files" — and this repo has
 *           already been caught.
 *   LIC-04  Every `.js`/`.mjs` shipped by a publishable package's `files[]` carries
 *           the notice in its **first 200 bytes**, except 100 %-third-party chunks,
 *           named at every run.
 *   LIC-05  `package.json#license` is exactly `MIT` on every package of the repo.
 *   LIC-06  Every tracked `LICENSE` file carries `Copyright (c) <year> Mattieu
 *           Pottier` and **never the `©` sign** — the partition's disjunction
 *           assertion.
 *
 * ## No baseline, deliberately
 *
 * MH-03 regime: "this one has NO baseline, on purpose: the rule holds at zero". A
 * baseline on licence headers would be a permit not to set them — and the gesture
 * that sets them is mechanical (`--write`), so there is no debt to spread.
 *
 * ## What LIC-04 does NOT do, and why
 *
 * It does not demand the notice on a chunk whose sources are **all** inside
 * `node_modules/`. Writing "© 2026 Mattieu Pottier — Released under the MIT
 * License" there would be a **false attribution**: `geoleaf-print.jspdf-*.js` is
 * jsPDF, not GeoLeaf. The list is not hand-written, it derives from the chunk's
 * sourcemap, and the gate prints it at every run — a third-party file exempted in
 * silence would be indistinguishable from a file of ours forgotten. A file WITHOUT
 * a sourcemap is never exempted: doubt plays against the exemption.
 *
 * ## `packages/_plugin-template/` is OUT of the corpus, and that is wanted
 *
 * The `workspaces` globs carry `!packages/_*`, so `packages.cjs` does not return
 * the scaffold and no rule derived from it applies there. **A wanted exclusion**:
 * its files carry unsubstituted `__PLUGIN_PKG__` tokens, it is never published, and
 * a gate scanning it would redden on templates.
 *
 * 🛑 **But a scaffold that does not emit the banner produces non-conforming plugins
 * FROM BIRTH, in this gate's exact blind spot.** Measured on 2026-08-10: its 5
 * sources did carry a `/*!`, without the `https://geoleaf.dev` line — the next
 * `npm run create:plugin` would thus be born violating LIC-01, and its bundle
 * notice-less (its config did not pass `pkg` to `pluginStack`). Fixed at the
 * source, in the template. The useful gesture is thus not to include the template
 * in the corpus, it is to **verify that the generator emits the canonical form** —
 * proven by creating a plugin and watching LIC-01 pass on it without intervention.
 * Same mode as the night journal's finding: a gate derived from a registry inherits
 * that registry's exclusions, and the generator is precisely what leads out of the
 * hole.
 *
 * ## LIC-05 bears on what we PUBLISH, never on what we consume
 *
 * `maplibre-gl@6.2.0` — the core's peer dependency — is **BSD-3-Clause**, and
 * `packages/core/docs/NOTICE.md` §Dependencies says so. ⚠️ This pointer cited `:64`
 * until 2026-08-10: the real line was `:59`, and a line number in a pointer to a
 * `.md` goes stale at the first inserted paragraph — the SECTION does not move. A
 * permissive, compatible dependency licence is no violation of "MIT, no exception":
 * the doctrine bears on THIS repo's packages. The constant is therefore named
 * `PUBLISHED_PACKAGE_LICENSE` and not `ALLOWED_LICENSE` — otherwise the first BSD
 * or Apache dependency will suggest a violation, and someone will "fix" the gate.
 *
 * ## LIC-06 — the `Copyright (c)` / `©` partition is SETTLED, so it gets guarded
 *
 * The request was to settle a "wording divergence". There is none: `Copyright (c)`
 * lives in the **19 `LICENSE` files**, `©` in the banners, and **the intersection
 * is empty in both directions**. Each side's motive — canonical MIT text recognised
 * word for word by SPDX on one side, typographic notice on the other — is written
 * once, at the §"`Copyright (c)` / `©`" of `lib/license-banner.cjs`.
 *
 * 🛑 **What is guarded here is the direction NOTHING guarded.** "No banner carries
 * `(c)`" already was, by LIC-01 (`inspect()` classes the `parenthesee` form). "No
 * `LICENSE` carries `©`" was guarded by nothing — and that is the direction a
 * harmonisation breaks: facing 845 banners in `©` and 19 `LICENSE` in `(c)`, one
 * "fixes" the smaller pile. LIC-06 turns red at that instant, and points to the
 * paragraph explaining why not to.
 *
 * The corpus derives from `git ls-files`, never the registry: the 19 `LICENSE`
 * **overflow** `packages.cjs` on both sides — the root `LICENSE` belongs to no
 * package, and `packages/_plugin-template/`'s sits in the `!packages/_*` blind spot
 * (a mode already paid for twice). A registry-derived corpus would see 17 of 19,
 * and would go green on the two it does not look at.
 *
 * Usage : node scripts/check-license-headers.cjs            (gate)
 *         node scripts/check-license-headers.cjs --write    (sets/completes banners)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const registry = require("./lib/packages.cjs");
const inventory = require("./lib/source-inventory.cjs");
const canon = require("./lib/license-banner.cjs");

const ROOT = registry.ROOT;
const WRITE = process.argv.includes("--write");

/**
 * Where the notice must sit in a shipped file (LIC-04).
 *
 * 🛑 **The original wording said "in its first 200 bytes", and that criterion
 * reddens on PERFECTLY conforming files.** Measured on 2026-08-10:
 * `dist/esm/lang/lang-fr.js`, `capabilities/feature-info/render/dom.js` and
 * `resolve.js` do open on a complete `/*!` — but their TITLE and description push
 * the `https://geoleaf.dev` line past byte 200. A byte threshold punishes an
 * informative title, the opposite of the goal.
 *
 * The real criterion is **structural**: the notice must live in the HEAD `/*!`
 * block, the one opening the file — the *legal comment* a minifier preserves and a
 * reader sees first. Stricter than "somewhere in the first 200 bytes" (a notice
 * buried mid-code no longer passes) and dependent on no arbitrary constant.
 *
 * The cap stays, but on the BLOCK, and wide: a head banner is not a file.
 */
const NOTICE_BLOCK_MAX_BYTES = 4096;

/**
 * LIC-03 floors — the corpus cannot shrink in silence.
 *
 * Measured on 2026-08-10: 845 `.ts` sources on 15 packages, 545 shipped `.js` on 14
 * publishable ones, **19 tracked `LICENSE` files** (17 before the addition). The
 * floors sit WELL below: their job is to redden when a corpus falls to zero or
 * collapses, not to ratchet at every added file. ⚠️ `licenses` is therefore NOT at
 * 19: a floor tracking the corpus to the unit is a ratchet in disguise, and it gets
 * lowered at the first legitimate removal.
 */
const FLOOR = { sources: 700, sourcePackages: 12, shipped: 400, shippedPackages: 12, licenses: 15 };

// ─── Corpus 1 — the sources ──────────────────────────────────────────────────

const { files: sources } = inventory.collect();

/** @type {{rel: string, pkg: string, why: string[]}[]} */
const lic01 = [];
/** @type {{rel: string, detail: string}[]} */
const lic02 = [];
/** @type {{rel: string, pkg: string, source: string, why: string[]}[]} */
const toWrite = [];

for (const f of sources) {
    const abs = path.join(ROOT, f.rel);
    const src = fs.readFileSync(abs, "utf8");
    const info = canon.inspect(src);
    const why = [];

    if (!info.present) why.push("aucun bloc `/*!` en tête");
    else {
        if (info.authorForm !== "canonique") why.push(`ligne d'auteur ${info.authorForm}`);
        if (!info.hasMit) why.push("aucune mention MIT");
        if (!info.hasUrl) why.push(`ligne ${canon.PROJECT_URL} absente`);
    }
    if (why.length) lic01.push({ rel: f.rel, pkg: f.package, why });

    // LIC-02 — attribution concurrente.
    if (info.present) {
        const foreign = canon.foreignPackageInTitle(info.title, f.package);
        if (foreign) {
            lic02.push({
                rel: f.rel,
                detail: `titre « ${info.title} » — nomme ${foreign}, le fichier appartient à ${f.package}`,
            });
        }
        for (const m of info.body.matchAll(
            /(?:©|\(c\)|Copyright)\s*(?:\d{4}[^\S\n]*)?([^\n*]{2,60})/gi
        )) {
            const who = m[1].trim();
            if (who && !who.startsWith(canon.HOLDER)) {
                lic02.push({ rel: f.rel, detail: `détenteur concurrent : « ${who} »` });
            }
        }
    }

    if (WRITE) {
        const out = canon.normalize(src, f.package);
        if (out.changed)
            toWrite.push({ rel: f.rel, pkg: f.package, source: out.source, why: out.why });
    }
}

if (WRITE) {
    for (const w of toWrite) fs.writeFileSync(path.join(ROOT, w.rel), w.source);
    console.log(
        `✅ [LIC-HEADERS --write] ${toWrite.length} fichier(s) réécrit(s) sur ${sources.length} scanné(s).`
    );
    const parMotif = new Map();
    for (const w of toWrite) for (const r of w.why) parMotif.set(r, (parMotif.get(r) || 0) + 1);
    for (const [k, v] of [...parMotif].sort((a, b) => b[1] - a[1])) console.log(`   ${v} × ${k}`);
    console.log(
        `   Corpus : \`.ts\` de collect() UNIQUEMENT — jamais les \`.css\` ni les scripts.\n` +
            `   Motif : \`source-inventory.cjs:leadingComment()\` matche \`/*!\` SANS le stripper pour\n` +
            `   tout ce qui n'est pas \`.ts\`. Un bandeau posé sur une feuille de style ferait décrire\n` +
            `   chaque \`.css\` par son copyright dans ARBORESCENCE_QUALIFIEE.md, et docs:tree:check rougirait.`
    );
    process.exit(0);
}

// ─── Corpus 2 — the shipped `.js` ────────────────────────────────────────────

/**
 * Directories that never carry product code.
 *
 * Assumed copy of `source-inventory.cjs:SKIP_DIRS` — and that is the point: the
 * `--write` corpus (`collect()`) excludes them by construction, so a gate
 * REQUIRING them would demand what its own generator cannot produce. A permanent
 * red nobody can close always ends up released.
 * ⚠️ These files DO ship in the tarballs — a written arbitration (177 tests out of
 * 493 sources). They are outside the NOTICE's perimeter, not outside the tarball,
 * and confusing the two would be a misreading of this comment.
 */
const SKIP_DIRS = new Set(["__tests__", "__mocks__", "test-utils", "node_modules"]);

/**
 * The JavaScript files an `npm pack` would carry, per publishable package.
 *
 * Derived from `files[]` and never a glob: `files[]` IS the declaration of what
 * ships, and it is what must be proven. Deliberately not `npm pack --dry-run`,
 * which triggers `prepack` (hence a build) mid-gate.
 *
 * 🛑 **Negative `files[]` entries are APPLIED, not skipped.** `@geoleaf/core`
 * declares `docs/` then `!docs/api/` and `!docs/public/`: ignoring the negations
 * let **10 TypeDoc-generated asset files** npm does not ship enter the corpus. A
 * gate reddening on a file absent from the tarball is a gate that gets disarmed.
 *
 * @returns {{rel: string, abs: string, pkg: string}[]}
 */
function shippedJs() {
    const out = [];
    for (const pkg of registry.publishable()) {
        const entries = pkg.manifest.files || [];
        const negations = entries
            .filter((e) => e.startsWith("!"))
            .map((e) => e.slice(1).replace(/\/$/, ""));
        const excluded = (relToPkg) =>
            negations.some((n) => relToPkg === n || relToPkg.startsWith(n + "/"));

        for (const entry of entries) {
            if (entry.startsWith("!")) continue;
            const abs = path.join(pkg.absDir, entry.replace(/\/$/, ""));
            if (!fs.existsSync(abs)) continue;
            const push = (p) => {
                const relToPkg = path.relative(pkg.absDir, p).split(path.sep).join("/");
                if (excluded(relToPkg)) return;
                if (relToPkg.split("/").some((seg) => SKIP_DIRS.has(seg))) return;
                out.push({
                    rel: path.relative(ROOT, p).split(path.sep).join("/"),
                    abs: p,
                    pkg: pkg.name,
                });
            };
            const walk = (d) => {
                for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                    const p = path.join(d, e.name);
                    if (e.isDirectory()) walk(p);
                    else if (/\.(js|mjs)$/.test(e.name)) push(p);
                }
            };
            if (fs.statSync(abs).isDirectory()) walk(abs);
            else if (/\.(js|mjs)$/.test(abs)) push(abs);
        }
    }
    return out;
}

/**
 * Is this chunk entirely third-party code?
 *
 * Read off the SOURCEMAP, never the file name: `geoleaf-print.jspdf-*.js` carries
 * our output prefix and zero lines of ours. No map → `false`, doubt plays against
 * the exemption.
 *
 * @param {string} absJs
 * @returns {{vendor: boolean, sources: number}}
 */
function vendorOnly(absJs) {
    const mapPath = absJs + ".map";
    if (!fs.existsSync(mapPath)) return { vendor: false, sources: 0 };
    let map;
    try {
        map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    } catch {
        return { vendor: false, sources: 0 };
    }
    const srcs = map.sources || [];
    return {
        vendor: srcs.length > 0 && srcs.every((s) => s.includes("node_modules")),
        sources: srcs.length,
    };
}

const shipped = shippedJs();
/** @type {{rel: string, head: string}[]} */
const lic04 = [];
/** @type {string[]} */
const vendorExempt = [];

for (const f of shipped) {
    const v = vendorOnly(f.abs);
    if (v.vendor) {
        vendorExempt.push(`${f.rel} (${v.sources} source(s), toutes sous node_modules/)`);
        continue;
    }
    const raw = fs.readFileSync(f.abs);
    const head = raw.subarray(0, NOTICE_BLOCK_MAX_BYTES).toString("utf8");
    const block = head.match(canon.BANNER_RE);
    const body = block ? block[1] : "";
    const ok =
        Boolean(block) &&
        body.includes(canon.HOLDER) &&
        /\bMIT\b/.test(body) &&
        body.includes(canon.PROJECT_URL.replace(/^https:\/\//, ""));
    if (!ok) {
        lic04.push({
            rel: f.rel,
            head: head.slice(0, 60).replace(/\n/g, "\\n"),
            why: block ? "bloc `/*!` de tête incomplet" : "aucun bloc `/*!` de tête",
        });
    }
}

// ─── LIC-05 — the VALUE of the license field ─────────────────────────────────

/**
 * Named exceptions to LIC-05 — empty, and that is the goal.
 *
 * The day an entry appears here, it carries its motive right here: an exception
 * without a written motive is indistinguishable from an oversight six months
 * later. ⚠️ This is NOT the place to file a non-MIT dependency: LIC-05 only looks
 * at THIS repo's manifests.
 *
 * @type {Map<string, string>}
 */
const LIC05_EXCEPTIONS = new Map();

/** @type {string[]} */
const lic05 = [];
for (const pkg of registry.all()) {
    if (LIC05_EXCEPTIONS.has(pkg.name)) continue;
    const value = pkg.manifest.license;
    if (value !== canon.PUBLISHED_PACKAGE_LICENSE) {
        lic05.push(
            `${pkg.dir}/package.json — license = ${JSON.stringify(value ?? null)}, attendu ` +
                `${JSON.stringify(canon.PUBLISHED_PACKAGE_LICENSE)}`
        );
    }
}

// ─── LIC-06 — the `Copyright (c)` / `©` disjunction ──────────────────────────

/**
 * The git-tracked `LICENSE` files — LIC-06's corpus.
 *
 * Derived from `git ls-files` and never the registry: see the header's §LIC-06.
 * The pattern is anchored at both ends (`^LICENSE$` or `/LICENSE$`) so as NOT to
 * catch `LICENSE_HEADERS.md` nor `LICENSE-DATA.md`, which speak of licence without
 * being one — the exact confusion that made an earlier recipe unusable (it counted
 * 19 where there were 17 `LICENSE` + 2 documents).
 *
 * Throws if git fails, `lib/source-inventory.cjs` pattern: a corpus emptied in
 * silence is the failure mode LIC-03 exists to forbid.
 *
 * @returns {string[]} Paths relative to the repo root.
 */
function trackedLicenseFiles() {
    const res = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
    if (res.status !== 0) {
        throw new Error(`check-license-headers: \`git ls-files\` a échoué — ${res.stderr}`);
    }
    return res.stdout.split("\0").filter((p) => /(^|\/)LICENSE$/.test(p));
}

const licenseFiles = trackedLicenseFiles();
/** @type {{rel: string, why: string}[]} */
const lic06 = [];

for (const rel of licenseFiles) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (text.includes(canon.TYPOGRAPHIC_COPYRIGHT)) {
        lic06.push({
            rel,
            why:
                `porte le signe \`${canon.TYPOGRAPHIC_COPYRIGHT}\`, réservé aux BANDEAUX — ` +
                `le texte MIT canonique écrit \`${canon.LICENSE_FILE_COPYRIGHT}\``,
        });
    }
    if (!text.includes(canon.LICENSE_FILE_COPYRIGHT)) {
        lic06.push({ rel, why: `ne porte pas \`${canon.LICENSE_FILE_COPYRIGHT}\`` });
    }
}

// ─── LIC-03 — plancher ───────────────────────────────────────────────────────

const sourcePackages = new Set(sources.map((f) => f.package)).size;
const shippedPackages = new Set(shipped.map((f) => f.pkg)).size;
/** @type {string[]} */
const lic03 = [];
if (sources.length < FLOOR.sources)
    lic03.push(`sources : ${sources.length} < plancher ${FLOOR.sources}`);
if (sourcePackages < FLOOR.sourcePackages)
    lic03.push(`paquets sources : ${sourcePackages} < plancher ${FLOOR.sourcePackages}`);
if (shipped.length < FLOOR.shipped)
    lic03.push(`\`.js\` expédiés : ${shipped.length} < plancher ${FLOOR.shipped}`);
if (shippedPackages < FLOOR.shippedPackages)
    lic03.push(`paquets publiables : ${shippedPackages} < plancher ${FLOOR.shippedPackages}`);
if (licenseFiles.length < FLOOR.licenses)
    lic03.push(`fichiers \`LICENSE\` : ${licenseFiles.length} < plancher ${FLOOR.licenses}`);

// ─── Verdict ─────────────────────────────────────────────────────────────────

let failed = false;
const MAX_LISTED = 25;

if (lic03.length > 0) {
    failed = true;
    console.error(`ERROR [LIC-HEADERS/LIC-03]: le corpus s'est effondré — la gate ne mesure plus.`);
    for (const l of lic03) console.error(`  ${l}`);
    console.error("");
    console.error(
        "Un vert obtenu sur un corpus vide est le mode d'échec que ce plancher existe pour " +
            "interdire. Vérifier les globs `workspaces` et `files[]` AVANT de toucher au plancher."
    );
}

if (lic01.length > 0) {
    failed = true;
    console.error(`ERROR [LIC-HEADERS/LIC-01]: ${lic01.length} source(s) sans bandeau canonique :`);
    for (const e of lic01.slice(0, MAX_LISTED)) console.error(`  ${e.rel} — ${e.why.join(", ")}`);
    if (lic01.length > MAX_LISTED) console.error(`  … et ${lic01.length - MAX_LISTED} autre(s)`);
    const parPkg = new Map();
    for (const e of lic01) parPkg.set(e.pkg, (parPkg.get(e.pkg) || 0) + 1);
    console.error(
        `  Répartition : ${[...parPkg]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k} ${v}`)
            .join(" · ")}`
    );
    console.error("");
    console.error("Le geste est mécanique : node scripts/check-license-headers.cjs --write");
}

if (lic02.length > 0) {
    failed = true;
    console.error(`ERROR [LIC-HEADERS/LIC-02]: ${lic02.length} attribution(s) concurrente(s) :`);
    for (const e of lic02.slice(0, MAX_LISTED)) console.error(`  ${e.rel} — ${e.detail}`);
    if (lic02.length > MAX_LISTED) console.error(`  … et ${lic02.length - MAX_LISTED} autre(s)`);
    console.error("");
    console.error(
        "Un fichier publié qui s'annonce sous le nom d'un autre paquet est une déclaration " +
            "fausse dans un tarball immuable. `--write` corrige le titre ; un second détenteur " +
            "de copyright, lui, se traite à la main."
    );
}

if (lic04.length > 0) {
    failed = true;
    console.error(
        `ERROR [LIC-HEADERS/LIC-04]: ${lic04.length}/${shipped.length - vendorExempt.length} ` +
            `fichier(s) expédié(s) ne portent pas la notice dans leur bloc \`/*!\` de tête :`
    );
    for (const e of lic04.slice(0, MAX_LISTED)) {
        console.error(`  ${e.rel} — ${e.why} ; commence par « ${e.head} »`);
    }
    if (lic04.length > MAX_LISTED) console.error(`  … et ${lic04.length - MAX_LISTED} autre(s)`);
    console.error("");
    console.error(
        "⚠️ DÉCLARER une bannière ne suffit pas : `offline-ui/rollup.config.mjs` en déclarait une " +
            "et son bundle commençait par `var Xe=Object.defineProperty` — `minify()` la voyait " +
            'et `legalComments: "none"` la supprimait. La bannière se pose APRÈS le minifieur ' +
            "(`licenseBanner()` de `@geoleaf/build-config/rollup.mjs`), et se MESURE ici."
    );
}

if (lic05.length > 0) {
    failed = true;
    console.error(`ERROR [LIC-HEADERS/LIC-05]: ${lic05.length} paquet(s) hors licence canonique :`);
    for (const l of lic05) console.error(`  ${l}`);
    console.error("");
    console.error(
        "« Licence — MIT, sans exception » (CLAUDE.md). PC-05 n'exige qu'une chaîne NON VIDE : " +
            '"BSD-3-Clause" ou "UNLICENSED" y sortaient verts. Une exception se déclare dans ' +
            "LIC05_EXCEPTIONS avec son motif écrit. ⚠️ La règle porte sur les paquets de CE dépôt, " +
            "PAS sur leurs dépendances : maplibre-gl est BSD-3-Clause et ce n'est pas une violation."
    );
}

if (lic06.length > 0) {
    failed = true;
    console.error(
        `ERROR [LIC-HEADERS/LIC-06]: ${lic06.length} fichier(s) \`LICENSE\` hors de la partition :`
    );
    for (const e of lic06) console.error(`  ${e.rel} — ${e.why}`);
    console.error("");
    console.error(
        "🛑 `Copyright (c)` dans les `LICENSE`, `©` dans les bandeaux : ce n'est PAS une " +
            "incohérence à harmoniser, c'est une partition voulue — le `LICENSE` porte le texte " +
            "MIT canonique, que SPDX et les scanners de conformité reconnaissent au mot près. " +
            "Le motif complet est au §« Copyright (c) / © » de `scripts/lib/license-banner.cjs`. " +
            "Si cette gate rougit, quelqu'un a aligné les deux formes sans lire ce paragraphe."
    );
}

if (failed) process.exit(1);

console.log(
    `✅ [LIC-HEADERS] LIC-01/02 : ${sources.length} source(s) sur ${sourcePackages} paquets, ` +
        `bandeau canonique, 0 attribution concurrente.`
);
console.log(
    `   LIC-04 : ${shipped.length - vendorExempt.length}/${shipped.length} fichier(s) expédié(s) ` +
        `portent la notice sur ${shippedPackages} paquets publiables.`
);
if (vendorExempt.length) {
    console.log(`   LIC-04 — ${vendorExempt.length} chunk(s) 100 % tiers, exemptés et nommés :`);
    for (const v of vendorExempt) console.log(`     ${v}`);
} else {
    console.log("   LIC-04 — aucun chunk tiers exempté.");
}
console.log(
    `   LIC-05 : ${registry.all().length} paquet(s) en license "${canon.PUBLISHED_PACKAGE_LICENSE}", ` +
        `${LIC05_EXCEPTIONS.size} exception(s) nommée(s).`
);
console.log(
    `   LIC-06 : ${licenseFiles.length} fichier(s) \`LICENSE\` suivis, tous en ` +
        `"${canon.LICENSE_FILE_COPYRIGHT}", 0 portant "${canon.TYPOGRAPHIC_COPYRIGHT}" — ` +
        `la partition tient dans les deux sens (l'autre est gardé par LIC-01).`
);
process.exit(0);
