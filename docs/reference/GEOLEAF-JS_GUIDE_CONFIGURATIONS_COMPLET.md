# GeoLeaf — Guide complet de toutes les configurations

**Produit :** GeoLeaf Platform V3
**Version :** 2.7.0
**Date :** 27 juillet 2026 — sorti du dossier de tri, relu contre le code

> **Rôle de ce document :** Référence complète et narrative pour les intégrateurs. Chaque paramètre est accompagné de descriptions longues, d'exemples et de notes contextuelles.

> **📊 Vue tabulaire de référence (source de vérité, code-sourcée + testée par-valeur B1→B7) :** consulter **d'abord** le tableau HTML filtrable [`reference_parametres_config.html`](./reference_parametres_config.html) (régénérable via `npm run gen:config-reference` ; par famille / fichier / statut / recherche) ou son inventaire source [`inventaire_config_parametres.md`](./inventaire_config_parametres.md) — puis ce guide pour les descriptions narratives. _(L'ancien tableau `reference_config_json.md` est **supersédé**.)_

> Ce document recense de manière exhaustive **chaque paramètre**, **chaque option** et **chaque configuration** qu'un utilisateur ou intégrateur peut définir dans GeoLeaf. Il démontre la maturité, la richesse fonctionnelle et la flexibilité du produit.

> **📦 Ce qu'il faut COPIER pour auto-héberger :** l'arbre des artefacts est décrit dans **[`usage-cdn.md` §7](../../packages/core/docs/usage-cdn.md)**, qui distingue depuis le 08/08/2026 **deux arbres différents** — celui du **paquet npm** (`esm/`, `types/`, pas de plugin) et celui de l'**application déployée** (bundles de plugins, chunks paresseux, variantes `.br`/`.gz` **servies en priorité**). ⚠️ Les confondre, ou copier un `dist/` sans son `chunks/`, donne une application qui ne boote pas.

> **🔒 Durcissement déploiement :** pour la mise en production (CSP stricte, anti-clickjacking, re-validation des uploads, échappement du rendu POI côté serveur), voir le **[Guide de sécurité pour l'intégrateur](./GUIDE_SECURITE_INTEGRATEUR.md)**.

---

## Table des matières

1. [Synthèse chiffrée](#1-synthèse-chiffrée)
2. [Configuration racine (geoleaf.config.json)](#2-configuration-racine)
3. [Configuration profil (profile.json)](#3-configuration-profil)
4. [Taxonomie (taxonomy.json)](#4-taxonomie)
5. [Thèmes (themes.json)](#5-thèmes)
6. [Registre des couches (layers.json)](#6-registre-des-couches)
7. [Configuration d'une couche (config.json)](#7-configuration-dune-couche)
8. [Configuration d'un style (style.json)](#8-configuration-dun-style)
9. [Configuration popup / tooltip / sidepanel](#9-configuration-popup--tooltip--sidepanel)
10. [Mapping (mapping.json)](#10-mapping)
11. [Configuration basemaps](#11-configuration-basemaps)
    11b. [Configuration ui.json](#11b-configuration-uijson)
12. [Configuration recherche et filtres](#12-configuration-filtre--modulesfilter-capacité-in-core)
13. [Configuration tableau de données](#13-configuration-tableau-de-données--modulestable-plugin)
14. [Configuration gestionnaire de couches](#14-configuration-gestionnaire-de-couches)
15. [Configuration légende](#15-configuration-légende--moduleslegend-capacité-in-core)
16. [Configuration POI et clustering](#16-configuration-poi-et-clustering)
17. [Configuration échelle](#17-configuration-échelle)
18. [Configuration branding](#18-configuration-branding)
19. [Configuration storage / offline](#19-configuration-storage--offline)
20. [~~Configuration AddPOI~~ — retirée, le plugin a fusionné](#20-configuration-addpoi--retirée-le-plugin-a-fusionné)
21. [Configuration performance](#21-configuration-performance)
22. [Configuration debug](#22-configuration-debug-et-logging)
23. [Configuration UI complète](#23-configuration-ui-complète)
24. [Récapitulatif total](#24-récapitulatif-total)
25. [Configuration routes](#25-configuration-routes-capacité-modulesroute)
26. [Configuration OGC API Features (couches)](#26-configuration-ogc-api-features-couches)
27. [Plugin file-import](#27-plugin-file-import)
28. [Plugin flatgeobuf](#28-plugin-flatgeobuf)
29. [Plugin COG](#29-plugin-cog)

---

## 1. Synthèse chiffrée

| Métrique                                        | Valeur                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Fichiers de configuration distincts**         | 10 types (geoleaf.config, profile, taxonomy, themes, layers, layer config, style, mapping, basemaps, ui) |
| **Paramètres configurables (profil)**           | 120+                                                                                                     |
| **Paramètres configurables (par couche)**       | 50+                                                                                                      |
| **Paramètres configurables (par style)**        | 48+                                                                                                      |
| **Types de renderers (popups/tooltips/panels)** | 14 (dont `action` — bouton d'action générique en popup)                                                  |
| **Types de filtres**                            | 6 (search, tree, multiselect-tags, proximity, date-range, slider)                                        |
| **Stratégies de clustering**                    | 4 (unified, by-source, by-layer, json-only)                                                              |
| **Types de basemaps**                           | 6 (raster, maplibre, image, hillshade, wmts, wms)                                                        |
| **Types de thèmes**                             | 2 (primary, secondary)                                                                                   |
| **Types de géométrie**                          | 3 (point, polygon, polyline)                                                                             |
| **Types de hachures**                           | 5 (diagonal, horizontal, vertical, cross, dot)                                                           |
| **Opérateurs styleRules**                       | 16 (==, ===, eq, !=, !==, neq, >, >=, <, <=, contains, startsWith, endsWith, in, notIn, between)         |
| **Composants UI configurables**                 | 11                                                                                                       |
| **Événements système**                          | 44                                                                                                       |

---

## 2. Configuration racine

**Fichier :** `geoleaf.config.json` (racine du projet)  
**Obligatoire :** Non (utilise les défauts si absent)

| #   | Section    | Paramètre                 | Type    | Défaut         | Description                                          | Description longue                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------- | ------------------------- | ------- | -------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `debug`    | —                         | boolean | `false`        | Mode debug global                                    | Active un mode verbeux qui affiche dans la console des logs détaillés pour toutes les opérations GeoLeaf (chargement de couches, rendu de POI, application de filtres, etc.). Très utile lors de l'intégration. À désactiver impérativement en production pour ne pas polluer la console ni dégrader les performances.                                                                                         |
| 2   | `data`     | `activeProfile`           | string  | `"default"`    | Profil actif à charger                               | Indique quel profil métier GeoLeaf doit charger au démarrage. La valeur doit correspondre au nom d'un sous-dossier dans le répertoire des profils (ex. `"tourism"` chargera `profiles/tourism/profile.json`). C'est ce paramètre qui détermine l'ensemble de la configuration : quelles couches, quels thèmes, quelle taxonomie et quelle interface seront présentés à l'utilisateur final.                    |
| 3   | `data`     | `profilesBasePath`        | string  | `"/profiles/"` | Chemin vers les profils                              | Définit le chemin de base où GeoLeaf cherchera les dossiers de profils. Peut être un chemin relatif à la page HTML (`"./profiles/"`) ou une URL absolue vers un CDN ou un serveur distant (`"https://cdn.example.com/geoleaf-profiles/"`). Cela permet de séparer le code applicatif des données de configuration et de centraliser les profils sur un serveur dédié si nécessaire.                            |
| 4   | `data`     | `enableProfilePoiMapping` | boolean | `false`        | Active le mapping POI du profil                      | Quand activé, les données POI sont normalisées en utilisant le fichier `mapping.json` défini dans le profil actif. Ce fichier permet de transformer les noms de propriétés des données source vers les noms attendus par GeoLeaf (ex. `"title"` → `"name"`). Indispensable quand les données proviennent de sources externes avec des conventions de nommage différentes.                                      |
| 5   | `data`     | `useProfilePoiMapping`    | boolean | —              | ⚠️ **Déprécié** — utiliser `enableProfilePoiMapping` | Nom alternatif pour le même paramètre. `enableProfilePoiMapping` est prioritaire si les deux sont définis. Conservé pour compatibilité.                                                                                                                                                                                                                                                                        |
| 6   | `data`     | `useMapping`              | boolean | —              | ⚠️ **Déprécié** — utiliser `enableProfilePoiMapping` | Alias le plus court. Vérifié en dernier dans la chaîne de résolution. `enableProfilePoiMapping` > `useProfilePoiMapping` > `useMapping`.                                                                                                                                                                                                                                                                       |
| 8   | `branding` | `enabled`                 | boolean | —              | Afficher le branding                                 | Permet d'afficher un texte de marque ou de crédit sur la carte (par exemple le nom du client, du projet ou de l'éditeur). Le branding apparaît comme un petit bandeau semi-transparent positionné sur la carte. Utile pour les déploiements professionnels où l'on souhaite identifier la solution utilisée ou créditer l'auteur.                                                                              |
| 9   | `branding` | `text`                    | string  | —              | Texte du branding                                    | Le texte qui sera affiché dans le bandeau de branding sur la carte. Par exemple `"Propulsé par GeoLeaf"` ou `"© MonEntreprise 2026"`. Supporte le texte simple uniquement (pas de HTML pour des raisons de sécurité XSS).                                                                                                                                                                                     |
| 10  | `branding` | `position`                | string  | —              | Position du branding                                 | Définit le coin de la carte où le bandeau de branding est placé. Utilise les positions MapLibre GL standard : `"topleft"`, `"topright"`, `"bottomleft"`, `"bottomright"`. Permet de s'assurer que le branding ne chevauche pas d'autres contrôles (légende, gestionnaire de couches, etc.).                                                                                                                    |
| 11  | `security` | `httpsOnly`               | boolean | `false`        | Forcer HTTPS                                         | Quand activé, GeoLeaf refuse de charger des ressources (tuiles, données GeoJSON, styles MapLibre) servies en HTTP non sécurisé. Toute URL non-HTTPS déclenche un avertissement dans la console et la ressource n'est pas chargée. Recommandé en production pour prévenir les attaques de type mixed-content et les fuites de données.                                                                          |
| 12  | `logging`  | `level`                   | string  | `"info"`       | Niveau de log                                        | Seuil de gravité minimum des messages affichés dans la console : `"debug"` = tout afficher, `"info"` = messages informatifs et plus (défaut), `"warn"` = avertissements et erreurs, `"error"` = erreurs critiques uniquement, `"production"` = aucun message (mode silencieux). Indépendant de `debug` : `logging.level` contrôle la verbosité globale, `debug` active les traces de développement détaillées. |

---

## 3. Configuration profil

**Fichier :** `profiles/{id}/profile.json`  
**Obligatoire :** Oui (chaque profil doit en avoir un)

> **Layout profil v2 (2026-06)** — `profile.json` ne contient plus que l'identité du profil (`id`, `label`, `description`, `version`), la section `map` et le manifeste `Files`. Toute la configuration vit dans deux dossiers :
>
> ```
> profiles/{id}/
> ├── profile.json                  ← identité + map + Files uniquement
> ├── config/
> │   ├── core/                     ← taxonomy / themes / layers / basemaps / ui / features
> │   └── plugins/{module-id}.json  ← un fichier par plugin configuré (storage, editor…)
> ├── layers/{layer-id}/            ← config + styles + data par couche (inchangé)
> ├── icons/                        ← sprites SVG (inchangé)
> └── data/                         ← données partagées (inchangé)
> ```
>
> Les anciens emplacements racine (`profiles/{id}/taxonomy.json`…) ne sont plus utilisés par les profils livrés ; le loader résout les chemins déclarés dans `Files`. En déploiement, `profile-bundle.json` (généré au build) fusionne toutes ces sections en un seul fetch — pour éditer un profil déployé à chaud, supprimer `profile-bundle.json` ou activer `debug: true` (le bundle est alors ignoré).

### 3.1 Métadonnées

| #   | Paramètre     | Type   | Obligatoire | Description                  | Description longue                                                                                                                                                                                                                                                                                                   |
| --- | ------------- | ------ | ----------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `id`          | string | Oui         | Identifiant unique du profil | Identifiant technique du profil, utilisé en interne par GeoLeaf pour charger les fichiers, émettre des événements et stocker les préférences. Doit être alphanumérique sans espaces (ex. `"tourism"`, `"my-custom-profile"`). C'est cette valeur qui est référencée dans `geoleaf.config.json > data.activeProfile`. |
| 2   | `label`       | string | Oui         | Nom d'affichage              | Nom lisible par un humain, affiché dans les logs, dans l'interface de sélection de profil (si multi-profil) et dans les messages de démarrage. Par exemple `"Profil Tourisme"` ou `"Cartographie Patrimoine"`.                                                                                                       |
| 3   | `description` | string | Non         | Description détaillée        | Texte libre décrivant l'usage prévu du profil. Principalement documentaire, il peut être affiché dans une interface de sélection de profil ou servir de mémo pour le configurateur. Par exemple `"Profil dédié aux applications touristiques avec 35 couches et 16 thèmes"`.                                         |
| 4   | `version`     | string | Non         | Version SemVer               | Version du profil au format X.Y.Z (ex. `"3.0.0"`). Utilisée par le système de chargement pour détecter le format du profil (v2 vs v3 modulaire) et par le cache pour invalider les données obsolètes. Permet aussi de suivre les évolutions du profil dans le temps.                                                 |

### 3.2 Section `map` (carte)

| #   | Paramètre            | Type            | Défaut    | Description                   | Description longue                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------- | --------------- | --------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | `map.bounds`         | `[[S,W],[N,E]]` | —         | Emprise géographique initiale | Définit la zone géographique visible au premier chargement de la carte, au format `[[latitude_sud, longitude_ouest], [latitude_nord, longitude_est]]` en WGS84. Par exemple `[[-58.39, -73.58], [-21.78, -34.67]]` pour afficher l'Argentine. La carte effectuera un `fitBounds()` automatique sur cette emprise. C'est aussi cette emprise qui sert de limite de navigation si `positionFixed` est activé.                       |
| 6   | `map.initialMaxZoom` | number          | `12`      | Zoom max du fitBounds initial | Empêche le `fitBounds()` initial de zoomer trop fort sur une petite emprise. Par exemple, si les bounds ne couvrent qu'un quartier, sans ce plafond la carte zoomerait au niveau rue. Ce paramètre ne limite PAS le zoom utilisateur pendant la navigation — il contrôle uniquement le niveau de zoom au tout premier affichage.                                                                                                  |
| 7   | `map.padding`        | `[v,h]`         | `[50,50]` | Marge du fitBounds            | Ajoute une marge en pixels autour de l'emprise lors du `fitBounds()` initial, pour éviter que les bords de la zone géographique collent aux bords du conteneur HTML. `[50, 50]` signifie 50 pixels de marge en haut/bas et 50 pixels en gauche/droite. Augmenter ces valeurs si des panneaux UI superposés (légende, filtres) risquent de masquer les bords de la carte.                                                          |
| 8   | `map.positionFixed`  | boolean         | `false`   | Restreindre la navigation     | Quand activé, l'utilisateur ne peut plus naviguer (pan) au-delà de l'emprise définie dans `bounds`. Il conserve une liberté de mouvement grâce à une marge configurable (`boundsMargin`), mais un effet élastique ("rubber-band") le ramène dans la zone si il s'éloigne trop. Utile pour les applications métier centrées sur un territoire précis (une commune, une région) où il n'y a aucun intérêt à voir le reste du monde. |
| 9   | `map.boundsMargin`   | number          | `0.3`     | Marge autour des bounds       | Facteur de marge (0 à 1) ajouté autour de l'emprise quand `positionFixed` est activé. `0.3` signifie que l'utilisateur peut dépasser de 30% l'emprise définie dans `bounds` avant d'être rappelé par l'effet élastique. `0` = très restrictif (l'utilisateur ne peut pas du tout dépasser les bounds), `1` = très libre (il peut dépasser de 100%). Ignoré si `positionFixed` est `false`.                                        |
| 10  | `map.minZoom`        | number          | `3`       | Zoom minimum                  | Empêche l'utilisateur de dézoomer trop et de voir le reste du monde quand `positionFixed` est activé. Une valeur de 3 correspond environ à un zoom continental. Augmenter cette valeur si le territoire est petit (ex. 8 pour une ville). Ignoré si `positionFixed` est `false` — dans ce cas, c'est le minZoom du basemap qui s'applique.                                                                                        |
| 10b | `map.target`         | string          | —         | Sélecteur CSS du conteneur    | Sélecteur CSS de l'élément HTML dans lequel GeoLeaf doit initialiser la carte. Par exemple `"#map"` ou `".geoleaf-container"`. Prioritaire sur `map.id`. Permet une intégration dans n'importe quel élément DOM sans contrainte d'identifiant.                                                                                                                                                                                    |
| 10c | `map.id`             | string          | —         | ID du conteneur (alias)       | Identifiant de l'élément HTML conteneur de la carte (sans le `#`). Alias de `map.target` avec une syntaxe simplifiée. `map.target` est prioritaire si les deux sont définis. Par exemple `"map"` pour un élément `<div id="map">`.                                                                                                                                                                                                |
| 10d | `map.center`         | `[lat, lng]`    | —         | Centre initial de la carte    | Coordonnées `[latitude, longitude]` du centre de la carte au premier chargement, en WGS84. Par exemple `[46.5, 2.3]` pour centrer la France. Si `bounds` est également défini, `fitBounds()` est prioritaire et `center` est ignoré.                                                                                                                                                                                              |
| 10e | `map.zoom`           | number          | —         | Zoom initial                  | Niveau de zoom de la carte au premier chargement. Valeurs typiques : 5 = vue pays, 10 = agglomération, 14 = quartier, 17 = rue. Ignoré si `bounds` est défini (le zoom est alors calculé par `fitBounds()`).                                                                                                                                                                                                                      |
| 10f | `map.maxZoom`        | number          | —         | Zoom maximum utilisateur      | Niveau de zoom maximum autorisé pour l'utilisateur. Au-delà, le zoom est bloqué. Complémentaire au `maxZoom` du basemap : la valeur effective est le minimum des deux. Permet de limiter la précision visible selon le contexte métier.                                                                                                                                                                                           |
| 10g | `map.mapOptions`     | object          | —         | Options MapLibre GL brutes    | Objet d'options passé directement au constructeur MapLibre GL. Permet d'accéder à toutes les options MapLibre GL non exposées par GeoLeaf (ex. `{ antialias: true }`). Les options de GeoLeaf (`center`, `zoom`, etc.) ont priorité et ne peuvent pas être surchargées via ce champ.                                                                                                                                              |

### 3.3 Section `Files`

| #   | Paramètre                | Type   | Valeur layout v2                                | Description                | Description longue                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------ | ------ | ----------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11  | ~~`Files.taxonomyFile`~~ | —      | **retiré (Lot 2)**                              | Fichier taxonomie (retiré) | **Retiré (Lot 2, 11/07/2026).** L'ancien fichier `config/core/taxonomy.json` et cette clé ne sont plus chargés. La taxonomie (icônes + catégories) vit désormais dans `config/plugins/taxonomy.json` (bloc `modules.taxonomy`, déclaré via `Files.modules.taxonomy`) — voir §4.                                                                                                          |
| 12  | `Files.themesFile`       | string | `"config/core/themes.json"`                     | Fichier thèmes             | Chemin relatif vers le fichier JSON définissant les thèmes (presets de visibilité des couches). Chaque thème contrôle quelles couches sont visibles ou masquées quand l'utilisateur le sélectionne. Par exemple, un thème "Environnement" masquera les couches administratives et affichera les zones protégées.                                                                         |
| 13  | `Files.layersFile`       | string | `"config/core/layers.json"`                     | Registre des couches       | Chemin relatif vers le fichier JSON qui recense toutes les couches GeoJSON disponibles dans ce profil. Ce fichier contient un tableau de références : chaque entrée pointe vers un fichier de configuration de couche individuel. C'est le point d'entrée pour le système de couches.                                                                                                    |
| 13b | `Files.basemapsFile`     | string | `"config/core/basemaps.json"`                   | Fonds de carte             | Chemin relatif vers le fichier JSON listant les fonds de carte proposés. Son contenu est fusionné à la racine du profil consolidé (clé `basemaps`).                                                                                                                                                                                                                                      |
| 13c | `Files.uiFile`           | string | `"config/core/ui.json"`                         | Configuration UI           | Chemin relatif vers le fichier JSON de configuration de l'interface (`ui`, `layerManagerConfig`, `scaleConfig`). Son contenu est fusionné à la racine du profil consolidé.                                                                                                                                                                                                               |
| 13d | `Files.featuresFile`     | string | `"config/core/features.json"`                   | Features core              | Chemin relatif vers le fichier JSON des features core transverses : `clusteringConfig`, `performance`, `poiConfig`, `mapOptions`. Son contenu est fusionné à la racine du profil consolidé — ces clés restent des clés racine, hors `modules.*`. _(`geocodingConfig` a été extrait vers le plugin `@geoleaf-plugins/geocoding` — voir `modules.geocoding`, §23bis.)_                     |
| 13e | `Files.modules`          | object | `{"offline": "config/plugins/offline.json", …}` | Configs plugins            | Dictionnaire id de module → chemin du fichier de configuration du plugin (Plugin Contract v1). Chaque fichier contient le bloc `modules.<id>` correspondant ; le core ne valide pas son contenu (INV-CONFIG). Les fichiers sont chargés en parallèle des sections core ; un bloc `modules.<id>` déclaré inline dans `profile.json` prime sur le fichier (deepMerge, tableaux remplacés). |

### 3.4 Section `ui` (interface utilisateur)

| #   | Paramètre                        | Type    | Défaut   | Description                 | Description longue                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------------- | ------- | -------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | `ui.theme`                       | string  | `"auto"` | Thème visuel                | Définit le thème graphique de l'interface utilisateur au démarrage : `"light"` (fond clair, texte sombre), `"dark"` (fond sombre, texte clair) ou `"auto"` (suit la préférence système `prefers-color-scheme`). L'utilisateur peut ensuite basculer entre les modes via le toggle thème dans l'interface. Ce choix affecte les panneaux (légende, filtres, gestionnaire de couches), les popups, les notifications et tous les éléments UI — mais pas le fond de carte.                       |
| 15  | `ui.language`                    | string  | `"fr"`   | Langue de l'interface       | Prépare l'internationalisation (i18n) de l'interface. Actuellement, l'interface est en français ; ce paramètre stocke la préférence linguistique en vue d'une future prise en charge multilingue. Valeurs attendues : codes ISO 639-1 (`"fr"`, `"en"`, `"es"`, etc.).                                                                                                                                                                                                                         |
| 16  | `ui.showBaseLayerControls`       | boolean | `true`   | Sélecteur de fonds de carte | Permet à l'utilisateur de voir et utiliser un contrôle pour basculer entre les différents fonds de carte disponibles (Street, Satellite, Topographique, etc.). Quand désactivé, le fond de carte par défaut est affiché sans possibilité de changement. Utile à désactiver si l'application n'a qu'un seul basemap ou si le choix se fait via le gestionnaire de couches.                                                                                                                     |
| 17  | `ui.showLayerManager`            | boolean | `true`   | Gestionnaire de couches     | Permet à l'utilisateur d'afficher ou masquer sur la carte le panneau du gestionnaire de couches. Ce panneau liste toutes les couches GeoJSON disponibles, organisées en sections, avec des checkboxes pour activer/désactiver chaque couche individuellement, des boutons pour basculer les labels, et un sélecteur de style si la couche en propose plusieurs. C'est le contrôle central pour la navigation dans les données.                                                                |
| 18  | `modules.filter.enabled`         | boolean | `true`   | Panneau de filtres          | Active la capacité de filtre (barre de recherche texte, filtres par catégorie/sous-catégorie, tags, proximité GPS). **Ex-`ui.showFilterPanel`** — migré vers la capacité in-core `filter` (`modules.filter.enabled`, opt-out). Voir §12.                                                                                                                                                                                                                                                      |
| 19  | `ui.showGeolocation`             | boolean | `true`   | Géolocalisation GPS         | Affiche un bouton de géolocalisation sur la carte. Quand l'utilisateur clique dessus, le navigateur demande l'autorisation d'accéder au GPS, puis centre la carte sur la position de l'utilisateur avec un cercle de précision. Un second clic active le suivi continu (la carte suit les déplacements). Indispensable pour les applications mobiles terrain ; peut être désactivé pour les applications bureau pures.                                                                        |
| 20  | `ui.showCoordinates`             | boolean | `true`   | Affichage coordonnées       | Affiche en permanence les coordonnées géographiques (latitude/longitude) du curseur de la souris sur la carte. L'affichage se met à jour en temps réel au survol. Utile pour les utilisateurs techniques (géomaticiens, cartographes) qui ont besoin de repérer précisément des positions. Peut être désactivé pour les interfaces grand public où cette information est superflue.                                                                                                           |
| 21  | `modules.theme-selector.enabled` | boolean | `true`   | Sélecteur de thèmes         | Affiche le composant de sélection de thèmes sur la carte. Les thèmes primaires apparaissent sous forme de barre horizontale avec des boutons (icônes + labels) au-dessus de la carte, et les thèmes secondaires dans un dropdown dans le gestionnaire de couches. Permet à l'utilisateur de basculer instantanément entre des contextes métier (ex. Administration, Environnement, Tourisme, Climat mensuel).                                                                                 |
| 22  | `modules.legend.enabled`         | boolean | `true`   | Légende de la carte         | Affiche le panneau de légende sur la carte. La légende est générée automatiquement à partir des couches actives et de leurs styles : elle montre les couleurs, les hachures, les symboles et les labels de chaque entrée de légende définie dans les fichiers de style. **Ex-`ui.showLegend`** — migré vers la capacité in-core `legend` (`modules.legend.enabled`, opt-out, voir §15). Elle se met à jour dynamiquement quand l'utilisateur active/désactive des couches ou change de thème. |
| 23  | `ui.showCacheButton`             | boolean | `false`  | Bouton cache offline        | Affiche un bouton permettant à l'utilisateur de gérer le cache hors-ligne (téléchargement des données et tuiles pour utilisation sans réseau). Ce bouton ouvre une modale avec les options de cache, la progression des téléchargements et les statistiques de stockage. **Requiert le plugin Storage** — si le plugin n'est pas chargé, le bouton ne fait rien et un message d'avertissement est affiché dans la console.                                                                    |
| 25  | `ui.showTable`                   | boolean | —        | Tableau de données          | Affiche un tableau tabulaire en bas de la carte listant les entités géographiques (POI, features GeoJSON) de la couche active. L'utilisateur peut trier les colonnes, effectuer une recherche dans le tableau, et cliquer sur une ligne pour zoomer sur l'élément correspondant sur la carte. Le tableau se synchronise avec les filtres appliqués.                                                                                                                                           |
| 26  | `ui.interactiveShapes`           | boolean | —        | Formes GeoJSON cliquables   | Rend les polygones et lignes GeoJSON cliquables par l'utilisateur. Quand activé, un clic sur un polygone (ex. un département, une zone protégée) déclenche l'affichage du popup ou du panneau latéral avec les informations de cette feature. Quand désactivé, les formes sont purement visuelles et ne réagissent pas aux clics.                                                                                                                                                             |

### 3.5 Section `performance`

| #   | Paramètre                            | Type    | Défaut | Description                     | Description longue                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------ | ------- | ------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 27  | `performance.maxConcurrentLayers`    | number  | —      | Couches chargées en parallèle   | Nombre maximum de couches GeoJSON téléchargées et rendues simultanément lors du chargement d'un thème. Si un thème active 15 couches et que ce paramètre est à 3, les couches seront chargées par groupes de 3 successivement. Permet d'éviter un pic de charge réseau et un blocage du rendu si de nombreuses couches lourdes sont activées simultanément. |
| 28  | `performance.layerLoadDelay`         | number  | —      | Délai entre chargements (ms)    | Ajoute un délai en millisecondes entre le chargement de chaque couche. Permet de lisser la charge CPU/réseau et d'éviter un effet de "gel" de l'interface si de nombreuses couches sont chargées en même temps. Une valeur de 100 à 300 ms suffit généralement. À 0, toutes les couches sont lancées aussi vite que possible.                               |
| 29  | `performance.fitBoundsOnThemeChange` | boolean | —      | Recadrer au changement de thème | Quand activé, la carte effectue automatiquement un `fitBounds()` sur l'emprise des couches visibles chaque fois que l'utilisateur change de thème. Cela garantit que l'utilisateur voit toujours la totalité des données du nouveau thème. Quand désactivé, la carte conserve sa position et son zoom actuels lors du changement de thème.                  |

---

## 4. Taxonomie

> **⚠️ MAJ Lot 2 (11/07/2026) :** la taxonomie ne vit plus dans `config/core/taxonomy.json` (fichier **retiré**, ainsi que `Files.taxonomyFile`). Les icônes et catégories sont désormais dans **`config/plugins/taxonomy.json`** sous le bloc **`modules.taxonomy`** (déclaré via `Files.modules.taxonomy`), source unique lue par la capacité `GeoLeaf.Taxonomy`. Correspondance avec les tables §4.1-4.3 (structure historique) : `icons.*` → **`modules.taxonomy.icons.*`** (mêmes clés `spriteUrl` / `symbolPrefix` / `defaultIcon`, + optionnelle `showOnMap?` booléen défaut « on ») ; `categories.*` → **`modules.taxonomy.taxonomies.<ref>.categories.*`** (l'icône est sous **`svgId`** et non `icon`). La section `defaults` (§4.2) est supprimée — utiliser `icons.defaultIcon`.

**Fichier :** `profiles/{id}/config/plugins/taxonomy.json` (bloc `modules.taxonomy`, déclaré via `Files.modules.taxonomy`)  
**Obligatoire :** Non (capacité opt-in — `modules.taxonomy.enabled: true`)

### 4.1 Section `icons`

| #   | Paramètre            | Type   | Description                    | Description longue                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------- | ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 30  | `icons.spriteUrl`    | string | Chemin du sprite SVG           | Chemin relatif vers le fichier sprite SVG contenant toutes les icônes utilisées pour les marqueurs POI sur la carte. Un sprite regroupe toutes les icônes dans un seul fichier, ce qui évite des dizaines de requêtes HTTP individuelles et améliore les performances. Chaque icône est identifiée par un `<symbol id="...">` dans le SVG. |
| 31  | `icons.symbolPrefix` | string | Préfixe des IDs dans le sprite | Préfixe ajouté avant l'ID de l'icône quand GeoLeaf cherche le symbole dans le sprite SVG. Par exemple, si le prefix est `"icon-"` et que la catégorie a l'icône `"hotel"`, GeoLeaf cherchera `<symbol id="icon-hotel">` dans le sprite. Permet de nommer les symboles de manière organisée dans le SVG.                                    |
| 32  | `icons.defaultIcon`  | string | Icône par défaut               | ID de l'icône utilisée quand un POI n'a pas de catégorie assignée ou quand la catégorie n'a pas d'icône définie. Cette icône "fallback" garantit qu'aucun marqueur ne s'affiche sans icône, même si la configuration est incomplète. Typiquement une icône générique comme un point ou un marqueur.                                        |

### 4.2 Section `defaults`

| #   | Paramètre       | Type   | Description    | Description longue                                                                                                                                                                                                                                                                           |
| --- | --------------- | ------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 33  | `defaults.icon` | string | Icône fallback | Icône utilisée en dernier recours si aucune icône n'est trouvée — ni pour la catégorie, ni pour la sous-catégorie, ni dans `icons.defaultIcon`. Ce double fallback garantit qu'un marqueur a toujours un rendu visuel, quelles que soient les lacunes dans la configuration de la taxonomie. |

### 4.3 Section `categories`

| #   | Paramètre                                  | Type   | Description                 | Description longue                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------ | ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 34  | `categories.{id}`                          | object | Définition d'une catégorie  | Chaque catégorie est définie comme une clé dans l'objet `categories`. L'ID (la clé) correspond au `categoryId` des POI dans les données GeoJSON. Par exemple, `"HEBERGEMENT"` regroupe tous les POI dont la propriété `categoryId` vaut `"HEBERGEMENT"`. Une catégorie contient un label, une icône et optionnellement des sous-catégories. |
| 35  | `categories.{id}.label`                    | string | Nom affiché de la catégorie | Nom lisible affiché dans le panneau de filtres, dans les badges des popups, dans le gestionnaire de couches et dans la légende. Par exemple `"Hébergement"`, `"Culture"`, `"Nature"`. Ce label est ce que l'utilisateur final voit pour identifier une famille de POI.                                                                      |
| 36  | `categories.{id}.icon`                     | string | Icône de la catégorie       | ID du symbole dans le sprite SVG utilisé pour représenter cette catégorie sur la carte et dans l'interface (filtres, légende). Par exemple `"hotel"` pour la catégorie Hébergement. GeoLeaf combinera ce nom avec le `symbolPrefix` pour trouver le symbole dans le sprite.                                                                 |
| 37  | `categories.{id}.subcategories`            | object | Sous-catégories             | Objet contenant les sous-catégories de cette catégorie. Chaque sous-catégorie affine le classement des POI. Par exemple, sous "Hébergement" : "Hôtel", "Camping", "Gîte". Les sous-catégories sont utilisées dans les filtres arborescents, les badges des popups et l'attribution des icônes.                                              |
| 38  | `categories.{id}.subcategories.{id}.label` | string | Nom de la sous-catégorie    | Nom lisible de la sous-catégorie, affiché dans les filtres, les badges et le panneau latéral. Par exemple `"Camping"`, `"Musée"`, `"Randonnée"`.                                                                                                                                                                                            |
| 39  | `categories.{id}.subcategories.{id}.icon`  | string | Icône de la sous-catégorie  | ID du symbole dans le sprite SVG pour cette sous-catégorie. Permet d'avoir des icônes différentes au sein d'une même catégorie : par exemple, une tente pour "Camping" et un lit pour "Hôtel" sous la catégorie "Hébergement". Si absent, l'icône de la catégorie parente est utilisée.                                                     |

### 4.4 Section `render` — icône de catégorie à côté du titre (`config/plugins/taxonomy.json` → `modules.taxonomy.render`)

Par symétrie avec `showIconsOnMap` (icônes sur la carte, §7.1), le bloc `render` de `modules.taxonomy` active l'affichage de l'**icône du POI à côté du titre** des surfaces d'info (popup, tooltip, sidepanel) — le comportement historique, rétabli. Opt-in : chaque flag vaut `false` par défaut (aucune icône tant qu'un profil ne l'active pas). L'icône affichée est celle du POI, résolue par priorité **sous-catégorie → catégorie → icône par défaut** : `showIconCategory` autorise l'icône de la catégorie, `showIconSubcategory` privilégie celle de la sous-catégorie (plus spécifique) quand elle existe. Prérequis : `modules.taxonomy.enabled`, couche liée (`modules.taxonomy.layers.<id>.use`), capacité feature-info active, et une surface qui affiche un titre.

| #   | Paramètre                              | Type    | Description                             | Description longue                                                                             |
| --- | -------------------------------------- | ------- | --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| —   | `render.popup.showIconCategory`        | boolean | Icône catégorie dans le popup           | Autorise l'icône de la catégorie à côté du titre du popup. Défaut `false`.                     |
| —   | `render.popup.showIconSubcategory`     | boolean | Icône sous-catégorie dans le popup      | Privilégie l'icône de la sous-catégorie (au titre du popup) quand elle existe. Défaut `false`. |
| —   | `render.tooltip.showIconCategory`      | boolean | Icône catégorie dans le tooltip         | Affiche l'icône de la catégorie dans le tooltip de survol. Défaut `false`.                     |
| —   | `render.tooltip.showIconSubcategory`   | boolean | Icône sous-catégorie dans le tooltip    | Idem sous-catégorie, tooltip. Défaut `false`.                                                  |
| —   | `render.sidepanel.showIconCategory`    | boolean | Icône catégorie dans le panneau latéral | Affiche l'icône de la catégorie dans le sidepanel. Défaut `false`.                             |
| —   | `render.sidepanel.showIconSubcategory` | boolean | Icône sous-catégorie dans le sidepanel  | Idem sous-catégorie, sidepanel. Défaut `false`.                                                |

```jsonc
// config/plugins/taxonomy.json
"render": {
    "popup":     { "showIconCategory": true,  "showIconSubcategory": false },
    "tooltip":   { "showIconCategory": true,  "showIconSubcategory": false },
    "sidepanel": { "showIconCategory": true,  "showIconSubcategory": true  }
}
```

### 4.5 Le symbole du point — `iconColor`, `marker`, `colorBadges` (taxonomy v3, 14/07/2026)

> **Ce que taxonomy gère, et ce qu'elle ne gère pas.** Elle possède le **symbole** du point : l'icône, sa couleur, sa pastille, et la couleur des badges pill dans les surfaces d'info. Elle ne gère **ni la couleur de la géométrie** (remplissage de polygone, trait de polyligne, couleur métier des points) **ni la taille du point** — cela reste au `styleRules` de chaque couche.
>
> ⚠️ **`categories.{id}.colorFill` / `.colorStroke` / `.color` n'existent plus.** Elles étaient documentées comme colorant polygones et polylignes par catégorie ; en réalité elles ne peignaient rien (le module qui les lisait n'était jamais activé). Pour colorer une géométrie par attribut, utiliser les `styleRules` de la couche — `when.field` accepte n'importe quel attribut, y compris `properties.categoryId`.

**La règle de composition : taxonomy remplace le DÉFAUT.** Les `styleRules` de la couche gardent la priorité ; c'est seulement la valeur _par défaut_ du point qui devient la couleur de la catégorie. Cascade effective :

```
styleRules de la couche  >  sous-catégorie  >  catégorie  >  défaut du style de couche
```

Conséquence à connaître : si les `styleRules` d'une couche couvrent **toutes** les valeurs rencontrées (par ex. une règle par valeur de `fclass`), la branche par défaut n'est jamais atteinte et **la couleur de pastille n'y sera pas visible**. C'est le comportement voulu — le style de la couche gagne.

| #   | Paramètre                            | Type              | Description              | Description longue                                                                                                                                                                                                                              |
| --- | ------------------------------------ | ----------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | `categories.{id}.iconColor`          | string            | Couleur du glyphe        | Couleur de l'icône elle-même. Absent ⇒ **blanc** (le rendu historique). Une sous-catégorie hérite de la couleur de sa catégorie si elle n'en déclare pas.                                                                                       |
| —   | `categories.{id}.marker`             | object \| `false` | La pastille sous l'icône | **Absent** ⇒ taxonomy ne surcharge rien, le style de la couche garde la main. **Objet** ⇒ une pastille est peinte. **`false`** ⇒ **icône nue** : ni fond ni bordure.                                                                            |
| —   | `categories.{id}.marker.fill`        | string            | Fond de la pastille      | Couleur de remplissage du disque (`circle-color`).                                                                                                                                                                                              |
| —   | `categories.{id}.marker.stroke`      | string            | Bordure de la pastille   | Couleur du contour (`circle-stroke-color`).                                                                                                                                                                                                     |
| —   | `categories.{id}.marker.strokeWidth` | number            | Épaisseur de la bordure  | En pixels (`circle-stroke-width`). `0` est une valeur valide (pastille sans bordure).                                                                                                                                                           |
| —   | `icons.iconSize`                     | number            | Taille de l'icône        | `icon-size` MapLibre de la couche de symboles. Défaut **`0.5`**.                                                                                                                                                                                |
| —   | `render.{surface}.colorBadges`       | boolean           | Colorer les badges pill  | Colore les pills catégorie / sous-catégorie de la surface aux couleurs du `marker` de la catégorie — la pill et le symbole sur la carte se lisent alors comme un même objet. Défaut `false`. `{surface}` ∈ `popup` \| `tooltip` \| `sidepanel`. |

> **Il n'y a délibérément pas de `marker.radius`.** Un `marker` est déclaré par **catégorie**, or une même catégorie sert plusieurs couches dont les rayons diffèrent : un rayon en taxonomie les uniformiserait toutes. La **taille** du point reste au `styleRules` / `defaultStyle` de la couche.

```jsonc
// config/plugins/taxonomy.json
"categories": {
    "CULTURES": {
        "svgId": "culture-building",
        "iconColor": "#ffffff",                 // glyphe blanc…
        "marker": {                             // …sur une pastille violette
            "fill": "#6a1b9a",
            "stroke": "#38006b",
            "strokeWidth": 2
        },
        "subcategories": {
            "MUSEE": {                          // teinte plus claire, hérite du reste
                "svgId": "culture-building",
                "marker": { "fill": "#8e24aa", "stroke": "#38006b", "strokeWidth": 2 }
            }
        }
    },
    "nature": {
        "svgId": "nature-forest",
        "iconColor": "#00695c",
        "marker": false                          // icône nue : pas de pastille
    }
},
"render": {
    "popup":     { "showIconCategory": true, "colorBadges": true },
    "sidepanel": { "showIconCategory": true, "showIconSubcategory": true, "colorBadges": true }
}
```

### 4.6 La porte `enabled` — opt-out, et totale

`modules.taxonomy.enabled` est **opt-out** : **absent ⇒ activé**. Seul un `false` explicite désactive la capacité — et il la désactive alors **entièrement** : icônes sur la carte, pastille, badges pill colorés, icônes de légende, et options de filtre par catégorie.

> ⚠️ **Changement de comportement.** Jusqu'ici cette clé était opt-in **et ne désactivait rien** : la poser à `false` n'avait aucun effet observable. Un profil qui comptait sur ce non-effet doit désormais **retirer la clé** plutôt que la mettre à `false`.

### 4.7 Piège : ne pas répéter `symbolPrefix` dans `svgId`

`symbolPrefix` est **ajouté** à `svgId` pour former l'identifiant du `<symbol>` dans le sprite. Le répéter produit un identifiant doublé qui n'existe nulle part, et l'icône disparaît **silencieusement**.

```jsonc
"icons": { "symbolPrefix": "guyane-poi-cat-" },
"categories": {
    "tourisme": {
        "svgId": "guyane-poi-cat-tourisme"   // ❌ → "guyane-poi-cat-guyane-poi-cat-tourisme"
        "svgId": "tourisme"                  // ✅ → "guyane-poi-cat-tourisme"
    }
}
```

---

## 5. Thèmes

**Fichier :** `profiles/{id}/config/core/themes.json` (chemin déclaré dans `Files.themesFile`)  
**Obligatoire :** Oui

### 5.1 Section `config`

| #   | Paramètre                                      | Type    | Description                    | Description longue                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------- | ------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 40  | `config.defautTheme`                           | string  | Thème par défaut               | ID du thème appliqué automatiquement au premier chargement de la carte. Ce thème détermine quelles couches sont visibles et avec quel style au démarrage. Par exemple `"defaut"` pour le thème administratif standard, ou `"tourisme"` pour afficher directement les POI touristiques.                                                        |
| 41  | `config.primaryThemes.enabled`                 | boolean | Activer les thèmes primaires   | Les thèmes primaires apparaissent sous forme de barre horizontale de boutons au-dessus de la carte (chacun avec une icône et un label). L'utilisateur clique sur un bouton pour basculer instantanément entre les grands contextes métier (ex. Administration, Environnement, Tourisme). Désactiver si l'application n'a qu'un seul contexte. |
| 42  | `config.primaryThemes.position`                | string  | Position des thèmes primaires  | Définit où la barre des thèmes primaires est affichée. `"top-map"` place la barre juste au-dessus de la carte. C'est la position la plus visible et la plus accessible pour l'utilisateur.                                                                                                                                                    |
| 43  | `config.secondaryThemes.enabled`               | boolean | Activer les thèmes secondaires | Les thèmes secondaires apparaissent dans un dropdown (menu déroulant) intégré au gestionnaire de couches. Ils permettent des variations plus fines à l'intérieur d'un contexte (ex. les 12 mois de climat). Désactiver si le profil n'a pas besoin de thèmes spécialisés.                                                                     |
| 44  | `config.secondaryThemes.placeholder`           | string  | Placeholder du dropdown        | Texte affiché dans le dropdown quand aucun thème secondaire n'est sélectionné. Par exemple `"Choisir un mois..."` ou `"Sélectionner un thème..."`. Guide l'utilisateur sur l'action attendue.                                                                                                                                                 |
| 45  | `config.secondaryThemes.showNavigationButtons` | boolean | Boutons précédent/suivant      | Affiche des boutons fléchés (← →) à côté du dropdown des thèmes secondaires pour naviguer séquentiellement entre les thèmes. Particulièrement utile pour les thèmes ordonnés chronologiquement (ex. les mois de l'année : janvier → février → mars). L'utilisateur peut ainsi parcourir les thèmes un par un sans ouvrir le dropdown.         |
| 46  | `config.secondaryThemes.position`              | string  | Position du dropdown           | Définit où le dropdown des thèmes secondaires est affiché. `"top-layermanager"` le place en haut du gestionnaire de couches, intégré à l'interface existante.                                                                                                                                                                                 |

### 5.2 Définition d'un thème

| #   | Paramètre                   | Type    | Description           | Description longue                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------- | ------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 47  | `themes[].id`               | string  | Identifiant unique    | ID technique du thème, utilisé en interne pour l'activer, le stocker en préférence et le référencer dans les événements. Doit être unique dans le fichier themes.json. Par exemple `"defaut"`, `"environnement"`, `"climat_janvier"`.                                                                                                                |
| 48  | `themes[].label`            | string  | Nom affiché           | Texte visible par l'utilisateur final dans la barre de thèmes primaires ou dans le dropdown des thèmes secondaires. Par exemple `"Administratif"`, `"Climat — Janvier"`. Doit être court et explicite.                                                                                                                                               |
| 49  | `themes[].type`             | string  | Type de thème         | `"primary"` = thème affiché dans la barre horizontale (grands contextes métier) ; `"secondary"` = thème affiché dans le dropdown du gestionnaire de couches (variations spécialisées). Le type détermine où et comment le thème est présenté à l'utilisateur.                                                                                        |
| 50  | `themes[].description`      | string  | Description du thème  | Texte descriptif optionnel expliquant ce que ce thème affiche. Peut être montré en tooltip au survol du bouton de thème. Par exemple `"Affiche les couches d'administration : pays, départements, villes, routes et réseau ferroviaire"`.                                                                                                            |
| 51  | `themes[].icon`             | string  | Emoji ou icône        | Icône affichée sur le bouton du thème dans la barre primaire. Typiquement un emoji (ex. `"🏖️"` pour tourisme, `"🌍"` pour environnement, `"🌧️"` pour climat). Rend la sélection de thème plus visuelle et intuitive.                                                                                                                                 |
| 52  | `themes[].layers[].id`      | string  | ID de la couche       | Identifiant de la couche GeoJSON concernée par ce thème. Doit correspondre à un ID défini dans `layers.json`. Chaque entrée du tableau `layers` dans un thème spécifie si cette couche est visible ou non quand le thème est activé.                                                                                                                 |
| 53  | `themes[].layers[].visible` | boolean | Visible dans ce thème | Détermine si cette couche est affichée (`true`) ou masquée (`false`) quand l'utilisateur active ce thème. C'est le cœur du système de thèmes : chaque thème est simplement un preset de visibilité des couches. L'utilisateur peut ensuite ajuster manuellement via le gestionnaire de couches.                                                      |
| 54  | `themes[].layers[].style`   | string  | Style à appliquer     | ID du style (défini dans le fichier config de la couche, section `styles.available`) à appliquer quand ce thème est activé. Permet à un même jeu de données d'être affiché différemment selon le thème. Par exemple, une couche "villes" pourrait utiliser le style "défaut" en thème administratif et le style "population" en thème démographique. |

---

## 6. Registre des couches

**Fichier :** `profiles/{id}/config/core/layers.json` (chemin déclaré dans `Files.layersFile`)

| #   | Paramètre           | Type   | Description             | Description longue                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------- | ------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 55  | `[].id`             | string | ID de la couche         | Identifiant unique de la couche, utilisé partout dans GeoLeaf pour la référencer : thèmes, gestionnaire de couches, filtres, légende, API JavaScript. Doit correspondre au nom du sous-dossier dans `layers/` et au `id` dans le fichier config de la couche. Par exemple `"departements"`, `"hebergements"`, `"pluviometrie_janvier"`.        |
| 56  | `[].configFile`     | string | Chemin config           | Chemin relatif (par rapport au dossier du profil) vers le fichier JSON de configuration de cette couche. Par exemple `"layers/departements/departements_config.json"`. Ce fichier contient toutes les informations nécessaires pour charger, afficher et interagir avec la couche.                                                             |
| 57  | `[].layerManagerId` | string | Section du gestionnaire | ID de la section dans le gestionnaire de couches où cette couche sera rangée. Doit correspondre à un `id` défini dans `layerManagerConfig.sections[]`. Par exemple `"data-administration"` rangera cette couche dans la section "Administration" du gestionnaire. Permet d'organiser visuellement des dizaines de couches en groupes logiques. |

### 6.2 Templates de couches (`layerTemplates[]`)

Les templates permettent de générer N couches identiques à partir d'une config de base — par exemple 12 couches climatiques mensuelles partageant le même style. Chaque instance n'a qu'à déclarer ses variantes (label, fichier de données).

| #   | Paramètre                                  | Type   | Description                        | Description longue                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------ | ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 57b | `layerTemplates[].templateId`              | string | Identifiant du groupe de templates | ID technique du groupe. Par exemple `"pluviometrie"` pour 12 couches de pluviométrie. ⚠️ **Requis par le schéma mais jamais lu par le loader** — c'est une étiquette humaine, pas une clé de résolution : aucune couche ne « référence » un template par son id (anomalie ANO-051). |
| 57c | `layerTemplates[].layerManagerId`          | string | Section du gestionnaire            | ID de la section du gestionnaire de couches, appliqué à **toutes** les instances du template. ⚠️ **Il se déclare par TEMPLATE, jamais par instance** : un template ne sert donc qu'une seule section. Deux couches de sections différentes exigent deux templates.                  |
| 57d | `layerTemplates[].template`                | object | Config de base partagée            | Objet de configuration partagé par toutes les instances (mêmes propriétés que dans un `{layer}_config.json`). Le schéma en déclare six : `zIndex`, `geometry`, `data`, `styles`, `table`, `clustering` — et reste permissif (`additionalProperties: true`) pour les autres.         |
| 57e | `layerTemplates[].template.zIndex`         | number | Ordre d'empilement commun          | `zIndex` partagé par les instances. C'est aussi l'ordre de tri du gestionnaire de couches, décroissant. Souvent la seule différence entre deux templates voisins (`pluviometrie` 93, `temperature` 74).                                                                             |
| 57f | `layerTemplates[].template.geometry`       | string | Type de géométrie du template      | Type de géométrie commun à toutes les instances. Enum fermé côté schéma : `"point"`, `"polygon"`, `"line"`, `"multipolygon"`.                                                                                                                                                       |
| 57g | `layerTemplates[].template.data.directory` | string | Répertoire des données             | Sous-répertoire des données, **relatif au dossier de l'instance**. Avec `"data"`, le fichier d'une instance se résout en `profiles/<profil>/layers/<id-instance>/data/<dataFile>`. Défaut appliqué si absent : `"data"`.                                                            |
| 57h | `layerTemplates[].template.styles`         | object | Config de styles commune           | Objet styles (même structure que dans un `{layer}_config.json`) partagé par toutes les instances. Les fichiers de style eux-mêmes restent propres à chaque instance, sous son `layers/<id>/styles/`.                                                                                |
| 57i | `layerTemplates[].template.table`          | object | Config de table commune            | Bloc `table` partagé (`enabled`, `columns`, `defaultSort`, `searchFields`).                                                                                                                                                                                                         |
| 57j | `layerTemplates[].template.clustering`     | object | Config de clustering commune       | Bloc `clustering` partagé (`enabled`, `maxClusterRadius`, `disableClusteringAtZoom`).                                                                                                                                                                                               |
| 57k | `layerTemplates[].instances`               | array  | Instances générées                 | Tableau d'objets définissant chacune des couches générées. Chaque instance doit déclarer au minimum `id`, `label` et `dataFile`.                                                                                                                                                    |
| 57l | `layerTemplates[].instances[].id`          | string | ID de l'instance                   | Identifiant unique de cette couche générée. Doit être unique dans tout le profil, et égal au nom de son dossier `layers/<id>/`. Par exemple `"pluviometrie_janvier"`.                                                                                                               |
| 57m | `layerTemplates[].instances[].label`       | string | Label d'affichage de l'instance    | Nom affiché dans le gestionnaire de couches. Par exemple `"Pluviométrie — Janvier"`.                                                                                                                                                                                                |
| 57n | `layerTemplates[].instances[].dataFile`    | string | Fichier de données de l'instance   | Nom du fichier de données propre à cette instance, cherché sous `template.data.directory`. Par exemple `"pluviometrie_janvier.geojson"`.                                                                                                                                            |

**Comment la config d'une instance est assemblée.** `expandLayerTemplates`
(`packages/core/src/kernel/config/profile-loader-helpers.ts:230-259`) produit, pour chaque instance :

```
{ ...template, ...surcharges, id, label, data: { directory, file: dataFile } }
```

⚠️ **Trois propriétés de cet assemblage contraignent ce qu'un template peut exprimer**, et la note
qui tenait cette place jusqu'au 06/08/2026 en promettait l'inverse (« `additionalProperties: true`
permet de surcharger n'importe quel champ ») :

- **Les surcharges sont de SURFACE.** Toute clé d'instance autre que `id`/`label`/`dataFile` surcharge
  le template — mais surcharger un **objet le remplace en entier**. Une instance qui redéclare `table`
  perd le `table.enabled` du template. Il n'y a pas de fusion profonde ici, contrairement aux blocs de
  modules.
- **`data` n'est pas surchargeable du tout.** Il est **reconstruit en dernier** : seule
  `template.data.directory` survit, le nom de fichier vient de `dataFile`. **Toute autre clé sous
  `data` est perdue** — donc une couche qui a besoin de `data.vectorTiles`, `data.realtime`,
  `data.mapping`, `data.licence` ou d'une source `data.url` **ne peut pas être une instance de
  template** et doit rester une entrée directe de `layers[]`.
- **Une instance ne porte jamais de fichier de config.** Son `inlineConfig` « skips the fetch
  entirely » : un `layers/<id>/<id>_config.json` posé à côté d'elle ne serait jamais lu, et
  `scripts/check-template-layer-configs.cjs` (**TPL-CFG**) fait échouer le build s'il en trouve un.

---

## 7. Configuration d'une couche

**Fichier :** `profiles/{id}/layers/{layer_id}/{layer_id}_config.json`

### 7.1 Propriétés générales

| #   | Paramètre          | Type    | Défaut | Description         | Description longue                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------ | ------- | ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 58  | `id`               | string  | —      | Identifiant unique  | Identifiant technique de la couche, identique à celui déclaré dans `layers.json`. Sert de clé pour toutes les opérations (activation, filtrage, thèmes, légende). Doit être en minuscules avec underscores (ex. `"villes_principales"`, `"eco_regions"`).                                                                                                           |
| 59  | `label`            | string  | —      | Nom affiché         | Nom lisible par l'utilisateur, affiché dans le gestionnaire de couches, la légende et les popups. Par exemple `"Villes principales"`, `"Zones de conservation"`. Doit être compréhensible par un non-technicien.                                                                                                                                                    |
| 60  | `geometry`         | string  | —      | Type de géométrie   | Indique la nature géométrique des features dans le GeoJSON : `"point"` (marqueurs, POI), `"polygon"` (zones, régions, bâtiments), `"polyline"` (routes, cours d'eau, itinéraires), `"fill-extrusion"` (polygones 3D extrudés, bâtiments volumiques — v2.2.0+). Détermine comment GeoLeaf rend la couche sur la carte et quels paramètres de style sont applicables. |
| 61  | `zIndex`           | number  | —      | Ordre d'empilement  | Contrôle l'ordre de superposition des couches sur la carte (0 = en dessous, 99 = au-dessus). Les couches avec un zIndex élevé sont dessinées par-dessus celles avec un zIndex bas. Par exemple, mettre les points à 90+ et les polygones à 10-50 garantit que les marqueurs ne sont jamais masqués par une zone.                                                    |
| 62  | `interactiveShape` | boolean | —      | Formes cliquables   | Active les interactions utilisateur (clic, survol) sur les features de cette couche. Quand activé, un clic sur un polygone ou une ligne ouvre le popup ou le panneau latéral avec les informations de cette feature. Quand désactivé, les features sont purement décoratives.                                                                                       |
| 63  | `showIconsOnMap`   | boolean | —      | Icônes sur la carte | Pour les couches de type `"point"`, affiche des icônes (issues du sprite SVG de la taxonomie) à la place des marqueurs par défaut. L'icône est résolue automatiquement selon le `categoryId` et `subcategoryId` de chaque feature. Permet une carte visuellement riche avec des icônes métier distinctives.                                                         |

### 7.2 Section `data`

| #   | Paramètre                         | Type    | Défaut    | Description                      | Description longue                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------- | ------- | --------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 64  | `data.directory`                  | string  | `"data"`  | Répertoire des données           | Nom du sous-dossier (relatif au dossier de la couche) contenant le fichier GeoJSON. La convention est `"data"`, ce qui donne un chemin comme `layers/departements/data/departements.geojson`. Permet d'organiser clairement données et styles dans des dossiers séparés.                                                                                                                                                                                                               |
| 65  | `data.file`                       | string  | —         | Fichier GeoJSON                  | Nom du fichier GeoJSON contenant les features de cette couche. Par exemple `"departements.geojson"`. Ce fichier doit être au format GeoJSON standard (FeatureCollection) en WGS84. C'est la donnée brute affichée sur la carte.                                                                                                                                                                                                                                                        |
| 65b | `data.ogcApi.url`                 | string  | —         | URL de collection OGC            | URL de base du serveur OGC API Features. Exemple : `"https://demo.ldproxy.net/daraa"`. Mutuellement exclusif avec `data.file`. Quand ce paramètre est défini, c'est le loader OGC API qui est utilisé à la place du chargement fichier.                                                                                                                                                                                                                                                |
| 65c | `data.ogcApi.collectionId`        | string  | —         | ID de collection                 | Identifiant de la collection de features à charger (segment final de l'URL de collection). Exemple : `"AeronauticSrf"`. Requis si la collection n'est pas déjà incluse dans `data.ogcApi.url`.                                                                                                                                                                                                                                                                                         |
| 65d | `data.ogcApi.bbox`                | boolean | `false`   | Filtrage par emprise             | Si `true`, les features sont filtrées par l'emprise visible de la carte (paramètre `bbox` de l'API). La requête est renouvelée à chaque déplacement si `autoRefresh` est actif. Permet de charger dynamiquement les données de la vue courante sans surcharger la mémoire.                                                                                                                                                                                                             |
| 65e | `data.ogcApi.maxFeatures`         | number  | `5000`    | Limite de features               | Nombre maximum de features à charger (paramètre `limit` de l'API, avec pagination automatique). Limite anti-DoS mémoire : une collection trop grande peut saturer le navigateur. Valeur recommandée : 1000–5000 selon la complexité géométrique.                                                                                                                                                                                                                                       |
| 65f | `data.ogcApi.autoRefresh`         | boolean | `false`   | Rafraîchissement automatique     | Si `true`, la couche est rechargée automatiquement à chaque fin de déplacement (`moveend`), avec debounce 500 ms. Couple naturellement avec `data.ogcApi.bbox: true` pour créer une couche « visu dynamique » qui charge les données de la zone visible.                                                                                                                                                                                                                               |
| 66  | `data.vectorTiles.enabled`        | boolean | `false`   | Tuiles vectorielles              | Autorise le mode tuiles vectorielles pour cette couche au lieu du GeoJSON classique. ⚠️ **Nécessaire mais PAS suffisant : sans `data.vectorTiles.tilesUrl` (#66b), la couche retombe silencieusement en GeoJSON.** Les tuiles vectorielles sont pré-découpées en carreaux et chargées à la demande selon le zoom et l'emprise visible, ce qui est beaucoup plus performant pour les couches à milliers de features (réseau ferroviaire, limites administratives détaillées, cadastre). |
| 66b | `data.vectorTiles.tilesUrl`       | string  | —         | **URL des tuiles (obligatoire)** | **La clé porteuse — sans elle, rien ne s'active.** URL **absolue** du service de tuiles : template MVT (`https://.../{z}/{x}/{y}.pbf`) ou fichier `.pmtiles`. Le garde `shouldUseVectorTiles()` (`capabilities/vector-tiles/vector-tiles.ts`) exige une URL absolue (`http`, `//` ou `/`) et **refuse les chemins relatifs** : un `tilesDirectory` seul pointe vers des `.pbf` qui peuvent ne pas exister, donc le module préfère le repli GeoJSON à une couche vide.                  |
| 66c | `data.vectorTiles.scheme`         | string  | `"xyz"`   | Schéma de numérotation           | Convention d'indexation des tuiles : `"xyz"` (origine en haut à gauche — le standard web) ou `"tms"` (origine en bas à gauche — convention OSGeo). À aligner sur ce que sert votre tileserver, sans quoi les tuiles s'affichent inversées verticalement.                                                                                                                                                                                                                               |
| 67  | `data.vectorTiles.tilesDirectory` | string  | `"tiles"` | Répertoire des tuiles            | Nom du sous-dossier contenant les fichiers de tuiles vectorielles pré-générés, relatif au dossier de la couche. ⚠️ **Décoratif à lui seul** : le module n'emprunte pas le chemin vector-tiles sur la foi d'un chemin relatif (cf. #66b). Utile pour documenter où vivent les tuiles générées par `scripts/generate-vector-tiles.cjs`, mais c'est `tilesUrl` qui décide.                                                                                                                |
| 68  | `data.vectorTiles.layerName`      | string  | —         | Nom de couche dans les tuiles    | Identifiant de la couche à l'intérieur du fichier de tuiles vectorielles. Un même fichier de tuiles peut contenir plusieurs couches ; ce paramètre indique laquelle extraire.                                                                                                                                                                                                                                                                                                          |
| 69  | `data.vectorTiles.minZoom`        | number  | —         | Zoom min des tuiles              | Niveau de zoom à partir duquel les tuiles vectorielles sont disponibles. En dessous de ce zoom, la couche n'est pas affichée. Dépend de la granularité des tuiles générées.                                                                                                                                                                                                                                                                                                            |
| 70  | `data.vectorTiles.maxNativeZoom`  | number  | —         | Zoom natif maximum               | Zoom maximum pour lequel des tuiles natives existent réellement. Au-delà, les tuiles du dernier niveau natif sont "sur-zoomées" (étirées) pour combler le rendu.                                                                                                                                                                                                                                                                                                                       |
| 71  | `data.vectorTiles.maxZoom`        | number  | —         | Zoom maximum                     | Zoom maximum auquel la couche est affichée, même en mode sur-zoom. Au-delà de cette valeur, la couche disparaît complètement.                                                                                                                                                                                                                                                                                                                                                          |
| 72  | `data.vectorTiles.interactive`    | boolean | —         | Tuiles interactives              | Permet les interactions (clic, survol) sur les features des tuiles vectorielles. Si activé, GeoLeaf écoute les clics et affiche les popups/tooltips. Si désactivé, les tuiles sont purement visuelles (meilleure performance).                                                                                                                                                                                                                                                         |
| 72b | `data.headers`                    | object  | —         | En-têtes HTTP (source `dataUrl`) | En-têtes HTTP statiques ajoutés à la requête d'une source GeoJSON distante `data.dataUrl` — typiquement la négociation de contenu `{ "Accept": "application/geo+json" }` pour un endpoint PostGIS/PostgREST. Quand ce paramètre est défini, la couche est chargée sur le thread principal (le web worker ne relaie pas ces en-têtes) ; l'authentification (Bearer) reste centralisée dans le plugin Connector, qui s'ajoute par-dessus.                                                |

### 7.3 Section `styles`

| #   | Paramètre                  | Type   | Défaut     | Description           | Description longue                                                                                                                                                                                                 |
| --- | -------------------------- | ------ | ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 73  | `styles.directory`         | string | `"styles"` | Répertoire des styles | Nom du sous-dossier contenant les fichiers JSON de style pour cette couche. La convention est `"styles"`, ce qui donne par exemple `layers/departements/styles/defaut.json`.                                       |
| 74  | `styles.default`           | string | —          | Style par défaut      | Nom du fichier de style appliqué quand la couche est activée pour la première fois. Par exemple `"defaut.json"`. Ce style est aussi utilisé quand un thème ne spécifie pas de style particulier pour cette couche. |
| 75  | `styles.available[].id`    | string | —          | ID du style           | Identifiant unique du style, référencé dans les thèmes (`themes[].layers[].style`) et dans le sélecteur de styles du gestionnaire de couches. Par exemple `"defaut"`, `"population"`, `"densite"`.                 |
| 76  | `styles.available[].label` | string | —          | Nom affiché du style  | Nom lisible affiché dans le sélecteur de style du gestionnaire de couches. Par exemple `"Défaut"`, `"Par population"`, `"Par densité"`. L'utilisateur choisit entre les styles disponibles via ce sélecteur.       |
| 77  | `styles.available[].file`  | string | —          | Fichier du style      | Nom du fichier JSON contenant la définition complète du style (couleurs, opacité, labels, légende, styleRules). Par exemple `"population.json"`.                                                                   |

### 7.4 Section `tooltip`

| #   | Paramètre                | Type   | Description           | Description longue                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------ | ------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 78  | `tooltip.mode`           | string | Mode de déclenchement | Définit comment l'infobulle se déclenche : `"hover"` = au survol de la souris (l'infobulle apparaît quand le curseur passe sur la feature et disparaît quand il la quitte), `"click"` = au clic (l'infobulle s'affiche et reste visible jusqu'à ce que l'utilisateur clique ailleurs). Le mode hover est plus rapide pour l'exploration, le mode click est plus stable pour la lecture. |
| 79  | `tooltip.fields[].type`  | string | Type de champ         | Type de rendu du champ dans l'infobulle. Le plus courant est `"text"` qui affiche simplement la valeur du champ. Supporte les mêmes 13 types de renderers que les popups (voir section 9), mais en pratique les tooltips utilisent surtout `"text"` pour rester compactes.                                                                                                              |
| 80  | `tooltip.fields[].field` | string | Propriété GeoJSON     | Chemin vers la propriété GeoJSON dont la valeur sera affichée dans l'infobulle. Par exemple `"NAM"` pour le nom, `"population_2008"` pour la population. Supporte la dot notation pour les propriétés imbriquées : `"attributes.reviews.rating"`.                                                                                                                                       |

### 7.5 Section `popup`

| #   | Paramètre                | Type    | Description       | Description longue                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------ | ------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 81  | `popup.enabled`          | boolean | Activer le popup  | Active ou désactive le popup (bulle d'information) qui apparaît quand l'utilisateur clique sur une feature de cette couche. Si désactivé, le clic n'a aucun effet ou ouvre directement le panneau latéral (si configuré). Un popup affiche un résumé compact des informations de la feature.                                             |
| 82  | `popup.fields[].type`    | string  | Type de renderer  | Détermine comment le champ est rendu visuellement dans le popup. Les 13 types disponibles (text, badge, rating, image, link, gallery, etc.) permettent de construire des popups riches et structurés. Par exemple, un type `"badge"` affichera la catégorie sous forme d'étiquette colorée, et un type `"rating"` affichera des étoiles. |
| 83  | `popup.fields[].label`   | string  | Libellé du champ  | Texte affiché comme titre ou légende du champ dans le popup. Par exemple `"Nom"`, `"Catégorie"`, `"Note"`. Si omis, le champ est affiché sans libellé (utile pour les badges ou les images).                                                                                                                                             |
| 84  | `popup.fields[].field`   | string  | Propriété GeoJSON | Chemin vers la propriété GeoJSON à afficher. Supporte la dot notation : `"attributes.reviews.rating"` accédera à `feature.properties.attributes.reviews.rating`. Le système de résolution multi-chemins permet de naviguer dans des données imbriquées complexes.                                                                        |
| 85  | `popup.fields[].variant` | string  | Variante de rendu | Modifie le rendu visuel du champ. Par exemple, pour le type `"text"` : `"title"` affiche en gros et gras (titre principal), `"short"` en taille normale. Pour le type `"image"` : `"hero"` affiche l'image en pleine largeur au-dessus du popup. Permet d'adapter le rendu au contenu.                                                   |

### 7.6 Section `sidepanel`

| #   | Paramètre                              | Type    | Description                | Description longue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------- | ------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 86  | `sidepanel.enabled`                    | boolean | Activer le panneau latéral | Active le panneau de détail qui s'ouvre sur le côté droit de l'écran quand l'utilisateur clique sur un POI ou une feature. Ce panneau offre plus d'espace qu'un popup et peut afficher des informations riches : galeries photo, avis clients, tableaux, listes, coordonnées GPS. L'utilisateur peut le fermer en cliquant sur le bouton de fermeture ou en cliquant ailleurs sur la carte.                                                                                                                                                                                                                                  |
| 87  | `sidepanel.detailLayout[].type`        | string  | Type de renderer           | Détermine comment chaque section du panneau latéral est rendue. Les 13 types (text, image, gallery, tags, list, rating, badge, link, table, coordinates, etc.) permettent de construire des pages de détail complètes et professionnelles. L'ordre des entrées dans le tableau `detailLayout` détermine l'ordre d'affichage vertical dans le panneau.                                                                                                                                                                                                                                                                        |
| 88  | `sidepanel.detailLayout[].label`       | string  | Titre de la section        | Texte affiché comme titre de la section dans le panneau latéral. Par exemple `"Description"`, `"Galerie photos"`, `"Informations pratiques"`. Donne une structure claire et lisible au contenu du panneau.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 89  | `sidepanel.detailLayout[].field`       | string  | Propriété source           | Chemin vers la propriété GeoJSON dont la valeur alimente cette section. Supporte la dot notation et la résolution de champs multiples. Par exemple `"gallery"` pour un tableau d'URLs d'images, `"informations"` pour une liste de textes.                                                                                                                                                                                                                                                                                                                                                                                   |
| 90  | `sidepanel.detailLayout[].variant`     | string  | Variante de rendu          | Modifie le style de rendu. Par exemple `"hero"` pour une image pleine largeur, `"multiline"` pour un texte long avec retours à la ligne, `"title"` pour un titre en gros. ⚠️ **Corrigé au 20/07/2026 (CAPACITÉS S2)** : `variant: "title"` était documenté ici mais **n'était pas honoré** par le panneau latéral, qui ne reconnaissait que `style: "title"` — le champ perdait son statut de champ requis (il disparaissait si vide) et son icône de catégorie. Les deux écritures sont désormais équivalentes sur le popup **et** le panneau latéral. Permet d'adapter chaque section au type de contenu qu'elle présente. |
| 91  | `sidepanel.detailLayout[].style`       | string  | Style du badge             | Pour les badges, définit si le badge représente la catégorie principale (`"category"`) ou la sous-catégorie (`"subcategory"`). Chaque style a ses propres couleurs et icônes résolues depuis la taxonomie.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 92  | `sidepanel.detailLayout[].listStyle`   | string  | Style de liste             | Pour les listes (`type: "list"`), définit le style d'affichage : `"bullet"` affiche des puces rondes, non défini affiche une liste numérotée. Permet d'adapter le rendu au contenu (points d'intérêt = puces, étapes = numérotation).                                                                                                                                                                                                                                                                                                                                                                                        |
| 93  | `sidepanel.detailLayout[].iconId`      | string  | Icône de section           | ID d'un symbole dans le sprite SVG affiché à côté du titre de la section. Par exemple une icône d'appareil photo pour la galerie, une icône d'information pour les détails. Rend le panneau plus visuel et professionnel.                                                                                                                                                                                                                                                                                                                                                                                                    |
| 94  | `sidepanel.detailLayout[].accordion`   | boolean | Section repliable          | Quand activé, cette section du panneau latéral est rendue sous forme d'accordéon : le titre est cliquable et le contenu se replie/déplie. Permet de présenter beaucoup d'informations sans surcharger visuellement le panneau. Idéal pour les sections secondaires (informations pratiques, coordonnées GPS, avis).                                                                                                                                                                                                                                                                                                          |
| 95  | `sidepanel.detailLayout[].defaultOpen` | boolean | Ouverte par défaut         | Si la section est un accordéon (`accordion: true`), ce paramètre détermine si elle est ouverte ou fermée au premier affichage. `true` = contenu visible immédiatement, `false` = l'utilisateur doit cliquer pour ouvrir. Les sections les plus importantes devraient être ouvertes par défaut.                                                                                                                                                                                                                                                                                                                               |
| 96  | `sidepanel.detailLayout[].maxCount`    | number  | Nombre max d'items         | Pour les listes et les avis (reviews), limite le nombre d'éléments affichés. Par exemple `maxCount: 5` n'affichera que les 5 derniers avis. Évite un panneau trop long quand les données contiennent des dizaines d'entrées. Un lien "voir plus" peut être ajouté automatiquement.                                                                                                                                                                                                                                                                                                                                           |

### 7.7 Section `search`

| #   | Paramètre | Type | Description | Description longue |
| --- | --------- | ---- | ----------- | ------------------ |

### 7.8 Section `table`

> ℹ️ Ce bloc `table` **par couche** est **conservé sur la couche** (`layer-config.schema.json` inchangé). Il est désormais lu par le plugin MIT `@geoleaf-plugins/table` (le tableau de données a été extrait du core). Seule la configuration **globale** a migré vers `modules.table` (voir §13).

| #   | Paramètre                  | Type     | Description              | Description longue                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------- | -------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 99  | `table.enabled`            | boolean  | Afficher dans le tableau | Active l'affichage des features de cette couche dans le tableau de données. Quand activé et que l'utilisateur ouvre le tableau, les features de cette couche apparaissent en lignes avec les colonnes définies ci-dessous. Quand désactivé, cette couche est absente du tableau même si le tableau global est activé. |
| 100 | `table.columns[].field`    | string   | Propriété de la colonne  | Chemin vers la propriété GeoJSON affichée dans cette colonne du tableau. Par exemple `"name"` affichera le nom de chaque feature dans cette colonne. Supporte la dot notation pour les propriétés imbriquées.                                                                                                         |
| 101 | `table.columns[].label`    | string   | En-tête de colonne       | Texte affiché dans l'en-tête de la colonne du tableau. Par exemple `"Nom"`, `"Province"`, `"Population"`. Doit être court et explicite pour que le tableau reste lisible.                                                                                                                                             |
| 102 | `table.columns[].sortable` | boolean  | Colonne triable          | Permet à l'utilisateur de cliquer sur l'en-tête de cette colonne pour trier le tableau par ordre croissant ou décroissant sur cette colonne. Le tri est local et instantané. Utile pour les colonnes numériques (population, note) ou alphabétiques (nom).                                                            |
| 103 | `table.columns[].width`    | string   | Largeur de la colonne    | Définit la largeur de cette colonne en pourcentage (`"40%"`) ou en pixels (`"200px"`). Permet de donner plus de place aux colonnes avec du contenu long (noms) et moins aux colonnes courtes (codes, rangs).                                                                                                          |
| 104 | `table.searchFields`       | string[] | Champs de recherche      | Liste des propriétés GeoJSON utilisées pour la recherche dans le tableau. Quand l'utilisateur tape dans le champ de recherche du tableau, seules ces propriétés sont interrogées. Par exemple `["name", "province"]` permet de chercher par nom ou par province.                                                      |
| 105 | `table.defaultSort.field`  | string   | Tri par défaut           | Propriété GeoJSON utilisée pour le tri initial du tableau au chargement. Par exemple `"name"` pour un tri alphabétique par nom, `"rang"` pour un tri par rang.                                                                                                                                                        |
| 106 | `table.defaultSort.order`  | string   | Ordre de tri             | Ordre du tri initial : `"asc"` (A→Z, 1→99) ou `"desc"` (Z→A, 99→1). Par exemple `"asc"` avec le champ `"name"` affichera les features triées de A à Z.                                                                                                                                                                |

### 7.9 Section `clustering`

| #   | Paramètre                            | Type    | Description           | Description longue                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------ | ------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 107 | `clustering.enabled`                 | boolean | Clustering par couche | Active le regroupement des marqueurs pour cette couche spécifique. Quand deux marqueurs sont trop proches l'un de l'autre au niveau de zoom actuel, ils sont fusionnés en un cluster avec un compteur. Le cluster se "déplie" quand l'utilisateur zoome suffisamment. Essentiel pour les couches avec des centaines de POI pour maintenir la lisibilité. |
| 108 | `clustering.maxClusterRadius`        | number  | Rayon de clustering   | Distance en pixels en deçà de laquelle deux marqueurs sont regroupés dans le même cluster. Une valeur élevée (ex. 120) regroupe plus agressivement, une valeur basse (ex. 40) laisse plus de marqueurs individuels. La valeur optimale dépend de la densité des données et de la taille de la carte.                                                     |
| 109 | `clustering.disableClusteringAtZoom` | number  | Zoom de désactivation | Niveau de zoom à partir duquel le clustering est désactivé et tous les marqueurs sont affichés individuellement. Par exemple `18` signifie qu'au zoom maximum (niveau rue), chaque marqueur est visible. Cela garantit que l'utilisateur peut toujours accéder à chaque POI individuellement en zoomant suffisamment.                                    |

---

## 8. Configuration d'un style

**Fichier :** `profiles/{id}/layers/{layer}/styles/{style}.json`

### 8.1 Métadonnées

| #   | Paramètre     | Type   | Description          | Description longue                                                                                                                                                                                                                        |
| --- | ------------- | ------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 110 | `id`          | string | Identifiant du style | ID technique utilisé pour référencer ce style dans les thèmes et le sélecteur de styles. Doit correspondre au `id` déclaré dans `styles.available[]` du fichier config de la couche. Par exemple `"defaut"`, `"population"`, `"densite"`. |
| 111 | `label`       | string | Nom affiché          | Nom lisible affiché dans le sélecteur de styles du gestionnaire de couches. Par exemple `"Défaut"`, `"Par population"`. Permet à l'utilisateur de comprendre ce que représente visuellement ce style.                                     |
| 112 | `description` | string | Description du style | Texte descriptif expliquant les choix de représentation de ce style. Par exemple `"Coloration des départements selon la population recensée en 2022"`. Principalement à usage documentaire.                                               |

### 8.2 Échelle de la couche

> **⚠️ L'unité est le DÉNOMINATEUR D'ÉCHELLE, pas le niveau de zoom MapLibre.**
> `scaleConfig` attend le `X` de `1:X` — le même nombre que celui affiché par l'échelle
> numérique du contrôle `scale`. **Écrire `6` ou `18` (des niveaux de zoom) masque la
> couche à tous les zooms** : `1:6` demanderait un zoom d'environ 27, que MapLibre
> n'atteint jamais (plafond 24). Depuis la v3.1.0 le validateur **rejette** toute valeur
> `<= 24`, avec un message explicite.
>
> **Contre-intuitif mais logique :** `minScale` est le **plus grand** des deux nombres.
> Le « min » désigne la vue la plus _large_ (le zoom le plus faible) — or un dénominateur
> **augmente** quand on dézoome. `{ "minScale": 9222148, "maxScale": 2252 }` se lit donc :
> « visible entre 1:9 222 148 (vue région) et 1:2 252 (vue rue) ».
>
> **Repères de conversion** (l'échelle dépend de la latitude — ici ~4°N) :
> zoom 5 ≈ 1:18 444 296 · zoom 6 ≈ 1:9 222 148 · zoom 10 ≈ 1:576 384 · zoom 13 ≈ 1:72 048 ·
> zoom 18 ≈ 1:2 252 · zoom 20 ≈ 1:563. Formule : `1:X = 591 658 734 × cos(latitude) / 2^zoom`.

| #   | Paramètre              | Type        | Description                 | Description longue                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------- | ----------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 113 | `scaleConfig.minScale` | number/null | Vue la plus large autorisée | Dénominateur au-delà duquel la couche est masquée parce qu'on a **trop dézoomé** — c'est le **plus grand** des deux nombres. Ex. `9222148` : la couche disparaît dès qu'on dézoome au-delà de 1:9 222 148. `null` ou `0` = pas de limite. Sert à masquer les couches détaillées en vue globale (ex. masquer les villes en zoom continental).         |
| 114 | `scaleConfig.maxScale` | number/null | Vue la plus rapprochée      | Dénominateur en deçà duquel la couche est masquée parce qu'on a **trop zoomé** — c'est le **plus petit** des deux nombres. Ex. `2252` : la couche disparaît dès qu'on zoome en deçà de 1:2 252. `null` ou `0` = pas de limite. Sert à masquer les couches à petite échelle en vue rue (ex. masquer les frontières de pays).                          |
| —   | ~~`layerScale.*`~~     | —           | **Supprimé en v3.0.0 (S3)** | Remplacé par `zoomConfig`, lui-même **remplacé par `scaleConfig` en v3.1.0** (le nom `minZoom`/`maxZoom` annonçait des niveaux de zoom alors que le moteur lisait des dénominateurs — 18 couches en ont été masquées ~3 mois). Les valeurs de `layerScale`/`zoomConfig` en dénominateur se reprennent **telles quelles** sous `minScale`/`maxScale`. |

### 8.3 Échelle des labels

| #   | Paramètre             | Type        | Description            | Description longue                                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------- | ----------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 115 | `labelScale.minScale` | number/null | Échelle min des labels | Même logique et **même unité** que `scaleConfig.minScale` (dénominateur d'échelle, garde `<= 24` incluse), mais appliquée uniquement aux labels (libellés texte) de la couche. Typiquement plus restrictive que l'échelle de la couche : la couche est visible mais les labels n'apparaissent qu'à un certain niveau de zoom. Évite la surcharge visuelle avec trop de texte affiché. |
| 116 | `labelScale.maxScale` | number/null | Échelle max des labels | Même logique que `scaleConfig.maxScale` pour les labels. Permet de masquer les labels quand l'utilisateur est trop dézoomé (les textes seraient illisibles ou se chevaucheraient).                                                                                                                                                                                                    |

### 8.4 Configuration des labels

| #   | Paramètre                  | Type    | Défaut  | Description            | Description longue                                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------- | ------- | ------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 117 | `label.enabled`            | boolean | —       | Activer les labels     | Active la possibilité d'afficher des labels (textes flottants) sur les features de cette couche. Quand activé, un bouton apparaît dans le gestionnaire de couches permettant à l'utilisateur d'activer/désactiver les labels. Quand désactivé, aucun label ne peut être affiché pour cette couche, quelle que soit l'action de l'utilisateur. |
| 118 | `label.visibleByDefault`   | boolean | `false` | Visibles au chargement | Détermine si les labels sont affichés immédiatement quand la couche est activée (`true`) ou si l'utilisateur doit cliquer sur le bouton de labels dans le gestionnaire de couches pour les voir (`false`). `false` est recommandé pour éviter de surcharger la carte par défaut ; l'utilisateur active les labels quand il en a besoin.       |
| 119 | `label.field`              | string  | —       | Propriété affichée     | Nom de la propriété GeoJSON dont la valeur sera affichée comme texte du label. Par exemple `"ville"` affichera le nom de chaque ville, `"NAM"` affichera le nom d'un département. Supporte un seul champ ; pour des labels composites, utiliser un template (si pris en charge).                                                              |
| 120 | `label.font.family`        | string  | —       | Police de caractères   | Famille de police utilisée pour le rendu des labels. Par exemple `"Arial"`, `"Segoe UI"`, `"serif"`. La police doit être disponible sur le système de l'utilisateur.                                                                                                                                                                          |
| 121 | `label.font.sizePt`        | number  | —       | Taille de police       | Taille du texte des labels en points typographiques. Une taille de 8-10 est adaptée aux labels cartographiques standard. Des valeurs plus grandes (12-14) peuvent être utilisées pour les titres de villes importantes.                                                                                                                       |
| 122 | `label.font.weight`        | number  | —       | Poids de la police     | Poids numérique de la police (100 à 900). 400 = normal, 700 = gras. Permet un contrôle fin du rendu, complémentaire au paramètre `bold`.                                                                                                                                                                                                      |
| 123 | `label.font.bold`          | boolean | —       | Gras                   | Active le rendu en gras pour les labels de cette couche. Les noms de villes importantes sont souvent en gras pour se démarquer visuellement.                                                                                                                                                                                                  |
| 124 | `label.font.italic`        | boolean | —       | Italique               | Active le rendu en italique. L'italique est conventionnellement utilisé en cartographie pour les noms de cours d'eau, de mers et d'océans.                                                                                                                                                                                                    |
| 125 | `label.color`              | string  | —       | Couleur du texte       | Couleur du texte des labels au format hexadécimal (ex. `"#333333"` pour un gris foncé, `"#0055aa"` pour un bleu). Doit contraster avec le fond de carte pour rester lisible.                                                                                                                                                                  |
| 126 | `label.opacity`            | number  | —       | Opacité du texte       | Opacité des labels (0 = invisible, 1 = opaque). Une légère transparence (0.8) peut adoucir le rendu et éviter que les labels masquent les éléments en dessous.                                                                                                                                                                                |
| 127 | `label.buffer.enabled`     | boolean | —       | Halo autour du texte   | Active un halo (contour lumineux) autour du texte des labels pour améliorer la lisibilité sur des fonds chargés. Le halo crée un effet de bordure claire ou sombre autour de chaque lettre, garantissant que le texte reste lisible même sur un fond de couleur variable (photo satellite, polygones colorés). Fortement recommandé.          |
| 128 | `label.buffer.color`       | string  | —       | Couleur du halo        | Couleur du halo autour du texte. Typiquement blanc (`"#ffffff"`) pour un texte sombre ou noir (`"#000000"`) pour un texte clair. Le contraste halo/texte est la clé de la lisibilité des labels.                                                                                                                                              |
| 129 | `label.buffer.opacity`     | number  | —       | Opacité du halo        | Opacité du halo (0 à 1). Une valeur de 0.7-0.9 donne un bon contraste tout en laissant transparaître légèrement le fond de carte.                                                                                                                                                                                                             |
| 130 | `label.buffer.sizePx`      | number  | —       | Épaisseur du halo      | Taille du halo en pixels autour du texte. 2 à 4 pixels suffisent généralement. Un halo trop épais devient visuellement lourd.                                                                                                                                                                                                                 |
| 131 | `label.background.enabled` | boolean | —       | Fond derrière le label | Active un rectangle de fond coloré derrière le texte du label (comme une étiquette). Utile pour les labels qui doivent être visibles à tout prix, même au détriment de l'esthétique cartographique. Alternative au halo pour une lisibilité maximale.                                                                                         |
| 132 | `label.offset.distancePx`  | number  | —       | Décalage du label      | Distance en pixels entre le centre de la feature et le label. Permet d'écarter le texte du marqueur ou du centre du polygone pour éviter les chevauchements. Utile pour les points où le marqueur (icône) et le label se superposeraient.                                                                                                     |

### 8.5 Style visuel — Points

| #   | Paramètre              | Type   | Description            | Description longue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------- | ------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 133 | `style.shape`          | string | Forme du symbole       | ⚠️ **`"circle"` uniquement** — le schéma le contraint désormais par énumération. Les points sont rendus par une couche `circle` MapLibre, qui ne dessine que des cercles ; `"square"` et `"triangle"` étaient annoncés ici mais **n'ont jamais été rendus** (ANO-063, soldé au backlog B.20). La clé est par ailleurs **inerte** : aucun code ne la lit. Elle est conservée comme point d'extension réservé. Pour différencier des catégories, utiliser `styleRules` (couleur/rayon par valeur) ou la taxonomie (icône par catégorie). |
| 134 | `style.sizePx`         | number | Taille du symbole      | **⚠️ SUPPRIMÉ en v3.0.0 (S3) — utiliser `style.radius`.** Diamètre (ou côté) du symbole en pixels. Par exemple 8 pour des petits points, 14 pour des marqueurs bien visibles. La taille peut aussi être contrôlée via les styleRules pour varier selon un attribut (ex. taille proportionnelle à la population). _(Sans rapport : `label.buffer.sizePx` — épaisseur du halo de label, n° 130 — reste valide.)_                                                                                                                         |
| 135 | `style.fill.color`     | string | Couleur de remplissage | Couleur intérieure du symbole au format hexadécimal. Par exemple `"#e74c3c"` pour un rouge, `"#3498db"` pour un bleu. Combinée avec l'opacité, elle détermine l'apparence du marqueur sur la carte.                                                                                                                                                                                                                                                                                                                                    |
| 136 | `style.fill.opacity`   | number | Opacité du remplissage | Transparence du remplissage du symbole (0 = transparent, 1 = opaque). Une valeur de 0.7-0.8 permet de voir partiellement les éléments en dessous du symbole.                                                                                                                                                                                                                                                                                                                                                                           |
| 137 | `style.stroke.color`   | string | Couleur du contour     | Couleur du bord du symbole au format hexadécimal. Un contour sombre (`"#333333"`) sur un remplissage clair améliore la lisibilité. Le contour peut aussi servir à encoder une information supplémentaire.                                                                                                                                                                                                                                                                                                                              |
| 138 | `style.stroke.opacity` | number | Opacité du contour     | Transparence du contour (0 à 1). Généralement à 1 pour un contour bien visible.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 139 | `style.stroke.widthPx` | number | Épaisseur du contour   | Épaisseur du bord du symbole en pixels. 1-2 px pour un contour discret, 3+ pour un contour marqué.                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### 8.6 Style visuel — Polygones et lignes

| #   | Paramètre                | Type   | Description            | Description longue                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------ | ------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 140 | `style.fill.color`       | string | Couleur de remplissage | Couleur intérieure des polygones au format hexadécimal. Définit la teinte de la zone. Pour les lignes (polylines), ce paramètre est ignoré.                                                                                                                                                                                   |
| 141 | `style.fill.opacity`     | number | Opacité du remplissage | Transparence du remplissage des polygones (0 = transparent, 1 = opaque). Les valeurs 0.2-0.5 sont recommandées pour les zones superposées au fond de carte, afin de voir le basemap en dessous.                                                                                                                               |
| 142 | `style.stroke.color`     | string | Couleur du contour     | Couleur du contour des polygones ou de la ligne pour les polylines. C'est souvent la couleur la plus visible et distinctive.                                                                                                                                                                                                  |
| 143 | `style.stroke.opacity`   | number | Opacité du contour     | Transparence du contour (0 à 1). À 1 pour les frontières nettes, à 0.5 pour des contours subtils.                                                                                                                                                                                                                             |
| 144 | `style.stroke.widthPx`   | number | Épaisseur du trait     | Épaisseur du contour en pixels. 1-2 px pour les limites administratives, 3-5 px pour les routes principales, 1 px pour les cours d'eau.                                                                                                                                                                                       |
| 145 | `style.stroke.dashArray` | string | Motif de tirets        | Définit un motif de tirets pour le contour, au format SVG : alternance de longueurs pleines et vides en pixels. Par exemple `"3.92 1.96"` crée des tirets de ~4px séparés par ~2px d'espace. `"10 5"` = tirets longs. Absent = trait continu. Utile pour les frontières contestées, les projets en cours, les limites floues. |

### 8.7 Hachures (polygones)

| #   | Paramètre                    | Type        | Description            | Description longue                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------- | ----------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 146 | `style.hatch.enabled`        | boolean     | Activer les hachures   | Remplace ou complète le remplissage uni d'un polygone par un motif de hachures (lignes répétitives). Les hachures sont une convention cartographique classique pour distinguer des zones sans utiliser de couleurs (utile pour l'impression N&B ou pour les daltoniens). Le motif est généré en SVG côté navigateur. |
| 147 | `style.hatch.type`           | string      | Type de hachure        | Motif de hachure à appliquer : `"diagonal"` (lignes obliques), `"horizontal"` (lignes horizontales), `"vertical"` (lignes verticales), `"cross"` (croisillons), `"dot"` (points). Chaque type donne une texture visuelle distincte, permettant de différencier jusqu'à 5 catégories sans couleur.                    |
| 148 | `style.hatch.angleDeg`       | number/null | Angle des hachures     | Angle de rotation des hachures en degrés. Par exemple `45` pour des diagonales à 45°, `0` pour des lignes horizontales. `null` utilise l'angle par défaut du type choisi. Permet de créer des variations supplémentaires (ex. 45° et 135° pour deux types de zones).                                                 |
| 149 | `style.hatch.spacingPx`      | number      | Espacement             | Distance en pixels entre deux lignes de hachure consécutives. Un espacement faible (4-6 px) donne un rendu dense, un espacement élevé (12-20 px) donne un rendu aéré. L'espacement affecte la perception de "densité" de la zone hachurée.                                                                           |
| 150 | `style.hatch.stroke.color`   | string      | Couleur des hachures   | Couleur des lignes de hachure au format hexadécimal. Souvent la même couleur que le contour du polygone, ou une couleur contrastée avec le remplissage.                                                                                                                                                              |
| 151 | `style.hatch.stroke.opacity` | number      | Opacité des hachures   | Transparence des lignes de hachure (0 à 1). À 0.5-0.7 pour un rendu subtil, à 1 pour un rendu marqué.                                                                                                                                                                                                                |
| 152 | `style.hatch.stroke.widthPx` | number      | Épaisseur des hachures | Épaisseur de chaque ligne de hachure en pixels. 1-2 px pour un rendu fin et élégant, 3+ pour un rendu très visible.                                                                                                                                                                                                  |
| 153 | `style.hatch.renderMode`     | string      | Mode de rendu          | `"pattern_only"` = seules les hachures sont affichées (pas de remplissage uni en dessous). Non défini = les hachures se superposent au remplissage uni défini par `style.fill`. Le mode `pattern_only` est plus lisible car il n'y a pas de double couche visuelle.                                                  |

### 8.8 Tracé double / Casing (polylignes et polygones)

| #    | Paramètre                | Type    | Défaut  | Description               | Description longue                                                                                                                                                                                                                                         |
| ---- | ------------------------ | ------- | ------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 153b | `style.casing.enabled`   | boolean | `false` | Activer le tracé double   | Active un second trait rendu sous le trait principal, légèrement plus large, pour créer un effet de double bordure (comme les routes sur les cartes topographiques). Uniquement efficace sur les polylignes et les polygones.                              |
| 153c | `style.casing.color`     | string  | —       | Couleur du casing         | Couleur du tracé de casing au format hexadécimal. Souvent une couleur plus sombre ou contrastée par rapport au trait principal. Par exemple un trait principal jaune (`"#FFD700"`) avec un casing noir (`"#222222"`) pour représenter une route nationale. |
| 153d | `style.casing.opacity`   | number  | `1`     | Opacité du casing         | Transparence du tracé de casing (0 = invisible, 1 = opaque). Généralement à 1 pour un contour net.                                                                                                                                                         |
| 153e | `style.casing.widthPx`   | number  | —       | Épaisseur du casing       | Épaisseur totale du tracé de casing en pixels. Doit être supérieure à `style.stroke.widthPx` pour que le casing soit visible derrière le trait principal. Par exemple : trait principal à 4 px, casing à 8 px crée une bordure de 2 px de chaque côté.     |
| 153f | `style.casing.dashArray` | string  | —       | Motif de tirets du casing | Motif de tirets pour le tracé de casing au format SVG (ex. `"5 3"`). Permet de créer des bordures en tirets indépendamment du motif du trait principal.                                                                                                    |
| 153g | `style.casing.lineCap`   | string  | —       | Terminaison du casing     | Style de terminaison de ligne : `"butt"` (plat), `"round"` (arrondi), `"square"` (carré prolongé). S'applique aux extrémités du tracé de casing.                                                                                                           |
| 153h | `style.casing.lineJoin`  | string  | —       | Jonction du casing        | Style de jonction entre segments : `"miter"` (angle vif), `"round"` (arrondi), `"bevel"` (bisauté). Contrôle le rendu aux angles du tracé de casing.                                                                                                       |

### 8.9 Règles conditionnelles (`styleRules`)

| #   | Paramètre                    | Type   | Description              | Description longue                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------- | ------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 154 | `styleRules[].when.field`    | string | Propriété à tester       | Nom de la propriété GeoJSON sur laquelle porte la condition. Par exemple `"class_id"` pour tester un identifiant de classe climatique, `"population_2008"` pour tester la population. Chaque feature est évaluée individuellement contre cette condition.                                                                                                                                                                         |
| 155 | `styleRules[].when.operator` | string | Opérateur de comparaison | Opérateur logique pour la condition : `==` (égal), `!=` (différent), `>` (supérieur), `>=` (supérieur ou égal), `<` (inférieur), `<=` (inférieur ou égal), `"in"` (la valeur est dans une liste), `"contains"` (la propriété contient la valeur). Permet des conditions simples et expressives.                                                                                                                                   |
| 156 | `styleRules[].when.value`    | any    | Valeur de comparaison    | Valeur à comparer avec la propriété de la feature. Peut être un nombre (`1`, `100000`), une chaîne (`"hotel"`), un tableau (`[1, 2, 3]` pour l'opérateur `in`). Le type doit correspondre au type de la propriété testée.                                                                                                                                                                                                         |
| 157 | `styleRules[].when.all`      | array  | Conditions ET            | Tableau de conditions qui doivent TOUTES être vraies pour que la règle s'applique (logique AND). Permet de combiner plusieurs critères : par exemple `[{"field": "type", "operator": "==", "value": "city"}, {"field": "population", "operator": ">", "value": 100000}]` ne s'applique qu'aux villes de plus de 100 000 habitants. Seule la logique AND est supportée — il n'existe pas d'opérateur OR natif dans les styleRules. |
| 158 | `styleRules[].style`         | object | Style conditionnel       | Objet de style (même format que `style` : fill, stroke, hatch, shape, sizePx) appliqué aux features qui satisfont la condition. Chaque règle peut redéfinir tout ou partie du style. Par exemple, colorer en rouge les zones de pluviométrie élevée et en bleu les zones de pluviométrie faible.                                                                                                                                  |
| 159 | `styleRules[].legend.label`  | string | Entrée de légende        | Texte affiché dans la légende pour cette règle conditionnelle. Par exemple `"< 25 mm"`, `"100 000 – 500 000 hab."`. Chaque styleRule génère automatiquement une entrée dans la légende avec la couleur/symbole correspondant et ce label.                                                                                                                                                                                         |

### 8.10 Légende du style

| #   | Paramètre      | Type   | Description             | Description longue                                                                                                                                                                                                                                                                           |
| --- | -------------- | ------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 160 | `legend.label` | string | Label de légende global | Texte affiché comme titre de cette couche dans la légende quand elle ne contient qu'une seule entrée (pas de styleRules). Par exemple `"Départements"`, `"Routes principales"`. Si des styleRules sont définies, chaque règle génère sa propre entrée dans la légende avec son propre label. |

---

## 9. Configuration popup / tooltip / sidepanel

Les 14 types de renderers disponibles dans `popup.fields[]` (couches GeoJSON), `popup.detailPopup[]` (marqueurs POI), `tooltip.fields[]` et `sidepanel.detailLayout[]` :

| #    | Type          | Variantes                | Description               | Exemple de `field`                  | Description longue                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ------------- | ------------------------ | ------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 162  | `text`        | `title`, `short`, `long` | Texte simple              | `"name"`, `"title"`                 | Affiche une valeur texte depuis les propriétés de la feature. La variante `"title"` rend le texte en gros et gras (titre principal du popup/panneau), `"short"` en taille normale, `"long"` avec retours à la ligne respectés. C'est le renderer le plus courant.                                                                                                                                                                                                                      |
| 163  | `longtext`    | `multiline`              | Texte multi-lignes        | `"description"`                     | Affiche un texte long avec les retours à la ligne et les paragraphes préservés. Idéal pour les descriptions, les notes, les commentaires. La variante `"multiline"` garantit que le texte ne sera pas tronqué.                                                                                                                                                                                                                                                                         |
| 164  | `number`      | —                        | Valeur numérique          | `"population"`                      | Affiche un nombre avec un formatage automatique (séparateurs de milliers, décimales). Par exemple `1234567` sera affiché `1 234 567`. Adapté aux statistiques, populations, surfaces.                                                                                                                                                                                                                                                                                                  |
| 165  | `metric`      | —                        | Nombre avec unité         | `"price"`                           | Affiche un nombre accompagné d'un préfixe et/ou d'un suffixe configurables. Par exemple `€ 89.50 /nuit` ou `1 250 m²`. Permet de contextualiser immédiatement la valeur numérique avec son unité de mesure.                                                                                                                                                                                                                                                                            |
| 166  | `rating`      | —                        | Notation étoiles          | `"attributes.reviews.rating"`       | Affiche une note sous forme d'étoiles (ex. ★★★★☆ pour 4/5). La valeur source est un nombre décimal (0–5) et le rendu génère automatiquement les étoiles pleines, demi-pleines et vides. Idéal pour les avis, classements, notes de qualité.                                                                                                                                                                                                                                            |
| 167  | `badge`       | —                        | Badge taxonomie           | `"categoryId"`                      | Affiche la catégorie ou sous-catégorie du POI sous forme d'étiquette colorée avec icône. La couleur et l'icône sont automatiquement résolues depuis la taxonomie. Les badges consécutifs sont regroupés visuellement. Permet à l'utilisateur d'identifier instantanément le type de POI.                                                                                                                                                                                               |
| 168  | `image`       | `default`, `hero`        | Image                     | `"photo"`                           | Affiche une image depuis une URL. La variante `"hero"` rend l'image en pleine largeur au-dessus du contenu du popup (comme une bannière). La variante `"default"` affiche l'image à taille réduite intégrée dans le flux du contenu. L'URL est validée pour éviter les injections XSS.                                                                                                                                                                                                 |
| 169  | `link`        | —                        | Hyperlien                 | `"link_wikipedia"`                  | Affiche un lien cliquable qui ouvre une URL dans un nouvel onglet. Le texte du lien peut être le label configuré ou l'URL elle-même. Les URLs sont validées (protocoles autorisés : http, https) pour prévenir les attaques XSS.                                                                                                                                                                                                                                                       |
| 170  | `list`        | `bullet`                 | Liste HTML                | `"informations"`                    | Affiche un tableau de valeurs sous forme de liste à puces (`"bullet"`) ou numérotée. Idéal pour les équipements, services, horaires, points forts. Chaque élément du tableau source devient un item de la liste.                                                                                                                                                                                                                                                                       |
| 171  | `table`       | —                        | Tableau de données        | `"schedule"`                        | Affiche des données structurées sous forme de tableau HTML (lignes et colonnes). Adapté pour les horaires d'ouverture, les tarifs par saison, les caractéristiques techniques. Les données source doivent être un tableau d'objets.                                                                                                                                                                                                                                                    |
| 172  | `tags`        | —                        | Nuage de tags             | `"tags"`                            | Affiche un tableau de mots-clés sous forme de petites étiquettes (pills) cliquables. Par exemple `"WiFi"`, `"Parking"`, `"Terrasse"`. Permet à l'utilisateur de voir rapidement les caractéristiques d'un POI.                                                                                                                                                                                                                                                                         |
| 173  | `coordinates` | —                        | Coordonnées GPS           | `"latitude"`                        | Affiche les coordonnées géographiques d'un POI au format DMS (Degrés/Minutes/Secondes) pour une lecture humaine facile, ou au format décimal. Utile pour les utilisateurs terrain qui ont besoin de saisir les coordonnées dans un GPS.                                                                                                                                                                                                                                                |
| 174  | `gallery`     | —                        | Galerie d'images          | `"gallery"`                         | Affiche un ensemble d'images sous forme de galerie navigable (miniatures cliquables avec lightbox pour agrandir). La source est un tableau d'URLs d'images. Permet à l'utilisateur de parcourir les photos d'un lieu sans quitter la carte.                                                                                                                                                                                                                                            |
| 174a | `action`      | —                        | Bouton d'action générique | _(pas de `field`, voir `actionId`)_ | **Popup uniquement** (v1). Affiche un bouton qui déclenche une action côté hôte/plugin (ouvrir une fiche backend Odoo, appeler une API, émettre un événement) **sans coupler le core à aucun backend**. Le `field` est ignoré ; l'action est identifiée par `actionId`. Au clic, le core **émet l'événement `geoleaf:popup:action`, et rien d'autre** : il n'existe ni registre de handlers, ni ouverture d'URL intégrée. Voir les paramètres dédiés et l'intégration hôte ci-dessous. |

### Type `action` — paramètres dédiés

Le renderer `action` n'utilise pas `field` ; il déclenche une action opaque au core identifiée par `actionId`. Les paramètres ci-dessous sont propres à ce type ; parmi les propriétés communes, seuls `type` et `label` l'atteignent — `variant` et `order` sont inertes ici comme partout ailleurs sur un field.

⚠️ **Ce tableau a décrit six comportements que le renderer n'a pas, du 09/06/2026 au 09/08/2026.** Il est désormais dérivé de `packages/core/src/capabilities/feature-info/render/widget-dispatch.ts:316-375`, dont le TSDoc énonce lui-même la liste courte : « **Four option keys are honoured** ». Les clés inertes sont **conservées et marquées** plutôt que supprimées : un profil existant peut les porter, et les voir disparaître du guide ferait croire à un retrait de fonctionnalité. **Chaque ligne s'ouvre désormais sur son statut — `honoré` ou `inerte` — et c'est ce mot qu'il faut lire avant d'écrire un profil.** Les 6 honorées sont listées en premier.

| Paramètre        | Type     | Requis | Description                                                                                                                                                                                                                                        |
| ---------------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actionId`       | string   | ✅     | **honoré** — identifiant opaque de l'action (ex. `"odoo:open-form"`), transmis dans l'événement. **Absent, vide ou non-string, le bouton n'est pas rendu du tout.**                                                                                |
| `label`          | string   | ❌     | **honoré** — libellé du bouton, posé via `textContent` (donc inerte au HTML, sans passer par `escapeHtml`). **Défaut : la valeur d'`actionId` elle-même.**                                                                                         |
| `confirm`        | string   | ❌     | **honoré** — message affiché via `window.confirm()` avant d'émettre. Annuler interrompt le dispatch.                                                                                                                                               |
| `confirmKey`     | string   | ❌     | **honoré** — clé i18n du message de confirmation, résolue via `getLabel()`. **Prioritaire sur `confirm`.** Seul point d'entrée de l'i18n dans ce renderer.                                                                                         |
| `requiresPlugin` | string   | ❌     | **honoré** — nom d'un plugin requis (ex. `"connector"`). Si `GeoLeaf.plugins.isLoaded()` le dit absent, **le bouton n'est pas rendu du tout** — et non « rendu puis désactivé ».                                                                   |
| `payloadFields`  | string[] | ❌     | **honoré** — liste blanche des propriétés jointes au `properties` de l'événement. ⚠️ **Sans cette clé, AUCUNE propriété n'est jointe** : le défaut va à la confidentialité, pas à la commodité. Les clés dangereuses (`__proto__`…) sont écartées. |
| `labelKey`       | string   | ❌     | ❌ **inerte** — jamais lu pour le libellé : le renderer fait `field.label ?? actionId`. Seul `confirmKey` passe par l'i18n.                                                                                                                        |
| `href`           | string   | ❌     | ❌ **inerte** — **le renderer ne gère aucun `href`.** Pour ouvrir une URL, c'est l'écouteur de l'événement qui s'en charge (cf. le `window.open` de l'exemple ci-dessous).                                                                         |
| `variant`        | string   | ❌     | ❌ **inerte** — la classe est fixe (`gl-poi-popup__action`) ; aucune classe de variante n'est émise, et le dépôt n'en porte aucun CSS.                                                                                                             |
| `order`          | number   | ❌     | ❌ **inerte** — ⚠️ **aucun tri par `order` n'existe dans le pipeline popup** : les fields sont rendus **dans l'ordre de déclaration** (`attributes-binding.ts:119-132`). Placer l'action en fin de popup se fait en la déclarant en dernier.       |
| `icon`           | string   | ❌     | ❌ **inerte** — identifiant d'icône, réservé, non rendu. _(Seule ligne dont l'ancien statut était déjà juste.)_                                                                                                                                    |

**Exemple — popup d'une couche GeoJSON avec un bouton d'action (`popup.fields[]`) :**

```json
{
    "popup": {
        "fields": [
            { "type": "text", "field": "name", "variant": "title" },
            { "type": "longtext", "field": "description" },
            {
                "type": "action",
                "actionId": "odoo:open-form",
                "label": "Ouvrir la fiche",
                "confirm": "Ouvrir la fiche dans Odoo ?",
                "requiresPlugin": "connector",
                "payloadFields": ["id", "name"]
            }
        ]
    }
}
```

⚠️ **Cet exemple portait `order` (1, 2, 99), `labelKey` et `variant` jusqu'au 09/08/2026 — les trois sont inertes** (cf. le tableau ci-dessus). Ils ont été retirés parce qu'un exemple est ce qui se copie-colle : les garder aurait continué d'enseigner un tri qui n'existe pas. **Le bouton est en fin de popup parce qu'il est déclaré en dernier**, et c'est le seul mécanisme disponible — l'ancien `"order": 99` n'y était pour rien, ce qui est précisément ce qui a rendu l'erreur invisible si longtemps.

Pour un marqueur POI, le même objet se place dans `popup.detailPopup[]` (même renderer, mêmes paramètres).

### Intégration hôte — réagir à un bouton d'action

Un seul mécanisme : l'écoute de l'événement `geoleaf:popup:action` (fire-and-forget, faiblement couplé). Le payload est sérialisable (JSON uniquement, aucune référence DOM).

```js
GeoLeaf.events.on("geoleaf:popup:action", async (e) => {
    const { actionId, layerId, featureId, properties, lngLat } = e.detail;
    if (actionId !== "odoo:open-form") return;
    const res = await fetch("/odoo/poi/open", {
        method: "POST",
        headers: GeoLeaf.Security.CSRFToken.addTokenToHeaders({
            "Content-Type": "application/json",
        }),
        body: JSON.stringify({ id: featureId, layerId }),
    });
    const { url } = await res.json();
    window.open(url, "_blank", "noopener");
});
```

> **Historique :** une version antérieure exposait aussi `GeoLeaf.Popup.registerActionHandler()` (contexte riche, `await`, `setBusy()`, `close()`). Ce registre a été retiré (**ADR-07**, `specs/CDC_kernel.md`) — plus rien ne l'invoquait depuis que le rendu popup est passé à `@geoleaf-plugins/feature-info`, qui ne dispatche que l'événement ci-dessus. La protection CSRF reste de la **responsabilité de l'écouteur** (le core ne l'ajoute pas).
>
> 🛑 **Et le tableau des types, 66 lignes plus haut, a continué de l'enseigner pendant 38 jours.** Le commit qui a purgé l'API (`d59444ae`, 02/07/2026) a écrit ce paragraphe **sans corriger la ligne du renderer `action`**, rédigée 23 jours plus tôt : le même document affirmait qu'un registre de handlers existait et qu'il avait été retiré. Aucune gate ne pouvait le voir — `_docs_projet/` est **délibérément hors du corpus** des gates d'exemples (`scripts/lib/tsdoc-examples.cjs`), et les deux passages sont en **prose** (cellule de tableau, blockquote), là où `validate-docs-examples.cjs` ne lit que les blocs clôturés. **Sur ce fichier, la relecture humaine est le seul filet.**

> **Sécurité :** payload de l'événement borné par `payloadFields` — **vide par défaut** — et clés dangereuses (`__proto__`…) écartées. Aucun `onclick` inline ; le libellé est posé via `textContent`, donc inerte au HTML. Le core n'embarque aucun code backend : l'action est entièrement déléguée à l'hôte ou à un plugin.
>
> ⚠️ **Ce paragraphe a décrit un autre markup et deux validations qui n'existent pas ici.** Le bouton est rendu `<button type="button" class="gl-poi-popup__action" data-gl-action-id="…">`, et **non** `<a role="button" data-gl-action>` — l'attribut `data-gl-action` (sans suffixe) appartient au panneau de filtres (`capabilities/filter/panel/render.ts`), pas à ce renderer. Il n'y a **ni validation de token sur `actionId`, ni `validateUrl` sur `href`** dans `renderActionButton` : `href` n'y est pas lu du tout. Vérifié le 09/08/2026 dans `widget-dispatch.ts:316-375`.

### Propriétés communes de chaque field

| Propriété     | Type    | Description        | Description longue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`        | string  | Type de renderer   | Un des **14** types ci-dessus (`text` → `action`). Détermine le rendu visuel de ce champ dans le popup, le tooltip ou le panneau latéral. _(Cette phrase a dit « 13 » jusqu'au 09/08/2026 : l'ajout du type `action` avait été fait sans recompter.)_                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `field`       | string  | Propriété source   | Chemin vers la propriété GeoJSON (supporte la dot notation : `"attributes.reviews.rating"` pour accéder à une propriété imbriquée). Le système de résolution multi-chemins parcourt automatiquement les objets imbriqués.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `label`       | string  | Libellé affiché    | Texte de titre ou de légende affiché devant la valeur. Si omis, la valeur est affichée seule (utile pour les badges, images et ratings).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `variant`     | string  | Variante de rendu  | Modifie le style de rendu sans changer le type. Par exemple `"title"` pour un texte en gros, `"hero"` pour une image pleine largeur. Les variantes disponibles dépendent du type.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `style`       | string  | Style du badge     | Pour les badges uniquement : `"category"` résout la catégorie principale, `"subcategory"` résout la sous-catégorie. Chaque style a ses propres couleurs et icônes depuis la taxonomie.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `listStyle`   | string  | Style de liste     | Pour les listes uniquement : `"bullet"` affiche des puces rondes. Sans valeur, la liste est numérotée.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `iconId`      | string  | Icône de section   | ID d'un symbole du sprite SVG affiché à côté du titre. Enrichit visuellement les sections du panneau latéral.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `accordion`   | boolean | Section repliable  | Rend la section en accordéon dans le panneau latéral : le titre est cliquable pour déplier/replier le contenu. Optimise l'espace en masquant les informations secondaires.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `defaultOpen` | boolean | Ouverte par défaut | Si la section est un accordéon, détermine si elle est ouverte ou fermée au premier affichage. Les informations prioritaires devraient être ouvertes par défaut.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `maxCount`    | number  | Nombre max d'items | Limite le nombre d'éléments affichés pour les listes et avis. Évite un panneau excessivement long avec des dizaines d'entrées.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `order`       | number  | ❌ **inerte**      | ⚠️ **Aucun tri par `order` n'est appliqué aux champs.** `fieldsForSurface()` (`capabilities/feature-info/attributes-binding.ts:119-132`) les rend **dans l'ordre de déclaration du tableau**, et aucun autre lecteur ne les trie. Pour réordonner, **déplacer l'objet dans le JSON**. _(Cette ligne a promis « les champs sont triés par `order` croissant » et « permet de réorganiser sans modifier leur position dans le JSON » jusqu'au 09/08/2026 — soit exactement l'inverse du geste à faire. ⚠️ Ne pas généraliser : `order` est bien honoré ailleurs — items de légende, sections du gestionnaire de couches, pastilles de la barre mobile —, ce qui rend l'erreur d'autant plus crédible.)_ |

---

## 10. Mapping

**Fichier :** `profiles/{id}/config/core/mapping.json` — normalise des données brutes d'une source externe (API GBIF, CSV OurAirports…) vers le format POI GeoLeaf. **Contrat (Archi S2, 2026-06-25) : toujours multi-source.**

Un `mapping.json` est **toujours** un objet de **blocs nommés par source** `{ "<sourceId>": { … } }` — une seule source = un seul bloc (il n'y a **pas** de forme « à plat » à la racine). Chaque bloc porte un `mapping` **plat** : `{ champNormalisé : "champSource" }`, où le champ normalisé peut être un **chemin pointé** (`location.lat`, `location.lng`, `attributes.<clé>`).

```jsonc
{
    "gbif": {
        "source": "https://api.gbif.org/v1/occurrence/search",
        "mapping": {
            "id": "key",
            "title": "vernacularName",
            "location.lat": "decimalLatitude",
            "location.lng": "decimalLongitude",
            "attributes.species": "species",
        },
    },
}
```

Résolution : `normalizePoiWithMapping(raw, config, sourceKey?)` — bloc auto-sélectionné s'il n'y en a qu'un, sinon précisé par `sourceKey`. Contrat figé dans `profiles/schemas/mapping.schema.json`.

**Activation (runtime).** 1) déclarer le fichier dans le manifeste : `Files.mappingFile: "config/core/mapping.json"`. 2) Sur une **couche GeoJSON**, pointer le bloc source via `data.mapping` (et, si la réponse imbrique le tableau — ex. l'API GBIF sous `results` —, `data.itemsPath`) :

```jsonc
// layers/observations_gbif/observations_gbif_config.json
"data": {
  "dataUrl": "https://api.gbif.org/v1/occurrence/search?country=GF&limit=300",
  "mapping": "gbif",        // ← nom du bloc dans mapping.json
  "itemsPath": "results"    // ← chemin du tableau dans la réponse (optionnel)
}
```

Au chargement, le loader récupère les données brutes, applique le mapping (→ format POI), puis les convertit en features GeoJSON **Points**. Les `id` numériques (ex. `key` GBIF) sont coercés en chaîne.

| #   | Paramètre (par bloc source) | Type          | Description               | Description longue                                                                                                                                                                                                                                       |
| --- | --------------------------- | ------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 175 | `<sourceId>`                | object        | Bloc de source nommé      | Une entrée par source de données (`gbif`, `ourairports`, `inpn`…). Contient `mapping` (requis) + métadonnées optionnelles (`source`, `description`, `coordinateFields`, `filter`, `categoryMapping`, `subcategoryMapping`).                              |
| 176 | `<sourceId>.source`         | string        | Source des données        | URL ou identifiant de la source d'origine des données avant normalisation.                                                                                                                                                                               |
| 177 | `<sourceId>.mapping`        | object (plat) | Correspondances de champs | Objet **plat** `{ champNormalisé : "champSource" }` convertissant les noms de propriétés des données brutes vers le format POI GeoLeaf. Chemins pointés autorisés (`location.lat`, `attributes.kind`). Ex. `{ "title": "name", "location.lat": "lat" }`. |

---

## 11. Configuration basemaps

Défini dans `config/core/basemaps.json` (référencé par `Files.basemapsFile`, fusionné à la racine du profil sous la clé `basemaps`).

| #    | Paramètre                               | Type               | Description              | Description longue                                                                                                                                                                                                                                                                                                                                                         |
| ---- | --------------------------------------- | ------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 177  | `basemaps.{id}.id`                      | string             | Identifiant unique       | ID technique du basemap, utilisé pour le référencer dans les thèmes, l'API et les préférences utilisateur. Par exemple `"street"`, `"satellite"`, `"topo"`, `"street-vector"`.                                                                                                                                                                                             |
| 178  | `basemaps.{id}.label`                   | string             | Nom affiché              | Nom lisible par l'utilisateur dans le sélecteur de fonds de carte et dans le gestionnaire de couches. Par exemple `"Plan de rue"`, `"Vue satellite"`, `"Topographique"`.                                                                                                                                                                                                   |
| 179  | `basemaps.{id}.type`                    | string             | Type de basemap          | `"raster"` (ou `"tile"`) = tuiles raster classiques. `"maplibre"` = fond vectoriel MapLibre GL. `"image"` = image géoréférencée statique (4 coins). `"hillshade"` = ombrage terrain raster-dem. `"wmts"` = flux WMTS OGC via GetCapabilities. `"wms"` = flux WMS OGC via GetMap.                                                                                           |
| 179a | `basemaps.{id}.wmts.getCapabilitiesUrl` | string             | URL GetCapabilities WMTS | **Requis si `type: "wmts"`**. URL du endpoint GetCapabilities. GeoLeaf télécharge ce XML au premier appel, extrait l'URL de tuile XYZ pour le layer demandé, puis met le résultat en cache par combinaison `(capsUrl, layer, tileMatrixSet, format)`. Ex : `"https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities"`.                                            |
| 179b | `basemaps.{id}.wmts.layer`              | string             | Identifiant layer WMTS   | Valeur `<ows:Identifier>` du layer cible dans le GetCapabilities. Si omis, le premier layer trouvé est utilisé. Si le layer demandé est absent du GetCapabilities, la résolution échoue avec une erreur log (aucun fallback silencieux sur un layer aléatoire). Ex : `"ORTHOIMAGERY.ORTHOPHOTOS"`.                                                                         |
| 179c | `basemaps.{id}.wmts.tileMatrixSet`      | string             | TileMatrixSet WMTS       | Identifiant du TileMatrixSet à utiliser. Supporte les identifiants qualifiés de plage (ex. IGN `"PM_0_19"`) : si le TileMatrixSet du GetCapabilities commence par la valeur demandée, GeoLeaf retourne la valeur exacte demandée. Ex : `"PM"` (Pseudo-Mercator). ⚠️ **Doit désigner une grille Web Mercator** — voir l'encadré ci-dessous.                                 |
| 179d | `basemaps.{id}.wmts.format`             | string             | Format tuiles WMTS       | Format MIME des tuiles WMTS. Ex : `"image/jpeg"`, `"image/png"`. Défaut : `"image/png"`.                                                                                                                                                                                                                                                                                   |
| 179e | `basemaps.{id}.wms.url`                 | string             | URL de base WMS          | **Requis si `type: "wms"`**. URL de base du service WMS (sans paramètres). Ex : `"https://example.com/geoserver/ows"`.                                                                                                                                                                                                                                                     |
| 179f | `basemaps.{id}.wms.layers`              | string             | Layer(s) WMS             | **Requis si `type: "wms"`**. Nom du ou des layers WMS (séparés par virgule si plusieurs). Injecté comme `LAYERS=` dans la requête GetMap.                                                                                                                                                                                                                                  |
| 179g | `basemaps.{id}.wms.version`             | string             | Version WMS              | Version du protocole WMS. Défaut : `"1.3.0"`.                                                                                                                                                                                                                                                                                                                              |
| 179h | `basemaps.{id}.wms.crs`                 | string             | CRS WMS                  | Système de coordonnées des requêtes GetMap. Défaut : `"EPSG:3857"`. MapLibre injecte la bbox en EPSG:3857 via `{bbox-epsg-3857}`.                                                                                                                                                                                                                                          |
| 179i | `basemaps.{id}.wms.format`              | string             | Format image WMS         | Format MIME retourné par GetMap. Défaut : `"image/png"`.                                                                                                                                                                                                                                                                                                                   |
| 179j | `basemaps.{id}.wms.transparent`         | boolean            | Transparence WMS         | Demande des tuiles avec fond transparent (`TRANSPARENT=TRUE`). Défaut : `true`.                                                                                                                                                                                                                                                                                            |
| 179k | `basemaps.{id}.wms.tileSize`            | number             | Taille tuile WMS (px)    | Largeur et hauteur des tuiles pour les requêtes GetMap. Défaut : `256`.                                                                                                                                                                                                                                                                                                    |
| 179l | `basemaps.{id}.wms.styles`              | string             | Styles WMS               | Valeur du paramètre `STYLES=` dans GetMap. Défaut : `""` (style par défaut du serveur).                                                                                                                                                                                                                                                                                    |
| 180  | `basemaps.{id}.url`                     | string             | URL des tuiles           | Template d'URL pour télécharger les tuiles, avec les placeholders `{z}` (zoom), `{x}` et `{y}` (coordonnées de la tuile). Par exemple `"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"`. Pour les basemaps MapLibre, cette URL sert de fallback raster si MapLibre GL n'est pas chargé.                                                                               |
| 181  | `basemaps.{id}.style`                   | string             | URL style MapLibre       | URL d'un fichier JSON de style MapLibre GL (pour les basemaps de type `"maplibre"` uniquement). Ce fichier définit le rendu vectoriel complet : couleurs, polices, niveaux de détail. Par exemple `"https://tiles.example.com/styles/bright/style.json"`.                                                                                                                  |
| 182  | `basemaps.{id}.attribution`             | string             | Attribution              | Texte HTML d'attribution affiché en bas de la carte pour créditer le fournisseur de tuiles, conformément aux obligations de licence des données. Par exemple `"&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>"`.                                                                                                                               |
| 183  | `basemaps.{id}.minZoom`                 | number             | Zoom minimum             | Niveau de zoom minimum à partir duquel les tuiles de ce basemap sont disponibles. En dessous, le basemap n'affiche rien (tuiles grises). Dépend du fournisseur de tuiles.                                                                                                                                                                                                  |
| 184  | `basemaps.{id}.maxZoom`                 | number             | Zoom maximum             | Niveau de zoom maximum disponible pour ce basemap. Au-delà, les tuiles du dernier niveau sont étirées (floues). OSM va jusqu'à 19, certains fournisseurs satellite jusqu'à 20+.                                                                                                                                                                                            |
| 185  | `basemaps.{id}.defaultBasemap`          | boolean            | Basemap par défaut       | Si `true`, ce basemap sera affiché au premier chargement de la carte. Un seul basemap doit avoir cette valeur à `true`. Si aucun n'est marqué par défaut, le premier de la liste est utilisé.                                                                                                                                                                              |
| 186  | `basemaps.{id}.offline`                 | boolean            | Support offline          | Indique que ce basemap peut être mis en cache pour une utilisation hors-ligne. Quand activé et que le plugin Storage est chargé, le bouton de cache permet à l'utilisateur de télécharger les tuiles de ce basemap dans IndexedDB pour une utilisation sans réseau.                                                                                                        |
| 187  | `basemaps.{id}.offlineBounds.north`     | number             | Limite nord du cache     | Latitude nord de la zone à cacher en mode offline. Seules les tuiles dans cette emprise seront téléchargées. Permet de limiter le volume de données (les tuiles de la planète entière représentent des téraoctets).                                                                                                                                                        |
| 188  | `basemaps.{id}.offlineBounds.south`     | number             | Limite sud du cache      | Latitude sud de la zone à cacher. Combinée avec north, east et west, définit le rectangle de tuiles à télécharger.                                                                                                                                                                                                                                                         |
| 189  | `basemaps.{id}.offlineBounds.east`      | number             | Limite est du cache      | Longitude est de la zone à cacher.                                                                                                                                                                                                                                                                                                                                         |
| 190  | `basemaps.{id}.offlineBounds.west`      | number             | Limite ouest du cache    | Longitude ouest de la zone à cacher.                                                                                                                                                                                                                                                                                                                                       |
| 191  | `basemaps.{id}.cacheMinZoom`            | number             | Zoom min à cacher        | Niveau de zoom minimum à inclure dans le cache offline. Les niveaux en dessous ne sont pas téléchargés. Permet de limiter le volume : les zooms faibles couvrent toute la zone avec peu de tuiles, les zooms élevés nécessitent exponentiellement plus de tuiles.                                                                                                          |
| 192  | `basemaps.{id}.cacheMaxZoom`            | number             | Zoom max à cacher        | Niveau de zoom maximum à inclure dans le cache offline. Chaque niveau supplémentaire multiplie par ~4 le nombre de tuiles. Par exemple, cacher du zoom 5 au zoom 14 est raisonnable (~quelques centaines de Mo), mais aller au zoom 18 peut représenter des Go.                                                                                                            |
| 192b | `basemaps.{id}.fallbackUrl`             | string             | URL raster de secours    | URL de tuiles raster utilisée comme fallback quand le basemap est de type `"maplibre"` et que MapLibre GL JS n'est pas disponible ou ne peut pas initialiser le rendu vectoriel. Même format que `url` (template `{z}/{x}/{y}`). Garantit un affichage dégradé mais fonctionnel sans MapLibre.                                                                             |
| 192c | `basemaps.{id}.subdomains`              | string \| string[] | Sous-domaines            | Sous-domaines du serveur de tuiles pour la parallélisation des requêtes HTTP. Peut être une chaîne (ex. `"abc"` = sous-domaines `a`, `b`, `c`) ou un tableau (ex. `["a", "b", "c"]`). Le placeholder `{s}` dans l'URL est remplacé par un sous-domaine aléatoire à chaque requête, permettant de contourner la limite de connexions simultanées par domaine du navigateur. |
| 192d | `basemaps.{id}.apiKey`                  | string             | Clé API provider         | Clé API pour les providers qui en nécessitent une. Injectée à la place de `{apikey}` dans les URLs de tuiles raster, ou ajoutée comme paramètre `apikey=` dans `wmts.getCapabilitiesUrl` pour les services WMTS à quota (ex. IGN avec compte dédié). Si absent alors que l'URL contient `{apikey}`, un avertissement est émis dans la console et le basemap est désactivé. |
| 193a | `basemaps.{id}.terrain.enabled`         | boolean            | Activer le terrain 3D    | Active le rendu de relief 3D pour ce basemap via MapLibre GL JS. Fonctionne sur les basemaps raster (`type: "tile"`) et vectoriels (`type: "maplibre"`). Si `false` ou absent, le basemap reste en vue 2D classique.                                                                                                                                                       |
| 193b | `basemaps.{id}.terrain.demUrl`          | string             | URL du DEM               | URL du service de tuiles d'élévation (Digital Elevation Model) avec les placeholders `{z}`, `{x}`, `{y}`. Source validée en production : AWS Terrarium `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (mondial, résolution ~30m, gratuit). Obligatoire si `terrain.enabled: true`.                                                              |
| 193c | `basemaps.{id}.terrain.demEncoding`     | string             | Encodage DEM             | Format d'encodage des valeurs d'élévation dans les tuiles DEM. `"terrarium"` = format Mapzen (R×256 + G + B/256 − 32768). `"mapbox"` = format Mapbox Terrain-RGB. Défaut : `"terrarium"`.                                                                                                                                                                                  |
| 193d | `basemaps.{id}.terrain.demMaxZoom`      | number             | Zoom max DEM             | Niveau de zoom maximum disponible pour les tuiles DEM. MapLibre utilisera le zoom le plus élevé disponible pour les niveaux supérieurs (over-zoom). Défaut : `15`.                                                                                                                                                                                                         |
| 193e | `basemaps.{id}.terrain.exaggeration`    | number             | Exagération verticale    | Facteur d'amplification du relief. `1.0` = relief réel, `1.5` = relief accentué de 50%, `3.0` = très exagéré. Recommandé : `1.5`. Plage valide : `1.0`–`3.0`.                                                                                                                                                                                                              |
| 193f | `basemaps.{id}.terrain.default3D`       | boolean            | Activation automatique   | Si `true`, le terrain 3D est activé automatiquement dès que l'utilisateur sélectionne ce basemap. Pas de toggle UI requis. Quand l'utilisateur passe à un basemap sans terrain, le relief 3D est automatiquement désactivé. Défaut : `false`.                                                                                                                              |
| 193g | `basemaps.{id}.terrain.pitch`           | number             | Inclinaison caméra       | Angle d'inclinaison de la caméra en degrés lors de l'activation du terrain 3D (si `default3D: true`). `0` = vue de dessus, `60` = vue oblique prononcée. Doit être ≤ `map.maxPitch`. Défaut : `45`.                                                                                                                                                                        |
| 193h | `basemaps.{id}.terrain.bearing`         | number             | Rotation de la vue       | Rotation de la vue en degrés (sens horaire depuis le nord) lors de l'activation du terrain 3D. `0` = nord en haut, `180` = sud en haut. Défaut : `0`.                                                                                                                                                                                                                      |
| 193i | `style.fillExtrusionColor`              | string             | Couleur extrusion        | Couleur de surface des volumes extrudés (hex ou CSS valide). Obligatoire pour les couches `geometry: "fill-extrusion"`. Ex : `"#a8dadc"`. Ajouté en v2.2.0.                                                                                                                                                                                                                |
| 193j | `style.fillExtrusionOpacity`            | number             | Opacité extrusion        | Opacité des volumes extrudés (0 = transparent, 1 = opaque). Défaut : `1.0`. Ajouté en v2.2.0.                                                                                                                                                                                                                                                                              |
| 193k | `style.fillExtrusionHeight`             | number\|string     | Hauteur extrusion        | Hauteur des volumes en mètres. Valeur numérique fixe (ex. `25`) ou nom de champ feature (ex. `"hauteur"`) — GeoLeaf génère l'expression MapLibre `["get", "hauteur"]` automatiquement. Obligatoire. La validation est assurée par `maplibre-extrusion-validator.ts`. Ajouté en v2.2.0.                                                                                     |
| 193l | `style.fillExtrusionBase`               | number\|string     | Base extrusion           | Hauteur de la base des volumes en mètres. Permet de créer des volumes « flottants ». Accepte une valeur fixe ou un nom de champ feature. Défaut : `0`. Ajouté en v2.2.0.                                                                                                                                                                                                   |

#### ⚠️ WMTS — la grille doit être Web Mercator, et c'est désormais vérifié

GeoLeaf convertit un flux WMTS en gabarit d'URL XYZ, en transposant `{TileMatrix}` → `{z}`,
`{TileRow}` → `{y}` et `{TileCol}` → `{x}`. **Cette transposition n'est correcte que sur une grille
Web Mercator en quadtree** : `EPSG:3857`, origine au coin du monde, tuiles 256 px, matrices
`2^z × 2^z`. Beaucoup de services publient d'autres grilles à côté — la Géoplateforme IGN en définit
**763**, dont des centaines en Lambert-93 (`EPSG:2154`).

Depuis le 07/08/2026, le résolveur **lit la définition du `<TileMatrixSet>` et refuse** ce qui n'est
pas transposable, au lieu d'afficher des tuiles décalées sans rien dire (B-151) :

| Situation                                                              | Comportement                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Grille conforme (ex. IGN `PM`)                                         | résolution normale                                                            |
| CRS non Web Mercator, origine hors monde, tuiles ≠ 256, matrices ≠ 2^z | **échec avec `Log.error` nommant la cause** — le fond ne s'affiche pas        |
| `tileMatrixSet` demandé absent des liens de la couche                  | repli sur le premier lien, **précédé d'un `Log.warn`** listant les possibles  |
| Définition absente du GetCapabilities (seul le lien est présent)       | résolution poursuivie, **avec un `Log.warn`** — la grille n'a pas pu être lue |

La dernière ligne est un choix délibéré : échouer faute d'information rejetterait des services qui
fonctionnent aujourd'hui. **La garde ne refuse que les grilles qu'elle a réellement lues.**

Si un fond WMTS cesse de s'afficher après cette version, lire le message d'erreur : il nomme la
propriété fautive. Le remède est de désigner un `tileMatrixSet` Web Mercator — pas de contourner la
garde.

### Déclarer les basemaps dans le profil

**Le profil est l'unique source de vérité.** Chaque basemap doit être déclaré explicitement dans `basemaps.json` du profil. GeoLeaf n'inclut aucun catalogue de providers préconfigurés — le gestionnaire de couches affiche exactement les fonds déclarés pour le profil concerné, ni plus ni moins.

**Exemple — fonds raster courants (sans clé API) :**

```json
{
    "basemaps": {
        "street": {
            "id": "street",
            "label": "Street",
            "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
            "attribution": "Tiles © Esri",
            "minZoom": 3,
            "maxZoom": 16,
            "defaultBasemap": true,
            "offline": false
        },
        "satellite": {
            "id": "satellite",
            "label": "Satellite",
            "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            "attribution": "Tiles © Esri",
            "minZoom": 5,
            "maxZoom": 18,
            "offline": false
        },
        "topo": {
            "id": "topo",
            "label": "Topographique",
            "url": "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
            "subdomains": "abc",
            "attribution": "© OpenStreetMap contributors, © OpenTopoMap (CC-BY-SA)",
            "minZoom": 5,
            "maxZoom": 17,
            "offline": false
        }
    }
}
```

**Exemple — IGN Géoportail France (WMTS + vecteur, sans clé API) :**

```json
{
    "basemaps": {
        "ign-plan": {
            "id": "ign-plan",
            "label": "IGN Plan",
            "type": "maplibre",
            "style": "https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json",
            "attribution": "© IGN France — Geoportail",
            "defaultBasemap": true
        },
        "ign-satellite": {
            "id": "ign-satellite",
            "label": "IGN Satellite",
            "type": "wmts",
            "wmts": {
                "getCapabilitiesUrl": "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities",
                "layer": "ORTHOIMAGERY.ORTHOPHOTOS",
                "tileMatrixSet": "PM",
                "format": "image/jpeg"
            },
            "attribution": "Geoportail France",
            "offline": false
        },
        "ign-cadastre": {
            "id": "ign-cadastre",
            "label": "IGN Cadastre",
            "type": "wmts",
            "wmts": {
                "getCapabilitiesUrl": "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities",
                "layer": "CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
                "tileMatrixSet": "PM",
                "format": "image/png"
            },
            "attribution": "Geoportail France",
            "offline": false
        }
    }
}
```

**Exemple — provider avec clé API (Thunderforest) :**

```json
{
    "basemaps": {
        "thunderforest-outdoors": {
            "id": "thunderforest-outdoors",
            "label": "Outdoor",
            "url": "https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey={apikey}",
            "apiKey": "VOTRE_CLE_THUNDERFOREST",
            "subdomains": "abc",
            "attribution": "© Thunderforest, © OpenStreetMap contributors",
            "minZoom": 2,
            "maxZoom": 22,
            "offline": false
        }
    }
}
```

> **Note IGN :** l'endpoint public `data.geopf.fr` ne nécessite pas de clé API pour les couches standard (Plan IGN, Satellite, Cadastre). Le champ `apiKey` est optionnel — il injecte une clé comme paramètre `apikey=` dans l'URL GetCapabilities pour les comptes IGN à quota élevé.

> **Comportement dégradé :** si `apiKey` est absent pour une URL contenant `{apikey}`, un avertissement est émis dans la console et le basemap n'est pas disponible dans le sélecteur. Aucune erreur silencieuse, aucune tuile brisée.

---

## 11b. Configuration ui.json

**Fichier :** `profiles/{id}/config/core/ui.json` (chemin déclaré dans `Files.uiFile`)
**Obligatoire :** Non (paramètres repris depuis profile.json si absent)

> **Note :** Depuis v1.3.0, les paramètres UI sont externalisés dans `ui.json` (layout v2 : `config/core/ui.json`). Ils restent acceptés inline dans `profile.json` pour la rétrocompatibilité.

| #   | Paramètre                | Type    | Défaut  | Description                                                                               |
| --- | ------------------------ | ------- | ------- | ----------------------------------------------------------------------------------------- |
| 1   | `search`                 | object  | —       | Configuration du module recherche/filtres                                                 |
| 2   | `layerManagerConfig`     | object  | —       | Titre, sections, comportement du layer manager                                            |
| 3   | `modules.legend`         | object  | —       | Configuration de la légende (capacité in-core — ex-`legendConfig`, voir §15)              |
| 4   | `poiConfig`              | object  | —       | Options POI (clustering, popup, markers)                                                  |
| 5   | `modules.table`          | object  | —       | Configuration de la table de données (plugin `@geoleaf-plugins/table` — ex-`tableConfig`) |
| 6   | `scaleConfig`            | object  | —       | Configuration de l'échelle cartographique                                                 |
| 8   | `scaleConfig.scaleNivel` | boolean | `false` | Afficher l'échelle en niveau de zoom                                                      |

---

## 12. Configuration filtre — `modules.filter` (capacité in-core)

> ⚠️ **Migration cassante (S5, capacité `filter`).** Le panneau de filtre/recherche ne vit plus sous `config/core/ui.json > searchConfig` (ni le flag `ui.showFilterPanel`) mais sous **`modules.filter`** — fichier `config/plugins/filter.json` référencé par `Files.modules.filter`. **Aucun shim** : un profil conservant `searchConfig` / `ui.showFilterPanel` ne charge plus la configuration du filtre. La capacité `filter` reste **intégrée au core** (présente en Full **et** Lite) — ce n'est pas un plugin externe.

Le filtre est désormais **attributaire générique** : géométrie-agnostique (point / ligne / polygone) et multi-sources. Un descripteur déclaratif par champ (`fields[]`) indique quels attributs sont filtrables et comment. Prédicat **hybride** : natif MapLibre `setFilter` (GPU, zéro re-tuilage) quand exprimable, repli JS sinon.

| #   | Paramètre                           | Type    | Défaut | Description                                                                  |
| --- | ----------------------------------- | ------- | ------ | ---------------------------------------------------------------------------- |
| 193 | `modules.filter.enabled`            | boolean | `true` | Gate de la capacité (**opt-out** — ex-`ui.showFilterPanel`). Absent ⟹ actif. |
| 194 | `modules.filter.title`              | string  | —      | Titre du panneau (ex-`searchConfig.title`).                                  |
| 196 | `modules.filter.actions.applyLabel` | string  | i18n   | Libellé du bouton Appliquer.                                                 |
| 197 | `modules.filter.actions.resetLabel` | string  | i18n   | Libellé du bouton Réinitialiser.                                             |

### Descripteur de champ filtrable (`modules.filter.fields[]`)

Chaque entrée déclare un champ filtrable. **Attributs communs** : `id` (identifiant stable — état / permalink / DOM), `kind` (type de filtre), `label` (libellé affiché), `layers?` (**portée opt-in** : absent ⟹ toutes les couches ; présent ⟹ uniquement ces couches — une couche non listée n'est jamais filtrée par ce champ).

| kind        | Attributs spécifiques                                                                          | Contrôle UI                      | Prédicat                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| `taxonomy`  | `field`, `taxonomyRef`, `subField?`                                                            | arbre catégorie / sous-catégorie | valeur ∈ catégorie sélectionnée                                           |
| `tag`       | `field`, `options: "auto" \| string[]`                                                         | badges (liste plate)             | valeur(s) ∩ tags sélectionnés                                             |
| `range`     | `field`, `min?`, `max?`, `step?`                                                               | curseur                          | `min ≤ valeur ≤ max`                                                      |
| `text`      | `searchFields[]`, `placeholder?`                                                               | champ de saisie                  | sous-chaîne dans l'un des `searchFields`, insensible casse **et accents** |
| `boolean`   | `field`                                                                                        | case à cocher                    | `field` vrai                                                              |
| `proximity` | `radiusMin` / `radiusMax` / `radiusStep` / `radiusDefault`, `buttonLabel?`, `instructionText?` | curseur rayon + point carte      | distance haversine ≤ rayon                                                |

⚠️ **Les six genres sont évalués par le MÊME prédicat JavaScript.** Cette table a porté, jusqu'au
29/07/2026, une colonne distinguant un prédicat « natif GPU » (`taxonomy`, `range`, `boolean`) d'un
prédicat « JS » (`tag`, `text`, `proximity`). **Cette distinction n'existe nulle part dans le code**
— mesuré : la capacité `filter` ne construit **aucune** expression MapLibre. Elle passe un prédicat
JavaScript unique au seam `GeoJSONCore.filterFeatures`, qui applique ensuite son filtre GPU **par
identifiants**, identiquement pour les six. Un chemin natif a bien été écrit et testé, mais il n'a
**jamais été branché** puis a été retiré, avec son motif mesuré dans `taxonomy-options.ts`. La
distinction publiée pouvait orienter un choix de modélisation de données — d'où son retrait
(**B-68**). Détail : [`specs/capacites/filter.md`](../specs/capacites/filter.md).

**Correspondances de migration** (`searchConfig` → `modules.filter`) : `ui.showFilterPanel` → `enabled` ; `title` / `actions` → identiques ; `searchConfig.searchPlaceholder` → **`fields[] kind:"text"` → `placeholder`** (le panneau S5 n'a pas de champ de recherche global : la clé globale `modules.filter.searchPlaceholder` a existé sans jamais être lue, et a été **retirée** — B.22) ; `radius{Min,Max,Step,Default}` → un champ `kind:"proximity"` ; `filters[] type:"search"` → `kind:"text"` ; `"proximity"` → `"proximity"` ; `"tree"` (catégories) → `kind:"taxonomy"` (`field` / `taxonomyRef` / `layers` désormais **explicites**) ; `"multiselect-tags"` → `kind:"tag"`. Le filtre catégories n'est migré que si les features portent les identifiants de catégorie (sinon réactivable via `taxonomy.fieldMappings`).

---

## 13. Configuration tableau de données — `modules.table` (plugin)

> ⚠️ **Migration cassante (extraction plugin).** Le tableau de données a été extrait du core vers le plugin MIT `@geoleaf-plugins/table`. La configuration **globale** ne vit plus sous la clé racine `tableConfig` (ni `ui.showTable`) mais sous **`modules.table.*`** — fichier `config/plugins/table.json` référencé par `Files.modules.table`. **Aucun shim** : un profil conservant `tableConfig` à la racine ne charge plus la configuration. Le binding **par couche** `layer.config.table.*` (§7.8) reste, lui, sur la couche. Clés (lues par le plugin) :

| #   | Paramètre                          | Type    | Défaut | Description           | Description longue                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------- | ------- | ------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 209 | `modules.table.enabled`            | boolean | —      | Activer le tableau    | Active le composant de tableau tabulaire qui affiche les features géographiques sous forme de lignes et colonnes en bas de la carte. Quand activé, un bouton ou un panneau permet à l'utilisateur de voir les données sous forme de table, en complément de la vue carte.                                       |
| 210 | `modules.table.defaultVisible`     | boolean | —      | Visible au chargement | Détermine si le tableau est affiché dès le chargement de la page (`true`) ou s'il est masqué et doit être ouvert manuellement par l'utilisateur (`false`). Sur mobile, il est recommandé de le masquer par défaut pour économiser l'espace écran.                                                               |
| 211 | `modules.table.pageSize`           | number  | —      | Lignes par page       | Nombre de lignes affichées par page dans le tableau. Par exemple `25` affiche 25 features par page avec une pagination en bas. Un nombre élevé peut ralentir le rendu si les données sont nombreuses ; le scroll virtuel est recommandé pour les gros volumes.                                                  |
| 212 | `modules.table.maxRowsPerLayer`    | number  | —      | Max lignes par couche | Limite le nombre total de features affichées dans le tableau pour une couche donnée. Évite de charger des milliers de lignes dans le DOM si une couche contient un très grand nombre de features. Les features au-delà de cette limite sont ignorées dans le tableau (mais restent visibles sur la carte).      |
| 213 | `modules.table.enableExportButton` | boolean | —      | Bouton export         | Affiche un bouton permettant à l'utilisateur d'exporter les données du tableau en fichier CSV ou Excel. L'export inclut toutes les features visibles (après filtrage) avec les colonnes configurées. Utile pour les utilisateurs qui veulent travailler les données en dehors de l'application.                 |
| 214 | `modules.table.virtualScrolling`   | boolean | —      | Scroll virtuel        | Active le rendu virtuel (seules les lignes visibles dans la fenêtre sont rendues dans le DOM). Indispensable pour les couches avec des centaines ou milliers de features : sans scroll virtuel, le navigateur doit créer des milliers de lignes HTML, ce qui ralentit le rendu et consomme beaucoup de mémoire. |
| 215 | `modules.table.defaultHeight`      | string  | —      | Hauteur par défaut    | Hauteur du panneau du tableau au chargement, en pourcentage de la hauteur de la carte (`"40%"`) ou en pixels (`"300px"`). Détermine la répartition verticale entre la carte et le tableau.                                                                                                                      |
| 216 | `modules.table.minHeight`          | string  | —      | Hauteur minimale      | Hauteur minimale du tableau quand l'utilisateur le redimensionne. Empêche de réduire le tableau au point qu'il devienne inutilisable.                                                                                                                                                                           |
| 217 | `modules.table.maxHeight`          | string  | —      | Hauteur maximale      | Hauteur maximale du tableau quand l'utilisateur le redimensionne. Empêche le tableau de masquer complètement la carte.                                                                                                                                                                                          |
| 218 | `modules.table.resizable`          | boolean | —      | Redimensionnable      | Permet à l'utilisateur de redimensionner la hauteur du tableau en glissant le bord supérieur. Une poignée de redimensionnement apparaît entre la carte et le tableau. L'utilisateur peut ainsi adapter la répartition carte/tableau selon ses besoins momentanés.                                               |

---

## 13b. Configuration plugin Print (`@geoleaf-plugins/print`)

Défini dans `config/plugins/print.json` (bloc `modules.print`, référencé par `Files.modules.print`). ⚠️ _La clé racine legacy `printConfig` n'est **plus acceptée** depuis la clôture S14 : `modules.<id>` est l'unique forme. Vérifié le 27/07/2026 — `applyModulesCompat`, `LEGACY_ROOT_KEYS` et le repli de `resolveModuleConfig` ont **0 occurrence** dans `packages/core/src/`. Une config posée sur l'ancienne clé est ignorée **en silence**._. Nécessite le chargement du script `@geoleaf-plugins/print` **après** `@geoleaf/core`. Tous les champs sont optionnels ; les valeurs par défaut s'appliquent si la clé est absente.

```json
{
    "printConfig": {
        "enabled": true,
        "showButton": true,
        "defaultFormat": "A4",
        "availableFormats": ["A4", "A3"],
        "dpi": 300,
        "exportFormats": ["pdf", "jpg"]
    }
}
```

| N°  | Paramètre                                 | Type     | Défaut              | Titre court            | Description                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------- | -------- | ------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 219 | `printConfig.enabled`                     | boolean  | `true`              | Activer le plugin      | Active ou désactive entièrement le plugin d'impression. Quand `false`, le bouton de la toolbar et l'écouteur d'événement ne sont pas enregistrés ; l'API programmatique (`GeoLeaf.Print.*`) reste disponible pour un usage via code.                                                                                         |
| 220 | `printConfig.showButton` / `ui.showPrint` | boolean  | `true`              | Afficher le bouton     | Affiche ou masque l'icône imprimante dans la barre pill de gauche. Équivalent à `ui.showPrint` dans la section `ui` du profil.                                                                                                                                                                                               |
| 221 | `printConfig.defaultFormat`               | string   | `"A4"`              | Format par défaut      | Format papier pré-sélectionné à l'ouverture du modal (ex. `"A4"`, `"A3"`). L'utilisateur peut toujours changer de format dans le modal.                                                                                                                                                                                      |
| 222 | `printConfig.availableFormats`            | string[] | `["A4","A3"]`       | Formats disponibles    | Liste des formats papier proposés dans le sélecteur du modal. Ajouter `"A2"`, `"A1"`, `"A0"` ou un format personnalisé en les enregistrant d'abord via `GeoLeaf.Print.registerPageFormat()`.                                                                                                                                 |
| 223 | `printConfig.dpi`                         | number   | `300`               | Résolution (DPI)       | Résolution d'impression en points par pouce. 300 DPI est le standard « qualité impression » : 1 pouce (25,4 mm) = 300 pixels. Sur mobile, la résolution est automatiquement réduite si la surface canvas dépasse `maxCanvasPxMobile`.                                                                                        |
| 224 | `printConfig.availableDpi`                | number[] | `[300]`             | DPI disponibles        | Liste des résolutions sélectionnables. Un seul élément = pas de sélecteur DPI affiché dans le modal. Valeurs typiques : 150 (brouillon), 300 (standard), 600 (affiche).                                                                                                                                                      |
| 225 | `printConfig.margins`                     | object   | `10 mm` sur 4 côtés | Marges                 | Marges de la planche en millimètres — `{ "top": 10, "right": 10, "bottom": 10, "left": 10 }`. Réduire les marges agrandit la zone carte.                                                                                                                                                                                     |
| 226 | `printConfig.includeLegend`               | boolean  | `false`             | Légende par défaut     | État par défaut de la case « Légende » dans le modal. La légende est rendue en ligne sous la carte (même modèle de données que le panneau légende du core). Non disponible si le module legend n'est pas chargé.                                                                                                             |
| 227 | `printConfig.includeScale`                | boolean  | `true`              | Échelle par défaut     | État par défaut de la case « Échelle ». La barre d'échelle est incrustée en bas à gauche de la zone carte.                                                                                                                                                                                                                   |
| 228 | `printConfig.includeNorthArrow`           | boolean  | `true`              | Flèche nord par défaut | État par défaut de la case « Flèche nord ». La flèche nord SVG est incrustée discrètement en haut à droite de la zone carte.                                                                                                                                                                                                 |
| 229 | `printConfig.title`                       | string   | `""`                | Titre pré-rempli       | Titre pré-rempli dans le champ titre du modal. L'utilisateur peut le modifier avant l'export.                                                                                                                                                                                                                                |
| 230 | `printConfig.exportFormats`               | string[] | `["pdf","jpg"]`     | Formats d'export       | Boutons d'export affichés dans le modal, dans l'ordre indiqué. Ajouter un format personnalisé (ex. `"png"`) en le déclarant ici et en l'enregistrant via `GeoLeaf.Print.registerExporter()`.                                                                                                                                 |
| 231 | `printConfig.jpgQuality`                  | number   | `0.92`              | Qualité JPEG           | Qualité de l'export JPEG, passée à `canvas.toBlob` (0 = compression maximale / qualité minimale ; 1 = sans perte). 0.92 offre un bon équilibre taille/qualité.                                                                                                                                                               |
| 232 | `printConfig.serverEndpoint`              | string   | —                   | URL repli serveur      | URL de l'endpoint de rendu serveur optionnel. Désactivé par défaut. Quand défini, le plugin bascule automatiquement sur ce serveur si la capture client échoue (canvas contaminé par CORS, WebGL indisponible) ou si `forceServer` est `true`. Voir la section « Repli serveur » du README du plugin pour le protocole POST. |
| 233 | `printConfig.serverHeaders`               | object   | `{}`                | En-têtes serveur       | En-têtes HTTP statiques ajoutés à chaque requête vers `serverEndpoint` (ex. clés d'API, tokens d'authentification). Les cookies de session du navigateur sont transmis normalement.                                                                                                                                          |
| 234 | `printConfig.forceServer`                 | boolean  | `false`             | Forcer le serveur      | Force systématiquement le rendu via `serverEndpoint`, court-circuitant la capture client. Utile pour les environnements sans WebGL ou pour valider l'endpoint serveur en développement.                                                                                                                                      |
| 235 | `printConfig.maxCanvasPxMobile`           | number   | `16 000 000`        | Plafond canvas mobile  | Surface canvas maximale (en pixels) sur les appareils mobiles. Au-delà, le DPI est réduit automatiquement pour rester dans cette limite. 16 Mpx correspond à la limite d'iOS Safari.                                                                                                                                         |

> Pour les détails d'intégration (API programmatique, prérequis CORS, repli serveur, comportement mobile, extensibilité), voir le [README du plugin](../../packages/plugins/print/README.md).

---

## 13c. Configuration plugin Measure (`@geoleaf-plugins/measure`)

Défini dans `config/plugins/measure.json` (bloc `modules.measure`, référencé par `Files.modules.measure`). ⚠️ _La clé racine legacy `measureConfig` n'est **plus acceptée** depuis la clôture S14 : `modules.<id>` est l'unique forme. Vérifié le 27/07/2026 — `applyModulesCompat`, `LEGACY_ROOT_KEYS` et le repli de `resolveModuleConfig` ont **0 occurrence** dans `packages/core/src/`. Une config posée sur l'ancienne clé est ignorée **en silence**._. Nécessite le chargement du script `@geoleaf-plugins/measure` **après** `@geoleaf/core`. Tous les champs sont optionnels ; les valeurs par défaut s'appliquent si la clé est absente.

```json
{
    "measureConfig": {
        "enabled": true,
        "showButton": true,
        "position": "top-left",
        "distanceUnit": "km",
        "areaUnit": "ha",
        "tools": ["distance", "area", "circle", "annotation-tooltip", "gps"],
        "dpi": 300,
        "gpsMinDistance": 5,
        "tooltipDefaultSize": { "widthPx": 160, "heightPx": 80 }
    }
}
```

| #   | Paramètre                                     | Type     | Défaut                           | Libellé court                  | Description longue                                                                                                                                                                                  |
| --- | --------------------------------------------- | -------- | -------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 236 | `measureConfig.enabled`                       | boolean  | `true`                           | Activer le plugin              | Active ou désactive entièrement le plugin. Quand `false`, la toolbar flottante et les écouteurs d'événements ne sont pas enregistrés ; l'API programmatique (`GeoLeaf.Measure.*`) reste disponible. |
| 237 | `measureConfig.showButton` / `ui.showMeasure` | boolean  | `true`                           | Afficher la toolbar            | Affiche ou masque la pill toolbar flottante. Équivalent à `ui.showMeasure` dans la section `ui` du profil.                                                                                          |
| 238 | `measureConfig.position`                      | string   | `"top-left"`                     | Position initiale              | Position initiale de la pill toolbar flottante. Valeurs : `"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"`. L'utilisateur peut déplacer la toolbar par glisser-déposer.               |
| 239 | `measureConfig.distanceUnit`                  | string   | `"km"`                           | Unité de distance              | Unité de distance affichée par défaut. `"km"` ou `"m"`. L'utilisateur peut basculer via le cycler d'unités dans la toolbar.                                                                         |
| 240 | `measureConfig.areaUnit`                      | string   | `"ha"`                           | Unité de surface               | Unité de surface affichée par défaut. `"ha"` ou `"m²"`. L'utilisateur peut basculer via le cycler d'unités dans la toolbar.                                                                         |
| 241 | `measureConfig.tools`                         | string[] | tous les outils                  | Outils actifs                  | Liste des outils affichés dans la toolbar. Omettre un outil le masque. Valeurs possibles : `"distance"`, `"area"`, `"circle"`, `"annotation-tooltip"`, `"gps"`.                                     |
| 242 | `measureConfig.dpi`                           | number   | `300`                            | Résolution pour export         | Résolution (DPI) utilisée lors de la composition print (`getPrintableAnnotations`). Doit correspondre au `printConfig.dpi` pour un positionnement correct des annotations.                          |
| 243 | `measureConfig.gpsMinDistance`                | number   | `5`                              | Distance min GPS (m)           | Distance minimale en mètres entre deux points GPS enregistrés dans un track. Réduit le bruit de position sur les appareils peu précis.                                                              |
| 244 | `measureConfig.tooltipDefaultSize`            | object   | `{ widthPx: 160, heightPx: 80 }` | Taille par défaut des tooltips | Dimensions en pixels CSS d'une nouvelle annotation tooltip à la création. L'utilisateur peut redimensionner l'annotation par glisser sur les bords.                                                 |
| 245 | `measureConfig.annotationStrokeColor`         | string   | `"#2563eb"`                      | Couleur bordure annotation     | Couleur de la bordure des annotations tooltip (CSS color).                                                                                                                                          |
| 246 | `measureConfig.annotationFillColor`           | string   | `"rgba(37,99,235,0.08)"`         | Couleur fond annotation        | Couleur de fond des annotations tooltip (CSS color).                                                                                                                                                |
| 247 | `measureConfig.lineColor`                     | string   | `"#2563eb"`                      | Couleur des lignes             | Couleur des segments de mesure (distance, périmètre, rayon).                                                                                                                                        |
| 248 | `measureConfig.lineFillColor`                 | string   | `"rgba(37,99,235,0.08)"`         | Couleur remplissage            | Couleur de remplissage des polygones de mesure (surface, cercle).                                                                                                                                   |
| 249 | `measureConfig.lineWidth`                     | number   | `2`                              | Épaisseur des lignes           | Épaisseur en pixels des lignes de mesure.                                                                                                                                                           |
| 250 | `measureConfig.recapBoxEnabled`               | boolean  | `true`                           | Boîte récap                    | Affiche ou masque la boîte récapitulative flottante pendant qu'un outil est actif.                                                                                                                  |
| 251 | `measureConfig.recapPosition`                 | string   | `"bottom-center"`                | Position de la récap           | Position de la boîte récapitulative. Valeurs : `"bottom-center"`, `"bottom-left"`, `"bottom-right"`, `"top-center"`.                                                                                |
| 252 | `measureConfig.exportFileName`                | string   | `"mesures"`                      | Nom de fichier export          | Nom de base (sans extension) du fichier GeoJSON exporté.                                                                                                                                            |

> Pour les détails d'intégration (API programmatique, intégration print, GPS, annotations), voir le [README du plugin](../../packages/plugins/measure/README.md).

---

## 13d. Configuration plugin Editor (`@geoleaf-plugins/editor`)

Défini dans `config/plugins/editor.json` (bloc `modules.editor`, référencé par `Files.modules.editor`). ⚠️ _La clé racine legacy `editorConfig` n'est **plus acceptée** depuis la clôture S14 : `modules.<id>` est l'unique forme. Vérifié le 27/07/2026 — `applyModulesCompat`, `LEGACY_ROOT_KEYS` et le repli de `resolveModuleConfig` ont **0 occurrence** dans `packages/core/src/`. Une config posée sur l'ancienne clé est ignorée **en silence**._. Nécessite le chargement du script `@geoleaf-plugins/editor` **après** `@geoleaf/core` ; persistance offline optionnelle via `@geoleaf-plugins/storage`. Tous les champs sont optionnels. Le moteur de dessin **Terra Draw est chargé en lazy** (chunk séparé téléchargé à la 1ʳᵉ activation d'un outil — déployer tous les `dist/*.js` ensemble).

Une couche devient éditable via un bloc `edition` (`create` / `update` / `delete`, chacun **absent ≡ refusé**) + `editableGeometryTypes` + un bloc `write` (la cible d'envoi) dans sa définition de couche. Les **champs saisissables** ne sont plus déclarés à part : ce sont les entrées de `attributes.fields[]` qui portent un bloc `edit`.

⚠️ **La clé `formSchema` n'existe plus depuis la tâche 7.2, et le schéma la REFUSE** — un profil qui la porte encore échoue à `npm run validate:profiles`. C'était une seconde liste de champs, parallèle à `attributes.fields[]` et réconciliée avec elle par rien. Le modèle est désormais : **une liste, deux projections** — `display` pour lire, `edit` pour capturer.

```json
{
    "field": "properties.statut",
    "label": "Statut",
    "primitive": "string",
    "widget": "badge",
    "display": { "surfaces": ["popup", "sidepanel"] },
    "edit": {
        "widget": "dropdown",
        "options": { "options": [{ "value": "Ouvert", "label": "Ouvert" }] }
    }
}
```

`widget` sert les DEUX projections ; `edit.widget` ne se déclare que là où la lecture et la saisie divergent réellement — ci-dessus, une pastille colorée qui se saisit dans une liste déroulante. `edit.options` est alors typé par `edit.widget`, jamais par le widget d'affichage, et le schéma exige l'un dès que l'autre est là.

⚠️ **Déclarer `edit` sur un seul champ oblige la couche à déclarer `edition.update: true` ET son bloc `write`** — c'est la règle **A14**, exprimée en JSON Schema pur.

```json
{
    "editorConfig": {
        "enabled": true,
        "menuPosition": "top-right",
        "enabledTools": [
            "point",
            "line",
            "polyline",
            "polygon",
            "select",
            "undo",
            "redo",
            "delete"
        ],
        "api": {
            "baseUrl": "https://api.example.com",
            "authHeader": "Bearer <token>",
            "timeoutMs": 8000
        },
        "persistence": { "mode": "auto", "dialect": "rest", "conflictResolution": "prompt" }
    }
}
```

| #    | Paramètre                                     | Type            | Défaut             | Rôle                      | Description                                                                                                                                                                                                                                                                                                                                         |
| ---- | --------------------------------------------- | --------------- | ------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 253  | `editorConfig.enabled`                        | boolean         | `true`             | Activer le plugin         | Active ou désactive entièrement le plugin.                                                                                                                                                                                                                                                                                                          |
| 254  | `editorConfig.showButton` / `ui.showEditor`   | boolean         | `true`             | Afficher le bouton        | Affiche l'icône « Édition » dans la barre pill.                                                                                                                                                                                                                                                                                                     |
| 254a | `modules.editor.showAddPoi`                   | boolean         | `true`             | Bouton « ajouter un POI » | Affiche le bouton de capture de POI dans la barre pill mobile. ⚠️ **Remplace `ui.showAddPoi`** (Sprint 5), que le CORE lisait pour décider d'un bouton que seul un plugin pouvait servir. 🛑 **Le défaut CHANGE de sens** : `ui.showAddPoi` valait `false` (opt-in), celui-ci vaut `true` (opt-out), comme les autres créneaux paresseux du plugin. |
| 254b | `modules.editor.poiAddDefaultPosition`        | string          | `"placement-mode"` | Origine du nouveau POI    | `"geolocation"` part du point GPS quand il en existe un, et **retombe sur le placement** sinon ; `"placement-mode"` demande un tap sur la carte. ⚠️ Absorbé de `modules.addpoi.defaultPosition`, que le core lisait. Le marqueur posé reste **glissable** : la position se corrige sans rouvrir le formulaire.                                      |
| 255  | `editorConfig.menuPosition`                   | string \| objet | `"top-right"`      | Position du sous-menu     | Ancrage initial du sous-menu flottant (`"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"` ou `{top,left}`). ⚠️ Défaut passé à droite au 25/07/2026 (B-12) : à gauche, le pill se superposait à la toolbar du core et ses boutons étaient inatteignables au clic.                                                                        |
| 256  | `editorConfig.enabledTools`                   | string[]        | 8 outils           | Outils affichés           | Sous-ensemble d'outils : `point`, `line`, `polyline`, `polygon`, `select`, `undo`, `redo`, `delete`.                                                                                                                                                                                                                                                |
| 257  | `editorConfig.snapPx`                         | number          | `12`               | Rayon de snap             | Tolérance (px) pour le raccrochage au 1ᵉʳ sommet d'un polygone.                                                                                                                                                                                                                                                                                     |
| 257b | `editorConfig.poiSnapMeters`                  | number          | `50`               | Garde-fou de doublon      | Rayon en **mètres** : toucher la carte à moins de cette distance d'une entité existante d'une couche point éditable accroche dessus et remonte son identité, au lieu de créer un doublon. `0` désactive. ⚠️ **Distinct de `snapPx`**, qui est un confort de tracé en pixels.                                                                        |
| 257c | `editorConfig.showExport`                     | boolean         | `true`             | Bouton d'export session   | Affiche le bouton « exporter cette session » — télécharge en GeoJSON les entités créées **depuis le chargement de la page**. ⚠️ Le suivi est en mémoire : un rechargement vide la liste.                                                                                                                                                            |
| 258  | `editorConfig.vertexHandleSize`               | number          | `8`                | Taille poignée sommet     | Diamètre (px) des poignées de sommets. Borné à [4, 24].                                                                                                                                                                                                                                                                                             |
| 259  | `editorConfig.midpointHandleSize`             | number          | `5`                | Taille poignée milieu     | Diamètre (px) des poignées de points milieux. Borné à [3, 20].                                                                                                                                                                                                                                                                                      |
| 260  | `editorConfig.minVerticesLineString`          | number          | `2`                | Min sommets ligne         | Nombre minimal de sommets d'une LineString (suppression bloquée en deçà).                                                                                                                                                                                                                                                                           |
| 261  | `editorConfig.minVerticesPolygon`             | number          | `3`                | Min sommets polygone      | Nombre minimal de sommets d'un Polygon.                                                                                                                                                                                                                                                                                                             |
| 262  | `editorConfig.api.baseUrl`                    | string          | `""`               | URL backend               | Base des requêtes de persistance.                                                                                                                                                                                                                                                                                                                   |
| 263  | `editorConfig.api.authHeader`                 | string \| null  | `null`             | En-tête Authorization     | Valeur d'en-tête `Authorization` (Bearer, clé API…).                                                                                                                                                                                                                                                                                                |
| 264  | `editorConfig.api.timeoutMs`                  | number          | `8000`             | Timeout réseau            | Délai (ms) avant bascule sur la file offline.                                                                                                                                                                                                                                                                                                       |
| 265  | `editorConfig.api.geometryProperty`           | string          | `"geom"`           | Clé géométrie             | Nom de la propriété géométrie dans le dialecte `"collection"`.                                                                                                                                                                                                                                                                                      |
| 266  | `editorConfig.persistence.mode`               | string          | `"auto"`           | Stratégie persistance     | `"auto"` (détection online/offline), `"online"` (REST), `"offline"` (file IndexedDB, requiert `storage`).                                                                                                                                                                                                                                           |
| 267  | `editorConfig.persistence.dialect`            | string          | `"rest"`           | Dialecte backend          | `"rest"` (enveloppe `{feature, layerId}`) ou `"collection"` (corps plat OGC/PostgREST, création seule).                                                                                                                                                                                                                                             |
| 268  | `editorConfig.persistence.conflictResolution` | string          | `"prompt"`         | Résolution conflit 409    | `"client-wins"`, `"server-wins"` ou `"prompt"` (dialogue de fusion).                                                                                                                                                                                                                                                                                |
| 269  | `editorConfig.undoStackSize`                  | number          | `100`              | Profondeur undo/redo      | Nombre max d'opérations annulables par session.                                                                                                                                                                                                                                                                                                     |
| 270  | `editorConfig.modal.desktopBreakpointPx`      | number          | `768`              | Seuil modal/drawer        | Largeur (px) : ≥ valeur → modal centré ; < valeur → drawer plein écran.                                                                                                                                                                                                                                                                             |
| 271  | `editorConfig.modal.maxWidthPx`               | number          | `640`              | Largeur max modal         | Largeur maximale (px) du modal desktop.                                                                                                                                                                                                                                                                                                             |
| 272  | `editorConfig.confirmDelete`                  | boolean         | `true`             | Confirmer suppression     | Dialogue de confirmation avant suppression d'une entité.                                                                                                                                                                                                                                                                                            |
| 273  | `editorConfig.confirmCancelOnDirty`           | boolean         | `true`             | Confirmer abandon         | Confirmation à la fermeture d'un formulaire modifié non enregistré.                                                                                                                                                                                                                                                                                 |
| 274  | `editorConfig.defaultLayer`                   | string \| null  | `null`             | Couche pré-sélectionnée   | ID de couche pré-sélectionnée dans le dropdown (`null` = 1ʳᵉ couche compatible).                                                                                                                                                                                                                                                                    |
| 275  | `editorConfig.eventNamespace`                 | string          | `"editor"`         | Préfixe events            | Préfixe des events DOM publics émis par le plugin.                                                                                                                                                                                                                                                                                                  |

> Pour les détails d'intégration (API `GeoLeaf.Editor.*`, dialectes de persistance, note de migration AddPOI, notes de sécurité, budget bundle lazy), voir le [README du plugin](../../packages/plugins/editor/README.md).

---

## 14. Configuration gestionnaire de couches

Défini dans `config/core/ui.json > layerManagerConfig` (fusionné à la racine du profil).

| #   | Paramètre                               | Type    | Description          | Description longue                                                                                                                                                                                                                                                                |
| --- | --------------------------------------- | ------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 219 | `layerManagerConfig.title`              | string  | Titre du panneau     | Texte affiché en haut du gestionnaire de couches. Par exemple `"Couches"`, `"Données cartographiques"`, `"Gestion des couches"`. C'est le titre principal du panneau qui regroupe toutes les couches et basemaps.                                                                 |
| 220 | `layerManagerConfig.collapsedByDefault` | boolean | Replié au chargement | Détermine si le gestionnaire de couches est replié (fermé, seul le titre est visible) ou déplié (ouvert, toutes les sections sont visibles) au premier chargement. Sur mobile, replié par défaut économise de l'espace ; sur desktop, déplié offre un accès immédiat aux couches. |

### Sections

| #   | Paramètre                       | Type    | Description        | Description longue                                                                                                                                                                                                                                                                   |
| --- | ------------------------------- | ------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 221 | `sections[].id`                 | string  | ID de la section   | Identifiant technique de la section, référencé dans `layers.json > layerManagerId` pour assigner chaque couche à une section. Par exemple `"data-tourism"`, `"data-climate"`, `"data-administration"`, `"basemap"`.                                                                  |
| 222 | `sections[].label`              | string  | Nom de la section  | Texte affiché comme titre de cette section dans le gestionnaire de couches. Par exemple `"Tourisme"`, `"Climat"`, `"Administration"`, `"Fonds de carte"`. Permet de regrouper visuellement les couches par thématique pour faciliter la navigation quand il y a beaucoup de couches. |
| 223 | `sections[].order`              | number  | Ordre d'affichage  | Position de cette section dans le gestionnaire de couches (les sections sont triées par `order` croissant). Par exemple 1 pour les basemaps (en haut), 2 pour les données touristiques, 3 pour le climat, etc.                                                                       |
| 224 | `sections[].collapsedByDefault` | boolean | Repliée par défaut | Détermine si cette section est repliée (fermée) au premier affichage. Utile pour masquer les sections secondaires (ex. climat) tout en laissant ouvertes les sections principales (ex. tourisme). L'utilisateur peut déplier manuellement chaque section en cliquant sur son titre.  |

---

## 15. Configuration légende — `modules.legend` (capacité in-core)

> ⚠️ **Migration cassante (S10/F2, capacité `legend`).** La légende ne vit plus sous le flag `ui.showLegend` ni le bloc `config/core/ui.json > legendConfig` mais sous **`modules.legend`** — fichier `config/plugins/legend.json` référencé par `Files.modules.legend`. **Aucun shim** : un profil conservant `legendConfig` / `ui.showLegend` ne charge plus cette configuration. La légende reste **intégrée au core** (présente en Full **et** Lite) — ce n'est pas un plugin externe. La façade publique `GeoLeaf.Legend` est **inchangée** ; la capacité est introspectable via `GeoLeaf.Introspection.getCapabilitySchema("legend")`.

> ℹ️ **Config réveillée.** `title`, `position` et `collapsedByDefault` étaient auparavant morts (ignorés, écrasés par des défauts internes du contrôle). Sous `modules.legend`, ils sont désormais **réellement lus et appliqués** : un profil qui portait ces clés verra sa légende rendue avec le titre, la position et l'état replié configurés.

> **Événement DOM :** au premier montage du contrôle, la légende émet une fois `geoleaf:legend:ready` (payload `{ position, layerCount }`).

Défini dans `config/plugins/legend.json` (bloc `modules.legend`, référencé par `Files.modules.legend`).

| #    | Paramètre                           | Type    | Défaut         | Description           | Description longue                                                                                                                                                                                                                             |
| ---- | ----------------------------------- | ------- | -------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 224b | `modules.legend.enabled`            | boolean | `true`         | Activer la légende    | Gate de la capacité (**opt-out** — ex-`ui.showLegend`). Absente ⟹ la légende est active ; passer à `false` masque complètement le panneau de légende.                                                                                          |
| 225  | `modules.legend.title`              | string  | `"Legend"`     | Titre de la légende   | Texte affiché en haut du panneau de légende (ex-`legendConfig.title`). Par exemple `"Légende"`, `"Signification des couleurs"`. La légende est générée automatiquement à partir des styles des couches actives ; ce titre en est l'en-tête.    |
| 226  | `modules.legend.collapsedByDefault` | boolean | `false`        | Repliée au chargement | Si `true`, la légende est affichée en mode replié (ex-`legendConfig.collapsedByDefault` ; seul le titre est visible, un clic la déplie). Utile sur mobile pour économiser de l'espace, ou quand la légende contient de nombreuses entrées.     |
| 227  | `modules.legend.position`           | string  | `"bottomleft"` | Position sur la carte | Position du panneau de légende sur la carte (ex-`legendConfig.position`) : `"topleft"`, `"topright"`, `"bottomleft"`, `"bottomright"`. Choisir une position qui ne chevauche pas les autres contrôles (gestionnaire de couches, filtres, GPS). |

---

## 16. Configuration POI et clustering

Défini dans `config/core/features.json > poiConfig` (feature core, fusionnée à la racine du profil).

| #   | Paramètre                           | Type    | Défaut      | Description             | Description longue                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------- | ------- | ----------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 228 | `poiConfig.enabled`                 | boolean | `true`      | Activer le module POI   | Active ou désactive complètement le système de gestion des points d'intérêt. Si désactivé, aucun marqueur POI ne sera affiché sur la carte, même si des données POI sont présentes. Utile pour les applications qui n'affichent que des couches GeoJSON (polygones, lignes) sans marqueurs individuels.                                                                                                              |
| 229 | `poiConfig.clusterStrategy`         | string  | `"unified"` | Stratégie de clustering | Détermine comment les POI de différentes sources sont regroupés : `"unified"` = tous les POI dans un seul cluster global (recommandé pour la plupart des cas), `"by-source"` = clusters séparés par type de source (JSON vs GeoJSON, permet de distinguer visuellement les origines), `"json-only"` = seuls les POI JSON sont clusterisés, les GeoJSON restent individuels (utile si les GeoJSON sont déjà agrégés). |
| 230 | `poiConfig.clustering`              | boolean | `true`      | Activer le clustering   | Active ou désactive le regroupement des marqueurs POI quand ils sont trop proches. Indépendant du clustering global dans `geoleaf.config.json` — ce paramètre est spécifique au profil. Désactiver si les POI sont peu nombreux ou doivent tous être visibles individuellement à tout zoom.                                                                                                                          |
| 231 | `poiConfig.clusterRadius`           | number  | `80`        | Rayon de clustering     | Distance en pixels en deçà de laquelle deux marqueurs POI sont fusionnés dans un même cluster. `80` est un bon compromis. Augmenter (120+) pour un regroupement plus agressif sur les jeux de données denses, diminuer (40-60) pour conserver plus de marqueurs individuels.                                                                                                                                         |
| 232 | `poiConfig.disableClusteringAtZoom` | number  | `18`        | Désactivation au zoom   | Niveau de zoom à partir duquel le clustering cesse et tous les marqueurs sont affichés individuellement. `18` correspond au zoom rue. Garantit que l'utilisateur peut toujours cliquer sur un marqueur individuel en zoomant suffisamment.                                                                                                                                                                           |
| 233 | `poiConfig.showIconsOnMap`          | boolean | `true`      | Icônes sur la carte     | Affiche des icônes personnalisées (issues du sprite SVG de la taxonomie) sur chaque marqueur POI au lieu des marqueurs par défaut. Chaque icône est résolue selon la catégorie et la sous-catégorie du POI.                                                                                                                                                                                                          |
| 234 | `poiConfig.showPopup`               | boolean | `true`      | Popups au clic          | Active l'affichage d'un popup (bulle d'information) quand l'utilisateur clique sur un marqueur POI. Le contenu du popup est défini dans la configuration de la couche (`popup.fields`). Désactiver si seul le panneau latéral est utilisé.                                                                                                                                                                           |
| 235 | `poiConfig.dataUrl`                 | string  | —           | URL des données POI     | URL optionnelle vers un fichier JSON ou une API fournissant les données POI. Si défini, les POI sont chargés depuis cette URL en plus (ou à la place) des données GeoJSON des couches. Permet d'intégrer un flux de données externe sans modifier les profils.                                                                                                                                                       |

Défini dans `config/core/features.json > poiConfig.clusterStrategies` (configuration avancée par stratégie).

| #    | Paramètre                                                    | Type    | Description                            | Description longue                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------ | ------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 235b | `poiConfig.clusterStrategies`                                | object  | Configuration par stratégie            | Objet optionnel permettant de configurer individuellement chaque stratégie de clustering. Les clés sont les noms de stratégie (`"by-source"`, `"json-only"`, etc.) et les valeurs contiennent les options spécifiques à cette stratégie. |
| 235c | `poiConfig.clusterStrategies["by-source"].sources.geojson`   | boolean | Inclure les GeoJSON dans le clustering | Quand la stratégie `"by-source"` est active, ce paramètre détermine si les POI issus de couches GeoJSON participent au clustering (en plus des POI JSON). Par défaut, seuls les POI JSON sont clusterisés en mode `"by-source"`.         |
| 235d | `poiConfig.clusterStrategies["json-only"].geojsonClustering` | boolean | Clustering GeoJSON en mode json-only   | Quand la stratégie `"json-only"` est active, ce paramètre permet d'activer également le clustering pour les POI GeoJSON. Par défaut `false` — seuls les POI JSON sont clusterisés.                                                       |

Défini dans `config/core/features.json > clusteringConfig` (configuration alternative, feature core fusionnée à la racine du profil).

| #   | Paramètre                                  | Type    | Description             | Description longue                                                                                                                                                                                              |
| --- | ------------------------------------------ | ------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 236 | `clusteringConfig.enabled`                 | boolean | Activer le clustering   | Active le clustering des marqueurs via la configuration alternative `clusteringConfig` (équivalent à `poiConfig.clustering`). Utilisé quand la configuration de clustering est séparée de la configuration POI. |
| 237 | `clusteringConfig.strategy`                | string  | Stratégie de clustering | Stratégie de regroupement : `"by-layer"` regroupe les marqueurs par couche (chaque couche a son propre cluster indépendant). Alternative à `clusterStrategy` dans `poiConfig`.                                  |
| 238 | `clusteringConfig.maxClusterRadius`        | number  | Rayon de regroupement   | Distance en pixels pour le regroupement. Même fonctionnement que `poiConfig.clusterRadius`.                                                                                                                     |
| 239 | `clusteringConfig.disableClusteringAtZoom` | number  | Zoom de désactivation   | Niveau de zoom où le clustering cesse. Même fonctionnement que `poiConfig.disableClusteringAtZoom`.                                                                                                             |

---

## 17. Configuration échelle

Défini dans `config/core/ui.json > scaleConfig` (fusionné à la racine du profil).

| #   | Paramètre                          | Type    | Défaut         | Description                | Description longue                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------- | ------- | -------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 240 | `scaleConfig.scaleGraphic`         | boolean | `true`         | Échelle graphique          | Affiche l'échelle graphique : une petite barre horizontale avec des graduations en kilomètres/miles, positionnée sur la carte. Se met à jour automatiquement quand l'utilisateur zoome. C'est la représentation la plus intuitive de l'échelle pour le grand public.                                                                |
| 241 | `scaleConfig.scaleNumeric`         | boolean | `false`        | Échelle numérique          | Affiche l'échelle sous forme numérique (ex. `1:250 000`). Calculée automatiquement en fonction du zoom et de la latitude du centre de la carte. Plus précise que l'échelle graphique et préférée par les professionnels (géomaticiens, cartographes, urbanistes).                                                                   |
| 242 | `scaleConfig.scaleNumericEditable` | boolean | `false`        | Échelle éditable           | Rend l'échelle numérique éditable : l'utilisateur peut cliquer sur la valeur, saisir une échelle cible (ex. `1:100 000`) et la carte zoomera automatiquement au niveau correspondant. Formats acceptés : `"1:250000"`, `"1:250 000"`, `"1: 250000"`. Fonctionnalité avancée pour les professionnels. Requiert `scaleNumeric: true`. |
| 243 | `scaleConfig.scaleNivel`           | boolean | —              | Afficher le niveau de zoom | Affiche le niveau de zoom actuel de la carte (ex. `Z: 12`). Information technique utile pour les développeurs et configurateurs, moins pour les utilisateurs finaux. Se met à jour en temps réel quand l'utilisateur zoome.                                                                                                         |
| 244 | `scaleConfig.position`             | string  | `"bottomleft"` | Position de l'échelle      | Position du contrôle d'échelle sur la carte : `"bottomleft"`, `"bottomright"`, `"topleft"`, `"topright"`. `"bottomleft"` est la convention cartographique standard.                                                                                                                                                                 |

---

## 18. Configuration branding

Défini dans `geoleaf.config.json > branding`.

| #   | Paramètre           | Type    | Description         | Description longue                                                                                                                                                                                                           |
| --- | ------------------- | ------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 245 | `branding.enabled`  | boolean | Activer le branding | Affiche un bandeau de marque semi-transparent sur la carte. Permet d'identifier la solution utilisée, de créditer l'éditeur ou d'afficher le nom du projet. Le bandeau est discret et ne gêne pas l'utilisation de la carte. |
| 246 | `branding.text`     | string  | Texte affiché       | Texte du bandeau de branding. Par exemple `"Propulsé par GeoLeaf"`, `"© MonEntreprise 2026"`. Texte simple uniquement (pas de HTML).                                                                                        |
| 247 | `branding.position` | string  | Position du bandeau | Position du bandeau de branding sur la carte : `"topleft"`, `"topright"`, `"bottomleft"`, `"bottomright"`. Choisir un emplacement qui ne chevauche pas les autres contrôles.                                                 |

---

## 19. Configuration storage / offline

Depuis **S14 Phase B**, le **cache offline** est piloté par `config/plugins/offline.json` (bloc **`modules.offline`**, référencé par `Files.modules.offline`) — capacité **in-core** (`@geoleaf/core`, gate `modules.offline.enabled` **opt-in**, dépend de `modules.pwa`), moteur chargé en `import()` dynamique. Le **détecteur réseau** et le **Service Worker** relèvent de **`modules.pwa`** (Phase A). Le plugin **`@geoleaf-plugins/storage` (MIT)** ne fournit plus que l'**UI de sélection offline** (optionnelle) ; le moteur (IndexedDB / cache / download / sync) est in-core. _(Noms de clés ci-dessous mis à jour ; descriptions longues à réconcilier.)_

| #   | Paramètre                                   | Type    | Description                     | Description longue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------- | ------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 248 | `modules.pwa.offlineDetector.enabled`       | boolean | Détection online/offline        | Active la détection automatique de l'état de connexion réseau. Quand activé, GeoLeaf affiche un badge visuel quand l'utilisateur perd la connexion et adapte son comportement (utilise les données en cache au lieu de tenter des téléchargements réseau qui échoueraient). Des événements sont émis à chaque changement d'état pour que l'application puisse réagir.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 249 | `modules.pwa.enabled`                       | boolean | Service Worker (PWA)            | Active le Service Worker qui intercepte les requêtes réseau pour servir les ressources depuis le cache quand elles sont disponibles. Le SW utilise 4 stratégies de cache (cache-first, network-first, stale-while-revalidate, cache-only) selon le type de ressource. Indispensable pour un vrai mode offline où l'application fonctionne sans aucune connexion. Requiert HTTPS en production.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 289 | `modules.pwa.installPrompt.enabled`         | boolean | Bannière d'installation         | Affiche la bannière d'installation personnalisée de GeoLeaf. Sur Android/Chrome/Edge elle s'appuie sur l'événement `beforeinstallprompt` ; sur iOS Safari, qui n'émet jamais cet événement, elle affiche des instructions manuelles (« Ajouter à l'écran d'accueil »). ⚠️ **Ce flag arme aussi le listener interrogé par `GeoLeaf.PWA.isInstallable()`** : avec `false`, cette méthode répond `false` même sur un navigateur Android installable (iOS n'est pas concerné, son test ne dépend d'aucun listener). Laissez-le à `true` si vous affichez votre propre bouton d'installation via `isInstallable()`.                                                                                                                                                                                                                                                                                                                                                |
| 290 | `modules.pwa.name`                          | string  | Nom de l'application            | Fusionné dans le `manifest.json` généré au déploiement (`scripts/build-deploy.cjs`) — nom complet affiché dans les dialogues d'installation **du système** ; cette partie exige de régénérer le déploiement (`npm run build:deploy`). **Depuis CAPACITÉS S7, aussi lu au runtime** : la bannière d'installation **intégrée** (`modules.pwa.installPrompt.enabled`) affiche ce nom (priorité à `short_name`, repli « GeoLeaf ») et le traduit — cette partie prend effet sans rebuild.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 291 | `modules.pwa.short_name`                    | string  | Nom court                       | Nom court affiché sous l'icône de l'écran d'accueil, où la place est contrainte (~12 caractères selon la plateforme) — build-time côté manifeste (idem #290). **Depuis CAPACITÉS S7, c'est aussi le nom prioritaire affiché au runtime par la bannière d'installation intégrée** (sinon `name`, repli « GeoLeaf »).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 292 | `modules.pwa.description`                   | string  | Description                     | **Build-time uniquement** (idem #290). Description de l'application dans le manifeste.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 293 | `modules.pwa.theme_color`                   | string  | Couleur du navigateur           | **Build-time uniquement** (idem #290). Couleur hexadécimale (ex. `"#2d6a4f"`) appliquée à la barre du navigateur et à l'écran de démarrage. Sans rapport avec les thèmes cartographiques (`config/core/themes.json`) ni avec le thème UI clair/sombre.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 294 | `modules.pwa.background_color`              | string  | Couleur de l'écran de démarrage | **Build-time uniquement** (idem #290). Couleur hexadécimale du fond de l'écran de démarrage affiché pendant le chargement de l'application installée.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 250 | `modules.offline.cache.enableProfileCache`  | boolean | Cache du profil                 | Active la sauvegarde complète du profil (fichiers JSON de configuration, taxonomie, thèmes, couches) dans IndexedDB. Au prochain chargement, si les fichiers sont en cache et que l'utilisateur est offline, GeoLeaf utilise les données cachées au lieu de les télécharger. Réduit aussi le temps de chargement en mode online (cache-first).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 251 | `modules.offline.cache.enableTileCache`     | boolean | Cache des tuiles                | Active la mise en cache des tuiles de fond de carte (basemap) dans IndexedDB. L'utilisateur peut télécharger à l'avance les tuiles d'une zone géographique définie dans `offlineBounds` pour consulter la carte sans réseau. Le volume de données dépend de la zone et des niveaux de zoom cachés.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 295 | `modules.offline.cache.maxCacheBytes`       | number  | Budget IndexedDB                | Plafond, **en octets**, du cache de couches et de tuiles d'IndexedDB (défaut 250 Mo). Après chaque téléchargement de profil, les enregistrements les moins récemment mis en cache sont évincés jusqu'à ce que le magasin tienne dans ce budget, et l'événement `geoleaf:cache:evicted` est émis. `0` désactive l'éviction. Les entités portant du travail local non synchronisé ne sont **jamais** évincées.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 296 | `modules.offline.cache.maxTileCacheEntries` | number  | Budget du cache opportuniste    | Plafond, **en nombre d'entrées**, du cache de tuiles du Service Worker (Cache API, `geoleaf-data-tiles`) — celui que remplit le simple fait de se déplacer sur la carte, sans rien télécharger. Défaut **2 000** (≈ 38 Mo — ~19,8 Ko la tuile en moyenne, mesuré, mais avec un facteur 10 de dispersion). Au-delà, les entrées les plus anciennes partent en premier ; au-delà de 80 % du quota du navigateur, la taille devient bien plus agressive et l'utilisateur en est averti. `0` désactive le bornage. ⚠️ **En entrées et non en octets** parce que la Cache API n'expose la taille d'aucune entrée. ⚠️ **Distinct de `maxCacheBytes`** : les deux budgets s'additionnent contre le **même quota d'origine**, et les navigateurs évincent par origine — un cache de tuiles non borné peut donc coûter des saisies terrain non synchronisées. Rien ici ne peut évincer une zone que vous avez explicitement téléchargée : celle-là vit dans IndexedDB. |

---

## 20. ~~Configuration AddPOI~~ — RETIRÉE (le plugin a fusionné)

🛑 **`@geoleaf-plugins/addpoi` a fusionné dans `@geoleaf-plugins/editor` au Sprint 5.** Le bloc
`modules.addpoi` et son fichier `config/plugins/addpoi.json` **n'existent plus**, et
`GeoLeaf.AddPOI` a disparu **sans alias** (décision V2). Le paquet npm est **déprécié, pas
dépublié** : une version installée continue de fonctionner, sans correctif à venir.

⚠️ **Les 9 paramètres `poiAddConfig.*` de cette section étaient déjà inopérants avant la fusion** :
la clé racine `poiAddConfig` n'était plus acceptée depuis la clôture S14, et le bloc était ignoré
**en silence**. Les retirer ne perd donc aucune capacité réglable.

**Où va chaque réglage désormais** — voir la [§13d Configuration plugin Editor](#13d-configuration-plugin-editor-geoleaf-pluginseditor) :

| Avant                            | Après                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `ui.showAddPoi`                  | `modules.editor.showAddPoi` (défaut `true`)                                                  |
| `modules.addpoi.defaultPosition` | `modules.editor.poiAddDefaultPosition`                                                       |
| `ui.showPoiExport`               | `modules.editor.showExport`                                                                  |
| les champs du formulaire         | `layer.attributes.fields[].edit`, **par couche** (`layer.formSchema` jusqu'à 7.2, supprimée) |
| l'endpoint d'envoi               | `modules.editor.api.baseUrl`                                                                 |

⚠️ **`ui.showAddPoi` valait `false` (opt-in) ; `modules.editor.showAddPoi` vaut `true`
(opt-out)**, comme les autres créneaux paresseux du plugin. Un profil qui charge `editor` et ne
pose pas la clé aura donc le bouton.

---

## 21. Configuration performance

Défini dans `config/core/features.json > performance` (feature core, fusionnée à la racine du profil) et `geoleaf.config.json > performance`.

| #   | Paramètre                 | Fichier             | Type    | Description                     | Description longue                                                                                                                                                                                                                              |
| --- | ------------------------- | ------------------- | ------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 261 | `maxConcurrentLayers`     | profile.json        | number  | Couches en parallèle            | Nombre maximum de couches GeoJSON chargées simultanément. Limite le nombre de requêtes HTTP en vol et la charge CPU de rendu. Sur des connexions lentes, réduire cette valeur évite les timeouts et les échecs de chargement.                   |
| 262 | `layerLoadDelay`          | profile.json        | number  | Délai entre chargements         | Pause en millisecondes entre le chargement de deux couches consécutives. Lisse la charge et évite le "gel" de l'interface quand de nombreuses couches sont activées simultanément. 0 = pas de délai.                                            |
| 263 | `fitBoundsOnThemeChange`  | profile.json        | boolean | Recadrer au changement de thème | Quand activé, la carte se recadre automatiquement sur l'emprise des couches visibles à chaque changement de thème. Garantit que l'utilisateur voit toujours les données pertinentes. Quand désactivé, la position et le zoom restent inchangés. |
| 265 | `enableProfilePoiMapping` | geoleaf.config.json | boolean | Mapping POI du profil           | Active la normalisation des données POI via le fichier `mapping.json` du profil actif. Aliases : `useProfilePoiMapping`, `useMapping`.                                                                                                          |

---

## 22. Configuration debug et logging

Définis dans `geoleaf.config.json`.

### 22.1 Debug

| #   | Paramètre | Type    | Défaut  | Description       | Description longue                                                                                                                                                                                                                                                                           |
| --- | --------- | ------- | ------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 267 | `debug`   | boolean | `false` | Mode debug global | Active un mode verbeux qui affiche des logs détaillés dans la console pour toutes les opérations GeoLeaf : chargement de fichiers, initialisation de modules, rendu de couches, application de filtres, etc. Indispensable pendant l'intégration. À désactiver impérativement en production. |

### 22.2 Logging

| #   | Paramètre       | Type   | Défaut   | Description   | Description longue                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | --------------- | ------ | -------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 268 | `logging.level` | string | `"info"` | Niveau de log | Seuil de gravité minimum des messages affichés dans la console : `"debug"` = tout afficher, `"info"` = messages informatifs et plus (défaut), `"warn"` = avertissements et erreurs, `"error"` = erreurs critiques uniquement, `"production"` = aucun message (mode silencieux). Complémentaire à `debug` : `logging.level` contrôle la verbosité globale, `debug` active les traces de développement détaillées. |

---

## 23. Configuration UI complète

Récapitulatif de tous les paramètres `ui.*` de `profile.json` :

| #    | Paramètre                        | Type    | Défaut   | Composant contrôlé          | Description longue                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | -------------------------------- | ------- | -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 270  | `ui.theme`                       | string  | `"auto"` | Thème visuel                | Définit l'apparence de tous les composants d'interface : `"light"` (fond clair), `"dark"` (fond sombre) ou `"auto"` (suit `prefers-color-scheme`). Panneaux, popups, notifications, boutons. L'utilisateur peut basculer via un toggle.                                                                                                                                                    |
| 271  | `ui.language`                    | string  | `"fr"`   | Langue de l'interface       | Préférence linguistique stockée pour l'internationalisation future. Actuellement l'interface est en français.                                                                                                                                                                                                                                                                              |
| 272  | `ui.showBaseLayerControls`       | boolean | `true`   | Sélecteur de fonds de carte | Permet à l'utilisateur de choisir entre les différents fonds de carte (Street, Satellite, Topo) via un contrôle dédié sur la carte.                                                                                                                                                                                                                                                        |
| 273  | `ui.showLayerManager`            | boolean | `true`   | Gestionnaire de couches     | Permet à l'utilisateur d'afficher le panneau listant toutes les couches avec checkboxes d'activation, boutons labels et sélecteur de style.                                                                                                                                                                                                                                                |
| 274  | `modules.filter.enabled`         | boolean | `true`   | Panneau de filtres          | Active la capacité de filtre (recherche texte, filtres catégorie/tags, proximité GPS). **Ex-`ui.showFilterPanel`** — migré vers la capacité in-core `filter` (`modules.filter.enabled`, opt-out). Voir §12.                                                                                                                                                                                |
| 275  | `ui.showGeolocation`             | boolean | `true`   | Bouton géolocalisation      | Affiche un bouton GPS qui centre la carte sur la position de l'utilisateur avec un cercle de précision et un suivi optionnel.                                                                                                                                                                                                                                                              |
| 276  | `ui.showCoordinates`             | boolean | `true`   | Indicateur de coordonnées   | Affiche en temps réel les coordonnées (lat/lng) du curseur sur la carte. Utile pour les professionnels de la géomatique.                                                                                                                                                                                                                                                                   |
| 277  | `modules.theme-selector.enabled` | boolean | `true`   | Sélecteur de thèmes         | Affiche la barre de thèmes primaires et le dropdown de thèmes secondaires pour basculer entre des contextes métier différents.                                                                                                                                                                                                                                                             |
| 278  | `modules.legend.enabled`         | boolean | `true`   | Légende                     | Affiche la légende dynamique générée automatiquement depuis les styles des couches actives (couleurs, hachures, symboles). **Ex-`ui.showLegend`** — migré vers la capacité in-core `legend` (`modules.legend.enabled`, opt-out). Voir §15.                                                                                                                                                 |
| 279  | `ui.showCacheButton`             | boolean | `false`  | Bouton cache offline        | Affiche le bouton de gestion du cache hors-ligne (téléchargement, progression, statistiques). Depuis v1.3.0 le bouton est placé dans la **bande d'outils de droite en desktop** (≥1440px, à côté de print/partage) et dans la **pill bar en tablette/mobile** (enregistré via `GeoLeaf.registry`, plus en haut-gauche). Requiert le plugin Storage.                                        |
| 281  | `modules.table.showButton`       | boolean | —        | Tableau de données          | Affiche le bouton/onglet du tableau tabulaire des features géographiques (tri, recherche, export, synchronisation carte). **Ex-`ui.showTable`** — migré vers le plugin `@geoleaf-plugins/table` (`modules.table.showButton`).                                                                                                                                                              |
| 281a | `modules.share.enabled`          | boolean | `true`   | Bouton « Partager la vue »  | Affiche un bouton qui ouvre une modale avec le lien complet de la vue courante (centre, zoom, couches, filtres, thème — déjà synchronisés dans l'URL via `permalink`) et, à la demande, un QR code. La lib QR (`qrcode-generator`, ~4 KB) est lazy-loadée au premier clic « Afficher le QR ». **Ex-`ui.showShareButton`** — migré vers la capacité in-core `modules.share` (opt-out, S12). |
| 282  | `ui.interactiveShapes`           | boolean | —        | Formes GeoJSON cliquables   | Rend les polygones et lignes GeoJSON cliquables : un clic ouvre le popup ou le panneau latéral avec les informations de la feature.                                                                                                                                                                                                                                                        |

---

## 23bis. Configuration géocodage (plugin `@geoleaf-plugins/geocoding`)

> ⚠️ **Extrait du core vers un plugin — migration cassante.** Le géocodage est désormais le plugin MIT **`@geoleaf-plugins/geocoding`** (npmjs.org public), plus une feature core. La configuration a migré de la clé racine `geocodingConfig` vers le bloc **`modules.geocoding`** — déclaré dans `config/plugins/geocoding.json` et référencé par `Files.modules.geocoding` du profil. **Aucun shim de compatibilité** : un profil conservant `geocodingConfig` à la racine ne charge plus la configuration géocodage. Charger le script du plugin **après** `geoleaf.esm.js`. Référence complète : README du plugin (`packages/plugins/geocoding/README.md`).

Défini dans `config/plugins/geocoding.json` (bloc `modules.geocoding`), référencé par `Files.modules.geocoding`. Active une barre de recherche d'adresses sur la carte.

| #    | Paramètre                        | Type      | Défaut                           | Description                       | Description longue                                                                                                                                                                                                                                                                                                                                               |
| ---- | -------------------------------- | --------- | -------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 283b | `modules.geocoding.enabled`      | boolean   | `false`                          | Activer la recherche d'adresses   | Active le contrôle de géocodage sur la carte. Quand activé, une barre de recherche apparaît permettant à l'utilisateur de trouver une adresse et de centrer la carte dessus. Désactivé par défaut car optionnel selon les cas d'usage.                                                                                                                           |
| 283c | `modules.geocoding.provider`     | string    | `"addok"`                        | Fournisseur de géocodage          | Moteur de géocodage utilisé : `"addok"` = API BAN française data.gouv.fr (sans clé API), `"nominatim"` = OpenStreetMap mondial, `"photon"` = Photon par Komoot, ou une URL personnalisée vers un endpoint retournant un GeoJSON FeatureCollection.                                                                                                               |
| 283d | `modules.geocoding.debounceMs`   | number    | `300`                            | Délai de debounce (ms)            | Durée en millisecondes entre la dernière frappe et le déclenchement de la requête de géocodage. Un debounce de 300 ms évite d'envoyer une requête à chaque touche et attend que l'utilisateur ait fini de saisir. Réduire pour une réponse plus rapide (au prix de plus de requêtes).                                                                            |
| 283e | `modules.geocoding.minChars`     | number    | `3`                              | Caractères minimum                | Nombre minimum de caractères dans le champ de recherche avant de déclencher la requête. Évite les recherches trop courtes qui retourneraient des milliers de résultats non pertinents.                                                                                                                                                                           |
| 283f | `modules.geocoding.resultLimit`  | number    | `5`                              | Nombre max de résultats           | Limite le nombre de suggestions affichées dans la liste déroulante. Un nombre trop élevé surcharge visuellement l'interface ; 5 est un bon compromis entre pertinence et lisibilité.                                                                                                                                                                             |
| 283g | `modules.geocoding.position`     | string    | `"top-left"`                     | Position sur la carte             | Position du contrôle de géocodage : `"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"`. Défaut changé de `top-right` → `top-left` (Sprint 0.2) pour éviter le chevauchement avec le menu thème secondaire.                                                                                                                                           |
| 283h | `modules.geocoding.placeholder`  | string    | `"Rechercher une adresse\u2026"` | Placeholder du champ              | Texte affiché en grisé dans le champ de recherche quand il est vide. Personnaliser selon le contexte : `"Rechercher une commune\u2026"` ou `"Saisir une adresse\u2026"`.                                                                                                                                                                                         |
| 283i | `modules.geocoding.flyToZoom`    | number    | `15`                             | Zoom lors du survol d'un résultat | Niveau de zoom appliqué quand la carte se centre sur le résultat sélectionné. 15 correspond à un zoom rue. Réduire si les résultats sont des communes (zoom 12) ou des régions (zoom 8).                                                                                                                                                                         |
| 283j | `modules.geocoding.bbox`         | number[4] | —                                | Emprise géographique (filtre)     | Restreint les résultats à une zone rectangulaire. Format : `[west, south, east, north]` en degrés WGS84. Exemples : France métro `[-5.2, 41.3, 9.6, 51.1]`, La Réunion `[55.2, -21.4, 55.9, -20.8]`, Guyane `[-54.6, 2.1, -51.6, 5.8]`. Comportement par provider : Addok = centre du bbox (`lat/lon`), Nominatim = `viewbox` avec `bounded=1`, Photon = `bbox`. |
| 283k | `modules.geocoding.countrycodes` | string    | —                                | Filtre pays (ISO 3166-1 alpha-2)  | Restreint les résultats à un ou plusieurs pays. Codes séparés par virgule, ex. `"fr"`, `"ar"`, `"fr,be,ch"`. Supporté par Nominatim (`countrycodes=`) et ignoré silencieusement par Addok (France only) et Photon. Pour Photon, utiliser `bbox` à la place.                                                                                                      | number | `15` | Zoom lors du survol d'un résultat | Niveau de zoom appliqué quand la carte se centre sur le résultat sélectionné. 15 correspond à un zoom rue. Réduire si les résultats sont des communes (zoom 12) ou des régions (zoom 8). |

---

## 24. Récapitulatif total

### Par fichier de configuration

| Fichier               | Nombre de paramètres | Portée                |
| --------------------- | -------------------- | --------------------- |
| `geoleaf.config.json` | 15                   | Application globale   |
| `profile.json`        | 80+                  | Profil métier         |
| `taxonomy.json`       | 10+ par catégorie    | Catégories et icônes  |
| `themes.json`         | 8 + 8 par thème      | Presets de visibilité |
| `layers.json`         | 3 par couche         | Registre couches      |
| `{layer}_config.json` | 50+                  | Configuration couche  |
| `{style}.json`        | 48+                  | Style visuel          |
| `mapping.json`        | Variable             | Normalisation données |

### Par domaine fonctionnel

| Domaine                     | Paramètres      | Ce que l'utilisateur contrôle                                                 |
| --------------------------- | --------------- | ----------------------------------------------------------------------------- |
| **Carte**                   | 12              | Emprise, zoom, restriction navigation, conteneur, centre, mapOptions          |
| **Basemaps**                | 18 par basemap  | Fonds de carte, fallback, sous-domaines, offline, cache tuiles                |
| **Couches**                 | 50+ par couche  | Données, styles, tooltips, popups, sidepanel, table, clustering               |
| **Styles**                  | 48+ par style   | Couleurs, opacité, symboles, hachures, casing, labels, règles conditionnelles |
| **Thèmes**                  | 8 par thème     | Presets de visibilité des couches                                             |
| **Taxonomie**               | 6 par catégorie | Catégories, sous-catégories, icônes                                           |
| **UI**                      | 13              | Composants activés/désactivés                                                 |
| **Recherche & filtres**     | 16              | Panneau de recherche, types de filtres, rayon                                 |
| **Tableau**                 | 10              | Colonnes, export, scroll virtuel, hauteur                                     |
| **Gestionnaire de couches** | 6               | Titre, sections, repli                                                        |
| **Légende**                 | 3               | Titre, position, repli                                                        |
| **POI & clustering**        | 12              | Stratégie, rayon, popup, icônes                                               |
| **Échelle**                 | 5               | Graphique, numérique, éditable, zoom                                          |
| **Branding**                | 3               | Texte, position                                                               |
| **Offline (`offline-ui`)**  | 4               | Offline, cache profil, cache tuiles, SW                                       |
| **Performance**             | 5               | Concurrence, délai de chargement, fitBounds, mapping POI                      |
| **Debug / Logging**         | 2               | Mode debug, niveau de log                                                     |
| **Géocodage**               | 8               | Provider, position, debounce, limites, placeholder, zoom                      |
| **Routes**                  | 2               | Décorateur d'endpoints par couche (départ/arrivée), gate `modules.route`      |
| **Content Builder**         | 13 types        | Renderers pour popups/tooltips/panels                                         |

### Total

> **303+ paramètres individuels configurables** répartis sur **9 types de fichiers JSON**, sans écrire une seule ligne de code.

---

_Document mis à jour le 1 mai 2026 — GeoLeaf Platform V1 (v2.1.0)_

---

## 25. Configuration routes (capacité `modules.route`)

> **Depuis v3.0.0 (S11)** — le module `route` est devenu une **capacité in-core** (`capabilities/route`). Ce n'est plus un pipeline de données autonome : la capacité **décore** une couche de polylignes existante avec des **marqueurs de départ et d'arrivée** dérivés automatiquement de la géométrie de chaque feature. Le **tracé lui-même reste une couche GeoJSON `line` ordinaire** (rendue par le moteur générique, cf. §5) ; la capacité n'ajoute que les extrémités. **BREAKING** : la façade impérative `GeoLeaf.Route` (`init` / `loadFromConfig` / `loadGPX` / `loadGeoJSON` / `show` / `hide` / `filterVisibility`) et le tableau `routes[]` de premier niveau ont été **supprimés**.
>
> **Lecture de fichiers GPX / KML / KMZ** : ce n'est **pas** le rôle de cette capacité — utiliser le plugin **`@geoleaf-plugins/file-import`** (§27), qui convertit ces formats en couches GeoJSON.

### 25.1 Activation & binding (`config/plugins/route.json` → `modules.route`)

La capacité est **opt-in** : absente ou `enabled:false`, les couches lignes s'affichent normalement (aucun marqueur — dégradation gracieuse). Activée, elle décore les couches listées dans `layers` (binding par couche, comme `modules.taxonomy.layers`).

```json
{
    "enabled": true,
    "layers": {
        "routes": {
            "start": { "fillColor": "#2b7cff", "color": "#ffffff", "radius": 6, "weight": 2 },
            "end": { "fillColor": "#ff7b32", "color": "#ffffff", "radius": 6, "weight": 2 },
            "showStart": true,
            "showEnd": true
        }
    }
}
```

| #   | Paramètre                | Type            | Défaut  | Description                                                                                                                 |
| --- | ------------------------ | --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| 283 | `modules.route.enabled`  | boolean         | `false` | Gate opt-in. Absent/`false` → capacité inactive, les couches lignes s'affichent sans marqueurs.                             |
| 284 | `modules.route.layers`   | object (opaque) | `{}`    | Bindings par couche : `layerId → { start?, end?, showStart?, showEnd? }`. Une couche non listée ne reçoit pas de marqueurs. |
| 285 | `…layers.<id>.start`     | object          | bleu    | Style du marqueur de **départ** (cercle) : `fillColor`, `color` (contour), `radius`, `weight`, `fillOpacity`.               |
| 286 | `…layers.<id>.end`       | object          | orange  | Style du marqueur d'**arrivée** (cercle), mêmes propriétés que `start`.                                                     |
| 287 | `…layers.<id>.showStart` | boolean         | `true`  | Affiche le marqueur de départ (1er vertex de chaque feature ligne de la couche).                                            |
| 288 | `…layers.<id>.showEnd`   | boolean         | `true`  | Affiche le marqueur d'arrivée (dernier vertex ; `MultiLineString` = dernier point du dernier segment).                      |

### 25.2 Comportement

- La capacité s'abonne à `geoleaf:layer:added` (par couche) et `geoleaf:map:ready` (balayage initial). Sur une couche **bindée** à géométrie ligne, elle lit les features via `GeoLeaf.Layers.getFeatures`, dérive les points départ/arrivée et les rend dans **une seule** sous-couche dédiée (`gl-route-<id>-endpoints`). Les deux extrémités y coexistent, distinguées par `properties.role` (`"start"` / `"end"`) : le style de départ est le style de base de la couche, celui d'arrivée est appliqué par une règle `styleRules` sur `role`. _(Depuis R.38 — auparavant deux couches `-start` / `-end`, donc deux sources MapLibre par itinéraire.)_
- **Itinéraire dynamique** (ex. calculé par un backend) : injecter la polyligne dans une couche via `GeoLeaf.Layers.setData(layerId, featureCollection)` — la capacité re-dérive automatiquement les marqueurs (idempotent).
- **Points intermédiaires (étapes)** : non gérés en V1 (différé V2).
- La capacité est **exclue du build Lite**.

---

## 26. Configuration OGC API Features (couches)

> **Prérequis :** Aucun plugin requis — fonctionnalité native du core `@geoleaf/core` depuis v2.1.0.

La config `data.ogcApi` remplace `data.file` pour charger une couche depuis un serveur OGC API Features (standard OGC, ex. ldproxy, pygeoapi, GeoServer OGC API). Les paramètres sont définis dans le fichier `{layer}_config.json` de la couche.

**Exemple minimal :**

```json
{
    "data": {
        "ogcApi": {
            "url": "https://demo.ldproxy.net/daraa",
            "collectionId": "AeronauticSrf",
            "maxFeatures": 2000
        }
    }
}
```

**Exemple avec rafraîchissement automatique par emprise :**

```json
{
    "data": {
        "ogcApi": {
            "url": "https://api.example.com/collections/pois",
            "bbox": true,
            "maxFeatures": 1000,
            "autoRefresh": true
        }
    }
}
```

| Paramètre                  | Type    | Défaut  | Description                                       |
| -------------------------- | ------- | ------- | ------------------------------------------------- |
| `data.ogcApi.url`          | string  | —       | URL racine ou de collection OGC API Features      |
| `data.ogcApi.collectionId` | string  | —       | ID de collection (ajouté à l'URL si non inclus)   |
| `data.ogcApi.bbox`         | boolean | `false` | Filtre par emprise courante de la carte           |
| `data.ogcApi.maxFeatures`  | number  | `5000`  | Limite anti-DoS mémoire (pagination automatique)  |
| `data.ogcApi.autoRefresh`  | boolean | `false` | Rechargement à chaque `moveend` (debounce 500 ms) |

### Rapatriement hors-ligne par couche (`offline`)

> **Prérequis :** capacité in-core `modules.offline` activée (elle-même dépendante de `modules.pwa`).

Déclare qu'une couche peut vivre **hors réseau** : ses entités sont rapatriées une fois dans la base
locale, puis relues de là au lieu d'être refetchées.

| Paramètre                        | Type    | Défaut       | Description                                                                                              |
| -------------------------------- | ------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| `offline.enabled`                | boolean | `false`      | Le chargeur lit les entités du magasin local au lieu de refetcher. Un magasin vide retombe sur le réseau |
| `offline.maxFeatures`            | integer | —            | Plafond **dur** d'entités rapatriées : au-delà, le lot est tronqué et le rapport pose `capped: true`     |
| `offline.maxAgeMs`               | integer | —            | Seuil de péremption. Au-delà, `GeoLeaf.Storage.getSyncReport()` rapporte la couche `pulledStale`         |
| `offline.source.url`             | string  | —            | URL du service OGC API Features où `GeoLeaf.Storage.pullLayer()` va chercher les entités                 |
| `offline.source.collectionId`    | string  | id de couche | Collection à rapatrier                                                                                   |
| `offline.source.versionProperty` | string  | `updated_at` | Propriété portant l'horodatage de fraîcheur, relevé par entité pour rendre un conflit détectable         |

⚠️ **`offline.enabled` déclare une LECTURE, jamais un droit d'écriture.** L'éditabilité reste décidée
par les drapeaux d'édition de la couche : télécharger une couche ne la rend pas modifiable.

⚠️ **La source de rapatriement n'est pas `data.ogcApi`, et ce n'est pas interchangeable.** `data.*`
est la source d'**affichage** ; `offline.source` la source de **rapatriement**. Après un
rapatriement, c'est le magasin local qui sert la couche, et `data.*` devient le repli.

⚠️ **`offline.maxAgeMs` n'a délibérément AUCUN défaut.** Absent, une couche rapatriée est rapportée
`pulled` indéfiniment, jamais périmée. Un seuil par défaut ferait lever au rapport des alertes de
péremption qu'aucun intégrateur n'a demandées et qu'aucun ne pourrait faire taire — un statut qu'on
ne peut pas calculer ne se devine pas.

```json
{
    "offline": {
        "enabled": true,
        "maxFeatures": 5000,
        "source": { "url": "https://exemple.tld/ogc" }
    }
}
```

Le rapatriement s'appelle depuis l'application : `await GeoLeaf.Storage.pullLayer("ma_couche")`, avec
une emprise optionnelle `{ bbox: [ouest, sud, est, nord] }`. Il ne jette pas — il rend un rapport
`{ fetched, written, preserved, skipped, capped, aborted, refused }`, où `refused` nomme le motif
quand rien n'a été écrit.

### En-têtes HTTP personnalisés (`data.headers`)

> **Prérequis :** Aucun plugin requis — natif core.

Pour une couche chargée depuis un `data.dataUrl` distant (endpoint renvoyant directement du GeoJSON, ex. PostgREST/PostGIS), `data.headers` permet d'attacher des en-têtes HTTP statiques — typiquement la négociation de contenu (`Accept`). Quand `data.headers` est présent, la couche est récupérée **sur le thread principal** (le chemin worker ne forwarde pas les en-têtes par couche). L'en-tête `Authorization` n'a pas à être déclaré ici : il reste centralisé dans le plugin Connector (patch `fetch` global sur le `baseUrl` configuré).

```json
{
    "data": {
        "dataUrl": "https://qgis.example.com/demo_qgis",
        "headers": {
            "Accept": "application/geo+json"
        }
    }
}
```

| Paramètre      | Type                     | Défaut | Description                                                           |
| -------------- | ------------------------ | ------ | --------------------------------------------------------------------- |
| `data.headers` | `Record<string, string>` | —      | En-têtes HTTP statiques pour un `dataUrl` distant (fetch main-thread) |

---

## 27. Plugin file-import

> **Package :** `@geoleaf-plugins/file-import` — MIT — `registry.npmjs.org`
> **Namespace public :** `GeoLeaf.FileImport`
> **Chargement :** `<script type="module" src="dist/geoleaf-file-import.plugin.js"></script>`

Le plugin file-import permet de convertir des fichiers géospatiaux (GPX, KML, KMZ, CSV, TopoJSON) en GeoJSON et de les importer directement comme couches sur la carte via `GeoLeaf.FileImport.importAsLayer()`.

### API publique

| Méthode                                                | Description                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| `GeoLeaf.FileImport.convert(input)`                    | Convertit un `File` ou `string` (url) en `FeatureCollection` GeoJSON |
| `GeoLeaf.FileImport.importAsLayer(input, options)`     | Convertit et ajoute la couche sur la carte                           |
| `GeoLeaf.FileImport.getSupportedFormats()`             | Retourne la liste des formats supportés                              |
| `GeoLeaf.FileImport.registerConverter(ext, converter)` | Enregistre un converter personnalisé                                 |

### Formats supportés

| Format   | Extensions  | Notes                                                   |
| -------- | ----------- | ------------------------------------------------------- |
| GPX      | `.gpx`      | Waypoints, tracks, routes, élévation, extensions Garmin |
| KML      | `.kml`      | Placemarks, styles, dossiers hiérarchiques, TimeSpan    |
| KMZ      | `.kmz`      | Archive ZIP contenant un `.kml` (décompression fflate)  |
| CSV      | `.csv`      | Colonnes lat/lng ou WKT (heuristique automatique)       |
| TopoJSON | `.topojson` | Conversion via `topojson-client.feature()`              |

---

## 28. Plugin flatgeobuf

> **Package :** `@geoleaf-plugins/flatgeobuf` — MIT — `registry.npmjs.org`
> **Namespace public :** `GeoLeaf.FlatGeobuf`
> **Chargement :** `<script type="module" src="dist/geoleaf-flatgeobuf.plugin.js"></script>`

Le plugin flatgeobuf charge des fichiers FlatGeobuf (format binaire géospatial à accès aléatoire efficient, basé sur FlatBuffers). Supporte le filtrage spatial par bbox via l'index R-tree du format.

### API publique

| Méthode                                           | Description                                                     |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `GeoLeaf.FlatGeobuf.load(url, options)`           | Charge un fichier FlatGeobuf et retourne un `FeatureCollection` |
| `GeoLeaf.FlatGeobuf.loadAsLayer(url, options)`    | Charge et ajoute la couche sur la carte                         |
| `GeoLeaf.FlatGeobuf.loadBbox(url, bbox, options)` | Chargement filtré spatialement via bbox R-tree                  |

### Options principales

| Option        | Type        | Description                                   |
| ------------- | ----------- | --------------------------------------------- |
| `maxFeatures` | number      | Limite anti-DoS mémoire (défaut : 50 000)     |
| `signal`      | AbortSignal | Contrôle d'annulation de la requête streaming |

---

## 29. Plugin COG

> **Package :** `@geoleaf-plugins/cog` — npmjs.org, accès public
> **Namespace public :** `GeoLeaf.COG`
> **Chargement :** `<script type="module" src="dist/geoleaf-cog.plugin.js"></script>`

Le plugin COG (Cloud Optimized GeoTIFF) permet d'afficher des fichiers GeoTIFF optimisés directement sur la carte via des HTTP range requests. Utilise `geotiff.js` pour le décodage et injecte le résultat comme source `type: "image"` MapLibre.

### API publique

| Méthode                              | Description                                                               |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `GeoLeaf.COG.addLayer(url, options)` | Charge et affiche un COG sur la carte, retourne l'id de la couche         |
| `GeoLeaf.COG.removeLayer(id)`        | Supprime la couche COG de la carte                                        |
| `GeoLeaf.COG.getInfo(url)`           | Retourne les métadonnées du COG (bounds, résolution, bandes, projections) |

### Options `addLayer`

| Option       | Type   | Description                                           |
| ------------ | ------ | ----------------------------------------------------- |
| `opacity`    | number | Opacité de la couche (0–1, défaut : 1)                |
| `band`       | number | Index de bande à afficher (défaut : 1)                |
| `colorScale` | string | Palette de couleur appliquée au rendu monochromatique |
| `maxRangeKB` | number | Limite de la taille des range requests (anti-DoS)     |

---

## 30. Sélecteurs d'interface — `profile-switcher`, `language-switcher`, `theme-palette` (capacités in-core)

Trois capacités **opt-in** qui offrent à l'utilisateur final un choix que l'intégrateur, sinon,
fige en configuration. Elles se déclarent dans **`profiles/geoleaf.config.json`** (bloc racine, et
non par profil : un sélecteur qui disparaît selon le profil affiché serait un piège).

Contrat commun : `modules.<id>.enabled` — `false` ou absent → **aucun sélecteur**, la valeur reste
celle du JSON ; `true` → le sélecteur s'affiche. Non déclarée, une capacité n'embarque ni son code
ni son CSS (tree-shaking).

### 30.1 `modules.profile-switcher` — sélecteur de profil de données

Affiche un `<select>` **en tête du gestionnaire de couches** (desktop et mobile). Changer de profil
recharge la page sur le jeu de données choisi.

```json
{ "modules": { "profile-switcher": { "enabled": true } } }
```

| Clé       | Type      | Défaut  | Description                                                        |
| --------- | --------- | ------- | ------------------------------------------------------------------ |
| `enabled` | `boolean` | `false` | Affiche le sélecteur. Requiert **au moins 2 profils** disponibles. |

⚠️ **La liste des profils ne se configure pas ici.** Elle est **récoltée au déploiement** par
`scripts/build-deploy.cjs`, qui lit chaque `profiles/<id>/profile.json` et écrit
`data.availableProfiles` dans le `geoleaf.config.json` livré. Ajouter un dossier de profil suffit :
il n'y a aucune liste à tenir à jour. Un navigateur ne pouvant pas énumérer un répertoire serveur,
la découverte **doit** se faire au build ; servie directement depuis les sources (sans étape de
déploiement), l'application n'affiche simplement pas de sélecteur.

Deux champs **optionnels** dans `profile.json` alimentent l'affichage :

| Champ          | Type     | Rôle                                                               |
| -------------- | -------- | ------------------------------------------------------------------ |
| `displayLabel` | `string` | Libellé court du sélecteur. Absent → repli sur `label`, puis `id`. |
| `icon`         | `string` | Emoji affiché devant le libellé. Absent → libellé seul.            |

Le choix est mémorisé (`localStorage`). `sessionStorage['gl-selected-profile']` reste prioritaire et
**one-shot** : c'est le canal pour forcer un profil le temps d'un chargement.

### 30.2 `modules.language-switcher` — sélecteur de langue

Bouton de langue dans le bandeau d'onglets (desktop) et la barre d'outils (mobile). Le changement
recharge la page avec `?lang=<code>`.

```json
{ "modules": { "language-switcher": { "enabled": true, "display": "flag" } } }
```

| Clé         | Type       | Défaut              | Description                                                                |
| ----------- | ---------- | ------------------- | -------------------------------------------------------------------------- |
| `enabled`   | `boolean`  | `false`             | Affiche le bouton de langue.                                               |
| `display`   | `string`   | `"flag"`            | `"flag"` (emoji régional) ou `"code"` (`FR`, `EN`…).                       |
| `languages` | `string[]` | les 6 dictionnaires | Restreint la liste offerte, ex. `["fr","en"]`. Un code inconnu est ignoré. |

💡 **`display: "code"` est l'échappatoire** quand la plateforme ne dessine pas les emojis-drapeaux
(cas courant sous Windows) : les pastilles `FR`/`EN` restent lisibles partout.

Ordre de résolution de la langue : **`?lang=`** → `localStorage['gl-lang']` → `ui.language` → `fr`.
Le paramètre d'URL reste prioritaire pour qu'un **lien partagé affiche la même langue chez son
destinataire que chez son auteur**.

⚠️ La traduction porte sur l'**interface** (boutons, panneaux, messages), pas sur les **données**
(noms de POI, libellés de couches issus des profils).

### 30.3 `modules.theme-palette` — couleur d'accent

Bouton pastille à côté du bascule clair/sombre, ouvrant un choix de palettes. Le changement est
**immédiat, sans rechargement**.

```json
{
    "modules": {
        "theme-palette": {
            "enabled": true,
            "default": "default",
            "palettes": [
                { "id": "default", "label": "Orange", "swatch": "#f97316" },
                { "id": "green", "label": "Vert", "swatch": "#16a34a" },
                { "id": "blue", "label": "Bleu", "swatch": "#2563eb" }
            ]
        }
    }
}
```

| Clé        | Type      | Défaut      | Description                                                                               |
| ---------- | --------- | ----------- | ----------------------------------------------------------------------------------------- |
| `enabled`  | `boolean` | `false`     | Affiche le **bouton**. Requiert au moins 2 palettes.                                      |
| `default`  | `string`  | `"default"` | Palette appliquée sans choix mémorisé — **et palette fixe quand `enabled` vaut `false`**. |
| `palettes` | `array`   | les 3       | Palettes offertes : `{ id, label, swatch }`.                                              |

💡 **Le cas le plus fréquent en production est `enabled: false`** : l'intégrateur fixe sa couleur de
marque via `default` et n'offre aucun choix. La palette configurée s'applique quand même — seul le
bouton disparaît.

⚠️ **Trois réglages du dépôt portent le mot « thème » et sont indépendants** (ils se cumulent) :

| Réglage                  | Ce qu'il change                                          |
| ------------------------ | -------------------------------------------------------- |
| `modules.theme-palette`  | La **couleur d'accent** de l'interface (cette section)   |
| `modules.theme-toggle`   | Le mode **clair / sombre**                               |
| `modules.theme-selector` | Les **thèmes de CARTE** (jeux de couches, `themes.json`) |

Les palettes `green` et `blue` sont livrées avec le cœur et définies en clair **et** en sombre. Le
choix de l'utilisateur est mémorisé (`localStorage['gl-palette']`) et appliqué avant le premier
rendu, sans clignotement.
