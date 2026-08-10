#!/usr/bin/env node
"use strict";
/**
 * check-app-payload.cjs — le poids de l'APPLICATION, pas celui du seul core.
 *
 * ## Le trou que cette gate ferme
 *
 * `check-bundle-size.cjs` mesure la clôture des imports STATIQUES du core et sort vert à
 * ~183 / 300 KB gz. C'est juste, et c'est 12 % de ce qu'une page charge. Les 88 % restants —
 * les données du profil, les plugins eager, le CSS, les icônes — n'étaient pesés par RIEN.
 *
 * La conséquence n'est pas théorique : au moment où cette gate est écrite, `icons/fav.png`
 * pesait 172,7 Ko gz, soit plus que le bundle core entier, sur un `<link rel="icon">` — et
 * personne ne l'avait vu, parce qu'aucun instrument ne regardait là. Une réduction de poids
 * qu'aucune gate ne tient se re-dégrade ; c'est le motif entier du Sprint 4.
 *
 * ⚠️ **Cette gate ne remplace pas `check-bundle-size.cjs` et ne s'y compare jamais.** Les deux
 * mesurent deux objets : l'un ce qu'un INTÉGRATEUR embarque en important le paquet, l'autre ce
 * qu'un UTILISATEUR télécharge en ouvrant la page. Les fusionner reviendrait à perdre celui
 * des deux qui n'est pas en cause le jour où l'un des deux rougit.
 *
 * ## Ce qui est pesé, et d'où ça vient
 *
 * Aucune liste n'est écrite ici. Tout est dérivé par `lib/boot-assets.cjs`, LE MÊME module
 * que `build-deploy.cjs` utilise pour injecter `STATIC_ASSETS` et les `modulepreload` — un
 * corpus, deux consommateurs. Deux postes :
 *
 *   • **le shell** — `deriveBootCriticalAssets()` : ce que le markup patché référence, ce que
 *     l'entrée importe statiquement, et le config racine ;
 *   • **les données** — `deriveFirstScreenData()` : le bundle de profil, plus le fichier de
 *     chaque couche que le thème par défaut allume.
 *
 * ## ⚠️ L'angle mort, nommé plutôt que tu
 *
 * Depuis S4.5, `init.js` précharge dans son hook `beforeBoot` les plugins que LE PROFIL exige
 * (`realtime-layer` quand une couche déclare `data.realtime.enabled`, `connector` quand
 * `showCredentialButton` est vrai, et `geocoding` depuis **B-169**). Ces `import()` sont
 * invisibles au markup, donc invisibles ici. Le chiffre reste JUSTE pour ce qu'il mesure — ce
 * que le document demande — mais il n'est pas le total réseau.
 *
 * ⚠️ **Ne pas écrire ici le total de cet angle mort.** Ce paragraphe a chiffré « ~14 Ko gz » sur
 * DEUX plugins jusqu'au 08/08/2026 ; l'entrée de `geocoding` l'a périmé sans que rien ne le
 * dise, et la liste rallongera encore — **B-170** instruit `editor` et `table`, mêmes
 * conditions. Un total en prose sur une liste qui bouge est une seconde source de vérité
 * (doctrine B-43) : la mesure se fait en lisant le hook `beforeBoot` d'`init.js`, qui est la
 * liste elle-même.
 *
 * Le rattraper exigerait de rejouer la logique d'activation de `init.js` dans un script de
 * build, c'est-à-dire une seconde copie à faire diverger — le défaut exact que ce module
 * évite par ailleurs. On préfère un chiffre honnête sur un périmètre nommé à un chiffre
 * complet sur un périmètre qui ment. Le total réseau se mesure au navigateur, et c'est la
 * tâche 11.1 (« waterfall à l'appui ») qui le fera.
 *
 * ## Pourquoi `deploy-coverage` n'est pas gaté
 *
 * C'est une variante INSTRUMENTÉE : son bundle porte les compteurs de couverture de
 * `packages/core/rollup.config.mjs` et pèse davantage par construction. La gater exigerait un
 * second seuil qui ne dirait rien du produit, et le premier écart de version de l'instrument
 * le ferait rougir sans qu'aucun octet livré n'ait bougé. Elle est nommée ici plutôt
 * qu'omise : une variante absente sans motif est indiscernable d'une variante oubliée.
 *
 * ## L'ancrage des seuils
 *
 * `warn = ⌈mesuré × 1,02⌉`, `fail = ⌈mesuré × 1,05⌉`.
 *
 * 🛑 **Ce paragraphe a énoncé la règle de B-107 — `×1,15` / `×1,30` — « et elle n'est pas
 * réinventée » jusqu'au 08/08/2026, alors que le bloc BUDGETS la réfute 40 lignes plus bas.**
 * Les deux calibrages issus de B-107 ont été essayés ici et pris en défaut, chaque fois par une
 * mutation qui PASSAIT : `×1,30` laissait revenir la favicon de 172,7 Ko gz (+12,9 %), et
 * `×1,10` ne rendait qu'une ALERTE sur le retour de `cog` en eager (+8,5 %) — or `ci:local` ne
 * rougit pas sur une alerte. Le relevé des deux se lit au bloc BUDGETS, et il fait foi.
 *
 * ⚠️ **Ce que la contradiction coûtait** : un lecteur venant calibrer un budget NEUF lisait ici
 * une marge de 30 % que la mesure a démontrée incapable de rougir sur le retour du défaut même
 * qui a fait écrire la gate. Ce qui reste vrai de B-107, et qui est le fond : une marge posée
 * au jugé est une garde décorative — l'ancienne table par plugin allait de +1,5 % à +217 %, et
 * celle à +217 % ne pouvait rien attraper. C'est la RÈGLE qui diffère, pas le motif : le poids
 * d'un bundle de plugin dérive lentement par ajout de code, un payload de page se déplace d'un
 * seul asset qui y pèse couramment 10 %.
 *
 * 🔻 **Les seuils se cliquettent vers le BAS.** Après tout allègement, ré-ancrer. Un budget
 * laissé au-dessus de la mesure rend la marge à celui qui la re-dépensera.
 *
 * ## Usage
 *
 *     node scripts/check-app-payload.cjs            # gate
 *     node scripts/check-app-payload.cjs --detail   # + le détail par asset
 *
 * @module scripts/check-app-payload
 */

const fs = require("node:fs");
const path = require("node:path");

const {
    extractEagerChunks,
    deriveBootCriticalAssets,
    deriveFirstScreenData,
    gzipSize,
} = require("./lib/boot-assets.cjs");

const ROOT = path.resolve(__dirname, "..");
const DEPLOY = path.join(ROOT, "deploy");
const DETAIL = process.argv.includes("--detail");

// ── Budgets par variante (gz, Ko) ────────────────────────────────────────
//
// Les valeurs actives sont celles de la DERNIÈRE ligne d'historique ci-dessous, jamais une date
// figée dans cet en-tête. ⚠️ Ce commentaire a dit « mesurés le 07/08 […] reste à venir : la
// simplification des géométries (4.1) » jusqu'au 08/08/2026, alors que 4.1 était soldée et
// inscrite trois lignes plus bas : l'en-tête annonçait comme à venir un palier que son propre
// historique attestait. C'est l'historique qui fait foi.
//
// 🛑 **LA RÈGLE D'ANCRAGE DE B-107 A ÉTÉ ESSAYÉE ICI, ET ELLE NE PEUT PAS ROUGIR.**
//
// `warn = ⌈mesuré × 1,15⌉`, `fail = ⌈mesuré × 1,30⌉` est juste pour un BUNDLE DE PLUGIN, dont
// le poids dérive lentement, par ajout de code. Un payload de page ne dérive pas ainsi : un
// SEUL asset y pèse couramment 10 %. Mesuré sur place — restaurer la favicon de 172,7 Ko gz
// que la tâche 4.8 venait de retirer coûte **+12,9 %** sur `deploy-full`, donc la gate serait
// restée VERTE sur le retour exact du défaut qui l'a fait écrire. Une marge de 30 % rend
// d'avance les 30 % suivants.
//
// ⚠️ ET `×1,10` NON PLUS — deuxième calibrage pris en défaut, par la même méthode.
// Remettre `cog` (99,8 Ko gz, le plus lourd des plugins) en balise eager ne coûte que
// **+8,5 %** une fois la base descendue à 1 173 : la gate sortait en ALERTE, et `ci:local`
// ne rougit pas sur une alerte. Le retour du défaut exact que 4.4 vient de retirer serait
// passé. Un seuil ne se calibre pas sur ce qu'on trouve raisonnable, mais sur la plus petite
// régression qu'on refuse de laisser passer — ici, un plugin remis en eager.
//
// Règle retenue — `warn = ⌈mesuré × 1,02⌉`, `fail = ⌈mesuré × 1,05⌉`. Ce que ça tolère est
// mesurable : à source identique, deux builds ne varient que par les noms de chunks hachés,
// soit quelques centaines d'octets. 5 % valent ~58 Ko — personne n'y arrive sans l'avoir
// voulu. Le budget se modifie alors À LA MAIN, avec la ligne d'historique qui va avec.
//
//   deploy-core : 1 192,5 mesuré → warn 1 217, fail 1 253
//   deploy-full : 1 223,9 mesuré → warn 1 249, fail 1 286
//
// 📉 Historique du cliquet, pour que la descente soit lisible et qu'une remontée se voie :
//   07/08 — 1 195,2 / 1 326,4  (après 4.8, la favicon : −171,6 Ko gz)
//   07/08 — 1 142,2 / 1 173,4  (après 4.4/4.5, 7 plugins paresseux : −153,0 Ko gz sur `full`)
//   07/08 —   914,6 /   946,0  (après 4.1, arrondi des coordonnées : −227,9 Ko gz)
//   ⇒ départ 1 367 / 1 497 → arrivée 914,6 / 946,0, soit −36,8 % sur `deploy-full`.
//   08/08 — 1 193,5 / 1 224,9  (après 5.4, MapLibre auto-hébergé : +278,9 Ko gz) 🔺 REMONTÉE
//   08/08 — 1 192,5 / 1 223,9  (après 5.6, fusion chunk-labels : −1,0 Ko gz, une requête de moins)
//   08/08 — 1 199,9 / 1 231,2  (MapLibre 5.21.0 → 6.2.0 : +4,9 Ko gz) 🔺 remontée, motif ci-dessous
//
// 🔺 Seconde remontée, et de loin la plus petite — mais c'est son SENS qui compte ici.
//
// La v6 est ESM-only : le moteur passe d'un fichier (274,4 Ko gz) à trois modules plus un shim
// (139,1 + 133,6 + 6,0 + ~0), soit **+4,9 Ko gz** pour le même moteur. Le shell passe de 14 à
// 17 assets : ce sont exactement les trois modules que la clôture de `boot-assets.cjs` fait
// entrer au pré-cache, et qu'aucune dérivation ne voyait avant elle.
//
// 🛑 **SUR CE POSTE, UNE BAISSE EST UN SYMPTÔME, PAS UN GAIN.** Les modules du moteur ne sont
// nommés dans AUCUN markup : ils n'entrent dans la mesure que par la clôture. Si celle-ci
// cesse de matcher (minifieur différent, chunk renommé), ce total **descend d'environ 140 Ko**
// et la gate félicite — en mesurant une application qui ne peut plus peindre de carte hors
// ligne. Lire le détail ligne par ligne (`--detail`), jamais le total seul : les cinq entrées
// `vendor/maplibre-gl/*` doivent y être.
//
// 🔺 **LA PREMIÈRE REMONTÉE DU CLIQUET, ET ELLE NE DÉPENSE AUCUNE MARGE.**
//
// La doctrine 🔻 ci-dessus reste entière : un budget laissé au-dessus de la mesure rend la
// marge à celui qui la re-dépensera. Ce n'est pas ce qui se passe ici, et le motif doit être
// lu avant d'être cru.
//
// Ces 278,9 Ko gz sont MapLibre. **L'utilisateur les téléchargeait déjà** — depuis
// `unpkg.com`, à chaque premier chargement. Ils échappaient à cette gate pour une raison qui
// n'a rien à voir avec le poids : `extractHtmlAssetRefs` (`lib/boot-assets.cjs`) écarte les
// URL cross-origin, parce que `cache.addAll()` rejetterait le lot de pré-cache sur l'une
// d'elles. **Cette gate ne mesurait donc pas le payload, elle mesurait le payload
// same-origin** — et l'écart entre les deux était de 278,9 Ko, soit 23 % de la page, invisible.
//
// Auto-héberger ne rend pas la page plus lourde d'un octet : il fait entrer dans la mesure ce
// qui s'y dérobait. Ce que le chiffre gagne au passage est de l'honnêteté, pas du gras — et ce
// que le déployé gagne est une origine de moins (un DNS + TCP + TLS), une dérive de version
// rendue impossible (`require.resolve`), et MapLibre au pré-cache du worker, donc une carte
// qui fonctionne au second chargement hors ligne.
//
// ⚠️ **La conséquence pour la suite : le prochain qui lit « 1 224,9 » ne doit pas le comparer
// aux « 946,0 » de la ligne du dessus.** Les deux ne mesurent pas le même périmètre. La
// comparaison honnête est 946,0 + 278,9 = 1 224,9 — soit exactement zéro régression. Le
// cliquet reprend sa descente à partir d'ici, sur un périmètre enfin complet.
//
// ⚠️ Un palier intermédiaire a existé à 889,6 / 921,1, Douglas-Peucker activé à 11 m. Il a été
// ABANDONNÉ : DP ne rendait que 24,8 Ko gz de plus (10 % du gain) pour un écart géométrique
// atteignant 11 m, soit ~21 px au zoom 18. Le motif complet est dans `build-deploy.cjs`, au
// commentaire de `GEOJSON_TOLERANCE_DEG`. Ne pas « récupérer » ces 25 Ko sans relire ce relevé.
const BUDGETS = {
    "deploy-core": { warn: 1217, fail: 1253 },
    "deploy-full": { warn: 1249, fail: 1286 },
};

// Variantes délibérément hors budget, avec leur motif. ⚠️ Le motif n'est pas décoratif : sans
// lui, l'exclusion se relit six mois plus tard comme un oubli.
const NOT_BUDGETED = {
    "deploy-coverage":
        "variante instrumentée (compteurs de couverture) — pèse plus par construction",
};

const c = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
};
const kb = (bytes) => (bytes / 1024).toFixed(1);

/**
 * Pèse une variante déployée : le shell dérivé plus les données du premier écran.
 *
 * @param {string} variant Nom du répertoire de variante (ex. `deploy-full`).
 * @returns {{ shell: number, data: number, total: number, assets: string[], files: string[],
 *   remote: string[], themeId: string, detail: Array<{ url: string, gz: number, kind: string }> }}
 * @throws {Error} Propagé depuis les dérivations — entrée illisible, extracteur devenu aveugle,
 *   URL dérivée sans fichier derrière, thème qui n'allume aucune couche.
 */
function weighVariant(variant) {
    const dir = path.join(DEPLOY, variant);
    const patchedHtml = fs.readFileSync(path.join(dir, "index.html"), "utf-8");
    const eagerChunks = extractEagerChunks(path.join(dir, "dist", "geoleaf.esm.js"));
    const { assets } = deriveBootCriticalAssets({ outDir: dir, patchedHtml, eagerChunks });
    const { themeId, files, remote } = deriveFirstScreenData(dir);

    const detail = [];
    let shell = 0;
    for (const url of assets) {
        const gz = gzipSize(path.join(dir, url.split("?")[0]));
        shell += gz;
        detail.push({ url, gz, kind: "shell" });
    }
    let data = 0;
    for (const rel of files) {
        const gz = gzipSize(path.join(dir, rel));
        data += gz;
        detail.push({ url: rel, gz, kind: "data" });
    }
    detail.sort((a, b) => b.gz - a.gz);
    return { shell, data, total: shell + data, assets, files, remote, themeId, detail };
}

function main() {
    if (!fs.existsSync(DEPLOY)) {
        console.error(
            `${c.red}✗${c.reset}  deploy/ absent — bâtir d'abord : ` +
                `npx turbo run build && npm run build:deploy`
        );
        process.exit(1);
    }

    const present = fs
        .readdirSync(DEPLOY, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

    // Anti-gate-vide. Une gate qui ne trouve aucun sujet doit ROUGIR, pas féliciter : c'est la
    // classe que `probe-gate-visibility.cjs` surveille dans tout le dépôt, et celle qui a fait
    // sortir verte une sonde de boot dont le marqueur avait été supprimé.
    const budgeted = Object.keys(BUDGETS).filter((v) => present.includes(v));
    if (budgeted.length === 0) {
        console.error(
            `${c.red}✗${c.reset}  aucune des ${Object.keys(BUDGETS).length} variantes budgétées ` +
                `n'est dans deploy/ (présentes : ${present.join(", ") || "aucune"}). ` +
                `Une gate sans sujet ne garde rien.`
        );
        process.exit(1);
    }

    console.log(`\n${c.cyan}── 📦 Payload de première page (application, pas core) ──${c.reset}\n`);

    let failed = false;
    let warned = false;

    for (const variant of budgeted) {
        const { shell, data, total, assets, files, remote, themeId, detail } =
            weighVariant(variant);
        const budget = BUDGETS[variant];
        const totalKb = total / 1024;

        console.log(`${c.cyan}${variant}${c.reset}`);
        console.log(
            `${c.dim}   shell   ${String(assets.length).padStart(3)} assets dérivés` +
                `${" ".repeat(6)}${kb(shell).padStart(8)} Ko gz${c.reset}`
        );
        console.log(
            `${c.dim}   données ${String(files.length).padStart(3)} fichiers (thème « ${themeId} »)` +
                `${remote.length ? `, ${remote.length} distante(s)` : ""}` +
                `   ${kb(data).padStart(6)} Ko gz${c.reset}`
        );

        if (DETAIL) {
            for (const d of detail.slice(0, 12)) {
                console.log(
                    `${c.dim}      ${kb(d.gz).padStart(8)} Ko  ${d.kind.padEnd(5)}  ${d.url}${c.reset}`
                );
            }
        }

        const verdict = `${kb(total)} / ${budget.fail} Ko gz`;
        if (totalKb > budget.fail) {
            console.log(`${c.red}✗  DÉPASSEMENT — ${verdict} (fail > ${budget.fail})${c.reset}\n`);
            failed = true;
        } else if (totalKb > budget.warn) {
            console.log(
                `${c.yellow}⚠  au-dessus du seuil d'alerte — ${verdict} ` +
                    `(warn > ${budget.warn})${c.reset}\n`
            );
            warned = true;
        } else {
            console.log(`${c.green}✓  dans le budget — ${verdict}${c.reset}\n`);
        }
    }

    for (const [variant, motive] of Object.entries(NOT_BUDGETED)) {
        if (present.includes(variant)) {
            console.log(`${c.dim}   ${variant} — non budgétée : ${motive}${c.reset}`);
        }
    }

    // Le décompte est DÉRIVÉ de la liste, jamais écrit à la main — doctrine B-43, après le
    // « 7 invariants tenus » que `verify-app-template.cjs` imprimait pendant qu'on lui en
    // ajoutait un huitième.
    console.log(
        `\n${c.dim}${budgeted.length} variante(s) pesée(s). ` +
            `⚠️ Objet distinct de \`npm run size\`, qui mesure la clôture statique du CORE.${c.reset}`
    );

    if (failed) process.exit(1);
    if (warned) console.log(`${c.yellow}⚠  alerte(s) — le build n'échoue pas.${c.reset}`);
    console.log(`${c.green}✓  Payload applicatif dans les budgets.${c.reset}\n`);
}

try {
    main();
} catch (err) {
    console.error(`${c.red}✗${c.reset}  ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
}
