#!/usr/bin/env node
/**
 * Enforces the contract of the 7 `globals/globals.*.ts` — the boot's UMD/ESM bridge.
 *
 * These files are NOT facades: their very job is writing onto `globalThis.GeoLeaf`,
 * and applying `check-facade-purity.cjs` to them would be wrong. The contract that
 * fits them is not purity, it is OWNERSHIP: the namespace has one owner, and it is
 * the boot.
 *
 * The stake changed nature when the plugins switched over. Since `plugin-addpoi` and
 * `plugin-storage` read the core on `globalThis.GeoLeaf.*` instead of importing it,
 * this surface is a PUBLIC CONTRACT between the core and the plugins. If any file can
 * write to it, nobody can say anymore what it contains nor when — and a plugin
 * reading a never-mounted key degrades in silence. Exactly the outage found on
 * `Config`.
 *
 * GLB-01: only `globals/globals.*.ts` write onto the namespace, outside the baseline.
 * GLB-02: the baseline must shrink — an entry gone useless is flagged.
 *
 * Usage: node scripts/verify-globals-ownership.cjs (from repo root)
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
// Through the registry, which throws if the core cannot be found.
const SRC = path.join(require("./lib/packages.cjs").requireByDirName("core").absDir, "src");

/**
 * Tolerated facade self-mounts (census of 2026-07-19).
 *
 * `check-facade-purity.cjs` explicitly allows the "self-mount" pattern for facades;
 * these three fall under it. They stay listed because a self-mount is a namespace
 * write like any other: the day one disappears, GLB-02 will say so instead of leaving
 * a dormant permission.
 */
const BASELINE = [
    "kernel/ui/ui-api.ts",
    "api/geoleaf.sync.ts",
    "kernel/storage/facade.ts",
    // ── `utils/performance/runtime-metrics.ts` LEFT the baseline (3.20.6) ──
    //
    // Its `if (_g.GeoLeaf)` mount ran at the module's evaluation, which the shipped chunk
    // order places BEFORE the namespace exists: the three members existed in no bundle. The
    // module now exports `installRuntimeMetrics(gl)`, called by the namespace's assembly, and
    // writes no global of its own.
    // ── `kernel/geojson/style-resolver.ts` LEFT the baseline ──
    //
    // It mounted `GeoLeaf._StyleRules` at module root level — hence at mere import,
    // before the boot sequence — and set `globalThis.GeoLeaf = {}` when it found
    // nothing: a kernel leaf module CREATED the public namespace, racing the
    // `globals/` chain that is its declared owner. The key had no production reader;
    // the write left with it, and the entry with the write.
    //
    // What to keep of its story: it had only been DISCOVERED by widening `WRITE_RE`.
    // The first version, which demanded a literal `globalThis.GeoLeaf`, did not see
    // the `(_g as {…}).GeoLeaf.X =` form used there. The gate came out green on a
    // repo already violating its invariant — the reason GLB-02 is a ratchet, and the
    // reason `WRITE_RE` deserves to be re-widened rather than believed.
];

/**
 * A write onto the namespace, under any access form.
 *
 * ⚠️ The first version demanded a LITERAL `globalThis.GeoLeaf`, and thus missed
 * `(globalThis as any).GeoLeaf.X = …` — the most common form in TypeScript, and the
 * one a real violation would take. The gate passed its own mutation. Same defect as
 * the boundary gate before it (`verify-core-standalone`), blind to the canonical form
 * of what it guarded.
 *
 * So we match on the SUFFIX `.GeoLeaf.<Key> =`, whatever the carrier, plus the local
 * `_gl` variable the boot and facades use.
 *
 * 🛑 **RE-WIDENED A SECOND TIME on 2026-08-19, and the paragraph above announced it:
 * "`WRITE_RE` deserves to be re-widened rather than believed".** It demanded an
 * UPPERCASE INITIAL — `[A-Z_]` — which describes the namespaces (`GeoLeaf.Storage`,
 * `GeoLeaf.UI`) and misses the FUNCTIONS mounted at the root, which carry a lowercase
 * initial by convention. Three of them had lived outside `globals/` for months, and
 * the gate that owns exactly this question came out green on them.
 *
 * 📌 **The lesson is the same as the first time, one character apart**: a gate
 * written against the cases in front of one's eyes inherits their shape. Here the
 * shape was "it starts with an uppercase", and nobody had laid it down as a rule — it
 * was an accident of the three founding examples. ⚠️ The widening yields NO
 * measurable false positive: the other occurrences of the lowercase form are all in
 * comments, and the comment filter already sets them aside.
 */
const WRITE_RE = /(?:\.GeoLeaf|\b_gl)\.[A-Za-z_][A-Za-z0-9_]*\s*=(?!=)/;

function collect(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === "__tests__" || e.name === "node_modules") continue;
            collect(full, out);
        } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out;
}

const isComment = (l) => {
    const t = l.trim();
    return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
};

let failed = false;
const seen = new Set();
const violations = [];

for (const file of collect(SRC, [])) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    // The globals are the legitimate owners: they write, it is their job.
    // ⚠️ 2026-07-24 — the globals left `modules/` for `globals/`. This test is a
    // regex with escaped slashes: no textual sweep over `modules/` reaches it. Left
    // as-is, it would have stopped recognizing the legitimate owners and GLB-01
    // would have reddened on the 7 files whose job this is.
    if (/^globals\/globals(\.[a-z]+)?\.ts$/.test(rel)) continue;

    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
        if (isComment(line) || !WRITE_RE.test(line)) return;
        if (BASELINE.includes(rel)) {
            seen.add(rel);
            return;
        }
        violations.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
    });
}

if (violations.length) {
    failed = true;
    console.error("\n❌ [GLB-01] Écriture(s) sur le namespace GeoLeaf hors du boot :");
    for (const v of violations) console.error(`   ${v}`);
    console.error(
        "   → Le namespace appartient à `globals/globals.*.ts`. Depuis le S7 c'est un\n" +
            "     contrat public lu par les plugins : une clé montée ailleurs est une clé\n" +
            "     dont personne ne peut garantir la présence au moment où un plugin la lit."
    );
} else {
    console.log("✅ [GLB-01] Le namespace GeoLeaf n'est écrit que par le boot.");
}

const stale = BASELINE.filter((b) => !seen.has(b));
if (stale.length) {
    failed = true;
    console.error("\n❌ [GLB-02] Entrée(s) de baseline devenue(s) inutiles :");
    for (const s of stale) console.error(`   ${s}`);
    console.error("   → Retirez-les de BASELINE dans scripts/verify-globals-ownership.cjs.");
} else {
    console.log("✅ [GLB-02] Baseline à jour — aucune entrée obsolète.");
}

process.exit(failed ? 1 : 0);
