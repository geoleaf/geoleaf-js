#!/usr/bin/env node
/**
 * GeoLeaf — Vector Tile Generator (Sprint 8)
 *
 * Generates PBF vector tiles from GeoJSON files in a profile's layers.
 * Produces a directory structure: layers/{layerId}/tiles/{z}/{x}/{y}.pbf
 *
 * Two backends:
 *   1. tippecanoe (recommended, best quality) — requires WSL, macOS, or Linux
 *   2. Node.js native (geojson-vt + vt-pbf) — cross-platform fallback
 *
 * Usage:
 *   node scripts/generate-vector-tiles.cjs [options]
 *
 * Options:
 *   --profile <id>    Profile to process (default: tourism)
 *   --layer <id>      Single layer to process (default: all VT-enabled layers)
 *   --backend <name>  'tippecanoe' or 'node' (default: auto-detect)
 *   --min-zoom <n>    Min zoom level (default: 0)
 *   --max-zoom <n>    Max zoom level (default: 14)
 *   --dry-run         Show what would be generated without writing files
 *   --force           Overwrite existing tiles
 *
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ────────────────────────────────────────────────────────────────
//  CLI ARGS
// ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name, defaultValue) {
    const idx = args.indexOf(`--${name}`);
    if (idx === -1) return defaultValue;
    return args[idx + 1] || defaultValue;
}

const hasFlag = (name) => args.includes(`--${name}`);

const PROFILE_ID = getArg("profile", "tourism");
const SINGLE_LAYER = getArg("layer", null);
const BACKEND = getArg("backend", "auto");
const MIN_ZOOM = parseInt(getArg("min-zoom", "0"), 10);
const MAX_ZOOM = parseInt(getArg("max-zoom", "14"), 10);
const DRY_RUN = hasFlag("dry-run");
const FORCE = hasFlag("force");

const PROFILES_DIR = path.resolve(__dirname, "..", "profiles");
const PROFILE_DIR = path.join(PROFILES_DIR, PROFILE_ID);

// ────────────────────────────────────────────────────────────────
//  HELPERS
// ────────────────────────────────────────────────────────────────

function log(msg) {
    console.log(`[VTGen] ${msg}`);
}

function warn(msg) {
    console.warn(`[VTGen] ⚠ ${msg}`);
}

function error(msg) {
    console.error(`[VTGen] ✖ ${msg}`);
}

/**
 * Discover all VT-enabled layers from layer configs.
 * Reads each layer's config JSON and checks for data.vectorTiles.enabled.
 *
 * ⚠️ The layers index is resolved through `profile.json`'s `Files.layersFile`, never guessed.
 * This function hardcoded `<profile>/layers.json` until 06/08/2026 — a path that has not existed
 * since the profile layout v2 moved the index to `config/core/layers.json`, so the script exited 1
 * on "layers.json not found" for every profile. Reading the manifest is also what `PRF-PATHS`
 * requires: a companion file not declared in `Files` must not be loaded.
 *
 * Only direct `layers[]` entries are considered. `layerTemplates` instances are skipped by
 * construction, and correctly so: `expandLayerTemplates` rebuilds `data` as `{directory, file}`
 * only, so a template instance can never carry a `data.vectorTiles` block in the first place.
 */
function discoverVTLayers() {
    const profileJsonPath = path.join(PROFILE_DIR, "profile.json");
    if (!fs.existsSync(profileJsonPath)) {
        error(`profile.json not found: ${profileJsonPath}`);
        process.exit(1);
    }

    const profile = JSON.parse(fs.readFileSync(profileJsonPath, "utf-8"));
    const layersFile = profile.Files && profile.Files.layersFile;
    if (!layersFile) {
        error(`Files.layersFile not declared in ${profileJsonPath}`);
        process.exit(1);
    }

    const layersJsonPath = path.join(PROFILE_DIR, layersFile);
    if (!fs.existsSync(layersJsonPath)) {
        error(`layers index not found: ${layersJsonPath} (from Files.layersFile)`);
        process.exit(1);
    }

    const layersIndex = JSON.parse(fs.readFileSync(layersJsonPath, "utf-8"));
    const layersList = Array.isArray(layersIndex)
        ? layersIndex
        : Array.isArray(layersIndex.layers)
          ? layersIndex.layers
          : null;
    if (!layersList) {
        error(`No layers[] array in ${layersJsonPath}`);
        process.exit(1);
    }

    const vtLayers = [];

    for (const entry of layersList) {
        if (SINGLE_LAYER && entry.id !== SINGLE_LAYER) continue;
        if (!entry.configFile) continue; // template instance — cannot carry data.vectorTiles

        const configPath = path.join(PROFILE_DIR, entry.configFile);
        if (!fs.existsSync(configPath)) {
            warn(`Config not found: ${configPath}`);
            continue;
        }

        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

        // Check for vectorTiles config
        const vtConfig = (config.data && config.data.vectorTiles) || config.vectorTiles;

        if (!vtConfig || vtConfig.enabled === false) continue;

        // Resolve GeoJSON source file
        const dataDir = (config.data && config.data.directory) || "data";
        const dataFile = (config.data && config.data.file) || `${entry.id}.geojson`;
        const layerDir = path.dirname(configPath);
        const geojsonPath = path.join(layerDir, dataDir, dataFile);

        if (!fs.existsSync(geojsonPath)) {
            warn(`GeoJSON not found: ${geojsonPath}`);
            continue;
        }

        const tilesDir = vtConfig.tilesDirectory || "tiles";
        const tilesOutputDir = path.join(layerDir, tilesDir);

        vtLayers.push({
            id: entry.id,
            layerName: vtConfig.layerName || entry.id,
            geojsonPath,
            tilesOutputDir,
            minZoom: vtConfig.minZoom || MIN_ZOOM,
            maxZoom: vtConfig.maxNativeZoom || MAX_ZOOM,
            sizeMB: (fs.statSync(geojsonPath).size / (1024 * 1024)).toFixed(2),
        });
    }

    return vtLayers;
}

/**
 * Check if tippecanoe is available (directly or via WSL).
 */
function detectTippecanoe() {
    try {
        execSync("tippecanoe --version 2>&1", { stdio: "pipe" });
        return "native";
    } catch {
        // Try WSL on Windows
        if (process.platform === "win32") {
            try {
                execSync("wsl tippecanoe --version 2>&1", { stdio: "pipe" });
                return "wsl";
            } catch {
                return null;
            }
        }
        return null;
    }
}

// ────────────────────────────────────────────────────────────────
//  BACKEND: TIPPECANOE
// ────────────────────────────────────────────────────────────────

/**
 * Generate tiles using tippecanoe (best quality).
 * Produces an mbtiles file then extracts to directory structure.
 */
function generateWithTippecanoe(layer, tippecanoeMode) {
    const prefix = tippecanoeMode === "wsl" ? "wsl " : "";

    // Convert Windows paths for WSL
    const geojsonPath =
        tippecanoeMode === "wsl"
            ? layer.geojsonPath
                  .replace(/\\/g, "/")
                  .replace(/^([A-Z]):/, (m, d) => `/mnt/${d.toLowerCase()}`)
            : layer.geojsonPath;

    const mbtilesPath =
        tippecanoeMode === "wsl"
            ? layer.tilesOutputDir
                  .replace(/\\/g, "/")
                  .replace(/^([A-Z]):/, (m, d) => `/mnt/${d.toLowerCase()}`) +
              `/${layer.id}.mbtiles`
            : path.join(layer.tilesOutputDir, `${layer.id}.mbtiles`);

    const tilesOutDir =
        tippecanoeMode === "wsl"
            ? layer.tilesOutputDir
                  .replace(/\\/g, "/")
                  .replace(/^([A-Z]):/, (m, d) => `/mnt/${d.toLowerCase()}`)
            : layer.tilesOutputDir;

    // Ensure output dir exists
    fs.mkdirSync(layer.tilesOutputDir, { recursive: true });

    // Generate mbtiles
    const cmd = [
        `${prefix}tippecanoe`,
        `-o "${mbtilesPath}"`,
        `--minimum-zoom=${layer.minZoom}`,
        `--maximum-zoom=${layer.maxZoom}`,
        `--simplification=10`,
        `--drop-densest-as-needed`,
        `--layer="${layer.layerName}"`,
        `--no-tile-compression`,
        FORCE ? "--force" : "",
        `"${geojsonPath}"`,
    ]
        .filter(Boolean)
        .join(" ");

    log(`  Running: ${cmd}`);
    if (!DRY_RUN) {
        execSync(cmd, { stdio: "inherit" });
    }

    // Extract mbtiles to directory structure using tile-join
    const extractCmd = [
        `${prefix}tile-join`,
        `--output-to-directory="${tilesOutDir}"`,
        `--no-tile-compression`,
        FORCE ? "--force" : "",
        `"${mbtilesPath}"`,
    ]
        .filter(Boolean)
        .join(" ");

    log(`  Extracting: ${extractCmd}`);
    if (!DRY_RUN) {
        execSync(extractCmd, { stdio: "inherit" });

        // Clean up mbtiles file
        const mbtilesLocal = path.join(layer.tilesOutputDir, `${layer.id}.mbtiles`);
        if (fs.existsSync(mbtilesLocal)) {
            fs.unlinkSync(mbtilesLocal);
        }
    }
}

// ────────────────────────────────────────────────────────────────
//  BACKEND: NODE.JS NATIVE (geojson-vt + vt-pbf)
// ────────────────────────────────────────────────────────────────

/**
 * Generate tiles using Node.js native geojson-vt + vt-pbf.
 * Cross-platform, no external tools needed.
 * Quality is good but not as optimized as tippecanoe.
 */
function generateWithNode(layer) {
    let geojsonvt, vtpbf;

    try {
        geojsonvt = require("geojson-vt");
    } catch {
        error("geojson-vt not installed. Run: npm install --save-dev geojson-vt");
        process.exit(1);
    }

    try {
        vtpbf = require("vt-pbf");
    } catch {
        error("vt-pbf not installed. Run: npm install --save-dev vt-pbf");
        process.exit(1);
    }

    log(`  Loading GeoJSON: ${layer.geojsonPath}`);
    const geojson = JSON.parse(fs.readFileSync(layer.geojsonPath, "utf-8"));

    log(`  Building tile index (zoom ${layer.minZoom}-${layer.maxZoom})...`);
    const tileIndex = geojsonvt(geojson, {
        maxZoom: layer.maxZoom,
        indexMaxZoom: layer.maxZoom,
        tolerance: 3,
        buffer: 64,
        lineMetrics: false,
        generateId: true,
    });

    // Ensure output dir exists
    fs.mkdirSync(layer.tilesOutputDir, { recursive: true });

    let tileCount = 0;

    for (let z = layer.minZoom; z <= layer.maxZoom; z++) {
        const n = Math.pow(2, z);
        for (let x = 0; x < n; x++) {
            for (let y = 0; y < n; y++) {
                const tile = tileIndex.getTile(z, x, y);
                if (!tile || !tile.features || tile.features.length === 0) continue;

                // Convert to PBF using vt-pbf
                const pbfData = vtpbf.fromGeojsonVt({ [layer.layerName]: tile }, { version: 2 });

                const tileDir = path.join(layer.tilesOutputDir, String(z), String(x));
                const tilePath = path.join(tileDir, `${y}.pbf`);

                if (!DRY_RUN) {
                    fs.mkdirSync(tileDir, { recursive: true });
                    fs.writeFileSync(tilePath, pbfData);
                }

                tileCount++;
            }
        }
    }

    log(`  Generated ${tileCount} tiles (zoom ${layer.minZoom}-${layer.maxZoom})`);
}

// ────────────────────────────────────────────────────────────────
//  MAIN
// ────────────────────────────────────────────────────────────────

function main() {
    console.log("═══════════════════════════════════════════════════");
    console.log("  GeoLeaf — Vector Tile Generator (Sprint 8)");
    console.log("═══════════════════════════════════════════════════\n");

    // Discover layers
    const vtLayers = discoverVTLayers();
    if (vtLayers.length === 0) {
        warn("No VT-enabled layers found.");
        process.exit(0);
    }

    log(`Found ${vtLayers.length} VT-enabled layer(s):\n`);
    for (const l of vtLayers) {
        log(`  • ${l.id} (${l.sizeMB} MB) → ${l.layerName} [z${l.minZoom}-${l.maxZoom}]`);
    }
    console.log();

    // Detect backend
    let backend = BACKEND;
    if (backend === "auto") {
        const tippecanoeMode = detectTippecanoe();
        if (tippecanoeMode) {
            backend = "tippecanoe";
            log(`Backend: tippecanoe (${tippecanoeMode})`);
        } else {
            backend = "node";
            log("Backend: Node.js native (geojson-vt + vt-pbf)");
        }
    }

    if (DRY_RUN) {
        log("DRY RUN — no files will be written.\n");
    }

    // Generate tiles for each layer
    const startTime = Date.now();
    let tippecanoeMode = null;

    if (backend === "tippecanoe") {
        tippecanoeMode = detectTippecanoe();
    }

    for (const layer of vtLayers) {
        log(`\n─── Processing: ${layer.id} (${layer.sizeMB} MB) ───`);

        // Check if tiles already exist
        if (!FORCE && fs.existsSync(layer.tilesOutputDir)) {
            const existing = fs.readdirSync(layer.tilesOutputDir);
            if (existing.some((f) => /^\d+$/.test(f))) {
                warn(`Tiles already exist for ${layer.id}. Use --force to overwrite.`);
                continue;
            }
        }

        try {
            if (backend === "tippecanoe") {
                generateWithTippecanoe(layer, tippecanoeMode);
            } else {
                generateWithNode(layer);
            }
            log(`  ✅ Done: ${layer.id}`);
        } catch (err) {
            error(`Failed to generate tiles for ${layer.id}: ${err.message}`);
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n═══════════════════════════════════════════════════`);
    log(`Completed in ${elapsed}s`);
    console.log("═══════════════════════════════════════════════════");
}

main();
