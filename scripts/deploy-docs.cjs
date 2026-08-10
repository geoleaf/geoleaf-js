#!/usr/bin/env node
/**
 * deploy-docs.cjs
 *
 * Deployment pipeline for GeoLeaf public documentation:
 *   1. Regenerate TypeDoc API reference (v2.0.0)
 *   2. Copy docs/api/ → docs/public/api/ (VitePress static asset)
 *   3. Build VitePress → docs-dist/ (racine — T4.4 l'a sorti de packages/)
 *   4. Sync docs-dist/ → <site>/docs/
 *   5. Auto-generate <site>/assets/data/news.json from CHANGELOG.md
 *
 * ## Le SEUL canal de publication de la doc (arbitrage 4.8, option (c), 25/07/2026)
 *
 * Cette publication est **manuelle** : `npm run docs:deploy`, lancé par un humain. Aucun
 * workflow GitHub ne la déclenche — `packages/core/.github/workflows/deploy-docs.yml`,
 * supprimé au T3.3, ne s'exécutait de toute façon jamais (GitHub ne lit les workflows
 * qu'à la racine du dépôt), et le quota Actions du compte est rare. Ne pas en recréer un
 * sans rouvrir 4.8 : le dépôt aurait alors deux politiques documentaires.
 *
 * ## Où ce script écrit — les deux moitiés, et pourquoi elles diffèrent
 *
 * **Hors du dépôt** (étapes 4 et 5), sous `GEOLEAF_DOCS_SITE_ROOT`. C'était le point le
 * plus risqué du dépôt jusqu'au T5.1 : la cible était atteinte par QUATRE `..` en dur,
 * et `syncDir` la détruisait récursivement. Sur une machine où le dépôt n'est pas à cette
 * profondeur exacte, ce qui était détruit n'était pas déterminé. La variable est
 * désormais OBLIGATOIRE et sans défaut — un défaut aurait conservé la supposition qu'on
 * retire.
 *
 * **Dans `packages/core/docs/`** (étapes 1, 2 et 2b) : `api/`, `public/api/` et
 * `public/logo.png`. ⚠️ Ces trois-là RESTENT sur place, et ce n'est pas un oubli du
 * T5.3 : `public/` est le répertoire d'assets statiques de VitePress, résolu contre
 * `srcDir` — le déplacer casserait le build. Ils sont gitignorés depuis le T4.1 et exclus
 * de `files[]` par négation, donc ils ne sont ni versionnés ni publiés : le défaut que
 * T5.3 visait est traité, l'emplacement ne l'était pas.
 */

"use strict";

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const registry = require("./lib/packages.cjs");

// ── Paths ────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "..");
// Résolu par le registre, jamais par `path.join(ROOT, "packages", "core")` : un chemin en
// dur ne casse pas au déplacement, il cesse silencieusement de matcher. `requireByDirName`
// jette si le paquet est introuvable, ce qui est le comportement voulu ici — ce script
// écrit, et un chemin périmé publierait à côté.
const CORE = registry.requireByDirName("core").absDir;
const DOCS_SRC = path.join(CORE, "docs");
const TYPEDOC_OUT = path.join(DOCS_SRC, "api");
const VITEPRESS_PUBLIC_API = path.join(DOCS_SRC, "public", "api");
const CHANGELOG_SRC = path.join(DOCS_SRC, "CHANGELOG.md");
const BUILD_OUT = path.join(ROOT, "docs-dist");

/**
 * Échec attendu du pipeline — une cible douteuse, une source absente.
 *
 * ⚠️ Les gardes JETTENT au lieu d'appeler `process.exit(1)`, et c'est ce qui les rend
 * PROUVABLES. Un `process.exit` tue le processus appelant : `probe-gate-visibility.cjs`
 * ne pourrait pas les exercer, et la correction la plus coûteuse du T5 — l'ordre
 * détruire/constater de `syncDir` — resterait gardée par rien du tout. `main()` attrape
 * et sort en 1 : le comportement en ligne de commande est inchangé.
 */
class DeployError extends Error {
    constructor(message) {
        super(message);
        this.name = "DeployError";
    }
}

/**
 * Racine du site publié — `GEOLEAF_DOCS_SITE_ROOT`, obligatoire, sans défaut (Q4).
 *
 * Les trois cibles externes en dérivent, de sorte que la profondeur du dépôt n'est
 * supposée nulle part. La validation tourne AVANT l'étape 1 : une cible fausse doit
 * arrêter le script pendant qu'il n'a encore rien détruit, pas au moment où l'étape 4
 * appelle `rmSync`.
 */
function resolveSiteRoot(raw = process.env.GEOLEAF_DOCS_SITE_ROOT, root = ROOT) {
    if (!raw || !raw.trim()) {
        throw new DeployError(
            `GEOLEAF_DOCS_SITE_ROOT n'est pas définie.\n\n` +
                `  Ce script SUPPRIME récursivement <site>/docs/ avant de le réécrire, et\n` +
                `  écrit <site>/assets/data/news.json. Il n'a pas de cible par défaut : la\n` +
                `  précédente était atteinte par quatre « .. » en dur, ce qui rendait la\n` +
                `  cible indéterminée dès que le dépôt changeait de profondeur.\n\n` +
                `  Exemple :\n` +
                `    GEOLEAF_DOCS_SITE_ROOT=/chemin/vers/Sites_Web/geoleaf.dev npm run docs:deploy`
        );
    }

    const abs = path.resolve(raw);
    const fail = (why) => {
        throw new DeployError(`GEOLEAF_DOCS_SITE_ROOT « ${abs} » — ${why}`);
    };

    // Les cinq gardes portent sur ce qui va être DÉTRUIT. Un `rmSync` récursif dont la
    // cible vient d'une variable d'environnement doit échouer sur une valeur douteuse,
    // jamais s'exécuter « au cas où ».
    if (abs === path.parse(abs).root) fail("c'est la racine du système de fichiers.");
    if (abs === root) fail("c'est la racine du dépôt.");
    if (!path.relative(root, abs).startsWith("..")) {
        fail("ce chemin est DANS le dépôt — la doc publiée vit dehors.");
    }
    if (!fs.existsSync(abs)) fail("ce répertoire n'existe pas.");
    if (!fs.statSync(abs).isDirectory()) fail("ce chemin n'est pas un répertoire.");

    return abs;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd, cwd = ROOT) {
    console.log(`\n▶ ${cmd}`);
    execSync(cmd, { cwd, stdio: "inherit" });
}

function copyDir(src, dest) {
    if (!fs.existsSync(src)) {
        console.warn(`  ⚠ Source not found, skipping copy: ${src}`);
        return;
    }
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Remplace intégralement `dest` par le contenu de `src`.
 *
 * ⚠️ L'ORDRE est la correction du T5.1, et c'était le défaut le plus coûteux du script.
 * Avant : `rmSync(dest)` d'abord, `copyDir(src, dest)` ensuite — et `copyDir` se contente
 * d'un `console.warn` quand la source manque. La cible externe était donc **effacée sans
 * être remplacée, en exit 0** : la doc publiée disparaissait et le script annonçait un
 * succès. Ce n'était pas théorique — T4.4 a déplacé `docs-dist/` hors de `packages/`, et
 * pendant la fenêtre où `BUILD_OUT` pointait encore l'ancien chemin, c'est exactement ce
 * qu'un `npm run docs:deploy` aurait fait.
 *
 * Même famille que le `continue` des workflows de miroir supprimés au S9.0 : un
 * dispositif destructeur qui traite l'absence de source comme un cas bénin.
 */
function syncDir(src, dest) {
    if (!fs.existsSync(src)) {
        throw new DeployError(
            `source absente — ${src}\n` + `  Rien n'a été supprimé. La cible ${dest} est intacte.`
        );
    }
    if (fs.readdirSync(src).length === 0) {
        throw new DeployError(
            `source VIDE — ${src}\n` +
                `  Rien n'a été supprimé. Publier un répertoire vide effacerait la doc en ligne.`
        );
    }
    if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
    }
    copyDir(src, dest);
}

function countFiles(dir) {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    function walk(d) {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            if (entry.isDirectory()) walk(path.join(d, entry.name));
            else count++;
        }
    }
    walk(dir);
    return count;
}

/** Strip markdown bold, inline code, and links from a bullet text. */
function stripMarkdown(text) {
    return text
        .replaceAll("**", "")
        .replaceAll(/`([^`]+)`/g, "$1")
        .replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();
}

/** Resolve the section key from a ### heading line. */
function resolveSectionKey(heading, entry) {
    const sec = heading.toLowerCase();
    if (sec.includes("breaking")) {
        entry.breaking = true;
        return "breaking";
    }
    if (sec.includes("added") || sec.includes("ajout")) return "added";
    if (sec.includes("fixed") || sec.includes("correction")) return "fixed";
    if (sec.includes("removed") || sec.includes("suppri")) return "removed";
    return null;
}

/** Push a bullet text into the correct array of a version entry. */
function pushBullet(entry, sectionKey, text) {
    if (sectionKey === "added") entry.ajouts.push(text);
    else if (sectionKey === "fixed") entry.correctifs.push(text);
    else if (sectionKey === "removed") entry.suppressions.push(text);
}

/** Build a human-readable title from the first Added bullet. */
function buildTitle(version, ajouts) {
    if (!ajouts.length) return `GeoLeaf v${version}`;
    const firstBullet = ajouts[0].replace(/^[^:—–]+[:\-–]\s*/, "").substring(0, 60);
    return `GeoLeaf v${version} — ${firstBullet}`;
}

/** Process one line against the current version entry; return updated section key. */
function processLine(line, current, currentSection) {
    const sectionMatch = line.match(/^### (.+)/);
    if (sectionMatch) return resolveSectionKey(sectionMatch[1], current);

    const bulletMatch = line.match(/^- (.+)/);
    if (bulletMatch && currentSection) {
        const text = stripMarkdown(bulletMatch[1]);
        if (text.length >= 3) pushBullet(current, currentSection, text);
    }
    return currentSection;
}

/**
 * Parse CHANGELOG.md (Keep a Changelog format) and return the last N versions
 * as objects matching the news.json patchnotes schema.
 */
function parseChangelog(changelogPath, maxVersions = 5) {
    const lines = fs.readFileSync(changelogPath, "utf-8").split("\n");
    const versions = [];
    let current = null;
    let currentSection = null;

    for (const line of lines) {
        const versionMatch = line.match(/^## \[(\d+\.\d+\.\d+)\]\s*-\s*(\d{4}-\d{2}-\d{2})/);
        if (versionMatch) {
            if (current) versions.push(current);
            if (versions.length >= maxVersions) break;
            current = {
                version: versionMatch[1],
                date: versionMatch[2],
                title: "",
                breaking: false,
                ajouts: [],
                correctifs: [],
                suppressions: [],
            };
            currentSection = null;
            continue;
        }
        if (current) currentSection = processLine(line, current, currentSection);
    }
    if (current && versions.length < maxVersions) versions.push(current);

    for (const v of versions) v.title = buildTitle(v.version, v.ajouts);
    return versions;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
    const SITE_ROOT = resolveSiteRoot();
    const LOGO_SRC = path.join(SITE_ROOT, "assets", "img", "geoleaf", "logo.png");
    const LOGO_DEST = path.join(DOCS_SRC, "public", "logo.png");
    const DEPLOY_TARGET = path.join(SITE_ROOT, "docs");
    const NEWS_JSON = path.join(SITE_ROOT, "assets", "data", "news.json");

    console.log("═══════════════════════════════════════════════");
    console.log("  GeoLeaf Docs Deploy Pipeline");
    console.log("═══════════════════════════════════════════════");
    console.log(`  Core    : ${CORE}`);
    console.log(`  Output  : ${BUILD_OUT}`);
    console.log(`  Site    : ${SITE_ROOT}  (GEOLEAF_DOCS_SITE_ROOT)`);
    console.log(`  Target  : ${DEPLOY_TARGET}  ⚠ supprimé puis réécrit`);
    console.log("═══════════════════════════════════════════════\n");

    // Step 1 — Regenerate TypeDoc
    console.log("── Step 1 : TypeDoc API reference ──────────────");
    run("npm run docs:api", CORE);
    console.log(`  ✓ TypeDoc output: ${TYPEDOC_OUT}`);

    // Step 2 — Copy api/ → public/api/ for VitePress static serving
    console.log("\n── Step 2 : Copy api/ → public/api/ ────────────");
    if (fs.existsSync(VITEPRESS_PUBLIC_API)) {
        fs.rmSync(VITEPRESS_PUBLIC_API, { recursive: true, force: true });
    }
    copyDir(TYPEDOC_OUT, VITEPRESS_PUBLIC_API);
    console.log(`  ✓ Copied ${countFiles(VITEPRESS_PUBLIC_API)} files to public/api/`);

    // Step 2b — Copy logo from the published site into docs/public/
    console.log("\n── Step 2b : Copy logo → docs/public/ ──────────");
    if (fs.existsSync(LOGO_SRC)) {
        fs.mkdirSync(path.dirname(LOGO_DEST), { recursive: true });
        fs.copyFileSync(LOGO_SRC, LOGO_DEST);
        console.log(`  ✓ Logo copied: ${LOGO_SRC} → ${LOGO_DEST}`);
    } else {
        console.warn(`  ⚠ Logo source not found, skipping: ${LOGO_SRC}`);
    }

    // Step 3 — Build VitePress
    console.log("\n── Step 3 : VitePress build ─────────────────────");
    run("npm run docs:build", CORE);
    console.log(`  ✓ Build output: ${BUILD_OUT} (${countFiles(BUILD_OUT)} files)`);

    // Step 4 — Sync to <site>/docs/
    // Pas de `mkdirSync` préalable : `syncDir` valide la source AVANT de toucher à la
    // cible, et `copyDir` crée la destination. Créer la cible en amont revenait à préparer
    // le terrain d'une suppression qu'on n'a pas encore le droit de faire.
    console.log("\n── Step 4 : Sync to <site>/docs/ ───────────────");
    syncDir(BUILD_OUT, DEPLOY_TARGET);
    console.log(`  ✓ Deployed ${countFiles(DEPLOY_TARGET)} files to ${DEPLOY_TARGET}`);

    // Step 5 — Auto-generate news.json from CHANGELOG.md
    console.log("\n── Step 5 : Generate news.json ──────────────────");
    const patchnotes = parseChangelog(CHANGELOG_SRC);
    const newsData = {
        lastUpdated: new Date().toISOString().slice(0, 10),
        patchnotes,
    };
    fs.mkdirSync(path.dirname(NEWS_JSON), { recursive: true });
    fs.writeFileSync(NEWS_JSON, JSON.stringify(newsData, null, 2) + "\n", "utf-8");
    console.log(`  ✓ news.json updated (${patchnotes.length} versions) → ${NEWS_JSON}`);

    // ⚠️ Il y avait ici une étape 6 : `docs/CHANGELOG.md` → `packages/core/CHANGELOG.md`,
    // annoncée « (npm consumers) ». Elle n'atteignait AUCUN consommateur npm et a été
    // retirée au T5.2. Mesure par `npm pack --dry-run -w @geoleaf/core` : le tarball
    // contient `docs/CHANGELOG.md` (174,2 ko) — c'est-à-dire la SOURCE de la copie — et
    // aucun `CHANGELOG.md` à la racine du paquet. `files[]` liste `dist/`, `README.md`,
    // `docs/` et `LICENSE` ; npm n'ajoute d'office que package.json, README et LICENSE,
    // pas CHANGELOG. Le fichier écrit était du bruit versionné : 35 ko, 0 référent.

    console.log("\n═══════════════════════════════════════════════");
    // La cible est nommée, jamais supposée : « geoleaf.dev/docs/ » était écrit en dur ici
    // et serait devenu faux dès que GEOLEAF_DOCS_SITE_ROOT pointe ailleurs — ce que ce
    // sprint vient précisément de rendre possible.
    console.log(`  ✅ Deploy complete — ${DEPLOY_TARGET} updated`);
    console.log("═══════════════════════════════════════════════\n");
}

// ── Exécution vs lecture ─────────────────────────────────────────────────────
//
// Ce script n'est invoqué par AUCUNE CI — ni `ci-local.cjs`, ni `ci.yml`, ni le hook. Il
// est lancé à la main, rarement, et c'est le plus destructeur du dépôt. Sa correction la
// plus importante (l'ordre détruire/constater de `syncDir`) n'était donc gardée par rien :
// elle ne tenait qu'aux mutations manuelles du T5.
//
// L'export ferme ça. `probe-gate-visibility.cjs` exerce `syncDir` et `resolveSiteRoot`
// sur un répertoire temporaire à chaque `ci:local`. C'est le même geste que pour
// `ci-local.cjs` au T5.8, pour la même raison : un fichier qui s'exécute à l'import ne
// peut être vérifié par personne.
if (require.main === module) {
    try {
        main();
    } catch (err) {
        if (err instanceof DeployError) {
            console.error(`✘ deploy-docs : ${err.message}`);
            process.exit(1);
        }
        throw err;
    }
}

module.exports = { syncDir, resolveSiteRoot, DeployError };
