#!/usr/bin/env node
/**
 * @fileoverview DOCS-LIVE — the documentation SERVED online names the version npm SERVES.
 *
 * ## The defect this closes, measured on 2026-09-20
 *
 * `check-doc-cdn-pins.cjs` already keeps the documentation honest **at the moment it is
 * published**: it refuses to deploy a page whose CDN pins or announced release name anything
 * other than the version the registry serves. It closes one direction.
 *
 * 🛑 **The other direction was open, and it bit the same evening.** `@geoleaf/core@3.6.0` went to
 * npm at 21:30. The documentation site kept announcing 3.5.0, and **nothing said so** — CDN-PINS
 * only runs when someone decides to deploy the docs, so forgetting to deploy them is precisely
 * the case it cannot see. An integrator reading geoleaf.dev was told about a version older than
 * the one `npm install` gave them, with no mechanism anywhere to notice.
 *
 * ⚠️ **And a third surface was open behind the second.** `news.json` — what the site's landing
 * page reads — is DERIVED from `CHANGELOG.md`. The changelog had no `[3.6.0]` section, so the
 * site would have announced 3.5.0 *even after a successful deploy*. CDN-PINS judges the pins and
 * the landing page of the SOURCE tree; it never reads what the public server actually returns.
 * This gate does, which is why it is the one that closes the class.
 *
 * ## The invariant, and why it is "equal", not "at least"
 *
 * The published site must name **exactly** the version npm serves as `latest`:
 *
 * - site BEHIND the registry → a publication whose documentation never followed. The defect above.
 * - site AHEAD of the registry → the site describes a version nobody can install, and its CDN
 *   snippets answer 404. `check-doc-cdn-pins.cjs` prevents this at deploy time; here it is caught
 *   from the other side, in case the docs were deployed from a tree that had bumped but not
 *   published.
 *
 * ## The four rules
 *
 *   DL-00  Refuse to conclude when the site does not answer, or answers something this gate
 *          cannot parse. An unreachable site is the ABSENCE of a verdict, never a pass — and the
 *          prose says which of the two happened, so a network outage is never read as a green.
 *   DL-01  The version the published site announces equals the version the registry serves.
 *   DL-02  The registry does not answer → refuse to conclude. Same reason as DL-00, other end.
 *   DL-03  Non-vacuity: the document fetched carries the field this gate reads. If `news.json`
 *          ever stops carrying `patchnotes[0].version`, the gate must SAY it lost its subject
 *          rather than report success on a shape it no longer understands.
 *
 * ## Where it runs, and where it deliberately does NOT
 *
 * `npm run check:docs-live`, and inside `release:check` — the moment the answer is actionable:
 * before publishing N, it asserts that the documentation of the version currently served is
 * online. It is therefore GREEN in the normal case and red only on a real omission, which is what
 * keeps it armed.
 *
 * 🛑 **Not in `ci:local`, for the reason written on `check-doc-cdn-pins.cjs`**: between a
 * publication and the documentation update it would be red on every commit, for something no
 * product change can fix — the shape that gets a gate disarmed within the week. It is also
 * network-bound, and `ci:local` must stay runnable offline.
 *
 * ⚠️ **The site redirects.** `geoleaf.dev` answers `301` to `www.geoleaf.dev`. A fetch that does
 * not follow redirects reads an nginx error page, fails to parse it, and — without DL-00 — would
 * have reported whatever its `catch` decided. Redirects are followed, and the final URL is
 * printed so the operator sees which document was actually judged.
 *
 * ## Usage
 *
 *        node scripts/check-published-docs-parity.cjs
 *        GEOLEAF_DOCS_URL=https://…/news.json node scripts/check-published-docs-parity.cjs
 */

"use strict";

const { execFileSync } = require("node:child_process");

/** The published document that carries the announced version, and the field to read in it. */
const DOCS_URL = process.env.GEOLEAF_DOCS_URL || "https://www.geoleaf.dev/assets/data/news.json";
/** The package whose registry version is the reference. */
const PKG = "@geoleaf/core";

/**
 * What a probe returns: `ok`, plus the fields that branch carries.
 *
 * ⚠️ **One shape with optional fields, and NOT a discriminated union — deliberately.**
 * `tsconfig.tooling.json` sets `strict: false` on purpose (its own comment says why: the
 * corpus is JavaScript written without annotations, and raising it at once would make the
 * ratchet unusable). Without `strictNullChecks`, `ok: true | false` does not discriminate
 * and `if (!x.ok)` narrows nothing — TOOLING-TS counted two errors for exactly that, first
 * written inline, then as named typedefs, both times in vain. Writing in the corpus's own
 * idiom costs one comment; adding two errors to a DECREASING ratchet would have cost the
 * ratchet.
 *
 * @typedef {{ ok: boolean, body?: string, finalUrl?: string, why?: string }} FetchResult
 * @typedef {{ ok: boolean, version?: string, why?: string }} RegistryResult
 */

const C = {
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    off: "\x1b[0m",
};

/**
 * Fetches a URL following redirects, or returns the reason it could not.
 *
 * `curl` rather than `fetch` on purpose: the rest of this repo's network-bound gates shell out,
 * the timeout is explicit, and a non-2xx is reported as itself instead of being flattened into
 * an exception whose message varies with the runtime.
 *
 * @param {string} url
 * @returns {FetchResult}
 */
function fetchFollowing(url) {
    try {
        const out = execFileSync(
            "curl",
            ["-sSL", "--max-time", "25", "-w", "\\n%{http_code} %{url_effective}", url],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
        );
        const nl = out.lastIndexOf("\n");
        const [code, finalUrl] = out
            .slice(nl + 1)
            .trim()
            .split(" ");
        if (code !== "200") return { ok: false, why: `HTTP ${code} sur ${finalUrl}` };
        return { ok: true, body: out.slice(0, nl), finalUrl };
    } catch (err) {
        return { ok: false, why: `requête impossible — ${err.message.split("\n")[0]}` };
    }
}

/**
 * Reads the version the registry serves as `latest`.
 *
 * @returns {RegistryResult}
 */
function registryLatest() {
    try {
        const v = execFileSync("npm", ["view", PKG, "version", "--prefer-online"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        }).trim();
        if (!/^\d+\.\d+\.\d+/.test(v)) return { ok: false, why: `réponse illisible — « ${v} »` };
        return { ok: true, version: v };
    } catch (err) {
        return { ok: false, why: `npm view a échoué — ${err.message.split("\n")[0]}` };
    }
}

function main() {
    console.log(`${C.cyan}── DOCS-LIVE — la doc SERVIE nomme la version SERVIE ──${C.off}`);

    // DL-02 — the registry end, first: without it there is nothing to compare against.
    const reg = registryLatest();
    if (!reg.ok) {
        console.error(`${C.red}⏹${C.off}  [DL-02] registre injoignable : ${reg.why}`);
        console.error("   Ce n'est pas un vert : c'est l'absence de verdict. Relancer.");
        process.exit(2);
    }

    // DL-00 — the site end.
    const got = fetchFollowing(DOCS_URL);
    if (!got.ok) {
        console.error(`${C.red}⏹${C.off}  [DL-00] site injoignable : ${got.why}`);
        console.error(`   document visé : ${DOCS_URL}`);
        console.error("   Ce n'est pas un vert : c'est l'absence de verdict. Relancer.");
        process.exit(2);
    }

    // DL-03 — non-vacuity: the shape this gate reads must still be there.
    let announced;
    try {
        const json = JSON.parse(got.body);
        announced = json?.patchnotes?.[0]?.version;
    } catch (err) {
        console.error(`${C.red}⏹${C.off}  [DL-03] document illisible : ${err.message}`);
        console.error(`   lu depuis ${got.finalUrl}`);
        process.exit(2);
    }
    if (typeof announced !== "string" || !/^\d+\.\d+\.\d+/.test(announced)) {
        console.error(
            `${C.red}⏹${C.off}  [DL-03] \`patchnotes[0].version\` absent ou non conforme — ` +
                `la gate a perdu son sujet, elle ne conclut pas.`
        );
        console.error(`   lu depuis ${got.finalUrl}`);
        process.exit(2);
    }

    console.log(`  registre : ${PKG}@${reg.version}`);
    console.log(`  doc en ligne : v${announced}  ${C.dim}(${got.finalUrl})${C.off}`);

    // DL-01 — the comparison.
    if (announced !== reg.version) {
        const retard = announced < reg.version;
        console.error(
            `${C.red}❌${C.off} [DL-01] la doc en ligne annonce ${announced}, le registre sert ` +
                `${reg.version}.`
        );
        console.error(
            retard
                ? "   Une publication dont la doc n'a pas suivi : un intégrateur lit une version\n" +
                      "   plus ancienne que celle qu'`npm install` lui donne.\n" +
                      "   Remède : `GEOLEAF_DOCS_SITE_ROOT=<site> npm run docs:deploy`, puis\n" +
                      "   `node build.mjs` et le PUSH du dépôt du site — la doc n'est pas en ligne avant."
                : "   La doc décrit une version que personne ne peut installer, et ses extraits CDN\n" +
                      "   répondent 404. Publier le paquet, ou republier la doc depuis l'arbre servi."
        );
        process.exit(1);
    }

    console.log(
        `${C.green}✓ DOCS-LIVE${C.off} — la doc servie et le registre nomment ${reg.version}.`
    );
}

main();
