#!/usr/bin/env node
"use strict";
/**
 * verify-deploy-no-secrets.cjs — no secret in what we SHIP.
 *
 * ## The hole this gate closes
 *
 * The repo had two secret nets, and a blind spot exactly between the two:
 *
 *   • `gitleaks` (`scripts/gitleaks-local.cjs`, `ci.yml`) scans **commit ranges**
 *     (`detect --log-opts`). It reads neither the working tree nor an untracked file.
 *   • `.gitignore` covers the **git** channel, and nothing else.
 *
 * `deploy/` is git-ignored. It is thus, structurally, out of both nets' reach — while
 * being precisely what ships to a client or a prod server. Measured on 2026-08-09:
 * `connector.local.js`, carrying a NON-EXPIRED `geoleaf_editor` JWT against a host
 * reachable from the Internet, was copied as-is to the root of `deploy-core`,
 * `deploy-full` and `deploy-coverage`, **plus** into their `.gz` and `.br`. Four
 * gates looked at `deploy/` — none looked at its CONTENT, they weighed bytes.
 *
 * ⚠️ **The reasoning that let it happen only measured execution.** `init.js`'s
 * `localhost` guard prevents the bootstrap from activating on a deployed origin. True,
 * and without effect: a secret is READ. `curl https://<host>/connector.local.js`
 * returned it in the clear, guard or not. This gate measures the other half, the one
 * nobody measured.
 *
 * ## What is verified
 *
 *   DNS-01  no DELIVERABLE variant contains a secret pattern (JWT, literal `Bearer`,
 *           assigned key/password) — in the raw file AND in its `.gz`/`.br` forms,
 *           because the token was also found in the `.gz`.
 *   DNS-02  a deliverable variant does NOT contain `connector.local.js`, and its
 *           `index.html` NAMES it nowhere. Distinct from DNS-01, which looks for
 *           patterns: a bootstrap whose token took another shape would escape it, not
 *           an absence requirement.
 *           ⚠️ This invariant compared the file to an INERT STUB until 2026-08-09.
 *           The stub existed because `init.js` imported the file unconditionally; the
 *           gated tag in `index.html` removed that obligation, hence the stub, hence
 *           the comparison. Requiring an absence is stronger than verifying a shape:
 *           there is one way to be absent, and a thousand to look inert.
 *   DNS-03  no environment file (`.env*`) was copied into a variant.
 *   DNS-04  the scan is not empty — at least one variant, one file, one byte.
 *           Otherwise a `deploy/` rename would make this gate green and mute.
 *   DNS-05  no deliverable variant references a PROOF-BACKEND host
 *           (`lib/dev-backend.cjs`). ⚠️ It is NOT a secret, and that is why DNS-01
 *           could not see it: no token pattern, just an origin. Measured on
 *           2026-08-09 — four bindings to `qgis.geoleaf.dev`, mounted by
 *           `docker-compose.dev.yml` and resolved only by the machine's `hosts`
 *           file, lived in the profiles of `deploy-core` AND `deploy-full`. At a
 *           client's they could only fail, and nothing said so before operation.
 *
 * ## `deploy-local` is the only place a secret is allowed to be
 *
 * The workstation variant (`npm run build:deploy:local`) receives the real bootstrap
 * — its reason to exist: concentrating in one NAMED directory, outside deliverables,
 * what used to be scattered across the three others. It is thus excluded from
 * DNS-01/02, and that exclusion is the repo's only place deciding what is
 * deliverable.
 *
 * ⚠️ **The exclusion goes by name, and there is nothing better to do.** A `deploy/`
 * is an artifact directory: nothing inside carries its own destination. The day a
 * non-deliverable variant is added, it is added HERE, and the default is the right
 * one — an unknown variant is treated as DELIVERABLE, hence scanned.
 *
 * Usage: node scripts/verify-deploy-no-secrets.cjs
 * Exit: 0 if no secret in the deliverables, 1 otherwise.
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
 * Variants ALLOWED to carry a secret, because they are never shipped.
 *
 * `deploy-coverage` is NOT here, deliberately: it is copied from `deploy-core`
 * (`build-deploy-coverage.cjs`), so it mechanically inherits what a deliverable
 * carries. Excluding it would mean ceasing to watch a deliverable's copy.
 */
const NON_DELIVERABLE = new Set(["deploy-local"]);

/**
 * Extensions whose content is binary: scanning them would cost without returning,
 * and a base64 pattern landing by chance in an image would be a false positive one
 * would learn to ignore — the worst possible outcome for a security gate.
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
 * Secret patterns. Each carries its name: a red must say WHAT was recognized,
 * otherwise the first reaction is to suspect the gate rather than the artifact.
 *
 * ⚠️ Do not look for bare `token` nor bare `secret`: the deploy output legitimately
 * contains them (auth-mode declarations `"auth": "bearer"` in the profiles, variable
 * names in the bundles). A gate reddening on the legitimate gets disabled — the exact
 * trajectory already recorded for an over-broad lint rule.
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
/** Tallies printed at the end of the run — never copied into prose elsewhere. */
const stats = { variants: 0, deliverable: 0, files: 0, bytes: 0, skippedBinary: 0 };

/**
 * Returns a file's text content, decompressing the server-served forms.
 *
 * 🛑 ALL THREE FORMS, AND THAT IS THE POINT. `build-deploy.cjs` pre-compresses every
 * text artifact over 1 KB, and `nginx.dev.conf` sets `gzip_static on`: the `.gz` is
 * SERVED. The 2026-08-09 token was in all three. Scanning only the raw would have
 * gone green on an orphaned `.gz` — a file whose source was fixed but whose
 * compressed form remained.
 *
 * @param {string} file absolute path
 * @returns {string|null} the text, or `null` if the file is binary or unreadable
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
        // An unreadable file or a failed decompression is a DEFECT, not a skip: it is
        // the only path through which an artifact would escape the scan in silence.
        errors.push(
            `${path.relative(ROOT, file)} — illisible ou décompression impossible (${String(e).slice(0, 90)})`
        );
        return null;
    }
}

/** @param {string} dir @returns {string[]} every file, recursively */
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
 * Masks a recognized value: the gate NAMES the defect, it does not copy it into a CI
 * log which, for its part, is kept and sometimes public. Same precaution as
 * `gitleaks --redact`.
 * @param {string} v @returns {string}
 */
function redact(v) {
    const head = v.slice(0, 12);
    return `${head}…[${v.length} car. masqués]`;
}

// ── The scan ─────────────────────────────────────────────────────────────────

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

        // DNS-01 — the patterns.
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

        // DNS-02 — the workstation bootstrap must not EXIST, nor be NAMED.
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

        // DNS-03 — a copied `.env`.
        if (path.basename(file).startsWith(".env")) {
            errors.push(
                `DNS-03 ${rel} — fichier d'environnement dans un artefact livrable.\n` +
                    `        ${C.dim}Un .env n'est jamais lisible par un navigateur : sa présence ici ne sert à rien et diffuse tout ce qu'il contient.${C.x}`
            );
        }

        // DNS-05 — the PROOF backend does not ship to a client.
        //
        // 🛑 It is not a secret, and that is why DNS-01 could not see it: no token
        // pattern, just an origin. Measured on 2026-08-09 — four bindings to
        // `qgis.geoleaf.dev`, `docker-compose.dev.yml`'s host, lived in the profiles
        // of `deploy-core` AND `deploy-full`. At a client's, they can only fail.
        //
        // ⚠️ The rule names a small set of dev hosts, NEVER an allowlist of
        // legitimate providers — see the rationale in `lib/dev-backend.cjs`. An
        // allowlist would silently strip a client profile's production backend.
        for (const host of DEV_BACKEND_HOSTS) {
            if (!text.includes(host)) continue;
            errors.push(
                `DNS-05 ${rel} — référence le backend de preuve \`${host}\`.\n` +
                    `        ${C.dim}Cet hôte n'est monté que par docker-compose.dev.yml et ne résout que sur le poste. Le retrait est fait à l'étape 9a de build-deploy.cjs (stripDevBackendBindings) ; s'il a été contourné, la variante nomme une cible qu'aucun client ne peut atteindre.${C.x}`
            );
        }
    }
}

// ── DNS-04 — the scan is not empty ───────────────────────────────────────────
//
// 🛑 WITHOUT THIS BLOCK, THIS GATE IS DECORATIVE. An empty `deploy/`, a variant
// rename, a `walk()` that no longer descends: in all three cases, zero patterns
// found, and a green. This repo already paid that class twice (`PREMIUM_RE` guarding
// nothing anymore, the boot probe green on a deleted marker) — hence
// `probe-gate-visibility.cjs`. A guard never seen red guards nothing; a guard that
// CANNOT go red guards nothing either.
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
