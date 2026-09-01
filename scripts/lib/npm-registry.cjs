#!/usr/bin/env node
/**
 * What the npm REGISTRY already carries — the one question a publisher must ask before
 * writing.
 *
 * ## Why this lib exists
 *
 * `publish-plugins.cjs` knew how to skip an already-published package; `publish.yml` did
 * not for `@geoleaf/core` and `@geoleaf/field-renderer`, whose steps were BARE
 * `npm publish` calls. Measured on 2026-08-15: those two packages being on the registry
 * at `3.0.0` and `1.0.0`, the workflow died on an `E403` at its FIRST step — never
 * reaching the 12 plugins it exists to publish.
 *
 * 🛑 Yet the workflow declares itself re-runnable, and its own comment says why:
 * "publication is an irreversible act, one must be able to re-run it without forging a
 * tag". Only the 12 plugins were. This lib carries the missing half, in one place —
 * copying it into a second publisher would redden `jscpd`, and above all would let two
 * definitions of "already published" diverge.
 *
 * ⚠️ **Skipping is not publishing.** Every caller must keep the two apart in its tally:
 * "14/14" must never be readable as fourteen publications where there were only four.
 */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { execFileSync, execSync } = require("child_process");

/**
 * Does the registry ALREADY carry exactly this version of this package?
 *
 * @param {string} name npm name of the package (`@geoleaf/core`).
 * @param {string} version Version declared in its manifest.
 * @returns {boolean} `true` if the registry carries exactly this version.
 *
 * @example
 * if (alreadyPublished("@geoleaf/core", "3.0.0")) {
 *     console.log("already on the registry — skipped");
 * }
 */
function alreadyPublished(name, version) {
    try {
        const out = execSync(`npm view ${name}@${version} version --json`, {
            stdio: ["ignore", "pipe", "ignore"],
            encoding: "utf8",
        }).trim();
        // ⚠️ `npm view` returns an EMPTY string — not an error — when the package exists
        // but not that version. Testing only for the absence of an exception would say
        // "published" on a version that is not, hence skip a real publication.
        return out.length > 0 && out !== "undefined";
    } catch {
        // `npm view` errors out on an E404 — the package or the version does not exist.
        return false;
    }
}

/**
 * SHA-256 of every file the registry actually carries for `name@version`.
 *
 * Downloads the published tarball and extracts it: comparing tarballs byte-for-byte would be
 * meaningless (gzip and mtimes are not reproducible), while comparing their CONTENTS is exact.
 *
 * @param {string} name npm name of the package.
 * @param {string} version Version to fetch.
 * @param {string} tmpDir Writable directory; this function creates a subdirectory in it.
 * @returns {Map<string,string>|null} `path → sha256`, or `null` when the fetch failed
 *   (offline, E404, no registry access) — the caller must SKIP, never conclude.
 *
 * @example
 * const published = publishedFileHashes("@geoleaf/core", "3.0.0", os.tmpdir());
 * if (published === null) console.log("registry unreachable — skipped, not green");
 */
function publishedFileHashes(name, version, tmpDir) {
    const dest = path.join(tmpDir, name.replace(/[@/]/g, "_") + "-" + version);
    try {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(dest, { recursive: true });
        execFileSync(
            "npm",
            ["pack", `${name}@${version}`, "--silent", "--pack-destination", dest],
            {
                stdio: ["ignore", "ignore", "ignore"],
            }
        );
        const tgz = fs.readdirSync(dest).find((f) => f.endsWith(".tgz"));
        if (!tgz) return null;
        execFileSync("tar", ["xzf", path.join(dest, tgz), "-C", dest], { stdio: "ignore" });
        return hashTree(path.join(dest, "package"));
    } catch {
        return null;
    }
}

/**
 * SHA-256 of every file `npm publish` WOULD send from a local package directory.
 *
 * Uses `npm pack --dry-run`, which resolves `files[]`, `.npmignore` and npm's own always-include
 * rules exactly as a real publish would — then hashes those files from disk. No tarball is
 * written: the dry run yields the list, and the bytes are already there.
 *
 * @param {string} absDir Absolute directory of the package.
 * @returns {Map<string,string>|null} `path → sha256`, or `null` when `npm pack` failed.
 */
function localFileHashes(absDir) {
    try {
        const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
            cwd: absDir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        const listed = JSON.parse(out)[0];
        const map = new Map();
        for (const f of listed.files) {
            const abs = path.join(absDir, f.path);
            // A listed file absent from disk means the package was not built. The caller
            // distinguishes that from a divergence; silently hashing nothing would not.
            if (fs.existsSync(abs)) map.set(f.path, sha256(abs));
        }
        return map;
    } catch {
        return null;
    }
}

/** SHA-256 of one file. */
function sha256(file) {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Recursively hashes a directory into `relative posix path → sha256`. */
function hashTree(root) {
    const out = new Map();
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else out.set(path.relative(root, p).split(path.sep).join("/"), sha256(p));
        }
    };
    walk(root);
    return out;
}

module.exports = { alreadyPublished, publishedFileHashes, localFileHashes };
