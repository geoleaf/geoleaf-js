#!/usr/bin/env node
/**
 * APP-TEMPLATE: the deployable application's HTML/JS contract (T2.6).
 *
 * ## Why this is a gate and not a Vitest suite
 *
 * These two assertions used to live in `packages/core/__tests__/bundle.test.js`
 * ("Demo bootstrap moderne"), where a test of the LIBRARY read a file of the
 * APPLICATION through `__dirname/../index.html` — the very coupling T2 removes.
 *
 * They did not follow the app into a suite of its own, deliberately. Giving
 * `apps/geoleaf-app` a `vitest.config.ts` plus a `test` script would pull it into
 * `unitScope()` and `rootProjectScope()` (`lib/test-scope.cjs`), which then needs a
 * `maxWorkers` matching the other 18 configs, a `@geoleaf/build-config` devDependency,
 * a turbo `test` task depending on a `build` the app does not have, and a knip entry for
 * the new devDeps. Six couplings for two string checks. A root-level test file was no
 * better: the root config declares only per-package `projects`, so nothing would run it.
 *
 * ## What it asserts, and why it is worth more than the two tests it replaces
 *
 * MOD-01/02 restate the original two checks. The other three close holes that nothing
 * guarded, all of the same shape: `build-deploy.cjs` patches `index.html` with regexes
 * anchored per line (`/gm`, NO `/s` flag), so a reformat that wraps one of these
 * constructs onto a second line makes the patch silently miss. The deploy would ship a
 * stale plugin list or an orphaned comment, and exit 0.
 *
 *   APP-01  index.html loads the ESM bundle           (was bundle.test.js:148-152)
 *   APP-02  init.js calls GeoLeaf.boot()              (was bundle.test.js:154-158)
 *   APP-03  index.html still uses `src/assets/icons/` — else the `→ icons/` rewrite at
 *           build-deploy.cjs:818 is a dead regex and the deployed <link rel="icon">
 *           point outside icons/
 *   APP-04  the `<!-- Optional plugins … -->` comment is on ONE line — removed by
 *           build-deploy.cjs:857-860, `/gm` without `/s`
 *   APP-05  each variant-gated plugin <script> (offline-ui, cog, editor) is on ONE
 *           line — same reason, the four regexes are `/gm` without `/s`
 *   APP-08  the `<!-- __GEOLEAF_MODULEPRELOAD__ -->` marker exists and is on ONE line —
 *           build-deploy.cjs (step 7a) substitutes it with one `modulepreload` per chunk the
 *           entry imports statically, using an `/m` regex without `/s`. A marker that stopped
 *           matching would ship a deploy that looks fine and has lost its preload block.
 *   APP-06  every module `init.js` imports EAGERLY resolves on a fresh clone — git-tracked,
 *           or covered by a named exemption whose witness proves something still guarantees
 *           the file lands in the deploy. Mesuré le 30/07/2026 : `connector.local.js` était
 *           git-ignoré et importé au boot, donc présent sur le poste de l'auteur et absent
 *           partout ailleurs — 8 specs E2E vertes en local, rouges en CI, pendant des mois.
 *   APP-09  la politique CSP d'index.html est COMPARÉE à une politique attendue, dans les
 *           deux sens, plus une liste de jetons interdits que la constante ne peut pas lever
 *           (B-164). Avant elle, `'unsafe-eval'` injecté sortait VERT.
 *
 * ## Un invariant qui ne porte pas sur le workspace de l'app
 *
 *   NGINX-01 chaque bloc `server` de `docker/nginx.dev.conf` pose `X-Content-Type-Options`
 *           (S6.1). Il est ici, et pas dans un script neuf, pour une raison de PARITÉ : tout
 *           nouveau script doit être câblé dans `ci-local.cjs` ET dans `ci.yml`, et c'est
 *           précisément là que la couverture des deux côtés se perd. Le contrat de sécurité de
 *           l'application couvre ce qu'elle déclare (CSP) et ce que son serveur promet
 *           (en-têtes) : les séparer aurait fait garder la moitié seulement, ce qui est le
 *           défaut même que B-136 avait laissé ouvert.
 *
 * Paths come from the workspace registry, never as a literal `apps/geoleaf-app`:
 * `requireByDirName` throws on a rename instead of quietly checking nothing.
 *
 * Usage: node scripts/verify-app-template.cjs
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const registry = require("./lib/packages.cjs");
// Les marqueurs viennent de leur PRODUCTEUR — un corpus, deux consommateurs. Les recopier ici
// ferait sortir APP-11 vert le jour d'un renommage côté build, donc le jour où le retrait de la
// balise cesse de s'appliquer : la gate garderait une paire que plus rien ne cherche.
const { DEV_CONNECTOR_MARKERS } = require("./build-deploy.cjs");

const ROOT = path.resolve(__dirname, "..");
const APP = registry.requireByDirName("geoleaf-app").absDir;

/**
 * Plugins whose <script> tag build-deploy.cjs strips per variant.
 *
 * ⚠️ STRUCT S3 (26/07/2026) — cette liste était une PANNE SILENCIEUSE. Elle bâtit
 * l'aiguille `geoleaf-<nom>.plugin.js`, et la boucle APP-05 fait `continue` quand
 * l'aiguille ne matche rien — parce que tous les gated ne figurent pas dans toutes
 * les états d'`index.html` (`editor` n'y est pas aujourd'hui). Conséquence : au
 * renommage `storage` → `offline-ui`, APP-05 aurait cessé de contrôler ce plugin
 * **en sortant vert**, et la balise aurait pu se scinder sur deux lignes sans que
 * rien ne le dise — or c'est exactement ce qu'APP-05 existe pour empêcher, les
 * quatre regexes de gating de `build-deploy.cjs` étant `/gm` SANS `/s`.
 *
 * Le `continue` reste légitime et ne peut pas devenir une erreur. La cécité est
 * fermée en amont : chaque nom est résolu par le registre, qui JETTE sur un
 * répertoire absent. Un renommage échoue ici, bruyamment, au lieu de désarmer
 * la vérification aval.
 */
const GATED_PLUGINS = ["offline-ui", "cog", "editor"].map(
    (dirName) => registry.requireByDirName(dirName).dirName
);

const errors = [];

/**
 * Read a required app file, or record a fatal error.
 * @param {string} rel file name relative to the app workspace
 * @returns {string|null}
 */
function readApp(rel) {
    const abs = path.join(APP, rel);
    if (!fs.existsSync(abs)) {
        errors.push(`${path.relative(ROOT, abs)} — MISSING. The deploy has no source.`);
        return null;
    }
    return fs.readFileSync(abs, "utf8");
}

const html = readApp("index.html");
const init = readApp("init.js");

if (html !== null) {
    // APP-01
    if (!html.includes("dist/geoleaf.esm.js")) {
        errors.push("APP-01 index.html does not load `dist/geoleaf.esm.js`.");
    }

    // APP-10 — la balise MapLibre. Rien ne gardait sa FORME jusqu'ici, alors qu'elle porte
    // depuis la v6 une contrainte qui ne se voit pas à la lecture : le moteur est un module
    // ESM, donc `type="module"` n'est pas un style d'écriture mais la condition pour qu'il
    // s'exécute. Sans lui, le navigateur refuse le fichier et la carte ne monte pas — sans
    // qu'aucune autre gate ne le dise, `index.html` n'étant pas exécuté par la suite unitaire.
    // Les deux moitiés sont nécessaires : la première tient la forme, la seconde interdit le
    // retour d'un artefact qui n'existe plus sur le registre.
    const mlTag = html.split("\n").find((l) => l.includes("vendor/maplibre-gl/global.mjs"));
    if (!mlTag) {
        errors.push(
            "APP-10 index.html ne charge plus `vendor/maplibre-gl/global.mjs` — le shim qui " +
                "repose le global `maplibregl`. MapLibre 6 étant ESM-only, sans lui " +
                "`new maplibregl.Map()` lève sur un global absent."
        );
    } else if (!/<script[^>]*\stype=["']module["']/.test(mlTag)) {
        errors.push(
            'APP-10 la balise du shim MapLibre n\'a pas `type="module"`. Un `.mjs` chargé en ' +
                "script classique est refusé par le navigateur : la carte ne monte pas."
        );
    }
    if (/(?:src|href)=["'][^"']*maplibre-gl(?:-csp)?\.js(?![\w-])/.test(html)) {
        errors.push(
            "APP-10 index.html référence `maplibre-gl.js` (ou `-csp.js`) — ces bundles UMD ne " +
                "sont PLUS publiés depuis MapLibre 6. La référence rendrait un 404."
        );
    }

    // APP-03
    if (!html.includes("src/assets/icons/")) {
        errors.push(
            "APP-03 index.html no longer references `src/assets/icons/` — the rewrite to " +
                "`icons/` in build-deploy.cjs (step 7) is now a regex matching nothing, and the " +
                'deployed <link rel="icon"> will point outside icons/.'
        );
    }

    // APP-04 — the comment must exist AND occupy a single line.
    const optionalLines = html.split("\n").filter((l) => l.includes("Optional plugins"));
    if (optionalLines.length === 0) {
        errors.push("APP-04 the `<!-- Optional plugins … -->` comment is gone from index.html.");
    } else if (!optionalLines.some((l) => /<!--.*Optional plugins.*-->/.test(l))) {
        errors.push(
            "APP-04 the `<!-- Optional plugins … -->` comment spans several lines. " +
                "build-deploy.cjs strips it with a `/gm` regex and NO `/s` flag, so it would " +
                "survive into the deploy as an orphaned header. Keep it on one line."
        );
    }

    // APP-05 — each gated plugin <script> must open and close on the same line.
    for (const name of GATED_PLUGINS) {
        const needle = `geoleaf-${name}.plugin.js`;
        const hits = html.split("\n").filter((l) => l.includes(needle));
        if (hits.length === 0) continue; // not every plugin is listed in every state
        if (!hits.some((l) => /<script[^>]*>\s*<\/script>/.test(l))) {
            errors.push(
                `APP-05 the <script> tag for ${needle} is split across lines. The four ` +
                    `variant-gating regexes in build-deploy.cjs are \`/gm\` without \`/s\`: the ` +
                    `tag would survive into a variant that must not carry it.`
            );
        }
    }

    // APP-08 — the preload marker must exist AND occupy a single line.
    const preloadLines = html.split("\n").filter((l) => l.includes("__GEOLEAF_MODULEPRELOAD__"));
    if (preloadLines.length === 0) {
        errors.push(
            "APP-08 the `<!-- __GEOLEAF_MODULEPRELOAD__ -->` marker is gone from index.html. " +
                'build-deploy.cjs replaces it with one <link rel="modulepreload"> per statically ' +
                "imported chunk; without it the deploy ships no preload block at all and the " +
                "browser rediscovers ~112 KB gz of chunks only after parsing the entry."
        );
    } else if (!preloadLines.some((l) => /<!--\s*__GEOLEAF_MODULEPRELOAD__\s*-->/.test(l))) {
        errors.push(
            "APP-08 the `<!-- __GEOLEAF_MODULEPRELOAD__ -->` marker spans several lines. " +
                "build-deploy.cjs matches it with an `/m` regex and NO `/s` flag, so the " +
                "substitution would silently miss. Keep it on one line."
        );
    }

    // APP-11 — la paire de marqueurs qui encadre le bootstrap Connector de POSTE.
    //
    // 🛑 CE QUE SON ABSENCE COÛTERAIT. `build-deploy.cjs` retire ce bloc de toute variante
    // livrable ; c'est ce retrait, et rien d'autre, qui empêche `connector.local.js` — un JWT
    // à privilège d'écriture — d'entrer dans ce qui part chez un client. Les marqueurs partis,
    // le retrait jette (c'est voulu), mais la gate qui le dit AVANT le build est ici : un
    // défaut trouvé à la construction du déployé se découvre plus tard et plus cher.
    //
    // ⚠️ Les littéraux viennent de `build-deploy.cjs`, jamais recopiés — sans quoi renommer
    // les marqueurs là-bas laisserait cette gate verte sur une paire que plus personne ne
    // cherche, c'est-à-dire au moment précis où le retrait cesse de fonctionner.
    for (const [role, needle] of Object.entries(DEV_CONNECTOR_MARKERS)) {
        if (!html.includes(needle)) {
            errors.push(
                `APP-11 le marqueur DEV-CONNECTOR « ${role} » (\`${needle}\`) a disparu ` +
                    `d'index.html. Il encadre la balise qui charge \`connector.local.js\`, le ` +
                    `bootstrap de poste porteur d'un jeton ; build-deploy.cjs retire ce bloc ` +
                    `des variantes LIVRABLES. Restaurer la paire START/END.`
            );
        }
    }
    if (!/^\s*<script[^>]*src="connector\.local\.js"[^>]*><\/script>\s*$/m.test(html)) {
        errors.push(
            "APP-11 la balise `connector.local.js` n'est plus sur UNE seule ligne entre ses " +
                "marqueurs. Le retrait coupe des lignes entières : une balise étalée sur " +
                "plusieurs lignes en laisserait un fragment dans une variante livrable."
        );
    }
}

// APP-02
// ⚠️ L'aiguille est `GeoLeaf.boot(`, PAS `GeoLeaf.boot()`. Elle a porté la forme fermée
// jusqu'au 07/08/2026, ce qui était juste tant qu'aucune option n'était passée — et faux
// dès que socle-init S4.5 a eu besoin de `boot({ beforeBoot })` pour précharger les plugins
// que le profil exige. La propriété gardée est « init.js démarre l'application » ; les
// parenthèses vides en étaient un accident de rédaction, pas le sujet.
if (init !== null && !init.includes("GeoLeaf.boot(")) {
    errors.push("APP-02 init.js does not call `GeoLeaf.boot(…)` — the app would never start.");
}

/**
 * APP-06 — tout module que `init.js` importe doit EXISTER sur un clone frais.
 *
 * ⚠️ La classe que cette règle ferme a été mesurée le 30/07/2026, et elle est chère parce
 * qu'elle est INVISIBLE de la machine qui l'introduit.
 *
 * `init.js` faisait `await import("./connector.local.js")` sur un fichier GIT-IGNORÉ. Sur le
 * poste qui l'avait, tout était vert ; partout ailleurs — un clone frais, un runner — le
 * module manquait, le navigateur journalisait « Failed to load resource: 404 », et les 8
 * specs E2E qui assertent « 0 console error » échouaient. Le `try/catch` autour de l'import
 * n'y peut RIEN : l'erreur console n'est pas une exception JS.
 *
 * Le remède n'est pas d'interdire l'import d'un fichier optionnel — c'est d'exiger que
 * quelque chose GARANTISSE sa présence dans le déployé. D'où l'exemption nommée : elle ne
 * dispense pas du contrôle, elle désigne le mécanisme qui tient la promesse, et elle rougit
 * si ce mécanisme disparaît.
 */
/**
 * 🗑️ VIDE, ET C'EST UN ACQUIS — ne pas y remettre `./connector.local.js`.
 *
 * Cette table a porté une seule entrée, du 30/07 au 09/08/2026 : `init.js` importait
 * `./connector.local.js` (git-ignoré) INCONDITIONNELLEMENT, et l'exemption désignait le
 * mécanisme qui garantissait sa présence dans le déployé — un talon inerte émis par
 * `build-deploy.cjs`.
 *
 * ⚠️ L'exemption était honnête et APP-06 avait raison de sortir verte : le fichier ÉTAIT là.
 * Ce qu'aucune règle ne disait, c'est que dans les variantes livrables il contenait le
 * bootstrap RÉEL — jeton `geoleaf_editor` à privilège d'écriture. Une règle de PRÉSENCE ne dit
 * rien du CONTENU, et personne ne lui demandait de le dire.
 *
 * La cause est traitée en amont : `init.js` n'importe plus rien, le chargement passe par une
 * balise d'`index.html` que `build-deploy.cjs` retire des variantes livrables (APP-11
 * ci-dessous en tient les marqueurs). Il n'y a donc plus d'import à exempter — et une entrée
 * réintroduite ici signalerait qu'on a refait le nœud qu'on vient de défaire.
 */
const IMPORT_EXEMPTIONS = {};

/**
 * `./dist/**` — sorties de build, git-ignorées mais GARANTIES par la construction.
 *
 * ⚠️ Le pré-vol de cette règle a d'abord signalé les 4 `./dist/geoleaf-*.plugin.js` comme
 * défauts. C'étaient des faux positifs, et les écarter sans les lire aurait été aussi faux
 * que de les traiter : ils vivent dans des THUNKS `registerLazy(() => import(...))`, donc
 * ils ne s'exécutent JAMAIS au boot et ne peuvent pas produire l'erreur console de boot que
 * cette règle traque. C'est précisément ce qui distingue `connector.local.js`, lui exécuté
 * eagerly à chaque chargement de page sur localhost.
 *
 * L'exemption porte donc son témoin : `build-deploy.cjs` doit continuer d'exiger `dist/` dans
 * le déployé, faute de quoi « garanti par la construction » cesse d'être vrai.
 */
const BUILD_OUTPUT_PREFIX = "./dist/";
const BUILD_OUTPUT_WITNESS = { file: "scripts/build-deploy.cjs", needle: '"dist/geoleaf.esm.js"' };

if (init !== null) {
    const specs = new Set(
        [...init.matchAll(/(?:import\s*\(|from)\s*["'](\.[^"']+)["']/g)].map((m) => m[1])
    );
    if ([...specs].some((s) => s.startsWith(BUILD_OUTPUT_PREFIX))) {
        const w = path.join(ROOT, BUILD_OUTPUT_WITNESS.file);
        if (
            !fs.existsSync(w) ||
            !fs.readFileSync(w, "utf8").includes(BUILD_OUTPUT_WITNESS.needle)
        ) {
            errors.push(
                `APP-06 les imports \`${BUILD_OUTPUT_PREFIX}*\` sont dispensés parce que la ` +
                    `construction garantit \`dist/\` dans le déployé — or ${BUILD_OUTPUT_WITNESS.file} ` +
                    `n'exige plus ${BUILD_OUTPUT_WITNESS.needle}. La dispense ne repose plus sur rien.`
            );
        }
    }
    for (const spec of specs) {
        if (spec.startsWith(BUILD_OUTPUT_PREFIX)) continue;
        const rel = path.posix.join("apps/geoleaf-app", spec.replace(/^\.\//, ""));
        const abs = path.join(ROOT, rel);
        const tracked =
            fs.existsSync(abs) &&
            require("node:child_process").spawnSync("git", ["ls-files", "--error-unmatch", rel], {
                cwd: ROOT,
                stdio: "ignore",
            }).status === 0;
        if (tracked) continue;

        const ex = IMPORT_EXEMPTIONS[spec];
        if (!ex) {
            errors.push(
                `APP-06 init.js importe \`${spec}\`, qui n'est PAS suivi par git et n'a aucune ` +
                    `garantie d'émission. Sur un clone frais le module manquera, le navigateur ` +
                    `journalisera un 404, et toute spec E2E assertant « 0 console error » ` +
                    `échouera — invisible depuis ce poste. Suivre le fichier, ou garantir son ` +
                    `émission et l'inscrire dans IMPORT_EXEMPTIONS avec son témoin.`
            );
            continue;
        }
        // Le témoin : le mécanisme cité doit exister VRAIMENT. Une exemption qui désigne un
        // garant disparu est pire qu'une absence d'exemption — elle rassure.
        const garant = path.join(ROOT, ex.garantiPar);
        if (!fs.existsSync(garant) || !fs.readFileSync(garant, "utf8").includes(ex.temoin)) {
            errors.push(
                `APP-06 IMPORT_EXEMPTIONS["${spec}"] désigne \`${ex.temoin}\` dans ` +
                    `\`${ex.garantiPar}\` comme garant de l'émission — INTROUVABLE. La dispense ` +
                    `ne repose plus sur rien, et le 404 peut revenir sans que rien ne bouge.`
            );
        }
    }
}

/**
 * APP-07 — tout enregistrement visant un plugin GATÉ vit entre les marqueurs de bloc.
 *
 * ⚠️ La classe fermée ici est celle de **B-136**, et elle est restée ouverte parce que la
 * moitié HTML du gating était gardée (APP-04/05) et la moitié JS ne l'était pas du tout.
 *
 * `build-deploy.cjs` retire le bloc `GEOLEAF-DEPLOY:GATED-BLOCK <nom>` d'`init.js` sur les
 * variantes qui n'embarquent pas ce plugin. Une référence au bundle posée HORS du bloc
 * survivrait au retrait : le résolveur paresseux serait enregistré sur une variante sans
 * bundle, `isLazyAvailable()` rendrait `true` (il ne sonde aucun fichier), le bouton serait
 * peint — et le clic partirait sur un `import()` en 404. C'est l'état mesuré le 05/08/2026
 * sur `deploy-core` : trois boutons `editor` inertes que l'audit d'accessibilité validait,
 * puisqu'ils portent un nom accessible et un rôle valides.
 *
 * ## Pourquoi l'implication va dans ce sens, et pas dans l'autre
 *
 * On n'exige PAS qu'un bloc existe pour chaque plugin gaté — `offline-ui` n'est pas enregistré
 * depuis `init.js` (il est eager, et le reste : son `wireEngineSignals()` porte l'alerte
 * d'éviction du Sprint 1), et l'exiger ferait rougir sur une absence légitime. On exige
 * que **si** le bundle est nommé, alors il soit encadré. Ajouter une référence sans marqueur
 * fait rougir ; c'est la direction dangereuse, et c'est celle qui est gardée.
 *
 * La direction inverse — les marqueurs disparaissent alors que le retrait en dépend — est
 * tenue par `stripGatedInitBlock`, qui JETTE quand il ne les trouve pas. Les deux gardes se
 * complètent : aucune des deux ne peut sortir verte en ne contrôlant plus rien.
 *
 * ⚠️ Le paragraphe ci-dessus citait `offline-ui` **et `cog`** comme absents d'`init.js` jusqu'au
 * 08/08/2026, et c'était faux depuis le S4.4 : `init.js` porte
 * `gl.plugins.registerLazy("cog", () => import("./dist/geoleaf-cog.plugin.js"))`, soit exactement
 * l'aiguille sur laquelle cette garde boucle. `cog` est donc COUVERT par APP-07 ; le lire ici
 * comme une absence légitime faisait conclure l'inverse de ce que la garde fait réellement.
 */
if (init !== null) {
    const initLines = init.split("\n");
    for (const name of GATED_PLUGINS) {
        const needle = `geoleaf-${name}.plugin.js`;
        if (!init.includes(needle)) continue; // ce plugin n'est pas enregistré depuis init.js

        const startIdx = initLines.findIndex((l) =>
            l.includes(`GEOLEAF-DEPLOY:GATED-BLOCK ${name} ─── START`)
        );
        const endIdx = initLines.findIndex((l) =>
            l.includes(`GEOLEAF-DEPLOY:GATED-BLOCK ${name} ─── END`)
        );

        if (startIdx === -1 || endIdx === -1) {
            errors.push(
                `APP-07 init.js nomme ${needle} mais ne porte pas la paire de marqueurs ` +
                    `\`GEOLEAF-DEPLOY:GATED-BLOCK ${name}\` START/END. build-deploy.cjs ne peut ` +
                    `donc pas retirer l'enregistrement sur une variante qui n'embarque pas ce ` +
                    `bundle : le créneau paresseux serait peint et le clic partirait en 404 (B-136).`
            );
            continue;
        }
        if (endIdx < startIdx) {
            errors.push(
                `APP-07 les marqueurs \`GEOLEAF-DEPLOY:GATED-BLOCK ${name}\` sont inversés ` +
                    `(END ligne ${endIdx + 1} avant START ligne ${startIdx + 1}).`
            );
            continue;
        }

        const outside = initLines
            .map((line, i) => ({ line, i }))
            .filter(({ line, i }) => line.includes(needle) && (i < startIdx || i > endIdx))
            .map(({ i }) => i + 1);
        if (outside.length) {
            errors.push(
                `APP-07 init.js nomme ${needle} HORS du bloc gaté (ligne(s) ${outside.join(", ")} ` +
                    `— le bloc va de ${startIdx + 1} à ${endIdx + 1}). Cette référence survivrait ` +
                    `au retrait par variante et recréerait le bouton inerte de B-136. Déplacer ` +
                    `l'enregistrement entre les marqueurs.`
            );
        }
    }
}

/**
 * APP-09 — la politique CSP de l'application est COMPARÉE, pas seulement présente. (B-164)
 *
 * ⚠️ Ce que ferme cette règle, mesuré le 07/08/2026 : on pouvait injecter `'unsafe-eval'` dans
 * la balise CSP d'`index.html` et cette gate sortait **VERTE**. La balise portait pourtant, en
 * commentaire juste au-dessus, l'aveu « aucune gate ne lit cette balise » — la politique de
 * sécurité la plus exposée du livrable était la seule chose du fichier que personne ne relisait.
 *
 * ## Deux couches, et la seconde existe parce que la première est contournable
 *
 * ① `EXPECTED_CSP` est la politique attendue, écrite ici en toutes lettres. Toute dérive rougit
 *    — directive ajoutée, retirée, source ajoutée ou retirée —, **dans les deux sens**. Une
 *    comparaison qui ne regarderait que « les directives attendues sont là » sortirait verte
 *    devant une source ajoutée, or c'est la mutation dangereuse.
 *
 * ② `FORBIDDEN_TOKENS` interdit un petit ensemble de jetons **quelle que soit** `EXPECTED_CSP`.
 *    Sans cette seconde couche, la gate serait « réparable » en alignant l'attente sur le
 *    mauvais changement — un geste d'une ligne, qui a l'air d'une mise à jour de routine. Le
 *    jour où quelqu'un ajoute `'unsafe-eval'` et met la constante à jour dans la foulée, ① dit
 *    oui et ② dit non. C'est le seul montage où la gate résiste à sa propre maintenance.
 *
 * 🛑 **Elle compare une DÉCLARATION, pas un comportement** — exactement comme `PARITY-11`
 * compare des listes de commandes et non des verdicts. Une CSP juste dans le HTML ne prouve pas
 * que la page ne viole rien : ce versant-là est tenu par les tests de violation d'
 * `e2e/18-security.spec.js` et par `scripts/probe-csp-origins.mjs`. Ne pas attendre de cette
 * règle ce qu'elle ne peut pas porter.
 */
const EXPECTED_CSP = {
    "default-src": ["'self'"],
    // `blob:` RETIRÉ de `script-src` le 08/08/2026 (B-165), après verdict en navigateur sur
    // les 2 variantes — pas par raisonnement. Motif : la création d'un worker depuis une URL
    // `blob:` relève de `worker-src` (conservé ci-dessous), avec `child-src` en repli CSP2
    // (conservé aussi) ; `script-src` n'était sollicité par aucun chemin mesuré.
    "script-src": ["'self'"],
    "style-src": ["'self'"],
    "img-src": ["'self'", "data:", "https:"],
    "connect-src": ["'self'", "https:"],
    "font-src": ["'self'", "data:"],
    "worker-src": ["'self'", "blob:"],
    "child-src": ["blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "upgrade-insecure-requests": [],
};

/** Jetons interdits partout, indépendamment de EXPECTED_CSP — voir ② ci-dessus. */
const FORBIDDEN_TOKENS = ["'unsafe-eval'", "'unsafe-inline'", "*"];

if (html !== null) {
    // ⚠️ Le capteur ne peut PAS être `content=["']([^"']+)["']`. Une valeur de CSP contient des
    // apostrophes (`'self'`, `'none'`), donc une classe qui exclut les deux guillemets s'arrête
    // au premier `'` et ne rend que `default-src `. Écrite ainsi, la règle sortait ROUGE au
    // repos en annonçant 11 directives disparues qui étaient toutes là — et une garde rouge pour
    // la mauvaise raison est indiscernable d'une garde qui marche. Le délimiteur se choisit donc
    // sur le guillemet OUVRANT, et lui seul ferme la capture.
    const meta =
        html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i) ??
        html.match(/<meta\s+http-equiv='Content-Security-Policy'\s+content='([^']*)'/i);
    if (!meta) {
        errors.push(
            "APP-09 index.html ne porte plus de `<meta http-equiv=\"Content-Security-Policy\">`. " +
                "Le livrable partirait sans politique, et cette règle sortirait verte en ne " +
                "comparant rien — c'est le mode d'échec qu'elle existe pour éviter."
        );
    } else {
        /** @type {Record<string, string[]>} */
        const actual = {};
        for (const part of meta[1].split(";")) {
            const tokens = part.trim().split(/\s+/).filter(Boolean);
            if (!tokens.length) continue;
            actual[tokens[0]] = tokens.slice(1);
        }

        const seen = new Set(Object.keys(actual));
        for (const [directive, expected] of Object.entries(EXPECTED_CSP)) {
            if (!seen.has(directive)) {
                errors.push(
                    `APP-09 la directive CSP \`${directive}\` a disparu d'index.html. Si le ` +
                        `retrait est voulu, mettre EXPECTED_CSP à jour DANS LE MÊME commit — la ` +
                        `politique attendue est un choix, pas un constat.`
                );
                continue;
            }
            seen.delete(directive);
            const got = [...actual[directive]].sort();
            const want = [...expected].sort();
            if (got.join(" ") !== want.join(" ")) {
                errors.push(
                    `APP-09 la directive CSP \`${directive}\` a dérivé — attendu ` +
                        `[${want.join(" ") || "aucune source"}], trouvé ` +
                        `[${got.join(" ") || "aucune source"}].`
                );
            }
        }
        for (const extra of seen) {
            errors.push(
                `APP-09 index.html déclare la directive CSP \`${extra}\`, absente de ` +
                    `EXPECTED_CSP. Une directive non déclarée élargit la politique sans revue.`
            );
        }

        // ⚠️ Les jetons se cherchent dans la structure DÉJÀ ANALYSÉE, jamais dans la chaîne
        // brute. Écrite en `meta[1].split(/\s+/)`, cette boucle ne mordait pas : la découpe
        // laisse le point-virgule collé au dernier jeton de chaque directive, donc
        // `'unsafe-eval';` ne s'égalait jamais à `'unsafe-eval'`. Vérifié le 08/08/2026 — la
        // couche ② sortait VERTE sur la mutation qu'elle existe pour attraper, pendant que le
        // commentaire ci-dessus affirmait qu'elle la prenait. La propriété était écrite avant
        // d'avoir été vue mordre ; c'est le défaut que ce dépôt nomme « une garde jamais vue
        // rouge ne garde rien », commis dans la garde même qui l'invoque.
        for (const [directive, sources] of Object.entries(actual)) {
            for (const token of FORBIDDEN_TOKENS) {
                if (!sources.includes(token)) continue;
                errors.push(
                    `APP-09 la directive CSP \`${directive}\` contient le jeton interdit ` +
                        `\`${token}\`. Cette interdiction ne dépend PAS d'EXPECTED_CSP : mettre ` +
                        `la constante à jour ne la lèvera pas, et c'est délibéré.`
                );
            }
        }
    }
}

/**
 * NGINX-01 — l'en-tête `X-Content-Type-Options` est posé sur CHAQUE vhost. (S6.1)
 *
 * ⚠️ Il vivait en `<meta http-equiv>` dans `index.html`, où **aucun navigateur ne le lit** :
 * cet en-tête n'est honoré qu'en réponse HTTP. La protection était donc absente partout tout en
 * paraissant présente — pire qu'absente, puisqu'elle éteignait la vigilance.
 *
 * Le décompte de vhosts est **dérivé** du fichier, jamais écrit ici : un quatrième bloc ajouté
 * sans en-tête doit faire rougir, et une constante `3` écrite à côté aurait sorti vert.
 * C'est la doctrine B-43, la même qui a retiré le nombre d'invariants de l'en-tête de ce script.
 *
 * Le motif du « chaque » : nginx **n'hérite pas** `add_header` dans un bloc qui déclare le sien.
 * Un oubli sur un seul vhost est un trou complet, et parfaitement silencieux.
 */
const NGINX_CONF = path.join(ROOT, "docker/nginx.dev.conf");
const NOSNIFF = /add_header\s+X-Content-Type-Options\s+["']?nosniff["']?/i;

if (!fs.existsSync(NGINX_CONF)) {
    errors.push(
        "NGINX-01 docker/nginx.dev.conf est INTROUVABLE. La règle ne peut plus rien vérifier — " +
            "si le fichier a déménagé, mettre ce chemin à jour plutôt que de retirer la règle."
    );
} else {
    const conf = fs.readFileSync(NGINX_CONF, "utf8");
    // Découpe par bloc `server {` — chaque tranche court jusqu'au `server {` suivant.
    const blocks = conf.split(/^server\s*\{/m).slice(1);
    if (blocks.length === 0) {
        errors.push(
            "NGINX-01 docker/nginx.dev.conf ne déclare AUCUN bloc `server` — la règle sortirait " +
                "verte en n'inspectant rien."
        );
    }
    const naked = blocks
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => !NOSNIFF.test(b))
        .map(({ b, i }) => {
            const name = b.match(/server_name\s+([^;]+);/);
            return name ? name[1].trim() : `bloc #${i + 1}`;
        });
    if (naked.length) {
        errors.push(
            `NGINX-01 ${naked.length} vhost(s) sur ${blocks.length} ne posent pas ` +
                `\`add_header X-Content-Type-Options "nosniff" always;\` — ${naked.join(", ")}. ` +
                `nginx n'hérite pas add_header dans un bloc qui déclare le sien : l'oubli est ` +
                `un trou complet et silencieux sur ce vhost.`
        );
    }
}

if (errors.length) {
    console.error(`\n✘ APP-TEMPLATE: ${errors.length} violation(s) —\n`);
    for (const e of errors) console.error(`  • ${e}`);
    console.error("");
    process.exit(1);
}

// ⚠️ The count is DERIVED from this list, never written beside it. It read "7" while APP-08
// was being added — a written total is a second source of truth that can only diverge, which
// is the same doctrine (B-43) that took the capability counts out of the core entry headers.
const HELD = [
    "bundle ESM",
    "boot()",
    "chemin des icônes",
    "commentaire mono-ligne",
    `${GATED_PLUGINS.length} <script> gatés`,
    "marqueur de préchargement mono-ligne",
    "imports résolvables sur un clone frais",
    "enregistrements gatés encadrés",
    `politique CSP comparée (${Object.keys(EXPECTED_CSP).length} directives)`,
    "nosniff sur chaque vhost",
    "marqueurs du bootstrap de poste + balise mono-ligne",
];

console.log(
    `✔ APP-TEMPLATE: ${path.relative(ROOT, APP)} — ${HELD.length} invariants tenus ` +
        `(${HELD.join(", ")}).`
);
