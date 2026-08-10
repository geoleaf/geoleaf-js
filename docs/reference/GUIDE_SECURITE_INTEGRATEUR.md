# GeoLeaf — Guide de sécurité pour l'intégrateur

**Produit :** GeoLeaf Platform
**Version :** 1.0.0
**Date :** 20 juin 2026

> **Rôle de ce document :** recommandations de durcissement à appliquer **côté hébergeur/intégrateur** lors du déploiement de GeoLeaf. Le cœur applique déjà une défense en profondeur (échappement HTML, validation des URL au sink, aucune origine tierce au chargement, filtrage anti-prototype-pollution) ; ce guide couvre ce qui relève de **votre infrastructure** et de **votre back-office**, hors du contrôle de la bibliothèque.
>
> Référence : `_docs_projet/travail/audits/audit-securite_complet.md` (modèle de menace « profil non fiable »). Recommandation R12.

---

## Table des matières

1. [Modèle de menace](#1-modèle-de-menace)
2. [Content-Security-Policy stricte](#2-content-security-policy-stricte)
3. [En-têtes que SEUL le serveur peut poser](#3-en-têtes-que-seul-le-serveur-peut-poser)
4. [Intégrité du CDN (SRI)](#4-intégrité-du-cdn-sri)
5. [Re-validation des fichiers importés côté serveur](#5-re-validation-des-fichiers-importés-côté-serveur)
6. [Échappement du rendu POI côté serveur](#6-échappement-du-rendu-poi-côté-serveur)
7. [Intégrité des profils non fiables](#7-intégrité-des-profils-non-fiables)
8. [Checklist de déploiement](#8-checklist-de-déploiement)

---

## 1. Modèle de menace

GeoLeaf est configuré par des **profils JSON** (couches, styles, taxonomie POI, thèmes). Le modèle de menace de référence considère qu'un profil — et les données POI qu'il référence — peut être **partiellement non fiable** (édité par un tiers, importé, servi par une API externe). Le cœur valide donc les sorties sensibles au point d'injection (sink) : `href`/`src` validés par `validateUrl`, texte POI échappé, URL de sprite validée avant `fetch`, clés `__proto__`/`constructor`/`prototype` filtrées à la fusion de config.

Cette défense protège le **rendu navigateur**. Elle ne remplace pas les contrôles que vous devez poser sur **votre serveur** : en-têtes HTTP, validation des uploads, échappement si vous pré-rendez du HTML côté serveur, intégrité des profils que vous stockez.

---

## 2. Content-Security-Policy stricte

L'application (`apps/geoleaf-app/index.html`) expose une CSP de référence en `<meta http-equiv>`. En production, **servez-la en en-tête HTTP** (prioritaire sur la balise meta, et seule forme prise en compte pour `frame-ancestors`).

⚠️ **Ce document a recommandé jusqu'au 08/08/2026 une politique PLUS PERMISSIVE que celle qui est livrée**, et il portait deux énoncés faux : une origine `https://unpkg.com` que le document ne charge plus (MapLibre est auto-hébergé depuis S5.4), deux domaines Google que rien ne consomme (Google Fonts supprimé en S5.5), et un `'sha256-…'` présenté comme « le hash du bootstrap inline » **alors qu'`index.html` n'a aucun script inline** — ses quatre `<script>` sont tous externes, et le document le dit lui-même en commentaire. Un guide de durcissement plus laxiste que le produit qu'il durcit se fait suivre à la lettre, et élargit la surface au lieu de la réduire.

Politique recommandée (durcie — `style-src` **sans** `unsafe-inline` : GeoLeaf applique ses styles dynamiques via le CSSOM, non soumis à `style-src`) :

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' blob:;
  style-src 'self';
  img-src 'self' data: https:;
  connect-src 'self' https:;
  font-src 'self' data:;
  worker-src 'self' blob:;
  child-src blob:;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'self';
  upgrade-insecure-requests;
```

Points d'attention :

- **`style-src` sans `'unsafe-inline'`** : depuis la roadmap sécurité **B.5**, GeoLeaf n'a **plus besoin** de `'unsafe-inline'`. Tous les styles dynamiques sont posés via le **CSSOM** (`element.style.setProperty`, helper `GeoLeaf.Helpers.applyCssText`) — non soumis à `style-src` — ou via des **classes CSS** ; les styles inline résiduels (string-emitters du content-builder, attribut `style` du sprite SVG, `<style>` de la démo) ont été refactorés. Un test e2e gardien (`18-security`) valide **0 violation `style-src`** sous CSP stricte. Conservez `style-src` **sans** `'unsafe-inline'`.
- **`script-src`** : `'self' blob:`, sans aucune origine tierce — MapLibre est servi depuis votre propre origine (`vendor/maplibre-gl/`). Aucun hash n'est requis : le document ne porte aucun script inline. ⚠️ `blob:` est conservé parce que MapLibre crée son worker par Blob ; en CSP3 cela relève de `worker-src` (déjà présent) avec `child-src` en repli CSP2, donc `blob:` y est probablement superflu — mais le retirer se vérifie en navigateur avant d'être publié comme recommandation.
- **`'wasm-unsafe-eval'` non requis** : le plugin `realtime-layer` charge son décodeur GTFS-RT — et sa dépendance `protobufjs`/`long`, dont l'initialisation sonde WebAssembly — par **import dynamique à la première utilisation**. La sonde ne s'exécute donc jamais au boot : sans couche GTFS-RT active, **0 violation**. Conservez `script-src` **sans** `'wasm-unsafe-eval'`. Même avec une couche GTFS-RT, la sonde est rattrapée et le décodage bascule sur un chemin JS pur (fonctionnel sans WebAssembly) ; ne l'ajoutez que si vous voulez supprimer la violation `wasm-eval` purement cosmétique à la première utilisation d'une telle couche — c'est un assouplissement **étroit** (n'autorise que la compilation WebAssembly, **pas** `eval()`/`new Function()`).
- **`frame-ancestors`** : n'a d'effet qu'en **en-tête HTTP** (ignoré en `<meta>`). Voir §3.

---

## 3. En-têtes que SEUL le serveur peut poser

Posez ces trois en-têtes au niveau du serveur web (HTTP, **pas** en `<meta>`) :

```
X-Frame-Options: DENY
Content-Security-Policy: frame-ancestors 'self'
X-Content-Type-Options: nosniff
```

`frame-ancestors` est l'équivalent CSP moderne ; `X-Frame-Options` couvre les navigateurs anciens. Utilisez `SAMEORIGIN` / `frame-ancestors 'self'` si vous devez embarquer la carte dans vos propres pages.

`nosniff` empêche le navigateur de deviner un type MIME contre celui que vous déclarez — un fichier servi en `text/plain` mais interprété comme `text/html` ou `application/javascript` est un vecteur d'exécution. Il compte pour votre application **et** pour tout ce que vous servez à côté (uploads, exports, tuiles).

> 🛑 **Ces trois en-têtes ne sont JAMAIS honorés en balise `<meta http-equiv>`.** C'est vrai depuis toujours pour `frame-ancestors`, et c'est **aussi** vrai pour `X-Content-Type-Options` — un point qui se trompe facilement, puisque la syntaxe `<meta http-equiv>` existe et que rien n'avertit. L'application du dépôt a porté un `<meta http-equiv="X-Content-Type-Options">` jusqu'au 08/08/2026 : il n'a jamais rien protégé, et il faisait **croire** le contraire à toute relecture. Une protection qui a l'air posée est pire qu'une protection absente. Le seul contrôle qui vaut est de **regarder la réponse** :
>
> ```bash
> curl -sI https://votre-domaine/ | grep -i "x-content-type-options\|x-frame-options\|content-security-policy"
> ```

**nginx** :

```nginx
add_header X-Frame-Options "DENY" always;
add_header Content-Security-Policy "frame-ancestors 'self'" always;
add_header X-Content-Type-Options "nosniff" always;
```

> ⚠️ **nginx n'hérite pas `add_header`** : dès qu'un bloc (`server`, `location`) déclare son propre `add_header`, il **perd tous ceux du niveau parent**. Répétez les trois en-têtes dans chaque bloc qui en déclare un, ou passez par un fichier inclus. Un oubli sur un seul `location` est un trou complet, et parfaitement silencieux.

**Traefik** (middleware headers) :

```yaml
http:
    middlewares:
        geoleaf-security:
            headers:
                frameDeny: true
                contentTypeNosniff: true
                contentSecurityPolicy: "frame-ancestors 'self'"
```

> La conf de dev du dépôt (`docker/nginx.dev.conf`) pose ces en-têtes sur chaque variante de déploiement — reprenez-les en production. Elle est gardée par **NGINX-01** (`scripts/verify-app-template.cjs`), qui dérive le nombre de vhosts du fichier plutôt que de l'écrire : un vhost ajouté sans en-tête fait rougir.

---

## 4. Intégrité du CDN (SRI)

**GeoLeaf auto-héberge MapLibre depuis le 08/08/2026** : `build-deploy.cjs` le copie dans `vendor/maplibre-gl/` en le résolvant par `require.resolve`, donc la version servie **est** celle qui est installée — il n'y a plus de numéro de version écrit à la main qui puisse diverger du `peerDependencies`. Le document livré ne porte donc **ni `integrity` ni `crossorigin`**, et c'est délibéré : une SRI same-origin ne protège de rien (elle garde contre un tiers qui n'existe plus) et son hash en dur casse à chaque montée de version — c'est un piège à maintenance, pas une garantie.

Si **vous** choisissez de servir MapLibre depuis un CDN, alors oui : posez `integrity` (SRI `sha384`) et `crossorigin="anonymous"`, régénérez le hash à chaque montée de version, et ajoutez l'origine à `script-src`/`style-src`.

---

## 5. Re-validation des fichiers importés côté serveur

Le plugin `file-import` convertit les fichiers (GeoJSON, GPX, KML, KMZ…) **dans le navigateur**. Cette conversion **n'est pas** un contrôle de sécurité serveur : un client malveillant peut poster n'importe quoi à votre API.

Si vous persistez les fichiers importés, **re-validez côté serveur** :

- Taille maximale et type MIME réels (pas seulement l'extension).
- Parsing strict du contenu (rejeter le XML avec entités externes — XXE — pour GPX/KML).
- Décompression bornée pour KMZ (ZIP) : limiter le ratio et la taille décompressée (anti zip-bomb).
- Ré-échappement de toute propriété texte avant un éventuel rendu serveur (voir §6).

---

## 6. Échappement du rendu POI côté serveur

Le cœur échappe le texte POI et valide `href`/`src` **au moment du rendu navigateur**. Si vous **pré-rendez** des POI côté serveur (SSR, génération de pages statiques, export HTML, e-mails), vous quittez ce périmètre : **échappez vous-même** chaque valeur injectée dans du HTML (texte, attributs, URL) avec l'outillage de votre stack serveur.

En particulier, pour tout `href`/`src` provenant d'une propriété POI : n'autorisez que les schémas `https:` (et `data:image/*` si nécessaire) ; rejetez `javascript:`, `vbscript:`, `data:text/html`.

---

## 7. Intégrité des profils non fiables

Si vous stockez ou éditez des profils via un back-office, traitez-les comme des **entrées non fiables** :

- Validez les profils contre le schéma (le dépôt fournit `validate-profiles` et `check-config-coverage`).
- Confinez toute opération fichier dérivée d'un chemin issu d'un profil : vérifiez que le chemin résolu reste sous le répertoire cible (prévention du path traversal). Le script de build `scripts/build-deploy.cjs` applique déjà ce confinement avant toute suppression de fichier.
- N'exposez jamais un endpoint qui écrit un fichier à un emplacement dérivé sans normalisation d'une valeur contrôlée par le profil.

---

## 8. Checklist de déploiement

- [ ] CSP servie en **en-tête HTTP**, `style-src` sans `unsafe-inline`, `script-src 'self' blob:` **sans hash** — le document ne porte aucun script inline, ses `<script>` sont tous externes.
- [ ] `X-Frame-Options: DENY` + `frame-ancestors 'self'` + `X-Content-Type-Options: nosniff` en en-tête HTTP — **vérifiés sur la réponse** (`curl -sI`), pas dans la conf : c'est la conf qui ment quand un bloc redéclare `add_header`.
- [ ] SRI (`integrity` + `crossorigin`) posé **si et seulement si** vous servez MapLibre depuis un CDN tiers ; hash régénéré à chaque montée de version. Sans objet sur le déployé standard, qui l'auto-héberge.
- [ ] Uploads re-validés côté serveur (taille, type réel, parsing strict, anti zip-bomb).
- [ ] Échappement explicite de tout rendu POI côté serveur.
- [ ] Profils validés contre le schéma ; opérations fichier confinées au répertoire cible.
- [ ] `npm audit` exécuté sur l'arbre livré ; vulnérabilités résiduelles documentées (le runtime livré ne dépend pas du tooling de dev — vitepress/nyc/esbuild).
- [ ] `og:image` **préfixé de l'origine de déploiement** — la spécification Open Graph exige une URL absolue, et une URL relative n'est résolue par aucun robot d'aperçu (Slack, WhatsApp, LinkedIn). C'est un défaut d'aperçu, pas de sécurité, mais il se règle au même moment que le reste de l'en-tête.

⚠️ **La dernière puce a été ajoutée le 08/08/2026 parce qu'`index.html` la citait déjà.** Son commentaire (`apps/geoleaf-app/index.html`, bloc Open Graph) renvoyait l'intégrateur à « la checklist du guide de sécurité » pour cette instruction — qui ne s'y trouvait pas. Un renvoi vers un item inexistant est de la classe que `CLAUDE.md` qualifie de « pire qu'une consigne absente » : il envoie chercher, et la relecture conclut que l'instruction n'existe plus.

🛑 **Et la première puce a demandé « `script-src` avec le hash du bootstrap » jusqu'au 08/08/2026**, alors que le §2 de ce même document réfute ce hash à deux endroits (`:38` et le point d'attention `script-src`). Le commit de clôture de S5.6 a réécrit l'item **immédiatement suivant** — celui sur la SRI — et sauté celui-là : l'édition a procédé item par item, donc corriger un seul item ne prouve rien sur ses voisins.
