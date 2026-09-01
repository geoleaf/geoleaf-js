#!/usr/bin/env node
/**
 * @fileoverview DIST-INTEGRITY — the guard that makes chunk layering VISIBLE
 * instead of preventing it haphazardly.
 *
 * ## The defect, measured and re-measured
 *
 * `turbo run build` restores its cache **without emptying `dist/` first**. When the
 * task exits `FULL TURBO`, the restored artifacts **layer** over those already
 * present: two chunk sets, captured at different input states, cohabit.
 *
 * Re-verified at the 2026-08-06 preflight (turbo **2.9.18**) with a canary: a file
 * hand-placed in `packages/core/dist/chunks/` **survives** a `turbo run build`
 * exiting `cache hit, replaying logs` / `>>> FULL TURBO`. The founding note's option
 * (a) — "declare `outputs` so restoration replaces instead of layering" — is thus
 * **ruled out by measurement**: `outputs: ["dist/**"]` is already declared, and does
 * not suffice.
 *
 * ## Why a GUARD, and not only a purge
 *
 * `scripts/purge-dist.cjs` prevents the defect, and it is wired into
 * `npm run build`. But the deploy-regeneration protocol prescribes
 * `npx turbo run build` **as its first step** — a direct call that bypasses the npm
 * script. A prevention a documented path bypasses is no prevention.
 *
 * The founding note itself said it: it is "the only option that makes the defect
 * VISIBLE instead of preventing it haphazardly". This file is that option.
 *
 * ## The three rules
 *
 *   DIST-01  **Zero duplicate chunks.** Two files of the same LOGICAL name
 *            (everything before the final content hash) in one chunk directory ⟹
 *            error. The exact signature of the layering.
 *   DIST-02  **Zero orphan chunks.** A `chunks/` file nothing references anymore in
 *            its own `dist/` is dead weight — and it **would ship in the npm
 *            tarball** (measured: 3.5 MB on `realtime-layer`).
 *   DIST-03  **The corpus cannot be empty.** A green gate that scanned nothing is
 *            the worst outcome — same class as JTD-03, NNA-03 and EOD-03. Here the
 *            trap is real: before any build there is NO `dist/`, and the gate would
 *            go green looking at nothing.
 *
 * ## Two design decisions
 *
 * **The perimeter comes from the registry** (`scripts/lib/packages.cjs`), never a
 * `packages/*​/dist` glob — which matches neither `packages/plugins/*` nor
 * `packages/libs/*`, hence would put thirteen packages out of fifteen off the
 * counter with nothing turning red. Class watched by `probe-gate-visibility.cjs`.
 *
 * **`deploy/` is scanned too, and separately.** The duplication comes from the
 * SOURCE (`packages/*​/dist/`), but rebuilding `deploy/` on a polluted `dist/`
 * reproduces it — verified on 08-05. Both perimeters are thus measured, and the
 * report separates them so one knows which to purge.
 *
 * @see scripts/purge-dist.cjs — the preventive side
 */

const fs = require("node:fs");
const path = require("node:path");
const packages = require("./lib/packages.cjs");

const ROOT = packages.ROOT;

/**
 * Strips a chunk name's final content hash to derive its LOGICAL name.
 *
 * Rollup emits `geoleaf-chunk-core-utils-DmkBZ6K6.js`: the final segment is an
 * 8-character base64url hash. Two builds of one logical chunk differ only by it —
 * precisely what makes the layering detectable.
 *
 * 🛑 **This function's first version accepted `[A-Za-z0-9_-]{8}`, and it produced a
 * FALSE POSITIVE at the first run**: `maplibre-layer-builders.js` and
 * `maplibre-layer-registry.js` (two very distinct `dist/esm/` modules) were rendered
 * as "two variants of `maplibre-layer`", because `builders` and `registry` are
 * exactly eight letters. A noisy gate learns to be ignored, which is worse than an
 * absent one — the repo wrote it down after the same incident on
 * DOC-CONFIG-EXAMPLES.
 *
 * Hence **two tightenings, not one**: the hash must carry at least one **uppercase**
 * AND at least one **digit or second uppercase** (a lowercase English word can no
 * longer pass), and the caller only judges `chunks/` directories — see `analyse()`.
 *
 * @param {string} file File name, without its directory.
 * @returns {string|null} The logical name, or `null` if the file carries no hash (in
 *   which case it is not a hashed chunk and cannot duplicate through layering).
 */
function logicalName(file) {
    const m = file.match(/^(.*)-([A-Za-z0-9_-]{8})\.js$/);
    if (!m) return null;
    const hash = m[2];
    const uppers = (hash.match(/[A-Z]/g) || []).length;
    const digits = (hash.match(/[0-9]/g) || []).length;
    if (uppers === 0) return null;
    if (uppers + digits < 2) return null;
    return m[1];
}

/**
 * Collects a `dist/` root's chunk directories.
 *
 * @param {string} distDir Absolute path of a `dist` directory.
 * @returns {string[]} Absolute paths of the directories containing `.js` files.
 */
function chunkDirs(distDir) {
    const out = [];
    if (!fs.existsSync(distDir)) return out;
    (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const q = path.join(d, e.name);
            if (e.isDirectory()) walk(q);
        }
        if (fs.readdirSync(d).some((f) => f.endsWith(".js"))) out.push(d);
    })(distDir);
    return out;
}

/**
 * Analyses a `dist/` root: logical duplicates and orphan chunks.
 *
 * @param {string} label Readable name of the perimeter (package or deploy variant).
 * @param {string} distDir Absolute path of the `dist/`.
 * @returns {{label: string, scanned: number, duplicates: object[], orphans: string[]}}
 */
function analyse(label, distDir) {
    const duplicates = [];
    const orphans = [];
    let scanned = 0;

    // Content of ALL the perimeter's .js: that is where references are read.
    const allJs = [];
    for (const dir of chunkDirs(distDir)) {
        for (const f of fs.readdirSync(dir)) {
            if (f.endsWith(".js")) allJs.push(path.join(dir, f));
        }
    }
    const corpus = allJs.map((f) => ({ file: f, text: fs.readFileSync(f, "utf-8") }));

    for (const dir of chunkDirs(distDir)) {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
        scanned += files.length;

        // Both rules judge ONLY the `chunks/` directories. That is where rollup
        // emits its hashed files, hence the only place layering is expressible.
        // `dist/esm/` carries NAMED modules, preserved one by one: two neighbouring
        // names there are two modules, never two variants — and judging them there
        // produced the `maplibre-layer-builders` / `maplibre-layer-registry` false
        // positive at the first run.
        if (path.basename(dir) !== "chunks") continue;

        // DIST-01 — two hashes for one logical name.
        const byLogical = new Map();
        for (const f of files) {
            const ln = logicalName(f);
            if (!ln) continue;
            if (!byLogical.has(ln)) byLogical.set(ln, []);
            byLogical.get(ln).push(f);
        }
        for (const [ln, variants] of byLogical) {
            if (variants.length > 1) {
                duplicates.push({
                    dir: path.relative(ROOT, dir),
                    logical: ln,
                    variants: variants.sort(),
                });
            }
        }

        // DIST-02 — a chunk nothing references. At a `dist/` root, an unreferenced
        // .js is an ENTRY, not an orphan; the `chunks/` filter above already excludes
        // it, which is what keeps the rule from counting every entry point of the
        // repo.
        for (const f of files) {
            const referenced = corpus.some(
                (c) => c.file !== path.join(dir, f) && c.text.includes(f)
            );
            if (!referenced) orphans.push(path.relative(ROOT, path.join(dir, f)));
        }
    }

    return { label, scanned, duplicates, orphans };
}

const results = [];

for (const p of packages.all()) {
    const dist = path.join(p.absDir, "dist");
    if (!fs.existsSync(dist)) continue;
    results.push(analyse(p.name, dist));
}

const deployRoot = path.join(ROOT, "deploy");
if (fs.existsSync(deployRoot)) {
    for (const variant of fs.readdirSync(deployRoot)) {
        const dist = path.join(deployRoot, variant, "dist");
        if (!fs.existsSync(dist)) continue;
        results.push(analyse("deploy/" + variant, dist));
    }
}

const totalScanned = results.reduce((n, r) => n + r.scanned, 0);
const dupes = results.filter((r) => r.duplicates.length);
const orphs = results.filter((r) => r.orphans.length);

const BAR = "─".repeat(72);
console.log(BAR);

let failed = false;

// DIST-03 — anti-empty-gate, evaluated FIRST: without it, a never-built repo comes
// out green having looked at nothing, the most misleading result possible.
if (totalScanned === 0) {
    console.error("❌ [DIST-03] corpus VIDE — aucun fichier .js scanné dans aucun dist/.");
    console.error("   Une gate verte qui n'a rien scanné ne garde rien. Lancer un build d'abord :");
    console.error("     npx turbo run build");
    failed = true;
}

for (const r of dupes) {
    failed = true;
    console.error(`❌ [DIST-01] ${r.label} — chunk(s) en DOUBLE (superposition de cache turbo) :`);
    for (const d of r.duplicates) {
        console.error(`     ${d.dir}/${d.logical} → ${d.variants.length} variantes :`);
        for (const v of d.variants) console.error(`        ${v}`);
    }
}

for (const r of orphs) {
    failed = true;
    console.error(`❌ [DIST-02] ${r.label} — chunk(s) ORPHELIN(S), référencés par rien :`);
    for (const o of r.orphans) console.error(`     ${o}`);
}

if (failed) {
    console.error("");
    console.error("   Cause probable : turbo restaure son cache SANS vider dist/.");
    console.error("   Geste : node scripts/purge-dist.cjs && npx turbo run build");
    console.error(BAR);
    process.exit(1);
}

console.log(
    `✅ [DIST-INTEGRITY] ${totalScanned} fichier(s) .js scanné(s) sur ${results.length} périmètre(s) — ` +
        "0 chunk en double, 0 orphelin."
);
console.log(BAR);
