"use strict";
/**
 * boot-assets.cjs — ce qu'un PREMIER CHARGEMENT demande, dérivé une seule fois.
 *
 * ## Pourquoi ce module existe
 *
 * Le Sprint 3 de `roadmap_socle-init` a fait de `build-deploy.cjs` la source dérivée des trois
 * listes qui décrivaient le répertoire de distribution à la main. Le Sprint 4 a besoin
 * EXACTEMENT du même ensemble pour une autre raison — le peser — et le geste qui échoue serait
 * d'en écrire un second extracteur. Deux extracteurs divergent ; celui qui n'est pas maintenu
 * sort vert en mesurant autre chose. Un seul corpus, deux consommateurs :
 *
 *   • `build-deploy.cjs`        — injecte `STATIC_ASSETS` et les `<link rel="modulepreload">`
 *   • `check-app-payload.cjs`   — gate le poids que ces mêmes URL représentent
 *
 * C'est le patron déjà appliqué par `lib/tsdoc-examples.cjs` (`productDocsFiles()`), pour la
 * même raison et après le même défaut.
 *
 * ## ⚠️ Le critère est « ce que le premier chargement DEMANDE », pas « ce qui est COPIÉ »
 *
 * Parcourir `outDir` est la dérivation qui semble évidente et c'est la mauvaise : elle embarque
 * les bundles PARESSEUX (annulant la paresse même que le Sprint 4 achète), tous les `.map` et
 * `sw.js` — puis fait rejeter le lot entier par `cache.addAll()` au premier 404. L'ensemble de
 * boot est ce qu'`index.html` référence, plus ce que l'entrée importe STATIQUEMENT. Rien
 * d'autre n'est critique au boot par définition.
 *
 * ## Les deux objets, et pourquoi ils ne se confondent pas
 *
 * `deriveBootCriticalAssets()` rend ce qui est PRÉ-CACHÉ — le shell et son cortège. Il exclut
 * délibérément les données du profil : elles ne sont pas dans `STATIC_ASSETS`, et elles n'ont
 * rien à y faire. Mais le navigateur les télécharge quand même au premier écran, et elles
 * pèsent 60 % de la page. `deriveFirstScreenData()` les rend séparément, pour que la gate de
 * poids voie la page entière là où le worker ne voit que son shell.
 *
 * @module scripts/lib/boot-assets
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * URL relative au déploiement du config racine. Lu à CHAQUE boot par `boot-core.ts`
 * (`profilesPath + "geoleaf.config.json"`), toujours à ce chemin, mais seulement une fois le
 * bundle entier parsé — d'où l'intérêt de le pré-cacher et de le précharger.
 */
const ROOT_CONFIG_DEPLOY_PATH = "profiles/geoleaf.config.json";

/**
 * URL relative au déploiement du shell applicatif. `sw-core.js` sert les navigations hors
 * ligne par un `cache.match("index.html")` LITTÉRAL : cette clé exacte doit être pré-cachée —
 * la chaîne est un contrat entre les deux fichiers, pas un chemin ajustable d'un seul côté.
 */
const APP_SHELL_DEPLOY_PATH = "index.html";

/**
 * Extrait les chunks qu'une entrée ESM bâtie importe STATIQUEMENT.
 *
 * Le partage eager/paresseux ne se lit pas sur le système de fichiers — `dist/chunks/` porte
 * les deux, et c'est précisément le piège. Les paresseux sont `offline-engine-entry` et
 * `qrcode` : les précharger annulerait le bénéfice de leur `import()`, qui existe pour les
 * différer. D'où une extraction qui lit les imports STATIQUES de l'entrée, jamais le répertoire.
 *
 * ⚠️ Ce commentaire a chiffré le gisement — « il en portait 6 dont 4 seulement sont eager » —
 * jusqu'au 08/08/2026, et **les deux nombres étaient faux** à cette date : mesure sur le déployé,
 * **5** chunks dont **3** eager. Les NOMS, eux, étaient justes et le sont restés. C'est la
 * doctrine B-43 : on nomme, on ne compte pas — un décompte en prose diverge sans que rien ne le
 * dise, et celui-ci vivait dans le fichier qui SERT de source à la dérivation.
 *
 * Les deux formes statiques (`… from "x"` et l'effet de bord nu `import "x"`) sont matchées ;
 * `import("x")` ne l'est pas, la parenthèse s'intercalant entre le mot-clé et le guillemet.
 *
 * @param {string} esmFile Chemin absolu de l'entrée bâtie (ex. `dist/geoleaf.esm.js`).
 * @returns {string[]} Chemins de chunks relatifs à la racine de déploiement.
 * @throws {Error} Si l'entrée est illisible, ou si des chunks existent sur le disque sans
 *   qu'aucun ne soit matché — un extracteur qui ne trouve rien en silence est le mode d'échec
 *   que cette assertion garde.
 */
function extractEagerChunks(esmFile) {
    if (!fs.existsSync(esmFile)) {
        throw new Error(`extractEagerChunks: entry not found — ${esmFile}`);
    }
    const code = fs.readFileSync(esmFile, "utf-8");
    const found = new Set();
    for (const re of [
        /\bfrom\s*["'](\.\/chunks\/[^"']+\.js)["']/g,
        /\bimport\s*["'](\.\/chunks\/[^"']+\.js)["']/g,
    ]) {
        for (const m of code.matchAll(re)) {
            found.add(`dist/${m[1].replace(/^\.\//, "")}`);
        }
    }

    // Anti-cécité : une regex qui cesse de matcher (changement de minifieur, répertoire
    // renommé) rendrait une liste vide, et tous les consommateurs en aval sortiraient
    // silencieusement verts sur rien. C'est le corpus qui décide si ce vide est légitime.
    const chunksDir = path.join(path.dirname(esmFile), "chunks");
    const hasChunksOnDisk =
        fs.existsSync(chunksDir) && fs.readdirSync(chunksDir).some((f) => f.endsWith(".js"));
    if (found.size === 0 && hasChunksOnDisk) {
        throw new Error(
            `extractEagerChunks: ${path.basename(esmFile)} yielded 0 static chunk imports ` +
                `while ${path.relative(ROOT, chunksDir)} holds .js files — the extractor stopped matching.`
        );
    }
    return [...found].sort();
}

/**
 * Extrait les assets same-origin qu'un document HTML référence depuis `<script src>` et
 * `<link href>`, chaînes de requête comprises.
 *
 * Les relire sur le markup PATCHÉ — plutôt que de ré-appliquer la règle du `?v=` — est ce qui
 * garde les clés de pré-cache identiques aux URL que le navigateur demandera. Cette égalité
 * est porteuse : `cache.match()` est appelé sans `ignoreSearch`, donc un cache-buster présent
 * d'un côté et absent de l'autre est un raté permanent. Il l'a été : `STATIC_ASSETS`
 * pré-cachait `dist/geoleaf-main.min.css?v=…` quand `index.html` demandait le chemin nu, donc
 * une de ses trois entrées ne servait jamais rien.
 *
 * Les références cross-origin (MapLibre sur unpkg, Google Fonts) sont écartées : `cache.addAll()`
 * rejetterait le lot sur l'une d'elles, et le worker traite déjà les tiers par
 * `networkFirstStrategy`, qui les cache au premier chargement.
 *
 * @param {string} html Le document patché.
 * @returns {string[]} URL relatives, dans l'ordre du document, dédupliquées.
 */
function extractHtmlAssetRefs(html) {
    const refs = [];
    const re = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    for (const m of html.matchAll(re)) {
        const url = m[1].trim();
        if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) continue;
        if (!refs.includes(url)) refs.push(url);
    }
    return refs;
}

/**
 * Clôture transitive des modules `.mjs` atteignables depuis les entrées du document.
 *
 * ## Pourquoi cette quatrième source existe
 *
 * Les trois autres dérivations ne voient QUE ce que le document référence et ce que
 * `dist/geoleaf.esm.js` importe depuis `./chunks/`. Depuis MapLibre 6, le moteur est un graphe
 * de modules : `global.mjs` → `maplibre-gl.mjs` → `maplibre-gl-shared.mjs`, plus un worker.
 * Seul le premier est dans le HTML. Sans cette clôture, le pré-cache en contenait UN sur
 * QUATRE — mesuré le 08/08/2026 — et le service worker sortait vert sur un shell qui ne
 * pouvait pas peindre une carte hors ligne. `deriveBootCriticalAssets` vérifie bien que toute
 * URL dérivée a un fichier ; **jamais l'inverse**, et c'est précisément ce trou-là.
 *
 * ## Pourquoi on scanne les LITTÉRAUX, et pas seulement les `import`
 *
 * ⚠️ Le worker n'est pas chargé par une forme statique. Dans le bundle minifié, son nom est un
 * littéral nu choisi à l'exécution :
 *
 *     let t = e.endsWith(`-dev.mjs`) ? `maplibre-gl-worker-dev.mjs` : `maplibre-gl-worker.mjs`;
 *     return new URL(`./${t}`, e).href
 *
 * Une règle visant `new URL("./x.mjs", import.meta.url)` l'aurait donc MANQUÉ, tout en ayant
 * l'air de le couvrir — la pire forme d'erreur ici. On capte donc tout littéral qui nomme un
 * `.mjs`, quelle que soit la quote, puis on ne RETIENT que ceux qui existent sur le disque :
 * sans ce filtre, `maplibre-gl-worker-dev.mjs` (nommé dans le code, jamais copié) ferait
 * rougir la bijection à tort. Le cas symétrique — un module référencé mais non copié — est
 * gardé en amont par l'anti-cécité de `build-deploy.cjs`, qui jette si un `.mjs` de production
 * du paquet n'est pas dans sa liste de copie.
 *
 * @param {string} outDir Répertoire de sortie de la variante.
 * @param {string[]} htmlRefs URL rendues par `extractHtmlAssetRefs`.
 * @returns {string[]} URL relatives à `outDir`, dédupliquées et triées.
 * @throws {Error} Si un `.mjs` présent dans `vendor/maplibre-gl/` n'est atteint par aucune
 *   règle — le sens que la bijection ne couvre pas, et le seul qui protège d'un extracteur
 *   devenu aveugle.
 */
function extractVendorModuleClosure(outDir, htmlRefs) {
    const LITERAL_MJS = /["'`]([^"'`]*?[\w-]+\.mjs)["'`]/g;
    const reached = new Set();
    const queue = htmlRefs.map((u) => u.split("?")[0]).filter((u) => u.endsWith(".mjs"));

    while (queue.length > 0) {
        const rel = queue.shift();
        if (reached.has(rel)) continue;
        const abs = path.join(outDir, rel);
        if (!fs.existsSync(abs)) continue;
        reached.add(rel);

        const dir = path.posix.dirname(rel.split(path.sep).join("/"));
        for (const m of fs.readFileSync(abs, "utf8").matchAll(LITERAL_MJS)) {
            const spec = m[1].replace(/^\.\//, "");
            if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(spec)) continue; // absolu / cross-origin
            const dep = path.posix.normalize(path.posix.join(dir, spec));
            if (fs.existsSync(path.join(outDir, dep))) queue.push(dep);
        }
    }

    // Anti-cécité — le SENS que `deriveBootCriticalAssets` ne vérifie pas. Un module vendoré
    // qu'aucune règle n'atteint sort silencieusement du pré-cache : le build reste vert et la
    // carte casse hors ligne. Vu rouge en neutralisant la capture des littéraux.
    const vendorRel = "vendor/maplibre-gl";
    const vendorDir = path.join(outDir, vendorRel);
    if (fs.existsSync(vendorDir)) {
        const unreached = fs
            .readdirSync(vendorDir)
            .filter((f) => f.endsWith(".mjs"))
            .map((f) => `${vendorRel}/${f}`)
            .filter((u) => !reached.has(u));
        if (unreached.length > 0) {
            throw new Error(
                `extractVendorModuleClosure: ${unreached.length} module(s) vendoré(s) hors de ` +
                    `la clôture — ${unreached.join(", ")}. Ils ne seraient PAS pré-cachés, et ` +
                    `la carte ne se peindrait pas au premier chargement hors ligne.`
            );
        }
    }
    return [...reached].sort();
}

/**
 * Dérive la liste des assets critiques au boot pour une variante de déploiement.
 *
 * Trois sources, aucune écrite à la main : ce que le document patché référence, ce que
 * l'entrée importe statiquement, et le config racine.
 *
 * Les chunks sont listés explicitement bien que les `<link rel="modulepreload">` les mettent
 * déjà dans le markup : le pré-cache ne doit pas dépendre de la présence du bloc de
 * préchargement. Deux chemins indépendants vers le même ensemble, dédupliqués.
 *
 * @param {object} args
 * @param {string} args.outDir Répertoire de sortie de la variante.
 * @param {string} args.patchedHtml L'`index.html` écrit dans `outDir`.
 * @param {string[]} args.eagerChunks Chunks rendus par `extractEagerChunks`.
 * @returns {{ assets: string[], eagerChunks: string[] }}
 * @throws {Error} Si la dérivation est vide, ou si une URL dérivée n'a aucun fichier derrière
 *   elle dans `outDir` — la bijection qui empêche un pré-cache de pointer dans le vide.
 */
function deriveBootCriticalAssets({ outDir, patchedHtml, eagerChunks }) {
    const assets = [];
    const htmlRefs = extractHtmlAssetRefs(patchedHtml);
    for (const url of [
        // Le shell, en premier et sous EXACTEMENT cette clé. Un document ne se référence pas
        // lui-même, donc aucune extraction ne peut le produire — or `navigationStrategy` sert
        // les navigations hors ligne par un `cache.match("index.html")` littéral. Dériver le
        // reste sans le remettre aurait retiré la seule entrée que l'ancienne liste écrite à
        // la main avait juste, et toute navigation hors ligne avec elle.
        APP_SHELL_DEPLOY_PATH,
        ...htmlRefs,
        // Ce que les modules du document tirent à leur tour. Le HTML ne nomme que l'entrée du
        // graphe MapLibre ; ses trois dépendances n'apparaissent nulle part ailleurs.
        ...extractVendorModuleClosure(outDir, htmlRefs),
        ...eagerChunks,
        ROOT_CONFIG_DEPLOY_PATH,
    ]) {
        if (!assets.includes(url)) assets.push(url);
    }

    if (assets.length === 0) {
        throw new Error(`deriveBootCriticalAssets: empty derivation for ${outDir}`);
    }

    // Bijection : toute URL dérivée doit avoir un fichier derrière elle. Une entrée qui 404
    // fait rejeter le lot ENTIER par `cache.addAll()`, donc l'install échouerait en silence et
    // l'application continuerait de booter en ligne seulement — le défaut exact que le
    // Sprint 3 a clos.
    const missing = assets.filter((u) => !fs.existsSync(path.join(outDir, u.split("?")[0])));
    if (missing.length > 0) {
        throw new Error(
            `deriveBootCriticalAssets: ${missing.length} derived URL(s) have no file in ` +
                `${path.relative(ROOT, outDir)} — ${missing.join(", ")}`
        );
    }
    return { assets, eagerChunks };
}

/**
 * Dérive les fichiers de données que le PREMIER ÉCRAN demande, pour une variante déployée.
 *
 * ⚠️ Ces fichiers ne sont PAS dans `STATIC_ASSETS` et n'ont rien à y faire — ils ne sont pas
 * pré-cachés. Ils sont pourtant 60 % de ce que la page télécharge, et c'est tout l'objet de la
 * gate de poids : `check-bundle-size.cjs` mesure la clôture des imports statiques du core et
 * sort vert à 182,8 / 300 KB gz pendant que la page en charge ~1 500.
 *
 * La chaîne de dérivation, sans aucune liste écrite :
 *
 *     geoleaf.config.json  → data.activeProfile
 *     profile-bundle.json  → themes.config.defautTheme
 *                          → themes.themes[id === defautTheme].layers[].visible === true
 *                          → layerConfigs[layerId].data.{directory,file}
 *
 * Une couche dont la donnée est distante (temps réel, API tierce) n'a pas de fichier local :
 * elle est comptée comme telle et n'entre pas dans le poids same-origin.
 *
 * @param {string} variantDir Répertoire d'une variante déployée (ex. `deploy/deploy-full`).
 * @returns {{ profileId: string, themeId: string, files: string[], remote: string[] }}
 *   `files` : chemins relatifs à `variantDir`. `remote` : ids de couches sans fichier local.
 * @throws {Error} Si le config racine, le bundle de profil ou le thème par défaut sont
 *   introuvables, ou si le thème ne rend AUCUNE couche visible — un thème qui n'allume rien
 *   ferait sortir la gate verte sur un poids de données nul, ce qui est indiscernable d'une
 *   dérivation cassée.
 */
function deriveFirstScreenData(variantDir) {
    const cfgPath = path.join(variantDir, ROOT_CONFIG_DEPLOY_PATH);
    if (!fs.existsSync(cfgPath)) {
        throw new Error(`deriveFirstScreenData: root config not found — ${cfgPath}`);
    }
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    const profileId = cfg?.data?.activeProfile;
    if (!profileId) {
        throw new Error(`deriveFirstScreenData: no data.activeProfile in ${cfgPath}`);
    }

    const profileDir = path.join(variantDir, "profiles", profileId);
    const bundlePath = path.join(profileDir, "profile-bundle.json");
    if (!fs.existsSync(bundlePath)) {
        throw new Error(`deriveFirstScreenData: profile bundle not found — ${bundlePath}`);
    }
    const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));

    // ⚠️ La clé du thème par défaut est `defautTheme` — orthographe du dépôt, pas une faute
    // de frappe à corriger ici : elle est écrite par le générateur de profil et lue par le
    // moteur de thème. La renommer d'un seul côté casserait le boot sans qu'aucune gate ne
    // bronche, exactement la classe que `probe-gate-visibility.cjs` surveille.
    const themeId = bundle?.themes?.config?.defautTheme ?? bundle?.themes?.defaultTheme;
    const themes = bundle?.themes?.themes ?? [];
    const theme = themes.find((t) => t && t.id === themeId);
    if (!theme) {
        throw new Error(
            `deriveFirstScreenData: default theme "${themeId}" not among the ` +
                `${themes.length} theme(s) of ${path.relative(ROOT, bundlePath)}`
        );
    }

    const visible = (theme.layers ?? []).filter((l) => l && l.visible === true);
    if (visible.length === 0) {
        throw new Error(
            `deriveFirstScreenData: theme "${themeId}" turns on 0 layer — a data weight of ` +
                `zero is indistinguishable from a broken derivation.`
        );
    }

    const configs = bundle?.layerConfigs ?? {};
    // Le bundle de profil est lui-même une requête du premier écran, et il est le PLUS SÛR de
    // tous : cette dérivation vient de le lire pour savoir quelles couches sont visibles, donc
    // le navigateur ne peut pas ne pas l'avoir demandé. Il n'est pas dans `STATIC_ASSETS` — il
    // est fetché après le config racine, pas référencé par le markup — et c'est exactement la
    // raison pour laquelle une gate assise sur le seul pré-cache le perdrait.
    const files = [path.relative(variantDir, bundlePath).split(path.sep).join("/")];
    const remote = [];
    for (const layer of visible) {
        const data = configs?.[layer.id]?.data;
        if (!data?.file) {
            remote.push(layer.id);
            continue;
        }
        const rel = path
            .join("profiles", profileId, "layers", layer.id, data.directory ?? "", data.file)
            .split(path.sep)
            .join("/");
        if (fs.existsSync(path.join(variantDir, rel))) {
            files.push(rel);
        } else {
            remote.push(layer.id);
        }
    }

    return { profileId, themeId, files, remote };
}

/**
 * Poids gzip d'un fichier, en octets.
 *
 * ⚠️ Le gzip est recalculé ici plutôt que lu : aucun `.gz` n'existe sur le disque au moment où
 * cette gate tourne (la pré-compression est la tâche 4.2 de la même roadmap), et le poids qui
 * compte est celui que le serveur produira. Le niveau est laissé au défaut de zlib, qui est
 * celui de la plupart des serveurs — un niveau 9 ici surestimerait la compression réelle.
 *
 * @param {string} file Chemin absolu.
 * @returns {number} Octets après gzip.
 */
function gzipSize(file) {
    return zlib.gzipSync(fs.readFileSync(file)).length;
}

module.exports = {
    APP_SHELL_DEPLOY_PATH,
    ROOT_CONFIG_DEPLOY_PATH,
    extractEagerChunks,
    extractHtmlAssetRefs,
    extractVendorModuleClosure,
    deriveBootCriticalAssets,
    deriveFirstScreenData,
    gzipSize,
};
