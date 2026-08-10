"use strict";
/**
 * dev-backend.cjs — le backend de PREUVE ne part pas chez un client.
 *
 * ## Le fait
 *
 * `profiles/tourism/layers/sites_rosario/` est la couche de preuve du cycle hors-ligne : elle est
 * la première du dépôt à déclarer une lecture hors-ligne, une source de rapatriement et un bloc
 * d'écriture. Ses trois liaisons visent le backend monté par `docker-compose.dev.yml`
 * (pygeoapi + PostgREST derrière Traefik), qui **ne résout que sur le poste de développement**.
 *
 * Ces liaisons étaient recopiées telles quelles dans `deploy-core` et `deploy-full`, donc dans ce
 * qui part chez un client — où elles ne peuvent qu'échouer. L'affichage, lui, n'était pas en
 * cause : la couche porte un `data.file` local, elle se peint sans réseau. Ce qui partait mort,
 * c'était le rapatriement et l'écriture.
 *
 * ## Pourquoi une liste d'hôtes NOMMÉS, et surtout pas une allowlist
 *
 * Le premier réflexe est d'autoriser les fournisseurs connus (tuiles IGN, ArcGIS, GBIF…) et de
 * retirer le reste. **C'est le mauvais sens, et il est dangereux** : le jour où un profil client
 * déclare un backend de production légitime, une allowlist le supprimerait **silencieusement**
 * d'un livrable, et le défaut ne se verrait qu'en exploitation.
 *
 * La règle est donc inversée : on nomme le petit ensemble d'hôtes qui n'ont rien à faire dehors,
 * et **tout le reste passe**. Un faux négatif (un hôte de dev oublié ici) se voit au premier
 * essai chez le client ; un faux positif aurait cassé un profil légitime sans un mot.
 *
 * ⚠️ Le retrait est scopé aux CLÉS DE LIAISON — `offline.source`, `write.endpoint`,
 * `options.uploadEndpoint`. Il ne touche jamais `data.*` ni les fonds de carte : un fournisseur
 * de tuiles n'est pas un backend, et les confondre viderait les profils.
 */

/**
 * Hôtes du backend de preuve — montés par `docker-compose.dev.yml`, routés par Traefik, et
 * résolus par le seul fichier `hosts` du poste. Injoignables partout ailleurs.
 *
 * ⚠️ Ajouter un hôte ici est un geste de SÉCURITÉ DE LIVRAISON, pas de configuration : tout ce
 * qui y figure est retiré de ce qui part chez un client.
 */
const DEV_BACKEND_HOSTS = ["qgis.geoleaf.dev"];

/**
 * @param {unknown} value
 * @returns {boolean} `true` si la valeur est une URL absolue vers un backend de preuve.
 */
function isDevBackendUrl(value) {
    if (typeof value !== "string") return false;
    let host;
    try {
        host = new URL(value).hostname;
    } catch {
        return false; // chemin relatif ou valeur non-URL : hors sujet
    }
    return DEV_BACKEND_HOSTS.includes(host);
}

/**
 * Retire d'un profil les liaisons vers le backend de preuve, ou les repointe vers un backend
 * fourni au build.
 *
 * Le parcours est récursif parce que la même forme apparaît à deux profondeurs : dans le fichier
 * de couche (`layers/<id>/<id>_config.json`) et dans le bundle agrégé (`profile-bundle.json`),
 * qui en est une copie. Traiter l'un sans l'autre laisserait la liaison vivante dans le second —
 * et c'est le second que le chargeur lit.
 *
 * ## Ce que « retirer » veut dire, précisément
 *
 *   • `offline.source`        → SUPPRIMÉ. `offline.enabled` reste vrai : le chargeur retombe alors
 *                               sur `data.file`, et un rapatriement demandé refuse proprement avec
 *                               un motif nommé au lieu d'aller frapper un hôte mort.
 *   • `write.endpoint`        → SUPPRIMÉ, et `write.enabled` passe à `false`.
 *                               🛑 Les deux ensemble, jamais l'un sans l'autre : un `enabled: true`
 *                               sans cible promet une écriture impossible, ce qui est pire que
 *                               l'absence de la fonction — l'utilisateur perd sa saisie.
 *   • `options.uploadEndpoint` → SUPPRIMÉ dans le MÊME objet-couche, parce que l'upload est servi
 *                               par le backend qu'on vient de retirer. Il valait `/api/upload`,
 *                               racine-absolu, donc faux deux fois : il vise l'origine servante et
 *                               non le backend, et il casse en sous-répertoire.
 *
 * @param {any} node Racine du JSON de profil (muté en place).
 * @param {string | null} backendBaseUrl Origine de remplacement, ou `null` pour retirer.
 * @returns {number} Nombre de liaisons traitées.
 */
function stripDevBackendBindings(node, backendBaseUrl = null) {
    let touched = 0;

    /** @param {any} obj */
    function walk(obj) {
        if (Array.isArray(obj)) {
            for (const item of obj) walk(item);
            return;
        }
        if (!obj || typeof obj !== "object") return;

        // Un objet-couche est dev-lié si l'une de ses deux liaisons vise un hôte de preuve.
        // C'est CE prédicat, et non la présence d'un `uploadEndpoint`, qui autorise le retrait
        // du troisième : sinon on supprimerait l'upload d'un profil client sans motif.
        const sourceUrl = obj.offline?.source?.url;
        const writeUrl = obj.write?.endpoint;
        const devBound = isDevBackendUrl(sourceUrl) || isDevBackendUrl(writeUrl);

        if (devBound) {
            if (backendBaseUrl) {
                if (isDevBackendUrl(sourceUrl)) {
                    obj.offline.source.url = rehost(sourceUrl, backendBaseUrl);
                    touched += 1;
                }
                if (isDevBackendUrl(writeUrl)) {
                    obj.write.endpoint = rehost(writeUrl, backendBaseUrl);
                    touched += 1;
                }
            } else {
                if (isDevBackendUrl(sourceUrl)) {
                    delete obj.offline.source;
                    touched += 1;
                }
                if (isDevBackendUrl(writeUrl)) {
                    delete obj.write.endpoint;
                    obj.write.enabled = false;
                    touched += 1;
                }
            }
            // 🛑 LES DEUX BRANCHES, ET LA PREMIÈRE VERSION NE L'APPELAIT QUE DANS LA SECONDE.
            // Mesuré le 09/08/2026 : repointé vers un backend explicite, le profil sortait avec
            // `uploadEndpoint: "/api/upload"` intact — racine-absolu, donc visant l'origine
            // servante et non le backend qu'on venait de nommer. La porte de sortie documentée
            // reconduisait le défaut qu'elle est censée contourner, et rien ne l'aurait dit :
            // l'upload n'échoue qu'au moment où quelqu'un joint une photo.
            touched += stripUploadEndpoints(obj, backendBaseUrl);
        }

        for (const value of Object.values(obj)) walk(value);
    }

    walk(node);
    return touched;
}

/**
 * Retire tous les `options.uploadEndpoint` sous un objet-couche déjà reconnu dev-lié.
 * @param {any} node
 * @param {string | null} backendBaseUrl
 * @returns {number}
 */
function stripUploadEndpoints(node, backendBaseUrl) {
    let n = 0;
    /** @param {any} obj */
    function walk(obj) {
        if (Array.isArray(obj)) {
            for (const item of obj) walk(item);
            return;
        }
        if (!obj || typeof obj !== "object") return;
        if (typeof obj.uploadEndpoint === "string") {
            if (backendBaseUrl) obj.uploadEndpoint = joinUrl(backendBaseUrl, obj.uploadEndpoint);
            else delete obj.uploadEndpoint;
            n += 1;
        }
        for (const value of Object.values(obj)) walk(value);
    }
    walk(node);
    return n;
}

/**
 * Remplace l'origine d'une URL absolue en conservant chemin et requête.
 * @param {string} url
 * @param {string} baseUrl
 * @returns {string}
 */
function rehost(url, baseUrl) {
    const parsed = new URL(url);
    return joinUrl(baseUrl, parsed.pathname + parsed.search);
}

/**
 * @param {string} baseUrl
 * @param {string} pathname
 * @returns {string}
 */
function joinUrl(baseUrl, pathname) {
    return `${baseUrl.replace(/\/+$/, "")}/${String(pathname).replace(/^\/+/, "")}`;
}

module.exports = {
    DEV_BACKEND_HOSTS,
    isDevBackendUrl,
    stripDevBackendBindings,
};
