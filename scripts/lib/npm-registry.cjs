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
 *
 * ## Comparable hashes, not raw ones
 *
 * The parity gate compares what the registry carries with what this repository would ship.
 * Under `dist/`, Rollup names chunks by content hash, and that hash differs between two
 * machines building the same sources — measured on 2026-09-10, every raw `dist/` divergence
 * of the published core was that noise, and none survived its removal. Both hashing helpers
 * therefore strip those hashes from `dist/` names and bytes before hashing
 * (`normalizeChunkHashes`), and refuse to conclude when two files become indistinguishable
 * once stripped. The maps they return also carry the ROOT their files live in, so a caller that
 * must read a file — PUB-05 comparing JavaScript beyond its bytes — reads the very file that
 * was hashed, instead of re-deriving where a tarball was extracted.
 */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { execFileSync, spawnSync } = require("child_process");

/**
 * Comparable hashes of a package's files: `comparable path → sha256`, plus `originals`
 * (`comparable path → real path`) and `root` (the directory those real paths are relative to).
 *
 * @typedef {Map<string,string> & {originals: Map<string,string>, root: string}} ComparableHashes
 */

/**
 * What the registry said about one version of one package — an answer, or the lack of one.
 *
 * - `published` — the registry lists this version;
 * - `version-absent` — it lists the package's versions, and this one is not among them;
 * - `package-absent` — it answered E404: it does not know the package;
 * - `unknown` — no answer: a refused connection, an authentication error, an output nobody
 *   can read. `code` names it.
 *
 * @typedef {{ state: "published" | "version-absent" | "package-absent" } |
 *   { state: "unknown", code: string }} RegistryAnswer
 */

/**
 * Reads the output of `npm view <name> versions --json` for one version.
 *
 * 🛑 ONLY A LIST OF VERSIONS OR AN E404 IS AN ANSWER. This lib used to read every failure of
 * `npm view` as "not published": a refused connection, an authentication error, a registry
 * answering 404 for everything — all of them "a version awaiting publication". On 09/09/2026 the
 * parity gate thus skipped its whole corpus on the publication runner and exited 0.
 *
 * The shape is the one npm 10.9.8 and npm 12.0.2 print, measured on 18/09/2026 on the seventeen
 * public packages: an ARRAY of versions — a single version included —, or an error object whose
 * `code` is `E404` when the registry does not know the package. Anything else is `unknown`,
 * never a guess (the same rule as {@link packEntry}).
 *
 * @param {string} stdout What `npm view <name> versions --json` printed on stdout.
 * @param {string} version The version asked about.
 * @returns {RegistryAnswer} The answer, or `unknown` with its code.
 * @example
 * readRegistryAnswer('["3.2.0", "3.3.0"]', "3.3.0"); // → { state: "published" }
 * readRegistryAnswer('{"error":{"code":"ECONNREFUSED"}}', "3.3.0");
 * // → { state: "unknown", code: "ECONNREFUSED" }
 */
function readRegistryAnswer(stdout, version) {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    } catch {
        return { state: "unknown", code: "unreadable" };
    }
    if (Array.isArray(parsed)) {
        return { state: parsed.includes(version) ? "published" : "version-absent" };
    }
    const code = parsed?.error?.code;
    if (code === "E404") return { state: "package-absent" };
    return {
        state: "unknown",
        code: typeof code === "string" && code !== "" ? code : "unreadable",
    };
}

/**
 * Asks the registry about one version of one package.
 *
 * @param {string} name npm name of the package (`@geoleaf/core`).
 * @param {string} version Version declared in its manifest.
 * @returns {RegistryAnswer} What the registry said — see {@link readRegistryAnswer}.
 * @example
 * const answer = registryAnswer("@geoleaf/core", "3.3.0");
 * if (answer.state === "unknown") console.log(`no answer (${answer.code})`);
 */
function registryAnswer(name, version) {
    const res = spawnSync("npm", ["view", name, "versions", "--json"], {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
    });
    if (res.error) {
        // `spawnSync` types its error as a bare `Error`; a failed spawn carries the errno code.
        const code = /** @type {NodeJS.ErrnoException} */ (res.error).code;
        return { state: "unknown", code: code ?? "spawn" };
    }
    return readRegistryAnswer(res.stdout ?? "", version);
}

/**
 * Does the registry ALREADY carry exactly this version of this package?
 *
 * ⚠️ `false` covers every other case, a registry that did not answer included. A publisher can
 * live with that: it then attempts the publication, and the registry refuses an existing version
 * loudly. The parity gate cannot — it reads {@link registryAnswer} instead.
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
    return registryAnswer(name, version).state === "published";
}

/**
 * The single package entry of one `npm pack --dry-run --json` output, whatever the npm major.
 *
 * 🛑 THE ROOT SHAPE CHANGED WITH npm 12, AND ONLY THE PUBLICATION RUNNER RUNS npm 12.
 * Measured 18/09/2026 on `@geoleaf-plugins/cog`: npm 10 prints an ARRAY, `[ { name, files } ]`;
 * npm 12.0.2 prints an OBJECT keyed by package name, `{ "<name>": { name, files } }` — the entry
 * itself is identical. `publish.yml` pins npm 12 for trusted publishing while a workstation runs
 * whatever it has, so `JSON.parse(out)[0]` read `undefined` on the one machine that publishes:
 * the parity gate died on a `TypeError` in front of the irreversible act, after passing locally.
 *
 * ⚠️ Any other shape THROWS rather than returning `null`. `localFileHashes`' caller reads `null`
 * as a package not built — PUB-00, a named skip that reddens only under `release:check` —; an
 * unknown output read that way would pass everywhere else for a package nobody built, when it is
 * an instrument that cannot read its own tool.
 * Exactly one entry is required in either shape: `npm pack` runs in ONE package's directory.
 *
 * @param {unknown} parsed The parsed JSON that `npm pack --dry-run --json` printed.
 * @returns {{ files: { path: string }[] }} The package entry.
 * @throws {Error} Named `PackShapeError` when neither known shape yields one `files` array.
 */
function packEntry(parsed) {
    let entries = [];
    if (Array.isArray(parsed)) entries = parsed;
    else if (parsed !== null && typeof parsed === "object") entries = Object.values(parsed);
    const entry = entries.length === 1 ? entries[0] : undefined;
    if (!entry || !Array.isArray(entry.files)) {
        const err = new Error(
            "`npm pack --dry-run --json` printed a shape this instrument does not know — " +
                "neither `[ { files } ]` (npm ≤ 11) nor `{ <name>: { files } }` (npm 12), " +
                "with exactly one package"
        );
        err.name = "PackShapeError";
        throw err;
    }
    return entry;
}

/**
 * Comparable SHA-256 of every file the registry actually carries for `name@version`.
 *
 * Downloads the published tarball and extracts it: comparing tarballs byte-for-byte would be
 * meaningless (gzip and mtimes are not reproducible), while comparing their CONTENTS is exact.
 * Files under `dist/` are hashed with their chunk hashes stripped — see `hashEntries`.
 *
 * @param {string} name npm name of the package.
 * @param {string} version Version to fetch.
 * @param {string} tmpDir Writable directory; this function creates a subdirectory in it.
 * @returns {ComparableHashes|null} `comparable path → sha256`, its `originals` and the
 *   extraction `root`, or `null` when the fetch failed (offline, E404, no registry access) —
 *   the caller must SKIP, never conclude.
 * @throws {Error} Named `ChunkNameCollisionError` when two published files become the same
 *   path once normalized. Deliberately NOT turned into `null`: a collision is not a network
 *   failure, and reading it as one would skip the package in silence.
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
    } catch {
        return null;
    }
    // Outside the `try`, on purpose — see `@throws`.
    return hashTree(path.join(dest, "package"));
}

/**
 * Comparable SHA-256 of every file `npm publish` WOULD send from a local package directory.
 *
 * Uses `npm pack --dry-run`, which resolves `files[]`, `.npmignore` and npm's own always-include
 * rules exactly as a real publish would — then hashes those files from disk. No tarball is
 * written: the dry run yields the list, and the bytes are already there. Files under `dist/`
 * are hashed with their chunk hashes stripped — see `hashEntries`.
 *
 * @param {string} absDir Absolute directory of the package.
 * @returns {ComparableHashes|null} `comparable path → sha256`, its `originals` and `root` —
 *   the package directory itself — or `null` when `npm pack` failed.
 * @throws {Error} Named `ChunkNameCollisionError` — see `publishedFileHashes` — or
 *   `PackShapeError` when `npm pack` printed a shape `packEntry` does not know.
 */
function localFileHashes(absDir) {
    let parsed;
    try {
        const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
            cwd: absDir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        parsed = JSON.parse(out);
    } catch {
        return null;
    }
    // OUTSIDE the `try` on purpose: an output this instrument cannot read must throw, not
    // become the `null` above — see `packEntry`.
    const listed = packEntry(parsed);
    const entries = [];
    for (const f of listed.files) {
        const abs = path.join(absDir, f.path);
        // A listed file absent from disk means the package was not built. The caller
        // distinguishes that from a divergence; silently hashing nothing would not.
        if (fs.existsSync(abs)) entries.push({ rel: f.path, abs });
    }
    return hashEntries(entries, absDir);
}

/** SHA-256 of one file. */
function sha256(file) {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * A chunk name carrying Rollup's content hash: `geoleaf-<name>-<8 base64url characters>.js`.
 *
 * Anchored on the `geoleaf-` prefix because every HASHED chunk this repository emits carries
 * it — the core's `chunks/geoleaf-[name]-[hash].js`, a plugin's
 * `geoleaf-<plugin>.[name]-[hash].js` — while unhashed files are named with ordinary words.
 * 🛑 The first version had no prefix, and its first run against the published core refused to
 * conclude: `maplibre-cluster-builders.js`, a granular entry with no hash at all, ends in an
 * eight-letter word and became `maplibre-cluster.js`, colliding with the real one. The
 * collision refusal is what caught it; a looser rule without that refusal would have blurred
 * two files into one, in silence.
 *
 * `.js` right after the eight characters pins the split on the dash exactly nine characters
 * before it, which keeps a hash that itself contains a dash (`BT-vtPKw`) whole. Eight is
 * Rollup's default `[hash]` length; a hashed name the pattern misses is not blurred — it stays
 * distinct on both sides and reddens loudly.
 *
 * ⚠️ **Known, measured and accepted imprecision**: a NON-hashed name that starts with
 * `geoleaf-` and ends in an eight-character segment is rewritten too — on 2026-09-10, one
 * published file of the whole repository, `geoleaf-field-renderer.js` (→ `geoleaf-field.js`).
 * It is harmless by construction: the rewrite is identical on both sides, so it can neither
 * create a divergence nor hide one not confined to that segment, and a rewrite that merged two
 * real files would hit the collision refusal. Telling words from hashes by their case was
 * weighed and rejected: an all-lowercase hash is about one draw in a thousand per chunk, and
 * it would redden persistently for a reason that is not a divergence.
 */
const CHUNK_HASH = /(geoleaf-[A-Za-z0-9_.-]*)-[A-Za-z0-9_-]{8}\.js/g;

/**
 * Strips Rollup's content hash from every chunk name found in `text`.
 *
 * Applied to a path, it makes two builds of the same sources name their chunks alike; applied
 * to a file's contents, it does the same to the specifiers that import those chunks. Nothing
 * else is rewritten: a change anywhere outside a chunk name still changes the hash.
 *
 * @param {string} text A path, or file contents read as `latin1` (bytes kept one to one).
 * @returns {string} The same text, every `<name>-<hash>.js` rewritten as `<name>.js`.
 * @example
 * normalizeChunkHashes("dist/chunks/geoleaf-chunk-core-utils-BT-vtPKw.js");
 * // → "dist/chunks/geoleaf-chunk-core-utils.js"
 */
function normalizeChunkHashes(text) {
    return text.replace(CHUNK_HASH, "$1.js");
}

/**
 * Hashes packaged files into `comparable path → sha256`.
 *
 * Files under `dist/` have their chunk hashes stripped from path AND bytes before hashing
 * (`normalizeChunkHashes`); every other file is hashed as is. The returned map also carries
 * `originals` (`comparable path → real path`), so a caller can name the file a reader will
 * actually find.
 *
 * @param {{rel: string, abs: string}[]} entries Package-relative POSIX path, absolute path.
 * @param {string} [root] The directory the `rel` paths are relative to, carried on the result.
 * @returns {ComparableHashes} The comparable hashes, their `originals` and `root`.
 * @throws {Error} Named `ChunkNameCollisionError` when two files become the same path once
 *   normalized — the map would silently keep one of them, so it refuses instead. Raised
 *   before any file is read.
 * @example
 * const hashes = hashEntries([{ rel: "dist/geoleaf.esm.js", abs: "/pkg/dist/geoleaf.esm.js" }]);
 * hashes.get("dist/geoleaf.esm.js"); // → the sha256 of its normalized bytes
 */
function hashEntries(entries, root = "") {
    const originals = new Map();
    for (const { rel } of entries) {
        const key = rel.startsWith("dist/") ? normalizeChunkHashes(rel) : rel;
        if (originals.has(key)) {
            const err = new Error(
                `normalisation ambiguë : « ${originals.get(key)} » et « ${rel} » deviennent tous ` +
                    `deux « ${key} » — la comparaison en garderait un seul, elle refuse de conclure`
            );
            err.name = "ChunkNameCollisionError";
            throw err;
        }
        originals.set(key, rel);
    }
    const out = new Map();
    for (const { rel, abs } of entries) {
        if (!rel.startsWith("dist/")) {
            out.set(rel, sha256(abs));
            continue;
        }
        const text = normalizeChunkHashes(fs.readFileSync(abs).toString("latin1"));
        const hash = crypto.createHash("sha256").update(Buffer.from(text, "latin1")).digest("hex");
        out.set(normalizeChunkHashes(rel), hash);
    }
    Object.defineProperty(out, "originals", { value: originals });
    Object.defineProperty(out, "root", { value: root });
    // Properties added this way are invisible to the compiler; the cast states what the lines
    // above made true, and keeps them non-enumerable.
    return /** @type {ComparableHashes} */ (out);
}

/** Recursively lists a directory, then hashes it — see `hashEntries`. */
function hashTree(root) {
    const entries = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else entries.push({ rel: path.relative(root, p).split(path.sep).join("/"), abs: p });
        }
    };
    walk(root);
    return hashEntries(entries, root);
}

module.exports = {
    alreadyPublished,
    readRegistryAnswer,
    registryAnswer,
    publishedFileHashes,
    localFileHashes,
    packEntry,
    normalizeChunkHashes,
    hashEntries,
};
