#!/usr/bin/env node
/**
 * GeoLeaf — GeoJSON Simplification + Precision Reduction (Sprint S2)
 *
 * Applies mapshaper Douglas-Peucker simplification + coordinate precision
 * reduction to the heavy GeoJSON files listed in TARGETS.
 *
 * Originals are backed up to data/originals/ before any modification.
 * The script is idempotent: re-running always processes from the backup.
 *
 * Usage:
 *   node scripts/simplify-geojson.cjs [options]
 *
 * Options:
 *   --profile <id>    Profile to process (default: tourism)
 *   --simplify <pct>  Vertices to keep in %, e.g. 25 (default: 10)
 *   --precision <n>   Coordinate decimal places, e.g. 6 (default: 6)
 *   --dry-run         Show what would be done without writing files
 *   --restore         Restore originals from data/originals/ backups
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ──────────────────────────────────────────────────────────────────────────────
//  TARGET LAYERS  (> 2 MB — ordered by size desc)
// ──────────────────────────────────────────────────────────────────────────────

const TARGETS = [
    "departements", // 8.71 MB
    "pays", // 4.77 MB
    "provinces", // 4.16 MB
    "reseau_ferroviaire", // 3.99 MB
    "zones_de_conservation_wdpa", // 2.59 MB
    "eco_regions", // 2.11 MB
];

// ──────────────────────────────────────────────────────────────────────────────
//  CLI ARGS
// ──────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name, def) {
    const idx = args.indexOf(`--${name}`);
    if (idx === -1) return def;
    return args[idx + 1] ?? def;
}

const PROFILE_ID = getArg("profile", "tourism");
const SIMPLIFY_PCT = parseFloat(getArg("simplify", "10"));
const PRECISION = parseInt(getArg("precision", "6"), 10);
const DRY_RUN = args.includes("--dry-run");
const RESTORE = args.includes("--restore");

const ROOT = path.resolve(__dirname, "..");
const PROFILES_DIR = path.join(ROOT, "profiles");
const PROFILE_DIR = path.join(PROFILES_DIR, PROFILE_ID);

// ──────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────────────────────────────────────────

function formatMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function fileSize(p) {
    try {
        return fs.statSync(p).size;
    } catch {
        return 0;
    }
}

function precisionStr(n) {
    // e.g. 6 → "0.000001"
    return "0." + "0".repeat(n - 1) + "1";
}

const log = (m) => console.log(`[Simplify] ${m}`);
const warn = (m) => console.warn(`[Simplify] ⚠  ${m}`);
const ok = (m) => console.log(`[Simplify] ✅ ${m}`);
const fail = (m) => console.error(`[Simplify] ✖  ${m}`);

// ──────────────────────────────────────────────────────────────────────────────
//  RESTORE MODE
// ──────────────────────────────────────────────────────────────────────────────

function restoreOriginals() {
    log("RESTORE MODE — restoring originals from backups…\n");
    let n = 0;

    for (const layerId of TARGETS) {
        const dataDir = path.join(PROFILE_DIR, "layers", layerId, "data");
        const geojsonFile = `${layerId}.geojson`;
        const backupPath = path.join(dataDir, "originals", geojsonFile);
        const targetPath = path.join(dataDir, geojsonFile);

        if (!fs.existsSync(backupPath)) {
            warn(`No backup for ${layerId} — skipped`);
            continue;
        }

        if (!DRY_RUN) fs.copyFileSync(backupPath, targetPath);
        ok(`Restored: ${layerId} (${formatMB(fileSize(backupPath))})`);
        n++;
    }

    console.log();
    log(`${n}/${TARGETS.length} files restored.`);
}

// ──────────────────────────────────────────────────────────────────────────────
//  SIMPLIFY ONE LAYER
// ──────────────────────────────────────────────────────────────────────────────

function simplifyLayer(layerId) {
    const dataDir = path.join(PROFILE_DIR, "layers", layerId, "data");
    const geojsonFile = `${layerId}.geojson`;
    const geojsonPath = path.join(dataDir, geojsonFile);
    const originalsDir = path.join(dataDir, "originals");
    const backupPath = path.join(originalsDir, geojsonFile);

    if (!fs.existsSync(geojsonPath)) {
        warn(`File not found: ${geojsonPath} — skipped`);
        return null;
    }

    const sizeBefore = fileSize(geojsonPath);

    // Backup original (once), then always work from the backup
    if (!fs.existsSync(backupPath)) {
        if (!DRY_RUN) {
            fs.mkdirSync(originalsDir, { recursive: true });
            fs.copyFileSync(geojsonPath, backupPath);
        }
        log(`  Backed up → data/originals/${geojsonFile}`);
    } else {
        // Re-run: restore fresh copy from backup so we process pristine data
        if (!DRY_RUN) fs.copyFileSync(backupPath, geojsonPath);
        log(`  Using backup as source (idempotent re-run)`);
    }

    const precision = precisionStr(PRECISION);

    // mapshaper: simplify then write in-place with reduced precision
    // "force" required by mapshaper to allow overwriting an input file
    const cmd = [
        "npx",
        "--yes",
        "mapshaper",
        "-i",
        `"${geojsonPath}"`,
        "-simplify",
        `dp ${SIMPLIFY_PCT}% keep-shapes`,
        "-o",
        `"${geojsonPath}" force precision=${precision} format=geojson`,
    ].join(" ");

    log(`  Simplify: ${SIMPLIFY_PCT}% vertices  |  precision: ${PRECISION} decimals`);

    if (!DRY_RUN) {
        try {
            execSync(cmd, { stdio: "pipe", cwd: ROOT });
        } catch (e) {
            fail(`mapshaper error for ${layerId}: ${e.message}`);
            // Auto-restore on failure
            fs.copyFileSync(backupPath, geojsonPath);
            return null;
        }
    }

    const sizeAfter = DRY_RUN ? sizeBefore : fileSize(geojsonPath);
    const reduction =
        sizeBefore > 0 ? (((sizeBefore - sizeAfter) / sizeBefore) * 100).toFixed(1) : "?";

    return { layerId, sizeBefore, sizeAfter, reduction };
}

// ──────────────────────────────────────────────────────────────────────────────
//  MAIN
// ──────────────────────────────────────────────────────────────────────────────

function main() {
    console.log("══════════════════════════════════════════════════════════════");
    console.log("  GeoLeaf — GeoJSON Simplifier + Precision Reducer  (S2)");
    console.log("══════════════════════════════════════════════════════════════\n");

    if (RESTORE) {
        restoreOriginals();
        return;
    }

    if (DRY_RUN) log("DRY RUN — no files will be written.\n");

    log(`Profile   : ${PROFILE_ID}`);
    log(`Simplify  : ${SIMPLIFY_PCT}% vertices  (Douglas-Peucker, keep-shapes)`);
    log(`Precision : ${PRECISION} decimal places  (= ${precisionStr(PRECISION)} °)`);
    log(`Targets   : ${TARGETS.length} layers\n`);

    const results = [];

    for (const layerId of TARGETS) {
        log(`─── ${layerId} ───`);
        const result = simplifyLayer(layerId);

        if (result) {
            results.push(result);
            ok(
                `${layerId}: ${formatMB(result.sizeBefore)} → ${formatMB(result.sizeAfter)}  (−${result.reduction}%)`
            );
        }
        console.log();
    }

    // Summary table
    if (results.length === 0) {
        warn("No files processed.");
        return;
    }

    console.log("══════════════════════════════════════════════════════════════");
    log("RESULTS");
    console.log("──────────────────────────────────────────────────────────────");

    let totalBefore = 0;
    let totalAfter = 0;

    for (const r of results) {
        const label = r.layerId.padEnd(38);
        const before = formatMB(r.sizeBefore).padStart(8);
        const after = formatMB(r.sizeAfter).padStart(8);
        const pct = `−${r.reduction}%`.padStart(7);
        console.log(`  ${label} ${before} → ${after}  ${pct}`);
        totalBefore += r.sizeBefore;
        totalAfter += r.sizeAfter;
    }

    const totalReduction =
        totalBefore > 0 ? (((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1) : "?";

    console.log("──────────────────────────────────────────────────────────────");
    console.log(
        `  ${"TOTAL".padEnd(38)} ${formatMB(totalBefore).padStart(8)} → ${formatMB(totalAfter).padStart(8)}  −${totalReduction}%`
    );
    console.log("══════════════════════════════════════════════════════════════\n");

    if (!DRY_RUN) {
        log("⚡ Validate visually in the browser before committing.");
        log("   Use --restore to revert all files to their originals.");
        log(`   Re-run with --simplify <pct> to adjust the level (current: ${SIMPLIFY_PCT}%).`);
    }
}

main();
