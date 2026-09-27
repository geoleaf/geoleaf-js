#!/usr/bin/env node
/**
 * Third-party licenses — what each published bundle CARRIES, and the texts that must go with it.
 *
 * ## The defect this exists for — measured on 2026-09-27
 *
 * Nine published packages bundle third-party code (the core: `fflate`, `pmtiles`,
 * `qrcode-generator`; the plugins: `geotiff`, `lerc`, `turf`, `jspdf`, `dompurify`, `protobufjs`,
 * `terra-draw`…). Minification strips every license comment — ZERO `@license` survived in any
 * bundle — and each tarball carried only GeoLeaf's own MIT `LICENSE`. MIT, BSD and ISC ask for
 * their copyright and permission notice to go with every copy; Apache-2.0 asks for its text. The
 * core's `NOTICE.md` named MapLibre alone — a peer, never bundled — and it shipped in no tarball.
 *
 * ## What it does
 *
 * For every PUBLISHABLE package (`scripts/lib/packages.cjs` — never a hard-coded path), it reads
 * the source maps of its built `dist/`, keeps the sources that live under a `node_modules/`, and
 * resolves each to the npm package that holds it. That is what the bundle carries, BY
 * CONSTRUCTION — not what `dependencies` declares, which says neither what tree-shaking kept nor
 * what a transitive dependency brought in. It writes `THIRD_PARTY_LICENSES.txt` next to the
 * package's `package.json`: one section per bundled package, with its license text as its authors
 * ship it — then the license comments of the source files the bundle took from it.
 *
 * Those comments are the half a `LICENSE` file does not hold. A package's `LICENSE` names its own
 * authors; the code it vendors keeps its notices in its sources only — jsPDF's JPEG encoder is
 * Adobe's (BSD-3-Clause), geotiff's JPEG decoder comes from pdf.js (Apache-2.0), zstddec wraps
 * Zstandard (BSD), Terra Draw adapts twelve Turf modules (MIT). Minification strips them all, so
 * they are copied here: a block comment that opens a line (verbatim), or a run of `//` lines
 * (each line's indentation removed), that asks to be kept (`/*!`, `@license`, `@preserve`),
 * states a copyright (`Copyright`, `(C) 1995`, `©`), says it is licensed, or says where the code
 * was adapted from.
 *
 * 🛑 A bundled file may itself be a BUILD — jsPDF and Terra Draw are published minified — and
 * that build already stripped the notices of the code IT vendors (Google's WebP decoder,
 * Adobe's font metrics; rbush, quickselect, which-polygon). They survive only in the
 * `sourcesContent` of the source map such a file ships, so that map is read too: the one its
 * `sourceMappingURL` names (inline `data:` included), or the `.map` beside it.
 *
 * A package that ships no license file gets the standard text of the license its `package.json`
 * declares (`scripts/lib/license-templates/`), with its declared author as the holder — and the
 * section SAYS it is a fallback. A license with no file and no template is refused: the gate
 * cannot attribute it, and says which.
 *
 * `.txt` and not `.md`: the repository formats Markdown on commit, and a generated file the
 * formatter rewrites has no fixed point for `--check`.
 *
 * ## Modes
 *
 *   node scripts/gen-third-party-licenses.cjs          # (re)writes the files
 *   node scripts/gen-third-party-licenses.cjs --check  # gate: exit 1 when a file is stale or
 *                                                      # missing, a package's `files[]` does not
 *                                                      # ship it, or a bundled package cannot be
 *                                                      # attributed
 *
 * ⚠️ It reads `dist/`: build first. `ci:local` builds before its gates; a `dist/` absent from a
 * publishable package is a failure, never a skip — a gate that skips half its corpus goes green
 * without lying.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packages = require("./lib/packages.cjs");

const OUTPUT = "THIRD_PARTY_LICENSES.txt";
const TEMPLATES = path.join(__dirname, "lib", "license-templates");
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;
/**
 * A comment that asks to be kept, states a copyright, says it is licensed, or says where the
 * code was adapted from.
 */
const NOTICE =
    /^\/\*!|@license|@preserve|\bcopyright\b|\(c\)\s*\d{4}|©|\blicen[cs]ed\b|\badapted (?:from|on)\b/i;
/**
 * A block comment that OPENS A LINE. Anchored so that a `/*` in mid-line — in a string or a
 * regex (`accept: "*\/*"`) — cannot start a match and swallow code up to the next comment's end.
 * (A `/*` opening a line INSIDE a multi-line template literal still would: none in the corpus.)
 */
const LINE_COMMENT_BLOCK = /^[ \t]*(\/\*[\s\S]*?\*\/)/gm;

/** True for a license file name: `LICENSE`, `licence.md`, `COPYING`, `LICENSE-MIT.txt`… */
function isLicenseFile(name) {
    const lower = name.toLowerCase();
    const stem = ["license", "licence", "copying"].find((s) => lower.startsWith(s));
    return stem != null && (lower.length === stem.length || "-._".includes(lower[stem.length]));
}

/** Every `.map` file under `dir`, sorted. */
function sourceMaps(dir) {
    const out = [];
    (function walk(d) {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".map")) out.push(full);
        }
    })(dir);
    return out.sort();
}

/** The npm package root holding `file` — the LAST `node_modules/` segment — or null. */
function packageRootOf(file) {
    const at = file.lastIndexOf(NODE_MODULES);
    if (at < 0) return null;
    const parts = file.slice(at + NODE_MODULES.length).split(path.sep);
    const depth = parts[0].startsWith("@") ? 2 : 1;
    return file.slice(0, at + NODE_MODULES.length) + parts.slice(0, depth).join(path.sep);
}

/** The license a manifest declares, as one SPDX-ish string — the legacy `licenses[]` included. */
function declaredLicense(manifest) {
    if (typeof manifest.license === "string") return manifest.license;
    if (manifest.license && typeof manifest.license.type === "string") return manifest.license.type;
    if (Array.isArray(manifest.licenses)) {
        return manifest.licenses
            .map((l) => String(l.type ?? l).replace(/^Apache 2(\.0)?$/i, "Apache-2.0"))
            .join(" OR ");
    }
    return null;
}

/** The author a manifest declares, as a name, or null. */
function declaredAuthor(manifest) {
    const a = manifest.author;
    if (typeof a === "string") return a.replace(/\s*[<(].*$/, "").trim() || null;
    if (a && typeof a.name === "string") return a.name;
    return null;
}

/**
 * The license comments of `files` — and of the original sources their own source maps carry —
 * in file order, each kept once: whitespace, leading `*` and `//` aside, the same notice
 * repeated across files is one notice.
 *
 * @param {Iterable<string>} files - Absolute paths of bundled source files.
 * @returns {string[]} The comments: a block verbatim, `/*` to `*\/` included; a run of `//`
 *   lines with each line's indentation removed.
 */
function embeddedNotices(files) {
    const seen = new Set();
    const out = [];
    for (const file of [...files].sort()) {
        const own = fs.readFileSync(file, "utf8");
        for (const source of [own, ...upstreamSources(file, own)]) {
            for (const comment of noticesIn(source.replace(/\r\n/g, "\n"))) {
                const key = comment.replace(/\/\/|[\s*]+/g, " ").trim();
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(comment);
            }
        }
    }
    return out;
}

/** The notice comments of one source text — blocks and `//` runs — in the order they appear. */
function noticesIn(source) {
    const found = [];
    for (const m of source.matchAll(LINE_COMMENT_BLOCK)) found.push([m.index, m[1]]);
    found.push(...lineCommentRuns(source));
    return found
        .sort((a, b) => a[0] - b[0])
        .map(([, comment]) => comment)
        .filter((comment) => NOTICE.test(comment));
}

/**
 * The runs of consecutive lines that each open with `//`, as `[offset, text]` — scanned line by
 * line: a regex repeating a line pattern is the nested quantifier the linter refuses.
 */
function lineCommentRuns(source) {
    const runs = [];
    let start = -1;
    let lines = [];
    let offset = 0;
    for (const line of source.split("\n")) {
        if (/^[ \t]*\/\//.test(line)) {
            if (start < 0) start = offset;
            lines.push(line.trim());
        } else if (start >= 0) {
            runs.push([start, lines.join("\n")]);
            start = -1;
            lines = [];
        }
        offset += line.length + 1;
    }
    if (start >= 0) runs.push([start, lines.join("\n")]);
    return runs;
}

/**
 * The original sources a pre-built file's own source map carries: the map its last
 * `//# sourceMappingURL` comment — one that opens a line — names — inline `data:` included — or else the `.map` beside it; none for
 * a file that ships no map. A source the map carries no content for is read from disk when it is
 * there. An unreadable map throws, and so does an index map (`sections`), which this does not
 * read: a notice lost to either would be lost without a word.
 */
function upstreamSources(file, text) {
    const urls = [...text.matchAll(/^\/\/[#@] sourceMappingURL=(\S+)/gm)];
    const url = urls.length > 0 ? urls[urls.length - 1][1] : null;
    let json = null;
    let base = path.dirname(file);
    if (url?.startsWith("data:")) {
        const comma = url.indexOf(",");
        const body = url.slice(comma + 1);
        json = url.slice(0, comma).endsWith(";base64")
            ? Buffer.from(body, "base64").toString("utf8")
            : decodeURIComponent(body);
    } else {
        const named = url ? path.resolve(base, url) : null;
        const mapFile = [named, `${file}.map`].find((f) => f != null && fs.existsSync(f));
        if (mapFile) {
            json = fs.readFileSync(mapFile, "utf8");
            base = path.dirname(mapFile);
        }
    }
    if (json == null) return [];
    const map = JSON.parse(json);
    if (Array.isArray(map.sections)) {
        throw new Error(`${file}: its source map is an index map (sections), which is not read`);
    }
    const root = path.resolve(base, map.sourceRoot ?? "");
    return (map.sources ?? []).flatMap((source, i) => {
        const content = map.sourcesContent?.[i];
        if (typeof content === "string") return [content];
        const onDisk = path.resolve(root, source);
        return fs.existsSync(onDisk) ? [fs.readFileSync(onDisk, "utf8")] : [];
    });
}

/**
 * The third-party packages a built `dist/` carries: `name@version` → their root, name, version,
 * declared license and author, and the source files the bundle took from them. The package
 * itself and every `@geoleaf*` package are not third parties.
 */
function bundledPackages(pkg) {
    const dist = path.join(pkg.absDir, "dist");
    if (!fs.existsSync(dist)) throw new Error(`${pkg.name}: no dist/ — build first`);
    const found = new Map();
    for (const map of sourceMaps(dist)) {
        const data = JSON.parse(fs.readFileSync(map, "utf8"));
        for (const source of data.sources ?? []) {
            const file = path.resolve(path.dirname(map), data.sourceRoot ?? "", source);
            const root = packageRootOf(file);
            if (!root || !fs.existsSync(path.join(root, "package.json"))) continue;
            const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
            if (manifest.name === pkg.name || /^@geoleaf(-plugins)?\//.test(manifest.name))
                continue;
            const key = `${manifest.name}@${manifest.version}`;
            if (!found.has(key)) {
                found.set(key, {
                    root,
                    name: manifest.name,
                    version: manifest.version,
                    license: declaredLicense(manifest),
                    author: declaredAuthor(manifest),
                    files: new Set(),
                });
            }
            if (fs.existsSync(file)) found.get(key).files.add(file);
        }
    }
    return [...found.values()].sort((a, b) =>
        a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)
    );
}

/** The license text(s) of a bundled package, or the declared license's template, or null. */
function licenseText(dep) {
    const files = fs
        .readdirSync(dep.root)
        .filter((f) => isLicenseFile(f) && fs.statSync(path.join(dep.root, f)).isFile())
        .sort();
    if (files.length > 0) {
        return files
            .map((f) => {
                const body = fs.readFileSync(path.join(dep.root, f), "utf8").replace(/\r\n/g, "\n");
                return files.length > 1 ? `[${f}]\n\n${body.trim()}` : body.trim();
            })
            .join("\n\n");
    }
    const template = path.join(TEMPLATES, `${dep.license}.txt`);
    if (!dep.license || !fs.existsSync(template)) return null;
    const body = fs.readFileSync(template, "utf8");
    // A template with a copyright line names the declared author; one without (Apache-2.0)
    // names nobody, and the note must not pretend otherwise.
    const holds = body.includes("<copyright holders>");
    const holder = dep.author ?? `the authors of ${dep.name}`;
    return (
        `(${dep.name} ships no license file. What follows is the standard text of the license ` +
        `its package.json declares, ${dep.license}` +
        (holds ? `, with its declared author as the holder.)` : `.)`) +
        `\n\n${body.replace("<copyright holders>", holder).trim()}`
    );
}

/** The file a package must ship, or null when its bundle carries no third-party code. */
function render(pkg, deps, problems) {
    if (deps.length === 0) return null;
    const rule = "=".repeat(78);
    const lines = [
        `Third-party software bundled in ${pkg.name}`,
        "",
        "This package's built files include code from the npm packages listed below. Their",
        "license texts follow, as their authors ship them, each followed by the license comments",
        "of the source files the bundle took from it — and of the original sources their own",
        "source maps carry —, which minification strips. Generated from the bundle's source maps",
        "by scripts/gen-third-party-licenses.cjs — do not edit.",
        "",
        ...deps.map((d) => `  - ${d.name} ${d.version} (${d.license ?? "license not declared"})`),
    ];
    for (const dep of deps) {
        const text = licenseText(dep);
        if (text == null) {
            problems.push(
                `${pkg.name}: ${dep.name}@${dep.version} — no license file and no template for ` +
                    `"${dep.license ?? "(none declared)"}"`
            );
            continue;
        }
        lines.push("", rule, `${dep.name} ${dep.version} — ${dep.license ?? "?"}`, rule, "", text);
        const notices = embeddedNotices(dep.files);
        if (notices.length > 0) {
            lines.push(
                "",
                `--- License comments in the sources of ${dep.name} (and in those it was built from) ---`
            );
            for (const notice of notices) lines.push("", notice);
        }
    }
    return `${lines.join("\n")}\n`;
}

function main() {
    const check = process.argv.includes("--check");
    const problems = [];
    let written = 0;
    let shipped = 0;
    for (const pkg of packages.publishable()) {
        const target = path.join(pkg.absDir, OUTPUT);
        const expected = render(pkg, bundledPackages(pkg), problems);
        const present = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
        const manifest = JSON.parse(fs.readFileSync(path.join(pkg.absDir, "package.json"), "utf8"));
        const listed = (manifest.files ?? []).includes(OUTPUT);

        if (expected == null) {
            if (present != null) {
                if (check)
                    problems.push(
                        `${pkg.name}: ${OUTPUT} is stale — its bundle carries no third-party code`
                    );
                else fs.rmSync(target);
            }
            if (listed)
                problems.push(`${pkg.name}: files[] lists ${OUTPUT}, which it does not need`);
            continue;
        }
        shipped += 1;
        if (!listed) problems.push(`${pkg.name}: files[] does not ship ${OUTPUT}`);
        if (present !== expected) {
            if (check) problems.push(`${pkg.name}: ${OUTPUT} is stale — run the generator`);
            else {
                fs.writeFileSync(target, expected);
                written += 1;
            }
        }
    }

    const scope = `${packages.publishable().length} paquet(s) publiable(s), ${shipped} embarquant du code tiers`;
    if (problems.length > 0) {
        console.error(`✖ [TPL] licences tierces — ${scope} :`);
        for (const p of problems) console.error(`  - ${p}`);
        process.exit(1);
    }
    console.log(
        check
            ? `✅ [TPL] licences tierces à jour — ${scope}.`
            : `✅ [TPL] ${written} fichier(s) écrit(s) — ${scope}.`
    );
}

if (require.main === module) main();

module.exports = { embeddedNotices };
