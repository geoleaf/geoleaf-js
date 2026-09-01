/**
 * The license banner — its canonical shape, in one place.
 *
 * Three consumers read it, and that is the module's reason to exist:
 *   • `scripts/check-license-headers.cjs`      — the LIC-01/02/03/04/05 gate
 *   • `scripts/check-license-headers.cjs --write` — the generator that lays the banner
 *   • `packages/build-config/rollup.mjs`       — the OUTPUT banner of the bundles
 *
 * A gate and its generator each carrying their own copy of the rule diverge, and the
 * disagreement reads as "the gate is green on a file the generator wants to rewrite".
 * Same doctrine as `lib/source-inventory.cjs`, whose corpus this module shares.
 *
 * ## Two shapes, a single difference: the version
 *
 * Sources (`.ts`)          → titre nu.
 * Bundles (`output`)       → titre + ` v<version>`.
 *
 * The version NEVER descends into the sources: `__GEOLEAF_VERSION__` is not substituted
 * there (rollup's `replace` only touches what enters a bundle), and a number frozen into
 * 845 files would be wrong at the first `npm version`.
 *
 * ## Why `/*!` and never `/**`
 *
 * `source-inventory.cjs:extractHeader` strips the `/*!` block BEFORE looking for a `/**`,
 * otherwise every file would look documented by its copyright. Laying `/**` would flip 195
 * files from "undocumented" to "documented" in the eyes of `check-module-headers.cjs`,
 * hence MH-02 on 195 baseline entries — the exact failure mode that gate exists to forbid.
 * `/*!` is also the *legal comment* marker esbuild and terser recognize.
 *
 * ## The title is not imposed — its OWNERSHIP is
 *
 * The generator writes `pkg.name`. The gate, for its part, leaves the title free — the 650
 * existing titles carry real information (`GeoLeaf Core — Language: French (fr)`) that
 * normalizing would destroy — but it refuses a title naming ANOTHER package of the repo
 * (LIC-02). Measured on 2026-08-10: 4 files did, including two of `offline-ui` announcing
 * themselves as "GeoLeaf Core".
 *
 * ## `Copyright (c)` / `©` — a PARTITION, not a divergence
 *
 * The task asked to "settle the wording divergence". **There is none to settle: the two
 * forms meet nowhere.** Measured on 2026-08-10, then re-measured after the 2 files created
 * since:
 *
 *   • `Copyright (c) 2026 Mattieu Pottier` — in the **19 `LICENSE` files**, and nowhere
 *     else (meta mentions like this one aside, which talk about the string without
 *     carrying it).
 *   • `© 2026 Mattieu Pottier` — in the `/*!` banners of sources and bundles.
 *   • **Empty intersection, both ways**: no `LICENSE` contains `©`, no banner contains
 *     `Copyright (c)`.
 *
 * So this is not a tacit divergence, it is a **partition**, and it has a rationale in each
 * direction. The `LICENSE` carries the **canonical MIT text**, the one SPDX and compliance
 * scanners recognize to the word: `Copyright (c)` is the template's form there, and
 * rewriting it as `©` would make 19 files diverge from a reference text for zero gain. The
 * banner, meanwhile, is not the license text but a **notice** — `©` is the typographic
 * form there, it fits on a short line repeated across 845 sources and 39 bundles.
 *
 * 🛑 **Both directions are GATED, and one must know which by what.** The direction "no
 * banner carries `(c)`" already was: `inspect()` classifies that form `parenthesee`, so
 * LIC-01 refuses it. The reverse — "no `LICENSE` carries `©`" — was held by nothing, and
 * it is exactly the one a well-meaning harmonization would break: someone reading 845
 * banners in `©` and 19 `LICENSE` files in `(c)` concludes an inconsistency and "fixes"
 * the smaller of the two piles. **LIC-06 is what holds it**, and the paragraph being read
 * right here is what that person should have read first.
 */

"use strict";

const registry = require("./packages.cjs");

/** The copyright year. Identical to the 17 `LICENSE` files (`Copyright (c) 2026`). */
const COPYRIGHT_YEAR = "2026";
/** The holder, single. No other attribution is admitted (LIC-02). */
const HOLDER = "Mattieu Pottier";
/** The line that makes the notice actionable when a `.js` is served alone from a CDN. */
const PROJECT_URL = "https://geoleaf.dev";
/** The license wording, the one of the 617 conforming banners. */
const LICENSE_LINE = "Released under the MIT License";
/** The only value admitted for `package.json#license` (LIC-05). */
const PUBLISHED_PACKAGE_LICENSE = "MIT";

/**
 * The copyright line of a `LICENSE` file — the MIT template's form, never the banner's.
 *
 * ⚠️ `Copyright (c)` here, `©` in `renderBanner()`: this is a WANTED partition, motivated
 * in the header's §"`Copyright (c)` / `©`". Aligning the two is the move not to make.
 */
const LICENSE_FILE_COPYRIGHT = `Copyright (c) ${COPYRIGHT_YEAR} ${HOLDER}`;

/**
 * The sign the banners carry and no `LICENSE` must carry (LIC-06).
 *
 * Named rather than written as a literal in the gate: a `©` lost in the middle of a
 * condition is indistinguishable from a typo, and it is precisely the character being
 * watched.
 */
const TYPOGRAPHIC_COPYRIGHT = "©";

/**
 * The canonical `/*!` block, ready to write.
 *
 * @param {string} title First line — `pkg.name`, or `pkg.name v<version>` for a bundle.
 * @returns {string} The block, WITHOUT a trailing newline.
 */
function renderBanner(title) {
    return [
        "/*!",
        ` * ${title}`,
        ` * © ${COPYRIGHT_YEAR} ${HOLDER}`,
        ` * ${LICENSE_LINE}`,
        ` * ${PROJECT_URL}`,
        " */",
    ].join("\n");
}

/** Bandeau d'une SOURCE : titre nu. @param {string} pkgName @returns {string} */
function sourceBanner(pkgName) {
    return renderBanner(pkgName);
}

/** Bandeau d'un BUNDLE : titre + version. @param {string} pkgName @param {string} version */
function bundleBanner(pkgName, version) {
    return renderBanner(`${pkgName} v${version}`);
}

/**
 * A file's leading `/*!` block, BOM tolerated.
 *
 * ⚠️ The BOM is no cosmetic detail here. Measured on 2026-08-10: **17 files carry one**,
 * including **8 with their banner right behind it**. A pattern anchored as `/^\/\*!/`
 * counts them as bare — that is the exact gap between the preflight's "203" and the real
 * 195 — and a generator believing them bare would write them a SECOND banner.
 */
const BANNER_RE = /^﻿?\/\*!([\s\S]*?)\*\//;

/**
 * Display label derived from a package name — no table to maintain.
 *
 * `@geoleaf/core` → `GeoLeaf Core`. Serves LIC-02 only, to recognize a title naming a
 * package other than its own: the guide prescribes this form and half the repo
 * contradicts it, so it is NOT imposed — only recognized.
 *
 * @param {string} pkgName
 * @returns {string}
 */
function displayLabel(pkgName) {
    const short = pkgName.split("/").pop();
    return (
        "GeoLeaf " +
        short
            .split(/[-_]/)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")
    );
}

/** @type {Map<string, string>|null} */
let aliasCache = null;

/**
 * Every way a package of the repo can be named, lowercase → package name.
 *
 * Derived from `packages.cjs`, never hand-written: a hard-coded alias would silently stop
 * matching at the first rename, and LIC-02 would go green while recognizing nothing
 * anymore.
 *
 * @returns {Map<string, string>}
 */
function packageAliases() {
    if (aliasCache) return aliasCache;
    aliasCache = new Map();
    for (const p of registry.all()) {
        aliasCache.set(p.name.toLowerCase(), p.name);
        aliasCache.set(displayLabel(p.name).toLowerCase(), p.name);
    }
    return aliasCache;
}

/**
 * What a file carries, and what it lacks.
 *
 * @param {string} source File content.
 * @returns {{present: boolean, body: string, title: string, hasUrl: boolean, hasMit: boolean,
 *            authorForm: "canonique"|"parenthesee"|"nue"|"absente"}}
 */
function inspect(source) {
    const m = source.match(BANNER_RE);
    if (!m) {
        return {
            present: false,
            body: "",
            title: "",
            hasUrl: false,
            hasMit: false,
            authorForm: "absente",
        };
    }
    const body = m[1];
    const title =
        body
            .split("\n")
            .map((l) => l.replace(/^\s*\*?\s?/, "").trim())
            .filter(Boolean)[0] || "";
    const canonical = new RegExp(`©\\s*\\d{4}(?:\\s*[–-]\\s*\\d{4})?\\s+${HOLDER}`);
    let authorForm;
    if (canonical.test(body)) authorForm = "canonique";
    else if (new RegExp(`\\(c\\)\\s*\\d{4}\\s+${HOLDER}`, "i").test(body))
        authorForm = "parenthesee";
    else if (body.includes(HOLDER)) authorForm = "nue";
    else authorForm = "absente";

    return {
        present: true,
        body,
        title,
        hasUrl: body.includes(PROJECT_URL.replace(/^https:\/\//, "")),
        hasMit: /\bMIT\b/.test(body),
        authorForm,
    };
}

/**
 * The name of ANOTHER package cited by a title, or `null`.
 *
 * @param {string} title First line of the banner.
 * @param {string} ownPkgName The package the file really belongs to.
 * @returns {string|null} The usurped package.
 */
function foreignPackageInTitle(title, ownPkgName) {
    const lower = title.toLowerCase();
    for (const [alias, owner] of packageAliases()) {
        if (owner === ownPkgName) continue;
        if (!lower.startsWith(alias)) continue;
        // Word boundary mandatory: without it, `GeoLeaf Cog` (the plugin) would match any
        // core title starting with "GeoLeaf Cognitive…". A gate that reddens on a
        // legitimate title gets loosened, and the whole guard goes with it.
        const next = lower.charAt(alias.length);
        if (next === "" || !/[a-z0-9]/.test(next)) return owner;
    }
    return null;
}

/**
 * Rewrites a source's banner to make it canonical — the `--write` move.
 *
 * Three cases, in this order:
 *   1. no banner            → insert the full block, title = `pkg.name`
 *   2. usurping banner      → the title is replaced by `pkg.name`, the rest kept
 *   3. incomplete banner    → complete the missing line(s), the TITLE is kept
 *
 * Case 3 is the one that matters: keeping the title is what makes the operation
 * non-destructive over 650 files whose title carries information no generator could
 * reconstruct.
 *
 * @param {string} source
 * @param {string} pkgName
 * @returns {{source: string, changed: boolean, why: string[]}}
 */
function normalize(source, pkgName) {
    const bom = source.charCodeAt(0) === 0xfeff ? "﻿" : "";
    const rest = bom ? source.slice(1) : source;
    const info = inspect(source);
    const why = [];

    if (!info.present) {
        // A bare file: full banner, then one blank line before what follows — unless the
        // file already started with a blank line, in which case we do not add a second.
        const sep = /^\s*\n/.test(rest) ? "\n" : "\n\n";
        return {
            source: bom + sourceBanner(pkgName) + sep + rest.replace(/^\n+/, ""),
            changed: true,
            why: ["bandeau absent"],
        };
    }

    const m = rest.match(/^\/\*!([\s\S]*?)\*\//);
    const block = m[0];
    const lines = block.split("\n");
    // lines[0] === "/*!", lines[last] contient "*/"

    // (2) usurped title
    const foreign = foreignPackageInTitle(info.title, pkgName);
    if (foreign) {
        const idx = lines.findIndex((l, i) => i > 0 && l.replace(/^\s*\*?\s?/, "").trim() !== "");
        if (idx > 0) {
            lines[idx] = ` * ${pkgName}`;
            why.push(`titre nommait ${foreign}`);
        }
    }

    // (3) missing lines — inserted BEFORE the closing line, in canonical order.
    const closeIdx = lines.length - 1;
    /** @type {string[]} */
    const add = [];
    if (info.authorForm !== "canonique") {
        // A bastard form gets replaced, not doubled.
        const bad = lines.findIndex((l) => /\(c\)\s*\d{4}|Mattieu Pottier/.test(l));
        if (bad > 0) {
            lines[bad] = ` * © ${COPYRIGHT_YEAR} ${HOLDER}`;
            why.push(`ligne d'auteur ${info.authorForm}`);
        } else {
            add.push(` * © ${COPYRIGHT_YEAR} ${HOLDER}`);
            why.push("ligne d'auteur absente");
        }
    }
    if (!info.hasMit) {
        add.push(` * ${LICENSE_LINE}`);
        why.push("mention MIT absente");
    }
    if (!info.hasUrl) {
        add.push(` * ${PROJECT_URL}`);
        why.push("ligne URL absente");
    }
    if (add.length) lines.splice(closeIdx, 0, ...add);

    if (!why.length) return { source, changed: false, why };
    return { source: bom + lines.join("\n") + rest.slice(block.length), changed: true, why };
}

module.exports = {
    COPYRIGHT_YEAR,
    HOLDER,
    PROJECT_URL,
    LICENSE_LINE,
    PUBLISHED_PACKAGE_LICENSE,
    LICENSE_FILE_COPYRIGHT,
    TYPOGRAPHIC_COPYRIGHT,
    BANNER_RE,
    renderBanner,
    sourceBanner,
    bundleBanner,
    displayLabel,
    packageAliases,
    inspect,
    foreignPackageInTitle,
    normalize,
};
