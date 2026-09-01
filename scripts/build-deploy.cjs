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
 * coverage, not consolidated it. **The editor merge removed the premise, not the
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
 *   node scripts/build-deploy.cjs --plugins=local  # → deploy/deploy-local/ — WORKSTATION,
 *                                                  #   NEVER SHIPPED (see §The dev bootstrap)
 *   node scripts/build-deploy.cjs --full           # alias of --plugins=all
 *   node scripts/build-deploy.cjs --skip-build
 *
 * ## The dev bootstrap, and why a whole variant is dedicated to it
 *
 * `connector.local.js` carries a workstation JWT, with WRITE privilege,
 * against a host reachable from the Internet. It was copied AS-IS into
 * every variant, `deploy-core` and `deploy-full` included — i.e. into what
 * leaves for a client or a production server, and into their `.gz`/`.br`
 * on top of it.
 *
 * ⚠️ **The reasoning that authorised it only measured EXECUTION.»
 * `init.js` carried until 09/08/2026 a `localhost` guard keeping the
 * bootstrap from ACTIVATING on a deployed origin. That was true, and
 * without effect on the real risk: **a secret is READ, it does not
 * execute.» `curl https://<host>/connector.local.js` returned it in the
 * clear, guard or not. A gate that protects from one thing while believed
 * to protect from the other is worse than no gate.
 *
 * 🛑 **That guard no longer exists, and it must not be restored.» It was
 * removed with the stub on 09/08/2026, because it bounded the wrong
 * dimension; `init.js` says it in place ("A hostname guard would only
 * bound EXECUTION — a secret is READ, not run"). The containment is now
 * **structural**: the file does not enter a deliverable, so there is
 * nothing to deactivate in it.
 *
 * **The effective split, as of 17/08/2026**: **this file** prevents the
 * diffusion — a shippable variant receives **neither the file nor the
 * `<script>` tag loading it**, and *nothing* is written in its place;
 * **`verify-deploy-no-secrets.cjs`** (DNS-01…04) verifies it; **`APP-11`**
 * (`verify-app-template.cjs`) guards the marker pair. The real file only
 * lives in `deploy-local`, outside the default build and outside the deliverables.
 *
 * ⚠️ **This paragraph named `init.js` as a second rampart, and an "inert
 * stub" as what the deliverables received, until 17/08/2026** — two
 * mechanisms dead since 09/08, asserted in the present tense, on a
 * SECURITY property, and contradicted by this very file some fifteen
 * hundred lines below ("The stub no longer exists"). This check's reason
 * for being: false prose on a security device is not merely stale, it
 * **designates a rampart that is not there**.
 *
 * @version 3.0.0 — 5.5: 3 variants → 2 (deploy-core, deploy-full). `deploy-addpoi` gone
 *                  with the merged plugin; its reason for being — the
 *                  addpoi/editor mutual exclusivity — no longer exists.
 *                  ARCHI S8: 5 → 3, `storage` dropped, `addpoi-storage` renamed `addpoi`.
 *                  `deploy-local` added outside the deliverables: it alone carries the dev bootstrap.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

// The "what the first load requests" derivation lives in
// `lib/boot-assets.cjs` and not here, since the payload gate needed it to
// WEIGH the same set. A second extractor would have diverged, and whichever
// of the two goes unmaintained exits green measuring something else. One
// corpus, two consumers — `lib/tsdoc-examples.cjs`'s pattern.
const {
    APP_SHELL_DEPLOY_PATH,
    ROOT_CONFIG_DEPLOY_PATH,
    extractEagerChunks,
    deriveBootCriticalAssets,
} = require("./lib/boot-assets.cjs");

// Profile-data slimming at deployment time. The module lives apart because
// it is measurable alone: its two settings are FIGURES one wants to
// re-exercise without rebuilding a whole deploy.
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
// Dist directories are DERIVED from the workspace registry rather than
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
 * ⚠️ A hard-coded filename here is exactly what broke once: the plugin
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

/** Markers framing the workstation Connector bootstrap tag in `index.html`. */
const DEV_CONNECTOR_MARKERS = {
    start: "GEOLEAF-DEPLOY:DEV-CONNECTOR ─── START",
    end: "GEOLEAF-DEPLOY:DEV-CONNECTOR ─── END",
};

/**
 * Removes from `index.html` the tag that loads `connector.local.js`.
 *
 * ## Pourquoi ce retrait existe
 *
 * `connector.local.js` carries a WORKSTATION JWT with write privilege. It
 * has no business in what leaves for a client — neither the file nor a
 * reference to it. This function is what makes the absence STRUCTURAL
 * rather than disciplinary: a shippable variant never names the file, so
 * `verify-deploy-no-secrets.cjs` can require that it not exist, instead of
 * verifying a stub has the right shape.
 *
 * ⚠️ Until 09/08/2026 there was no tag: `init.js` made an UNCONDITIONAL
 * `import()` of the file. A mandatory import of an optional file forces the
 * file to exist everywhere — hence an inert stub, a `required` entry, an
 * exemption in `verify-app-template.cjs`, and the file at the deliverables'
 * root. Four pieces to work around one line; the tag removes all four.
 *
 * ## Par MARQUEUR et non par regex
 *
 * 🛑 Same motive as `stripGatedInitBlock`: this file's gating regexes are
 * `/gm` **without** `/s`, hence unable to cover a multi-line block — the
 * trap APP-04/05 watch on the HTML side. A cut between two markers by
 * `indexOf` has no flag and no escaping, and survives a reformat.
 *
 * ## What THROWS
 *
 * A missing marker is **always** a defect: `index.html` is the variants'
 * single source, the block is unconditional there. A vanished marker would
 * mean the removal removes nothing any more — it would exit green leaving
 * the tag, hence the file, in a deliverable. Exactly the false green this
 * repo hunts everywhere else.
 *
 * @param {string} html `index.html` content
 * @param {string} variantLabel for the error message, e.g. "deploy-core"
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
 * ## Pourquoi ce retrait existe
 *
 * `index.html` had always been patched per variant, `init.js` **never** —
 * and `init.js` is what registers the lazy slots. On a variant without the
 * bundle, the resolver was registered anyway: `isLazyAvailable()` returns
 * `true` ("registered AND not yet loaded" — it probes no file), the pill
 * drew the button, and the click went to an `import()` in 404. Three
 * painted, named, focusable, inert buttons on `deploy-core`, which the
 * accessibility audit validated without flinching.
 *
 * ## Why by INDEX and not regex, unlike `stripPluginScript`
 *
 * 🛑 This file's gating regexes are `/gm` **without** `/s`, which makes
 * them unable to cover a multi-line block — precisely the trap APP-04 and
 * APP-05 exist to watch on the HTML side. Rather than adding a sixth
 * fragile regex, we cut between two markers by `indexOf`. No flag, no
 * escaping, and a Prettier-reformatted block still cuts at the right place.
 *
 * ## What THROWS, and why it is stricter than `stripPluginScript`
 *
 * `stripPluginScript` tolerates the tag's absence ("not all gated ones
 * appear in all states of `index.html`"). Here a missing marker is
 * **always** a defect: `init.js` is the variants' single source, the block
 * is unconditional there, and a vanished marker means the removal removes
 * nothing any more — it would exit green cutting nothing, which is exactly
 * the false-green class this repo hunts everywhere else.
 *
 * @param {string} js `init.js` content
 * @param {string} pluginDirName gated plugin's directory name, e.g. "editor"
 * @param {string} variantLabel for the error message, e.g. "deploy-core"
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
                `ship. Restore the START/END comment pair around the block.`
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
 * 404s on the first click. That is the same symptom reached by another road: the fixed defect was about
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
// The plugin fleet is DISCOVERED, not listed: each plugin's package.json#geoleaf descriptor
// says how it ships (bundle name, code-split chunks, variant flag), and `discoverPlugins()`
// throws on a missing or malformed descriptor. Twelve `DIST_*` constants and one copy block
// per plugin lived here until 2026-08-18 — a hand-maintained list that had to be edited in a
// file the plugin does not own, and whose staleness would not fail: it would silently stop
// matching. Adding a plugin is now: write its descriptor, and this file never changes.
const { discoverPlugins } = require("./lib/discover-plugins.cjs");
// ⚠️ LAZY, and it has to be: this module is `require()`d by two instruments that never build —
// the ci-parity witness for its exemption, and the gate-visibility probe (which requires it
// WHILE a descriptor-less probe package is planted in the workspace). A module-scope
// discovery call would make the module unrequirable at exactly those moments — measured:
// PARITY-05 red and one probe assertion red, both from the same top-level call. Discovery
// runs when a build actually asks for the fleet, memoized for the run.
let _fleet = null;
function pluginFleet() {
    if (_fleet === null) _fleet = discoverPlugins();
    return _fleet;
}
// taxonomy + feature-info reclassified into @geoleaf/core (SR0) — bundled inside geoleaf.esm.js, no separate copy.
// cog + editor ship only in the `full` variant — a PACKAGING decision (bundle weight:
// cog alone carries geotiff.js), not a property of the plugins themselves. Which variant
// sets which flag stays in the variant matrix below; the plugin only NAMES its flag, in
// its own descriptor.
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

// ⚠️ `ROOT_CONFIG_DEPLOY_PATH` and `APP_SHELL_DEPLOY_PATH` are imported
// from `lib/boot-assets.cjs` at the top of the file. They live there
// because they now have FOUR consumers and not three: step 6c writes them,
// step 9 requires them, the boot-critical derivation lists them, and
// `check-app-payload.cjs` weighs what they designate. The shell's key
// remains a contract between this file and `sw-core.js` — it does not
// adjust on one side only.

const SKIP_BUILD = process.argv.includes("--skip-build");

// 🗑️ `CONNECTOR_LOCAL_STUB` lived here from 30/07 to 09/08/2026 — an empty
// module emitted into every variant so that `init.js`, which imported
// `./connector.local.js` UNCONDITIONALLY, did not make the browser log a
// 404. It is removed with the cause: loading now goes through an
// `index.html` tag that `stripDevConnectorScript` removes from shippable
// variants. No more mandatory import, hence no more file to fill in.
// ⚠️ Do not restore it "for safety": a stub in a deliverable would again
// make "no bootstrap" and "a bootstrap we could not read"
// indistinguishable, and that indistinction is what let a token leave in
// `deploy-core` and `deploy-full`.

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
 * ⚠️ `"local"` is NOT one more mode in the same family: it is the only one
 * producing a **non-shippable** variant, and the only one copying the dev
 * bootstrap carrying the token. It must never be reached from
 * `BUILD_ALL_VARIANTS` — hence its place here, in an explicit mode that
 * must be typed, and nowhere in a CI script.
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
 * ⚠️ `"local"` is excluded from it, and that is not an oversight: the
 * workstation variant must never come out of a build not requested by
 * name. `buildsAllVariants("local") === false`.
 *
 * @param {"none"|"full"|"all"|"local"|null} mode A value from {@link resolvePluginMode}.
 * @returns {boolean} Whether every variant is built.
 */
function buildsAllVariants(mode) {
    return mode === null || mode === "all";
}

const BUILD_ALL_VARIANTS = buildsAllVariants(PLUGIN_MODE);
// `local` carries the SAME plugin set as `full` — it is the working
// deploy, it must be able to exercise the full cycle against the remote
// backend. Only the dev bootstrap distinguishes it, and
// `INCLUDE_DEV_CONNECTOR` below carries that difference, alone.
const GATED_MODE = PLUGIN_MODE === "full" || PLUGIN_MODE === "local";
// Storage ships in the only gated variant — that is precisely why the standalone `storage`
// variant was dropped at S8.
const INCLUDE_STORAGE = GATED_MODE;
const INCLUDE_COG = GATED_MODE;
const INCLUDE_EDITOR = GATED_MODE;
/**
 * ⚠️ THE ONLY FLAG THAT DECIDES WHETHER A SECRET ENTERS AN ARTEFACT. True
 * for `local` and nothing else. `deploy-core`, `deploy-full` and — by copy
 * — `deploy-coverage` receive **NOTHING**: neither the file, nor the tag
 * loading it, nor a substitute. And that, whether or not the real file
 * exists on the building workstation — a deliverable whose content varied
 * by build machine would be a defect on its own.
 *
 * ⚠️ **This sentence said "always receive the inert stub" until
 * 17/08/2026, and the stub was deleted on 09/08.» Do not reintroduce it
 * "for safety": it would again make "no bootstrap" and "a bootstrap we
 * could not read" indistinguishable — the exact motive of its removal,
 * written higher in this file.
 */
const INCLUDE_DEV_CONNECTOR = PLUGIN_MODE === "local";
/**
 * Backend origin to write into a SHIPPABLE variant's profiles. Empty by
 * default, and that is the point: without an explicit value, the bindings
 * to the PROOF backend are removed from what leaves for a client (see
 * `lib/dev-backend.cjs`).
 *
 * ⚠️ **Never make this default depend on a file present on the building
 * machine.» The temptation is to fill the origin "if the dev bootstrap
 * exists" — that would be a deliverable whose CONTENT varies by who runs
 * the build, i.e. exactly the defect `connector.local.js` cost in July
 * (green for whoever had it, red in CI, 8 specs).
 *
 * Usage — exercising the full offline cycle on `deploy-full`:
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
 * Short content fingerprint of a file — `Date.now()`'s replacement.
 *
 * 🛑 **A build timestamp does not identify a content, it identifies a
 * BUILD.» Cache-busting carried `?v=<Date.now()>`: at every deployment,
 * the ESM entry and the plugin bundles changed URL — hence were
 * re-downloaded whole — while byte-for-byte identical. Measured before the
 * fix: ~101 KB gz (`deploy-full`) / ~71 KB (`deploy-core`) re-requested
 * for nothing at every release.
 *
 * A content fingerprint inverts the property: the URL only changes IF the
 * file changes. It is also what makes the build deterministic — two builds
 * of the same source produce exactly the same deploy, which
 * `check-build-determinism.cjs --deploy` verifies.
 *
 * ⚠️ Truncated to 8 hex chars, like `gen-api-surface.cjs`: it is a
 * cache-buster, not an integrity guarantee. A collision would change the
 * content without changing the URL, which is the risk a `?v=` accepts by
 * nature — 32 bits suffice for a handful of assets.
 *
 * @param {string} absPath Absolute path of the file to fingerprint.
 * @returns {string} 8 hexadecimal characters.
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
 * ⚠️ The filter exists because this `copyDir` was the deploy's biggest
 * sourcemap carrier, and the most discreet: `dist/chunks/` was copied AS A
 * BLOCK, so its 5 `.map` entered with no script line naming them. The
 * sprint's preflight had counted 4 sourcemaps per variant by listing
 * `dist/*.map` — non-recursive —, and there were 9. The corollary "the
 * preflight can carry the blindness it measures", committed twice in a row
 * on the same defect: the original survey was also a too-short `ls`.
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
 * The deploy ships NO sourcemap. Arbitrated on 08/08/2026 with Mattieu.
 *
 * Measured before the fix: **9 `.map` files per variant, 1,309 KB**
 * (3,435 KB on the instrumented variant), i.e. ≈ 5.9 MB over the three —
 * including `geoleaf.esm.js.map` (313 KB) and `geoleaf-main.min.css.map`
 * (294 KB), which expose the ENTIRETY of the core's sources.
 *
 * The decisive motive is not the weight: it is that the rule was **already
 * written in this file** and not applied to our own code. The MapLibre
 * copy deliberately refuses its sourcemap, invoking "sourcemaps exposed in
 * production", and refers by name to this arbitration to settle the rest.
 * The public repo was moreover born from a single commit — the workshop
 * history, itself, carries a real secret.
 *
 * ⚠️ This predicate is the script's ONLY definition of "this is a
 * sourcemap". The copy sites all refer to it, so a future `.map` artefact
 * does not depend on having thought of listing it somewhere.
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

// ── Profile-data slimming ─────────────────────
//
// The first screen's GeoJSON weigh 904 KB gz out of ~1,174: 77% of what
// the page loads. These two numbers are the ONLY settings, and they are
// measured, not chosen:
//
//   • 5 decimals ≈ **1.1 m on the ground** — three orders of magnitude
//     below the pixel at any shipped zoom, hence strictly invisible. The
//     source data carries up to 15 decimals, i.e. nanometre scale: that
//     waste is what weighs, and it returns **26.9%** on its own, without
//     removing a single vertex.
//   • **No geometry simplification** — `GEOJSON_TOLERANCE_DEG` is 0, and
//     that zero is a measured DECISION, not a forgotten setting. See just below.
//
// 🛑 **DOUGLAS-PEUCKER WAS IMPLEMENTED, MEASURED, THEN DISARMED.» The code
// still lives in `lib/geojson-slim.cjs` and re-arms by raising this
// constant; what follows is the record that led to renouncing, so the path
// is not redone from memory:
//
//   ‣ At 11 m tolerance, DP only returns **24.8 KB gz of the 240.8 saved —
//     10%**. The other 216 come from rounding alone.
//   ‣ And RDP **saturates its tolerance**: over the 646 paths effectively
//     simplified, median deviation **7.2 m**, p99 **11.09 m**, max
//     **11.1 m** against a bound of 11.1. The threshold is not a rare
//     worst case, it is the usual regime.
//   ‣ 11 m are ~0.3 px at zoom 12 but **~21 px at zoom 18**, reachable
//     since the basemaps go up to 17-20. On a protected-area boundary
//     compared against imagery, it shows.
//
//   ⇒ DP carried **10% of the gain and 100% of the risk.» Removed.
//
// ⚠️ **If it is ever re-armed, do not raise the tolerance without changing
// tools**: the simplification is per geometry, without shared topology, so
// two adjoining polygons can see their common boundary diverge and open a
// slit. It would take a TOPOLOGICAL simplifier (`mapshaper -simplify`),
// not a bigger number here.
//
// 🛑 Finally, the "−60 to −80%" the plan announced was reachable at NO
// reasonable tolerance: measured on these files, only −52.5% at 56 m. It
// was the algorithm's usual expectation on raw data, not a measure on these.
const GEOJSON_DECIMALS = 5;
const GEOJSON_TOLERANCE_DEG = 0;

/**
 * Slims in place the `.geojson` of a profile ALREADY COPIED into the variant.
 *
 * ⚠️ Operates on the COPY, never on `profiles/` — the source stays the
 * reference data, at full precision, and a regretted tolerance is fixed by
 * rebuilding.
 *
 * No layer list: all the profile's `.geojson` go through. A table naming
 * the three heavy layers would have diverged at the first layer added, and
 * gone quiet doing so — the failure mode this repo measures everywhere else.
 *
 * @param {string} profileDest The profile's directory in `outDir`.
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
    if (files.length === 0) return; // profile without local data — legitimate (remote origins)

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
            // An unreadable data file must STOP the build. Copying it as-is
            // would produce a deploy with a silently empty layer — and
            // precisely that kind of silence is what is being hunted.
            log.err(
                `profiles/${profileId}/ — ${path.relative(profileDest, file)} is not valid ` +
                    `GeoJSON: ${err instanceof Error ? err.message : String(err)}`
            );
            process.exit(1);
        }
    }
    // The count is derived from what was processed, never hand-written.
    const pct = before > 0 ? ((1 - after / before) * 100).toFixed(1) : "0.0";
    log.ok(
        `profiles/${profileId}/ — ${files.length} geojson allégés : ` +
            `${(before / 1024 / 1024).toFixed(2)} → ${(after / 1024 / 1024).toFixed(2)} Mio bruts ` +
            `(-${pct} %), ${vBefore.toLocaleString("fr-FR")} → ${vAfter.toLocaleString("fr-FR")} sommets`
    );
}

// ── Pre-compression of the deployed artefacts ──────────
//
// Measured at preflight: `find deploy -name "*.gz" -o -name "*.br"`
// returned EMPTY. Compression thus depended entirely on the server, on the
// fly, at every request — and without it the raw bytes are what leaves.
//
// 🛑 **AND AN ARTEFACT NOBODY SERVES SERVES NOTHING.»
// `docker/nginx.dev.conf` carried neither `gzip_static` nor
// `brotli_static`: producing the files without wiring the server would
// have let this task exit GREEN having changed nothing for the user —
// exactly the "guard never seen red" profile this repo hunts. The
// `gzip_static on;` is set in the same batch, and the verification is a
// real request:
//
//     curl -H 'Accept-Encoding: gzip' -sI https://demo.full.geoleaf.local.test/dist/geoleaf.esm.js
//     → Content-Encoding: gzip, and a Content-Length equal to the on-disk .gz's
//
// ⚠️ **The `.br` is produced but NOT SERVED LOCALLY.» `nginx:alpine` does
// not embark `ngx_brotli` (third-party module, to compile). It is emitted
// for the production server, and that fact is written here rather than
// silenced: believing exercised what is not is the fossilising failure
// mode. Brotli typically returns 15-20% more than gzip on text.
//
// Threshold: below it, the header and decompression cost exceed the gain,
// and a `.gz` bigger than its original is a trap `gzip_static` would serve anyway.
const PRECOMPRESS_MIN_BYTES = 1024;
// ⚠️ `.mjs` is listed as well as `.js`, and its absence would have been
// INVISIBLE. Since MapLibre 6, the vendored engine's ~273 KB gz are in
// `.mjs` files: without this entry they left UNCOMPRESSED, i.e. ~1.06 MB
// raw on the wire. And nothing would have said so — `check-app-payload`
// gzips in memory (`gzipSize()`), it never reads the disk's `.gz`, so it
// would have kept announcing ~289 KB gz while nginx served 1,060.
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
 * Emits a `.gz` and a `.br` beside each compressible artefact of a variant.
 *
 * The extension allowlist sets aside **three** classes, for three distinct
 * motives — and enumerating them all is what keeps a good-faith reader
 * from widening it:
 *
 *   1. **Already-compressed binaries** (PNG, WebP, tiles) — recompressing
 *      them would cost disk for a nil or negative gain.
 *   2. 🛑 **Formats served by HTTP Range requests — `.fgb`.» DO NOT ADD.
 *      `gzip_static on;` is declared at `http` level in
 *      `docker/nginx.dev.conf`, so it would apply to all vhosts: an
 *      `.fgb.gz` set beside would be served with `Content-Encoding: gzip`,
 *      and FlatGeobuf's bbox-mode Ranges would bear on the COMPRESSED
 *      bytes (`fgb-bbox-filter.ts`, "it handles Range requests
 *      internally"). The risk is LATENT today — no shipped profile sets
 *      `data.bbox`, so `fgb-loader.ts` does a full-file `fetch()` the
 *      browser transparently decompresses — and adding it would arm it for
 *      the first profile that activates bbox.
 *   3. **Artefacts the browser never requests** — `.qml`, QGIS styles that
 *      travel in the profiles' block copy. Compressing them buys not one
 *      payload byte.
 *
 * ⚠️ **Do not invert into a denylist.» A denylist would make `.fgb`
 * compressible by default, i.e. exactly the defect motive 2 forbids. This
 * comment only named motive 1 until 08/08/2026: an allowlist silent on two
 * of its three reasons gets widened by the first reader who believes it
 * incomplete.
 *
 * A `.gz` bigger than its original is thrown away — `gzip_static` does not
 * compare sizes, it serves the `.gz` if it exists.
 *
 * @param {string} outDir The variant's directory.
 * @param {string} variantName For the log.
 * @returns {void}
 */
/**
 * Rereads a compressed artefact FROM DISK, decompresses it, and compares
 * byte for byte to the source. Errors out at the first deviation.
 *
 * 🛑 WHY REREAD THE DISK RATHER THAN VERIFY THE IN-MEMORY BUFFER.
 * Verifying `zlib.gunzipSync(g)` against `buf` only proves zlib's symmetry
 * — a property of the library, not of our deliverable. What leaves for the
 * client is the FILE: rereading `${p}.gz` additionally catches a truncated
 * write, a full disk, a path overwritten by a later step.
 *
 * 🛑 WHAT THIS REPAIRS. Each variant carries ~150 `.br` twins and as many
 * `.gz`. **Nothing exercised them**: the dev nginx cannot serve Brotli
 * (`nginx:alpine` does not embark `ngx_brotli`), the CI does not serve
 * them either, and no gate opened them. The first server to serve them
 * would have been a client's. ⚠️ And the original instruction suggested
 * taking inspiration from a verification that would exist "already for the
 * `.gz`": **there was none either** — the model to imitate is this one.
 *
 * ✅ The verdict is rendered **without a server**: decompressing is a
 * computation, serving Brotli in CI would be out of proportion with what
 * we seek to know.
 *
 * @param {string} cheminArtefact Path of the `.gz` or `.br` just written.
 * @param {Buffer} source The original content, as it was compressed.
 * @param {(b: Buffer) => Buffer} decompresser `gunzipSync` or `brotliDecompressSync`.
 * @param {string} variantName Variant name, for the message.
 * @returns {void}
 */
function verifierArtefactCompresse(cheminArtefact, source, decompresser, variantName) {
    const zlib = require("node:zlib");
    let rendu;
    try {
        rendu = decompresser(fs.readFileSync(cheminArtefact));
    } catch (e) {
        log.err(
            `${variantName} — artefact compressé ILLISIBLE : ${path.relative(ROOT, cheminArtefact)}\n` +
                `  ${e && e.message ? e.message : e}\n` +
                `  Il serait parti chez un client tel quel : aucun serveur de ce dépôt ne le sert, ` +
                `donc rien d'autre ne l'aurait ouvert.`
        );
        process.exit(1);
    }
    // ⚠️ WHAT THIS CHECK DOES NOT SEE, measured on 19/08/2026 by mutating
    // it: bytes APPENDED at the TAIL of a brotli stream are silently
    // tolerated by the decoder, which stops at the end-of-stream mark. An
    // artefact corrupted by appending — a copy interrupted then resumed, a
    // concatenating transfer — would thus pass here. An INTERNAL
    // corruption is well caught: the same mutation applied mid-stream
    // exits as "UNREADABLE", and the build stops. Saying it beats letting
    // total integrity be believed.
    if (rendu.length !== source.length || !rendu.equals(source)) {
        log.err(
            `${variantName} — artefact compressé DIVERGENT : ${path.relative(ROOT, cheminArtefact)}\n` +
                `  décompressé ${rendu.length} octets, source ${source.length} octets.\n` +
                `  Le fichier servi ne rendrait pas la source.`
        );
        process.exit(1);
    }
    void zlib; // the require above documents the dependency; the function receives its decompressor
}

function precompress(outDir, variantName) {
    const zlib = require("node:zlib");
    let files = 0;
    let raw = 0;
    let gz = 0;
    let br = 0;
    let verifies = 0;
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
            // ⚠️ The twin is only written IF smaller than the source — so
            // its absence is legitimate, and only what was really written is verified.
            if (g.length < buf.length) {
                fs.writeFileSync(`${p}.gz`, g);
                verifierArtefactCompresse(`${p}.gz`, buf, zlib.gunzipSync, variantName);
                verifies++;
                gz += g.length;
            } else {
                gz += buf.length;
            }
            if (b.length < buf.length) {
                fs.writeFileSync(`${p}.br`, b);
                verifierArtefactCompresse(`${p}.br`, buf, zlib.brotliDecompressSync, variantName);
                verifies++;
                br += b.length;
            } else {
                br += buf.length;
            }
        }
    };
    if (!fs.existsSync(outDir)) return;
    walk(outDir);
    if (files === 0) {
        // Anti-empty-gate: a variant built without a single compressible
        // file signals an allowlist gone blind, not a legitimate deploy.
        log.err(`${variantName} — precompress found 0 compressible file. The allowlist is blind.`);
        process.exit(1);
    }
    if (verifies === 0) {
        // Anti-empty-gate, second direction: `files > 0` can hold while NO
        // twin was written (all bigger than their source). The integrity
        // check would then have verified nothing, and its silence would be
        // indistinguishable from a success.
        log.err(
            `${variantName} — ${files} fichier(s) compressible(s), mais 0 artefact écrit : ` +
                `le contrôle d'intégrité n'a rien pu vérifier.`
        );
        process.exit(1);
    }
    const pct = (n) => ((1 - n / raw) * 100).toFixed(1);
    log.ok(
        `${variantName} — ${files} fichiers pré-compressés : ` +
            `${(raw / 1024 / 1024).toFixed(1)} Mio bruts → ${(gz / 1024 / 1024).toFixed(1)} gz (-${pct(gz)} %) ` +
            `/ ${(br / 1024 / 1024).toFixed(1)} br (-${pct(br)} %, non servi en local) ` +
            `· ${verifies} artefact(s) relu(s) et décompressé(s), 0 divergence`
    );
}

// ── Boot-critical derivation ─────────────────────────────────────────────
//
// ⚠️ The three extractors MOVED to `lib/boot-assets.cjs` —
// `extractEagerChunks`, `extractHtmlAssetRefs` and
// `deriveBootCriticalAssets`. They are imported at the top of this file.
// The move's motive is the payload gate: it needs EXACTLY the same set, to
// weigh it instead of injecting it. Copying the extractors would have
// produced two derivations of which the less maintained would have exited
// green measuring something else.
//
// `buildPreloadTags` stays here: it renders MARKUP, which is this script's
// trade and no other's.

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
              // Full bundle. ⚠️ **The ONLY variant carrying editing AND
              // `offline-ui`**, hence the only one where the full offline
              // cycle — POI capture, queue, replay — is exercisable. The
              // E2E specs that targeted `deploy-addpoi` for that exact
              // reason target this one since the merge: not a port change,
              // a change of carrying variant.
              {
                  name: "deploy-full",
                  includeStorage: true,
                  includeCog: true,
                  includeEditor: true,
                  // 🛑 HARDCODED FALSE, AND THAT IS THE POINT. `deploy-full`
                  // is a DELIVERABLE. No condition, no environment
                  // variable, no command-line flag must be able to put a
                  // token here: the only way to get one is to build
                  // `deploy-local`, which is not in this list.
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
    // addpoi→editor merge (2026-08-05); do not read them as current.
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
        // Name the variant in the bundle-copy errors (`throwMissingBundle`).
        // Same derivation as the `index.html` patch's `variantLabel` below —
        // both designate the same variant, at two steps of the same loop turn.
        const variantName = v.name || PLUGIN_MODE;
        if (v.name) {
            log.section(`📁 Variant: ${v.name}`);
            ensureDir(outDir);
        }

        // 3 — Copy dist artefacts → dist/
        log.section("📦 Copying dist artefacts → dist/");
        ensureDir(path.join(outDir, "dist"));

        // `geoleaf.esm.js.map` (313 KB) and `geoleaf-main.min.css.map`
        // (294 KB) are REMOVED from this list: between them they carried
        // the entirety of the core's sources into the deploy. This block,
        // and not the plugin copies, is what the plan's wording did not
        // count — it announced "only geocoding and table".
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

        // 3a — ESM chunks (code splitting produces dist/chunks/)
        const chunksDir = path.join(DIST, "chunks");
        if (fs.existsSync(chunksDir)) {
            // `(n) => !isSourceMap(n)`: without this filter, this block
            // copyDir was the deploy's BIGGEST sourcemap carrier (5 of the
            // 9) and the most discreet, no script line naming them.
            copyDir(chunksDir, path.join(outDir, "dist", "chunks"), (n) => !isSourceMap(n));
            const nChunks = countFiles(path.join(outDir, "dist", "chunks"));
            log.ok(`dist/chunks/ — ${nChunks} files copied (ESM code splitting)`);
        } else {
            log.warn("dist/chunks/ not found — ESM code splitting not active?");
        }

        // 3b — Plugin bundles, driven by the DISCOVERED fleet (package.json#geoleaf).
        //
        // One loop replaces twelve hand-written copy blocks. What each descriptor decides:
        //   - `includeFlag: null` ships in every variant; otherwise the variant matrix's
        //     flag of that name opts it in (deploy-core sets all three to false).
        //   - `lazyChunks: true` also copies the code-split side chunks
        //     (`geoleaf-<name>.<hash>.js`) that the entry imports on first use — without
        //     them the dynamic import 404s the first time the feature runs (measured on
        //     realtime-layer's GTFS-RT decoder, print's jsPDF, editor's terra-draw).
        //   - A missing bundle THROWS. It used to log.warn: a deploy missing its plugins
        //     shipped with exit code 0, and step 2 of this script only rebuilds 2 of the
        //     12 bundles it copies — the other 10 can legitimately be absent after a
        //     clean, and that absence must stop the build, not decorate its log.
        //
        // taxonomy + feature-info are NOT in this loop and never will be: both were
        // reclassified into @geoleaf/core (SR0) and ship inside dist/geoleaf.esm.js.
        // ⚠️ Sourcemaps are deliberately NOT copied for any plugin.
        for (const plugin of pluginFleet()) {
            if (plugin.includeFlag && !v[plugin.includeFlag]) continue;
            const src = path.join(plugin.dist, plugin.bundle);
            if (!fs.existsSync(src)) {
                throwMissingBundle(plugin.bundle, variantName);
            }
            fs.copyFileSync(src, path.join(outDir, "dist", plugin.bundle));
            log.ok(`dist/${plugin.bundle}  (${sizeKB(src)})`);
            if (plugin.lazyChunks) {
                // Side chunks share the bundle's stem: `geoleaf-<name>.<hash>.js`.
                const stem = plugin.bundle.replace(/\.plugin\.js$/, "");
                const chunkRe = new RegExp(
                    `^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\..+\\.js$`
                );
                for (const f of fs.readdirSync(plugin.dist)) {
                    if (chunkRe.test(f) && f !== plugin.bundle) {
                        fs.copyFileSync(path.join(plugin.dist, f), path.join(outDir, "dist", f));
                        log.ok(`dist/${f}  (${sizeKB(path.join(plugin.dist, f))})  [lazy chunk]`);
                    }
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
                // ⚠️ `CACHE_VERSION` IS NO LONGER PATCHED HERE. It was, with
                // a `Date.now()`, at a moment when neither `index.html` nor
                // the pre-cached list existed yet — a cache version that
                // could thus say nothing about the content it versions. It
                // is now derived at step 8b, where the assets are known.
                // See the derived `CACHE_VERSION` block below.
                log.ok(`sw-core.js at deploy root  (${sizeKB(swCoreSrc)})`);
            } else {
                log.warn("dist/sw-core.js not found — core SW not built?");
            }
        }

        // 3e — GeoJSON Web Worker (both modes)
        // Must live in dist/ so _detectScriptBase() resolves it relative to geoleaf.esm.js
        const workerSrc = path.join(DIST, "geojson-worker.js");
        if (fs.existsSync(workerSrc)) {
            fs.copyFileSync(workerSrc, path.join(outDir, "dist", "geojson-worker.js"));
            log.ok(`dist/geojson-worker.js  (${sizeKB(workerSrc)})`);
        } else {
            log.warn("dist/geojson-worker.js not found — worker not built?");
        }

        // 4 — (removed, T1b) The only CSS ever copied here was the pair of demo theme
        //     variants that `demo.extensions.js` swapped at runtime through an injected
        //     <link>. The demo layer is gone, and with it the sole reason for a `css/`
        //     directory in a deployment: the shipped stylesheet is `dist/geoleaf-main.min.css`.
        //     (`geoleaf-main.css` had already been dropped in S12 — it is the SOURCE
        //     aggregator, and none of its @import targets are deployed.)

        // 4c — Copy MapLibre → vendor/maplibre-gl/
        //
        // 🛑 RESOLVED BY `require.resolve`, NEVER A HARDCODED PATH. Three
        // version declarations coexisted and only coincided by discipline:
        // the core's `peerDependencies` `^5.0.0`, the version really
        // installed in `node_modules`, and a hand-written `@5.21.0` in the
        // document's URL. Nothing watched their agreement — a peerDep bump
        // left the HTML serving the old version with no gate turning red.
        // Resolving from `node_modules` makes the gap structurally
        // impossible: there is only one version left, the installed one.
        //
        // ⚠️ FOUR files, by name — above all not `copyDir` on `dist/`. That
        // directory also carries the sourcemaps (`maplibre-gl.mjs.map`
        // ~2.5 MB, and as much for the shared chunk) and the `-dev` builds;
        // copying them would inflate the deploy by a factor exceeding
        // everything the slimming gained. The sourcemaps are deliberately
        // not copied: they are worth several times the bundle, for devtools
        // comfort on a third-party dependency. The file's
        // `sourceMappingURL` thus 404s in devtools, and that is a choice
        // (the production-sourcemaps arbitration covers the subject).
        //
        // ⚠️ `build-deploy.cjs` had never read `node_modules` — all its
        // other `copyFileSync` source a workspace `dist/`. A new class for
        // this script, and the motive is unique: MapLibre is the only
        // dependency the DOCUMENT loads itself.
        //
        // ── MapLibre 6: this block changed nature, not only file names ──
        //
        // v6 is ESM-only. `maplibre-gl.js` and `maplibre-gl-csp.js` ARE NO
        // LONGER PUBLISHED; the entry is `maplibre-gl.mjs`, which imports
        // `maplibre-gl-shared.mjs` by RELATIVE path and instantiates its
        // worker with `new Worker(new URL("./maplibre-gl-worker.mjs",
        // import.meta.url), {type:"module"})`. Three consequences, all structural:
        //
        //   ① The directory must stay FLAT AND COMPLETE — the three modules
        //     look for each other side by side. A vendor missing a single
        //     one does not raise at build: it fails at first load, in the browser.
        //   ② The `maplibregl` global no longer exists. The ~20 files of
        //     `adapters/maplibre/` and three plugins nonetheless read it.
        //     `global.mjs`, written just below, reposes it in two lines —
        //     which is what lets the migration touch none of them.
        //   ③ `require.resolve("maplibre-gl/package.json")` now THROWS: the
        //     v6 `exports` map only exposes `.` and `./dist/*`, not
        //     `./package.json`. The manifest thus derives from the resolved
        //     module's path, no longer from a package resolution.
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
            // A SINGLE package resolution, on a LITERAL specifier — the
            // other files are its neighbours by construction, and the
            // anti-blindness below verifies it.
            //
            // `paths: [ROOT]` — resolve from the repo root, not from
            // `scripts/`, so the `node_modules` climb starts where the
            // install did.
            // ⚠️ `maplibre-gl` is declared as a ROOT devDependency (and not
            // the core's, which only has it in `peerDependencies`)
            // precisely because THIS script, at the root, consumes it to
            // build the deploy.
            // 🛑 AND THE SPECIFIER MUST STAY LITERAL. An interpolation
            // (`maplibre-gl/dist/${x}`) is invisible to static analysis:
            // knip flagged the devDependency as unused the very second this
            // block stopped carrying a single one in the clear — and
            // removing it would have broken the build at the first fresh clone.
            const mlEntry = require.resolve("maplibre-gl/dist/maplibre-gl.mjs", { paths: [ROOT] });
            const mlDistDir = path.dirname(mlEntry);
            for (const asset of ML_ASSETS) {
                fs.copyFileSync(path.join(mlDistDir, asset), path.join(vendorDir, asset));
            }

            // ⚠️ ANTI-BLINDNESS — the list above is hand-written, so it
            // expires silently. If a future version split off a fourth
            // production module, it would not be copied, the vendor would
            // be incomplete, and NOTHING would say so: the build would exit
            // green and the map would break at load. We therefore throw as
            // soon as a production `.mjs` of the package is not in
            // `ML_ASSETS`. The `-dev` are set aside — the unminified
            // builds, never served.
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

            // The shim that reposes the global. EMITTED HERE, not
            // maintained as a source file: its content is entirely
            // determined by the name of the entry just copied, so deriving
            // it forbids their divergence. Byte-deterministic (BUILD-DET
            // gate): no date, no hash, no iteration order.
            fs.writeFileSync(
                path.join(vendorDir, "global.mjs"),
                [
                    "// Generated by scripts/build-deploy.cjs — do not edit.",
                    "// MapLibre 6 is ESM-only and no longer publishes a global; GeoLeaf reads it on",
                    "// `globalThis.maplibregl`. These two lines are what links the two.",
                    'import * as maplibregl from "./maplibre-gl.mjs";',
                    "globalThis.maplibregl = maplibregl;",
                    "",
                ].join("\n"),
                "utf8"
            );

            // ⚠️ NOT `require.resolve("maplibre-gl/package.json")` — see ③
            // above, the v6 `exports` map does not expose it and the
            // resolution THROWS. The manifest is the neighbour of the
            // already-resolved `dist/` directory.
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

        // CONTENT-based cache-busting — see `contentTag`. An asset's `?v=`
        // only changes if that asset changes, so a deployment without
        // modification re-downloads NOTHING. It was the inverse: a single
        // shared `Date.now()` busted everything, every time, at identical
        // content.
        //
        // ⚠️ Fingerprint PER FILE, not one for all. With a shared
        // fingerprint, touching a single plugin would re-download the entry
        // and the eleven others — a timestamp would have been replaced by a
        // hash with nothing gained.
        //
        // ⚠️ If the file is not in `outDir` (a variant not embarking it),
        // the URL is left BARE rather than inventing a fingerprint:
        // `stripPluginScript` then removes the tag, and a ghost `?v=` key
        // in the pre-cache would be a permanent miss (`cache.match` is
        // called without `ignoreSearch`).
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
        // hard-coded — see stripPluginScript()'s doc comment for why.
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
        // The WORKSTATION bootstrap. Removed everywhere except
        // `deploy-local`: that removal, and not an execution guard, is what
        // keeps a token from entering a deliverable.
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
        // ⚠️ IT IS PATCHED PER VARIANT SINCE 07/08/2026.
        // It was not, while `index.html` was: that exact gap is what left
        // three `editor` lazy slots registered on `deploy-core`, a variant
        // not embarking their bundle. See `stripGatedInitBlock`.
        const initSrc = path.join(APP, "init.js");
        if (fs.existsSync(initSrc)) {
            let initContent = fs.readFileSync(initSrc, "utf-8");
            if (!v.includeEditor) {
                initContent = stripGatedInitBlock(initContent, "editor", variantLabel);
                log.ok("init.js — gated block `editor` stripped (variant ships no editor bundle)");
            }
            // `cog` joined `editor` in `init.js` on 07/08/2026: its eager
            // `<script>` tag (99.8 KB gz, the heaviest plugin) became a
            // `registerLazy`. The per-variant removal must follow the move,
            // otherwise `deploy-core` registers a lazy resolver aiming at a
            // bundle it does not embark — that defect, identically.
            if (!v.includeCog) {
                initContent = stripGatedInitBlock(initContent, "cog", variantLabel);
                log.ok("init.js — gated block `cog` stripped (variant ships no cog bundle)");
            }
            fs.writeFileSync(path.join(outDir, "init.js"), initContent, "utf-8");
            log.ok("init.js copied");
        } else {
            log.warn(`${path.relative(ROOT, initSrc)} not found — skipped`);
        }

        // connector.local.js — WORKSTATION Connector bootstrap (JWT). Git-ignored at the source.
        //
        // 🛑 COPIED INTO A SINGLE VARIANT, AND ITS TAG REMOVED FROM THE
        // OTHERS. The two gestures go together: `stripDevConnectorScript`
        // has already removed from `index.html` the tag loading it, here
        // the file is not written. A shippable variant thus has neither the
        // file nor the least reference to it — which is what lets
        // `verify-deploy-no-secrets.cjs` require an ABSENCE rather than
        // verify a stub's shape.
        //
        // ## The history, because it explains two vanished mechanisms
        //
        // ① Until 30/07/2026 the file was only copied if it existed, and
        // `init.js` imported it UNCONDITIONALLY. On a workstation that had
        // it, all was green; elsewhere, the browser logged "Failed to load
        // resource: 404" — a console error no `try/catch` suppresses, since
        // it is not one in the JS sense. The `15-file-import` and
        // `16-flatgeobuf` suites were GREEN locally and RED in CI, 8 specs,
        // on the single gap of a file git does not show.
        //
        // ② The remedy then was an INERT STUB emitted everywhere, on the
        // rule "a deployment's shape must not depend on who builds it".
        // The rule is right, and it only spoke of the SHAPE: where the real
        // file existed, it was copied as-is — `geoleaf_editor` token
        // included, plus its `.gz`/`.br` — into `deploy-core` and
        // `deploy-full`, hence into what leaves for a client. Same shape
        // everywhere, not the same content, and the content is what
        // carried the secret.
        //
        // ③ The real defect was upstream of both: a MANDATORY import of an
        // OPTIONAL file. It forced the file to exist everywhere, hence the
        // stub, hence its `required` entry, hence a named exemption in
        // `verify-app-template.cjs`. Making the load conditional — a
        // variant-gated tag, as for the optional plugins — removes all
        // three at once. The stub no longer exists.
        //
        // ⚠️ Do not reintroduce a silent fallback here. The file's absence
        // is FATAL for `deploy-local` (see below) and moot for the others:
        // there is no third case, and an `else` writing "something" would
        // bring the stub back.
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
            // 🛑 FATAL, and the only place where this file's absence is a
            // defect. `deploy-local` exists ONLY for it: its tag is kept in
            // `index.html`, so without the file the browser would log
            // "Failed to load resource: 404" — a console error no
            // `try/catch` suppresses, since it is not one in the JS sense.
            // Exiting 0 here would produce a variant that lies about what it is.
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

                // ── Derived CACHE_VERSION ─────────────────────────────────────────
                //
                // 🛑 THE CACHE VERSION IS A FUNCTION OF WHAT IS IN THE
                // CACHE. It carried a `Date.now()`, which changed it at
                // EVERY build: `activate` purged the whole `geoleaf-v*`
                // family, and the install reconstituted an identical cache
                // by re-downloading everything. A no-change deployment thus
                // cost a full pre-cache — and that is what cancelled the
                // hashed `?v=`'s benefit above for any worker-controlled
                // client. **The two tasks are coupled: neither returns its
                // gain alone.**
                //
                // Derived from the LIST of pre-cached assets and their
                // content: two builds of the same source give the same
                // name, so `activate` purges nothing and the cache
                // survives; a changed asset gives a new name, so the purge
                // happens. Exactly the expected semantics, and it was not
                // reachable at the copy step — neither `index.html` nor
                // `bootAssets` existed yet.
                //
                // ⚠️ THE `geoleaf-v` PREFIX IS LOAD-BEARING: `activate`
                // filters the caches to purge by
                // `cacheName.startsWith("geoleaf-v")`. A naming scheme that
                // loses it makes the purge stop silently, and old caches
                // accumulate.
                // ⚠️ Does NOT touch `CACHE_TILES`, deliberately unversioned —
                // it survives precisely because its name carries no version.
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

        // 8b — purge of orphan `sourceMappingURL`s, then GUARD.
        //
        // Removing the `.map` without touching the bundles would leave each
        // file pointing at an absent target: a devtools 404 at every
        // opening. Already the case for MapLibre, owned but never repaired
        // — this pass settles it too.
        //
        // 🛑 THE ORDER COUNTS AND IS NOT INTERCHANGEABLE. It runs BEFORE
        // `precompress()` (step 12), otherwise the `.gz`/`.br` would carry
        // the line the raw file no longer has — two diverging
        // representations of the same artefact, and the compressed one is
        // what nginx serves (`gzip_static on`). The defect would thus be
        // invisible reading the deploy.
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
                    // `//# sourceMappingURL=…` (JS) and `/*# sourceMappingURL=… */` (CSS),
                    // at end of file, with or without a final newline.
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

            // The guard. It is NOT circular with what precedes: nothing
            // here deleted a `.map`, the copy sites filtered them upstream.
            // It thus fails for real if a future copy block reintroduces
            // one — exactly the mode by which `dist/chunks/`'s five `.map`
            // had entered unnamed.
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
                    // `v.name` is EMPTY on the single-variant path when no
                    // folder name is derived (`SINGLE_VARIANT_NAME` only
                    // holds for `--plugins=full` and `--plugins=local`;
                    // `none` deploys at the root), and a message starting
                    // with "build-deploy:  — " does not say where to look.
                    // The directory is always filled in.
                    `build-deploy: ${v.name || path.relative(ROOT, outDir)} — ` +
                        `${leakedMaps.length} sourcemap(s) dans le ` +
                        `déployé : ${leakedMaps.join(", ")}. Le déployé n'en expédie AUCUNE ` +
                        `: elles exposent l'intégralité des sources en production. ` +
                        `Filtrer la copie avec \`isSourceMap\`, ne pas supprimer cette garde.`
                );
            }
            log.ok(`aucune sourcemap dans le déployé`);
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
            // 🛑 `connector.local.js` IS NO LONGER HERE, AND ITS REMOVAL IS
            // THE FIX. It appeared from 30/07 to 09/08/2026, on the ground
            // that an absence does not show where it is produced — it 404s
            // in the browser, on `init.js`'s unconditional import. The
            // ground was good; the unconditional import was not. Since a
            // gated tag loads it, the file has no reason to exist in a
            // deliverable, and REQUIRING it would bring it back. Its
            // absence there is now the invariant, held by
            // `verify-deploy-no-secrets.cjs` (DNS-02).
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
        // ⚠️ This list's four `.map` entries are REMOVED because they had
        // become UNREACHABLE: step 8b's guard throws on any sourcemap
        // whatsoever, so none can reach here any more. Keeping them would
        // have done exactly what is corrected elsewhere — a list describing
        // a state the code can no longer produce, which a reader still
        // believes active.
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

        // 9a bis — TILE DOWNLOAD is cut in what gets exposed (12/08/2026).
        //
        // 🛑 The motive is NOT the proof backend, and that is why this
        // treatment has its own function rather than a line in
        // `dev-backend.cjs`: the demo profile's tiles come from **third
        // parties** — `server.arcgisonline.com`, `opentopomap.org`,
        // `basemaps.cartocdn.com` —, whose terms of use typically forbid
        // bulk scraping. A "download offline" button on a public page is
        // exactly the gesture they ban, and the sanction falls on the
        // emitting origin.
        //
        // ⚠️ This veto only cuts the explicit download. The service
        // worker's cache stays active, and it must: it only writes
        // responses **already returned from the network** (`sw-core.js` —
        // "THE ONLY WRITER of CACHE_TILES"), so it REDUCES traffic to
        // those third parties instead of increasing it. Confusing it with
        // scraping would remove a protection believing one is being laid.
        //
        // 🖐 WHAT THIS DOES NOT PROTECT, and it must be said: a visitor
        // controls their browser. They can flip the flag back to `true` in
        // the JSON response, or call the API directly. This setting removes
        // the feature from the INTERFACE; it is not an access control. The
        // only real protection against scraping is on the side serving the
        // tiles (quota, referer, key) — no client configuration can replace it.
        //
        // ⚠️ RECURSIVE pass: the flag lives at two depths —
        // `.cache.enableTileCache` in `config/plugins/offline.json`, and
        // `.modules.offline.cache.enableTileCache` in
        // `profile-bundle.json`. Treating one without the other would leave
        // the second alive, and IT is what the loader reads — the same trap
        // as the bindings below.
        //
        // @param {any} node Root of the profile JSON (mutated in place).
        // @returns {number} Number of flags set to `false`.
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

        // 9a — The PROOF backend does not leave for a client.
        //
        // 🛑 Measured on 09/08/2026:
        // `profiles/tourism/.../sites_rosario_config.json` carried four
        // bindings to `https://qgis.geoleaf.dev` — the host mounted by
        // `docker-compose.dev.yml`, which resolves ONLY on the workstation
        // —, copied as-is into `deploy-core` and `deploy-full`. Display was
        // not at stake (the layer has a local `data.file`); what left dead
        // was the pull and the write.
        //
        // ⚠️ THE DISCRIMINANT IS `includeDevConnector`, THE SAME AS FOR THE
        // TOKEN, and it is not a convenience: the binding and the token are
        // two halves of one thing — one does not write to this backend
        // without the second. Separating them would produce a variant
        // naming a target it cannot reach.
        //
        // ⚠️ Pass ON THE DEPLOY, not on `profiles/`: the source stays the
        // dev profile, which is what it must be. It runs after the copy to
        // ALSO catch `profile-bundle.json`, the aggregate — and it is what
        // the loader reads.
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

        // 9b — The server contract leaves WITH the folder.
        //
        // 🛑 WHAT WE SHIP MUST SAY WHAT IT REQUIRES. On 09/08/2026, a
        // `deploy-full` copied as-is onto a production nginx server
        // rendered an infinite spinner: nginx's `mime.types` table only
        // knows `js`, the MapLibre engine's `.mjs` left as
        // `application/octet-stream`, and the browser refuses to execute a
        // module under that type.
        //
        // The repo KNEW — `docker/nginx.dev.conf` carries the directive
        // under "WITHOUT THIS LINE, NOTHING BOOTS", and admits in the same
        // breath: "⚠️ This constraint LIVES OUTSIDE THE REPO for the
        // integrator — no gate can see it at their place". Not a knowledge
        // hole then, but a DIFFUSION one: the recipe lived in a dev file
        // that does not leave with the folder, and the deliverable carried
        // no accompanying file.
        //
        // ⚠️ None of the three files is in `precompress()`'s allowlist —
        // they thus receive no `.gz`/`.br` twin, which is wanted: they are
        // read by a human, once, before anything is served.
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

        // 10 — Pre-compression. LAST, and not a scheduling detail:
        // everything before rewrites files (markup patch, STATIC_ASSETS
        // injection, GeoJSON slimming, leaked-artefact removal).
        // Compressing before means shipping stale `.gz` that nginx would
        // serve IN PLACE of the original — a deploy silently serving the
        // next-to-last build.
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
    // 🛑 THIS BLOCK SAID "Serve via http" UNTIL 09/08/2026, AND IT WAS THE
    // LAST TEXT READ BEFORE A DEPLOYMENT. Two false statements, in both lines:
    //
    //   ① "via http" — the page declares `upgrade-insecure-requests`: on
    //      bare HTTP, the browser rewrites every sub-resource to https://
    //      and each fails. The advice described exactly the configuration
    //      that cannot work.
    //   ② nothing on the `.mjs` MIME type, the only requirement whose
    //      absence prevents boot. A `deploy-full` copied as-is onto nginx
    //      rendered an infinite spinner that day.
    //
    // The remedy is not lengthening this message — nobody reads a build on
    // screen twice — but REFERRING to the contract that leaves with the
    // folder. That is `SERVEUR.md`, emitted at step 9b into each shippable
    // variant and gated by `verify-deploy-server-contract.cjs`.
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
    // ⚠️ These two targets stay named, but WITHOUT a promise: the `.mjs`
    // MIME type configures differently there (Netlify: `_headers`; GitHub
    // Pages: nothing to configure at all), and the project has never
    // exercised them. The `curl` check above holds for them as for one's
    // own server — the only thing sayable without having measured it.
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

// `DEV_CONNECTOR_MARKERS` is exported so `verify-app-template.cjs` holds
// the pair's presence in `index.html` without copying the literals — one
// corpus, two consumers (same doctrine as `boot-assets.cjs`). A gate
// comparing to its own copy of the markers would stay green the day they
// are renamed here, i.e. the day the removal stops.
module.exports = {
    stripPluginScript,
    resolvePluginMode,
    buildsAllVariants,
    DEV_CONNECTOR_MARKERS,
};
