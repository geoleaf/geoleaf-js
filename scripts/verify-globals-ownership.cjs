#!/usr/bin/env node
/**
 * Enforces the contract of the 7 `globals/globals.*.ts` — le pont UMD/ESM du boot.
 *
 * Ces fichiers ne sont PAS des façades : leur métier est précisément d'écrire sur
 * `globalThis.GeoLeaf`, et leur appliquer `check-facade-purity.cjs` serait faux (constat
 * A-07). Le contrat qui leur convient n'est pas la pureté, c'est la PROPRIÉTÉ : le
 * namespace a un seul propriétaire, et c'est le boot.
 *
 * L'enjeu a changé de nature au S7. Depuis que `plugin-addpoi` et `plugin-storage` lisent
 * le core sur `globalThis.GeoLeaf.*` au lieu de l'importer, cette surface est un CONTRAT
 * PUBLIC entre le core et les plugins. Si n'importe quel fichier peut y écrire, personne
 * ne peut plus dire ce qu'elle contient ni quand — et un plugin lisant une clé jamais
 * montée dégrade en silence. C'est exactement la panne que le S7 a trouvée sur `Config`.
 *
 * GLB-01: seuls `globals/globals.*.ts` écrivent sur le namespace, hors baseline.
 * GLB-02: la baseline doit rétrécir — une entrée devenue inutile est signalée.
 *
 * Usage: node scripts/verify-globals-ownership.cjs (from repo root)
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
// T5.5 — par le registre, qui jette si le core est introuvable.
const SRC = path.join(require("./lib/packages.cjs").requireByDirName("core").absDir, "src");

/**
 * Auto-montages de façade tolérés (relevé du 19/07/2026).
 *
 * `check-facade-purity.cjs` autorise explicitement le motif « self-mount » pour les
 * façades ; ces trois-là en relèvent. Ils restent listés parce qu'un auto-montage est
 * une écriture sur le namespace comme une autre : le jour où l'un disparaît, GLB-02 le
 * dira au lieu de laisser une permission dormante.
 */
const BASELINE = [
    "kernel/ui/ui-api.ts",
    "api/geoleaf.sync.ts",
    "kernel/storage/facade.ts",
    // ── `kernel/geojson/style-resolver.ts` est SORTI de la baseline à l'API publique S4.3 ──
    //
    // Il montait `GeoLeaf._StyleRules` au niveau racine du module — donc au simple import,
    // avant la séquence de boot — et posait `globalThis.GeoLeaf = {}` s'il ne trouvait rien :
    // un module feuille du kernel CRÉAIT le namespace public, en course avec la chaîne
    // `globals/` qui en est la propriétaire déclarée. La clé n'avait aucun lecteur de
    // production ; l'écriture est partie avec elle, et l'entrée avec l'écriture.
    //
    // Ce qu'il faut garder de son histoire : elle n'avait été DÉCOUVERTE qu'en élargissant
    // `WRITE_RE`. La première version, qui exigeait un `globalThis.GeoLeaf` littéral, ne
    // voyait pas la forme `(_g as {…}).GeoLeaf.X =` employée là. La gate sortait verte sur
    // un dépôt qui violait déjà son invariant — c'est le motif pour lequel GLB-02 est un
    // cliquet, et pour lequel `WRITE_RE` mérite d'être ré-élargie plutôt que crue.
];

/**
 * Une écriture sur le namespace, sous n'importe quelle forme d'accès.
 *
 * ⚠️ La première version exigeait `globalThis.GeoLeaf` LITTÉRAL, et ratait donc
 * `(globalThis as any).GeoLeaf.X = …` — la forme la plus courante en TypeScript, et
 * celle qu'une violation réelle prendrait. Le gate passait sa propre mutation. Même
 * défaut que le gate de frontière au S0 (`verify-core-standalone`), aveugle à la forme
 * canonique de ce qu'il gardait.
 *
 * On matche donc sur le SUFFIXE `.GeoLeaf.<Clé> =`, quel que soit le porteur, plus la
 * variable locale `_gl` que le boot et les façades emploient.
 */
const WRITE_RE = /(?:\.GeoLeaf|\b_gl)\.[A-Z_][A-Za-z0-9_]*\s*=(?!=)/;

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
    // Les globals sont les propriétaires légitimes : ils écrivent, c'est leur métier.
    // ⚠️ R.9 (24/07/2026) — les globals ont quitté `modules/` pour `globals/`. Ce test
    // est une regex à slashes échappés : aucun balayage textuel sur `modules/` ne
    // l\'atteint. Laissé tel quel, il aurait cessé de reconnaître les propriétaires
    // légitimes et GLB-01 aurait rougi sur les 7 fichiers dont c\'est le métier.
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
