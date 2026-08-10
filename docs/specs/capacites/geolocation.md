---
type: spec-capacite
title: geolocation — le suivi GPS de la position de l'utilisateur
capability_id: geolocation
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 5535694b
date: 27 juillet 2026
---

# geolocation — le suivi GPS de la position de l'utilisateur

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/geolocation/` ·
**Vérifié contre :** `5535694b` (27/07/2026)

> **Deux règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.

> ⚠️ **Son contrôle est invisible, et ce n'est pas un défaut.** `.geoleaf-ctrl-geolocation` est en
> `display: none !important` : toutes les interactions passent par la **pastille de la barre
> d'outils mobile**, qui clique le lien du contrôle par programme. Le contrôle est donc un
> **mécanisme**, pas une surface visible. Voir §Dépendances.

---

## Périmètre

### Ce que la capacité fait

Elle démarre et arrête une **veille GPS**, centre la carte sur la position obtenue, y dessine un
**marqueur d'utilisateur** et un **cercle de précision**, propose un **bouton de recentrage** quand
la carte a dérivé, et publie l'état GPS comme **seam** lisible par les autres capacités et par les
plugins.

### Ce qu'elle ne fait pas

- **Elle ne géocode pas** : convertir une adresse en coordonnées est le plugin `geocoding`.
- **Elle ne mesure rien** : les distances relèvent du plugin `measure` (qui, lui, **écoute** l'état
  publié ici).
- **Elle ne filtre pas par proximité** : c'est la capacité `filter` qui lit l'état GPS pour son
  mode de proximité (⏳ fiche à écrire, palier L/XL).
- **Elle n'affiche pas ses propres messages.** Les notifications passent par la capacité
  `toast-renderer`, atteinte **au runtime** : absente, chaque appel est un non-événement.
- **Elle ne mémorise rien.** Aucune persistance : l'état vit le temps de la page.

---

## Fonctionnalités

| ID    | Fonctionnalité                           | Entrée                                                   | Sortie observable                                                                                           | Code                                                                   |
| ----- | ---------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| GE-01 | Contrôle monté sur la carte              | `GeolocationModule.init(adapter)`, capacité activée      | `.geoleaf-ctrl-geolocation.geoleaf-ctrl-group.geoleaf-ctrl` ajouté à `position` — **masqué par la CSS**     | `geolocation.ts` → `initGeolocationControl`                            |
| GE-02 | Refus quand l'API n'existe pas           | Navigateur sans `navigator.geolocation`                  | Avertissement journalisé, **aucun contrôle** — pas de throw                                                 | `geolocation.ts` → garde d'entrée                                      |
| GE-03 | Démarrage de la veille                   | Clic, ou `Enter` / `Espace` sur le lien                  | `watchPosition` en haute précision, sans position mise en cache ; classe `gl-is-locating` posée             | `geolocation.ts` → `_makeToggleGeolocation`                            |
| GE-04 | Notification d'attente persistante       | idem                                                     | Un message « localisation en cours », **persistant et non congédiable**, mémorisé pour être refermé         | `geolocation.ts` → `_makeToggleGeolocation`                            |
| GE-05 | Premier point GPS                        | Première position reçue                                  | Carte centrée à un zoom dédié, marqueur posé, message d'attente refermé, message de succès affiché          | `geolocation.ts` → `_onGeoPositionSuccess`                             |
| GE-06 | Marqueur d'utilisateur                   | Position reçue                                           | Marqueur DOM `gl-user-location-dot`, ancré en son centre                                                    | `geolocation.ts` → `_updateGeoMarkers`                                 |
| GE-07 | Cercle de précision                      | Précision **inférieure au seuil**                        | Couche GeoJSON `gl-geoloc-accuracy` en bleu, dont le rayon porte la précision en mètres                     | `geolocation.ts` → `_updateGeoMarkers`                                 |
| GE-08 | Précision trop grossière ⇒ pas de cercle | Précision au-delà du seuil                               | Marqueur seul — un cercle d'un kilomètre n'informe personne                                                 | `geolocation.ts` → `_updateGeoMarkers`                                 |
| GE-09 | Bouton de recentrage                     | Carte déplacée au-delà d'un seuil de distance            | `#gl-recenter-btn` reçoit `gl-is-visible` ; un clic recentre au zoom courant                                | `geolocation.ts` → `_checkRecenterVisibility`, `_createRecenterButton` |
| GE-10 | Positions suivantes                      | Nouvelles positions de la veille                         | Marqueur et cercle remplacés, **sans re-centrer** la carte ; la visibilité du recentrage est réévaluée      | `geolocation.ts` → `_onGeoPositionSuccess`                             |
| GE-11 | Arrêt de la veille                       | Second clic                                              | `clearWatch`, marqueur et cercle retirés, bouton de recentrage retiré, `moveend` détaché, état remis à zéro | `geolocation.ts` → `_stopGeolocation`                                  |
| GE-12 | **Erreur ⇒ démontage COMPLET**           | Permission refusée, position indisponible, délai dépassé | Le **même** nettoyage qu'un arrêt volontaire, puis un message traduit selon le code d'erreur                | `geolocation.ts` → `_onGeoPositionError`                               |
| GE-13 | Annonce de changement d'état             | Veille démarrée ou arrêtée                               | `gl:geoloc:statechange` (`{ active }`) émis **sur le conteneur de carte**, remontant                        | `geolocation.ts` → `_stopGeolocation`, `_onGeoPositionSuccess`         |
| GE-14 | Seam d'état GPS                          | —                                                        | `GeoLeaf.Geolocation.getState()` rend la position, la précision, l'horodatage et les drapeaux de veille     | `public-api.ts`, `state.ts`                                            |
| GE-15 | Interactivité du cercle configurable     | `ui.interactiveShapes`                                   | Le cercle de précision est cliquable ou non, selon ce réglage **global**, pas un réglage propre             | `geolocation.ts` → `_updateGeoMarkers`                                 |
| GE-16 | Neutralisation de la propagation         | Interaction sur le contrôle                              | Ni pan ni zoom parasite de la carte dessous                                                                 | `geolocation.ts` → `blockMapPropagation`                               |
| GE-17 | Démontage complet                        | `GeolocationModule.destroy()` / `_reset()`               | Veille arrêtée, écouteurs détachés, marqueur, cercle et contrôle retirés                                    | `geolocation.ts` → `fullDestroy` ; `lifecycle.ts` → `_reset`           |
| GE-18 | Déclaration introspectable               | —                                                        | `getAllCapabilities()` la liste, `getCapabilitySchema("geolocation")` rend son schéma sans `loader`         | `geolocation-capability.ts`                                            |

⚠️ **GE-12 est une correction, pas une commodité, et c'est la ligne à ne jamais « simplifier ».**
Le gestionnaire d'erreur ne faisait qu'un nettoyage **partiel** : il retirait les classes, remettait
l'état à inactif et fermait le message — mais laissait courir la veille, gardait l'identifiant de
veille renseigné, laissait le bouton de recentrage dans le DOM et `moveend` attaché. Comme l'état
repassait à « inactif », **un second clic repartait dans la branche de démarrage et écrasait
l'identifiant de veille sans l'annuler** : une souscription GPS fuyait à chaque cycle
erreur → re-clic. Et après une erreur survenue en cours de veille, `moveend` recentrait encore sur
une position morte. Le correctif a été d'**emprunter** la fonction d'arrêt existante, qui faisait
déjà exactement le bon nettoyage.

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/geolocation/` —
déclaration, contrôle, et l'état en propre.

---

## Configuration

Bloc `modules.geolocation` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre  | Type      | Défaut      | Où c'est lu                                                                                         |
| ---------- | --------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `enabled`  | `boolean` | `true`      | `config.ts` → `getGeolocationConfig()` ; gate **opt-out**, revérifié tardivement par `lifecycle.ts` |
| `position` | `string`  | `"topleft"` | `lifecycle.ts` puis `geolocation.ts` → `addControl`                                                 |

⚠️ **`position` n'a presque aucun effet visible**, puisque le contrôle est masqué (voir l'encadré de
tête). Elle détermine le conteneur MapLibre dans lequel le nœud est inséré — ce qui reste observable
dans le DOM, et compte pour la CSS qui cible `.maplibregl-ctrl-top-left .geoleaf-ctrl-geolocation`.

Gate **opt-out** (`enableWhenAbsent: true`), comme [`coordinates`](coordinates.md) : les deux étages
disent la même chose, le gate tardif du cycle de vie revérifiant `enabled !== false` sur la
configuration fusionnée. Migré de l'ancien drapeau `ui.showGeolocation`.

### Les réglages qui ne sont PAS configurables

La capacité porte une dizaine de constantes nommées dans `geolocation.ts` — seuil de distance du
bouton de recentrage, zoom du premier point, seuil de précision au-delà duquel le cercle n'est pas
dessiné, durées et délais, tailles d'icônes, peinture du cercle. Aucune n'est exposée à la
configuration.

C'est délibéré : ce sont des réglages d'ergonomie, pas des paramètres d'intégration. Les valeurs
sont **nommées** dans le code plutôt que dispersées en littéraux, ce qui les rend lisibles sans les
publier. La couleur du cercle est notamment **non thématisée** de façon assumée : c'est la teinte que
les utilisateurs associent à « ma position ».

---

## Contrat exposé

### API publique

`GeoLeaf.Geolocation`, construit par `public-api.ts` → `buildPublicApi()`, monté par `install.ts` →
`registerGlobals(gl)`, re-exporté par la façade ESM `src/api/geoleaf.geolocation.ts`.

| Membre        | Rend                                                                     |
| ------------- | ------------------------------------------------------------------------ |
| `isEnabled()` | `true` quand `modules.geolocation.enabled !== false` (gate **opt-out**)  |
| `getConfig()` | Le bloc `modules.geolocation` fusionné sur les défauts                   |
| `getState()`  | **Le singleton d'état GPS vivant** : `active`, `watchId`, `userPosition` |

⚠️ **`getState()` rend le singleton lui-même, pas une copie.** Le type est présenté comme un
« instantané », mais l'objet est la référence vivante : un consommateur qui le garde voit les
positions suivantes changer sous lui — ce qui est précisément ce que le mode de proximité de
`filter` et le plugin `measure` exploitent. Ne pas le muter depuis l'extérieur.

Typage publié : `src/global.d.ts`, section des capacités (`Geolocation?:` →
`GeolocationPublicApi`). Ne pas citer de numéro de ligne pour ce fichier.

### Événements

| Événement               | Sens       | Émis où                                            | Détail                               |
| ----------------------- | ---------- | -------------------------------------------------- | ------------------------------------ |
| `gl:geoloc:statechange` | **émis**   | Sur le **conteneur de carte**, en remontant        | `{ active: boolean }`                |
| `moveend`               | **écouté** | Sur l'adaptateur, **seulement pendant une veille** | Réévalue la visibilité du recentrage |

⚠️ **`gl:geoloc:statechange` n'est pas un événement du bus GeoLeaf** : préfixe `gl:` et non
`geoleaf:`, émis sur un élément du DOM et non par le bus. Il échappe donc au dispositif de typage des
événements (`contracts/event-bus.contract.ts` et la baseline de couverture), qui raisonne sur les
noms `geoleaf:*`. Ce n'est pas une omission de la baseline : il n'entre pas dans son périmètre.

Deux consommateurs connus, et ils ne sont pas dans cette capacité :
`kernel/ui/mobile/mobile-toolbar.ts` (pour teinter la pastille) et
`packages/plugins/measure/src/tools/tool-gps.ts`.

---

## Décisions de conception

| Décision                                                     | Pourquoi                                                                                                                                                                                                           | Alternative écartée                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Le contrôle est masqué, la pastille mobile le pilote**     | Une seule implémentation du comportement GPS, atteinte depuis la surface visible du moment. Le contrôle joue le rôle de **mécanisme** ; le clic par programme évite de dupliquer la logique dans la barre d'outils | Deux implémentations, ou un contrôle visible en plus de la pastille — deux surfaces à garder en phase                   |
| **L'état GPS est un singleton ESM, publié comme seam**       | Trois consommateurs en ont besoin (barre d'outils, proximité de `filter`, plugin `measure`) et aucun ne doit importer statiquement la capacité. Le seam rend l'absence de capacité indolore                        | Un état privé plus des événements — chaque consommateur devrait reconstruire la position courante à partir des annonces |
| **L'erreur emprunte le démontage de l'arrêt volontaire**     | Un nettoyage partiel laissait fuir une souscription GPS à chaque cycle erreur → re-clic, et laissait `moveend` recentrer sur une position morte. La fonction d'arrêt faisait déjà le bon travail                   | Réécrire une moitié du nettoyage dans le gestionnaire d'erreur — c'est l'état d'avant, et il fuyait                     |
| **Ne re-centrer qu'au premier point**                        | Recentrer à chaque position rendrait la carte impossible à explorer pendant une veille. Le bouton de recentrage rend le geste **explicite** quand l'utilisateur le veut                                            | Recentrer en continu                                                                                                    |
| **Le bouton de recentrage n'apparaît qu'au-delà d'un seuil** | Il serait du bruit visuel quand la carte est déjà sur l'utilisateur                                                                                                                                                | L'afficher en permanence pendant la veille                                                                              |
| **Pas de cercle au-delà d'un seuil de précision**            | Un cercle de plusieurs centaines de mètres n'informe pas, il masque la carte                                                                                                                                       | Toujours dessiner le cercle                                                                                             |
| **Notifications atteintes au runtime, pas importées**        | La capacité de notification est optionnelle : un import statique la rendrait obligatoire. Absente, chaque appel est un non-événement — dégradation gracieuse, pas panne                                            | Un import statique de `toast-renderer`                                                                                  |
| **Notification d'attente persistante et non congédiable**    | Obtenir un premier point peut prendre plusieurs secondes ; un message qui s'efface laisserait l'utilisateur sans retour. Elle est mémorisée pour être refermée à coup sûr — succès **comme** erreur                | Un message éphémère                                                                                                     |
| **Haute précision, jamais de position mise en cache**        | Une position en cache placerait l'utilisateur là où il était, ce qui est pire que pas de position du tout pour un usage cartographique                                                                             | Autoriser une position récente                                                                                          |
| **Couleur du cercle non thématisée**                         | C'est la teinte conventionnelle de « ma position » ; la faire varier avec la palette la rendrait méconnaissable                                                                                                    | La brancher sur les jetons de thème                                                                                     |
| **Réglages d'ergonomie non exposés à la configuration**      | Ce sont des choix d'interface, pas des paramètres d'intégration. Ils sont **nommés** dans le code pour rester lisibles, sans devenir des promesses publiques                                                       | Les publier dans le `configSchema` — chacun deviendrait une surface à maintenir                                         |
| **Icônes construites par le helper de sécurité**             | Les tracés sont statiques, mais le dépôt interdit `innerHTML` hors des helpers : la règle ne se négocie pas au cas par cas                                                                                         | `innerHTML`                                                                                                             |
| Pas de `loader`                                              | Inline avec le bundle UI ; le gate de configuration décide                                                                                                                                                         | Un `import()` paresseux                                                                                                 |

---

## Dépendances et frontières

### Dépendance de cycle de vie

`module.ts` → `GeolocationModule` : `id = "geolocation"`, `dependencies = ["geojson"]` — monte après
la carte et les couches, la barre d'outils lui déléguant les clics. Le montage est **synchrone** à
l'`init()` du module, qui tourne après la fusion de la configuration : le gate tardif y lit donc la
bonne valeur, sans attendre d'événement.

Sa position dans `presets/manifest.full.ts` est celle du lot des contrôles de carte simples.

### ⚠️ Le seul lien capacité → capacité de ce palier

`capabilities/filter/panel/proximity/proximity-gps-mode.ts` importe **`geolocation/state.js`**
directement. La règle R.8 encadre `capabilities/` → `kernel/`, pas `capabilities/` →
`capabilities/` : cet import n'est donc interdit par rien, et il est assumé sur place dans l'en-tête
de `state.ts`.

Le coût est faible **et mesurable** : `state.ts` n'importe qu'un **type** (effacé à la compilation),
donc `filter` tire un singleton de quelques lignes, **pas** les centaines de lignes du contrôle. Tous
les autres consommateurs — dont la barre d'outils mobile, délibérément — passent par le seam
`GeoLeaf.Geolocation.getState()` pour éviter précisément un import statique de la capacité.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                     | Statut vis-à-vis de R.8           |
| ------------------------------------------ | --------------------------------- |
| `kernel/config/config-primitives.js`       | **Exception** nommée par la règle |
| `kernel/security/index.js` (`DOMSecurity`) | **Baril** — conforme              |

Le reste passe par `utils/` : `utils/log`, `utils/i18n`, `utils/general/dom-helpers`,
`utils/controls/propagation-blocker`, et `utils/geo/haversine` pour la distance de dérive.

⚠️ **La capacité lit `ui.interactiveShapes` directement dans `geolocation.ts`**, par son propre
accès à la configuration — et non par `config.ts`, qui ne connaît que le bloc `modules.geolocation`.
C'est un réglage **global d'interface**, pas un paramètre de cette capacité : le mettre dans son
`configSchema` en ferait une seconde source de vérité.

### Contrats

`contracts/map-adapter.contract.js` (`IMapAdapter`, `GeoLeafControl`, `GeoLeafControlPosition`) et
`contracts/ui-controls.contract.js` (`IGeoLocationState`, `UserPositionState`). Contrairement à
[`branding`](branding.md) et [`coordinates`](coordinates.md), cette capacité consomme
**directement** `IMapAdapter` — elle a besoin d'une large part de sa surface : `addControl`,
`createMarker`, `removeMarker`, `addGeoJSONLayer`, `removeLayer`, `setView`, `getCenter`,
`getZoom`, `getContainer`, `on`, `off`. Un type structurel local n'aurait rien resserré.

Elle ne touche jamais MapLibre directement — une règle ESLint interdit à `capabilities/**`
d'importer `adapters/maplibre/*`. **Aucune référence à un plugin** — règle `no-plugin-in-core`,
même si deux plugins consomment son seam : la dépendance va dans l'autre sens.

### Frontière côté CSS

`css/geolocation.css`, sous `@layer gl.capabilities`, tirée par `install.ts` — donc elle se
tree-shake avec le code. Son en-tête documente une histoire utile : cette feuille a été **sortie**
des feuilles kernel au S6, où des sélecteurs groupés la nommaient explicitement
(`.geoleaf-ctrl-zoom, …, .geoleaf-ctrl-geolocation { … }`) — et c'est exactement ce qui rendait la
capacité indétachable du bundle. Le kernel possède désormais le **rôle** `.geoleaf-ctrl` ; cette
feuille ne possède que ce qui est propre à la géolocalisation, en commençant par son propre
masquage.
