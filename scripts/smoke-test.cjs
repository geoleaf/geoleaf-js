/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

function assert(condition, message) {
    if (!condition) {
        const error = new Error(message);
        error.name = "SmokeTestError";
        throw error;
    }
}

function fileExists(filePath) {
    try {
        fs.accessSync(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

function readText(filePath) {
    return fs.readFileSync(filePath, "utf8");
}

// In monorepo: when called from packages/core/ CWD, dist/ is relative to CWD.
// Fallback: packages/core/dist/ relative to repo root (CI root-level call).
function findDistDir() {
    const cwdDist = path.join(process.cwd(), "dist");
    if (fs.existsSync(cwdDist)) return cwdDist;
    const monorepoCoreDist = path.join(__dirname, "..", "packages", "core", "dist");
    if (fs.existsSync(monorepoCoreDist)) return monorepoCoreDist;
    return path.join(__dirname, "..", "dist");
}
const distDir = findDistDir();

const esmPath = path.join(distDir, "geoleaf.esm.js");

assert(fileExists(distDir), "dist/ does not exist. Run `npm run build` first.");

// ESM flat bundle required.
assert(fileExists(esmPath), "Missing dist/geoleaf.esm.js. Run `npm run build`.");

const chunksDir = path.join(distDir, "chunks");
assert(
    fileExists(chunksDir),
    "Missing dist/chunks/ directory — the manualChunks split did not run."
);

const esmText = readText(esmPath);

// The "is the bundle a stub?" check must weigh the BOOT PAYLOAD — the entry plus the chunks it
// imports statically — not the entry file alone.
//
// It used to assert `esmText.length > 100_000`, and that assertion silently stopped meaning
// anything when `kernel-exports.ts` (S4) moved the entry's content into chunks: the entry is now
// a ~1 KB re-export shim, so the check was failing on a perfectly healthy build. Same disease as
// the old BUNDLE_WARN_GZ_KB (removed in S5): a threshold pointed at an artifact that had ceased
// to be the payload. Measure the closure instead — that is what the browser actually downloads.
const { measureEagerBootAt } = require("./check-bundle-size.cjs");
const boot = measureEagerBootAt(esmPath, distDir);
assert(boot != null, "Could not measure the boot closure from dist/geoleaf.esm.js.");
assert(
    boot.chunks > 0,
    "dist/geoleaf.esm.js imports no static chunk — the entry is a shim, so the payload would be empty."
);
assert(
    boot.raw > 100,
    `Boot payload looks unexpectedly small (${boot.raw.toFixed(1)} KB raw over ${boot.chunks} chunks).`
);

// ESM entry must expose named exports.
assert(
    /export\s*\{/.test(esmText) || /export\s+(?:const|function|class|default)/.test(esmText),
    "dist/geoleaf.esm.js has no ESM exports — check bundle-esm-entry.ts."
);

assert(/GeoLeaf/.test(esmText), 'dist/geoleaf.esm.js does not contain "GeoLeaf" identifier.');

console.log(
    `Smoke test OK: ESM bundle present, boot payload ${boot.raw.toFixed(1)} KB raw over ${boot.chunks} static chunks.`
);
