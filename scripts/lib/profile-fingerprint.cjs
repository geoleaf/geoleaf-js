"use strict";
/**
 * profile-fingerprint.cjs — one opaque token for the CONTENT of a deployed profiles tree.
 *
 * ## Why this module exists
 *
 * Every profile resource is fetched with a `?t=<token>` (`kernel/config/profile.ts`), and
 * outside debug mode that token was the literal `0` — a FIXED URL. Measured on 06/09/2026 at an
 * integrator whose server sends `Cache-Control: max-age=604800` on its static files: the profile
 * and every section it points to stayed pinned for a WEEK in an already-open browser. A setting
 * written server-side was served correctly — verified by `curl` — and stayed invisible in the
 * page. Neither a cache flush nor a server-side regeneration changed it; only a private window
 * showed the truth.
 *
 * `data.profileVersion` lets the embedding application hand over a content fingerprint. This
 * module computes one for the case where there is no embedding application to ask: a deliverable
 * produced by `build-deploy.cjs`, which is copied onto a server nobody here controls.
 *
 * ## Two properties, and the second is the one that is easy to lose
 *
 * ① **It changes when the content changes.** Otherwise it invalidates nothing.
 *
 * ② **It does NOT change when the content does not.** A clock satisfies ① and fails ②, and the
 * failure is not cosmetic: a token that moves on every build makes the browser AND the service
 * worker re-fetch a profile that did not move, on every deployment. `bundle-profiles.cjs`
 * removed its own `_generatedAt` for exactly this reason — "a bundle that differs at identical
 * content" — which is what makes a stable fingerprint reachable here at all.
 *
 * 🛑 **The root config is EXCLUDED from the hash, and that is not an optimisation.** The token
 * is written INTO `profiles/geoleaf.config.json`; hashing that file would make the input depend
 * on the output. Excluding it is what makes the function total. The consequence is named and
 * accepted: a change confined to the root config does not move the token — which is why that one
 * file must be served `no-cache`, a rule the emitted server recipes now carry (`SC-05`).
 *
 * ## What it is NOT
 *
 * Not a version, not a date, not ordered. Nothing reads it back, nothing compares two of them.
 * It is only ever interpolated into a URL. A caller wanting a human-meaningful version wants
 * `profile.version`, which is a different key with a different contract.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * The root config carries the token, so it cannot be part of what the token measures.
 * Compared on the path RELATIVE to the profiles directory, so a `geoleaf.config.json`
 * legitimately living inside a profile subdirectory would still be hashed.
 */
const SELF_REFERENTIAL = "geoleaf.config.json";

/**
 * Every file under `dir`, as paths relative to it, sorted.
 *
 * Sorted because a filesystem does not promise an order, and an unsorted walk would produce a
 * different digest for identical content on another machine — property ② lost to an
 * implementation detail nobody would think to look at.
 *
 * @param {string} dir Absolute path of the directory to walk.
 * @returns {string[]} Relative POSIX paths, sorted, `[]` when `dir` does not exist.
 */
function walkRelative(dir) {
    if (!fs.existsSync(dir)) return [];
    /** @type {string[]} */
    const out = [];
    /** @param {string} current @param {string} prefix */
    const visit = (current, prefix) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) visit(path.join(current, entry.name), rel);
            else if (entry.isFile()) out.push(rel);
        }
    };
    visit(dir, "");
    return out.sort();
}

/**
 * A content fingerprint of a deployed `profiles/` tree.
 *
 * The digest covers each file's PATH as well as its bytes: without the path, moving a layer
 * config from one profile to another, or renaming a section file, would leave the token
 * unchanged while the deployment genuinely differs.
 *
 * @param {string} profilesDir Absolute path of the deployed `profiles/` directory.
 * @returns {string} 16 lowercase hex characters — URL-safe as-is, and short enough that a
 *   human reading a request log can compare two at a glance.
 * @throws {Error} If the tree holds no hashable file. A digest over nothing is a CONSTANT: it
 *   would satisfy the type, pin every client forever, and never fail. Refusing is the only
 *   honest answer — same discipline as `lib/packages.cjs`, which throws rather than return an
 *   empty set that makes a caller pass by scanning nothing.
 */
function profileContentFingerprint(profilesDir) {
    const files = walkRelative(profilesDir).filter((rel) => rel !== SELF_REFERENTIAL);
    if (files.length === 0) {
        throw new Error(
            `profileContentFingerprint: aucun fichier à empreindre sous ${profilesDir} — ` +
                `un condensat sur rien est une CONSTANTE, qui épinglerait tous les clients ` +
                `sans jamais échouer. Soit les profils n'ont pas encore été copiés, soit le ` +
                `chemin est faux ; dans les deux cas un jeton serait un mensonge.`
        );
    }
    const digest = crypto.createHash("sha256");
    for (const rel of files) {
        digest.update(rel, "utf-8");
        digest.update("\0");
        digest.update(fs.readFileSync(path.join(profilesDir, rel)));
        digest.update("\0");
    }
    return digest.digest("hex").slice(0, 16);
}

module.exports = { profileContentFingerprint, walkRelative, SELF_REFERENTIAL };
