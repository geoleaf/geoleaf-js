---
type: spec-capacite
title: coordinates — le relevé en temps réel des coordonnées du curseur
capability_id: coordinates
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 5535694b
date: 27 juillet 2026
---

# coordinates — le relevé en temps réel des coordonnées du curseur

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/coordinates/` ·
**Vérifié contre :** `5535694b` (27/07/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

---

## Périmètre

### Ce que la capacité fait

Elle affiche la **latitude et la longitude sous le curseur**, mises à jour en continu. Elle
s'**amarre à la barre d'échelle** quand celle-ci est présente, et retombe sinon sur un contrôle
autonome posé sur la carte.

### Ce qu'elle ne fait pas

- **Elle ne projette pas.** Les valeurs affichées sont celles que l'adaptateur fournit dans
  l'événement de déplacement — pas de conversion vers un autre système de référence, pas de format
  sexagésimal.
- **Elle ne réagit pas au clic** : c'est un relevé, pas un outil de saisie. Rien à copier, rien à
  épingler.
- **Elle n'appartient pas à la barre d'échelle**, même quand elle s'y greffe. Voir §Dépendances —
  c'est la particularité de cette capacité, et elle a deux conséquences mesurées.
- **Elle n'internationalise pas son étiquette** : le texte est `Lat: …, Lng: …`, écrit en dur. Voir
  §Décisions.

---

## Fonctionnalités

| ID    | Fonctionnalité                                   | Entrée                                  | Sortie observable                                                                                           | Code                                                            |
| ----- | ------------------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| CO-01 | Montage différé                                  | Événement `geoleaf:app:ready`           | Le relevé apparaît une fois la carte **et** l'UI différée en place — écouteur `{ once: true }`              | `lifecycle.ts` → `init`, `_onAppReady`                          |
| CO-02 | Amarrage à la barre d'échelle                    | `.gl-scale-main-wrapper` présent        | Un séparateur puis `.gl-scale-coordinates` insérés **dans le conteneur de l'échelle**                       | `coordinates.ts` → `_attachToScaleWrapper`                      |
| CO-03 | Attente de la barre d'échelle                    | Conteneur pas encore dans le DOM        | Un `MutationObserver` sur `document.body` s'amarre dès qu'il apparaît, **puis se déconnecte**               | `coordinates.ts` → `_createControl`                             |
| CO-04 | Repli autonome après délai                       | Conteneur jamais apparu                 | Avertissement journalisé puis `.gl-coordinates-display` posé via `addControl` à `position`                  | `coordinates.ts` → `_createControl`, `_createStandaloneControl` |
| CO-05 | Relevé initial neutre                            | Contrôle créé, curseur pas encore entré | `Lat: --, Lng: --`                                                                                          | `coordinates.ts`                                                |
| CO-06 | Mise à jour du relevé                            | Déplacement du curseur sur la carte     | `Lat: <lat>, Lng: <lng>`, arrondis à `decimals`                                                             | `coordinates.ts` → `_onMouseMove`                               |
| CO-07 | **Coalescence sur une frame d'animation**        | Rafale de déplacements                  | **Une seule** écriture par frame peinte, sur la **dernière** position vue                                   | `coordinates.ts` → `_onMouseMove`                               |
| CO-08 | Lecture immédiate des coordonnées                | idem                                    | La position est copiée **au moment de l'événement**, jamais relue plus tard                                 | `coordinates.ts` → `_onMouseMove`                               |
| CO-09 | Neutralisation de la propagation (mode autonome) | Interaction sur le contrôle             | Ni pan ni zoom parasite de la carte dessous                                                                 | `coordinates.ts` → `blockMapPropagation`                        |
| CO-10 | Démontage — la frame en attente est annulée      | `destroy()` avec une frame en vol       | Aucune écriture dans un élément déjà retiré                                                                 | `coordinates.ts` → `destroy`                                    |
| CO-11 | Démontage — le délai d'attente est annulé        | `destroy()` avant l'expiration du délai | Le contrôle **n'est pas reconstruit** sur une instance détruite                                             | `coordinates.ts` → `destroy`                                    |
| CO-12 | Démontage — l'observateur est déconnecté         | `destroy()` pendant l'observation       | Plus aucune tentative d'amarrage                                                                            | `coordinates.ts` → `destroy`                                    |
| CO-13 | Démontage — écouteur de carte détaché            | `destroy()`                             | `off("mousemove", …)` sur la **même référence liée** que celle passée à `on`                                | `coordinates.ts` → `destroy`                                    |
| CO-14 | Aucune exception ne remonte                      | Carte absente, DOM indisponible         | Message dans `Log.error`, la méthode rend la main — chaque méthode publique est enveloppée d'un `try/catch` | `coordinates.ts`                                                |
| CO-15 | Déclaration introspectable                       | —                                       | `getAllCapabilities()` la liste, `getCapabilitySchema("coordinates")` rend son schéma sans `loader`         | `coordinates-capability.ts`                                     |

⚠️ **CO-07 et CO-11 sont les deux lignes à ne pas simplifier.** La première est une optimisation
dont le mécanisme est contre-intuitif (voir §Décisions) ; la seconde répare un défaut réel — le délai
de repli, s'il n'était pas annulé, se déclenchait **après** le démontage, constatait l'absence
d'élément que le démontage venait de provoquer, et **reconstruisait le contrôle sur une instance
morte**. Deux tests visent nommément ce scénario.

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/coordinates/`.

---

## Configuration

Bloc `modules.coordinates` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre  | Type      | Défaut         | Où c'est lu                                                                                          |
| ---------- | --------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `enabled`  | `boolean` | `true`         | `config.ts` → `getCoordinatesConfig()` ; gate **opt-out**, revérifié tardivement par `lifecycle.ts`  |
| `position` | `string`  | `"bottomleft"` | `coordinates.ts` → `_createStandaloneControl`. **N'a d'effet qu'en mode autonome** — voir ci-dessous |
| `decimals` | `number`  | `6`            | `constants.ts` → `DEFAULT_COORDINATES_DECIMALS`, appliqué par `_onMouseMove`                         |

### `position` ne s'applique qu'au repli

C'est le piège de configuration de cette capacité : lorsqu'elle s'amarre à la barre d'échelle — le
cas normal —, **`position` est ignorée**, puisque l'emplacement est celui du conteneur d'accueil.
Elle ne gouverne que le contrôle autonome (CO-04). Le schéma le dit par « standalone fallback », et
c'est à lire littéralement.

### Gate opt-out, vérifié deux fois

`enableWhenAbsent: true` — la capacité est **active par défaut**, ce qui préserve le comportement
d'avant la migration de l'ancien drapeau `ui.showCoordinates`. Contrairement à
[`theme-toggle`](theme-toggle.md), les deux étages **disent la même chose** ici : le gate de
déclaration enregistre le module, et le gate tardif du cycle de vie revérifie `enabled !== false`
sur la configuration fusionnée. Le second n'est pas redondant : il attrape un profil qui désactive
la capacité dans une couche fusionnée après le gate pré-fusion.

### Les trois copies du nombre de décimales

`constants.ts` existe pour la même raison que chez [`branding`](branding.md) et
[`cluster`](cluster.md) : le nombre de décimales vivait en littéral nu à **trois** endroits qui
doivent s'accorder — les options du contrôle, les défauts du lecteur, et le schéma d'introspection.
Il est désormais importé par les trois, donc la valeur **annoncée** et la valeur **appliquée** sont
identiques par construction.

---

## Contrat exposé

### API publique

`GeoLeaf.Coordinates`, construit par `public-api.ts` → `buildPublicApi()`, monté par `install.ts` →
`registerGlobals(gl)`, re-exporté par la façade ESM `src/api/geoleaf.coordinates.ts`.

Sa forme est **le contrôle runtime augmenté** (`Object.assign`), comme [`branding`](branding.md) :
`CoordinatesPublicApi = CoordinatesControl & CoordinatesReadApi`.

| Membre               | Origine            | Rend / fait                                                         |
| -------------------- | ------------------ | ------------------------------------------------------------------- |
| `init(map, options)` | contrôle           | Monte le relevé (appelé par le cycle de vie, pas par l'intégrateur) |
| `destroy()`          | contrôle           | Démonte et annule tout ce qui est en vol                            |
| `isEnabled()`        | helper de capacité | `true` quand `modules.coordinates.enabled !== false`                |
| `getConfig()`        | helper de capacité | Le bloc `modules.coordinates` fusionné sur les défauts              |

⚠️ **`isEnabled()` teste `!== false`**, comme [`cluster`](cluster.md) : c'est la traduction fidèle
d'un gate opt-out. Les capacités opt-in de ce palier testent `=== true`. Ne pas aligner les deux
formes.

Les membres internes du contrôle (`_map`, `_frameHandle`, `_wrapperObserver`…) sont dans le type
parce que le contrôle est un objet littéral qui y accède par `this` — ils ne sont pas une surface
d'intégrateur.

Typage publié : `src/global.d.ts`, section des capacités (`Coordinates?:` →
`CoordinatesPublicApi`). Ne pas citer de numéro de ligne pour ce fichier.

### Événements

| Événement           | Sens                         | Rôle                                                                    |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `geoleaf:app:ready` | **écouté**, `{ once: true }` | Déclenche le montage — préserve le moment historique du montage différé |
| `mousemove`         | **écouté sur l'adaptateur**  | La source du relevé. Détaché au démontage sur la même référence liée    |

La capacité **n'émet aucun événement du bus**.

---

## Décisions de conception

| Décision                                                        | Pourquoi                                                                                                                                                                                                                                                                                 | Alternative écartée                                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Coalescence sur une frame, en gardant la DERNIÈRE position**  | Le moteur émet les déplacements aussi vite que le pointeur les rapporte, mais l'affichage ne peut changer qu'une fois par frame peinte : les écritures supplémentaires sont **invisibles par construction**. Garder la dernière position est ce qui laisse le relevé sur le curseur réel | Une limitation « au premier événement » — elle figerait le relevé sur une position périmée jusqu'à la frame suivante |
| **Copier les coordonnées au moment de l'événement**             | L'objet d'événement est **recyclé** par le moteur : le relire dans la frame donnerait une autre position que celle qui a déclenché l'écriture                                                                                                                                            | Conserver la référence à l'événement                                                                                 |
| **Amarrage à la barre d'échelle plutôt qu'un contrôle propre**  | Les deux relevés occupent le même coin et se lisent ensemble ; deux contrôles empilés se disputeraient la place                                                                                                                                                                          | Un contrôle indépendant systématique                                                                                 |
| **Observateur de mutations plutôt qu'un délai fixe**            | L'ordre de construction n'est pas garanti : un délai arbitraire serait soit trop court, soit inutilement lent                                                                                                                                                                            | Un `setTimeout` d'attente                                                                                            |
| **Un délai de sécurité malgré l'observateur**                   | Si la barre d'échelle n'est **jamais** montée (capacité absente du preset), l'observateur attendrait indéfiniment et le relevé n'apparaîtrait pas du tout                                                                                                                                | Attendre sans limite                                                                                                 |
| **Le délai et l'observateur sont mémorisés pour être annulés**  | Sans cela, le délai se déclenche **après** le démontage, voit l'élément que le démontage vient de retirer, et **reconstruit le contrôle sur une instance morte**. Le défaut a existé ; deux tests le verrouillent                                                                        | Ne garder aucune poignée                                                                                             |
| **Montage sur `geoleaf:app:ready`, pas à l'`init()` du module** | Le relevé a besoin de l'UI différée — dont la barre d'échelle. L'événement est asynchrone par rapport à l'initialisation des modules, donc s'abonner pendant l'`init()` suffit à le capter                                                                                               | Monter directement — l'amarrage échouerait presque toujours et le repli s'appliquerait par défaut                    |
| **Dépendance sur `geojson`, pas sur `ui`**                      | Il faut que l'abonnement soit posé **avant** que l'événement ne parte ; c'est le même choix que `labels` et `theme-selector`                                                                                                                                                             | Dépendre de l'UI — l'abonnement arriverait après le tir                                                              |
| **Étiquette non internationalisée**                             | `Lat` / `Lng` sont des abréviations conventionnelles en cartographie, lues identiquement dans les langues fournies. C'est un choix assumé, **pas un oubli d'i18n** — mais il est le seul de ce palier                                                                                    | Passer par `getLabel` — cohérent avec les autres capacités, et c'est l'option à retenir si une langue s'y prête mal  |
| **Chaque méthode publique enveloppée d'un `try/catch`**         | Un relevé informatif ne doit jamais empêcher la carte de fonctionner                                                                                                                                                                                                                     | Laisser remonter                                                                                                     |
| Pas de `loader`                                                 | Inline avec le bundle UI ; le gate de configuration décide                                                                                                                                                                                                                               | Un `import()` paresseux                                                                                              |

---

## Dépendances et frontières

### Dépendance de cycle de vie

`module.ts` → `CoordinatesModule` : `id = "coordinates"`, `dependencies = ["geojson"]`.
L'adaptateur reçu à l'`init()` est **capturé** puis utilisé au moment du montage, pas
immédiatement — c'est ce qui permet de différer sans perdre la poignée de carte.

Sa position dans `presets/manifest.full.ts` est celle du lot des contrôles de carte simples.

### ⚠️ Le couplage avec `scale` — et il va dans les deux sens

C'est la particularité de cette capacité, et elle n'est déclarée dans aucun `dependencies` :

| Sens                                           | Fait mesuré                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `coordinates` **écrit dans** le DOM de `scale` | Elle insère un séparateur et son élément de relevé **dans `.gl-scale-main-wrapper`**, un conteneur qu'elle ne possède pas       |
| `coordinates` **dépend du CSS de** `scale`     | La classe `gl-scale-separator` qu'elle crée est **stylée par `capabilities/scale/css/scale.css`**, jamais par sa propre feuille |

Conséquence : une entrée qui embarque `coordinates` **sans** [`scale`](scale.md) obtient le repli
autonome (CO-04) après le délai d'attente — comportement correct —, mais si l'amarrage a lieu, le
séparateur n'a pas de style. Le couplage est **implicite** : rien ne le déclare, aucune gate ne le
vérifie.

⚠️ **Un séparateur n'est pas retiré au démontage.** `destroy()` retire l'élément de relevé et
détache tout ce qui est en vol, mais **pas** le `div.gl-scale-separator` inséré par l'amarrage. Un
cycle démontage → remontage en accumule donc un de plus à chaque passage. Écart mesuré en écrivant
cette fiche, versé au registre de dette technique du dépôt de travail.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

Un seul accès kernel : `kernel/config/config-primitives.js`, **exception nommée par la règle**. Le
reste passe par `utils/` : `utils/log`, `utils/general/dom-helpers` (`domCreate`),
`utils/general/helpers-namespace` (les enveloppes de frame d'animation, qui retombent sur un
délai quand l'environnement n'a pas de `requestAnimationFrame`), et
`utils/controls/propagation-blocker`.

⚠️ **Deux fichiers d'aides, aux noms voisins** : `utils/general/dom-helpers` fournit `domCreate`,
`utils/general/helpers-namespace` fournit `Helpers` et ses enveloppes de frame. Le code le signale
sur place, parce que la confusion est facile.

### Contrats

`contracts/map-adapter.contract.js` — `GeoLeafControl`, `GeoLeafLatLng`. Comme
[`branding`](branding.md), la capacité ne consomme du contrat que ce dont elle a besoin, via un type
**structurel** local (`types.ts` → `CoordinatesMapLike` : `on`, `off`, `addControl`). Elle ne touche
jamais MapLibre directement.

**Aucun seam**, et **aucune référence à un plugin** — règle `no-plugin-in-core`, vérifiée par
`scripts/verify-core-standalone.cjs`.

### Frontière côté CSS

`css/coordinates.css`, sous `@layer gl.capabilities`, tirée par `install.ts` — donc elle se
tree-shake avec le code. Elle ne style **que** le mode autonome (`.gl-coordinates-display`,
`.gl-coordinates__content`) ; le mode amarré est habillé par la feuille de `scale`, comme dit
ci-dessus. Les variables de thème viennent de `css/geoleaf-theme.css`, chargée plus tôt dans la
cascade — la feuille ne les réimporte pas.
