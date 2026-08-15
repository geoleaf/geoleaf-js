#!/usr/bin/env node
/**
 * Ce que le REGISTRE npm porte déjà — la seule question qu'un publieur doit poser avant
 * d'écrire.
 *
 * ## Pourquoi cette lib existe
 *
 * `publish-plugins.cjs` savait sauter un paquet déjà publié ; `publish.yml` ne le savait pas
 * pour `@geoleaf/core` et `@geoleaf/field-renderer`, dont les étapes étaient des
 * `npm publish` NUS. Mesuré le 15/08/2026 : ces deux paquets étant au registre en `3.0.0` et
 * `1.0.0`, le workflow mourait sur un `E403` à sa PREMIÈRE étape — sans jamais atteindre les
 * 12 plugins qu'il existe pour publier.
 *
 * 🛑 Le workflow se déclare pourtant relançable, et son propre commentaire dit pourquoi :
 * « la publication est un acte irréversible, on doit pouvoir la relancer sans forger un tag ».
 * Seuls les 12 plugins l'étaient. Cette lib porte la moitié manquante, en un seul endroit —
 * la recopier dans un second publieur ferait rougir `jscpd`, et surtout ferait diverger deux
 * définitions de « déjà publié ».
 *
 * ⚠️ **Sauter n'est pas publier.** Tout appelant doit distinguer les deux dans son décompte :
 * « 14/14 » ne doit jamais pouvoir se lire comme quatorze publications là où il n'y en a eu
 * que quatre.
 */
"use strict";

const { execSync } = require("child_process");

/**
 * Le registre porte-t-il DÉJÀ exactement cette version de ce paquet ?
 *
 * @param {string} name Nom npm du paquet (`@geoleaf/core`).
 * @param {string} version Version déclarée dans son manifeste.
 * @returns {boolean} `true` si le registre porte exactement cette version.
 *
 * @example
 * if (alreadyPublished("@geoleaf/core", "3.0.0")) {
 *     console.log("déjà au registre — sauté");
 * }
 */
function alreadyPublished(name, version) {
    try {
        const out = execSync(`npm view ${name}@${version} version --json`, {
            stdio: ["ignore", "pipe", "ignore"],
            encoding: "utf8",
        }).trim();
        // ⚠️ `npm view` rend une chaîne VIDE — pas une erreur — quand le paquet existe mais
        // pas cette version-là. Tester seulement l'absence d'exception dirait « publié » sur
        // une version qui ne l'est pas, donc sauterait une publication réelle.
        return out.length > 0 && out !== "undefined";
    } catch {
        // `npm view` sort en erreur sur un E404 — le paquet ou la version n'existe pas.
        return false;
    }
}

module.exports = { alreadyPublished };
