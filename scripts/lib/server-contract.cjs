"use strict";
/**
 * server-contract.cjs — ce qu'une variante LIVRABLE exige de son serveur, écrit AVEC elle.
 *
 * ## Pourquoi ce module existe
 *
 * Le 09/08/2026, un `deploy-full` copié tel quel sur un serveur de production nginx a rendu un
 * spinner infini. La console disait la cause en un mot :
 *
 *   Failed to load module script: Expected a JavaScript-or-Wasm module script but the server
 *   responded with a MIME type of "application/octet-stream".
 *
 * La table `mime.types` de nginx ne connaît que `js`. Depuis MapLibre 6, le moteur entier est en
 * `.mjs` — donc rien ne boote. Ce fait était DÉJÀ écrit dans le dépôt, à `docker/nginx.dev.conf`,
 * sous la forme « 🛑 SANS CETTE LIGNE, RIEN NE BOOTE », dans un commentaire qui admettait
 * lui-même le trou : « ⚠️ Cette contrainte VIT HORS DU DÉPÔT pour l'intégrateur — aucune gate ne
 * peut la voir chez lui ».
 *
 * Il n'y avait pas de trou de connaissance, il y avait un trou de DIFFUSION : la connaissance
 * vivait dans un fichier de dev qui ne part pas avec le dossier. Le livrable, lui, ne portait
 * aucun fichier d'accompagnement — ni `.htaccess`, ni `nginx.conf`, ni README —, et le dernier
 * texte imprimé par le build disait « Serve via http », que la CSP livrée rend impossible.
 *
 * ## Un seul corpus, trois consommateurs
 *
 *   • `build-deploy.cjs`                    — émet les trois fichiers dans chaque livrable
 *   • `verify-deploy-server-contract.cjs`   — SC-01/02/03, gate leur présence et leur contenu
 *   • `_docs_projet/guides/DISTRIBUTION_GUIDE_2026.md` — y RENVOIE au lieu de dupliquer
 *
 * C'est le patron de `lib/boot-assets.cjs` et de `productDocsFiles()`, pour la même raison :
 * deux recettes divergent, et celle qui n'est pas maintenue sort verte en décrivant autre chose.
 *
 * ## ⚠️ La gate ne compare PAS ces chaînes à elles-mêmes
 *
 * SC-02 relit les fichiers ÉMIS sur le disque et y cherche la déclaration de type. Comparer la
 * sortie du générateur à la constante du générateur serait une tautologie — le mode d'échec que
 * `verify-app-template.cjs` nomme dans son propre en-tête (« une gate réparable en alignant
 * l'attente sur le mauvais changement »). Retirer la ligne `mjs` d'ici fait rougir SC-02 ; c'est
 * la seule propriété qui compte, et elle a été vue rougir sur cette mutation exacte.
 */

const path = require("node:path");

/**
 * Variantes qui ne sont servies que sur le poste, et n'ont donc rien à faire d'un contrat
 * destiné à l'exploitant d'un serveur distant.
 *
 *   • `deploy-local`    — variante de poste, porte le bootstrap dev et son jeton
 *   • `deploy-coverage` — copie instrumentée, sert la mesure de couverture du boot
 *
 * 🛑 **CETTE LISTE N'EST PAS `NON_DELIVERABLE` DE `verify-deploy-no-secrets.cjs`, ET NE DOIT
 * JAMAIS ÊTRE FUSIONNÉE AVEC ELLE.** Les deux répondent à des questions différentes :
 *
 *   • là-bas : « cette variante a-t-elle le DROIT de porter un secret ? » — seule `deploy-local`
 *     est exemptée, et `deploy-coverage` est scannée **exprès**, par prudence : une copie
 *     instrumentée d'un livrable est un livrable pour ce qui est de fuiter.
 *   • ici : « cette variante part-elle chez quelqu'un qui devra la servir ? » — `deploy-coverage`
 *     ne part nulle part, elle n'est servie que par le nginx de dev.
 *
 * Fusionner les deux ferait cesser le scan de secrets sur `deploy-coverage`, c'est-à-dire élargir
 * un trou de sécurité pour économiser une constante. Le recouvrement partiel des deux listes est
 * une coïncidence, pas une redondance.
 *
 * ⚠️ La liste nomme les EXCLUS, jamais les inclus : une variante inconnue reçoit le contrat. Le
 * défaut par excès est bénin (un fichier de trop dans un dossier de travail) ; le défaut par
 * défaut est très exactement la panne du 09/08.
 */
const NO_CONTRACT_VARIANTS = new Set(["deploy-local", "deploy-coverage"]);

/**
 * @param {string} variantName Nom du répertoire de variante (`deploy-core`, `deploy-full`…).
 * @returns {boolean} `true` si la variante doit porter le contrat serveur.
 */
function carriesServerContract(variantName) {
    return !NO_CONTRACT_VARIANTS.has(path.basename(variantName));
}

/** Les trois fichiers d'accompagnement, dans l'ordre où ils se lisent. */
const SERVER_CONTRACT_FILES = ["SERVEUR.md", "nginx.conf.example", ".htaccess"];

/** Le type MIME attendu, seul fragment dont l'absence empêche le boot. */
const MJS_MIME_TOKEN = "text/javascript";

/**
 * Une recette déclare-t-elle effectivement le type MIME de `.mjs` ?
 *
 * 🛑 **CETTE FONCTION A ÉTÉ ÉCRITE DEUX FOIS, ET LA PREMIÈRE VERSION SORTAIT VERTE SUR LA
 * MUTATION QU'ELLE EXISTE POUR ATTRAPER.** Elle cherchait `"text/javascript"` et `"mjs"`
 * n'importe où dans le fichier. Or les deux recettes émises **commentent abondamment** la
 * directive — « attendu : content-type: text/javascript », « le moteur est livré en .mjs » —,
 * donc les deux chaînes restaient présentes après suppression de la directive elle-même.
 * Mesuré le 09/08/2026 en remplaçant `text/javascript mjs;` par `text/css xyz;` : la gate est
 * sortie **verte**, exit 0.
 *
 * C'est le défaut que `verify-app-template.cjs` documente sur sa propre couche ② (« la
 * propriété était écrite avant d'avoir été vue mordre »), commis ici dans la gate qui invoque
 * la règle. Deux corrections en découlent, et aucune n'est facultative :
 *
 *   ① **Les commentaires sont dépouillés d'abord.** `#` en tête de ligne, seul commentaire des
 *      deux formats. Sans ça, plus la recette est bien documentée, moins la gate mord.
 *   ② **Les deux jetons doivent être sur la MÊME ligne.** Une directive associe un type à une
 *      extension ; deux mentions éloignées ne prouvent rien.
 *
 * ⚠️ Le lookahead final exclut `.mjs.gz`. Le `.htaccess` porte une seconde ligne
 * `AddType text/javascript .mjs.gz .js.gz`, qui sert les archives pré-compressées : sans cette
 * exclusion, elle satisferait la règle à elle seule et la directive PRINCIPALE pourrait
 * disparaître sans que rien ne rougisse.
 *
 * @param {string} body Contenu brut d'un `nginx.conf.example` ou d'un `.htaccess`.
 * @returns {boolean}
 */
function declaresMjsType(body) {
    return body
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .some((line) => line.includes(MJS_MIME_TOKEN) && /(?:^|\s)\.?mjs(?![\w.])/.test(line));
}

const SERVEUR_MD = `# Servir ce dossier — contrat serveur

> Émis automatiquement par \`build-deploy.cjs\` avec la variante. Ne pas éditer sur place :
> le prochain déploiement écrase le dossier.

Ce dossier est une application statique. Il n'exige **aucun** runtime, aucune base de données et
aucun processus — mais il exige **quatre choses de son serveur**, dont deux sans lesquelles rien
ne s'affiche. Chaque section dit le symptôme exact si l'exigence manque, parce qu'aucune ne
produit de message qui la nomme.

Recettes prêtes à coller, dans ce même dossier :

| Serveur | Fichier | Actif tout seul ? |
| --- | --- | --- |
| nginx | \`nginx.conf.example\` | non — à recopier dans votre vhost |
| Apache | \`.htaccess\` | **oui**, si \`AllowOverride\` le permet (voir §8) |

---

## 1. 🛑 Le type MIME de \`.mjs\` — BLOQUANT

**L'exigence.** Le serveur doit rendre les fichiers \`.mjs\` avec un type MIME JavaScript.

**Pourquoi.** Le moteur cartographique (MapLibre GL JS 6) est *ESM-only* : il est livré sous
forme de modules \`.mjs\`, dans \`vendor/maplibre-gl/\`. Or la table de types par défaut de nginx
ne connaît que \`.js\` — un \`.mjs\` part donc en \`application/octet-stream\`, et les navigateurs
**refusent d'exécuter un module servi sous un type non-JavaScript**. C'est une règle stricte de
la spécification HTML, pas une préférence : il n'y a pas de repli, pas d'avertissement, et
\`X-Content-Type-Options: nosniff\` (§7) la rend définitive.

**Le symptôme.** La page se charge, le fond et le styles s'affichent, **le spinner tourne
indéfiniment**. En console :

\`\`\`
global.mjs:1  Failed to load module script: Expected a JavaScript-or-Wasm module script
              but the server responded with a MIME type of "application/octet-stream".
\`\`\`

⚠️ Les erreurs suivantes — \`maplibregl is not defined\`, \`MapLibre adapter not found\`,
\`Failed to load layer\` répété, \`map is not ready\` — sont toutes des **conséquences**. Ne pas les
instruire : elles disparaissent toutes avec celle-ci.

**La vérification**, avant même de recharger la page :

\`\`\`bash
curl -sI https://VOTRE-HOTE/vendor/maplibre-gl/global.mjs | grep -i content-type
\`\`\`

Attendu : \`content-type: text/javascript\`. Tant que la réponse est \`application/octet-stream\`,
inutile d'aller plus loin — rien d'autre ne peut fonctionner.

---

## 2. 🛑 HTTPS — BLOQUANT

**L'exigence.** Servir en HTTPS, avec un certificat reconnu par le navigateur.

**Pourquoi.** Trois raisons indépendantes, dont la première suffit :

1. La politique de sécurité de la page déclare \`upgrade-insecure-requests\`. Sur un serveur en
   HTTP nu, le navigateur réécrit **toutes** les sous-ressources en \`https://\` ; si le port 443
   n'écoute pas, chacune échoue en \`ERR_CONNECTION_REFUSED\`.
2. Le *service worker* (mode hors-ligne, mise en cache) n'existe pas hors contexte sécurisé.
3. \`crypto.subtle\` et \`navigator.storage.persist()\`, utilisés par le stockage local, non plus.

⚠️ \`localhost\` est exempté par les navigateurs — c'est pourquoi un dossier qui fonctionne en
local peut échouer une fois déployé, sans que rien n'ait changé dans le dossier.

**Le symptôme.** Page blanche, console pleine de \`net::ERR_\` sur des URL en \`https://\` alors que
la barre d'adresse affiche \`http://\`.

Un certificat **auto-signé** produit un symptôme voisin mais distinct : la navigation passe après
acceptation de l'exception, et l'enregistrement du service worker échoue quand même.

---

## 3. Le slash final, et le fichier d'index

**L'exigence.** \`index.html\` doit être servi pour le répertoire, et une URL de répertoire sans
slash final doit être redirigée vers la même avec slash.

**Pourquoi.** Tous les chemins de \`index.html\` sont **relatifs** — c'est délibéré, cela rend le
dossier déployable dans un sous-répertoire sans le reconstruire. Mais un chemin relatif se résout
contre l'URL du document : servi à \`https://hote/carte\` (sans slash), le document a pour base
\`https://hote/\`, et **toutes** les références partent vers le parent.

**Le symptôme.** \`403 Forbidden\` ou un listing de répertoire s'il manque la directive d'index ;
une page blanche et une console pleine de 404 s'il manque le slash.

---

## 4. \`gzip_static\` — non bloquant, mais tout est déjà là

**L'exigence.** Activer le service des fichiers pré-compressés.

**Pourquoi.** Chaque artefact texte de ce dossier est accompagné d'un jumeau \`.gz\` **déjà
produit**. Sans la directive, ces fichiers existent et ne sont **jamais servis** : l'original part
sur le fil. Le plus gros module du moteur pèse 559 Ko bruts contre 139 Ko compressés.

**Le symptôme.** Aucun — c'est précisément le problème. Rien ne casse, le transfert est simplement
quatre fois plus lourd que ce que le dossier permet.

⚠️ Des jumeaux \`.br\` (Brotli) sont également produits. Les servir demande \`ngx_brotli\`, un module
tiers qui exige une recompilation de nginx. **Ces fichiers n'ont jamais été éprouvés** par le
projet, qui ne dispose pas de ce module : ne pas les supposer servis au motif qu'ils existent.

---

## 5. Ne pas installer de repli « SPA »

**L'exigence.** Un fichier absent doit rendre un vrai **404**. Ne PAS écrire
\`try_files $uri /index.html;\`.

**Pourquoi.** Ce n'est pas une application à routes côté client : elle n'a rien à rattraper. Et un
repli global est activement nuisible ici — le service worker pré-cache une liste d'URL avec
\`cache.addAll()\`, qui est **tout-ou-rien**. Avec un repli, une URL manquante rend du HTML avec un
code 200 : le pré-cache **réussit** en enregistrant du HTML à la place d'un script, et le mode
hors-ligne est silencieusement corrompu. Sans repli, il échoue franchement et l'application
continue en ligne.

**Le symptôme, avec le repli** : tout fonctionne en ligne, et l'application est cassée hors ligne
— le pire ordre de découverte possible. En console : \`Uncaught SyntaxError: Unexpected token '<'\`.

---

## 6. Ne pas normaliser les chaînes de requête

**L'exigence.** \`dist/geoleaf.esm.js?v=71b6e192\` doit rester distinct de \`dist/geoleaf.esm.js\`.

**Pourquoi.** Le suffixe \`?v=\` est une empreinte de contenu, et le service worker met en cache
**avec** la clé exacte. Un CDN ou un proxy qui retire ou réordonne la chaîne de requête produit un
raté de cache permanent.

**Le symptôme.** L'application fonctionne en ligne, ne démarre jamais hors ligne, et le journal du
service worker signale un pré-cache en échec à chaque chargement.

---

## 7. En-têtes de sécurité

Aucun n'empêche le boot ; tous sont recommandés, et **seul le serveur peut les poser** — une
balise \`<meta>\` ne fonctionne pour aucun des trois.

| En-tête | Valeur |
| --- | --- |
| \`X-Content-Type-Options\` | \`nosniff\` |
| \`X-Frame-Options\` | \`DENY\` |
| \`Content-Security-Policy\` | \`frame-ancestors 'self'\` |

🛑 **Piège nginx, qui a déjà coûté.** \`add_header\` **ne s'hérite pas** : un bloc \`location\` ou
\`server\` qui déclare son propre \`add_header\` perd **tous** ceux du bloc parent. Un oubli sur un
seul bloc est donc un trou complet, et parfaitement silencieux.

⚠️ La page porte déjà sa propre politique de contenu en \`<meta>\`, validée pour MapLibre 6 et sans
aucune origine tierce. Si vous posez une CSP en en-tête HTTP, elle **s'ajoute** à celle-ci : les
deux s'appliquent, et c'est l'intersection qui vaut. Une CSP d'en-tête plus étroite peut donc
casser l'application sans que la page ait changé.

---

## 8. Cache-Control

| Ressource | En-tête | Motif |
| --- | --- | --- |
| \`dist/**\`, \`vendor/**\` | \`public, max-age=31536000, immutable\` | noms empreintés, jamais réécrits |
| \`index.html\`, \`init.js\`, \`manifest.json\` | \`no-cache\` | référencent les artefacts empreintés |
| \`sw-core.js\` | \`no-cache\` | le navigateur doit voir les mises à jour du worker |
| \`profiles/**\` | \`no-cache\` ou \`max-age=3600\` | données métier, selon votre fréquence |

⚠️ Ne pas reprendre le \`no-store\` du serveur de développement du projet : il est délibéré, et
local.

---

## 9. Spécificités Apache

Le \`.htaccess\` fourni couvre les mêmes points. Deux réserves :

- **Il est inerte si \`AllowOverride None\`** — le cas par défaut de nombreuses configurations.
  Le fichier est alors présent, lu par personne, et l'application échoue comme s'il était absent.
  À vérifier dans le vhost avant de conclure.
- **Désactiver \`MultiViews\`.** Avec \`Options +MultiViews\`, la présence de \`fichier.js.gz\` à côté
  de \`fichier.js\` peut faire servir l'archive sans l'en-tête \`Content-Encoding\` correspondant.
  Symptôme : \`Uncaught SyntaxError: Invalid or unexpected token\`. Le \`.htaccess\` fourni la
  désactive explicitement.

---

## Ordre de diagnostic recommandé

Si l'application ne démarre pas, dans cet ordre — chaque étape rend la suivante lisible :

1. \`curl -sI https://VOTRE-HOTE/\` → 200, et \`content-type: text/html\`.
2. \`curl -sI https://VOTRE-HOTE/vendor/maplibre-gl/global.mjs\` → \`content-type: text/javascript\`
   (§1). **C'est la cause la plus fréquente, de très loin.**
3. Console du navigateur, **première ligne rouge seulement** — les suivantes en découlent presque
   toujours.
4. Onglet réseau, filtre sur les échecs : un 404 nomme le chemin qui manque.
`;

const NGINX_CONF_EXAMPLE = `# ── GeoLeaf — recette nginx ───────────────────────────────────────────────────
#
# À recopier dans votre configuration. Les deux premières directives sont les seules
# sans lesquelles l'application NE DÉMARRE PAS. Détail et symptômes : SERVEUR.md.
#
# ⚠️ nginx N'HÉRITE PAS \`add_header\` : un bloc qui déclare le sien perd tous ceux du
# parent. Si vous ajoutez un \`location\` avec un \`add_header\`, il faut y REPOSER les
# trois en-têtes de sécurité ci-dessous.

# 🛑 SANS CETTE LIGNE, RIEN NE BOOTE.
#
# La table \`mime.types\` de nginx ne connaît que \`js\`. Le moteur cartographique
# (MapLibre GL JS 6) est ESM-only et entièrement livré en \`.mjs\` : servi en
# \`application/octet-stream\`, le navigateur REFUSE de l'exécuter — « Strict MIME type
# checking is enforced for module scripts ». Symptôme : spinner infini.
#
# À placer au niveau \`http\` (s'applique à tous les vhosts) ou dans le \`server\`.
#
# Vérification :
#   curl -sI https://VOTRE-HOTE/vendor/maplibre-gl/global.mjs | grep -i content-type
#   → attendu : content-type: text/javascript
types {
    text/javascript mjs;
}

# Sert les jumeaux \`.gz\` déjà présents à côté de chaque artefact texte. Sans cette
# directive ils existent et ne sont JAMAIS servis : l'original brut part sur le fil.
# (Les \`.br\` demandent \`ngx_brotli\`, un module tiers — voir SERVEUR.md §4.)
gzip_static on;

server {
    listen 443 ssl;
    http2 on;
    server_name VOTRE-HOTE;

    # 🛑 HTTPS N'EST PAS OPTIONNEL. La page déclare \`upgrade-insecure-requests\` : en
    # HTTP nu, le navigateur réécrit toutes les sous-ressources en https:// et chacune
    # échoue. Le service worker et crypto.subtle exigent un contexte sécurisé.
    ssl_certificate     /chemin/vers/fullchain.pem;
    ssl_certificate_key /chemin/vers/privkey.pem;

    root /chemin/vers/ce/dossier;
    index index.html;

    # En-têtes de sécurité. Aucun n'empêche le boot ; tous sont recommandés, et seul le
    # serveur peut les poser — une balise <meta> ne fonctionne pour aucun des trois.
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Content-Security-Policy "frame-ancestors 'self'" always;

    # ⚠️ NE PAS remplacer par \`try_files $uri /index.html\`. Ce n'est pas une application
    # à routes côté client, et un repli global fait RÉUSSIR le pré-cache du service
    # worker sur du HTML — le mode hors-ligne est alors silencieusement corrompu.
    location / {
        try_files $uri $uri/ =404;
    }

    # Artefacts empreintés : leur nom change à chaque build, donc cache maximal.
    # Le motif couvre \`.mjs\` — un \`\\.(js|css)$\` ne le matcherait PAS, et laisserait les
    # plus gros fichiers du dossier sans Cache-Control.
    location ~* \\.(mjs|js|css|woff2?|png|svg)$ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Content-Security-Policy "frame-ancestors 'self'" always;
    }

    # Point d'entrée, bootstrap, manifeste et service worker : toujours revalidés, ils
    # référencent les artefacts empreintés ci-dessus.
    location ~* /(index\\.html|init\\.js|manifest\\.json|sw-core\\.js)$ {
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Content-Security-Policy "frame-ancestors 'self'" always;
    }
}

# Redirection HTTP → HTTPS. Elle rend aussi le slash final, dont l'absence casse tous
# les chemins relatifs du document (SERVEUR.md §3).
server {
    listen 80;
    server_name VOTRE-HOTE;
    return 301 https://$host$request_uri;
}
`;

const HTACCESS = `# ── GeoLeaf — recette Apache ──────────────────────────────────────────────────
#
# ⚠️ CE FICHIER EST INERTE SI \`AllowOverride None\` — le cas par défaut de beaucoup de
# configurations. Il est alors présent, lu par personne, et l'application échoue
# exactement comme s'il était absent. À vérifier dans le vhost AVANT de conclure.
#
# Détail de chaque exigence et de son symptôme : SERVEUR.md.

# 🛑 SANS CETTE LIGNE, RIEN NE BOOTE.
#
# Le moteur cartographique (MapLibre GL JS 6) est ESM-only et entièrement livré en
# \`.mjs\`. Servi sous un type non-JavaScript, le navigateur REFUSE de l'exécuter —
# « Strict MIME type checking is enforced for module scripts ». Symptôme : spinner
# infini, et une console dont seule la PREMIÈRE ligne rouge est la cause.
AddType text/javascript .mjs

# ⚠️ MultiViews doit rester désactivé. Avec lui, la présence de \`fichier.js.gz\` à côté
# de \`fichier.js\` peut faire servir l'archive sans son \`Content-Encoding\` —
# « Uncaught SyntaxError: Invalid or unexpected token ».
Options -MultiViews -Indexes

DirectoryIndex index.html

# Sert les jumeaux \`.gz\` déjà présents. Sans ces règles ils existent et ne sont jamais
# servis. (Retirer le bloc si mod_rewrite ou mod_headers n'est pas disponible : c'est
# une optimisation, pas une condition de fonctionnement.)
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteCond %{HTTP:Accept-Encoding} gzip
    RewriteCond %{REQUEST_FILENAME}.gz -f
    RewriteRule ^(.*)$ $1.gz [QSA,L]
</IfModule>
<IfModule mod_headers.c>
    <FilesMatch "\\.(mjs|js|css|json|geojson|svg|html)\\.gz$">
        Header set Content-Encoding gzip
        Header append Vary Accept-Encoding
    </FilesMatch>
</IfModule>
# Les archives doivent conserver le type de l'original, pas celui de l'archive.
AddType text/javascript .mjs.gz .js.gz
AddType text/css .css.gz
AddType application/json .json.gz

# 🛑 HTTPS N'EST PAS OPTIONNEL — la page déclare \`upgrade-insecure-requests\`, et le
# service worker exige un contexte sécurisé. Décommenter si la redirection n'est pas
# déjà faite en amont (vhost, proxy, CDN) :
# <IfModule mod_rewrite.c>
#     RewriteCond %{HTTPS} !=on
#     RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
# </IfModule>

# En-têtes de sécurité. Aucun n'empêche le boot ; seul le serveur peut les poser.
<IfModule mod_headers.c>
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "DENY"
    Header always set Content-Security-Policy "frame-ancestors 'self'"

    <FilesMatch "\\.(mjs|js|css|woff2?|png|svg)$">
        Header set Cache-Control "public, max-age=31536000, immutable"
    </FilesMatch>
    <FilesMatch "^(index\\.html|init\\.js|manifest\\.json|sw-core\\.js)$">
        Header set Cache-Control "no-cache"
    </FilesMatch>
</IfModule>

# ⚠️ NE PAS ajouter de repli « SPA » (FallbackResource / RewriteRule vers index.html).
# Ce n'est pas une application à routes côté client, et un repli global fait RÉUSSIR le
# pré-cache du service worker sur du HTML : le mode hors-ligne est alors silencieusement
# corrompu, et le défaut ne se voit qu'une fois déconnecté.
`;

/**
 * Rend les trois fichiers d'accompagnement d'une variante livrable.
 *
 * @returns {Record<string, string>} nom de fichier → contenu, prêt à écrire.
 */
function serverContractFiles() {
    return {
        "SERVEUR.md": SERVEUR_MD,
        "nginx.conf.example": NGINX_CONF_EXAMPLE,
        ".htaccess": HTACCESS,
    };
}

module.exports = {
    NO_CONTRACT_VARIANTS,
    carriesServerContract,
    SERVER_CONTRACT_FILES,
    MJS_MIME_TOKEN,
    declaresMjsType,
    serverContractFiles,
};
