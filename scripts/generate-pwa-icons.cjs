#!/usr/bin/env node
"use strict";

/**
 * GeoLeaf PWA Icons Generator
 *
 * Generates 4 PNG icons from src/assets/icons/logo.png:
 *   - icon-192.png          (192×192, purpose: any)
 *   - icon-512.png          (512×512, purpose: any)
 *   - icon-192-maskable.png (192×192, purpose: maskable — logo at 80% safe zone)
 *   - icon-512-maskable.png (512×512, purpose: maskable — logo at 80% safe zone)
 *
 * Usage:
 *   npm i -D sharp --no-save && node scripts/generate-pwa-icons.cjs
 *
 * Requires: sharp, installed ON DEMAND — it is deliberately NOT a devDependency.
 *
 * 🛑 Why it is not declared (09/08/2026). `sharp` ships `@img/sharp-wasm32`
 * (`cpu: ["wasm32"]`, `optional: true`), which needs `@emnapi/runtime`. When Dependabot
 * regenerates the lockfile it writes ALL platform variants but moves `@emnapi/runtime`
 * under `packages/build-config/node_modules/`, leaving no node reachable from the root —
 * so `npm ci` on the runner re-resolves it, misses it, and dies with EUSAGE **before any
 * gate runs**. Measured: PR #76 bumps only `web-vitals`, keeps sharp at 0.33.5, and fails
 * identically. That made EVERY Dependabot PR red, this one included.
 *
 * Declaring it back re-opens that failure. It also re-imports a HIGH advisory
 * (`sharp <0.35.0`) that nothing here needs: this script is the only caller, it is wired
 * into no gate (`ci:local` and `ci.yml` both ignore `icons:generate`), and it runs by hand.
 *
 * @version 1.3.0
 */

const fs = require("node:fs");
const path = require("node:path");

let sharp;
try {
    sharp = require("sharp");
} catch {
    console.error(
        "✗  sharp is not installed — by design, see this file's header.\n" +
            "   Install it for this run only, without touching package.json:\n" +
            "     npm i -D sharp --no-save"
    );
    process.exit(1);
}

// ── Paths ──────────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, "..");
// T2 — the PWA icons followed the application out of the core library. Resolved via
// the registry: `requireByDirName` throws on a rename, where the previous literal
// `packages/core/src/assets/icons` would have kept pointing at a directory that no
// longer exists — and this script WRITES, so a stale path means silently generating
// icons nobody reads.
const ICONS_DIR = path.join(
    require("./lib/packages.cjs").requireByDirName("geoleaf-app").absDir,
    "src",
    "assets",
    "icons"
);
const INPUT = path.join(ICONS_DIR, "logo.png");

// Brand color — GeoLeaf theme green
const BACKGROUND_COLOR = { r: 45, g: 106, b: 79, alpha: 1 }; // #2d6a4f

// ── Colors ─────────────────────────────────────────────────────────────────
const C = {
    green: "\x1b[32m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    reset: "\x1b[0m",
};
const log = {
    ok: (m) => console.log(`${C.green}✓${C.reset}  ${m}`),
    err: (m) => console.error(`${C.red}✗${C.reset}  ${m}`),
    info: (m) => console.log(`${C.cyan}ℹ${C.reset}  ${m}`),
};

// ── Icon definitions ────────────────────────────────────────────────────────
const ICONS = [
    {
        name: "icon-192.png",
        size: 192,
        maskable: false,
    },
    {
        name: "icon-512.png",
        size: 512,
        maskable: false,
    },
    {
        name: "icon-192-maskable.png",
        size: 192,
        maskable: true,
        // Safe zone: logo occupies 80% of canvas (20% padding overall, 10% each side — maskable spec)
    },
    {
        name: "icon-512-maskable.png",
        size: 512,
        maskable: true,
    },
];

// ── Main ────────────────────────────────────────────────────────────────────
(async function main() {
    log.info("GeoLeaf PWA Icons Generator");
    log.info(`Source: ${INPUT}`);
    log.info(`Output: ${ICONS_DIR}`);
    console.log();

    if (!fs.existsSync(INPUT)) {
        log.err(`logo.png not found at: ${INPUT}`);
        log.err("Ensure the source icon exists before running this script.");
        process.exit(1);
    }

    let hasError = false;

    for (const icon of ICONS) {
        const outputPath = path.join(ICONS_DIR, icon.name);
        const size = icon.size;

        try {
            if (icon.maskable) {
                // Maskable: logo at 80% of canvas, centered on solid background
                // Safe zone = center square covering 80% of canvas dimensions
                const logoSize = Math.round(size * 0.8);
                const offset = Math.round((size - logoSize) / 2);

                const logoBuffer = await sharp(INPUT)
                    .resize(logoSize, logoSize, { fit: "contain", background: BACKGROUND_COLOR })
                    .toBuffer();

                await sharp({
                    create: {
                        width: size,
                        height: size,
                        channels: 4,
                        background: BACKGROUND_COLOR,
                    },
                })
                    .composite([{ input: logoBuffer, top: offset, left: offset }])
                    .png()
                    .toFile(outputPath);
            } else {
                // Standard: logo fills the icon (with solid background for transparency handling)
                await sharp(INPUT)
                    .resize(size, size, { fit: "contain", background: BACKGROUND_COLOR })
                    .flatten({ background: BACKGROUND_COLOR })
                    .png()
                    .toFile(outputPath);
            }

            const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(1);
            log.ok(
                `${icon.name}  (${size}×${size}${icon.maskable ? ", maskable" : ""}) — ${sizeKB} KB`
            );
        } catch (err) {
            log.err(`Failed to generate ${icon.name}: ${err.message}`);
            hasError = true;
        }
    }

    console.log();
    if (hasError) {
        log.err("Some icons failed to generate. Check errors above.");
        process.exit(1);
    }

    log.ok("All 4 PWA icons generated successfully.");
    log.info(
        "Next: run `node scripts/build-deploy.cjs --full` to include them in deploy variants."
    );
})();
