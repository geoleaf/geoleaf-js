/**
 * Le bandeau de licence — sa forme canonique, en un seul endroit (npm S3, tâche 3.1).
 *
 * Trois consommateurs le lisent, et c'est la raison d'être du module :
 *   • `scripts/check-license-headers.cjs`      — la gate LIC-01/02/03/04/05
 *   • `scripts/check-license-headers.cjs --write` — le générateur qui pose le bandeau
 *   • `packages/build-config/rollup.mjs`       — la bannière de SORTIE des bundles
 *
 * Une gate et son générateur qui portent chacun leur copie de la règle divergent, et le
 * désaccord se lit comme « la gate est verte sur un fichier que le générateur veut réécrire ».
 * C'est la même doctrine que `lib/source-inventory.cjs`, dont ce module partage le corpus.
 *
 * ## Deux formes, une seule différence : la version
 *
 * Sources (`.ts`)          → titre nu.
 * Bundles (`output`)       → titre + ` v<version>`.
 *
 * La version ne descend JAMAIS dans les sources : `__GEOLEAF_VERSION__` n'y est pas substitué
 * (le `replace` de rollup ne touche que ce qui entre dans un bundle), et un numéro figé dans
 * 845 fichiers serait faux au premier `npm version`.
 *
 * ## Pourquoi `/*!` et jamais `/**`
 *
 * `source-inventory.cjs:extractHeader` strippe le bloc `/*!` AVANT de chercher un `/**`, sinon
 * tout fichier paraîtrait documenté par son copyright. Poser des `/**` ferait passer 195
 * fichiers de « non documenté » à « documenté » aux yeux de `check-module-headers.cjs`, donc
 * MH-02 sur 195 entrées de baseline — le mode d'échec exact que cette gate existe pour
 * interdire. `/*!` est aussi le marqueur *legal comment* qu'esbuild et terser reconnaissent.
 *
 * ## Le titre n'est pas imposé, son APPARTENANCE l'est
 *
 * Le générateur écrit `pkg.name`. La gate, elle, laisse le titre libre — les 650 titres
 * existants portent une information réelle (`GeoLeaf Core — Language: French (fr)`) que
 * normaliser détruirait — mais elle refuse qu'un titre nomme un AUTRE paquet du dépôt
 * (LIC-02). Mesuré le 10/08/2026 : 4 fichiers le faisaient, dont deux d'`offline-ui` qui
 * s'annonçaient « GeoLeaf Core ».
 *
 * ## `Copyright (c)` / `©` — une PARTITION, pas une divergence (npm S4, tâche 4.3)
 *
 * La tâche 4.3 demandait de « trancher la divergence de formulation ». **Il n'y en a aucune
 * à trancher : les deux formes ne se rencontrent nulle part.** Mesuré le 10/08/2026, puis
 * re-mesuré après les 2 fichiers créés en 4.1 :
 *
 *   • `Copyright (c) 2026 Mattieu Pottier` — dans les **19 fichiers `LICENSE`**, et nulle part
 *     ailleurs (hors mentions méta comme celle-ci, qui parlent de la chaîne sans la porter).
 *   • `© 2026 Mattieu Pottier` — dans les bandeaux `/*!` des sources et des bundles.
 *   • **Intersection vide, dans les deux sens** : aucun `LICENSE` ne contient `©`, aucun
 *     bandeau ne contient `Copyright (c)`.
 *
 * Ce n'est donc pas une divergence tacite, c'est une **partition**, et elle a un motif dans
 * chaque sens. Le `LICENSE` porte le **texte MIT canonique**, celui que SPDX et les scanners
 * de conformité reconnaissent au mot près : `Copyright (c)` y est la forme du gabarit, et la
 * réécrire en `©` ferait diverger 19 fichiers d'un texte de référence pour un gain nul. Le
 * bandeau, lui, n'est pas le texte de la licence mais une **notice** — `©` y est la forme
 * typographique, elle tient sur une ligne courte répétée dans 845 sources et 39 bundles.
 *
 * 🛑 **Les deux sens sont GATÉS, et il faut savoir lequel par quoi.** Le sens « aucun bandeau
 * ne porte `(c)` » l'était déjà : `inspect()` classe cette forme `parenthesee`, donc LIC-01 la
 * refuse. Le sens inverse — « aucun `LICENSE` ne porte `©` » — ne l'était par rien, et c'est
 * exactement celui qu'une harmonisation bien intentionnée casserait : quelqu'un qui lit
 * 845 bandeaux en `©` et 19 `LICENSE` en `(c)` conclut à une incohérence et « corrige » le
 * plus petit des deux tas. **C'est LIC-06 qui le tient**, et le paragraphe qu'on lit là est
 * ce que cette personne aurait dû lire avant.
 */

"use strict";

const registry = require("./packages.cjs");

/** L'année du copyright. Identique aux 17 fichiers `LICENSE` (`Copyright (c) 2026`). */
const COPYRIGHT_YEAR = "2026";
/** Le détenteur, unique. Aucune autre attribution n'est admise (LIC-02). */
const HOLDER = "Mattieu Pottier";
/** La ligne qui rend la notice actionnable quand un `.js` est servi seul depuis un CDN. */
const PROJECT_URL = "https://geoleaf.dev";
/** La formulation de licence, celle des 617 bandeaux conformes. */
const LICENSE_LINE = "Released under the MIT License";
/** La seule valeur admise pour `package.json#license` (LIC-05). */
const PUBLISHED_PACKAGE_LICENSE = "MIT";

/**
 * La ligne de copyright d'un fichier `LICENSE` — forme du gabarit MIT, jamais celle du bandeau.
 *
 * ⚠️ `Copyright (c)` ici, `©` dans `renderBanner()` : c'est une partition VOULUE, motivée au
 * §« `Copyright (c)` / `©` » de l'en-tête. Aligner les deux est le geste qu'il ne faut pas faire.
 */
const LICENSE_FILE_COPYRIGHT = `Copyright (c) ${COPYRIGHT_YEAR} ${HOLDER}`;

/**
 * Le signe que les bandeaux portent et qu'aucun `LICENSE` ne doit porter (LIC-06).
 *
 * Nommé plutôt qu'écrit en littéral dans la gate : un `©` perdu au milieu d'une condition est
 * indiscernable d'une coquille, et c'est précisément le caractère qu'on surveille.
 */
const TYPOGRAPHIC_COPYRIGHT = "©";

/**
 * Le bloc `/*!` canonique, prêt à être écrit.
 *
 * @param {string} title Première ligne — `pkg.name`, ou `pkg.name v<version>` pour un bundle.
 * @returns {string} Le bloc, SANS saut de ligne final.
 */
function renderBanner(title) {
    return [
        "/*!",
        ` * ${title}`,
        ` * © ${COPYRIGHT_YEAR} ${HOLDER}`,
        ` * ${LICENSE_LINE}`,
        ` * ${PROJECT_URL}`,
        " */",
    ].join("\n");
}

/** Bandeau d'une SOURCE : titre nu. @param {string} pkgName @returns {string} */
function sourceBanner(pkgName) {
    return renderBanner(pkgName);
}

/** Bandeau d'un BUNDLE : titre + version. @param {string} pkgName @param {string} version */
function bundleBanner(pkgName, version) {
    return renderBanner(`${pkgName} v${version}`);
}

/**
 * Le bloc `/*!` de tête d'un fichier, BOM toléré.
 *
 * ⚠️ Le BOM n'est pas un détail cosmétique ici. Mesuré le 10/08/2026 : **17 fichiers en
 * portent un**, dont **8 avec leur bandeau juste derrière**. Un motif ancré en `/^\/\*!/` les
 * compte comme nus — c'est l'écart exact entre le « 203 » du pré-vol et les 195 réels — et un
 * générateur qui les croirait nus leur écrirait un SECOND bandeau.
 */
const BANNER_RE = /^﻿?\/\*!([\s\S]*?)\*\//;

/**
 * Étiquette d'affichage dérivée d'un nom de paquet — sans table à maintenir.
 *
 * `@geoleaf/core` → `GeoLeaf Core`. Sert uniquement à LIC-02, pour reconnaître qu'un titre
 * nomme un autre paquet que le sien : le guide prescrit cette forme et la moitié du dépôt la
 * contredit, donc elle n'est PAS imposée — elle est seulement reconnue.
 *
 * @param {string} pkgName
 * @returns {string}
 */
function displayLabel(pkgName) {
    const short = pkgName.split("/").pop();
    return (
        "GeoLeaf " +
        short
            .split(/[-_]/)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")
    );
}

/** @type {Map<string, string>|null} */
let aliasCache = null;

/**
 * Toutes les façons dont un paquet du dépôt peut être nommé, minuscules → nom de paquet.
 *
 * Dérivée de `packages.cjs`, jamais écrite à la main : un alias en dur cesserait
 * silencieusement de matcher au premier renommage, et LIC-02 sortirait verte en ne
 * reconnaissant plus rien.
 *
 * @returns {Map<string, string>}
 */
function packageAliases() {
    if (aliasCache) return aliasCache;
    aliasCache = new Map();
    for (const p of registry.all()) {
        aliasCache.set(p.name.toLowerCase(), p.name);
        aliasCache.set(displayLabel(p.name).toLowerCase(), p.name);
    }
    return aliasCache;
}

/**
 * Ce qu'un fichier porte, et ce qui lui manque.
 *
 * @param {string} source Contenu du fichier.
 * @returns {{present: boolean, body: string, title: string, hasUrl: boolean, hasMit: boolean,
 *            authorForm: "canonique"|"parenthesee"|"nue"|"absente"}}
 */
function inspect(source) {
    const m = source.match(BANNER_RE);
    if (!m) {
        return {
            present: false,
            body: "",
            title: "",
            hasUrl: false,
            hasMit: false,
            authorForm: "absente",
        };
    }
    const body = m[1];
    const title =
        body
            .split("\n")
            .map((l) => l.replace(/^\s*\*?\s?/, "").trim())
            .filter(Boolean)[0] || "";
    const canonical = new RegExp(`©\\s*\\d{4}(?:\\s*[–-]\\s*\\d{4})?\\s+${HOLDER}`);
    let authorForm;
    if (canonical.test(body)) authorForm = "canonique";
    else if (new RegExp(`\\(c\\)\\s*\\d{4}\\s+${HOLDER}`, "i").test(body)) authorForm = "parenthesee";
    else if (body.includes(HOLDER)) authorForm = "nue";
    else authorForm = "absente";

    return {
        present: true,
        body,
        title,
        hasUrl: body.includes(PROJECT_URL.replace(/^https:\/\//, "")),
        hasMit: /\bMIT\b/.test(body),
        authorForm,
    };
}

/**
 * Le nom d'un AUTRE paquet cité par un titre, ou `null`.
 *
 * @param {string} title Première ligne du bandeau.
 * @param {string} ownPkgName Le paquet auquel le fichier appartient réellement.
 * @returns {string|null} Le paquet usurpé.
 */
function foreignPackageInTitle(title, ownPkgName) {
    const lower = title.toLowerCase();
    for (const [alias, owner] of packageAliases()) {
        if (owner === ownPkgName) continue;
        if (!lower.startsWith(alias)) continue;
        // Frontière de mot obligatoire : sans elle, `GeoLeaf Cog` (le plugin) matcherait
        // n'importe quel titre de core commençant par « GeoLeaf Cognitive… ». Une gate qui
        // rougit sur un titre légitime se fait relâcher, et c'est la garde entière qui part.
        const next = lower.charAt(alias.length);
        if (next === "" || !/[a-z0-9]/.test(next)) return owner;
    }
    return null;
}

/**
 * Réécrit le bandeau d'une source pour le rendre canonique — le geste de `--write`.
 *
 * Trois cas, dans cet ordre :
 *   1. aucun bandeau        → on insère le bloc complet, titre = `pkg.name`
 *   2. bandeau qui usurpe   → le titre est remplacé par `pkg.name`, le reste conservé
 *   3. bandeau incomplet    → on complète la ou les lignes manquantes, le TITRE est conservé
 *
 * Le cas 3 est celui qui compte : conserver le titre est ce qui rend l'opération non
 * destructrice sur 650 fichiers dont le titre porte une information qu'aucun générateur ne
 * saurait reconstruire.
 *
 * @param {string} source
 * @param {string} pkgName
 * @returns {{source: string, changed: boolean, why: string[]}}
 */
function normalize(source, pkgName) {
    const bom = source.charCodeAt(0) === 0xfeff ? "﻿" : "";
    const rest = bom ? source.slice(1) : source;
    const info = inspect(source);
    const why = [];

    if (!info.present) {
        // Un fichier nu : bandeau complet, puis une ligne vide avant ce qui suit — sauf si le
        // fichier commençait déjà par une ligne vide, auquel cas on n'en ajoute pas une seconde.
        const sep = /^\s*\n/.test(rest) ? "\n" : "\n\n";
        return {
            source: bom + sourceBanner(pkgName) + sep + rest.replace(/^\n+/, ""),
            changed: true,
            why: ["bandeau absent"],
        };
    }

    const m = rest.match(/^\/\*!([\s\S]*?)\*\//);
    const block = m[0];
    const lines = block.split("\n");
    // lines[0] === "/*!", lines[last] contient "*/"

    // (2) titre usurpé
    const foreign = foreignPackageInTitle(info.title, pkgName);
    if (foreign) {
        const idx = lines.findIndex((l, i) => i > 0 && l.replace(/^\s*\*?\s?/, "").trim() !== "");
        if (idx > 0) {
            lines[idx] = ` * ${pkgName}`;
            why.push(`titre nommait ${foreign}`);
        }
    }

    // (3) lignes manquantes — insérées AVANT la ligne de fermeture, dans l'ordre du canon.
    const closeIdx = lines.length - 1;
    /** @type {string[]} */
    const add = [];
    if (info.authorForm !== "canonique") {
        // Une forme bâtarde se remplace, elle ne se double pas.
        const bad = lines.findIndex((l) => /\(c\)\s*\d{4}|Mattieu Pottier/.test(l));
        if (bad > 0) {
            lines[bad] = ` * © ${COPYRIGHT_YEAR} ${HOLDER}`;
            why.push(`ligne d'auteur ${info.authorForm}`);
        } else {
            add.push(` * © ${COPYRIGHT_YEAR} ${HOLDER}`);
            why.push("ligne d'auteur absente");
        }
    }
    if (!info.hasMit) {
        add.push(` * ${LICENSE_LINE}`);
        why.push("mention MIT absente");
    }
    if (!info.hasUrl) {
        add.push(` * ${PROJECT_URL}`);
        why.push("ligne URL absente");
    }
    if (add.length) lines.splice(closeIdx, 0, ...add);

    if (!why.length) return { source, changed: false, why };
    return { source: bom + lines.join("\n") + rest.slice(block.length), changed: true, why };
}

module.exports = {
    COPYRIGHT_YEAR,
    HOLDER,
    PROJECT_URL,
    LICENSE_LINE,
    PUBLISHED_PACKAGE_LICENSE,
    LICENSE_FILE_COPYRIGHT,
    TYPOGRAPHIC_COPYRIGHT,
    BANNER_RE,
    renderBanner,
    sourceBanner,
    bundleBanner,
    displayLabel,
    packageAliases,
    inspect,
    foreignPackageInTitle,
    normalize,
};
