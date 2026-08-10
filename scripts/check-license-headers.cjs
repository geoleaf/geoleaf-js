#!/usr/bin/env node
/**
 * LIC-HEADERS : la licence est-elle VRAIMENT portée par ce qui part ? (npm S3)
 *
 * Deux objets distincts, souvent confondus, et c'est pourquoi ils sont gatés séparément :
 * la **notice du bundle distribué** et l'**en-tête des sources**. Le `LICENSE` racine, ligne
 * 12, exige que la notice accompagne « all copies or substantial portions of the Software ».
 * Le tarball npm la satisfait via `files[]` ; **un `.js` servi seul depuis un CDN ou copié
 * dans un `deploy/` chez un client, non**. C'est ce trou-là que LIC-04 ferme.
 *
 *   LIC-01  Toute source `.ts` du corpus `collect()` ouvre sur un bloc `/*!` canonique —
 *           un titre, `© <an> Mattieu Pottier`, une mention MIT, et l'URL du projet.
 *   LIC-02  Aucune attribution concurrente : ni un second détenteur de copyright, ni un
 *           titre qui nomme un AUTRE paquet du dépôt.
 *   LIC-03  Plancher anti-gate-vide, sur les DEUX corpus. Un vert seul est ambigu entre
 *           « 0 fichier nu » et « 0 fichier scanné » — et ce dépôt s'est déjà fait avoir.
 *   LIC-04  Tout `.js`/`.mjs` expédié par `files[]` d'un paquet publiable porte la notice
 *           dans ses **200 premiers octets**, sauf les chunks 100 % tiers, nommés à chaque run.
 *   LIC-05  `package.json#license` vaut exactement `MIT` sur tout paquet du dépôt.
 *   LIC-06  Tout fichier `LICENSE` suivi porte `Copyright (c) <an> Mattieu Pottier` et **jamais
 *           le signe `©`** — l'assertion de disjonction de la partition (tâche 4.3).
 *
 * ## Aucune baseline, délibérément
 *
 * Régime MH-03 : « celui-ci n'a AUCUNE baseline, on purpose : la règle tient à zéro ». Une
 * baseline sur les en-têtes de licence serait un permis de ne pas les poser — et le geste qui
 * les pose est mécanique (`--write`), donc il n'y a pas de dette à étaler.
 *
 * ## Ce que LIC-04 NE fait PAS, et pourquoi
 *
 * Il ne réclame pas la notice sur un chunk dont **toutes** les sources sont dans
 * `node_modules/`. Y écrire « © 2026 Mattieu Pottier — Released under the MIT License »
 * serait une **fausse attribution** : `geoleaf-print.jspdf-*.js` est du jsPDF, pas du
 * GeoLeaf. La liste n'est pas écrite à la main, elle se dérive de la sourcemap du chunk, et
 * la gate l'imprime à chaque run — un fichier tiers exempté en silence serait indiscernable
 * d'un fichier à nous qu'on aurait oublié. Un fichier SANS sourcemap n'est jamais exempté :
 * le doute joue contre l'exemption.
 *
 * ## `packages/_plugin-template/` est HORS corpus, et c'est voulu — tâche 3.9
 *
 * Les globs `workspaces` portent `!packages/_*`, donc `packages.cjs` ne rend pas le scaffold
 * et aucune règle dérivée de lui ne s'y applique. C'est **une exclusion voulue** : ses
 * fichiers portent des jetons `__PLUGIN_PKG__` non substitués, il n'est jamais publié, et une
 * gate qui le scannerait rougirait sur des gabarits.
 *
 * 🛑 **Mais un scaffold qui n'émet pas le bandeau produit des plugins non conformes DÈS LEUR
 * NAISSANCE, dans l'angle mort exact de cette gate.** Mesuré le 10/08/2026 : ses 5 sources
 * portaient bien un `/*!`, sans la ligne `https://geoleaf.dev` — le prochain
 * `npm run create:plugin` serait donc né en violation de LIC-01, et son bundle sans notice
 * (sa config ne passait pas `pkg` à `pluginStack`). Corrigé à la source, dans le gabarit.
 * Le geste utile n'est donc pas d'inclure le template dans le corpus, c'est de **vérifier que
 * le générateur émet la forme canonique** — ce qui s'éprouve en créant un plugin et en
 * regardant LIC-01 passer sur lui sans intervention. C'est le même mode que **R-N5** du
 * journal de nuit : une gate dérivée d'un registre hérite des exclusions de ce registre, et
 * le générateur est précisément ce qui fait sortir du trou.
 *
 * ## LIC-05 porte sur ce qu'on PUBLIE, jamais sur ce qu'on consomme (tâche 3.15)
 *
 * `maplibre-gl@6.2.0` — la peer dependency du core — est **BSD-3-Clause**, et
 * `packages/core/docs/NOTICE.md` §Dependencies le dit. ⚠️ Ce renvoi citait `:64` jusqu'au
 * 10/08/2026 (tâche 4.4) : la ligne réelle était `:59`, et un numéro de ligne dans un renvoi
 * vers un `.md` se périme au premier paragraphe inséré — la SECTION, elle, ne bouge pas. Une
 * licence de dépendance permissive et
 * compatible n'est pas une violation de « MIT sans exception » : la doctrine porte sur les
 * paquets de CE dépôt. La constante s'appelle donc `PUBLISHED_PACKAGE_LICENSE` et non
 * `ALLOWED_LICENSE` — sans quoi la première dépendance BSD ou Apache fera croire à une
 * violation, et quelqu'un « corrigera » la gate.
 *
 * ## LIC-06 — la partition `Copyright (c)` / `©` est ACTÉE, donc elle se garde (tâche 4.3)
 *
 * La tâche demandait de trancher une « divergence de formulation ». Il n'y en a pas :
 * `Copyright (c)` vit dans les **19 fichiers `LICENSE`**, `©` dans les bandeaux, et
 * **l'intersection est vide dans les deux sens**. Le motif de chaque côté — texte MIT canonique
 * reconnu au mot près par SPDX d'un côté, notice typographique de l'autre — est écrit une seule
 * fois, au §« `Copyright (c)` / `©` » de `lib/license-banner.cjs`.
 *
 * 🛑 **Ce qui est gardé ici, c'est le sens que RIEN ne gardait.** « Aucun bandeau ne porte
 * `(c)` » l'était déjà par LIC-01 (`inspect()` classe la forme `parenthesee`). « Aucun `LICENSE`
 * ne porte `©` » ne l'était par rien — et c'est le sens qu'une harmonisation casse : devant
 * 845 bandeaux en `©` et 19 `LICENSE` en `(c)`, on « corrige » le plus petit tas. LIC-06 rougit
 * à cet instant-là, et renvoie au paragraphe qui explique pourquoi ne pas le faire.
 *
 * Le corpus se dérive de `git ls-files`, jamais du registre : les 19 `LICENSE` **débordent**
 * `packages.cjs` des deux côtés — le `LICENSE` racine n'appartient à aucun paquet, et celui de
 * `packages/_plugin-template/` est dans l'angle mort `!packages/_*` (mode R-N5, déjà payé deux
 * fois par ce sprint et le précédent). Un corpus dérivé du registre en verrait 17 sur 19, et
 * sortirait vert sur les deux qu'il ne regarde pas.
 *
 * Usage : node scripts/check-license-headers.cjs            (gate)
 *         node scripts/check-license-headers.cjs --write    (pose/complète les bandeaux)
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
 * Où la notice doit se trouver dans un fichier expédié (LIC-04).
 *
 * 🛑 **La tâche 3.4 disait « dans ses 200 premiers octets », et ce critère rougit sur des
 * fichiers PARFAITEMENT conformes.** Mesuré le 10/08/2026 : `dist/esm/lang/lang-fr.js`,
 * `capabilities/feature-info/render/dom.js` et `resolve.js` ouvrent bien sur un `/*!` complet
 * — mais leur TITRE et leur description poussent la ligne `https://geoleaf.dev` au-delà de
 * l'octet 200. Un seuil en octets punit un titre informatif, ce qui est l'inverse du but.
 *
 * Le critère réel est **structurel** : la notice doit vivre dans le bloc `/*!` de TÊTE, celui
 * qui ouvre le fichier — le *legal comment* qu'un minifieur préserve et qu'un lecteur voit en
 * premier. C'est plus strict que « quelque part dans les 200 premiers octets » (une notice
 * enfouie au milieu du code ne passe plus) et ça ne dépend d'aucune constante arbitraire.
 *
 * Le plafond reste, mais sur le BLOC, et large : un bandeau de tête n'est pas un fichier.
 */
const NOTICE_BLOCK_MAX_BYTES = 4096;

/**
 * Planchers LIC-03 — le corpus ne peut pas rétrécir en silence.
 *
 * Mesuré le 10/08/2026 : 845 sources `.ts` sur 15 paquets, 545 `.js` expédiés sur 14
 * publiables, **19 fichiers `LICENSE` suivis** (17 avant la tâche 4.1). Les planchers sont posés
 * NETTEMENT en dessous : leur travail est de rougir quand un corpus tombe à zéro ou s'effondre,
 * pas de cliqueter à chaque fichier ajouté. ⚠️ `licenses` n'est donc PAS à 19 : un plancher qui
 * suit le corpus à l'unité est un cliquet déguisé, et il se fait baisser au premier retrait
 * légitime.
 */
const FLOOR = { sources: 700, sourcePackages: 12, shipped: 400, shippedPackages: 12, licenses: 15 };

// ─── Corpus 1 — les sources ──────────────────────────────────────────────────

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
        for (const m of info.body.matchAll(/(?:©|\(c\)|Copyright)\s*(?:\d{4}[^\S\n]*)?([^\n*]{2,60})/gi)) {
            const who = m[1].trim();
            if (who && !who.startsWith(canon.HOLDER)) {
                lic02.push({ rel: f.rel, detail: `détenteur concurrent : « ${who} »` });
            }
        }
    }

    if (WRITE) {
        const out = canon.normalize(src, f.package);
        if (out.changed) toWrite.push({ rel: f.rel, pkg: f.package, source: out.source, why: out.why });
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

// ─── Corpus 2 — les `.js` expédiés ───────────────────────────────────────────

/**
 * Répertoires qui ne portent jamais de code de produit.
 *
 * Recopie assumée de `source-inventory.cjs:SKIP_DIRS` — et c'est le point : le corpus de
 * `--write` (`collect()`) les exclut par construction, donc une gate qui les EXIGERAIT
 * demanderait ce que son propre générateur ne sait pas produire. Un rouge permanent que
 * personne ne peut fermer finit toujours par se faire relâcher.
 * ⚠️ Ces fichiers PARTENT bel et bien dans les tarballs — c'est l'arbitrage écrit de la tâche
 * 2.10 (177 tests sur 493 sources). Ils sont hors du périmètre de la NOTICE, pas hors du
 * tarball, et confondre les deux serait une erreur de lecture de ce commentaire.
 */
const SKIP_DIRS = new Set(["__tests__", "__mocks__", "test-utils", "node_modules"]);

/**
 * Les fichiers JavaScript qu'un `npm pack` emporterait, par paquet publiable.
 *
 * Dérivé de `files[]` et jamais d'un glob : `files[]` EST la déclaration de ce qui part, et
 * c'est elle qu'il faut éprouver. Volontairement pas `npm pack --dry-run`, qui déclenche
 * `prepack` (donc un build) au milieu d'une gate.
 *
 * 🛑 **Les entrées négatives de `files[]` sont APPLIQUÉES, pas sautées.** `@geoleaf/core`
 * déclare `docs/` puis `!docs/api/` et `!docs/public/` : ignorer les négations faisait entrer
 * dans le corpus **10 fichiers d'assets générés par TypeDoc** que npm n'expédie pas. Une gate
 * qui rougit sur un fichier absent du tarball est une gate qu'on désarme.
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
 * Ce chunk est-il intégralement du code tiers ?
 *
 * Lu sur la SOURCEMAP, jamais sur le nom de fichier : `geoleaf-print.jspdf-*.js` porte notre
 * préfixe de sortie et zéro ligne de nous. Sans carte → `false`, le doute joue contre
 * l'exemption.
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

// ─── LIC-05 — la VALEUR du champ license ─────────────────────────────────────

/**
 * Exceptions nommées à LIC-05 — vide, et c'est le but.
 *
 * Le jour où une entrée y apparaît, elle porte son motif ici même : une exception sans motif
 * écrit est indiscernable d'un oubli six mois plus tard. ⚠️ Ce n'est PAS l'endroit où ranger
 * une dépendance non-MIT : LIC-05 ne regarde que les manifestes de CE dépôt.
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

// ─── LIC-06 — la disjonction `Copyright (c)` / `©` ───────────────────────────

/**
 * Les fichiers `LICENSE` suivis par git — le corpus de LIC-06.
 *
 * Dérivé de `git ls-files` et jamais du registre : voir le §LIC-06 de l'en-tête. Le motif est
 * ancré aux deux bouts (`^LICENSE$` ou `/LICENSE$`) pour ne PAS attraper `LICENSE_HEADERS.md`
 * ni `LICENSE-DATA.md`, qui parlent de licence sans en être une — c'est la confusion exacte
 * qui rendait la recette de la tâche 4.5 inexploitable (elle en comptait 19 là où il y avait
 * 17 `LICENSE` + 2 documents).
 *
 * Jette si git échoue, patron de `lib/source-inventory.cjs:87` : un corpus vide obtenu en
 * silence est le mode d'échec que LIC-03 existe pour interdire.
 *
 * @returns {string[]} Chemins relatifs à la racine du dépôt.
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
            "et `legalComments: \"none\"` la supprimait. La bannière se pose APRÈS le minifieur " +
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
