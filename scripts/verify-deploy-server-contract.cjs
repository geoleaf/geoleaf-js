#!/usr/bin/env node
"use strict";
/**
 * verify-deploy-server-contract.cjs — what we ship SAYS what it requires.
 *
 * ## The hole this gate closes
 *
 * On 2026-08-09, `deploy-full` was copied as-is onto an nginx production server.
 * The spinner spun indefinitely. Single cause, spelled out by the first console
 * line: the server served the MapLibre engine's `.mjs` as
 * `application/octet-stream`, and the browser refuses to execute a module under
 * that type.
 *
 * 🛑 **The repo KNEW.** `docker/nginx.dev.conf` carries the directive, preceded by
 * "WITHOUT THIS LINE, NOTHING BOOTS" and an admission describing exactly what was
 * going to happen: "⚠️ This constraint LIVES OUTSIDE THE REPO for the integrator —
 * no gate can see it at their place".
 *
 * It was thus not a knowledge hole but a **diffusion** hole. The knowledge lived in
 * a development file that does not travel with the folder; the deliverable carried
 * no companion file, and the build's last printed text advised "Serve via http" —
 * which the page's CSP makes impossible.
 *
 * ## What this gate can do, and what it cannot
 *
 * It verifies that the recipe **travels with the folder** and **says the one thing
 * without which nothing starts**. It obviously cannot verify the client's server:
 * that side belongs to nobody here, and that is precisely why the recipe must
 * travel.
 *
 *   SC-01  each shipping variant carries the 3 companion files.
 *   SC-02  the 2 server recipes actually declare the `.mjs` MIME type.
 *          → a present-but-mute file is the failure mode this gate exists to
 *            avoid, not a half success.
 *   SC-03  anti-empty-gate assertion, two-storey: at least one variant scanned,
 *          and the variant contains at least one `.mjs`.
 *          → without the second, the day MapLibre stopped being ESM-only, this
 *            gate would keep requiring — while going green — a recipe grown
 *            pointless. A guard that can no longer redden guards nothing
 *            (cf. `probe-gate-visibility.cjs`).
 *   SC-04  the 2 server recipes declare the security-header triad
 *          (X-Content-Type-Options / X-Frame-Options / CSP `frame-ancestors`).
 *          → SC-02 proved the recipe travels and boots; nothing proved it still
 *            carried the headers it ships FOR, so a silent removal went green.
 *            HSTS is excluded on purpose — a cautious integrator may hold it back
 *            until their HTTPS is stable (see the recipe's own note).
 *
 * ⚠️ **SC-02 re-reads the disk, it does not compare the generator to itself.**
 * Verifying that `serverContractFiles()` contains what `serverContractFiles()`
 * contains would be a tautology — the failure mode `verify-app-template.cjs` names
 * in its own header. What is measured is the EMITTED file, hence the full chain
 * generator → build → disk.
 *
 * ## Seen red before being believed (2026-08-09)
 *
 *   • one of the 3 files removed from the deliverable   → SC-01 red
 *   • `mjs` line removed from the emitted `nginx.conf.example` → SC-02 red
 *   • gate pointed at a variant without `.mjs`          → SC-03 red
 *   • a security header removed from the emitted recipe → SC-04 red
 */

const fs = require("node:fs");
const path = require("node:path");

const {
    SERVER_CONTRACT_FILES,
    MJS_MIME_TOKEN,
    declaresMjsType,
    missingSecurityHeaders,
    carriesServerContract,
} = require("./lib/server-contract.cjs");

const ROOT = path.resolve(__dirname, "..");
const DEPLOY = path.join(ROOT, "deploy");

const C = {
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    x: "\x1b[0m",
};

/** The two files carrying a server recipe — `SERVEUR.md` is prose. */
const RECIPE_FILES = ["nginx.conf.example", ".htaccess"];

/** @type {string[]} */
const errors = [];
const stats = { variants: 0, covered: 0, files: 0, mjs: 0 };

/**
 * Counts a tree's `.mjs`, without descending into what is not served.
 * @param {string} dir
 * @returns {number}
 */
function countMjs(dir) {
    let n = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) n += countMjs(full);
        else if (entry.name.endsWith(".mjs")) n += 1;
    }
    return n;
}

if (!fs.existsSync(DEPLOY)) {
    console.error(
        `${C.red}${C.bold}✖ DEPLOY-SERVER-CONTRACT${C.x} — ${path.relative(ROOT, DEPLOY)}/ est ` +
            `introuvable.\n  ${C.dim}Rien à vérifier, et un vert ici serait un verdict sur le ` +
            `vide. Construire d'abord : npm run build:deploy${C.x}`
    );
    process.exit(1);
}

const variantDirs = fs
    .readdirSync(DEPLOY, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

for (const variant of variantDirs) {
    stats.variants += 1;
    const dir = path.join(DEPLOY, variant);

    if (!carriesServerContract(variant)) {
        console.log(
            `${C.yellow}↷${C.x} ${variant} ${C.dim}— servie sur le poste uniquement, ` +
                `pas de contrat serveur attendu${C.x}`
        );
        continue;
    }
    stats.covered += 1;

    // ── SC-01 — the 3 files are there ────────────────────────────────────────
    /** @type {string[]} */
    const present = [];
    for (const name of SERVER_CONTRACT_FILES) {
        const file = path.join(dir, name);
        if (!fs.existsSync(file)) {
            errors.push(
                `SC-01 ${variant}/${name} — absent. Une variante qui part chez quelqu'un doit ` +
                    `dire ce qu'elle exige de son serveur ; sans ce fichier, la recette reste ` +
                    `dans docker/nginx.dev.conf, que l'exploitant ne lira jamais. Émission : ` +
                    `scripts/lib/server-contract.cjs, appelée par build-deploy.cjs.`
            );
            continue;
        }
        present.push(name);
        stats.files += 1;
    }

    // ── SC-02 — the recipes say the one thing that blocks ────────────────────
    for (const name of RECIPE_FILES) {
        if (!present.includes(name)) continue; // already flagged by SC-01
        const body = fs.readFileSync(path.join(dir, name), "utf-8");
        if (!declaresMjsType(body)) {
            errors.push(
                `SC-02 ${variant}/${name} — aucune LIGNE DE DIRECTIVE n'associe \`${MJS_MIME_TOKEN}\` ` +
                    `à l'extension \`.mjs\`. C'est la seule exigence dont l'absence empêche le ` +
                    `boot : un fichier présent qui ne la porte pas donne une fausse assurance, ` +
                    `ce qui est pire que son absence.\n` +
                    `        Attendu — nginx : \`text/javascript mjs;\` dans un bloc \`types\` · ` +
                    `Apache : \`AddType text/javascript .mjs\`.\n` +
                    `        Les lignes commentées ne comptent pas, et les deux jetons doivent ` +
                    `être sur la même ligne — voir \`declaresMjsType()\` et le motif du dépouillement.`
            );
        }

        // ── SC-04 — the recipes carry the security-header triad ──────────────
        const missing = missingSecurityHeaders(body);
        if (missing.length) {
            errors.push(
                `SC-04 ${variant}/${name} — en-tête(s) de sécurité de la recette absent(s) : ` +
                    `${missing.join(", ")}. La triade X-Content-Type-Options / X-Frame-Options / ` +
                    `CSP \`frame-ancestors\` voyage avec le livrable pour son serveur ; sans cette ` +
                    `gate, un retrait sortait vert — SC-02 ne juge que le type MIME. Émission : ` +
                    `scripts/lib/server-contract.cjs.`
            );
        }
    }

    // ── SC-03 (2/2) — the recipe still has a subject ─────────────────────────
    const mjs = countMjs(dir);
    stats.mjs += mjs;
    if (mjs === 0) {
        errors.push(
            `SC-03 ${variant} — la variante ne contient AUCUN fichier \`.mjs\`, alors que tout ` +
                `le contrat serveur existe pour eux. Soit le moteur n'est plus livré en modules ` +
                `— et la recette est à réécrire, pas à maintenir —, soit la variante est ` +
                `incomplète. Dans les deux cas, un vert ici ne voudrait rien dire.`
        );
    }
}

// ── SC-03 (1/2) — the scan is not empty ──────────────────────────────────────
//
// 🛑 WITHOUT THIS BLOCK, THIS GATE IS DECORATIVE. A variant-less `deploy/`, a
// rename, an exclusion widened by mistake: in all three cases zero missing files,
// hence green. Same reasoning as DNS-04 in `verify-deploy-no-secrets.cjs`, and same
// motive — this repo has already paid this class twice.
if (stats.covered === 0) {
    errors.push(
        `SC-03 — aucune variante attendue porteuse de contrat sous ${path.relative(ROOT, DEPLOY)}/ ` +
            `(vues : ${variantDirs.join(", ") || "aucune"}). Le scan n'a rien couvert, et un ` +
            `verdict sur un corpus vide n'est pas un verdict.`
    );
}

// ── Verdict ──────────────────────────────────────────────────────────────────

const scanned =
    `${stats.covered}/${stats.variants} variante(s) porteuse(s), ` +
    `${stats.files} fichier(s) de contrat, ${stats.mjs} module(s) .mjs couvert(s)`;

if (errors.length) {
    console.error(
        `\n${C.red}${C.bold}✖ DEPLOY-SERVER-CONTRACT — ${errors.length} défaut(s)${C.x}\n`
    );
    for (const e of errors) console.error(`  ${C.red}•${C.x} ${e}`);
    console.error(`\n  ${C.dim}Scanné : ${scanned}${C.x}\n`);
    process.exit(1);
}

console.log(
    `${C.green}✔ DEPLOY-SERVER-CONTRACT${C.x} : chaque livrable emporte sa recette serveur — ` +
        `4 invariants tenus (présence, type MIME .mjs déclaré, triade d'en-têtes de sécurité, ` +
        `scan non vide).\n  ${C.dim}Scanné : ${scanned}${C.x}`
);
