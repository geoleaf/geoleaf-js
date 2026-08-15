# Servir ce dossier — contrat serveur

> Émis automatiquement par `build-deploy.cjs` avec la variante. Ne pas éditer sur place :
> le prochain déploiement écrase le dossier.

Ce dossier est une application statique. Il n'exige **aucun** runtime, aucune base de données et
aucun processus — mais il exige **quatre choses de son serveur**, dont deux sans lesquelles rien
ne s'affiche. Chaque section dit le symptôme exact si l'exigence manque, parce qu'aucune ne
produit de message qui la nomme.

Recettes prêtes à coller, dans ce même dossier :

| Serveur | Fichier | Actif tout seul ? |
| --- | --- | --- |
| nginx | `nginx.conf.example` | non — à recopier dans votre vhost |
| Apache | `.htaccess` | **oui**, si `AllowOverride` le permet (voir §8) |

---

## 1. 🛑 Le type MIME de `.mjs` — BLOQUANT

**L'exigence.** Le serveur doit rendre les fichiers `.mjs` avec un type MIME JavaScript.

**Pourquoi.** Le moteur cartographique (MapLibre GL JS 6) est *ESM-only* : il est livré sous
forme de modules `.mjs`, dans `vendor/maplibre-gl/`. Or la table de types par défaut de nginx
ne connaît que `.js` — un `.mjs` part donc en `application/octet-stream`, et les navigateurs
**refusent d'exécuter un module servi sous un type non-JavaScript**. C'est une règle stricte de
la spécification HTML, pas une préférence : il n'y a pas de repli, pas d'avertissement, et
`X-Content-Type-Options: nosniff` (§7) la rend définitive.

**Le symptôme.** La page se charge, le fond et le styles s'affichent, **le spinner tourne
indéfiniment**. En console :

```
global.mjs:1  Failed to load module script: Expected a JavaScript-or-Wasm module script
              but the server responded with a MIME type of "application/octet-stream".
```

⚠️ Les erreurs suivantes — `maplibregl is not defined`, `MapLibre adapter not found`,
`Failed to load layer` répété, `map is not ready` — sont toutes des **conséquences**. Ne pas les
instruire : elles disparaissent toutes avec celle-ci.

**La vérification**, avant même de recharger la page :

```bash
curl -sI https://VOTRE-HOTE/vendor/maplibre-gl/global.mjs | grep -i content-type
```

Attendu : `content-type: text/javascript`. Tant que la réponse est `application/octet-stream`,
inutile d'aller plus loin — rien d'autre ne peut fonctionner.

---

## 2. 🛑 HTTPS — BLOQUANT

**L'exigence.** Servir en HTTPS, avec un certificat reconnu par le navigateur.

**Pourquoi.** Trois raisons indépendantes, dont la première suffit :

1. La politique de sécurité de la page déclare `upgrade-insecure-requests`. Sur un serveur en
   HTTP nu, le navigateur réécrit **toutes** les sous-ressources en `https://` ; si le port 443
   n'écoute pas, chacune échoue en `ERR_CONNECTION_REFUSED`.
2. Le *service worker* (mode hors-ligne, mise en cache) n'existe pas hors contexte sécurisé.
3. `crypto.subtle` et `navigator.storage.persist()`, utilisés par le stockage local, non plus.

⚠️ `localhost` est exempté par les navigateurs — c'est pourquoi un dossier qui fonctionne en
local peut échouer une fois déployé, sans que rien n'ait changé dans le dossier.

**Le symptôme.** Page blanche, console pleine de `net::ERR_` sur des URL en `https://` alors que
la barre d'adresse affiche `http://`.

Un certificat **auto-signé** produit un symptôme voisin mais distinct : la navigation passe après
acceptation de l'exception, et l'enregistrement du service worker échoue quand même.

---

## 3. Le slash final, et le fichier d'index

**L'exigence.** `index.html` doit être servi pour le répertoire, et une URL de répertoire sans
slash final doit être redirigée vers la même avec slash.

**Pourquoi.** Tous les chemins de `index.html` sont **relatifs** — c'est délibéré, cela rend le
dossier déployable dans un sous-répertoire sans le reconstruire. Mais un chemin relatif se résout
contre l'URL du document : servi à `https://hote/carte` (sans slash), le document a pour base
`https://hote/`, et **toutes** les références partent vers le parent.

**Le symptôme.** `403 Forbidden` ou un listing de répertoire s'il manque la directive d'index ;
une page blanche et une console pleine de 404 s'il manque le slash.

---

## 4. `gzip_static` — non bloquant, mais tout est déjà là

**L'exigence.** Activer le service des fichiers pré-compressés.

**Pourquoi.** Chaque artefact texte de ce dossier est accompagné d'un jumeau `.gz` **déjà
produit**. Sans la directive, ces fichiers existent et ne sont **jamais servis** : l'original part
sur le fil. Le plus gros module du moteur pèse 559 Ko bruts contre 139 Ko compressés.

**Le symptôme.** Aucun — c'est précisément le problème. Rien ne casse, le transfert est simplement
quatre fois plus lourd que ce que le dossier permet.

⚠️ Des jumeaux `.br` (Brotli) sont également produits. Les servir demande `ngx_brotli`, un module
tiers qui exige une recompilation de nginx. **Ces fichiers n'ont jamais été éprouvés** par le
projet, qui ne dispose pas de ce module : ne pas les supposer servis au motif qu'ils existent.

---

## 5. Ne pas installer de repli « SPA »

**L'exigence.** Un fichier absent doit rendre un vrai **404**. Ne PAS écrire
`try_files $uri /index.html;`.

**Pourquoi.** Ce n'est pas une application à routes côté client : elle n'a rien à rattraper. Et un
repli global est activement nuisible ici — le service worker pré-cache une liste d'URL avec
`cache.addAll()`, qui est **tout-ou-rien**. Avec un repli, une URL manquante rend du HTML avec un
code 200 : le pré-cache **réussit** en enregistrant du HTML à la place d'un script, et le mode
hors-ligne est silencieusement corrompu. Sans repli, il échoue franchement et l'application
continue en ligne.

**Le symptôme, avec le repli** : tout fonctionne en ligne, et l'application est cassée hors ligne
— le pire ordre de découverte possible. En console : `Uncaught SyntaxError: Unexpected token '<'`.

---

## 6. Ne pas normaliser les chaînes de requête

**L'exigence.** `dist/geoleaf.esm.js?v=71b6e192` doit rester distinct de `dist/geoleaf.esm.js`.

**Pourquoi.** Le suffixe `?v=` est une empreinte de contenu, et le service worker met en cache
**avec** la clé exacte. Un CDN ou un proxy qui retire ou réordonne la chaîne de requête produit un
raté de cache permanent.

**Le symptôme.** L'application fonctionne en ligne, ne démarre jamais hors ligne, et le journal du
service worker signale un pré-cache en échec à chaque chargement.

---

## 7. En-têtes de sécurité

Aucun n'empêche le boot ; tous sont recommandés, et **seul le serveur peut les poser** — une
balise `<meta>` ne fonctionne pour aucun des trois.

| En-tête | Valeur |
| --- | --- |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `frame-ancestors 'self'` |

🛑 **Piège nginx, qui a déjà coûté.** `add_header` **ne s'hérite pas** : un bloc `location` ou
`server` qui déclare son propre `add_header` perd **tous** ceux du bloc parent. Un oubli sur un
seul bloc est donc un trou complet, et parfaitement silencieux.

⚠️ La page porte déjà sa propre politique de contenu en `<meta>`, validée pour MapLibre 6 et sans
aucune origine tierce. Si vous posez une CSP en en-tête HTTP, elle **s'ajoute** à celle-ci : les
deux s'appliquent, et c'est l'intersection qui vaut. Une CSP d'en-tête plus étroite peut donc
casser l'application sans que la page ait changé.

---

## 8. Cache-Control

| Ressource | En-tête | Motif |
| --- | --- | --- |
| `dist/**`, `vendor/**` | `public, max-age=31536000, immutable` | noms empreintés, jamais réécrits |
| `index.html`, `init.js`, `manifest.json` | `no-cache` | référencent les artefacts empreintés |
| `sw-core.js` | `no-cache` | le navigateur doit voir les mises à jour du worker |
| `profiles/**` | `no-cache` ou `max-age=3600` | données métier, selon votre fréquence |

⚠️ Ne pas reprendre le `no-store` du serveur de développement du projet : il est délibéré, et
local.

---

## 9. Spécificités Apache

Le `.htaccess` fourni couvre les mêmes points. Deux réserves :

- **Il est inerte si `AllowOverride None`** — le cas par défaut de nombreuses configurations.
  Le fichier est alors présent, lu par personne, et l'application échoue comme s'il était absent.
  À vérifier dans le vhost avant de conclure.
- **Désactiver `MultiViews`.** Avec `Options +MultiViews`, la présence de `fichier.js.gz` à côté
  de `fichier.js` peut faire servir l'archive sans l'en-tête `Content-Encoding` correspondant.
  Symptôme : `Uncaught SyntaxError: Invalid or unexpected token`. Le `.htaccess` fourni la
  désactive explicitement.

---

## Ordre de diagnostic recommandé

Si l'application ne démarre pas, dans cet ordre — chaque étape rend la suivante lisible :

1. `curl -sI https://VOTRE-HOTE/` → 200, et `content-type: text/html`.
2. `curl -sI https://VOTRE-HOTE/vendor/maplibre-gl/global.mjs` → `content-type: text/javascript`
   (§1). **C'est la cause la plus fréquente, de très loin.**
3. Console du navigateur, **première ligne rouge seulement** — les suivantes en découlent presque
   toujours.
4. Onglet réseau, filtre sur les échecs : un 404 nomme le chemin qui manque.
