---
type: spec-plugin
title: isochrone — les zones atteignables depuis un point, demandées à un moteur de routage
plugin_id: isochrone
package: "@geoleaf-plugins/isochrone"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 83f3efeb7
date: 11 octobre 2026
---

# isochrone — les zones atteignables depuis un point, demandées à un moteur de routage

**Type :** plugin, pas encore publié · **Paquet :** `@geoleaf-plugins/isochrone` ·
**Code :** `packages/plugins/isochrone/` · **Vérifié contre :** voir `verifie_contre` en tête — une seconde empreinte vivait ici dans d'autres fiches, que rien ne gardait ; cf. `__tests__/guards/spec-single-stamp.guard.test.ts`.

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**.

> ⚠️ **Cette fiche décrit un paquet en construction.** Elle ne rend compte que de ce qui est
> écrit : chaque section dit ce que le code fait aujourd'hui, et rien de ce qu'il fera. Ce qui
> n'existe pas encore — la pile de zones, leur dessin sur la carte, la fenêtre — est nommé comme
> tel là où il manque, plutôt que décrit comme s'il tournait.

---

## Périmètre

### Ce que le plugin fait

Il affiche les **zones atteignables en un temps donné depuis un point** de la carte. Il est le
**client d'un moteur de routage** : il pose la question — un point, un mode de déplacement, des
durées —, lit la réponse et crédite la donnée.

### Ce qu'il ne fait pas

- **Il ne calcule rien.** Ni tampon, ni union, ni simplification : une zone est dessinée telle que
  le moteur la rend. Une isochrone se calcule sur un graphe de voies, et c'est le travail d'un
  moteur, pas d'une bibliothèque cartographique.
- **Il ne juge pas une géométrie.** Une zone minuscule rendue pour un point loin de toute voie
  est une réponse du moteur, pas une erreur à deviner côté client.
- **Il ne filtre aucune couche du profil.** Une zone s'affiche, elle ne sélectionne pas.
- **Il ne lit pas la géolocalisation**, et ne garde rien d'une page à l'autre.
- **Il ne dépend d'aucun autre plugin**, `routing` compris : les deux parlent au même genre de
  moteur, et aucun des deux n'importe l'autre.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                       |
| ------------ | ---------------------------- |
| `name`       | `isochrone`                  |
| `label`      | `GeoLeaf Isochrone`          |
| `requires`   | `[]`                         |
| `optional`   | `[]`                         |
| `namespace`  | `GeoLeaf.Isochrone`          |
| `paquet npm` | `@geoleaf-plugins/isochrone` |

Le plugin exige `@geoleaf/core` à partir de la version qui porte `IMapAdapter.setLayerZIndex` :
c'est la primitive par laquelle une zone change de rang sans être reconstruite. La plage se lit
dans `package.json`, champ `peerDependencies`.

---

## Chargement — à la demande, et sans bouton tant que la fenêtre n'existe pas

L'application livrée l'enregistre par `registerLazy` dans `apps/geoleaf-app/init.js` : le bundle
part dans les variantes, et rien ne le télécharge tant que personne ne le demande.

⚠️ **Cet enregistrement ne déclare aucun créneau de barre d'outils, et c'est délibéré.** Un bouton
chargé à la demande est visible dès qu'un profil ne dit pas le contraire : le déclarer avant que
la fenêtre existe poserait, sur chaque profil, un contrôle qui n'ouvre rien. Tant que ce créneau
n'est pas déclaré, le plugin s'atteint par `GeoLeaf.plugins.load("isochrone")`, puis par son API.

Chargé **avant** `GeoLeaf.boot()` — une balise `<script>`, comme le README du paquet le montre —,
le plugin déclare lui-même son bouton : sur ce chemin, sa déclaration est la seule.

---

## Les étapes d'`entry.ts`

| Étape                      | Ce qu'elle fait ici                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dictionnaires i18n         | `I18n.registerDict("isochrone", …)` — **en premier**, sinon les libellés du boot ne résolvent pas                                                             |
| Montage du namespace       | `GeoLeaf.Isochrone = buildPublicApi()`                                                                                                                        |
| Auto-enregistrement        | Le manifeste ci-dessus, `healthCheck` sur la présence du namespace                                                                                            |
| Fournisseur livré          | `import "./providers/builtins.js"` — un import d'effet de bord : le moteur livré s'enregistre sans appel que l'hôte devrait se rappeler                       |
| Ré-exports de types        | Les formes du modèle (`src/model.ts`), pour qui écrit son propre fournisseur. Des types seuls                                                                 |
| Module au registre du core | Le **démontage** sur les deux chemins de chargement ; le créneau de barre — `profileKey: "modules.isochrone.showButton"` — sur le seul chemin d'avant le boot |
| Écouteur d'action          | `geoleaf:toolbar:action` → ouverture                                                                                                                          |

🛑 **Le montage s'écrit `.Isochrone = buildPublicApi()` LITTÉRALEMENT, sur une seule instruction.**
Deux gardes du cœur lisent `src/entry.ts` comme du texte et reconnaissent cette forme par
expression régulière — `doc-plugin-manifest.guard.test.js` et
`plugin-namespace-declared.guard.test.js`. Garder la façade dans une variable locale puis affecter
la variable n'est reconnu par aucune des deux : le plugin se lit alors comme un plugin qui ne
monte rien. L'écouteur d'action appelle donc le module de domaine directement, sans relire le
namespace.

⚠️ **Aucune souscription à un signal de démarrage au corps du module.** Un plugin chargé à la
demande s'abonnerait après que le signal est passé. L'écouteur de la barre d'outils se pose au
chargement, et le démontage passe par le registre des modules du cœur — c'est par lui que
`GeoLeaf.mount()` atteint ce que le plugin a construit dans la page.

---

## API publique — `GeoLeaf.Isochrone`

La façade (`src/public-api.ts`) ne fait que déléguer.

| Méthode                         | Rôle                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getConfig()`                   | La configuration fusionnée et validée                                                                                                                                                                  |
| `configure(overrides)`          | L'adresse du moteur et les paramètres de requête, pour les calculs suivants. Remplace le réglage précédent **en entier** ; `null` l'efface ; rend `false` et n'applique rien si une valeur est refusée |
| `registerProvider(id, factory)` | Enregistre un moteur ; un même nom remplace le précédent                                                                                                                                               |
| `getProvider()`                 | Nom et crédit du moteur que le prochain calcul utiliserait, ou `null`                                                                                                                                  |
| `open()`                        | Ouvre le plugin. Rend `false` si le profil l'a désactivé, `true` une fois ouvert                                                                                                                       |
| `close()`                       | Ferme le plugin, et retire ce que `open()` a construit. Sans effet s'il n'est pas ouvert                                                                                                               |

Ce que la façade ne porte pas encore : le calcul d'une zone, la pile et ses réglages. Un membre
annoncé avant que ce qu'il alimente existe répondrait quelque chose que personne ne peut
afficher. La surface publiée fait foi dans `docs/reference/API_SURFACE.txt`, générée.

`src/entry.ts` ré-exporte les **types** du modèle (`src/model.ts`) : qui écrit son propre
fournisseur doit pouvoir le typer, et l'omission lui rendrait un `TS2305` que rien ici ne
montrerait.

---

## Le fournisseur — un registre, une adresse acceptée ou refusée, un crédit obligatoire

`src/provider.ts`, décalqué de celui de `routing` sans l'importer : les deux paquets ne se
connaissent pas.

Un fournisseur traduit la question du plugin dans le dialecte d'un moteur, et déclare le crédit
que sa donnée exige. Il s'enregistre sous un nom, que `provider` désigne au profil.

🛑 **Rien n'est jamais substitué.** `createProvider` rend `null` — et non un autre moteur —
dans trois cas, et `getProvider()` avec lui :

- le nom ne désigne aucun fournisseur enregistré ;
- l'adresse qui s'applique est refusée ;
- le fournisseur ne déclare aucun crédit.

### L'adresse qui s'applique

Trois sources, dans cet ordre : celle de `configure()`, celle du profil (`endpoint`), celle du
fournisseur. Seul le fournisseur livré a une adresse par défaut ; un fournisseur tiers reçoit la
sienne du profil ou de l'exécution.

Une adresse est **refusée** si elle ne commence pas par `https://`, si elle est illisible, ou si
elle porte un identifiant (`https://utilisateur:secret@hôte`) — règle unique, dans
`src/request-url.ts`. La requête emporte un point choisi sur une carte : en clair, chaque saut
du chemin le lit.

⚠️ **Une adresse refusée n'est jamais remplacée par la source suivante.** Un profil qui déclare
`http://…` n'obtient aucun moteur, pas celui par défaut : un repli silencieux cacherait le refus
derrière un calcul qui marche, contre un moteur que personne n'a choisi.

### Le crédit

Un fournisseur dont le crédit est vide est refusé, et le journal le dit. Il n'en reçoit pas un
par défaut : en inventer un pour un moteur inconnu attribuerait la donnée à une source qui ne
l'a peut-être pas produite — une affirmation fausse, pire qu'une absence.

---

## Les réglages d'exécution — la porte par où passe une clé

`src/runtime-overrides.ts` tient ce que `configure()` a reçu : `{ endpoint?, query? }`.

- **Validé en entier, ou refusé en entier.** Une valeur inutilisable, et rien n'est appliqué : le
  réglage en vigueur reste tel qu'il était. Un `configure()` appliqué à moitié enverrait une clé
  à une adresse que l'hôte n'a jamais voulue.
- **Refusés** : une adresse que la règle ci-dessus refuse ; un paramètre dont la valeur n'est pas
  une chaîne ; un paramètre nommé `json`, réservé à la question.
- **Un refus nomme le champ, jamais sa valeur.** La valeur est l'endroit où se trouve la clé.
- **Il survit à un démontage de l'application**, pas à un rechargement : l'hôte qui a obtenu une
  clé par sa propre session ne la remet pas à chaque remontage, et rien n'est stocké.

🛑 **La clé ne s'écrit nulle part ailleurs.** Ni dans un profil, ni dans ce que l'API répond, ni
dans un journal : `src/__tests__/no-key-leak.test.ts` suit une clé sentinelle à travers tout ce
que le plugin peut montrer. Une URL qui atteint un journal y passe par sa forme masquée — origine
et chemin, jamais la chaîne de requête ; une URL illisible n'y est pas recopiée non plus.

⚠️ **Une clé donnée au navigateur est lisible par qui tient le navigateur**, dans ses outils de
développement et dans les journaux du moteur. Le plugin la tient hors de ses propres traces, et
ne peut rien de plus : un intégrateur qui doit la cacher place un relais sur son origine, et
`endpoint` désigne le relais.

---

## Le fournisseur livré — Valhalla

`src/providers/valhalla.ts` construit la requête, l'envoie et **classe** ce qui revient. Il ne
convertit rien : lire les zones est le travail du normaliseur.

```text
GET <endpoint>/isochrone?json={"locations":[{"lat":…,"lon":…}],"costing":"auto","contours":[{"time":5},…],"polygons":true}
```

- **GET, la question dans l'URL.** C'est une requête simple au sens de CORS : aucun pré-vol
  qu'un frontal qu'on ne maîtrise pas devrait laisser passer. La question tient en une centaine
  de caractères.
- **`json` est écrit en dernier** : un paramètre de l'hôte ne peut pas remplacer la question —
  `configure()` le refuse déjà, et l'adaptateur ne s'y fie pas.
- **Modes** : `car` → `auto`, `foot` → `pedestrian`, `bike` → `bicycle`.
- 🛑 **L'inversion des coordonnées se fait ici, et nulle part ailleurs.** Le modèle du plugin porte
  `[lon, lat]` ; le moteur attend `{lat, lon}`.
- **Adresse par défaut** : un serveur public partagé, sans garantie — un confort de
  démonstration. Une application en service déclare la sienne.
- **Crédit** : « © OpenStreetMap contributors ». Il crédite la **donnée**, pas le moteur : un
  intégrateur dont l'instance route sur autre chose enregistre son propre fournisseur, avec son
  propre crédit.

### Ses limites, et pourquoi elles ne sont pas celles du serveur par défaut

Le fournisseur déclare un nombre de contours par requête et une durée maximale — les valeurs se
lisent dans `src/providers/valhalla.ts` (`LIMITS`). Ce sont celles d'une instance auto-hébergée,
**pas** celles du serveur public qu'il appelle par défaut, qui s'arrête plus tôt.

C'est décidé, et l'autre choix est écarté : déclarer le plafond du serveur de démonstration
l'imposerait à toute instance qu'un intégrateur désigne par `endpoint`, et l'obligerait à
enregistrer un fournisseur pour la seule raison de le dépasser. La conséquence est assumée : sur
l'adresse par défaut, une durée entre les deux plafonds part et revient **refusée** — un refus
tardif, mais nommé, que `fixtures/valhalla-isochrone-refused-duration.json` tient.

---

## Ce qu'un fournisseur répond quand il ne répond pas — cinq motifs, jamais un seul

| Réponse                                                   | Motif       | Ce qu'il porte                                                        |
| --------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| Réussite, tous les contours demandés présents et lisibles | réussite    | Un contour par durée demandée                                         |
| Réussite, corps illisible ou contour manquant             | `malformed` | —                                                                     |
| Tout refus                                                | `http`      | Le statut de la réponse, et le code propre au moteur s'il est lisible |
| Délai dépassé                                             | `timeout`   | —                                                                     |
| Annulation par l'appelant                                 | `aborted`   | —                                                                     |
| Tout le reste                                             | `network`   | —                                                                     |

Les motifs sont nommés parce que les gestes qui en découlent sont opposés : réessayer, ou ne
rien pouvoir faire. Les fondre en un seul rendrait à l'écran une phrase unique, fausse dans la
plupart des cas.

🛑 **Un refus se lit en deux nombres, et aucun texte.** Le statut seul ne nomme rien : les refus
vus sur le serveur public le partagent tous. L'adaptateur garde donc aussi le code du moteur
quand le corps du refus est lisible et le porte en entier. Le message que le moteur a écrit
n'est ni rendu, ni journalisé, ni conservé : c'est une entrée externe. Le transport remet le
corps du refus à l'adaptateur, qui y lit ce nombre et laisse le reste — rien de ce qu'un moteur
écrit ne quitte `src/providers/`.

⚠️ **Une clé refusée peut se lire `network`.** Quand le frontal d'un moteur refuse une clé sans
ouvrir sa réponse d'erreur aux autres origines, le navigateur cache le refus : le plugin ne voit
qu'une requête qui n'a pas abouti. C'est hors de portée du client.

Un échec est écrit au journal de l'hôte avec la forme masquée de l'URL, son motif et ses
nombres. Une annulation ne l'est pas : l'utilisateur l'a demandée.

### Le transport — un seul contrôleur pour le délai et l'annulation

`src/providers/http.ts`. Le paquet a son propre transport, et ce n'est pas un doublon : la
primitive de délai de la bibliothèque interne (`packages/libs/host-runtime/src/http.ts`)
**remplace** le signal qu'on lui passe par le sien, donc elle ne peut pas porter l'annulation de
l'utilisateur. Ici un seul `AbortController` sert les deux — le minuteur l'interrompt, le signal
de l'appelant aussi —, et ce qui les distingue ensuite est **qui** a tiré.

La requête est interrompue, pas mise en course contre une promesse : une course laisserait la
requête tourner, et un moteur lent garderait une connexion pour une réponse que personne ne lira.
Une interruption qui tombe pendant la lecture du corps est nommée pour ce qu'elle est, pas
`malformed`.

### Le normaliseur — toutes les zones demandées, ou rien

`src/normalize-valhalla.ts`, écrit contre la réponse capturée. Trois faits qu'elle a appris, et
ce que le code en fait :

- Les polygones arrivent **du plus grand au plus petit**, quel que soit l'ordre demandé. Une zone
  est donc rapprochée de sa durée par la propriété `contour` de son entité, **jamais par sa
  position**.
- Chaque entité porte des **propriétés de style** du moteur. Aucune n'est gardée : le
  normaliseur recopie des nombres et des coordonnées, rien d'autre.
- Un point loin de toute voie reçoit des polygones de la taille d'une maille. Ils sont gardés
  comme les autres : le normaliseur lit une forme, il ne juge pas une surface.

Un contour manquant, ou une géométrie qui n'est ni un polygone ni un multi-polygone, rend
`null`, que l'adaptateur rapporte `malformed`. Une réponse partielle dessinée comme si elle
était entière montrerait deux zones là où trois ont été demandées, sans rien à l'écran pour le
dire.

⚠️ **La découpe d'un lot plus long que la limite du fournisseur n'est pas écrite.** Elle arrive
avec ce qui la lit : sans lecteur, ce serait un export sans consommateur.

---

## Le corpus — trois réponses capturées, et ce que chacune tient

Le normaliseur du plugin s'écrit contre ce qu'un moteur répond **vraiment**, jamais contre sa
documentation. Le corpus (`fixtures/`, capturé par `scripts/capture-isochrone-fixtures.cjs`,
**lancé à la main**) est versionné ; aucun test n'appelle un moteur, et le script est absent de
la validation locale comme de la CI.

| Capture                                             | Ce que le moteur a répondu                                                                         | Ce qu'elle tient                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `fixtures/valhalla-isochrone-nominal.json`          | Une réussite : un polygone par durée, servis du plus grand au plus petit, chacun avec son style    | La forme que le normaliseur lit                                                   |
| `fixtures/valhalla-isochrone-off-network.json`      | Une réussite aussi : un point en mer reçoit un polygone par durée, de la taille d'une maille       | Un point hors réseau n'est **pas** un échec — le plugin ne juge pas une géométrie |
| `fixtures/valhalla-isochrone-refused-duration.json` | Un refus : une durée au-delà de ce que l'instance accepte, avec le code numérique propre au moteur | Le seul corps de refus du corpus                                                  |

Chaque fichier est une enveloppe `{ request, status, body }` : le statut y est gardé parce qu'un
refus se définit par lui, et la question telle qu'elle est partie rend la capture rejouable depuis
le fichier seul.

⚠️ **Les deux dernières captures se font pour la réponse ATTENDUE.** Si l'instance répond
autrement — un refus pour le point en mer, une réussite pour la durée —, le script n'écrit rien
et sort en erreur : le jeu d'essai cesserait de tenir ce que son nom annonce.

🛑 **Il n'existe aucun motif d'échec « aucune voie à proximité », et c'est décidé.** Aucun moteur
n'a été vu refusant un tel point : rien ne s'écrit contre une réponse jamais capturée. Re-capturer
le point en mer est le seul geste qui montrerait un moteur se mettant à refuser — c'est ce jour-là
que le motif se rouvre.

Le script n'imprime que l'origine et le chemin d'une URL, jamais sa chaîne de requête.

---

## Configuration

Le plugin lit **une seule branche** du profil, `modules.isochrone`, par `src/config.ts`. Le
schéma de profil nomme ce bloc, ouvert (`profiles/schemas/profile.schema.json`) : ni le cœur ni le
plugin ne signalent une clé inconnue.

| Clé           | Type              | Défaut                                                                                     | Règle                                                                                                              |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `enabled`     | booléen           | `true`                                                                                     | `false` : le plugin reste chargé et n'ouvre rien                                                                   |
| `showButton`  | booléen           | `true`                                                                                     | Lue par le registre du cœur, à travers la `profileKey` du créneau                                                  |
| `provider`    | chaîne            | `"valhalla"`                                                                               | Moteur à interroger. Un nom inconnu est **refusé**, jamais remplacé. Vide ou non textuelle : retombe sur le défaut |
| `endpoint`    | chaîne            | `""`                                                                                       | Adresse du moteur. Vide : celle du fournisseur. Hors `https://` : **refusée**, sans repli                          |
| `timeoutMs`   | nombre            | `10000`                                                                                    | Par requête. Une valeur nulle, négative ou non finie retombe sur le défaut                                         |
| `mode`        | chaîne            | `"car"`                                                                                    | Mode proposé d'abord, parmi `car`, `foot`, `bike`. Inconnu : `car` ; absent de `modes` : le premier proposé        |
| `modes`       | liste             | `["car", "foot", "bike"]`                                                                  | Modes proposés. Un nom inconnu est écarté ; liste vide : les trois                                                 |
| `durations`   | liste de nombres  | `[5, 10, 15]`                                                                              | Minutes proposées : entières, positives, sans doublon, triées. Liste vide : le défaut                              |
| `maxLayers`   | nombre            | `8`                                                                                        | Plafond de zones affichées. Entier, au moins 1                                                                     |
| `zIndex`      | nombre            | `50`                                                                                       | Rang de base des zones parmi les couches du profil                                                                 |
| `palette`     | liste de couleurs | `["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"]` | `#rrggbb`. Toute autre écriture est écartée ; liste vide : le défaut                                               |
| `fillOpacity` | nombre            | `0.25`                                                                                     | Opacité initiale du fond d'une zone, de 0 à 1, bornes comprises                                                    |

**Chaque clé retombe seule sur son défaut.** Une `fillOpacity` mal écrite ne coûte pas au profil
ses `durations`. Le lecteur rend une liste neuve à chaque appel : un appelant ne peut pas
retoucher les défauts.

⚠️ **Deux clés ne sont délibérément pas jugées par le lecteur**, `provider` au-delà de sa forme et
`endpoint`. Un nom de moteur inconnu et une adresse hors `https://` sont des **refus**, et un
refus doit rester visible : les ramener ici à un défaut les cacherait derrière un calcul qui
marche, contre un moteur que personne n'a choisi.

⚠️ **Lues et validées, pas toutes consommées.** À partir de `mode`, ce que ces clés règlent —
les zones sur la carte — n'est pas encore écrit.

🛑 **Un profil est un fichier servi à tout visiteur.** Aucune clé de moteur ne s'y écrit, dans
aucune clé de ce bloc.

---

## Ce que le cœur porte pour lui

Deux lignes, et le cœur ne lit ni l'une ni l'autre : la déclaration de `Isochrone` dans
`GeoLeafGlobal` (`packages/core/src/global.d.ts`), que le plugin type lui-même par
`GeoLeafPluginApis`, et le bloc nommé du schéma de profil. Le cœur ne référence jamais le paquet.
