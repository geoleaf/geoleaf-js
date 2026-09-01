#!/usr/bin/env node
/**
 * @fileoverview Purges every workspace's `dist/` BEFORE a build — the layered
 * chunks' preventive side.
 *
 * ## Why this script exists
 *
 * `turbo run build` restores its cache **without emptying `dist/` first**
 * (measured on turbo 2.9.18: a hand-placed canary survives a `FULL TURBO`). Two
 * chunk sets captured at different input states then cohabit, and the deploy
 * embarks both.
 *
 * ## What this script does NOT cost
 *
 * Purging `dist/` does **not** force a rebuild: turbo stays cache-HIT and
 * restores its artifacts into an empty directory — hence in a single copy. The
 * cost is an `rm -rf`'s, not a compilation's. That is what makes the founding
 * note's option (b) acceptable at the head of every build rather than reserved
 * for deployment.
 *
 * ## Perimeter
 *
 * Derived from `scripts/lib/packages.cjs`, never a `packages/*​/dist` glob —
 * which matches neither `packages/plugins/*` nor `packages/libs/*`. A hard path
 * does not break on a move: it silently stops matching, and the purge would exit
 * 0 having purged nothing. `deploy/` is NOT purged here: it has its own cycle
 * (`scripts/build-deploy.cjs` cleans it per produced variant).
 *
 * @see scripts/check-dist-integrity.cjs — the guard side, which makes the defect visible
 */

const fs = require("node:fs");
const path = require("node:path");
const packages = require("./lib/packages.cjs");

const quiet = process.argv.includes("--quiet");
const removed = [];

for (const p of packages.all()) {
    const dist = path.join(p.absDir, "dist");
    if (!fs.existsSync(dist)) continue;
    fs.rmSync(dist, { recursive: true, force: true });
    removed.push(p.name);
}

// Anti-empty-purge: if the registry returns no package, the glob stopped
// matching and the purge exits 0 having done nothing — exactly the failure mode
// `packages.cjs` exists to prevent. A never-built repo legitimately has no
// `dist/`, however, so it is the REGISTRY that is checked, not the deletion
// count.
if (packages.all().length === 0) {
    console.error("❌ [PURGE-DIST] le registre de paquets est VIDE — rien n'a été scanné.");
    process.exit(1);
}

if (!quiet) {
    console.log(
        `🧹 [PURGE-DIST] ${removed.length} dist/ supprimé(s) sur ${packages.all().length} paquet(s)` +
            (removed.length ? " : " + removed.join(", ") : " — rien à purger.")
    );
}
