/**
 * @fileoverview Generates a profile-bundle.json for each modular GeoLeaf profile.
 *
 * Reads all section files (taxonomy, themes, basemaps, ui, layers + layer configs)
 * from a deploy destination and merges them into a single bundle file, reducing
 * the ~19 HTTP requests at startup to 3 (geoleaf.config.json + profile.json + bundle).
 *
 * Also patches profile.json to add `"bundleFile": "profile-bundle.json"` so the
 * runtime loader can detect and use the bundle automatically.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const BUNDLE_VERSION = "1.0";
const BUNDLE_FILENAME = "profile-bundle.json";

/**
 * Returns true if the profile object uses the modular format (Files object present
 * or version >= 1.2), matching the runtime isModularProfile() logic.
 */
function _isModularProfile(profile) {
    if (profile.Files && typeof profile.Files === "object") return true;
    if (profile.version) {
        const m = String(profile.version).match(/^(\d+)\.(\d+)/);
        if (m) {
            const major = parseInt(m[1], 10);
            const minor = parseInt(m[2], 10);
            return major > 1 || (major === 1 && minor >= 2);
        }
    }
    return false;
}

/**
 * Reads a JSON file and returns its parsed content, or null on error.
 */
function _readJson(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return null;
    }
}

/**
 * Reads a section file referenced by `profile.Files[key]` relative to `profileDir`.
 * Returns null if the key is not declared or the file is missing.
 */
function _readSectionFile(profile, key, profileDir) {
    const fileName = profile.Files?.[key];
    if (!fileName) return null;
    return _readJson(path.join(profileDir, fileName));
}

/**
 * Reads the layers file and returns { layersFileData, staticLayers }.
 * staticLayers are the layers that have a `configFile` (non-template layers).
 */
function _readLayersFile(profile, profileDir) {
    const layersFileName = profile.Files?.layersFile;
    if (!layersFileName) return { layersFileData: null, staticLayers: [] };
    const layersFilePath = path.join(profileDir, layersFileName);
    const layersFileData = _readJson(layersFilePath);
    if (!layersFileData) return { layersFileData: null, staticLayers: [] };

    // Extract the regular layers array (non-template)
    const rawLayers = Array.isArray(layersFileData.layers) ? layersFileData.layers : [];
    const staticLayers = rawLayers.filter(
        (l) => l && typeof l === "object" && typeof l.configFile === "string"
    );
    return { layersFileData, staticLayers };
}

/**
 * Reads every plugin config file declared in `profile.Files.modules`
 * (profile layout v2) and returns the bag { [moduleId]: configObject },
 * or null when nothing is declared / readable.
 */
function _readModuleFiles(profile, profileDir) {
    const modulesMap = profile.Files?.modules;
    if (!modulesMap || typeof modulesMap !== "object" || Array.isArray(modulesMap)) return null;
    const bag = {};
    for (const [moduleId, filePath] of Object.entries(modulesMap)) {
        if (typeof filePath !== "string" || !filePath) continue;
        const config = _readJson(path.join(profileDir, filePath));
        if (config !== null) bag[moduleId] = config;
    }
    return Object.keys(bag).length > 0 ? bag : null;
}

/**
 * Reads all layer config files for the static layers.
 * Returns a map of { [layerId]: configObject }.
 */
function _readLayerConfigs(staticLayers, profileDir) {
    const layerConfigs = {};
    for (const layer of staticLayers) {
        const configPath = path.join(profileDir, layer.configFile);
        const config = _readJson(configPath);
        if (config !== null) {
            layerConfigs[layer.id] = config;
        }
    }
    return layerConfigs;
}

/**
 * Generates profile-bundle.json for a single modular profile directory.
 * Patches profile.json to add `"bundleFile"`.
 *
 * @param {string} profileDir  - Absolute path to the profile directory (e.g. deploy/.../profiles/tourism)
 * @param {string} profileId   - Profile identifier (e.g. "tourism")
 * @returns {{ bundleSize: number, layerCount: number }}
 */
function bundleProfile(profileDir, profileId) {
    const profilePath = path.join(profileDir, "profile.json");
    const profile = _readJson(profilePath);
    if (!profile) {
        throw new Error(`[BundleProfiles] profile.json not found at ${profilePath}`);
    }

    if (!_isModularProfile(profile)) {
        console.log(`[BundleProfiles] ${profileId}: not a modular profile, skipping`);
        return { bundleSize: 0, layerCount: 0 };
    }

    const themes = _readSectionFile(profile, "themesFile", profileDir);
    const basemaps = _readSectionFile(profile, "basemapsFile", profileDir);
    const ui = _readSectionFile(profile, "uiFile", profileDir);
    const features = _readSectionFile(profile, "featuresFile", profileDir);
    const mapping = _readSectionFile(profile, "mappingFile", profileDir);
    const modules = _readModuleFiles(profile, profileDir);
    const { layersFileData, staticLayers } = _readLayersFile(profile, profileDir);
    const layerConfigs = _readLayerConfigs(staticLayers, profileDir);

    // 🛑 `_generatedAt: Date.now()` RETIRÉ (S5.8) — écrit ici, lu NULLE PART.
    //
    // Zéro consommateur mesuré dans `packages/*/src`, `apps/` et `scripts/` : c'était un champ
    // purement informatif, et son seul effet observable était de rendre le bundle DIFFÉRENT à
    // chaque build. Ce n'est pas anodin : `profile-bundle.json` est pré-caché par le service
    // worker (il est dans `STATIC_ASSETS`) et c'est le fichier qui effondre 32 requêtes en une
    // seule. Un horodatage le faisait re-télécharger à chaque déploiement, à contenu identique.
    //
    // ⚠️ Trouvé par `check-build-determinism.cjs --deploy`, pas par l'énoncé de la tâche : la
    // roadmap ne nommait que les deux `Date.now()` de `build-deploy.cjs`. Une gate qui compare
    // le déployé entier voit ce qu'une gate qui compare les `?v=` ne peut pas voir.
    //
    // `_bundleVersion` reste : c'est une version de FORMAT, déterministe, et elle est lue.
    const bundle = {
        _bundleVersion: BUNDLE_VERSION,
        _profileId: profileId,
    };
    if (themes) bundle.themes = themes;
    if (basemaps) bundle.basemaps = basemaps;
    if (ui) bundle.ui = ui;
    if (features) bundle.features = features;
    if (mapping) bundle.mapping = mapping;
    if (modules) bundle.modules = modules;
    if (layersFileData) bundle.layersFile = layersFileData;
    if (Object.keys(layerConfigs).length > 0) bundle.layerConfigs = layerConfigs;

    const bundlePath = path.join(profileDir, BUNDLE_FILENAME);
    const bundleJson = JSON.stringify(bundle, null, 2);
    fs.writeFileSync(bundlePath, bundleJson, "utf-8");

    // Patch profile.json: add bundleFile reference
    profile.bundleFile = BUNDLE_FILENAME;
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf-8");

    const bundleSize = Buffer.byteLength(bundleJson, "utf-8");
    const layerCount = Object.keys(layerConfigs).length;
    return { bundleSize, layerCount };
}

module.exports = { bundleProfile, BUNDLE_FILENAME, BUNDLE_VERSION };
