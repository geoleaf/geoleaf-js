#!/usr/bin/env node
"use strict";
/**
 * verify-deploy-no-secrets.cjs — aucun secret dans ce qu'on LIVRE.
 *
 * ## Le trou que cette gate ferme
 *
 * Le dépôt avait deux filets à secrets, et un angle mort exactement entre les deux :
 *
 *   • `gitleaks` (`scripts/gitleaks-local.cjs`, `ci.yml`) scanne des **plages de commits**
 *     (`detect --log-opts`). Il ne lit ni l'arbre de travail, ni un fichier non suivi.
 *   • `.gitignore` couvre le canal **git**, et rien d'autre.
 *
 * `deploy/` est git-ignoré. Il est donc, structurellement, hors de portée des deux — pendant
 * qu'il est précisément ce qui part chez un client ou sur un serveur de prod. Mesuré le
 * 09/08/2026 : `connector.local.js`, porteur d'un JWT `geoleaf_editor` NON EXPIRÉ contre un
 * hôte joignable depuis Internet, était recopié tel quel à la racine de `deploy-core`, de
 * `deploy-full` et de `deploy-coverage`, **plus** dans leurs `.gz` et `.br`. Quatre gates
 * regardaient `deploy/` — aucune ne regardait son CONTENU, elles pesaient des octets.
 *
 * ⚠️ **Le raisonnement qui laissait faire ne mesurait que l'exécution.** La garde `localhost`
 * d'`init.js` empêche le bootstrap de s'activer sur une origine déployée. C'est vrai, et sans
 * effet : un secret se LIT. `curl https://<hôte>/connector.local.js` le rendait en clair, garde
 * ou pas. Cette gate mesure l'autre moitié, celle que personne ne mesurait.
 *
 * ## Ce qui est vérifié
 *
 *   DNS-01  aucune variante LIVRABLE ne contient de motif de secret (JWT, `Bearer` littéral,
 *           clé/mot de passe assignés) — dans le fichier brut ET dans ses formes `.gz`/`.br`,
 *           parce que c'est dans le `.gz` que le jeton a aussi été retrouvé.
 *   DNS-02  une variante livrable ne contient PAS `connector.local.js`, et son `index.html`
 *           ne le NOMME nulle part. Distinct de DNS-01, qui cherche des motifs : un bootstrap
 *           dont le jeton aurait une autre forme y échapperait, pas à une exigence d'absence.
 *           ⚠️ Cet invariant a comparé le fichier à un TALON INERTE jusqu'au 09/08/2026. Le
 *           talon existait parce qu'`init.js` importait le fichier inconditionnellement ; la
 *           balise gatée d'`index.html` a supprimé cette obligation, donc le talon, donc la
 *           comparaison. Exiger une absence est plus fort que vérifier une forme : il n'y a
 *           qu'une façon d'être absent, et mille d'avoir l'air inerte.
 *   DNS-03  aucun fichier d'environnement (`.env*`) n'a été copié dans une variante.
 *   DNS-04  le scan n'est pas vide — au moins une variante, au moins un fichier, au moins un
 *           octet. Sans quoi un renommage de `deploy/` rendrait cette gate verte et muette.
 *   DNS-05  aucune variante livrable ne référence un hôte du BACKEND DE PREUVE
 *           (`lib/dev-backend.cjs`). ⚠️ Ce n'est PAS un secret, et c'est pourquoi DNS-01 ne
 *           pouvait pas le voir : il n'y a aucun motif de jeton, juste une origine. Mesuré le
 *           09/08/2026 — quatre liaisons vers `qgis.geoleaf.dev`, monté par
 *           `docker-compose.dev.yml` et résolu par le seul fichier `hosts` du poste, vivaient
 *           dans les profils de `deploy-core` ET `deploy-full`. Elles ne pouvaient qu'échouer
 *           chez un client, et rien ne le disait avant l'exploitation.
 *
 * ## `deploy-local` est le seul endroit où un secret a le droit d'être
 *
 * La variante de poste (`npm run build:deploy:local`) reçoit le bootstrap réel — c'est sa
 * raison d'être : concentrer en un seul répertoire NOMMÉ, hors livrables, ce qui était
 * auparavant dispersé dans les trois autres. Elle est donc exclue de DNS-01/02, et cette
 * exclusion est le seul endroit du dépôt qui décide ce qui est livrable.
 *
 * ⚠️ **L'exclusion se fait par nom, et il n'y a pas mieux à faire.** Un `deploy/` est un
 * répertoire d'artefacts : rien dedans ne porte sa propre destination. Le jour où une variante
 * non livrable s'ajoute, elle s'ajoute ICI, et le défaut par défaut est le bon sens — une
 * variante inconnue est traitée comme LIVRABLE, donc scannée.
 *
 * Usage: node scripts/verify-deploy-no-secrets.cjs
 * Sortie: 0 si aucun secret dans les livrables, 1 sinon.
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const { DEV_BACKEND_HOSTS } = require("./lib/dev-backend.cjs");

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

/**
 * Variantes qui ont le DROIT de porter un secret, parce qu'elles ne sont jamais livrées.
 *
 * `deploy-coverage` n'y est PAS, et c'est délibéré : elle est recopiée depuis `deploy-core`
 * (`build-deploy-coverage.cjs`), donc elle hérite mécaniquement de ce que porte un livrable.
 * L'exclure reviendrait à cesser de surveiller la copie d'un livrable.
 */
const NON_DELIVERABLE = new Set(["deploy-local"]);

/**
 * Extensions dont le contenu est binaire : les scanner coûterait sans rien rendre, et un motif
 * base64 tombé au hasard dans une image serait un faux positif qu'on apprendrait à ignorer —
 * le pire résultat possible pour une gate de sécurité.
 */
const BINARY_EXT = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".avif",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    ".pbf",
    ".tif",
    ".tiff",
    ".mp4",
    ".webm",
    ".zip",
    ".pdf",
]);

/**
 * Motifs de secret. Chacun porte son nom : un rouge doit dire CE QUI a été reconnu, sinon la
 * première réaction est de suspecter la gate plutôt que l'artefact.
 *
 * ⚠️ Ne pas chercher le mot `token` nu ni `secret` nu : le déployé en contient légitimement
 * (déclarations de mode d'auth `"auth": "bearer"` dans les profils, noms de variables dans les
 * bundles). Une gate qui rougit sur du légitime se fait désactiver — c'est la trajectoire
 * exacte de la règle R.8 consignée au backlog.
 */
const PATTERNS = [
    {
        name: "JWT",
        re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    },
    {
        name: "en-tête Authorization avec valeur littérale",
        re: /Authorization["'\s:]*[:=]?["'\s]*Bearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
    },
    {
        name: "clé ou mot de passe assigné à un littéral",
        re: /\b(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|password|passwd)\b\s*[:=]\s*["'][^"'\s]{8,}["']/gi,
    },
];

const errors = [];
/** Décomptes imprimés en fin de run — jamais recopiés en prose ailleurs (doctrine B-43). */
const stats = { variants: 0, deliverable: 0, files: 0, bytes: 0, skippedBinary: 0 };

/**
 * Rend le contenu texte d'un fichier, en décompressant les formes servies par le serveur.
 *
 * 🛑 LES TROIS FORMES, ET C'EST LE POINT. `build-deploy.cjs` pré-compresse tout artefact texte
 * de plus de 1 Ko, et `nginx.dev.conf` pose `gzip_static on` : le `.gz` est SERVI. Le jeton du
 * 09/08/2026 était dans les trois. Ne scanner que le brut aurait sorti vert sur un `.gz`
 * orphelin — un fichier dont la source a été corrigée mais dont la forme compressée est restée.
 *
 * @param {string} file chemin absolu
 * @returns {string|null} le texte, ou `null` si le fichier est binaire ou illisible
 */
function readTextual(file) {
    const ext = path.extname(file).toLowerCase();
    try {
        const raw = fs.readFileSync(file);
        if (ext === ".gz") return zlib.gunzipSync(raw).toString("utf-8");
        if (ext === ".br") return zlib.brotliDecompressSync(raw).toString("utf-8");
        if (BINARY_EXT.has(ext)) {
            stats.skippedBinary++;
            return null;
        }
        return raw.toString("utf-8");
    } catch (e) {
        // Un fichier illisible ou une décompression qui échoue est un DÉFAUT, pas un saut :
        // c'est le seul chemin par lequel un artefact échapperait au scan en silence.
        errors.push(
            `${path.relative(ROOT, file)} — illisible ou décompression impossible (${String(e).slice(0, 90)})`
        );
        return null;
    }
}

/** @param {string} dir @returns {string[]} tous les fichiers, récursivement */
function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(p));
        else if (entry.isFile()) out.push(p);
    }
    return out;
}

/**
 * Masque une valeur reconnue : la gate NOMME le défaut, elle ne le recopie pas dans un log de
 * CI qui, lui, est conservé et parfois public. Même précaution que `gitleaks --redact`.
 * @param {string} v @returns {string}
 */
function redact(v) {
    const head = v.slice(0, 12);
    return `${head}…[${v.length} car. masqués]`;
}

// ── Le scan ──────────────────────────────────────────────────────────────────

if (!fs.existsSync(DEPLOY)) {
    console.error(
        `${C.red}✖ DEPLOY-SECRETS${C.x} — ${path.relative(ROOT, DEPLOY)}/ absent.\n` +
            `  ${C.dim}Construire d'abord : npm run build:deploy${C.x}`
    );
    process.exit(1);
}

const variantDirs = fs
    .readdirSync(DEPLOY, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

stats.variants = variantDirs.length;

for (const variant of variantDirs) {
    if (NON_DELIVERABLE.has(variant)) {
        console.log(
            `${C.yellow}↷${C.x} ${variant} ${C.dim}— variante NON LIVRABLE, non scannée (elle porte le bootstrap dev par construction)${C.x}`
        );
        continue;
    }
    stats.deliverable++;

    const variantDir = path.join(DEPLOY, variant);
    for (const file of walk(variantDir)) {
        const text = readTextual(file);
        if (text === null) continue;

        stats.files++;
        stats.bytes += Buffer.byteLength(text, "utf-8");
        const rel = path.relative(ROOT, file);

        // DNS-01 — les motifs.
        for (const { name, re } of PATTERNS) {
            re.lastIndex = 0;
            const hit = re.exec(text);
            if (hit) {
                errors.push(
                    `DNS-01 ${rel} — ${name} : ${redact(hit[0])}\n` +
                        `        ${C.dim}Une variante livrable ne doit porter aucun secret. Si c'est un bootstrap de poste, il va dans deploy-local (npm run build:deploy:local).${C.x}`
                );
            }
        }

        // DNS-02 — le bootstrap de poste ne doit pas EXISTER, ni être NOMMÉ.
        if (path.basename(file) === "connector.local.js") {
            errors.push(
                `DNS-02 ${rel} — le bootstrap de poste n'a rien à faire dans une variante livrable.\n` +
                    `        ${C.dim}Il ne doit être copié que dans deploy-local. Vérifier \`includeDevConnector\` dans build-deploy.cjs.${C.x}`
            );
        }
        if (path.basename(file) === "index.html" && text.includes("connector.local.js")) {
            errors.push(
                `DNS-02 ${rel} — nomme encore connector.local.js.\n` +
                    `        ${C.dim}\`stripDevConnectorScript\` n'a pas retiré le bloc DEV-CONNECTOR : la variante irait chercher un fichier qu'elle ne porte pas (404 console), ou pire, qu'elle porte.${C.x}`
            );
        }

        // DNS-03 — un `.env` recopié.
        if (path.basename(file).startsWith(".env")) {
            errors.push(
                `DNS-03 ${rel} — fichier d'environnement dans un artefact livrable.\n` +
                    `        ${C.dim}Un .env n'est jamais lisible par un navigateur : sa présence ici ne sert à rien et diffuse tout ce qu'il contient.${C.x}`
            );
        }

        // DNS-05 — le backend de PREUVE ne part pas chez un client.
        //
        // 🛑 Ce n'est pas un secret, et c'est pour ça que DNS-01 ne pouvait pas le voir : aucun
        // motif de jeton, juste une origine. Mesuré le 09/08/2026 — quatre liaisons vers
        // `qgis.geoleaf.dev`, l'hôte de `docker-compose.dev.yml`, vivaient dans les profils de
        // `deploy-core` ET `deploy-full`. Chez un client, elles ne peuvent qu'échouer.
        //
        // ⚠️ La règle nomme un petit ensemble d'hôtes de dev, JAMAIS une allowlist de
        // fournisseurs légitimes — voir le motif dans `lib/dev-backend.cjs`. Une allowlist
        // supprimerait en silence le backend de production d'un profil client.
        for (const host of DEV_BACKEND_HOSTS) {
            if (!text.includes(host)) continue;
            errors.push(
                `DNS-05 ${rel} — référence le backend de preuve \`${host}\`.\n` +
                    `        ${C.dim}Cet hôte n'est monté que par docker-compose.dev.yml et ne résout que sur le poste. Le retrait est fait à l'étape 9a de build-deploy.cjs (stripDevBackendBindings) ; s'il a été contourné, la variante nomme une cible qu'aucun client ne peut atteindre.${C.x}`
            );
        }
    }
}

// ── DNS-04 — le scan n'est pas vide ──────────────────────────────────────────
//
// 🛑 SANS CE BLOC, CETTE GATE EST DÉCORATIVE. Un `deploy/` vide, un renommage de variante, un
// `walk()` qui ne descend plus : dans les trois cas, zéro motif trouvé, et un vert. Ce dépôt a
// déjà payé cette classe deux fois (`PREMIUM_RE` qui ne gardait plus rien, la sonde de boot
// verte sur un marqueur supprimé) — d'où `probe-gate-visibility.cjs`. Une garde jamais vue
// rouge ne garde rien ; une garde qui ne peut PAS rougir ne garde rien non plus.
if (stats.deliverable === 0) {
    errors.push(
        `DNS-04 — aucune variante livrable trouvée sous ${path.relative(ROOT, DEPLOY)}/ ` +
            `(vues : ${variantDirs.join(", ") || "aucune"}). Le scan n'a rien couvert.`
    );
}
if (stats.files === 0 || stats.bytes === 0) {
    errors.push(
        `DNS-04 — ${stats.files} fichier(s), ${stats.bytes} octet(s) scannés. Un verdict sur un ` +
            `corpus vide n'est pas un verdict.`
    );
}

// ── Verdict ──────────────────────────────────────────────────────────────────

const scanned =
    `${stats.deliverable}/${stats.variants} variante(s) livrable(s), ` +
    `${stats.files} fichier(s), ${(stats.bytes / 1024).toFixed(0)} Ko de texte ` +
    `(${stats.skippedBinary} binaire(s) ignoré(s))`;

if (errors.length) {
    console.error(`\n${C.red}${C.bold}✖ DEPLOY-SECRETS — ${errors.length} défaut(s)${C.x}\n`);
    for (const e of errors) console.error(`  ${C.red}•${C.x} ${e}`);
    console.error(`\n  ${C.dim}Scanné : ${scanned}${C.x}\n`);
    process.exit(1);
}

console.log(
    `${C.green}✔ DEPLOY-SECRETS${C.x} : aucun secret dans les livrables — ` +
        `5 invariants tenus (motifs, absence du bootstrap de poste, .env, scan non vide, ` +
        `backend de preuve).\n` +
        `  ${C.dim}Scanné : ${scanned}${C.x}`
);
