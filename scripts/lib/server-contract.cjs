"use strict";
/**
 * server-contract.cjs — what a DELIVERABLE variant demands of its server, written WITH it.
 *
 * ## Why this module exists
 *
 * On 2026-08-09, a `deploy-full` copied as-is onto an nginx production server rendered an
 * infinite spinner. The console said the cause in one word:
 *
 *   Failed to load module script: Expected a JavaScript-or-Wasm module script but the server
 *   responded with a MIME type of "application/octet-stream".
 *
 * nginx's `mime.types` table only knows `js`. Since MapLibre 6, the whole engine is in
 * `.mjs` — so nothing boots. That fact was ALREADY written in the repo, at
 * `docker/nginx.dev.conf`, as "🛑 WITHOUT THIS LINE, NOTHING BOOTS", in a comment that
 * itself admitted the hole: "⚠️ This constraint LIVES OUTSIDE THE REPO for the
 * integrator — no gate can see it on their side".
 *
 * There was no knowledge hole, there was a DISTRIBUTION hole: the knowledge lived in a
 * dev file that does not ship with the folder. The deliverable, for its part, carried no
 * companion file — no `.htaccess`, no `nginx.conf`, no README — and the last text the
 * build printed said "Serve via http", which the shipped CSP makes impossible.
 *
 * ## One corpus, three consumers
 *
 *   • `build-deploy.cjs`                    — emits the three files into each deliverable
 *   • `verify-deploy-server-contract.cjs`   — SC-01/02/03, gates their presence and content
 *   • the internal distribution guide — POINTS here instead of duplicating
 *
 * It is the `lib/boot-assets.cjs` and `productDocsFiles()` pattern, for the same reason:
 * two recipes diverge, and the unmaintained one goes green describing something else.
 *
 * ## ⚠️ The gate does NOT compare these strings to themselves
 *
 * SC-02 re-reads the EMITTED files on disk and looks for the type declaration there.
 * Comparing the generator's output to the generator's constant would be a tautology — the
 * failure mode `verify-app-template.cjs` names in its own header ("a gate fixable by
 * aligning the expectation on the wrong change"). Removing the `mjs` line from here makes
 * SC-02 go red; that is the only property that matters, and it was seen going red on that
 * exact mutation.
 */

const path = require("node:path");

/**
 * Variants only ever served on the workstation, which therefore have no use for a
 * contract meant for the operator of a remote server.
 *
 *   • `deploy-local`    — workstation variant, carries the dev bootstrap and its token
 *   • `deploy-coverage` — instrumented copy, serves the boot-coverage measurement
 *
 * 🛑 **THIS LIST IS NOT `NON_DELIVERABLE` FROM `verify-deploy-no-secrets.cjs`, AND MUST
 * NEVER BE MERGED WITH IT.** The two answer different questions:
 *
 *   • there: "is this variant ALLOWED to carry a secret?" — only `deploy-local` is
 *     exempt, and `deploy-coverage` is scanned **on purpose**, out of caution: an
 *     instrumented copy of a deliverable is a deliverable as far as leaking goes.
 *   • here: "does this variant ship to someone who will have to serve it?" —
 *     `deploy-coverage` ships nowhere, it is only served by the dev nginx.
 *
 * Merging the two would stop the secret scan on `deploy-coverage`, i.e. widen a security
 * hole to save one constant. The partial overlap of the two lists is a coincidence, not a
 * redundancy.
 *
 * ⚠️ The list names the EXCLUDED, never the included: an unknown variant receives the
 * contract. The defect by excess is benign (one extra file in a working folder); the
 * defect by omission is exactly the 08-09 outage.
 */
const NO_CONTRACT_VARIANTS = new Set(["deploy-local", "deploy-coverage"]);

/**
 * @param {string} variantName Variant directory name (`deploy-core`, `deploy-full`…).
 * @returns {boolean} `true` if the variant must carry the server contract.
 */
function carriesServerContract(variantName) {
    return !NO_CONTRACT_VARIANTS.has(path.basename(variantName));
}

/** The three companion files, in reading order. */
const SERVER_CONTRACT_FILES = ["SERVEUR.md", "nginx.conf.example", ".htaccess"];

/** The expected MIME type — the one fragment whose absence prevents boot. */
const MJS_MIME_TOKEN = "text/javascript";

/**
 * Does a recipe actually declare the `.mjs` MIME type?
 *
 * 🛑 **THIS FUNCTION WAS WRITTEN TWICE, AND THE FIRST VERSION WENT GREEN ON THE VERY
 * MUTATION IT EXISTS TO CATCH.** It looked for `"text/javascript"` and `"mjs"` anywhere
 * in the file. Yet both emitted recipes **comment the directive abundantly** —
 * "expected: content-type: text/javascript", "the engine ships as .mjs" (in French in
 * the emitted files) — so both
 * strings stayed present after deleting the directive itself. Measured on 2026-08-09 by
 * replacing `text/javascript mjs;` with `text/css xyz;`: the gate came out **green**,
 * exit 0.
 *
 * It is the defect `verify-app-template.cjs` documents on its own layer ② ("the property
 * was written before being seen to bite"), committed here in the gate invoking the rule.
 * Two corrections follow, neither optional:
 *
 *   ① **Comments are stripped first.** `#` at line start, the only comment of both
 *      formats. Without that, the better documented the recipe, the less the gate bites.
 *   ② **Both tokens must be on the SAME line.** A directive associates a type with an
 *      extension; two distant mentions prove nothing.
 *
 * ⚠️ The final lookahead excludes `.mjs.gz`. The `.htaccess` carries a second line,
 * `AddType text/javascript .mjs.gz .js.gz`, serving the pre-compressed archives: without
 * this exclusion it would satisfy the rule on its own and the MAIN directive could
 * disappear with nothing turning red.
 *
 * @param {string} body Raw content of an `nginx.conf.example` or a `.htaccess`.
 * @returns {boolean}
 */
function declaresMjsType(body) {
    return body
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .some((line) => line.includes(MJS_MIME_TOKEN) && /(?:^|\s)\.?mjs(?![\w.])/.test(line));
}

/**
 * The security headers a shipping recipe MUST declare (SC-04). Each is checked by NAME plus
 * an identifying value token, on an ACTIVE line — never a comment. `Strict-Transport-Security`
 * is deliberately NOT here: it engages the host into HTTPS for `max-age` and an integrator may
 * legitimately hold it back until their HTTPS is stable (see the recipe's own note), so
 * requiring it would punish a correct, cautious deployment.
 */
const SECURITY_HEADER_TOKENS = [
    { name: "X-Content-Type-Options", value: "nosniff" },
    { name: "X-Frame-Options", value: "DENY" },
    { name: "Content-Security-Policy", value: "frame-ancestors" },
];

/**
 * Which of the three required security headers a recipe FAILS to declare on an active line.
 *
 * Same discipline as {@link declaresMjsType}: comments are stripped first (`#` at line start,
 * the one comment form of both nginx and Apache), and the header name and its identifying
 * value must sit on the SAME line — two distant mentions prove nothing. Covers both emitted
 * forms without special-casing: nginx `add_header NAME "VALUE"` and Apache
 * `Header always set NAME "VALUE"` both put name and value on one line.
 *
 * @param {string} body Raw content of an `nginx.conf.example` or a `.htaccess`.
 * @returns {string[]} The names of the missing headers — empty when all three are declared.
 */
function missingSecurityHeaders(body) {
    const active = body.split("\n").filter((line) => !/^\s*#/.test(line));
    return SECURITY_HEADER_TOKENS.filter(
        ({ name, value }) => !active.some((line) => line.includes(name) && line.includes(value))
    ).map(({ name }) => name);
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
| \`Strict-Transport-Security\` | \`max-age=31536000\` — n'a d'effet qu'en HTTPS ; voir la mise en garde ci-dessous |

🛑 **Piège nginx, qui a déjà coûté.** \`add_header\` **ne s'hérite pas** : un bloc \`location\` ou
\`server\` qui déclare son propre \`add_header\` perd **tous** ceux du bloc parent. Un oubli sur un
seul bloc est donc un trou complet, et parfaitement silencieux.

⚠️ La page porte déjà sa propre politique de contenu en \`<meta>\`, validée pour MapLibre 6 et sans
aucune origine tierce. Si vous posez une CSP en en-tête HTTP, elle **s'ajoute** à celle-ci : les
deux s'appliquent, et c'est l'intersection qui vaut. Une CSP d'en-tête plus étroite peut donc
casser l'application sans que la page ait changé.

🛑 **HSTS engage — mesurez sa portée avant de servir.** Les recettes posent
\`Strict-Transport-Security: max-age=31536000\` (un an, **sans** \`includeSubDomains\` ni \`preload\`).
Une fois reçu, le navigateur refuse tout accès HTTP à cet hôte pendant \`max-age\` : c'est la
protection recherchée, mais elle est **difficile à défaire** si le certificat expire ou si l'hôte
doit repasser en HTTP. Ne le servez donc **qu'une fois le HTTPS confirmé stable** — sinon retirez
la ligne jusque-là. Le renforcement (\`; includeSubDomains\`, qui couvre TOUS les sous-domaines,
puis \`; preload\`, quasi irréversible) se décide séparément et après coup.

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
    # HSTS — engage l'hôte en HTTPS pour \`max-age\` (un an ici). C'est la protection
    # voulue, mais elle est DIFFICILE À DÉFAIRE si le certificat expire ou si l'hôte doit
    # repasser en HTTP : RETIREZ cette ligne tant que votre HTTPS n'est pas confirmé stable.
    # Renforcement à décider SÉPARÉMENT : \`; includeSubDomains\` (touche TOUS les
    # sous-domaines) puis \`; preload\` (quasi irréversible). Sans effet, et sans risque, en HTTP.
    add_header Strict-Transport-Security "max-age=31536000" always;

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
        add_header Strict-Transport-Security "max-age=31536000" always;
    }

    # Point d'entrée, bootstrap, manifeste et service worker : toujours revalidés, ils
    # référencent les artefacts empreintés ci-dessus.
    location ~* /(index\\.html|init\\.js|manifest\\.json|sw-core\\.js)$ {
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Content-Security-Policy "frame-ancestors 'self'" always;
        add_header Strict-Transport-Security "max-age=31536000" always;
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
    # HSTS — à activer une fois le HTTPS stable (voir la note de la recette nginx :
    # difficile à révoquer, renforcer par \`; includeSubDomains\`/\`; preload\` délibérément).
    Header always set Strict-Transport-Security "max-age=31536000"

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
 * Renders the three companion files of a deliverable variant.
 *
 * @returns {Record<string, string>} file name → content, ready to write.
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
    SECURITY_HEADER_TOKENS,
    missingSecurityHeaders,
    serverContractFiles,
};
