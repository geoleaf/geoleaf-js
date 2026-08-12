#!/usr/bin/env node

/**
 * Script: Build GeoLeaf Deploy Package
 *
 * Produces a deploy/ folder ready to copy to any static web server
 * (Apache, Nginx, GitHub Pages, Netlify…).
 *
 * ## The variants, and why there are two and no longer three (ARCHI S8)
 *
 * Nine plugins ship in EVERY variant (connector, websocket, realtime-layer, file-import,
 * flatgeobuf, geocoding, print, measure, table). Only three are variant-gated — storage,
 * cog, editor — and that is the whole of the matrix below.
 *
 * ✅ A-27 asked for "5 variants → 2", and it is **2** since task 5.5. It was 3 for one
 * reason only: AddPOI and Editor were mutually exclusive BY DESIGN, so a single variant
 * could never have exercised the AddPOI form — merging them would have DELETED that
 * coverage, not consolidated it. **The merge of Sprint 5 removed the premise, not the
 * argument**: there is one editing plugin now, its point-capture path IS the former AddPOI
 * journey, and `deploy-full` exercises it. The audit's target is reached on the merits.
 *
 * Plugin modes:
 *   • none    (default)     — core + Connector (Connector always bundled with core)
 *   • full                  — core + Storage + Cog + Editor (+ sw.js). The only variant
 *                             carrying BOTH the editor and offline-ui, hence the one the
 *                             offline/sync E2E specs target.
 *   • all / --full          — generate all 2 variants
 *
 * Structure (core):
 *   deploy/
 *   ├── index.html
 *   ├── init.js
 *   ├── dist/
 *   │   ├── geoleaf.esm.js
 *   │   ├── geoleaf.esm.js.map
 *   │   ├── geoleaf-connector.plugin.js   ← always present
 *   │   ├── geoleaf-main.min.css
 *   │   └── geoleaf-main.min.css.map
 *   ├── icons/
 *   └── profiles/
 *       ├── geoleaf.config.json
 *       └── tourism/
 *
 * The gated variants add:
 *   deploy/
 *   ├── sw.js                           (Service Worker — same level as index.html)
 *   └── dist/
 *       ├── geoleaf-offline-ui.plugin.js   (full only)
 *       ├── geoleaf-cog.plugin.js       (full only)
 *       └── geoleaf-editor.plugin.js    (full only)
 *
 * Usage:
 *   npm run build:deploy                           # all 2 variants: deploy-core, deploy-full
 *   node scripts/build-deploy.cjs --plugins=none   # single deploy/ (core + connector)
 *   node scripts/build-deploy.cjs --plugins=full   # → deploy/deploy-full/ (offline POI test)
 *   node scripts/build-deploy.cjs --plugins=all    # all 2 variants
 *   node scripts/build-deploy.cjs --plugins=local  # → deploy/deploy-local/ — POSTE DE TRAVAIL,
 *                                                  #   JAMAIS LIVRÉ (voir §Le bootstrap dev)
 *   node scripts/build-deploy.cjs --full           # alias of --plugins=all
 *   node scripts/build-deploy.cjs --skip-build
 *
 * ## Le bootstrap dev, et pourquoi une variante entière lui est dédiée
 *
 * `connector.local.js` porte un JWT de poste, à privilège d'ÉCRITURE, contre un hôte joignable
 * depuis Internet. Il était copié TEL QUEL dans toute variante, `deploy-core` et `deploy-full`
 * compris — c'est-à-dire dans ce qui part chez un client ou sur un serveur de prod, et dans
 * leurs `.gz`/`.br` par-dessus le marché.
 *
 * ⚠️ **Le raisonnement qui l'autorisait ne mesurait que l'EXÉCUTION.** La garde `localhost` de
 * `init.js` empêche le bootstrap de s'activer sur une origine déployée, et c'est vrai ; mais un
 * secret se lit, il ne s'exécute pas. `curl https://<hôte>/connector.local.js` le rendait en
 * clair, garde ou pas. Une gate qui protège d'une chose et qu'on croit protéger de l'autre est
 * pire qu'une absence de gate.
 *
 * Le partage est donc désormais : **ce fichier** empêche la diffusion (aucune variante livrable
 * ne reçoit autre chose que le talon inerte), **`init.js`** empêche l'activation accidentelle,
 * et **`verify-deploy-no-secrets.cjs`** tient les deux. Le fichier réel ne vit que dans
 * `deploy-local`, hors du build par défaut.
 *
 * @version 3.0.0 — 5.5: 3 variants → 2 (deploy-core, deploy-full). `deploy-addpoi` partie
 *                  avec le plugin fusionné ; sa raison d'être — l'exclusivité mutuelle
 *                  addpoi/editor — n'existe plus.
 *                  ARCHI S8: 5 → 3, `storage` dropped, `addpoi-storage` renamed `addpoi`.
 *                  `deploy-local` s'ajoute hors livrables : elle seule porte le bootstrap dev.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

// La dérivation « ce que le premier chargement demande » vit dans `lib/boot-assets.cjs` et
// non ici, depuis que le Sprint 4 en a eu besoin pour PESER le même ensemble. Un second
// extracteur aurait divergé, et celui des deux qui n'est pas maintenu sort vert en mesurant
// autre chose. Un seul corpus, deux consommateurs — patron de `lib/tsdoc-examples.cjs`.
const {
    APP_SHELL_DEPLOY_PATH,
    ROOT_CONFIG_DEPLOY_PATH,
    extractEagerChunks,
    deriveBootCriticalAssets,
} = require("./lib/boot-assets.cjs");

// socle-init S4.1 — allègement des données de profil au moment du déploiement. Le module vit
// à part parce qu'il est mesurable seul : ses deux réglages sont des CHIFFRES qu'on veut
// pouvoir ré-éprouver sans rebâtir un déployé entier.
const { slimGeoJSON } = require("./lib/geojson-slim.cjs");
const { serverContractFiles, carriesServerContract } = require("./lib/server-contract.cjs");
const { stripDevBackendBindings } = require("./lib/dev-backend.cjs");

// @security (audit L1) Disable the shell on POSIX (CI ubuntu + WSL, where the
// build actually runs) so no command string is ever handed to /bin/sh. Every
// spawn below uses static literal args (zero injection surface), but dropping
// the shell removes the theoretical vector. On Windows, `npm` resolves to
// `npm.cmd`, which Node refuses to spawn without a shell (CVE-2024-27980), so
// the shell is retained there only.
const NPM_SHELL = process.platform === "win32";

// ── Paths ───────────────────────────────────────────────
// Monorepo: core build outputs to packages/core/dist; profiles at root; the app's
// templates live in apps/geoleaf-app/ since T2 (resolved via the registry, see APP).
const ROOT = path.resolve(__dirname, "..");
const DEPLOY = path.join(ROOT, "deploy");
// Dist directories are DERIVED from the workspace registry (ARCHI S9.4) rather than
// rebuilt from `path.join(ROOT, "packages", "<dir>")`. That literal form was the one
// no `grep packages/plugin-` ever found — 14 lines here alone — and it is exactly
// what ARCHI S10 breaks by moving plugins under `packages/plugins/`. Worse, the
// failure would have been silent in the worst way: a deploy/ folder missing its
// plugin bundles, produced by a script that exited 0.
//
// `distOf` throws on an unknown package instead of returning a path that does not
// exist, so a rename surfaces here rather than three steps downstream in a copy loop.
const registry = require("./lib/packages.cjs");

/**
 * Absolute `dist/` directory of a workspace package, by npm name.
 * @param {string} pkgName e.g. "@geoleaf-plugins/offline-ui"
 * @returns {string}
 */
function distOf(pkgName) {
    const pkg = registry.byName(pkgName);
    if (!pkg) {
        throw new Error(
            `build-deploy: unknown package "${pkgName}". Known: ${registry
                .all()
                .map((p) => p.name)
                .join(", ")}`
        );
    }
    return path.join(pkg.absDir, "dist");
}

/**
 * Strip a gated plugin's `<script>` tag from the deploy `index.html` when the
 * variant excludes it. The bundle filename is derived from the registry
 * (`registry.plugins()`, same as `distOf()` above), never hard-coded.
 *
 * ⚠️ A hard-coded filename here is exactly what broke at STRUCT S3.1: the plugin
 * directory `storage` renamed to `offline-ui`, 11 sites in this file followed,
 * but this regex — hand-written on the literal `geoleaf-storage.plugin.js` —
 * did not. `.replace()` on a pattern that matches nothing is silent: the tag
 * survived into `deploy-core/index.html`, referencing a bundle that variant is
 * deliberately built WITHOUT (see the `leaked` guard below), producing a 404 on
 * every page load that no gate caught until the E2E suite did.
 *
 * So this throws rather than degrading: if the source markup names this
 * plugin's bundle anywhere, the patched output must not name it anymore. A
 * `<script>` tag absent from the template to begin with is the normal case and
 * must NOT throw — it is specifically a tag that survived the strip that is the
 * defect.
 *
 * @param {string} html
 * @param {string} pluginDirName e.g. "offline-ui" — the `packages/plugins/<dir>` name
 * @param {string} variantLabel for the error message, e.g. "deploy-core"
 * @returns {string}
 */
function stripPluginScript(html, pluginDirName, variantLabel) {
    const plugin = registry.plugins().find((p) => p.dirName === pluginDirName);
    if (!plugin) {
        throw new Error(
            `build-deploy: stripPluginScript("${pluginDirName}") — no such plugin in the ` +
                `registry. Known: ${registry
                    .plugins()
                    .map((p) => p.dirName)
                    .join(", ")}`
        );
    }
    const escaped = plugin.bundleFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tagRe = new RegExp(
        `^\\s*<script[^>]*src="[^"]*${escaped}[^"]*"[^>]*></script>\\s*$`,
        "gm"
    );
    const hadTag = html.includes(plugin.bundleFile);
    const stripped = html.replace(tagRe, "");
    if (hadTag && stripped.includes(plugin.bundleFile)) {
        throw new Error(
            `build-deploy: ${variantLabel} still references ${plugin.bundleFile} after the ` +
                `strip pass — the removal regex no longer matches the <script> tag's shape in ` +
                `apps/geoleaf-app/index.html. Fix the regex or the template.`
        );
    }
    return stripped;
}

/** Marqueurs encadrant la balise du bootstrap Connector de poste dans `index.html`. */
const DEV_CONNECTOR_MARKERS = {
    start: "GEOLEAF-DEPLOY:DEV-CONNECTOR ─── START",
    end: "GEOLEAF-DEPLOY:DEV-CONNECTOR ─── END",
};

/**
 * Retire d'`index.html` la balise qui charge `connector.local.js`.
 *
 * ## Pourquoi ce retrait existe
 *
 * `connector.local.js` porte un JWT de POSTE à privilège d'écriture. Il n'a rien à faire dans
 * ce qui part chez un client — ni le fichier, ni une référence à lui. Cette fonction est ce
 * qui rend l'absence STRUCTURELLE plutôt que disciplinaire : une variante livrable ne nomme
 * jamais le fichier, donc `verify-deploy-no-secrets.cjs` peut exiger qu'il n'existe pas, au
 * lieu de vérifier qu'un talon a bien la bonne forme.
 *
 * ⚠️ Jusqu'au 09/08/2026 il n'y avait pas de balise : `init.js` faisait un `import()`
 * INCONDITIONNEL du fichier. Un import obligatoire d'un fichier optionnel force le fichier à
 * exister partout — d'où un talon inerte, une entrée `required`, une exemption dans
 * `verify-app-template.cjs`, et le fichier à la racine des livrables. Quatre pièces pour
 * contourner une ligne ; la balise les supprime toutes les quatre.
 *
 * ## Par MARQUEUR et non par regex
 *
 * 🛑 Même motif que `stripGatedInitBlock` : les regexes de gating de ce fichier sont `/gm`
 * **sans** `/s`, donc incapables de couvrir un bloc multi-ligne — le piège qu'APP-04/05
 * surveillent côté HTML. Un découpage entre deux marqueurs par `indexOf` n'a ni flag ni
 * échappement, et survit à un reformatage.
 *
 * ## Ce qui JETTE
 *
 * L'absence d'un marqueur est **toujours** un défaut : `index.html` est la source unique des
 * variantes, le bloc y est inconditionnel. Un marqueur disparu voudrait dire que le retrait ne
 * retire plus rien — il sortirait vert en laissant la balise, donc le fichier, dans un
 * livrable. C'est exactement le faux vert que ce dépôt traque partout ailleurs.
 *
 * @param {string} html contenu d'`index.html`
 * @param {string} variantLabel pour le message d'erreur, ex. "deploy-core"
 * @returns {string}
 */
function stripDevConnectorScript(html, variantLabel) {
    const { start, end } = DEV_CONNECTOR_MARKERS;
    const from = html.indexOf(start);
    const to = html.indexOf(end);
    if (from === -1 || to === -1 || to < from) {
        throw new Error(
            `build-deploy: ${variantLabel} — les marqueurs DEV-CONNECTOR sont absents (ou dans ` +
                `le désordre) dans apps/geoleaf-app/index.html. Sans eux rien n'est retiré, et ` +
                `la variante embarquerait la balise du bootstrap de poste — donc le fichier ` +
                `porteur du jeton. Restaurer la paire START/END autour de la balise.`
        );
    }
    const lineStart = html.lastIndexOf("\n", from) + 1;
    const lineEnd = html.indexOf("\n", to);
    const stripped = html.slice(0, lineStart) + (lineEnd === -1 ? "" : html.slice(lineEnd + 1));

    if (stripped.includes("connector.local.js")) {
        throw new Error(
            `build-deploy: ${variantLabel} nomme encore connector.local.js après le retrait — ` +
                `une référence vit HORS des marqueurs DEV-CONNECTOR. La déplacer à l'intérieur ` +
                `du bloc : une variante livrable ne doit pas nommer ce fichier.`
        );
    }
    return stripped;
}

/**
 * Marker pair delimiting a variant-gated block inside `apps/geoleaf-app/init.js`.
 * @param {string} name gated plugin dir name, e.g. "editor"
 */
function gatedBlockMarkers(name) {
    return {
        start: `GEOLEAF-DEPLOY:GATED-BLOCK ${name} ─── START`,
        end: `GEOLEAF-DEPLOY:GATED-BLOCK ${name} ─── END`,
    };
}

/**
 * Strip a variant-gated block from `init.js` when the variant excludes that plugin.
 *
 * ## Pourquoi ce retrait existe (B-136)
 *
 * `index.html` était patché par variante depuis toujours, `init.js` **jamais** — et c'est
 * `init.js` qui enregistre les créneaux paresseux. Sur une variante sans le bundle, le
 * résolveur était enregistré quand même : `isLazyAvailable()` rend `true` (« enregistré ET
 * pas encore chargé » — il ne sonde aucun fichier), la pilule dessinait le bouton, et le clic
 * partait sur un `import()` en 404. Trois boutons peints, nommés, focusables et inertes sur
 * `deploy-core`, que l'audit d'accessibilité validait sans broncher.
 *
 * ## Pourquoi par INDEX et non par regex, contrairement à `stripPluginScript`
 *
 * 🛑 Les regexes de gating de ce fichier sont `/gm` **sans** `/s`, ce qui les rend
 * incapables de couvrir un bloc multi-ligne — c'est précisément le piège qu'APP-04 et APP-05
 * existent pour surveiller côté HTML. Plutôt que d'ajouter une sixième regex fragile, on
 * découpe entre deux marqueurs par `indexOf`. Aucun flag, aucun échappement, et un bloc
 * reformaté par Prettier reste coupé au bon endroit.
 *
 * ## Ce qui JETTE, et pourquoi c'est plus strict que `stripPluginScript`
 *
 * `stripPluginScript` tolère l'absence de la balise (« tous les gated ne figurent pas dans
 * tous les états d'`index.html` »). Ici l'absence d'un marqueur est **toujours** un défaut :
 * `init.js` est la source unique des variantes, le bloc y est inconditionnel, et un marqueur
 * disparu veut dire que le retrait ne retire plus rien — il sortirait vert en ne coupant
 * rien, ce qui est exactement la classe de faux vert que ce dépôt traque partout ailleurs.
 *
 * @param {string} js contenu de `init.js`
 * @param {string} pluginDirName nom du répertoire du plugin gaté, ex. "editor"
 * @param {string} variantLabel pour le message d'erreur, ex. "deploy-core"
 * @returns {string}
 */
function stripGatedInitBlock(js, pluginDirName, variantLabel) {
    const plugin = registry.plugins().find((p) => p.dirName === pluginDirName);
    if (!plugin) {
        throw new Error(
            `build-deploy: stripGatedInitBlock("${pluginDirName}") — no such plugin in the ` +
                `registry. Known: ${registry
                    .plugins()
                    .map((p) => p.dirName)
                    .join(", ")}`
        );
    }
    const { start, end } = gatedBlockMarkers(pluginDirName);
    const from = js.indexOf(start);
    const to = js.indexOf(end);
    if (from === -1 || to === -1 || to < from) {
        throw new Error(
            `build-deploy: ${variantLabel} — the GATED-BLOCK markers for "${pluginDirName}" are ` +
                `missing (or out of order) in apps/geoleaf-app/init.js. Without them nothing is ` +
                `stripped and the variant would register a lazy slot for a bundle it does not ` +
                `ship (B-136). Restore the START/END comment pair around the block.`
        );
    }
    // Cut whole lines: from the beginning of the START line to the end of the END line.
    const lineStart = js.lastIndexOf("\n", from) + 1;
    const lineEnd = js.indexOf("\n", to);
    const stripped = js.slice(0, lineStart) + (lineEnd === -1 ? "" : js.slice(lineEnd + 1));

    if (stripped.includes(plugin.bundleFile)) {
        throw new Error(
            `build-deploy: ${variantLabel} init.js still references ${plugin.bundleFile} after ` +
                `the gated-block strip — a registration for "${pluginDirName}" lives OUTSIDE the ` +
                `markers. Move it inside the block (see APP-07 in verify-app-template.cjs).`
        );
    }
    return stripped;
}

/**
 * A plugin bundle this script is about to copy is missing from its `dist/`. FATAL.
 *
 * ⚠️ The twelve call sites below were `log.warn` until 08/08/2026, so a deploy missing
 * plugins exited **0**. That was never a corner case: step 2 of this script runs
 * `turbo run build:all --filter=@geoleaf/core`, which rebuilds the core, `connector`,
 * `offline-ui` and `field-renderer` — while **twelve** plugin bundles are copied. The filter
 * pulls the CORE's dependencies, and plugins depend on the core and not the reverse, so the
 * other ten keep whatever `dist/` they last had, or none at all on a fresh clone.
 *
 * What the silence cost: `init.js` registers a lazy slot for every plugin regardless — only
 * `editor` and `cog` sit inside GATED-BLOCK markers. A variant shipped without, say,
 * `geoleaf-measure.plugin.js` therefore paints the button, names it, makes it focusable, and
 * 404s on the first click. That is B-136's symptom reached by another road: B-136 was about
 * VARIANT gating and is solded, this path is a build that simply did not run.
 *
 * @param {string} bundleFile e.g. `geoleaf-measure.plugin.js`.
 * @param {string} variant Variant label for the message, e.g. `full`.
 * @throws {Error} Always — being fatal is the whole point of the function.
 */
function throwMissingBundle(bundleFile, variant) {
    const dirName = bundleFile.replace(/^geoleaf-/, "").replace(/\.plugin\.js$/, "");
    throw new Error(
        `build-deploy: ${variant} — ${bundleFile} is missing from ` +
            `packages/plugins/${dirName}/dist/, so this variant would ship an init.js that ` +
            `registers a lazy slot for a bundle it does not carry: the button is painted and ` +
            `the first click 404s. Rebuild everything before deploying — ` +
            `\`npx turbo run build\`, THEN \`npm run build:deploy\`. Step 2 of this script ` +
            `does not cover all twelve plugins, which is precisely why this is fatal.`
    );
}

const DIST = distOf("@geoleaf/core");
const DIST_STORAGE = distOf("@geoleaf-plugins/offline-ui"); // geoleaf-offline-ui.plugin.js + sw.js
const DIST_CONNECTOR = distOf("@geoleaf-plugins/connector"); // always bundled
const DIST_WEBSOCKET = distOf("@geoleaf-plugins/websocket"); // always bundled
const DIST_REALTIME = distOf("@geoleaf-plugins/realtime-layer"); // always bundled
const DIST_FILEIMPORT = distOf("@geoleaf-plugins/file-import"); // always bundled
const DIST_FLATGEOBUF = distOf("@geoleaf-plugins/flatgeobuf"); // always bundled
const DIST_GEOCODING = distOf("@geoleaf-plugins/geocoding"); // always bundled
const DIST_PRINT = distOf("@geoleaf-plugins/print"); // always bundled
const DIST_MEASURE = distOf("@geoleaf-plugins/measure"); // always bundled
const DIST_TABLE = distOf("@geoleaf-plugins/table"); // always bundled
// taxonomy + feature-info reclassified into @geoleaf/core (SR0) — bundled inside geoleaf.esm.js, no separate copy.
// cog + editor ship only in the `full` variant — a PACKAGING decision (bundle weight:
// cog alone carries geotiff.js), not a property of the plugins themselves.
const DIST_COG = distOf("@geoleaf-plugins/cog"); // `full` variant only
const DIST_EDITOR = distOf("@geoleaf-plugins/editor"); // `full` variant only
// T2 — the deployable application is a workspace of its own now, no longer a set of
// files squatting inside the core LIBRARY. Resolved through the registry, never as
// `path.join(ROOT, "apps", "geoleaf-app")`: `requireByDirName` THROWS when the
// directory is renamed or falls out of the workspace globs, instead of handing back a
// path that does not exist. That matters more here than anywhere else in this file —
// `index.html` is the SINGLE source of every shipped variant, and a literal path
// would not break on a move, it would silently stop matching.
const APP = registry.requireByDirName("geoleaf-app").absDir; // index.html + init.js + manifest.json
// (T1b) `DEMO_ASSETS` (packages/core/demo/) removed with the demo layer.
const PROFILES = path.join(ROOT, "profiles");
// The icons followed the app (T2): 0 reference under packages/core/src, they are read
// only by `index.html` and `manifest.json`. Keeping the `src/assets/icons/` shape is
// deliberate — it keeps the `src/assets/icons/ → icons/` rewrite at step 7 ALIVE and
// leaves `index.html` byte-for-byte untouched by the move. Flattening it here would
// turn that rewrite into a regex matching nothing.
const SRC_ICONS = path.join(APP, "src", "assets", "icons");

// ⚠️ `ROOT_CONFIG_DEPLOY_PATH` et `APP_SHELL_DEPLOY_PATH` sont importés de
// `lib/boot-assets.cjs` en tête de fichier. Ils y vivent parce qu'ils ont désormais QUATRE
// consommateurs et non trois : l'étape 6c les écrit, l'étape 9 les exige, la dérivation
// critique au boot les liste, et `check-app-payload.cjs` pèse ce qu'ils désignent. La clé du
// shell reste un contrat entre ce fichier et `sw-core.js` — elle ne s'ajuste pas d'un seul côté.

const SKIP_BUILD = process.argv.includes("--skip-build");

// 🗑️ `CONNECTOR_LOCAL_STUB` a vécu ici du 30/07 au 09/08/2026 — un module vide émis dans toute
// variante pour que `init.js`, qui importait `./connector.local.js` INCONDITIONNELLEMENT, ne
// fasse pas journaliser un 404 au navigateur. Il est retiré avec la cause : le chargement passe
// désormais par une balise d'`index.html` que `stripDevConnectorScript` ôte des variantes
// livrables. Plus d'import obligatoire, donc plus de fichier à combler.
// ⚠️ Ne pas le rétablir « par sécurité » : un talon dans un livrable rendrait de nouveau
// indiscernables « aucun bootstrap » et « un bootstrap qu'on n'a pas su lire », et c'est cette
// indistinction qui a laissé un jeton partir dans `deploy-core` et `deploy-full`.

/**
 * Resolve the plugin-variant mode from an argument list. PURE — reads no `process.argv`,
 * writes nothing, and never exits.
 *
 * Exported, and argv-taking, so the CI-parity gate can hold one of its exemptions to a
 * WITNESS instead of to a comment. `ci.yml` runs `node scripts/build-deploy.cjs` bare while
 * `ci:local` runs `--plugins=all`; the exemption that pairs those two steps is only honest
 * for as long as the two argv really resolve to the same build. `resolvePluginMode([]) ===
 * resolvePluginMode(["--plugins=all"])` is that check, and it runs on every `ci:local`.
 *
 * ⚠️ Throws instead of calling `process.exit`, unlike the CLI wrapper below. A module that a
 * gate imports must not be able to kill the gate's process on a value the gate was
 * deliberately probing — the caller decides what an invalid mode costs.
 *
 * ⚠️ `"local"` n'est PAS un mode de plus dans la même famille : c'est le seul qui produise une
 * variante **non livrable**, et le seul qui recopie le bootstrap dev porteur du jeton. Il ne
 * doit jamais être atteint depuis `BUILD_ALL_VARIANTS` — d'où sa place ici, dans un mode
 * explicite qu'il faut taper, et nulle part dans un script de CI.
 *
 * @param {string[]} argv Argument list. Tolerates a full `process.argv` (the node and script
 *   entries simply match nothing) as well as a bare list of flags.
 * @returns {"none"|"full"|"all"|"local"|null} The mode, or `null` when no `--plugins` was
 *   given — which builds every variant, exactly like `"all"` (see `BUILD_ALL_VARIANTS`).
 * @throws {Error} If `--plugins` names a retired or otherwise invalid mode.
 * @example
 * resolvePluginMode([]); // → null  (all variants)
 * resolvePluginMode(["--plugins=full"]); // → "full"
 */
function resolvePluginMode(argv) {
    if (argv.includes("--full")) return "all";
    const arg = argv.find((item) => item.startsWith("--plugins="));
    if (!arg) return null; // no arg → build all variants
    const value = arg.split("=")[1]?.trim().toLowerCase();
    if (["none", "full", "all", "local"].includes(value)) return value;
    // ARCHI S8 — name the retired modes explicitly instead of a bare "invalid": those
    // that disappeared were in npm scripts, docs and shell history, and a plain rejection
    // would read as a typo rather than as a deliberate consolidation.
    const RETIRED = {
        storage:
            "dropped — storage now ships in BOTH gated variants, so it was redundant on its own",
        "addpoi-storage": "supprimé — la variante addpoi est partie avec le plugin fusionné (5.5)",
        addpoi: "supprimé — le plugin a fusionné dans editor ; utiliser `full` (5.5)",
    };
    if (RETIRED[value]) {
        throw new Error(
            `--plugins=${value} no longer exists (ARCHI S8): ${RETIRED[value]}. ` +
                `Use none|full|all.`
        );
    }
    throw new Error(`Invalid --plugins value: ${value}. Use none|full|all.`);
}

/** CLI wrapper: same resolution, but an invalid mode ends the process as it always did. */
function getPluginMode() {
    try {
        return resolvePluginMode(process.argv);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}

const PLUGIN_MODE = getPluginMode();

/**
 * True when `mode` builds EVERY variant — the no-flag case and the explicit `"all"` alike.
 *
 * Exported, and used to derive `BUILD_ALL_VARIANTS` just below, so there is exactly ONE
 * definition of the rule. The CI-parity gate holds its `build:deploy` ↔ `build:deploy:all`
 * exemption to this predicate; a copy of the formula living in the gate would keep saying
 * "equivalent" after this line changed, which is the whole class of defect that gate exists
 * to close.
 *
 * ⚠️ The two modes are NOT `===` — bare gives `null`, `--plugins=all` gives `"all"`. The
 * equivalence is on what gets BUILT, not on the token, and comparing the tokens is the
 * mistake this function exists to prevent.
 *
 * ⚠️ `"local"` en est exclu, et ce n'est pas un oubli : la variante de poste ne doit jamais
 * sortir d'un build qu'on n'a pas demandé nommément. `buildsAllVariants("local") === false`.
 *
 * @param {"none"|"full"|"all"|"local"|null} mode A value from {@link resolvePluginMode}.
 * @returns {boolean} Whether every variant is built.
 */
function buildsAllVariants(mode) {
    return mode === null || mode === "all";
}

const BUILD_ALL_VARIANTS = buildsAllVariants(PLUGIN_MODE);
// `local` porte le MÊME jeu de plugins que `full` — c'est le déployé de travail, il doit
// pouvoir éprouver le cycle complet contre le backend distant. Seul le bootstrap dev l'en
// distingue, et c'est `INCLUDE_DEV_CONNECTOR` ci-dessous qui porte cette différence, seul.
const GATED_MODE = PLUGIN_MODE === "full" || PLUGIN_MODE === "local";
// Storage ships in the only gated variant — that is precisely why the standalone `storage`
// variant was dropped at S8.
const INCLUDE_STORAGE = GATED_MODE;
const INCLUDE_COG = GATED_MODE;
const INCLUDE_EDITOR = GATED_MODE;
/**
 * ⚠️ LE SEUL DRAPEAU QUI DÉCIDE SI UN SECRET ENTRE DANS UN ARTEFACT. Vrai pour `local` et pour
 * rien d'autre. `deploy-core`, `deploy-full` et — par recopie — `deploy-coverage` reçoivent
 * toujours le talon inerte, que le fichier réel existe ou non sur le poste qui construit.
 */
const INCLUDE_DEV_CONNECTOR = PLUGIN_MODE === "local";
/**
 * Origine de backend à écrire dans les profils d'une variante LIVRABLE. Vide par défaut, et c'est
 * le point : sans valeur explicite, les liaisons vers le backend de PREUVE sont retirées de ce
 * qui part chez un client (voir `lib/dev-backend.cjs`).
 *
 * ⚠️ **Ne jamais faire dépendre ce défaut d'un fichier présent sur la machine qui construit.** La
 * tentation est de renseigner l'origine « si le bootstrap dev existe » — ce serait un livrable
 * dont le CONTENU varie selon qui lance le build, c'est-à-dire très exactement le défaut que
 * `connector.local.js` a coûté en juillet (vert chez celui qui l'avait, rouge en CI, 8 specs).
 *
 * Usage — éprouver le cycle hors-ligne complet sur `deploy-full` :
 *   GEOLEAF_BACKEND_BASE_URL=https://qgis.geoleaf.dev npm run build:deploy
 */
const BACKEND_BASE_URL = process.env.GEOLEAF_BACKEND_BASE_URL?.trim() || null;
// Single-variant builds normally deploy to the deploy/ root (name ""). The gated variants
// get their own named folder so they can sit alongside deploy-core for testing.
const SINGLE_VARIANT_NAME =
    PLUGIN_MODE === "full" ? "deploy-full" : PLUGIN_MODE === "local" ? "deploy-local" : "";
// Connector is always included in every variant — no flag needed.
// ⚠️ ARCHI S8 — a module-level aggregate flag sat here, declared and NEVER READ. Removed
// rather than renamed: the per-variant decisions are all taken from the `v.include*` flags
// on the variant object below, never from an aggregate. Do not reintroduce one.

// ── Colors ──────────────────────────────────────────────
const C = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
};
const log = {
    ok: (m) => console.log(`${C.green}✓${C.reset}  ${m}`),
    err: (m) => console.error(`${C.red}✗${C.reset}  ${m}`),
    info: (m) => console.log(`${C.cyan}ℹ${C.reset}  ${m}`),
    warn: (m) => console.log(`${C.yellow}⚠${C.reset}  ${m}`),
    section: (m) => console.log(`\n${C.cyan}── ${m} ──${C.reset}\n`),
};

// ── Helpers ─────────────────────────────────────────────
function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

/**
 * Empreinte de contenu courte d'un fichier — le remplaçant de `Date.now()` (S5.8).
 *
 * 🛑 **Un horodatage de build n'identifie pas un contenu, il identifie un BUILD.** Le
 * cache-busting portait `?v=<Date.now()>` : à chaque déploiement, l'entrée ESM et les bundles
 * de plugins changeaient d'URL — donc étaient re-téléchargés en entier — alors qu'ils étaient
 * octet pour octet identiques. Mesuré avant correctif : ~101 Ko gz (`deploy-full`) / ~71 Ko
 * (`deploy-core`) redemandés pour rien à chaque mise en ligne.
 *
 * Une empreinte de contenu inverse la propriété : l'URL ne change QUE si le fichier change.
 * C'est aussi ce qui rend le build déterministe — deux builds de la même source produisent
 * exactement le même déployé, ce que `check-build-determinism.cjs --deploy` vérifie.
 *
 * ⚠️ Tronqué à 8 hexadécimaux, comme `gen-api-surface.cjs` : c'est un cache-buster, pas une
 * garantie d'intégrité. Une collision changerait le contenu sans changer l'URL, ce qui est le
 * risque qu'un `?v=` accepte par nature — 32 bits suffisent devant une poignée d'assets.
 *
 * @param {string} absPath Chemin absolu du fichier à empreindre.
 * @returns {string} 8 caractères hexadécimaux.
 */
function contentTag(absPath) {
    return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex").slice(0, 8);
}

/**
 * Recursive directory copy, with an optional per-file filter.
 *
 * @param {string} src
 * @param {string} dest
 * @param {(name: string) => boolean} [keepFile] receives the BASENAME of each regular file;
 *   return `false` to skip it. Directories are always descended into. Omitted ⇒ copy all.
 *
 * ⚠️ S6.6 — le filtre existe parce que ce `copyDir` était le plus gros porteur de sourcemaps
 * du déployé, et le plus discret : `dist/chunks/` était copié EN BLOC, donc ses 5 `.map`
 * entraient sans qu'aucune ligne du script ne les nomme. Le pré-vol du sprint avait compté
 * 4 sourcemaps par variante en listant `dist/*.map` — non récursif —, et il y en avait 9.
 * C'est le corollaire « le pré-vol peut porter la cécité qu'il mesure », commis deux fois de
 * suite sur le même défaut : le relevé qui a ouvert B-136 était lui aussi un `ls` trop court.
 */
function copyDir(src, dest, keepFile) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(s, d, keepFile);
        else if (!keepFile || keepFile(entry.name)) fs.copyFileSync(s, d);
    }
}

/**
 * S6.6 — le déployé n'expédie AUCUNE sourcemap. Arbitré le 08/08/2026 avec Mattieu.
 *
 * Mesuré avant correctif : **9 fichiers `.map` par variante, 1 309 Ko** (3 435 Ko sur la
 * variante instrumentée), soit ≈ 5,9 Mo sur les trois — dont `geoleaf.esm.js.map` (313 Ko) et
 * `geoleaf-main.min.css.map` (294 Ko), qui exposent l'INTÉGRALITÉ des sources du core.
 *
 * Le motif décisif n'est pas le poids : c'est que la règle était **déjà écrite dans ce
 * fichier** et n'était pas appliquée au code maison. La copie de MapLibre refuse délibérément
 * sa sourcemap depuis le S5 en invoquant « les sourcemaps exposées en production », et renvoie
 * nommément à S6.6 pour trancher le reste. Le dépôt n'est par ailleurs pas encore public, et
 * son historique porte un secret réel (B-101).
 *
 * ⚠️ Ce prédicat est la SEULE définition de « c'est une sourcemap » du script. Les sites de
 * copie s'y réfèrent tous, pour qu'un futur artefact `.map` ne dépende pas d'avoir pensé à le
 * lister quelque part.
 */
const isSourceMap = (name) => name.endsWith(".map");

function sizeKB(p) {
    return (fs.statSync(p).size / 1024).toFixed(1) + " KB";
}

function countFiles(dir) {
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
        else n++;
    }
    return n;
}

// ── Allègement des données de profil (roadmap socle-init, S4.1) ──────────
//
// Les GeoJSON du premier écran pèsent 904 Ko gz sur ~1 174 : 77 % de ce que la page charge.
// Ces deux nombres sont les SEULS réglages, et ils sont mesurés, pas choisis :
//
//   • 5 décimales ≈ **1,1 m au sol** — trois ordres de grandeur sous le pixel à tout zoom
//     livré, donc strictement invisible. La donnée source porte jusqu'à 15 décimales, soit
//     l'échelle du nanomètre : c'est ce gaspillage-là qui pèse, et il rend **26,9 %** à lui
//     seul, sans retirer un seul sommet.
//   • **Aucune simplification de géométrie** — `GEOJSON_TOLERANCE_DEG` vaut 0, et ce zéro est
//     une DÉCISION mesurée, pas un réglage oublié. Voir juste en dessous.
//
// 🛑 **DOUGLAS-PEUCKER A ÉTÉ IMPLÉMENTÉ, MESURÉ, PUIS DÉSARMÉ.** Le code vit toujours dans
// `lib/geojson-slim.cjs` et se rallume en montant cette constante ; ce qui suit est le relevé
// qui a fait renoncer, pour qu'on ne refasse pas le chemin de mémoire :
//
//   ‣ À 11 m de tolérance, DP ne rend que **24,8 Ko gz sur les 240,8 économisés — 10 %**.
//     Les 216 autres viennent de l'arrondi seul.
//   ‣ Et RDP **sature sa tolérance** : sur les 646 chemins effectivement simplifiés, écart
//     médian **7,2 m**, p99 **11,09 m**, maximal **11,1 m** contre un majorant de 11,1. Le
//     seuil n'est pas un pire cas rare, c'est le régime courant.
//   ‣ 11 m valent ~0,3 px au zoom 12 mais **~21 px au zoom 18**, atteignable puisque les fonds
//     de carte montent à 17-20. Sur une limite d'aire protégée comparée à de l'imagerie, ça se
//     voit.
//
//   ⇒ DP portait **10 % du gain et 100 % du risque**. Retiré.
//
// ⚠️ **Si on le rallume un jour, ne pas monter la tolérance sans changer d'outil** : la
// simplification est par géométrie, sans topologie partagée, donc deux polygones mitoyens
// peuvent voir leur frontière commune diverger et ouvrir une fente. Il faudrait un
// simplificateur TOPOLOGIQUE (`mapshaper -simplify`), pas un nombre plus grand ici.
//
// 🛑 Enfin, le « −60 à −80 % » qu'annonçait la roadmap n'était atteignable à AUCUNE tolérance
// raisonnable : mesuré sur ces fichiers, −52,5 % seulement à 56 m. C'était l'attente usuelle
// de l'algorithme sur des données brutes, pas une mesure sur celles-ci.
const GEOJSON_DECIMALS = 5;
const GEOJSON_TOLERANCE_DEG = 0;

/**
 * Allège en place les `.geojson` d'un profil DÉJÀ COPIÉ dans la variante.
 *
 * ⚠️ Opère sur la COPIE, jamais sur `profiles/` — la source reste la donnée de référence,
 * à pleine précision, et une tolérance qu'on regretterait se corrige en rebâtissant.
 *
 * Aucune liste de couches : tous les `.geojson` du profil y passent. Une table nommant les
 * trois couches lourdes aurait divergé au premier ajout de couche, et se serait tue en le
 * faisant — le mode d'échec que ce dépôt mesure partout ailleurs.
 *
 * @param {string} profileDest Répertoire du profil dans `outDir`.
 * @param {string} profileId
 * @returns {void}
 */
function slimProfileData(profileDest, profileId) {
    const files = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".geojson")) files.push(p);
        }
    };
    if (!fs.existsSync(profileDest)) return;
    walk(profileDest);
    if (files.length === 0) return; // profil sans donnée locale — légitime (origines distantes)

    let before = 0;
    let after = 0;
    let vBefore = 0;
    let vAfter = 0;
    for (const file of files) {
        const src = fs.readFileSync(file);
        try {
            const r = slimGeoJSON(src, {
                decimals: GEOJSON_DECIMALS,
                toleranceDeg: GEOJSON_TOLERANCE_DEG,
            });
            fs.writeFileSync(file, r.json, "utf-8");
            before += src.length;
            after += Buffer.byteLength(r.json);
            vBefore += r.verticesBefore;
            vAfter += r.verticesAfter;
        } catch (err) {
            // Un fichier de données illisible doit ARRÊTER le build. Le copier tel quel
            // produirait un déployé dont une couche est silencieusement vide — et c'est
            // précisément ce genre de silence que le sprint traque.
            log.err(
                `profiles/${profileId}/ — ${path.relative(profileDest, file)} is not valid ` +
                    `GeoJSON: ${err instanceof Error ? err.message : String(err)}`
            );
            process.exit(1);
        }
    }
    // Le décompte est dérivé de ce qui a été traité, jamais écrit à la main (doctrine B-43).
    const pct = before > 0 ? ((1 - after / before) * 100).toFixed(1) : "0.0";
    log.ok(
        `profiles/${profileId}/ — ${files.length} geojson allégés : ` +
            `${(before / 1024 / 1024).toFixed(2)} → ${(after / 1024 / 1024).toFixed(2)} Mio bruts ` +
            `(-${pct} %), ${vBefore.toLocaleString("fr-FR")} → ${vAfter.toLocaleString("fr-FR")} sommets`
    );
}

// ── Pré-compression des artefacts déployés (socle-init S4.2) ─────────────
//
// Mesuré au pré-vol : `find deploy -name "*.gz" -o -name "*.br"` rendait VIDE. La compression
// dépendait donc entièrement du serveur, à la volée, à chaque requête — et sans elle ce sont
// les octets bruts qui partent.
//
// 🛑 **ET UN ARTEFACT QUE PERSONNE NE SERT NE SERT À RIEN.** `docker/nginx.dev.conf` ne portait
// ni `gzip_static` ni `brotli_static` : produire les fichiers sans câbler le serveur aurait
// fait sortir cette tâche VERTE en n'ayant rien changé pour l'utilisateur — exactement le
// profil « garde jamais vue rougir » que ce dépôt traque. Le `gzip_static on;` est posé dans
// le même lot, et la vérification est une requête réelle :
//
//     curl -H 'Accept-Encoding: gzip' -sI https://demo.full.geoleaf.local.test/dist/geoleaf.esm.js
//     → Content-Encoding: gzip, et un Content-Length égal à celui du .gz sur disque
//
// ⚠️ **Le `.br` est produit mais N'EST PAS SERVI EN LOCAL.** `nginx:alpine` n'embarque pas
// `ngx_brotli` (module tiers, à compiler). Il est émis pour le serveur de production, et ce
// fait est écrit ici plutôt que tu : croire éprouvé ce qui ne l'est pas est le mode d'échec
// n° 5. Brotli rend typiquement 15-20 % de plus que gzip sur du texte.
//
// Seuil : en dessous, l'en-tête et le coût de décompression dépassent le gain, et un `.gz`
// plus gros que son original est un piège que `gzip_static` servirait quand même.
const PRECOMPRESS_MIN_BYTES = 1024;
// ⚠️ `.mjs` est aussi listé que `.js`, et son absence aurait été INVISIBLE. Depuis MapLibre 6,
// les ~273 Ko gz du moteur vendoré sont dans des `.mjs` : sans cette entrée ils partaient
// NON COMPRESSÉS, soit ~1,06 Mo brut sur le fil. Et rien ne l'aurait dit — `check-app-payload`
// gzippe en mémoire (`gzipSize()`), il ne lit jamais les `.gz` du disque, donc il aurait
// continué d'annoncer ~289 Ko gz pendant que nginx en servait 1 060.
const PRECOMPRESS_EXT = new Set([
    ".js",
    ".mjs",
    ".css",
    ".html",
    ".json",
    ".geojson",
    ".svg",
    ".webmanifest",
    ".txt",
]);

/**
 * Émet un `.gz` et un `.br` à côté de chaque artefact compressible d'une variante.
 *
 * L'allowlist d'extensions écarte **trois** classes, pour trois motifs distincts — et les
 * énumérer toutes est ce qui empêche un lecteur de bonne foi de l'élargir :
 *
 *   1. **Binaires déjà compressés** (PNG, WebP, tuiles) — les recompresser coûterait du disque
 *      pour un gain nul ou négatif.
 *   2. 🛑 **Formats servis par requêtes HTTP Range — `.fgb`.** NE PAS AJOUTER. `gzip_static on;`
 *      est déclaré au niveau `http` de `docker/nginx.dev.conf`, donc il s'appliquerait à tous
 *      les vhosts : un `.fgb.gz` posé à côté serait servi avec `Content-Encoding: gzip`, et les
 *      Range du mode bbox de FlatGeobuf porteraient sur les octets COMPRESSÉS
 *      (`fgb-bbox-filter.ts`, « it handles Range requests internally »). Le risque est
 *      aujourd'hui LATENT — aucun profil livré ne pose `data.bbox`, donc `fgb-loader.ts` fait
 *      un `fetch()` plein fichier que le navigateur décompresse de façon transparente — et
 *      l'ajouter l'armerait pour le premier profil qui activera le bbox.
 *   3. **Artefacts que le navigateur ne demande jamais** — `.qml`, styles QGIS qui voyagent
 *      dans la copie en bloc des profils. Les compresser n'achète pas un octet de payload.
 *
 * ⚠️ **Ne pas inverser en denylist.** Une denylist rendrait `.fgb` compressible par défaut,
 * c'est-à-dire exactement le défaut que le motif 2 interdit. Ce commentaire n'a nommé que le
 * motif 1 jusqu'au 08/08/2026 : une allowlist muette sur deux de ses trois raisons se fait
 * élargir par le premier lecteur qui la croit incomplète.
 *
 * Un `.gz` plus gros que son original est jeté — `gzip_static` ne compare pas les tailles, il
 * sert le `.gz` s'il existe.
 *
 * @param {string} outDir Répertoire de la variante.
 * @param {string} variantName Pour le journal.
 * @returns {void}
 */
function precompress(outDir, variantName) {
    const zlib = require("node:zlib");
    let files = 0;
    let raw = 0;
    let gz = 0;
    let br = 0;
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                walk(p);
                continue;
            }
            if (!PRECOMPRESS_EXT.has(path.extname(e.name))) continue;
            const buf = fs.readFileSync(p);
            if (buf.length < PRECOMPRESS_MIN_BYTES) continue;
            const g = zlib.gzipSync(buf, { level: 9 });
            const b = zlib.brotliCompressSync(buf, {
                params: {
                    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
                    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
                },
            });
            files++;
            raw += buf.length;
            if (g.length < buf.length) {
                fs.writeFileSync(`${p}.gz`, g);
                gz += g.length;
            } else {
                gz += buf.length;
            }
            if (b.length < buf.length) {
                fs.writeFileSync(`${p}.br`, b);
                br += b.length;
            } else {
                br += buf.length;
            }
        }
    };
    if (!fs.existsSync(outDir)) return;
    walk(outDir);
    if (files === 0) {
        // Anti-gate-vide : une variante bâtie sans un seul fichier compressible signale une
        // allowlist devenue aveugle, pas un déployé légitime.
        log.err(`${variantName} — precompress found 0 compressible file. The allowlist is blind.`);
        process.exit(1);
    }
    const pct = (n) => ((1 - n / raw) * 100).toFixed(1);
    log.ok(
        `${variantName} — ${files} fichiers pré-compressés : ` +
            `${(raw / 1024 / 1024).toFixed(1)} Mio bruts → ${(gz / 1024 / 1024).toFixed(1)} gz (-${pct(gz)} %) ` +
            `/ ${(br / 1024 / 1024).toFixed(1)} br (-${pct(br)} %, non servi en local)`
    );
}

// ── Dérivation critique au boot (roadmap socle-init, S3 puis S4) ─────────
//
// ⚠️ Les trois extracteurs ont DÉMÉNAGÉ dans `lib/boot-assets.cjs` — `extractEagerChunks`,
// `extractHtmlAssetRefs` et `deriveBootCriticalAssets`. Ils sont importés en tête de ce
// fichier. Le motif du déménagement est le Sprint 4 : sa gate de poids a besoin EXACTEMENT du
// même ensemble, pour le peser au lieu de l'injecter. Recopier les extracteurs aurait produit
// deux dérivations dont la moins maintenue serait sortie verte en mesurant autre chose.
//
// `buildPreloadTags` reste ici : il rend du MARKUP, ce qui est le métier de ce script et
// d'aucun autre.

/**
 * Renders the `<head>` preload block: one `modulepreload` per eagerly-imported chunk, plus
 * a `preload` of the root config.
 *
 * The chunks are imported by the entry bundle, so the browser cannot discover them until it
 * has downloaded AND parsed it — a full round-trip lost on ~112 KB gz at the time of
 * writing. Only the STATIC imports are listed: preloading a lazy chunk would fetch upfront
 * exactly what its `import()` exists to defer.
 *
 * ⚠️ `crossorigin` on the config link is not decoration. `kernel/config/loader.ts` reaches it
 * with a bare `fetch()`, whose defaults are mode `cors` + credentials `same-origin`; the
 * attribute is what makes the preload's CORS mode match. A mismatched preload is downloaded
 * and then NOT reused — strictly worse than no preload at all.
 *
 * @param {string[]} eagerChunks Deploy-relative chunk paths.
 * @param {string} indent Leading whitespace of the marker line, so the block keeps the
 *   document's indentation.
 * @returns {string}
 */
function buildPreloadTags(eagerChunks, indent) {
    return [
        ...eagerChunks.map((c) => `${indent}<link rel="modulepreload" href="${c}" />`),
        `${indent}<link rel="preload" as="fetch" type="application/json" crossorigin="anonymous" href="${ROOT_CONFIG_DEPLOY_PATH}" />`,
    ].join("\n");
}

/**
 * Patches spriteUrl in a deployed taxonomy.json:
 * replaces `"../profiles/` with `"profiles/` so the path is relative to the
 * deploy variant root (HTTP serving root) instead of the source profiles/ parent.
 */
function patchTaxonomySpriteUrl(taxonomyPath) {
    if (!fs.existsSync(taxonomyPath)) return;
    const raw = fs.readFileSync(taxonomyPath, "utf-8");
    const patched = raw.replace(/"spriteUrl"\s*:\s*"\.\.\/profiles\//g, '"spriteUrl": "profiles/');
    if (patched !== raw) {
        fs.writeFileSync(taxonomyPath, patched, "utf-8");
        log.ok(`${path.relative(process.cwd(), taxonomyPath)} (spriteUrl patched for deploy)`);
    }
}

function totalSizeBytes(dir) {
    let bytes = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) bytes += totalSizeBytes(p);
        else bytes += fs.statSync(p).size;
    }
    return bytes;
}

/**
 * Strips the config files of GATED plugins (config/plugins/<id>.json, profile
 * layout v2) from a deployed profile when the variant does not ship the
 * plugin, and prunes the matching Files.modules entries in the deployed
 * profile.json so the runtime cascade never fetches a missing file.
 * Module ids absent from moduleFlags (always-bundled plugins) are always kept.
 */
function filterProfilePluginConfigs(profileDest, profileId, moduleFlags) {
    const profilePath = path.join(profileDest, "profile.json");
    if (!fs.existsSync(profilePath)) return;
    let profile;
    try {
        profile = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
    } catch {
        return;
    }
    const modulesMap = profile.Files && profile.Files.modules;
    if (!modulesMap || typeof modulesMap !== "object") return;
    let pruned = false;
    for (const [moduleId, filePath] of Object.entries(modulesMap)) {
        if (!(moduleId in moduleFlags) || moduleFlags[moduleId]) continue;
        delete modulesMap[moduleId];
        pruned = true;
        if (typeof filePath === "string") {
            // M6: confine the deletion to profileDest. A malicious filePath in an
            // untrusted profile.json (e.g. "../../../etc/passwd") must never let
            // unlinkSync escape the deployed profile directory (path traversal).
            const root = path.resolve(profileDest);
            const abs = path.resolve(profileDest, filePath);
            if (abs !== root && !abs.startsWith(root + path.sep)) {
                log.warn(
                    `profiles/${profileId}/ — plugin config "${moduleId}" path traversal blocked: ${filePath}`
                );
                continue;
            }
            if (fs.existsSync(abs)) fs.unlinkSync(abs);
        }
        log.ok(`profiles/${profileId}/ — plugin config "${moduleId}" stripped (not in variant)`);
    }
    if (pruned) {
        fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf-8");
    }
}

// ── Main ────────────────────────────────────────────────
function main() {
    const mode = BUILD_ALL_VARIANTS
        ? "all variants (deploy-core, deploy-full)"
        : `plugins=${PLUGIN_MODE}`;
    log.section(`🚀 GeoLeaf Deploy Builder — ${C.bold}${mode}${C.reset}`);

    // The variant list is computed HERE, before the clean, and not next to the copy
    // loop below: step 1 must remove only what this run is about to rebuild, and it
    // cannot know that without this list. Everything it reads is a module-level
    // constant — no value produced by steps 1 or 2 feeds into it.
    const variants = BUILD_ALL_VARIANTS
        ? [
              // 5.5 — 2 variants. The 9 always-bundled plugins are copied unconditionally
              // further down; only these 3 flags vary, and they are the entire matrix.
              {
                  name: "deploy-core",
                  includeStorage: false,
                  includeCog: false,
                  includeEditor: false,
                  includeDevConnector: false,
              },
              // Full bundle. ⚠️ **C'est la SEULE variante portant l'édition ET `offline-ui`**,
              // donc la seule où le cycle hors-ligne complet — capture de POI, file d'attente,
              // rejeu — est éprouvable. Les specs E2E qui visaient `deploy-addpoi` pour cette
              // raison exacte visent celle-ci depuis 5.5 : ce n'est pas un changement de port,
              // c'est un changement de variante porteuse.
              {
                  name: "deploy-full",
                  includeStorage: true,
                  includeCog: true,
                  includeEditor: true,
                  // 🛑 FAUX EN DUR, ET C'EST LE POINT. `deploy-full` est un LIVRABLE. Aucune
                  // condition, aucune variable d'environnement, aucun drapeau de ligne de
                  // commande ne doit pouvoir mettre un jeton ici : la seule façon d'en obtenir
                  // un est de construire `deploy-local`, qui n'est pas dans cette liste.
                  includeDevConnector: false,
              },
          ]
        : [
              {
                  name: SINGLE_VARIANT_NAME,
                  includeStorage: INCLUDE_STORAGE,
                  includeCog: INCLUDE_COG,
                  includeEditor: INCLUDE_EDITOR,
                  includeDevConnector: INCLUDE_DEV_CONNECTOR,
              },
          ];

    // 1 — Clean, scoped to the variants THIS run rebuilds.
    // It used to empty deploy/ wholesale, before the variant list even existed — so
    // `--plugins=full` deleted deploy-core/ and deploy-addpoi/ and never rebuilt them.
    // On 2026-07-23 that silently took down demo.geoleaf.local.test (the nginx vhost
    // roots at deploy/deploy-core) and the 8766/8770 Playwright servers, from a script
    // that exited 0. A build must not destroy output it does not produce.
    // ⚠️ The two names above are the STATE OF 2026-07-23, kept because the incident is the
    // reason this cleanup is scoped. `deploy-addpoi` and port 8770 both disappeared with the
    // addpoi→editor merge (Sprint 5, 2026-08-05); do not read them as current.
    // deploy/ itself is never removed: the dev server (docker-compose.dev.yml)
    // bind-mounts this folder read-only, and a full rmSync would invalidate the mount.
    const isRootDeploy = variants.some((v) => !v.name); // --plugins=none writes into deploy/ directly
    if (fs.existsSync(DEPLOY)) {
        if (isRootDeploy) {
            // Root deploy drops index.html + dist/ at the top level, so any sibling variant
            // folder would sit inside the served tree. A wholesale clean is the right
            // semantic here — and this is the only mode where it is.
            for (const entry of fs.readdirSync(DEPLOY)) {
                fs.rmSync(path.join(DEPLOY, entry), { recursive: true, force: true });
            }
            log.info("Cleaned deploy/ entirely (root deploy — this variant has no subfolder)");
        } else {
            for (const v of variants) {
                const dir = path.join(DEPLOY, v.name);
                if (fs.existsSync(dir)) {
                    fs.rmSync(dir, { recursive: true, force: true });
                    log.info(`Cleaned previous deploy/${v.name}/`);
                }
            }
            // Scoping the clean trades a loud breakage for a quiet divergence: a variant left
            // in place keeps answering its dev URL from an older build. Name it, with its date.
            const rebuilt = new Set(variants.map((v) => v.name));
            for (const entry of fs.readdirSync(DEPLOY, { withFileTypes: true })) {
                if (!entry.isDirectory() || rebuilt.has(entry.name)) continue;
                const builtAt = fs.statSync(path.join(DEPLOY, entry.name)).mtime;
                const stamp = builtAt.toISOString().slice(0, 16).replace("T", " ");
                log.warn(
                    `deploy/${entry.name}/ left untouched (built ${stamp} UTC) — its dev URL still serves that build`
                );
            }
        }
    }
    ensureDir(DEPLOY);

    // 2 — Build (unless --skip-build)
    if (!SKIP_BUILD) {
        log.section("🔨 Building core + plugins (npm run build:all)");
        const r = spawnSync("npm", ["run", "build:all"], {
            cwd: ROOT,
            stdio: "inherit",
            shell: NPM_SHELL,
        });
        if (r.status !== 0) {
            log.err("Core build failed — aborting.");
            process.exit(1);
        }
        log.ok("Core build succeeded");

        log.section("🔨 Building connector (plugin-connector)");
        const rc = spawnSync("npm", ["run", "build"], {
            cwd: registry.byName("@geoleaf-plugins/connector").absDir,
            stdio: "inherit",
            shell: NPM_SHELL,
        });
        if (rc.status !== 0) {
            log.err("Connector build failed — aborting.");
            process.exit(1);
        }
        log.ok("Connector build succeeded");

        log.section("🔨 Building storage plugin (plugin-storage)");
        const rs = spawnSync("npm", ["run", "build"], {
            cwd: registry.byName("@geoleaf-plugins/offline-ui").absDir,
            stdio: "inherit",
            shell: NPM_SHELL,
        });
        if (rs.status !== 0) {
            log.err("Storage build failed — aborting.");
            process.exit(1);
        }
        log.ok("Storage build succeeded");

        log.section("🔨 Building field-renderer (field-renderer — required by editor)");
        const rfr = spawnSync("npm", ["run", "build"], {
            cwd: registry.byName("@geoleaf/field-renderer").absDir,
            stdio: "inherit",
            shell: NPM_SHELL,
        });
        if (rfr.status !== 0) {
            log.err("field-renderer build failed — aborting.");
            process.exit(1);
        }
        log.ok("field-renderer build succeeded");
    } else {
        log.warn("Skipping build (--skip-build)");
    }

    let globalOk = true;
    for (const v of variants) {
        const outDir = v.name ? path.join(DEPLOY, v.name) : DEPLOY;
        // Nommer la variante dans les erreurs de copie de bundle (`throwMissingBundle`).
        // Même dérivation que le `variantLabel` du patch d'`index.html` plus bas — les deux
        // désignent la même variante, à deux étapes différentes du même tour de boucle.
        const variantName = v.name || PLUGIN_MODE;
        if (v.name) {
            log.section(`📁 Variant: ${v.name}`);
            ensureDir(outDir);
        }

        // 3 — Copy dist artefacts → dist/
        log.section("📦 Copying dist artefacts → dist/");
        ensureDir(path.join(outDir, "dist"));

        // S6.6 — `geoleaf.esm.js.map` (313 Ko) et `geoleaf-main.min.css.map` (294 Ko) sont
        // RETIRÉS de cette liste : ils portaient à eux deux l'intégralité des sources du core
        // dans le déployé. C'est ce bloc-ci, et non les copies de plugin, que l'énoncé de la
        // roadmap ne comptait pas — il annonçait « seuls geocoding et table ».
        const coreDistFiles = ["geoleaf.esm.js", "geoleaf-main.min.css"];
        for (const f of coreDistFiles) {
            const src = path.join(DIST, f);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(outDir, "dist", f));
                log.ok(`dist/${f}  (${sizeKB(src)})`);
            } else {
                log.warn(`dist/${f} not found — skipped`);
            }
        }

        // 3a — ESM chunks (Sprint 6: code splitting produces dist/chunks/)
        const chunksDir = path.join(DIST, "chunks");
        if (fs.existsSync(chunksDir)) {
            // S6.6 — `(n) => !isSourceMap(n)` : sans ce filtre, ce copyDir en bloc était le
            // plus GROS porteur de sourcemaps du déployé (5 des 9) et le plus discret, aucune
            // ligne du script ne les nommant.
            copyDir(chunksDir, path.join(outDir, "dist", "chunks"), (n) => !isSourceMap(n));
            const nChunks = countFiles(path.join(outDir, "dist", "chunks"));
            log.ok(`dist/chunks/ — ${nChunks} files copied (ESM code splitting)`);
        } else {
            log.warn("dist/chunks/ not found — ESM code splitting not active?");
        }

        // 3b — Connector (always included in every variant)
        {
            const connectorSrc = path.join(DIST_CONNECTOR, "geoleaf-connector.plugin.js");
            if (fs.existsSync(connectorSrc)) {
                fs.copyFileSync(
                    connectorSrc,
                    path.join(outDir, "dist", "geoleaf-connector.plugin.js")
                );
                log.ok(`dist/geoleaf-connector.plugin.js  (${sizeKB(connectorSrc)})`);
            } else {
                throwMissingBundle("geoleaf-connector.plugin.js", variantName);
            }
        }

        // 3b-ws — WebSocket plugin (always included in every variant)
        {
            const wsSrc = path.join(DIST_WEBSOCKET, "geoleaf-websocket.plugin.js");
            if (fs.existsSync(wsSrc)) {
                fs.copyFileSync(wsSrc, path.join(outDir, "dist", "geoleaf-websocket.plugin.js"));
                log.ok(`dist/geoleaf-websocket.plugin.js  (${sizeKB(wsSrc)})`);
            } else {
                throwMissingBundle("geoleaf-websocket.plugin.js", variantName);
            }
        }

        // 3b-rt — Realtime-layer plugin (always included in every variant)
        {
            const rtSrc = path.join(DIST_REALTIME, "geoleaf-realtime-layer.plugin.js");
            if (fs.existsSync(rtSrc)) {
                fs.copyFileSync(
                    rtSrc,
                    path.join(outDir, "dist", "geoleaf-realtime-layer.plugin.js")
                );
                log.ok(`dist/geoleaf-realtime-layer.plugin.js  (${sizeKB(rtSrc)})`);
                // Lazy chunk emitted by code-splitting (gtfs-realtime-bindings/protobufjs/
                // long, loaded on first GTFS-RT decode) must ship alongside the entry,
                // otherwise the dynamic import 404s the first time a GTFS-RT layer runs.
                for (const f of fs.readdirSync(DIST_REALTIME)) {
                    if (
                        /^geoleaf-realtime-layer\..+\.js$/.test(f) &&
                        f !== "geoleaf-realtime-layer.plugin.js"
                    ) {
                        fs.copyFileSync(path.join(DIST_REALTIME, f), path.join(outDir, "dist", f));
                        log.ok(`dist/${f}  (${sizeKB(path.join(DIST_REALTIME, f))})  [lazy chunk]`);
                    }
                }
            } else {
                throwMissingBundle("geoleaf-realtime-layer.plugin.js", variantName);
            }
        }

        // 3b-fi — File-import plugin (always included in every variant)
        {
            const fiSrc = path.join(DIST_FILEIMPORT, "geoleaf-file-import.plugin.js");
            if (fs.existsSync(fiSrc)) {
                fs.copyFileSync(fiSrc, path.join(outDir, "dist", "geoleaf-file-import.plugin.js"));
                log.ok(`dist/geoleaf-file-import.plugin.js  (${sizeKB(fiSrc)})`);
            } else {
                throwMissingBundle("geoleaf-file-import.plugin.js", variantName);
            }
        }

        // 3b-fgb — FlatGeobuf plugin (always included in every variant)
        {
            const fgbSrc = path.join(DIST_FLATGEOBUF, "geoleaf-flatgeobuf.plugin.js");
            if (fs.existsSync(fgbSrc)) {
                fs.copyFileSync(fgbSrc, path.join(outDir, "dist", "geoleaf-flatgeobuf.plugin.js"));
                log.ok(`dist/geoleaf-flatgeobuf.plugin.js  (${sizeKB(fgbSrc)})`);
            } else {
                throwMissingBundle("geoleaf-flatgeobuf.plugin.js", variantName);
            }
        }

        // 3b-geo — Geocoding plugin (always included in every variant)
        {
            const geoSrc = path.join(DIST_GEOCODING, "geoleaf-geocoding.plugin.js");
            if (fs.existsSync(geoSrc)) {
                fs.copyFileSync(geoSrc, path.join(outDir, "dist", "geoleaf-geocoding.plugin.js"));
                log.ok(`dist/geoleaf-geocoding.plugin.js  (${sizeKB(geoSrc)})`);
                // S6.6 — la copie de `geoleaf-geocoding.plugin.js.map` est RETIRÉE.
            } else {
                throwMissingBundle("geoleaf-geocoding.plugin.js", variantName);
            }
        }

        // 3b-table — Table plugin (always included in every variant)
        // Single-file bundle (rollup inlineDynamicImports: true folds the Excel
        // lazy chunk in), so there is just the entry to copy. S6.6 — la copie de sa
        // sourcemap est RETIRÉE ; ce bloc et celui de geocoding étaient les deux SEULS que
        // l'énoncé de la roadmap comptait, sur neuf.
        {
            const tableSrc = path.join(DIST_TABLE, "geoleaf-table.plugin.js");
            if (fs.existsSync(tableSrc)) {
                fs.copyFileSync(tableSrc, path.join(outDir, "dist", "geoleaf-table.plugin.js"));
                log.ok(`dist/geoleaf-table.plugin.js  (${sizeKB(tableSrc)})`);
            } else {
                throwMissingBundle("geoleaf-table.plugin.js", variantName);
            }
        }

        // 3b-tax / 3b-fi — taxonomy + feature-info reclassified into @geoleaf/core (SR0):
        // they now ship inside dist/geoleaf.esm.js (in-core capabilities), no separate copy.

        // 3b-print — Print plugin (always included in every variant)
        {
            const printSrc = path.join(DIST_PRINT, "geoleaf-print.plugin.js");
            if (fs.existsSync(printSrc)) {
                fs.copyFileSync(printSrc, path.join(outDir, "dist", "geoleaf-print.plugin.js"));
                log.ok(`dist/geoleaf-print.plugin.js  (${sizeKB(printSrc)})`);
                // Lazy chunks emitted by code-splitting (jsPDF + its optional html2canvas/
                // dompurify deps, loaded on first PDF export) must ship alongside the entry,
                // otherwise the dynamic import 404s the first time a PDF is exported.
                for (const f of fs.readdirSync(DIST_PRINT)) {
                    if (/^geoleaf-print\..+\.js$/.test(f) && f !== "geoleaf-print.plugin.js") {
                        fs.copyFileSync(path.join(DIST_PRINT, f), path.join(outDir, "dist", f));
                        log.ok(`dist/${f}  (${sizeKB(path.join(DIST_PRINT, f))})  [lazy chunk]`);
                    }
                }
            } else {
                throwMissingBundle("geoleaf-print.plugin.js", variantName);
            }
        }

        // 3b-measure — Measure plugin (always included in every variant)
        {
            const measureSrc = path.join(DIST_MEASURE, "geoleaf-measure.plugin.js");
            if (fs.existsSync(measureSrc)) {
                fs.copyFileSync(measureSrc, path.join(outDir, "dist", "geoleaf-measure.plugin.js"));
                log.ok(`dist/geoleaf-measure.plugin.js  (${sizeKB(measureSrc)})`);
            } else {
                throwMissingBundle("geoleaf-measure.plugin.js", variantName);
            }
        }

        // 3c — Plugin bundles (selective mode)
        {
            if (v.includeStorage) {
                const src = path.join(DIST_STORAGE, "geoleaf-offline-ui.plugin.js");
                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, path.join(outDir, "dist", "geoleaf-offline-ui.plugin.js"));
                    log.ok(`dist/geoleaf-offline-ui.plugin.js  (${sizeKB(src)})`);
                } else {
                    throwMissingBundle("geoleaf-offline-ui.plugin.js", variantName);
                }
            }
            if (v.includeCog) {
                const src = path.join(DIST_COG, "geoleaf-cog.plugin.js");
                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, path.join(outDir, "dist", "geoleaf-cog.plugin.js"));
                    log.ok(`dist/geoleaf-cog.plugin.js  (${sizeKB(src)})`);
                } else {
                    throwMissingBundle("geoleaf-cog.plugin.js", variantName);
                }
            }
            if (v.includeEditor) {
                const src = path.join(DIST_EDITOR, "geoleaf-editor.plugin.js");
                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, path.join(outDir, "dist", "geoleaf-editor.plugin.js"));
                    log.ok(`dist/geoleaf-editor.plugin.js  (${sizeKB(src)})`);
                    // Lazy chunks emitted by code-splitting (e.g. the terra-draw drawing
                    // engine, loaded on first tool activation) must ship alongside the entry,
                    // otherwise the dynamic import 404s the first time a tool is selected.
                    for (const f of fs.readdirSync(DIST_EDITOR)) {
                        if (
                            /^geoleaf-editor\..+\.js$/.test(f) &&
                            f !== "geoleaf-editor.plugin.js"
                        ) {
                            fs.copyFileSync(
                                path.join(DIST_EDITOR, f),
                                path.join(outDir, "dist", f)
                            );
                            log.ok(
                                `dist/${f}  (${sizeKB(path.join(DIST_EDITOR, f))})  [lazy chunk]`
                            );
                        }
                    }
                } else {
                    throwMissingBundle("geoleaf-editor.plugin.js", variantName);
                }
            }
        }

        // 3d — Service Worker (unified, S14 Phase A): a single sw-core.js for every
        // variant. The former per-plugin sw.js was merged into sw-core.js (IndexedDB tiles +
        // background sync, read-only/non-provisioning) — no more per-plugin SW.
        {
            const swCoreSrc = path.join(DIST, "sw-core.js");
            if (fs.existsSync(swCoreSrc)) {
                fs.copyFileSync(swCoreSrc, path.join(outDir, "sw-core.js"));
                // ⚠️ `CACHE_VERSION` N'EST PLUS PATCHÉ ICI (S5.8). Il l'était avec un
                // `Date.now()`, à un moment où ni `index.html` ni la liste pré-cachée
                // n'existaient encore — une version de cache qui ne pouvait donc rien dire du
                // contenu qu'elle versionne. Il est désormais dérivé à l'étape 8b, où les assets
                // sont connus. Voir le bloc `CACHE_VERSION dérivé` plus bas.
                log.ok(`sw-core.js at deploy root  (${sizeKB(swCoreSrc)})`);
            } else {
                log.warn("dist/sw-core.js not found — core SW not built?");
            }
        }

        // 3e — GeoJSON Web Worker (both modes — Sprint 7 performance)
        // Must live in dist/ so _detectScriptBase() resolves it relative to geoleaf.esm.js
        const workerSrc = path.join(DIST, "geojson-worker.js");
        if (fs.existsSync(workerSrc)) {
            fs.copyFileSync(workerSrc, path.join(outDir, "dist", "geojson-worker.js"));
            log.ok(`dist/geojson-worker.js  (${sizeKB(workerSrc)})`);
        } else {
            log.warn("dist/geojson-worker.js not found — Sprint 7 worker not built?");
        }

        // 4 — (removed, T1b) The only CSS ever copied here was the pair of demo theme
        //     variants that `demo.extensions.js` swapped at runtime through an injected
        //     <link>. The demo layer is gone, and with it the sole reason for a `css/`
        //     directory in a deployment: the shipped stylesheet is `dist/geoleaf-main.min.css`.
        //     (`geoleaf-main.css` had already been dropped in S12 — it is the SOURCE
        //     aggregator, and none of its @import targets are deployed.)

        // 4c — Copy MapLibre → vendor/maplibre-gl/  (socle-init S5.4)
        //
        // 🛑 RÉSOLU PAR `require.resolve`, JAMAIS PAR UN CHEMIN EN DUR. Trois déclarations de
        // version coexistaient et ne coïncidaient que par discipline : `peerDependencies`
        // `^5.0.0` du core, la version réellement installée dans `node_modules`, et un
        // `@5.21.0` écrit à la main dans l'URL du document. Rien ne surveillait leur accord —
        // une montée de peerDep laissait le HTML servir l'ancienne version sans qu'aucune gate
        // ne rougisse. Résoudre depuis `node_modules` rend l'écart structurellement impossible :
        // il n'y a plus qu'une version, celle qui est installée.
        //
        // ⚠️ QUATRE fichiers, nommément — surtout pas `copyDir` sur `dist/`. Ce répertoire porte
        // aussi les sourcemaps (`maplibre-gl.mjs.map` ~2,5 Mo, et autant pour le chunk partagé)
        // et les builds `-dev` ; les copier gonflerait le déployé d'un facteur qui dépasse tout
        // ce que le Sprint 4 a gagné. Les sourcemaps ne sont délibérément pas copiées : elles
        // valent plusieurs fois le bundle, pour un confort de devtools sur une dépendance
        // tierce. Le `sourceMappingURL` du fichier produit donc un 404 en devtools, et c'est un
        // choix (S6.6 traite le sujet des sourcemaps exposées en production).
        //
        // ⚠️ `build-deploy.cjs` n'avait jamais lu `node_modules` — tous ses autres `copyFileSync`
        // sourcent un `dist/` de workspace. C'est une classe nouvelle pour ce script, et le
        // motif est unique : MapLibre est la seule dépendance que le DOCUMENT charge lui-même.
        //
        // ── MapLibre 6 : ce bloc a changé de nature, et pas seulement de noms de fichiers ──
        //
        // La v6 est ESM-only. `maplibre-gl.js` et `maplibre-gl-csp.js` NE SONT PLUS PUBLIÉS ;
        // l'entrée est `maplibre-gl.mjs`, qui importe `maplibre-gl-shared.mjs` par chemin
        // RELATIF et instancie son worker par `new Worker(new URL("./maplibre-gl-worker.mjs",
        // import.meta.url), {type:"module"})`. Trois conséquences, toutes structurelles :
        //
        //   ① Le répertoire doit rester PLAT ET COMPLET — les trois modules se cherchent entre
        //     eux à côté. Un vendor amputé d'un seul d'entre eux ne lève pas au build : il
        //     échoue au premier chargement, dans le navigateur.
        //   ② Le global `maplibregl` n'existe plus. Les ~20 fichiers de `adapters/maplibre/` et
        //     trois plugins le lisent pourtant. `global.mjs`, écrit juste en dessous, le repose
        //     en deux lignes — c'est ce qui permet à la migration de ne toucher aucun d'eux.
        //   ③ `require.resolve("maplibre-gl/package.json")` JETTE désormais : la carte `exports`
        //     de la v6 n'expose que `.` et `./dist/*`, pas `./package.json`. Le manifeste se
        //     dérive donc du chemin du module résolu, et non plus d'une résolution de paquet.
        log.section("🗺️  Copying MapLibre → vendor/maplibre-gl/");
        {
            const vendorDir = path.join(outDir, "vendor", "maplibre-gl");
            fs.mkdirSync(vendorDir, { recursive: true });
            const ML_ASSETS = [
                "maplibre-gl.mjs",
                "maplibre-gl-shared.mjs",
                "maplibre-gl-worker.mjs",
                "maplibre-gl.css",
            ];
            // UNE SEULE résolution de paquet, sur un specifier LITTÉRAL — les autres fichiers
            // sont ses voisins par construction, et l'anti-cécité ci-dessous le vérifie.
            //
            // `paths: [ROOT]` — résoudre depuis la racine du dépôt, pas depuis `scripts/`, pour
            // que la remontée de `node_modules` parte du même endroit que l'install.
            // ⚠️ `maplibre-gl` est déclaré en devDependency de la RACINE (et non du core, qui ne
            // l'a qu'en `peerDependencies`) précisément parce que c'est CE script, à la racine,
            // qui le consomme pour bâtir le déployé.
            // 🛑 ET LE SPECIFIER DOIT RESTER LITTÉRAL. Une interpolation (`maplibre-gl/dist/${x}`)
            // est invisible à l'analyse statique : knip a signalé la devDependency comme
            // inutilisée à la seconde près où ce bloc a cessé d'en porter une seule en clair —
            // et la retirer aurait cassé le build au premier clone frais.
            const mlEntry = require.resolve("maplibre-gl/dist/maplibre-gl.mjs", { paths: [ROOT] });
            const mlDistDir = path.dirname(mlEntry);
            for (const asset of ML_ASSETS) {
                fs.copyFileSync(path.join(mlDistDir, asset), path.join(vendorDir, asset));
            }

            // ⚠️ ANTI-CÉCITÉ — la liste ci-dessus est écrite à la main, donc elle se périme en
            // silence. Si une version future scindait un quatrième module de production, il ne
            // serait pas copié, le vendor serait incomplet, et RIEN ne le dirait : le build
            // sortirait vert et la carte casserait au chargement. On jette donc dès qu'un `.mjs`
            // de production du paquet n'est pas dans `ML_ASSETS`. Les `-dev` sont écartés — ce
            // sont les builds non minifiés, jamais servis.
            const shippedMjs = fs
                .readdirSync(mlDistDir)
                .filter((f) => f.endsWith(".mjs") && !f.includes("-dev"));
            const unlisted = shippedMjs.filter((f) => !ML_ASSETS.includes(f));
            if (unlisted.length > 0) {
                throw new Error(
                    `MapLibre vendoring incomplet : ${unlisted.length} module(s) de production ` +
                        `non listé(s) dans ML_ASSETS — ${unlisted.join(", ")}. Les ajouter, ` +
                        `sinon le vendor part amputé et la carte casse au chargement.`
                );
            }

            // Le shim qui repose le global. ÉMIS ICI, et pas maintenu comme fichier source :
            // son contenu est entièrement déterminé par le nom de l'entrée qu'on vient de
            // copier, donc le dériver interdit qu'ils divergent. Déterministe à l'octet près
            // (gate BUILD-DET) : aucune date, aucun hachage, aucun ordre d'itération.
            fs.writeFileSync(
                path.join(vendorDir, "global.mjs"),
                [
                    "// Généré par scripts/build-deploy.cjs — ne pas éditer.",
                    "// MapLibre 6 est ESM-only et ne publie plus de global ; GeoLeaf le lit sur",
                    "// `globalThis.maplibregl`. Ces deux lignes sont ce qui relie les deux.",
                    'import * as maplibregl from "./maplibre-gl.mjs";',
                    "globalThis.maplibregl = maplibregl;",
                    "",
                ].join("\n"),
                "utf8"
            );

            // ⚠️ PAS `require.resolve("maplibre-gl/package.json")` — voir ③ ci-dessus, la carte
            // `exports` de la v6 ne l'expose pas et la résolution JETTE. Le manifeste est le
            // voisin du répertoire `dist/` déjà résolu.
            const mlVersion = JSON.parse(
                fs.readFileSync(path.join(mlDistDir, "..", "package.json"), "utf8")
            ).version;
            log.ok(
                `vendor/maplibre-gl/ copied (maplibre-gl@${mlVersion}, resolved) — ` +
                    `${ML_ASSETS.length} fichiers + global.mjs`
            );
        }

        // 5 — Copy icons → icons/
        log.section("🖼️  Copying icons → icons/");
        if (fs.existsSync(SRC_ICONS)) {
            copyDir(SRC_ICONS, path.join(outDir, "icons"));
            log.ok("icons/ copied");
        } else {
            log.warn(`${path.relative(ROOT, SRC_ICONS)} not found`);
        }

        // 5b — Copy profile-specific sprites → icons/ (e.g. sprite_guyane.svg, sprite_rail.svg…)
        log.section("🖼️  Copying profile sprites → icons/");
        const profilesRoot = PROFILES;
        if (fs.existsSync(profilesRoot)) {
            for (const profileName of fs.readdirSync(profilesRoot)) {
                const profileIconsDir = path.join(profilesRoot, profileName, "icons");
                if (fs.existsSync(profileIconsDir)) {
                    for (const f of fs.readdirSync(profileIconsDir)) {
                        const src = path.join(profileIconsDir, f);
                        const dest = path.join(outDir, "icons", f);
                        fs.copyFileSync(src, dest);
                        log.ok(`icons/${f} (from profiles/${profileName}/icons/)`);
                    }
                }
            }
        }

        // 5a — Generate PWA manifest.json (merged from template + geoleaf.config.json pwa.*)
        log.section("📱 Generating PWA manifest.json");
        const manifestTemplateSrc = path.join(APP, "manifest.json");
        if (fs.existsSync(manifestTemplateSrc)) {
            const baseManifest = JSON.parse(fs.readFileSync(manifestTemplateSrc, "utf-8"));
            // Remove internal _comment field — not part of the Web App Manifest spec
            delete baseManifest["_comment"];

            // Read pwa config from profiles/geoleaf.config.json
            let pwaConfig = {};
            const rootCfgForManifest = path.join(PROFILES, "geoleaf.config.json");
            if (fs.existsSync(rootCfgForManifest)) {
                try {
                    const parsed = JSON.parse(fs.readFileSync(rootCfgForManifest, "utf-8"));
                    if (parsed.modules && parsed.modules.pwa) pwaConfig = parsed.modules.pwa;
                } catch {
                    log.warn(
                        "Could not parse geoleaf.config.json for PWA config — using manifest template defaults"
                    );
                }
            }

            // Merge: pwa.* fields override manifest template defaults
            const finalManifest = {
                ...baseManifest,
                ...(pwaConfig.name && { name: pwaConfig.name }),
                ...(pwaConfig.short_name && { short_name: pwaConfig.short_name }),
                ...(pwaConfig.description && { description: pwaConfig.description }),
                ...(pwaConfig.theme_color && { theme_color: pwaConfig.theme_color }),
                ...(pwaConfig.background_color && { background_color: pwaConfig.background_color }),
            };

            fs.writeFileSync(
                path.join(outDir, "manifest.json"),
                JSON.stringify(finalManifest, null, 2),
                "utf-8"
            );
            log.ok(
                `manifest.json (merged from config: name="${finalManifest.name}", theme_color="${finalManifest.theme_color}")`
            );
        } else {
            log.warn(
                `${path.relative(ROOT, manifestTemplateSrc)} not found — PWA manifest skipped`
            );
        }

        // 6 — Copy, filter, patch & bundle every profile → profiles/<id>/
        // Profiles are discovered dynamically: every directory under profiles/
        // except schemas/. Per profile: copy → strip the configs of gated plugins not
        // shipped by the variant → patch spriteUrl → generate profile-bundle.json.
        log.section("🗺️  Copying profiles → profiles/");
        const bundler = require("./lib/bundle-profiles.cjs");
        const variantModuleFlags = {
            storage: v.includeStorage,
            cog: v.includeCog,
            editor: v.includeEditor,
        };
        const profileIds = fs.existsSync(PROFILES)
            ? fs
                  .readdirSync(PROFILES, { withFileTypes: true })
                  // Skip schemas/ and _-prefixed dirs (test-only fixtures like _reference,
                  // config-contract Phase C — never shipped to a deploy variant).
                  .filter((e) => e.isDirectory() && e.name !== "schemas" && !e.name.startsWith("_"))
                  .map((e) => e.name)
            : [];
        if (profileIds.length === 0) log.err("no profile found under profiles/");

        // Harvest for `data.availableProfiles` (capability `profile-switcher`, S1).
        // A BROWSER CANNOT LIST A SERVER DIRECTORY: the selector's list has to be built
        // here, at deploy time, or be maintained by hand — and a hand-kept list drifts
        // from profiles/ the first time someone forgets it. Harvesting from the same
        // loop that copies the profiles makes the two impossible to desynchronise.
        const availableProfiles = [];

        for (const profileId of profileIds) {
            const profileSrc = path.join(PROFILES, profileId);
            const profileDest = path.join(outDir, "profiles", profileId);
            copyDir(profileSrc, profileDest);
            log.ok(`profiles/${profileId}/ — ${countFiles(profileDest)} files copied`);
            slimProfileData(profileDest, profileId);

            // `displayLabel` (short, for the selector) and `icon` are optional: a profile
            // that declares neither still appears, labelled by its technical `label`.
            try {
                const meta = JSON.parse(
                    fs.readFileSync(path.join(profileSrc, "profile.json"), "utf-8")
                );
                availableProfiles.push({
                    id: profileId,
                    displayLabel: meta.displayLabel || meta.label || profileId,
                    ...(meta.icon ? { icon: meta.icon } : {}),
                });
            } catch (err) {
                // Never silent: a profile absent from the list is a profile the user cannot
                // reach, and nothing else in this pipeline would report it.
                log.warn(
                    `profiles/${profileId}/profile.json unreadable — excluded from the switcher list: ${err.message}`
                );
            }

            filterProfilePluginConfigs(profileDest, profileId, variantModuleFlags);

            // spriteUrl patch — config/plugins/taxonomy.json (modules.taxonomy.icons) is the
            // sole source of the sprite URL read by the sprite loader.
            patchTaxonomySpriteUrl(path.join(profileDest, "config", "plugins", "taxonomy.json"));

            try {
                const { bundleSize, layerCount } = bundler.bundleProfile(profileDest, profileId);
                if (bundleSize > 0) {
                    log.ok(
                        `profiles/${profileId}/profile-bundle.json — ${layerCount} layer configs, ${(bundleSize / 1024).toFixed(1)} KB`
                    );
                }
            } catch (err) {
                log.warn(`profiles/${profileId}/ bundle skipped: ${err.message}`);
            }
        }

        // 6c — Copy & patch root config → profiles/geoleaf.config.json
        log.section("⚙️  Copying root config → profiles/");
        const rootConfig = path.join(PROFILES, "geoleaf.config.json");
        if (fs.existsSync(rootConfig)) {
            const cfgJson = JSON.parse(fs.readFileSync(rootConfig, "utf-8"));
            // Patch profilesBasePath for flat deploy structure (profiles/ is at same level as index.html)
            if (cfgJson.data) cfgJson.data.profilesBasePath = "./profiles";
            // Inject the harvested profile list (see §6). Written on `data`, next to
            // `activeProfile`, because it describes WHICH datasets exist — not how the
            // switcher looks, which is `modules.profile-switcher`.
            if (cfgJson.data) cfgJson.data.availableProfiles = availableProfiles;
            ensureDir(path.join(outDir, "profiles"));
            fs.writeFileSync(
                path.join(outDir, ROOT_CONFIG_DEPLOY_PATH),
                JSON.stringify(cfgJson, null, 2),
                "utf-8"
            );
            log.ok(
                `${ROOT_CONFIG_DEPLOY_PATH} (profilesBasePath → ./profiles, ${availableProfiles.length} profils récoltés)`
            );
        } else {
            log.err("profiles/geoleaf.config.json not found!");
        }

        // 7 — Generate patched index.html
        log.section("📄 Generating index.html");
        // This was the ONLY unguarded read of an app template in this file. Every other one
        // degrades gracefully because its artefact is optional (manifest → PWA skipped,
        // init.js → skipped, connector.local.js → dev-only), so they warn. This one is not
        // optional: the page IS the deployment, and no other file in the repo carries its
        // markup. An ENOENT here used to abort mid-run with a raw stack trace, AFTER the
        // variant's dist/ and profiles/ had been written — leaving a half-built folder that
        // a dev vhost keeps serving as if it were whole. A warn would be worse still: it
        // leaves globalOk true, so the script would exit 0 on a deploy with no page.
        const appHtml = path.join(APP, "index.html");
        if (!fs.existsSync(appHtml)) {
            log.err(`${path.relative(ROOT, appHtml)} not found — aborting.`);
            log.err("It is the SINGLE source of every shipped variant: nothing else in");
            log.err("the repo carries this markup, so there is nothing to deploy without it.");
            process.exit(1);
        }
        const demoHtml = fs.readFileSync(appHtml, "utf-8");

        // Cache-busting PAR CONTENU (S5.8) — voir `contentTag`. Le `?v=` d'un asset ne change
        // que si cet asset change, donc un déploiement sans modification ne fait re-télécharger
        // RIEN. C'était l'inverse : un `Date.now()` unique et partagé bustait tout, à chaque
        // fois, à contenu identique.
        //
        // ⚠️ Empreinte PAR FICHIER, pas une pour tous. Avec une empreinte partagée, toucher un
        // seul plugin ferait re-télécharger l'entrée et les onze autres — on aurait remplacé un
        // horodatage par un hachage sans rien gagner.
        //
        // ⚠️ Si le fichier n'est pas dans `outDir` (variante qui ne l'embarque pas), on laisse
        // l'URL NUE plutôt que d'inventer une empreinte : `stripPluginScript` retire ensuite la
        // balise, et une clé `?v=` fantôme dans le pré-cache serait un raté permanent
        // (`cache.match` est appelé sans `ignoreSearch`).
        const tagFor = (rel) => {
            const abs = path.join(outDir, rel);
            return fs.existsSync(abs) ? `${rel}?v=${contentTag(abs)}` : rel;
        };

        let patched = demoHtml
            // Rewrite asset paths to flat deploy structure
            .replace(/src\/assets\/icons\//g, "icons/")
            .replace(/src\/css\/geoleaf-main\.css/g, "dist/geoleaf-main.min.css")
            // Append cache-buster to ESM bundle and all plugins so the service worker
            // never serves a stale plugin file after a rebuild.
            .replace(/dist\/geoleaf\.esm\.js/g, () => tagFor("dist/geoleaf.esm.js"))
            .replace(/dist\/geoleaf-([\w-]+)\.plugin\.js/g, (m) => tagFor(m))
            // Use minified CSS instead of source CSS (fallback)
            .replace(/css\/geoleaf-main\.css/g, "dist/geoleaf-main.min.css");

        // 7a — Preload block, generated from the entry's STATIC import graph.
        const eagerChunks = extractEagerChunks(path.join(outDir, "dist", "geoleaf.esm.js"));
        const htmlBeforePreload = patched;
        patched = patched.replace(
            /^([ \t]*)<!--\s*__GEOLEAF_MODULEPRELOAD__\s*-->[ \t]*$/m,
            (_m, indent) => buildPreloadTags(eagerChunks, indent)
        );
        if (patched === htmlBeforePreload) {
            // Never a warning: a marker that stopped matching produces a deploy that looks
            // perfectly fine and has quietly lost the preload block. That is the failure mode
            // this whole sprint exists to remove, so it fails the build instead.
            log.err("index.html — the __GEOLEAF_MODULEPRELOAD__ marker did not match.");
            log.err("It must sit on ONE line, spelled exactly, in apps/geoleaf-app/index.html.");
            process.exit(1);
        }
        log.ok(`index.html — ${eagerChunks.length} modulepreload + 1 config preload (derived)`);

        // Plugin removal after cache-busting: filename derived from the registry, not
        // hard-coded — see stripPluginScript()'s doc comment for why (STRUCT S3.1).
        const variantLabel = v.name || PLUGIN_MODE;
        if (!v.includeStorage) {
            patched = stripPluginScript(patched, "offline-ui", variantLabel);
        }
        if (!v.includeCog) {
            patched = stripPluginScript(patched, "cog", variantLabel);
        }
        if (!v.includeEditor) {
            patched = stripPluginScript(patched, "editor", variantLabel);
        }
        // Le bootstrap de POSTE. Retiré partout sauf dans `deploy-local` : c'est ce retrait,
        // et non une garde d'exécution, qui empêche un jeton d'entrer dans un livrable.
        if (!v.includeDevConnector) {
            patched = stripDevConnectorScript(patched, variantLabel);
        }
        const hasGatedPlugins = v.includeStorage || v.includeCog || v.includeEditor;
        if (!hasGatedPlugins) {
            // Drops the now-orphan header above the script tags removed just above. Coupled to
            // index.html: the comment must stay a SINGLE line starting with "Optional plugins"
            // (no /s flag here, so `.` never crosses newlines) or it silently stops matching.
            patched = patched.replace(/^\s*<!--\s*Optional plugins.*?-->\s*$/gm, "");
        }

        // Clean up blank lines left by removed script tags
        patched = patched.replace(/\n{3,}/g, "\n\n");

        fs.writeFileSync(path.join(outDir, "index.html"), patched, "utf-8");
        log.ok(
            hasGatedPlugins
                ? `index.html — paths rewritten (${v.name || PLUGIN_MODE})`
                : "index.html — plugins removed, paths rewritten"
        );

        // 8 — Copy the application bootstrap
        //
        // (T1b) The demo layer that used to be copied here is gone: `demo-header.html`
        // (fetched by init.js into a `#demo-header-container` div), `demo.extensions.js`
        // (runtime theme/profile/lang switchers) and `demo.css`. They existed to dress a
        // showcase page, not to ship a deployment — every one of them carried a
        // "DEMO ONLY — remove for production projects" banner. A deployment now consists
        // of the page, the bootstrap, the bundles, the profiles and the icons.

        // init.js — bootstrap script (GeoLeaf.boot())
        //
        // ⚠️ IL EST PATCHÉ PAR VARIANTE DEPUIS LE 07/08/2026 (tâche 8.1 du Sprint 8, B-136).
        // Il ne l'était pas, alors qu'`index.html` l'était : c'est cet écart exact qui laissait
        // trois créneaux paresseux d'`editor` enregistrés sur `deploy-core`, une variante qui
        // n'embarque pas leur bundle. Voir `stripGatedInitBlock`.
        const initSrc = path.join(APP, "init.js");
        if (fs.existsSync(initSrc)) {
            let initContent = fs.readFileSync(initSrc, "utf-8");
            if (!v.includeEditor) {
                initContent = stripGatedInitBlock(initContent, "editor", variantLabel);
                log.ok("init.js — gated block `editor` stripped (variant ships no editor bundle)");
            }
            // socle-init S4.4 — `cog` a rejoint `editor` dans `init.js` le 07/08/2026 : sa
            // balise `<script>` eager (99,8 Ko gz, le plus lourd des plugins) est devenue un
            // `registerLazy`. Le retrait par variante doit suivre le déménagement, sinon
            // `deploy-core` enregistre un résolveur paresseux visant un bundle qu'il
            // n'embarque pas — B-136, à l'identique.
            if (!v.includeCog) {
                initContent = stripGatedInitBlock(initContent, "cog", variantLabel);
                log.ok("init.js — gated block `cog` stripped (variant ships no cog bundle)");
            }
            fs.writeFileSync(path.join(outDir, "init.js"), initContent, "utf-8");
            log.ok("init.js copied");
        } else {
            log.warn(`${path.relative(ROOT, initSrc)} not found — skipped`);
        }

        // connector.local.js — bootstrap Connector de POSTE (JWT). Git-ignoré à la source.
        //
        // 🛑 COPIÉ DANS UNE SEULE VARIANTE, ET SA BALISE EST RETIRÉE DES AUTRES. Les deux
        // gestes vont ensemble : `stripDevConnectorScript` a déjà ôté d'`index.html` la balise
        // qui le charge, ici on n'écrit pas le fichier. Une variante livrable n'a donc ni le
        // fichier, ni la moindre référence à lui — c'est ce qui permet à
        // `verify-deploy-no-secrets.cjs` d'exiger une ABSENCE plutôt que de vérifier la forme
        // d'un talon.
        //
        // ## L'histoire, parce qu'elle explique deux mécanismes disparus
        //
        // ① Jusqu'au 30/07/2026 le fichier n'était copié que s'il existait, et `init.js`
        // l'importait INCONDITIONNELLEMENT. Sur un poste qui l'avait, tout était vert ;
        // ailleurs, le navigateur journalisait « Failed to load resource: 404 » — une erreur
        // console qu'aucun `try/catch` ne supprime, puisque ce n'en est pas une au sens JS. Les
        // suites `15-file-import` et `16-flatgeobuf` étaient VERTES en local et ROUGES en CI,
        // 8 specs, sur le seul écart d'un fichier que git ne montre pas.
        //
        // ② Le remède d'alors fut un TALON INERTE émis partout, sur la règle « la forme d'un
        // déploiement ne doit pas dépendre de qui le construit ». La règle est juste, et elle
        // ne parlait que de la FORME : là où le fichier réel existait, il était recopié tel
        // quel — jeton `geoleaf_editor` compris, plus ses `.gz`/`.br` — dans `deploy-core` et
        // `deploy-full`, donc dans ce qui part chez un client. Même forme partout, pas le même
        // contenu, et c'est le contenu qui portait le secret.
        //
        // ③ Le vrai défaut était en amont des deux : un import OBLIGATOIRE d'un fichier
        // OPTIONNEL. Il forçait le fichier à exister partout, donc le talon, donc son entrée
        // dans `required`, donc une exemption nommée dans `verify-app-template.cjs`. Rendre le
        // chargement conditionnel — une balise gatée par variante, comme pour les plugins
        // optionnels — supprime les trois d'un coup. Le talon n'existe plus.
        //
        // ⚠️ Ne pas réintroduire de repli silencieux ici. L'absence du fichier est FATALE pour
        // `deploy-local` (voir plus bas) et sans objet pour les autres : il n'y a pas de
        // troisième cas, et un `else` qui écrirait « quelque chose » ramènerait le talon.
        const connectorLocalSrc = path.join(APP, "connector.local.js");
        const connectorLocalOut = path.join(outDir, "connector.local.js");
        if (!v.includeDevConnector) {
            log.ok("connector.local.js — absent (variante livrable : ni fichier, ni référence)");
        } else if (fs.existsSync(connectorLocalSrc)) {
            fs.copyFileSync(connectorLocalSrc, connectorLocalOut);
            log.warn(
                "connector.local.js — VRAI bootstrap de poste copié (jeton). À ne jamais livrer."
            );
        } else {
            // 🛑 FATAL, et c'est le seul endroit où l'absence de ce fichier est un défaut.
            // `deploy-local` n'existe QUE pour lui : sa balise est conservée dans `index.html`,
            // donc sans le fichier le navigateur journaliserait « Failed to load resource: 404 »
            // — une erreur console qu'aucun `try/catch` ne supprime, puisque ce n'en est pas une
            // au sens JS. Sortir 0 ici produirait une variante qui ment sur ce qu'elle est.
            throw new Error(
                `build-deploy: ${v.name} — apps/geoleaf-app/connector.local.js est absent, or ` +
                    `cette variante existe précisément pour le porter. La créer depuis le ` +
                    `gabarit : cp apps/geoleaf-app/connector.local.example.js ` +
                    `apps/geoleaf-app/connector.local.js, puis y coller le jeton de dev.`
            );
        }

        // 8b — Derive the boot-critical asset list, and inject it into the deployed SW.
        //
        // ⚠️ IT RUNS AFTER STEP 8, AND THAT ORDER IS THE POINT. It used to be step 7b, wedged
        // between the index.html write and the bootstrap copy, where `init.js` did not exist
        // in `outDir` yet — so the bijection check below could not have been written there.
        //
        // What it replaces: three literals and a `(${3} assets)` log that interpolated the
        // count by hand. STATIC_ASSETS held `index.html` plus the ESM bundle plus the CSS,
        // out of the ~17 URLs a first load actually needs, and one of those three was DEAD —
        // it carried a `?v=` cache-buster the stylesheet link never carries, and the SW
        // matches without `ignoreSearch`. The app declared itself a PWA and could not boot
        // offline. The count is deliberately NOT written anywhere: it differs per variant
        // (deploy-core ships 6 plugins, deploy-full 8) and is printed, never asserted.
        log.section("🧩 Deriving boot-critical assets");
        const { assets: bootAssets } = deriveBootCriticalAssets({
            outDir,
            patchedHtml: patched,
            eagerChunks,
        });

        {
            const staticAssetsContent = bootAssets.map((u) => JSON.stringify(u)).join(", ");
            const swPath = path.join(outDir, "sw-core.js");
            if (fs.existsSync(swPath)) {
                const swSource = fs.readFileSync(swPath, "utf8");

                // Seam guard: the offline navigation fallback matches the shell by literal
                // key. If it is ever renamed on the worker's side, pre-caching the old name
                // would leave `navigationStrategy` matching nothing — a deploy that installs
                // cleanly, reports 19 pre-cached assets, and still fails every offline
                // navigation. The two sides are checked against each other, here, once.
                if (!swSource.includes(`match("${APP_SHELL_DEPLOY_PATH}")`)) {
                    log.err(
                        `sw-core.js no longer matches the shell as \`match("${APP_SHELL_DEPLOY_PATH}")\`.`
                    );
                    log.err("APP_SHELL_DEPLOY_PATH and navigationStrategy must name the same key.");
                    process.exit(1);
                }

                // ── CACHE_VERSION dérivé (S5.8) ──────────────────────────────────────────
                //
                // 🛑 LA VERSION DU CACHE EST UNE FONCTION DE CE QUI EST DANS LE CACHE. Elle
                // portait un `Date.now()`, ce qui la faisait changer à CHAQUE build : `activate`
                // purgeait toute la famille `geoleaf-v*`, et l'install reconstituait un cache
                // identique en re-téléchargeant tout. Un déploiement sans changement coûtait
                // donc un pré-cache complet — et c'est ce qui annulait le bénéfice du `?v=`
                // haché ci-dessus pour tout client contrôlé par le worker. **Les deux tâches
                // sont couplées : ni l'une ni l'autre ne rend son gain seule.**
                //
                // Dérivée de la LISTE des assets pré-cachés et de leur contenu : deux builds de
                // la même source donnent le même nom, donc `activate` ne purge rien et le cache
                // survit ; un asset qui change donne un nom neuf, donc la purge a lieu. C'est
                // exactement la sémantique attendue, et elle n'était pas atteignable à l'étape
                // de copie — ni `index.html` ni `bootAssets` n'existaient encore.
                //
                // ⚠️ LE PRÉFIXE `geoleaf-v` EST LOAD-BEARING : `activate` filtre les caches à
                // purger par `cacheName.startsWith("geoleaf-v")`. Un schéma de nom qui le perd
                // fait cesser la purge en silence, et les vieux caches s'accumulent.
                // ⚠️ Ne touche PAS `CACHE_TILES`, délibérément non versionné (décision A16) —
                // il survit précisément parce que son nom ne porte pas de version.
                const cacheFingerprint = crypto
                    .createHash("sha256")
                    .update(
                        bootAssets
                            .map((u) => {
                                const abs = path.join(outDir, u.split("?")[0]);
                                return `${u}:${fs.existsSync(abs) ? contentTag(abs) : "missing"}`;
                            })
                            .join("\n")
                    )
                    .digest("hex")
                    .slice(0, 12);

                let swOut = swSource.replace(
                    /\/\*\s*__GEOLEAF_STATIC_ASSETS__\s*\*\//,
                    staticAssetsContent
                );
                const beforeVersion = swOut;
                swOut = swOut.replace(
                    /(const CACHE_VERSION\s*=\s*"geoleaf-v[^"]*)(")/,
                    `$1-${cacheFingerprint}$2`
                );
                if (swOut === beforeVersion) {
                    log.err(
                        "CACHE_VERSION not patched — the `geoleaf-v` literal moved or changed."
                    );
                    log.err('activate() purges by `startsWith("geoleaf-v")`; a silent miss here');
                    log.err("would leave every deploy sharing one cache name. Aborting.");
                    process.exit(1);
                }

                fs.writeFileSync(swPath, swOut);
                log.ok(
                    `SW STATIC_ASSETS injected — ${bootAssets.length} assets ` +
                        `(${eagerChunks.length} eager chunks, derived) · CACHE_VERSION +${cacheFingerprint}`
                );
            } else {
                log.warn("sw-core.js not in outDir — STATIC_ASSETS injection skipped");
            }
        }

        // 8b — S6.6 : purge des `sourceMappingURL` orphelins, puis GARDE.
        //
        // Retirer les `.map` sans toucher aux bundles laisserait chaque fichier pointer une
        // cible absente : un 404 en devtools à chaque ouverture. C'était déjà le cas pour
        // MapLibre depuis le S5, assumé mais jamais réparé — cette passe le solde aussi.
        //
        // 🛑 L'ORDRE COMPTE ET N'EST PAS INTERCHANGEABLE. Elle court AVANT `precompress()`
        // (étape 12), sinon les `.gz`/`.br` porteraient la ligne que le fichier brut n'a plus
        // — deux représentations du même artefact qui divergent, et c'est la compressée que
        // nginx sert (`gzip_static on`). Le défaut serait donc invisible en lisant le déployé.
        {
            const stripped = [];
            const sweep = (dir) => {
                if (!fs.existsSync(dir)) return;
                for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                    const p = path.join(dir, e.name);
                    if (e.isDirectory()) {
                        sweep(p);
                        continue;
                    }
                    if (!/\.(js|css)$/.test(e.name)) continue;
                    const before = fs.readFileSync(p, "utf8");
                    // `//# sourceMappingURL=…` (JS) et `/*# sourceMappingURL=… */` (CSS),
                    // en fin de fichier, avec ou sans saut de ligne final.
                    const after = before.replace(
                        /\s*(?:\/\/|\/\*)#\s*sourceMappingURL=[^\s*]+\s*(?:\*\/)?\s*$/,
                        "\n"
                    );
                    if (after !== before) {
                        fs.writeFileSync(p, after);
                        stripped.push(path.relative(outDir, p));
                    }
                }
            };
            sweep(outDir);
            log.ok(`sourceMappingURL retirés — ${stripped.length} fichier(s)`);

            // La garde. Elle n'est PAS circulaire avec ce qui précède : rien ici n'a supprimé
            // de `.map`, les sites de copie les ont filtrés en amont. Elle échoue donc pour de
            // bon si un futur bloc de copie en réintroduit un — c'est exactement le mode par
            // lequel les cinq `.map` de `dist/chunks/` étaient entrés sans être nommés.
            const leakedMaps = [];
            const findMaps = (dir) => {
                if (!fs.existsSync(dir)) return;
                for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                    const p = path.join(dir, e.name);
                    if (e.isDirectory()) findMaps(p);
                    else if (isSourceMap(e.name)) leakedMaps.push(path.relative(outDir, p));
                }
            };
            findMaps(outDir);
            if (leakedMaps.length) {
                throw new Error(
                    // `v.name` est VIDE sur le chemin mono-variante quand aucun nom de dossier
                    // n'est dérivé (`SINGLE_VARIANT_NAME` ne vaut que pour `--plugins=full` et
                    // `--plugins=local` ; `none` déploie à la racine), et un message qui
                    // commence par « build-deploy:  — » ne dit pas où regarder. Le répertoire,
                    // lui, est toujours renseigné.
                    `build-deploy: ${v.name || path.relative(ROOT, outDir)} — ` +
                        `${leakedMaps.length} sourcemap(s) dans le ` +
                        `déployé : ${leakedMaps.join(", ")}. Le déployé n'en expédie AUCUNE ` +
                        `(S6.6) : elles exposent l'intégralité des sources en production. ` +
                        `Filtrer la copie avec \`isSourceMap\`, ne pas supprimer cette garde.`
                );
            }
            log.ok(`aucune sourcemap dans le déployé (garde S6.6)`);
        }

        // 9 — Validation
        log.section("✅ Validation");
        const required = [
            "index.html",
            "manifest.json",
            "init.js",
            "dist/geoleaf.esm.js",
            "dist/geoleaf-main.min.css",
            "icons/logo.png",
            "icons/fav.png",
            ROOT_CONFIG_DEPLOY_PATH,
            "profiles/tourism/profile.json",
            "profiles/tourism/profile-bundle.json",
            "profiles/tourism/config/core/layers.json",
            "profiles/tourism/config/core/themes.json",
            "dist/geoleaf-connector.plugin.js", // always present
            // 🛑 `connector.local.js` N'EST PLUS ICI, ET SON RETRAIT EST LE CORRECTIF.
            // Il y a figuré du 30/07 au 09/08/2026, au motif qu'une absence ne se manifeste pas
            // là où on la produit — elle fait un 404 dans le navigateur, sur l'import
            // inconditionnel d'`init.js`. Le motif était bon ; c'est l'import inconditionnel qui
            // ne l'était pas. Depuis qu'une balise gatée le charge, le fichier n'a aucune raison
            // d'exister dans un livrable, et l'EXIGER l'y ramènerait. Son absence y est
            // désormais l'invariant, tenu par `verify-deploy-no-secrets.cjs` (DNS-02).
        ];

        // sw-core.js, dist/geojson-worker.js, sw.js: optional when sources are .ts or emit path differs
        const optionalDeploy = ["sw-core.js", "dist/geojson-worker.js"];
        if (v.includeStorage) optionalDeploy.push("sw.js");

        if (v.includeStorage) {
            required.push("dist/geoleaf-offline-ui.plugin.js");
        }
        if (v.includeEditor) {
            required.push("dist/geoleaf-editor.plugin.js");
        }

        let allOk = true;
        for (const rel of required) {
            const p = path.join(outDir, rel);
            if (fs.existsSync(p)) {
                log.ok(rel);
            } else {
                log.err(`MISSING: ${rel}`);
                allOk = false;
            }
        }
        for (const rel of optionalDeploy) {
            const p = path.join(outDir, rel);
            if (fs.existsSync(p)) {
                log.ok(rel);
            } else {
                log.warn(`Optional (missing): ${rel}`);
            }
        }

        // Variant content gate: a core-only deploy must not carry a GATED plugin bundle.
        // What it guards is BUILD CORRECTNESS, nothing else: a core-only variant that
        // ships storage/addpoi/cog/editor is a wrong build — the consumer asked for the
        // small bundle and got the big one.
        // ⚠️ ARCHI S8 — `cog` was MISSING from this list while being a gated plugin, so a cog
        // bundle could land in deploy-core and the guard would have reported nothing. Added.
        // The list must hold exactly the three `include*` flags; the 9 always-bundled plugins
        // belong in every variant and must never appear here.
        // ⚠️ S6.6 — les quatre entrées `.map` de cette liste sont RETIRÉES parce qu'elles
        // étaient devenues INATTEIGNABLES : la garde de l'étape 8b jette sur toute sourcemap,
        // quelle qu'elle soit, donc aucune ne peut plus arriver jusqu'ici. Les garder aurait
        // fait exactement ce que ce sprint corrige ailleurs — une liste qui décrit un état que
        // le code ne peut plus produire, et qu'un lecteur croit encore active.
        if (!hasGatedPlugins) {
            const leaked = [
                "dist/geoleaf-offline-ui.plugin.js",
                "dist/geoleaf-cog.plugin.js",
                "dist/geoleaf-editor.plugin.js",
                "dist/sw.js",
            ];
            // Editor code-splitting emits hashed lazy chunks (geoleaf-editor.<name>-<hash>.js)
            // whose names aren't known ahead of time — sweep the deploy dist for any of them
            // so a plugin chunk can't end up in a core-only build.
            const distDir = path.join(outDir, "dist");
            if (fs.existsSync(distDir)) {
                for (const f of fs.readdirSync(distDir)) {
                    if (
                        /^geoleaf-editor\..+\.js(\.map)?$/.test(f) &&
                        !leaked.includes(`dist/${f}`)
                    ) {
                        leaked.push(`dist/${f}`);
                    }
                }
            }
            const foundLeaks = [];
            for (const rel of leaked) {
                const fullPath = path.join(outDir, rel);
                if (fs.existsSync(fullPath)) {
                    foundLeaks.push(rel);
                    try {
                        fs.unlinkSync(fullPath);
                        log.err(
                            `[VARIANT] Plugin artefact does not belong in this variant, removed: ${rel}`
                        );
                    } catch (e) {
                        log.err(`[VARIANT] Could not remove ${rel}: ${e.message}`);
                    }
                }
            }
            if (foundLeaks.length > 0) {
                log.err(
                    `FATAL: ${foundLeaks.length} plugin artefact(s) ended up in a core-only build.`
                );
                log.err(`Artefacts were removed. Fix the build before deploying.`);
                log.err(`Run with --plugins=full to intentionally include the gated plugins.`);
                process.exit(1);
            }
        }

        // 9a bis — Le TÉLÉCHARGEMENT DE TUILES est coupé dans ce qui s'expose (12/08/2026).
        //
        // 🛑 Le motif n'est PAS le backend de preuve, et c'est pour ça que ce traitement a sa
        // propre fonction plutôt qu'une ligne dans `dev-backend.cjs` : les tuiles du profil de
        // démo viennent de **tiers** — `server.arcgisonline.com`, `opentopomap.org`,
        // `basemaps.cartocdn.com` —, dont les conditions d'usage interdisent typiquement
        // l'aspiration en masse. Un bouton « télécharger hors ligne » sur une page publique est
        // exactement le geste qu'ils bannissent, et la sanction tombe sur l'origine qui émet.
        //
        // ⚠️ Ce veto ne coupe QUE le téléchargement explicite. Le cache du service worker reste
        // actif, et il le doit : il n'écrit que des réponses **déjà revenues du réseau**
        // (`sw-core.js` — « LE SEUL ÉCRIVAIN de CACHE_TILES »), donc il RÉDUIT le trafic vers
        // ces tiers au lieu de l'augmenter. Le confondre avec l'aspiration ferait retirer une
        // protection en croyant en poser une.
        //
        // 🖐 CE QUE ÇA NE PROTÈGE PAS, et il faut le dire : un visiteur maîtrise son navigateur.
        // Il peut remettre le drapeau à `true` dans la réponse JSON, ou appeler l'API
        // directement. Ce réglage retire la fonction de l'INTERFACE ; il n'est pas un contrôle
        // d'accès. La seule protection réelle contre l'aspiration est du côté qui sert les
        // tuiles (quota, referer, clé) — aucune configuration cliente ne peut la remplacer.
        //
        // ⚠️ Passe RÉCURSIVE : le drapeau vit à deux profondeurs — `.cache.enableTileCache` dans
        // `config/plugins/offline.json`, et `.modules.offline.cache.enableTileCache` dans
        // `profile-bundle.json`. Traiter l'un sans l'autre laisserait le second vivant, et c'est
        // LUI que le chargeur lit — le même piège que les liaisons ci-dessous.
        //
        // @param {any} node Racine du JSON de profil (muté en place).
        // @returns {number} Nombre de drapeaux passés à `false`.
        const vetoTileDownload = (node) => {
            let n = 0;
            const walk = (obj) => {
                if (Array.isArray(obj)) return obj.forEach(walk);
                if (!obj || typeof obj !== "object") return;
                for (const [k, val] of Object.entries(obj)) {
                    if (k === "enableTileCache" && val !== false) {
                        obj[k] = false;
                        n += 1;
                    } else walk(val);
                }
            };
            walk(node);
            return n;
        };

        // 9a — Le backend de PREUVE ne part pas chez un client.
        //
        // 🛑 Mesuré le 09/08/2026 : `profiles/tourism/.../sites_rosario_config.json` portait
        // quatre liaisons vers `https://qgis.geoleaf.dev` — l'hôte monté par
        // `docker-compose.dev.yml`, qui ne résout QUE sur le poste —, recopiées telles quelles
        // dans `deploy-core` et `deploy-full`. L'affichage n'était pas en cause (la couche a un
        // `data.file` local) ; ce qui partait mort, c'était le rapatriement et l'écriture.
        //
        // ⚠️ LE DISCRIMINANT EST `includeDevConnector`, LE MÊME QUE POUR LE JETON, et ce n'est
        // pas une commodité : la liaison et le jeton sont les deux moitiés d'une même chose —
        // on n'écrit pas sur ce backend sans le second. Les séparer produirait une variante qui
        // nomme une cible qu'elle ne peut pas atteindre.
        //
        // ⚠️ Passe SUR LE DÉPLOYÉ, pas sur `profiles/` : la source reste le profil de dev, qui
        // est ce qu'il doit être. Elle court après la copie pour attraper AUSSI
        // `profile-bundle.json`, l'agrégat — et c'est lui que le chargeur lit.
        if (!v.includeDevConnector) {
            const profilesOut = path.join(outDir, "profiles");
            let touched = 0;
            let tilesVetoed = 0;
            let files = 0;
            if (fs.existsSync(profilesOut)) {
                const stack = [profilesOut];
                while (stack.length) {
                    const dir = stack.pop();
                    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory()) stack.push(full);
                        else if (entry.name.endsWith(".json")) {
                            const json = JSON.parse(fs.readFileSync(full, "utf-8"));
                            const n = stripDevBackendBindings(json, BACKEND_BASE_URL);
                            const t = vetoTileDownload(json);
                            if (n > 0 || t > 0) {
                                fs.writeFileSync(full, JSON.stringify(json, null, 2), "utf-8");
                                touched += n;
                                tilesVetoed += t;
                                files += 1;
                            }
                        }
                    }
                }
            }
            if (tilesVetoed > 0) {
                log.ok(
                    `téléchargement de tuiles — ${tilesVetoed} drapeau(x) enableTileCache ` +
                        `passé(s) à false (aspiration coupée ; le cache de navigation reste)`
                );
            }
            if (touched === 0) {
                log.ok("backend de preuve — aucune liaison à retirer des profils");
            } else if (BACKEND_BASE_URL) {
                log.warn(
                    `backend de preuve — ${touched} liaison(s) REPOINTÉE(S) vers ` +
                        `${BACKEND_BASE_URL} dans ${files} fichier(s). Variante non livrable en l'état.`
                );
            } else {
                log.ok(
                    `backend de preuve — ${touched} liaison(s) retirée(s) de ${files} fichier(s) ` +
                        `(rapatriement et écriture inertes ; l'affichage reste servi par data.file)`
                );
            }
        }

        // 9b — Le contrat serveur part AVEC le dossier.
        //
        // 🛑 CE QU'ON LIVRE DOIT DIRE CE QU'IL EXIGE. Le 09/08/2026, un `deploy-full` copié tel
        // quel sur un serveur nginx de production a rendu un spinner infini : la table
        // `mime.types` de nginx ne connaît que `js`, les `.mjs` du moteur MapLibre partaient en
        // `application/octet-stream`, et le navigateur refuse d'exécuter un module sous ce type.
        //
        // Le dépôt SAVAIT — `docker/nginx.dev.conf` porte la directive sous « SANS CETTE LIGNE,
        // RIEN NE BOOTE », et admet dans la foulée : « ⚠️ Cette contrainte VIT HORS DU DÉPÔT
        // pour l'intégrateur — aucune gate ne peut la voir chez lui ». Ce n'était donc pas un
        // trou de connaissance mais de DIFFUSION : la recette vivait dans un fichier de dev qui
        // ne part pas avec le dossier, et le livrable ne portait aucun fichier d'accompagnement.
        //
        // ⚠️ Aucun des trois fichiers n'est dans l'allowlist de `precompress()` — ils ne
        // reçoivent donc pas de jumeau `.gz`/`.br`, ce qui est voulu : ils sont lus par un
        // humain, une fois, avant que quoi que ce soit ne soit servi.
        if (carriesServerContract(v.name)) {
            for (const [name, body] of Object.entries(serverContractFiles())) {
                fs.writeFileSync(path.join(outDir, name), body, "utf-8");
            }
            log.ok(
                `contrat serveur — SERVEUR.md, nginx.conf.example, .htaccess ` +
                    `(gatés par verify-deploy-server-contract.cjs)`
            );
        } else {
            log.info(`contrat serveur — non émis (${v.name} n'est servie que sur le poste)`);
        }

        // 10 — Pré-compression (socle-init S4.2). EN DERNIER, et ce n'est pas un détail
        // d'ordonnancement : tout ce qui précède réécrit des fichiers (patch du markup,
        // injection de STATIC_ASSETS, allègement des GeoJSON, retrait des artefacts fuités).
        // Compresser avant, c'est expédier des `.gz` périmés que nginx servirait À LA PLACE
        // de l'original — un déployé qui sert silencieusement l'avant-dernier build.
        precompress(outDir, v.name);

        if (!allOk) globalOk = false;
    } // end for (const v of variants)

    // 10 — Summary
    log.section("📊 Summary");
    if (BUILD_ALL_VARIANTS) {
        for (const v of variants) {
            const outDir = path.join(DEPLOY, v.name);
            const totalFiles = countFiles(outDir);
            const rawBytes = totalSizeBytes(outDir);
            const sizeMB = (rawBytes / (1024 * 1024)).toFixed(1);
            log.ok(`deploy/${v.name}/ — ${totalFiles} files, ${sizeMB} MB`);
        }
        log.info(`Path: ${DEPLOY}`);
        log.info("  deploy/deploy-core/   — Core + the 9 always-bundled plugins");
        log.info(
            "  deploy/deploy-full/   — + Storage + Cog + Editor (édition, capture POI, hors-ligne)"
        );
    } else {
        const totalFiles = countFiles(DEPLOY);
        const rawBytes = totalSizeBytes(DEPLOY);
        const sizeMB = (rawBytes / (1024 * 1024)).toFixed(1);
        log.ok(`deploy/ ready — ${totalFiles} files, ${sizeMB} MB total (${mode})`);
        log.info(`Path: ${DEPLOY}`);
    }
    log.info("");
    // 🛑 CE BLOC A DIT « Serve via http » JUSQU'AU 09/08/2026, ET C'ÉTAIT LE DERNIER TEXTE LU
    // AVANT UN DÉPLOIEMENT. Deux énoncés faux, dans les deux lignes :
    //
    //   ① « via http » — la page déclare `upgrade-insecure-requests` : en HTTP nu, le navigateur
    //      réécrit toutes les sous-ressources en https:// et chacune échoue. Le conseil décrivait
    //      exactement la configuration qui ne peut pas fonctionner.
    //   ② rien sur le type MIME de `.mjs`, seule exigence dont l'absence empêche le boot. Un
    //      `deploy-full` copié tel quel sur nginx a rendu un spinner infini ce jour-là.
    //
    // Le remède n'est pas d'allonger ce message — personne ne lit un build à l'écran deux fois —
    // mais de RENVOYER au contrat qui part avec le dossier. C'est `SERVEUR.md`, émis à l'étape
    // 9b dans chaque variante livrable et gaté par `verify-deploy-server-contract.cjs`.
    log.info("Next steps:");
    log.info("  1. Copier le contenu d'UNE variante (pas de deploy/ entier) sur le serveur");
    log.info("  2. Lire le SERVEUR.md émis à côté — 2 exigences bloquent le boot :");
    log.info("       • HTTPS (la page déclare `upgrade-insecure-requests`)");
    log.info("       • le type MIME de `.mjs` — nginx ne le connaît PAS par défaut");
    log.info("     Recettes prêtes à coller, dans le dossier : nginx.conf.example, .htaccess");
    log.info("");
    log.info("Contrôle en une commande, avant même de recharger la page :");
    log.info("  curl -sI https://VOTRE-HOTE/vendor/maplibre-gl/global.mjs | grep -i content-type");
    log.info("  → attendu : text/javascript. Si `application/octet-stream`, rien ne bootera.");
    log.info("");
    // ⚠️ Ces deux cibles restent nommées, mais SANS promesse : le type MIME de `.mjs` s'y
    // configure différemment (Netlify : `_headers` ; GitHub Pages : rien à configurer du tout),
    // et le projet ne les a jamais éprouvées. Le contrôle `curl` ci-dessus vaut pour elles comme
    // pour un serveur à soi — c'est la seule chose qu'on puisse en dire sans l'avoir mesurée.
    log.info("Hébergement statique (GitHub Pages, Netlify…) : non éprouvé par le projet.");
    log.info("  Le contrôle ci-dessus s'y applique tel quel, et tranche avant tout déploiement.");

    // 11 — Bundle size budget (hard fail past the boot budget)
    const { checkBundleSize, checkPluginBundles } = require("./check-bundle-size.cjs");
    const sizeOk = checkBundleSize({ log });
    if (!sizeOk) globalOk = false;
    const pluginSizeOk = checkPluginBundles({ log });
    if (!pluginSizeOk) globalOk = false;

    // 12 — Tree-shaking gate (S5). Guards the composition boundary: a single static import from
    // a kernel module to `capabilities/*` silently welds that capability into every consumer's
    // bundle, and nothing else in the pipeline would notice — `npm run size` follows static
    // imports, so it would report the payload as correct. This reads the sourcemaps instead.
    const { checkExampleBundle } = require("./check-example-bundle.cjs");
    const treeShakeOk = checkExampleBundle({ log });
    if (!treeShakeOk) globalOk = false;

    // 13 — Published-package gate (S6). The gate above measures the SOURCE graph; this one measures
    // what npm actually ships. They diverged once already — badly enough that a consumer's `Config`
    // had no `.get()` — and nothing in this pipeline saw it, because the demo deploy consumes the
    // CDN bundle (built with a different treeshake config) and never the `exports` → dist/esm path.
    const { checkConsumerBundle } = require("./check-consumer-bundle.cjs");
    const consumerOk = checkConsumerBundle({ log });
    if (!consumerOk) globalOk = false;

    const { checkSideEffects } = require("./check-side-effects.cjs");
    if (!checkSideEffects()) globalOk = false;

    process.exit(globalOk ? 0 : 1);
}

// Run standalone (`node scripts/build-deploy.cjs`), never on require — `stripPluginScript`
// is exported below so `probe-gate-visibility.cjs` can mutation-test it in isolation
// without triggering an actual deploy build.
if (require.main === module) {
    main();
}

// `DEV_CONNECTOR_MARKERS` est exporté pour que `verify-app-template.cjs` tienne la présence de
// la paire dans `index.html` sans recopier les littéraux — un corpus, deux consommateurs (même
// doctrine que `boot-assets.cjs`). Une gate qui compare à sa propre copie des marqueurs
// resterait verte le jour où on les renomme ici, c'est-à-dire le jour où le retrait cesse.
module.exports = {
    stripPluginScript,
    resolvePluginMode,
    buildsAllVariants,
    DEV_CONNECTOR_MARKERS,
};
