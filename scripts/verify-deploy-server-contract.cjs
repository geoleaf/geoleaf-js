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
 *   SC-05  the 2 server recipes declare `no-cache` on `profiles/geoleaf.config.json`.
 *          → that file carries `data.profileVersion`, the fingerprint invalidating
 *            every other profile resource, and A TOKEN CANNOT INVALIDATE THE FILE
 *            THAT CARRIES IT. Pinned, it defeats the whole mechanism in silence:
 *            the server serves the new content, `curl` confirms it, and the page
 *            keeps showing the old one for as long as the header lasts — measured
 *            at SEVEN DAYS on 06/09/2026.
 *          → ⚠️ `SERVEUR.md` §8 prescribed this rule while NEITHER recipe
 *            implemented it. A table that prescribes and a recipe that does not is
 *            worse than silence: the integrator copies the recipe and reads the
 *            table as confirmation of a coverage they do not have.
 *   SC-06  the 2 server recipes DELIVER the `no-cache` §8 promises — judged on the header
 *          each server would SEND, for every file the table names.
 *          → SC-05 reads one block; a server reads them all and picks, and the two pick in
 *            OPPOSITE directions: nginx stops at the first regular expression that matches,
 *            Apache lets the last one win. The nginx recipe named `init.js` and `sw-core.js`
 *            beside `no-cache`, UNDER a block matching every `.js`: both were served
 *            `immutable` for a year, and the block written for them was never reached.
 *   SC-07  every file a recipe WOULD SEND `immutable` is asked for BY CONTENT: its name carries
 *          a hash, or every reference to it in `index.html`, `init.js` and `sw-core.js`
 *          carries `?v=` and that token is the fingerprint of the bytes SERVED.
 *          → §8's motive for pinning `dist/**` is « named after their content ». The GeoJSON
 *            worker, the stylesheet and every plugin loaded on demand were not, and were
 *            rewritten at each build under one name.
 *          → the token is recomputed here from the file: a build step rewriting a bundle
 *            AFTER its token was written is what this catches, and it caught one — the
 *            sourcemap comments were stripped after `index.html` was stamped.
 *          → the files judged are derived from the recipes, not from a list of folders: the
 *            list named `dist` and `vendor` while the recipes pinned by EXTENSION, wherever
 *            the file lived.
 *   SC-08  the table and the two recipes say ONE contract: for every file served, each
 *          recipe sends exactly the header `declaredCacheControl()` declares — the function
 *          §8 of `SERVEUR.md` is written from.
 *          → the table promised an hour to `profiles/**`; both recipes sent a year,
 *            `immutable`, to the sprite sheet living there, and to the application's icons,
 *            which the table did not name at all. A sprite is the integrator's own data:
 *            rewritten, it stayed the old one at every returning visitor, and `curl` showed
 *            the new file.
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
 *
 * ## And again for SC-05 (2026-09-06)
 *
 *   • the predicate run against the recipes AS THEY WERE — before either carried the
 *     rule — returned false on all 4 files, and the wired gate reddened on all 4.
 *     The rule was then emitted, and the gate went green on the rebuilt deliverables.
 *
 * ## And for SC-06 and SC-07 (2026-10-05) — on the deliverables AS THEY WERE
 *
 *   • SC-06: red on `init.js` and `sw-core.js`, in the nginx recipe of both variants; the
 *     Apache recipe, written in the same order, green — the two precedences, as modelled.
 *   • SC-07: red on the GeoJSON worker (asked for by nothing), on every on-demand plugin
 *     and on the stylesheet (asked for without a token) — and on the three files that DID
 *     carry a token, because it was not the token of the bytes served.
 *   Both green on the rebuilt deliverables. The engine's five files were then named in an
 *   exemption table, with their motive; that table is gone — see below.
 *
 * ## And for SC-08, and the widened SC-07 (2026-10-06) — on the deliverables AS THEY WERE
 *
 *   • SC-08: red on 55 files of each variant and in BOTH recipes — the engine's five, the
 *     eight under `icons/`, and under `profiles/` the two sprite sheets (a year, `immutable`,
 *     where the table says an hour) and every `.qml`, `.fgb` and `.md` (no header at all).
 *   • the recipes now pin by FOLDER: nothing outside `dist/` is sent `immutable`, so nothing
 *     is left to exempt, and the exemption table is removed rather than kept empty.
 *   • by mutation of the emitted nginx recipe — the per-extension block put back, the three
 *     folder blocks removed: SC-08 red on 212 headers, SC-07 red on the 15 stable-named files
 *     it had never looked at (5 engine, 8 icons, 2 sprites). An icons block of the emitted
 *     `.htaccess` set to an hour: SC-08 red on its 8 files, in that recipe only.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
    SERVER_CONTRACT_FILES,
    MJS_MIME_TOKEN,
    declaresMjsType,
    declaresProfilesRootNoCache,
    NO_CACHE_PATHS,
    declaredCacheControl,
    effectiveCacheControl,
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

/** The files a browser reads first, and that name everything else. */
const ENTRY_POINTS = ["index.html", "init.js", "sw-core.js"];

/**
 * Is this file named after its content? Rollup's hashed chunks are: `-` + eight base64url
 * characters before the extension. ⚠️ The digit-or-capital requirement is what keeps a plain
 * word of eight letters (`-download.js`) from passing for a hash.
 *
 * @param {string} name A file's base name.
 * @returns {boolean}
 */
function isContentNamed(name) {
    const m = /-([A-Za-z0-9_-]{8})\.(?:m?js|css)$/.exec(name);
    return m !== null && /[A-Z0-9]/.test(m[1]);
}

/**
 * The content token the build writes after `?v=` — recomputed HERE, on purpose: reading it from
 * the generator would compare the generator to itself.
 *
 * @param {string} file Absolute path.
 * @returns {string} Eight hexadecimal characters.
 */
function contentToken(file) {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
}

/**
 * Lists a folder's files, relative to `base`, precompressed twins left out.
 *
 * @param {string} base The variant's folder.
 * @param {string} rel A folder under it — `""` for the variant itself.
 * @returns {string[]}
 */
function servedFiles(base, rel) {
    const dir = path.join(base, rel);
    if (!fs.existsSync(dir)) return [];
    /** @type {string[]} */
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) out.push(...servedFiles(base, child));
        else if (!/\.(br|gz)$/.test(entry.name)) out.push(child);
    }
    return out;
}

/**
 * An entry point's text, comments removed: a path named in a comment asks for nothing.
 *
 * @param {string} file Absolute path.
 * @returns {string}
 */
function readEntryPoint(file) {
    const text = fs.readFileSync(file, "utf-8");
    return file.endsWith(".html")
        ? text.replace(/<!--[\s\S]*?-->/g, "")
        : text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The two files carrying a server recipe — `SERVEUR.md` is prose. */
const RECIPE_FILES = ["nginx.conf.example", ".htaccess"];

/** @type {string[]} */
const errors = [];
const stats = {
    variants: 0,
    covered: 0,
    files: 0,
    mjs: 0,
    noCache: 0,
    compared: 0,
    pinned: 0,
    byContent: 0,
};

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

        // ── SC-05 — the recipes forbid a long cache on the profiles ROOT config ──
        //
        // 🛑 Not a preference. That file carries `data.profileVersion`, the fingerprint that
        // invalidates every other profile resource — and a token cannot invalidate the file
        // that CARRIES it. Pinned, the whole mechanism is defeated in silence: the server
        // serves the new content, `curl` confirms it, and the page keeps showing the old one
        // for as long as the header lasts.
        //
        // ⚠️ `SERVEUR.md` §8 prescribed this rule while NEITHER recipe implemented it. A table
        // that prescribes and a recipe that does not is worse than silence — the integrator
        // copies the recipe and reads the table as confirmation. This gate closes that gap in
        // the only place it can be closed: what actually TRAVELS with the folder.
        if (!declaresProfilesRootNoCache(body)) {
            errors.push(
                `SC-05 ${variant}/${name} — la recette ne déclare pas \`no-cache\` sur ` +
                    `\`profiles/geoleaf.config.json\`. Ce fichier porte \`data.profileVersion\`, ` +
                    `l'empreinte qui invalide TOUT le reste du profil : on ne peut pas invalider ` +
                    `par un jeton le fichier qui porte ce jeton. Épinglé, il fait servir profil, ` +
                    `sections, configs de couche et bundle depuis le cache aussi longtemps que ` +
                    `dure l'en-tête de l'intégrateur — mesuré à sept jours. Émission : ` +
                    `scripts/lib/server-contract.cjs.`
            );
        }

        // ── SC-06 — the recipes DELIVER the `no-cache` §8 promises ───────────────
        //
        // 🛑 SC-05 reads one block; a server reads them all, and picks. nginx stops at the
        // FIRST regular expression that matches, Apache lets the LAST one win: a recipe can
        // name a file beside `no-cache` and serve it `immutable` for a year. It did — see
        // `effectiveCacheControl()`. What is judged here is the header each server would
        // SEND, for every file the table declares `no-cache`.
        const server = name === ".htaccess" ? "apache" : "nginx";
        for (const file of NO_CACHE_PATHS) {
            stats.noCache += 1;
            const sent = effectiveCacheControl(body, server, file);
            if (sent !== null && /\bno-cache\b/.test(sent)) continue;
            errors.push(
                `SC-06 ${variant}/${name} — \`${file}\` est déclaré \`no-cache\` par SERVEUR.md §8, ` +
                    `et la recette lui fait envoyer ${sent === null ? "AUCUN Cache-Control" : `\`${sent}\``}. ` +
                    (server === "nginx"
                        ? "nginx retient la PREMIÈRE location à expression régulière qui matche : " +
                          "un bloc plus général écrit AU-DESSUS prend le fichier. "
                        : "Apache laisse gagner le DERNIER <FilesMatch> qui matche : un bloc plus " +
                          "général écrit EN DESSOUS reprend le fichier. ") +
                    `Un point d'entrée tenu en cache garde ses références d'une version sur ` +
                    `l'autre : tout ce qu'il nomme par contenu cesse d'être rafraîchi. Émission : ` +
                    `scripts/lib/server-contract.cjs.`
            );
        }
    }

    // ── SC-08 — both recipes send what §8 DECLARES, for every file served ────
    //
    // 🛑 SC-06 judges the five files the table names `no-cache`; nothing judged the rest. The
    // table promised an hour to `profiles/**`, and both recipes sent a year, `immutable`, to
    // the sprite sheet that lives there — a `.svg`, taken by the block written per extension.
    // A table and two recipes are three statements of one contract: each file served is run
    // through all three, and they must agree.
    const recipes = RECIPE_FILES.filter((name) => present.includes(name)).map((name) => ({
        name,
        server: /** @type {"nginx" | "apache"} */ (name === ".htaccess" ? "apache" : "nginx"),
        body: fs.readFileSync(path.join(dir, name), "utf-8"),
    }));
    const served = servedFiles(dir, "");
    /** @type {string[]} */
    const pinned = [];
    for (const file of served) {
        const declared = declaredCacheControl(file);
        let immutable = false;
        for (const { name, server, body } of recipes) {
            stats.compared += 1;
            const sent = effectiveCacheControl(body, server, file);
            if (sent !== null && /\bimmutable\b/.test(sent)) immutable = true;
            if (sent === declared) continue;
            errors.push(
                `SC-08 ${variant}/${name} — \`${file}\` : SERVEUR.md §8 déclare ` +
                    `${declared === null ? "AUCUN Cache-Control" : `\`${declared}\``}, et la recette ` +
                    `lui fait envoyer ${sent === null ? "AUCUN Cache-Control" : `\`${sent}\``}. La table ` +
                    `et les deux recettes disent le même contrat : un bloc écrit par extension ` +
                    `prend aussi ce qui vit ailleurs que dans \`dist/\`. Émission : ` +
                    `scripts/lib/server-contract.cjs (\`declaredCacheControl()\` et les recettes).`
            );
        }
        if (immutable) pinned.push(file);
    }

    // ── SC-07 — what the recipe pins for a year is asked for BY CONTENT ──────
    //
    // 🛑 §8 pins for a year on one motive: « named after their content, never rewritten ».
    // Half of `dist/` was not. The GeoJSON worker, the stylesheet and every plugin loaded on
    // demand were served under a STABLE name, rewritten at each build — a server following the
    // recipe kept the old one for a year, facing a new core: a protocol mismatch nothing
    // reports. A stable name is fine when every reference to it carries its content (`?v=`);
    // this is what is judged, file by file, against the bytes.
    //
    // ⚠️ The files judged are the ones a recipe WOULD SEND `immutable` — derived from the
    // recipes, not from a list of folders. The list named `dist` and `vendor` while the
    // recipes pinned by extension: icons and sprites were pinned and never looked at.
    const entryPoints = ENTRY_POINTS.filter((f) => fs.existsSync(path.join(dir, f))).map((f) => ({
        name: f,
        text: readEntryPoint(path.join(dir, f)),
    }));
    for (const file of pinned) {
        stats.pinned += 1;
        if (isContentNamed(path.basename(file))) continue;
        const token = contentToken(path.join(dir, file));
        const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const asked = entryPoints.flatMap(({ name, text }) =>
            [...text.matchAll(new RegExp(`${escaped}(?:\\?v=([0-9a-f]{8}))?`, "g"))].map((m) => ({
                name,
                token: m[1] ?? null,
            }))
        );
        const wrong = asked.filter((a) => a.token !== token);
        if (asked.length > 0 && wrong.length === 0) {
            stats.byContent += 1;
            continue;
        }
        const how =
            asked.length === 0
                ? `aucun de ${ENTRY_POINTS.join(", ")} ne le demande`
                : wrong
                      .map(
                          (a) =>
                              `${a.name} le demande ${a.token ? `sous \`?v=${a.token}\`` : "sans jeton"}`
                      )
                      .join(" ; ");
        errors.push(
            `SC-07 ${variant}/${file} — servi \`immutable\` un an sous un nom STABLE, et ${how} ` +
                `(contenu : \`?v=${token}\`). Réécrit au build suivant, il restera l'ancien chez ` +
                `tout visiteur qui l'a déjà reçu. Le nommer par son contenu, poser son jeton sur ` +
                `chaque référence (scripts/build-deploy.cjs), ou ne plus l'épingler ` +
                `(scripts/lib/server-contract.cjs).`
        );
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

// ── SC-06 / SC-07 — neither rule may go green on nothing ────────────────────
if (
    stats.covered > 0 &&
    (stats.noCache === 0 || stats.compared === 0 || stats.pinned === 0 || stats.byContent === 0)
) {
    errors.push(
        `SC-03 — ${stats.noCache} en-tête(s) no-cache jugé(s), ${stats.compared} en-tête(s) comparé(s) ` +
            `à la table, ${stats.pinned} fichier(s) épinglé(s), ` +
            `${stats.byContent} demandé(s) par contenu : l'une des règles de cache n'a rien eu à ` +
            `juger. Un livrable sans recette lue, sans dist/ ou sans une seule référence à jeton ` +
            `n'est pas un livrable conforme — c'est un scan vide.`
    );
}

// ── Verdict ──────────────────────────────────────────────────────────────────

const scanned =
    `${stats.covered}/${stats.variants} variante(s) porteuse(s), ` +
    `${stats.files} fichier(s) de contrat, ${stats.mjs} module(s) .mjs couvert(s), ` +
    `${stats.noCache} en-tête(s) no-cache jugé(s), ${stats.compared} en-tête(s) comparé(s) à la ` +
    `table, ${stats.pinned} fichier(s) épinglé(s) dont ` +
    `${stats.byContent} au nom stable demandé(s) par contenu`;

if (errors.length) {
    console.error(
        `\n${C.red}${C.bold}✖ DEPLOY-SERVER-CONTRACT — ${errors.length} défaut(s)${C.x}\n`
    );
    for (const e of errors) console.error(`  ${C.red}•${C.x} ${e}`);
    console.error(`\n  ${C.dim}Scanné : ${scanned}${C.x}\n`);
    process.exit(1);
}

// The count is DERIVED from the list, never written beside it — same doctrine as
// `verify-app-template.cjs`: a written total is a second source of truth.
const HELD = [
    "présence",
    "type MIME .mjs déclaré",
    "triade d'en-têtes de sécurité",
    "scan non vide",
    "racine des profils en no-cache",
    "no-cache délivré selon la préséance de chaque serveur",
    "fichiers épinglés demandés par contenu",
    "table et recettes d'accord sur chaque fichier servi",
];

console.log(
    `${C.green}✔ DEPLOY-SERVER-CONTRACT${C.x} : chaque livrable emporte sa recette serveur — ` +
        `${HELD.length} invariants tenus (${HELD.join(", ")}).\n  ${C.dim}Scanné : ${scanned}${C.x}`
);
