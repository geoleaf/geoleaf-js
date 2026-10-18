---
type: spec-plugin
title: isochrone — les zones atteignables depuis un point, demandées à un moteur de routage
plugin_id: isochrone
package: "@geoleaf-plugins/isochrone"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 6d74bc82c
date: 18 octobre 2026
---

# isochrone — les zones atteignables depuis un point, demandées à un moteur de routage

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/isochrone` ·
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
- **Il ne lit pas le GPS de l'appareil lui-même** : « Ma position » passe par la veille du cœur, qu'il
  allume au besoin. Et il ne garde rien d'une page à l'autre.
- **Il ne dépend d'aucun autre plugin**, `routing` compris : les deux parlent au même genre de
  moteur, et aucun des deux n'importe l'autre.

### Ce qui est exclu, et ce qui le rouvrirait

| Exclu                                              | Pourquoi                                                                                           | Ce que le rouvrir demanderait                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Filtrer les couches du profil par une zone         | Avec plusieurs zones empilées, la règle n'est pas décidée : celle du haut, l'union, une par couche | Une conception propre                                                           |
| Garder les zones au rechargement, permalien        | Une zone calculée hier sur un réseau qui a changé est une donnée périmée affichée comme fraîche    | Un format sérialisable et une règle de péremption                               |
| Événements sur le bus                              | Aucun consommateur, et chaque événement se type dans le cœur                                       | Un consommateur réel, puis le typage                                            |
| Durée saisie au clavier, isodistance               | Les durées se déclarent au profil                                                                  | Un champ borné par les limites du fournisseur                                   |
| Régler les zones depuis le gestionnaire de couches | La fenêtre du plugin ne règle que ses propres zones, et elles n'y figurent pas                     | Une source de vérité du rang, que le gestionnaire et l'infobulle liraient aussi |
| Réordonner les couches du profil                   | La primitive du cœur le rend possible ; rien ne l'ouvre ici                                        | La même source de vérité du rang                                                |
| Un calcul côté client, hors ligne                  | Le plugin est le client d'un moteur                                                                | Ne se rouvre pas                                                                |

Les six arbitrages qui ont décidé de la forme du plugin — paquet dédié, primitive du cœur, clé à
l'exécution, fenêtre flottante, GET, crédit affiché par le plugin — et les deux réponses du serveur
public qui ont décidé de ses motifs d'échec se lisent, avec ce qu'ils écartent et leur condition de
réouverture, dans [`docs/reference/ETUDES_MOTEURS_ROUTAGE.md`](../../reference/ETUDES_MOTEURS_ROUTAGE.md), §7.

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

## Chargement — à la demande, au premier clic sur son bouton

L'application livrée l'enregistre dans `apps/geoleaf-app/init.js` par `registerLazy`, et déclare
son créneau de barre d'outils par `registerLazyForAction` : le bouton est dessiné au démarrage,
le bundle n'est téléchargé qu'au premier clic, que le cœur rejoue une fois le plugin chargé. Le
bundle part dans toutes les variantes.

- **Visible par défaut.** Le bouton obéit à `modules.isochrone.showButton` seul — ni
  `gateOnModuleEnabled`, ni drapeau hérité `ui.show*` : c'est ce que déclare `entry.ts`, et
  SLOT-01 (`scripts/check-slot-declarations.cjs`) refuse que les deux déclarations divergent. Un
  profil qui ne dit rien de l'isochrone a donc le bouton.
- **Libellé déclaré dans l'application**, en six langues, aux valeurs du dictionnaire du paquet :
  ce dictionnaire n'est chargé qu'au premier clic, et un libellé inconnu au démarrage ferait du
  nom accessible du bouton la clé brute.
- **Dans la barre de gauche, à toutes les largeurs.** Le créneau ne déclare que le bouton de la
  barre verticale (`mobileIcon`), jamais de `desktopTabButton` : au-delà de 1440 px, le cœur
  range dans la bande de droite tout créneau qui en a un, et le bouton quitterait les outils de
  la carte. Le scénario de bout en bout le mesure à 1600 px.
- **Une icône propre — une horloge.** Le cercle nu est l'icône de `routing`, et les deux boutons
  sont voisins dans la barre.

Chargé **avant** `GeoLeaf.boot()` — une balise `<script>`, comme le README du paquet le montre —,
le plugin déclare lui-même son bouton : sur ce chemin, sa déclaration est la seule.

**Poste de développement.** Si l'amorce locale `connector.local.js` — git-ignorée, présente dans
la seule variante `deploy-local` — pose `window.GEOLEAF_DEV_ISOCHRONE`, `init.js` remet cet objet
à `configure()` à l'évènement `geoleaf:plugin:loaded` du plugin : rien n'est chargé d'avance, et
l'objet n'est jamais journalisé. Le gabarit `apps/geoleaf-app/connector.local.example.js` en
porte un exemple commenté, sans clé.

---

## Les étapes d'`entry.ts`

| Étape                      | Ce qu'elle fait ici                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dictionnaires i18n         | `I18n.registerDict("isochrone", …)`, six langues — **en premier**, sinon les libellés du boot ne résolvent pas                                                                                                |
| Montage du namespace       | `GeoLeaf.Isochrone = buildPublicApi()`                                                                                                                                                                        |
| Auto-enregistrement        | Le manifeste ci-dessus, `healthCheck` sur la présence du namespace                                                                                                                                            |
| Fournisseur livré          | `import "./providers/builtins.js"` — un import d'effet de bord : le moteur livré s'enregistre sans appel que l'hôte devrait se rappeler                                                                       |
| Ré-exports de types        | Les formes du modèle (`src/model.ts`), pour qui écrit son propre fournisseur. Des types seuls                                                                                                                 |
| Module au registre du core | Le **démontage** — zones, marqueurs, crédit et calcul en cours — sur les deux chemins de chargement ; le créneau de barre — `profileKey: "modules.isochrone.showButton"` — sur le seul chemin d'avant le boot |
| Écouteur d'action          | `geoleaf:toolbar:action` → ouverture de la fenêtre, à côté du bouton que l'évènement porte (`detail.element`)                                                                                                 |

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

| Méthode                                   | Rôle                                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getConfig()`                             | La configuration fusionnée et validée                                                                                                                                                                  |
| `configure(overrides)`                    | L'adresse du moteur et les paramètres de requête, pour les calculs suivants. Remplace le réglage précédent **en entier** ; `null` l'efface ; rend `false` et n'applique rien si une valeur est refusée |
| `registerProvider(id, factory)`           | Enregistre un moteur ; un même nom remplace le précédent                                                                                                                                               |
| `getProvider()`                           | Nom et crédit du moteur que le prochain calcul utiliserait, ou `null`                                                                                                                                  |
| `open(anchor?)`                           | Ouvre la fenêtre — une seule —, à côté de `anchor` s'il est donné, et ferme celle des autres outils flottants. Rend `false` si le profil l'a désactivé, `true` une fois ouverte                        |
| `close()`                                 | Ferme la fenêtre et quitte le pointage. Les zones restent, et un calcul en cours aboutit. Sans effet si elle n'est pas ouverte                                                                         |
| `compute({ origin, mode?, minutes? })`    | Calcule les zones depuis `origin` (`[lon, lat]`) et les pose en haut de la pile ; mode et durées par défaut ceux du profil. Rend les identifiants créés, haut d'abord, ou le motif du refus            |
| `getLayers()`                             | Instantané de la pile, ligne du haut en premier. Des copies                                                                                                                                            |
| `setLayerStyle(id, { color?, opacity? })` | Couleur `#rrggbb` ou opacité du fond, de 0 à 1. `false` pour un identifiant inconnu ou une valeur refusée, et rien ne change                                                                           |
| `setLayerVisible(id, visible)`            | Masque ou affiche ; une zone masquée garde sa place                                                                                                                                                    |
| `moveLayer(id, toIndex)`                  | Place une zone à un rang de la liste, `0` en haut — sur la carte aussi, sans nouvelle requête                                                                                                          |
| `removeLayer(id)`                         | Retire une zone ; le marqueur part avec la dernière zone de son origine                                                                                                                                |
| `clear()`                                 | Retire toutes les zones, les marqueurs et le crédit                                                                                                                                                    |

Les membres de pile rendent `false` pour un identifiant inconnu ; aucun n'émet d'événement. Le
pointage n'a pas de membre : seule la fenêtre le déclenche. La surface publiée fait foi dans
`docs/reference/API_SURFACE.txt`, générée.

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

Un lot plus long que la limite du fournisseur est découpé avant l'adaptateur, par `src/compute.ts` :
voir « Le calcul » ci-dessous.

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

La capture nominale sert aussi le **scénario de bout en bout**
(`e2e/87-isochrone-layer-order.spec.js`) : c'est son corps qui répond au moteur simulé, lu dans
le paquet par `scripts/lib/packages.cjs` — le moteur est simulé, sa réponse ne l'est pas.

⚠️ **Les deux dernières captures se font pour la réponse ATTENDUE.** Si l'instance répond
autrement — un refus pour le point en mer, une réussite pour la durée —, le script n'écrit rien
et sort en erreur : le jeu d'essai cesserait de tenir ce que son nom annonce.

🛑 **Il n'existe aucun motif d'échec « aucune voie à proximité », et c'est décidé.** Aucun moteur
n'a été vu refusant un tel point : rien ne s'écrit contre une réponse jamais capturée. Re-capturer
le point en mer est le seul geste qui montrerait un moteur se mettant à refuser — c'est ce jour-là
que le motif se rouvre.

Le script n'imprime que l'origine et le chemin d'une URL, jamais sa chaîne de requête.

---

## La pile et la carte

Deux chaînes, que `src/controller.ts` est seul à relier : la question au moteur, qui ne connaît
pas la carte, et la pile vers l'adaptateur, qui ne connaît pas le réseau. Le contrôleur possède
tout l'état — la pile, l'aire de chaque zone, le calcul en cours.

### La pile — un modèle pur

`src/stack.ts` ne connaît ni la carte ni le réseau, et se teste sans eux.

- **Un lot entre en haut, la durée la plus courte au-dessus.** Les zones d'un point sont
  emboîtées : une plus grande dessinée par-dessus cacherait les autres. Le contrôleur range les
  contours par minute, sans se fier à l'ordre du moteur, qui les rend du plus grand au plus petit.
- **Le rang de la ligne `i` sur `n` vaut `zIndex + (n − i) / (MAX_LAYER_CAP + 1)`**, compté depuis
  le bas : ajouter en haut ne change aucun rang déjà donné. Avec au plus `MAX_LAYER_CAP` zones
  (`src/config.ts`), toutes vivent strictement entre `zIndex` et `zIndex + 1` — d'où la borne de
  `maxLayers`.
- **Une zone prend la première couleur de la palette qu'aucune autre ne porte**, et la garde. Une
  fois toutes portées — palette plus courte que la pile —, la moins portée, la première de la
  palette à égalité.
- Seuls les rangs qui **changent** sont re-posés : une suppression re-range les lignes au-dessus,
  un ajout ne re-range rien.

### La liaison — l'adaptateur, et rien d'autre

`src/map-binding.ts` lit l'adaptateur par `GeoLeaf.Core.getMap()`, à travers une tranche
structurelle locale : la description de l'adaptateur du runtime d'hôte ne type pas les membres
qu'il appelle. Un adaptateur auquel il en manque un se lit comme « aucune carte ». **Aucun accès à
la carte native.**

- 🛑 **Le style est toujours passé ENTIER** — couleur, contour, opacités : l'adaptateur reconstruit
  la peinture de ce qu'il reçoit, et un style partiel rend les couleurs au gris. Le contour reste
  opaque, seule l'opacité du fond se règle.
- **Re-ranger passe par `setLayerZIndex`**, qui déplace sans reconstruire. Quand l'adaptateur
  refuse — ou qu'un cœur trop ancien n'a pas le membre —, la zone est **retirée et reposée** à son
  nouveau rang, mêmes aire, style et visibilité. Les appels se font un par un, et l'ordre final est
  juste : chaque paire de zones est décidée par la dernière des deux à bouger, et l'autre tient
  déjà son rang final.
- **L'ordre est prouvé dans le vrai moteur de rendu** par `e2e/87-isochrone-layer-order.spec.js`,
  sur le bundle livré, sous Chromium et WebKit : l'ordre des zones lu dans la pile de couches de
  MapLibre égale celui des lignes, après un calcul, un déplacement — sans qu'aucune source soit
  recréée —, un réglage, une suppression et un aller-retour de fond de carte.

### Marqueurs et crédit

- `src/origin-markers.ts` : **un marqueur par origine**, partagé par ses zones, retiré avec la
  dernière d'entre elles. Il porte un nom accessible — `isochrone.origin.label`, rôle d'image.
  🛑 **C'est la feuille du plugin qui le dessine** (`.gl-isochrone-origin`) : un disque à la
  couleur du texte principal, cerclé de la couleur de surface — la paire que le thème garde
  opposée, lisible sur tout fond dans les deux thèmes —, qui laisse passer les clics vers la
  carte. Pour une classe sans icône, l'adaptateur construit un élément vide : sans cette
  règle, il mesure 0 × 0, et l'origine est dans le DOM sans se voir — ce fut le cas jusqu'au
  15/10/2026. Le scénario de bout en bout mesure sa taille et sa place.
- `src/attribution.ts` : le crédit s'écrit **par `textContent`** dans le conteneur que l'adaptateur
  fournit, tant qu'une zone existe ; deux moteurs, deux crédits, chacun une fois. L'option
  `attribution` d'une couche n'est pas utilisée : aucun adaptateur ne la lit pour une couche
  GeoJSON.

### Le calcul — refusé avant toute requête, puis tout ou rien

Les refus de `compute()`, **dans cet ordre**, sans qu'aucune requête parte :

| Motif         | Quand                                                                             |
| ------------- | --------------------------------------------------------------------------------- |
| `invalid`     | Origine qui n'est pas une position, mode inconnu, aucune durée, durée non entière |
| `no-map`      | Aucune carte montée                                                               |
| `no-engine`   | Aucun fournisseur utilisable — mêmes refus que `getProvider()`                    |
| `busy`        | Un calcul est en cours ; rien n'est mis en file derrière                          |
| `too-long`    | Une durée dépasse le `maxMinutes` du fournisseur ; `limit` le porte               |
| `cap-reached` | Le lot dépasserait `maxLayers` ; `limit` le porte                                 |

Puis `src/compute.ts` découpe le lot selon le `maxContours` du fournisseur, en requêtes
successives sous **un même signal** ; la première qui échoue termine le lot, et rien n'est gardé.
Les motifs du moteur remontent tels quels — `http` avec son statut et son code. Un fournisseur qui
lève se lit `malformed`. Une carte partie pendant la réponse rend `no-map`, sans rien dessiner.

### Le démontage

`destroyIsochrone()` (`src/isochrone-api.ts`), appelé par le registre des modules du cœur : il
annule le calcul en cours — qui rend alors `aborted` et ne dessine rien —, retire zones,
marqueurs et crédit, puis ferme. Ce que `configure()` a réglé et les fournisseurs enregistrés
**survivent** : ils appartiennent à la page, pas à la carte. `close()`, lui, garde les zones.

---

## La fenêtre

`src/ui/floating-window.ts` : une fenêtre flottante **non modale** (`role="dialog"`, sans `aria-modal`),
posée dans le conteneur de la carte par `openIsochrone()` (`src/isochrone-api.ts`), dans la page
quand aucune carte n'est montée. La carte reste visible et manipulable.

- **Le formulaire** : les modes et les durées du profil, « Placer le point », « Ma position » — le
  chemin sans pointeur —, et « Annuler » pendant un calcul, qui interrompt la requête par
  `cancelComputation()` (`src/controller.ts`). Pendant un calcul ou une recherche de position, les
  deux boutons de calcul sont inactifs.
- 🛑 **« Ma position » lit le GPS du cœur, jamais `navigator.geolocation`** : par
  `requestUserPosition()` de `@geoleaf/host-runtime`, qui rend la position tenue si la veille du
  cœur en a une, et sinon allume le GPS en cliquant le contrôle du cœur — seul chemin de demande
  de permission du dépôt —, puis attend sa première position, 20 s au plus. Le bouton est **caché**
  quand le profil coupe le GPS (`modules.geolocation.enabled: false`). Un refus, un appareil sans
  GPS et une attente trop longue se disent tous « position indisponible » : le cœur ne les
  distingue pour personne. Le GPS reste allumé après le calcul — c'est la veille du cœur, que son
  propre bouton éteint. « Depuis le centre de la carte » a été retiré le 15/10/2026 : le centre ne
  désignait rien pour l'utilisateur.
- **L'état et les échecs** : une ligne d'état (`role="status"`, `aria-live="polite"`) et une ligne
  d'échec (`role="alert"`), toutes deux **hors de la partie repliable**, pour que « cliquez sur la
  carte » reste lu pendant le pointage. Un message par motif (`src/ui/messages.ts`) ; `http` dit
  son statut et, s'il est lisible, son code ; `too-long` et `cap-reached` leur limite ; une
  annulation demandée ne dit qu'« annulé ». Un motif que la fenêtre ne connaît pas se lit comme une
  réponse illisible, jamais « une erreur est survenue ».
- 🛑 **Un Échap, un geste.** La fenêtre porte le seul écouteur d'Échap du paquet : il quitte le
  pointage, sinon abandonne la position cherchée — une position arrivée ensuite ne calcule rien —,
  sinon annule le calcul, sinon ferme la fenêtre — ce dernier geste seulement si le focus
  est dans la fenêtre, pour qu'un Échap destiné à autre chose de la page ne la ferme pas.
- **Repli** : sur sa barre de titre, et de lui-même pendant le pointage, pour rendre la carte au
  clic ; elle se déplie ensuite **comme elle était** — sauf **sur petit écran** (480 px au plus,
  le seuil de la feuille), où elle **reste repliée une fois le point placé**, et **se replie
  une fois « Ma position » obtenue** : dépliée, elle couvrirait le point et les zones demandées. Le focus va alors au bouton de dépli, la partie
  repliée étant cachée. Un pointage quitté sans point la déplie comme avant.
- **Placement et déplacement** : à côté du bouton par `positionMenuNear` du runtime d'hôte, puis
  ramenée sur l'écran avec une marge de 16 px — sur un téléphone, la place à côté de la barre
  d'outils débordait à droite. Déplacée à la souris et au doigt par `wireDrag`/`wireTouchDrag`, qui
  écrivent `--gl-isochrone-top`/`-left` sur la racine. Sa hauteur se borne depuis sa position.
- **Un seul outil flottant à la fois** : l'ouverture s'annonce par `geoleaf:submenu:open`
  (`{ id: "isochrone" }`) — la convention de `measure` et d'`editor` —, et l'annonce d'un autre
  outil la ferme. Les zones restent.
- **Elle suit la pile, quel qu'en soit l'auteur** : elle s'abonne à `onStackChange()` du
  contrôleur, interne au paquet — le plugin n'émet rien sur le bus de l'application. Un appel de
  l'API pendant qu'elle est ouverte se voit dans ses lignes.

### Le pointage — par l'adaptateur, comme le reste (1.0.1)

`src/pick-on-map.ts`. Le clic passe par **l'adaptateur** (`on`/`off("click")`, qui ajoute `latlng`
à l'évènement), et le mode aussi : `enterExclusiveMode("crosshair")` à l'armement,
`exitExclusiveMode()` à la sortie (core 3.17.0, d'où la plage `^3.17.0`). Le premier peint la croix
et garde le curseur trouvé ; tant que le mode tient, un clic n'ouvre la fiche d'aucun objet. Le
paquet n'appelle plus `getNativeMap()` : il ne touche plus la carte native.

- Un clic, un point : le mode se quitte **avant** de rendre l'origine. Un clic sans position finie
  est ignoré.
- **La sortie libère toujours le mode** : les outils s'excluent mutuellement, sans jeton, et quitter
  le pointage ne rend pas le mode à un outil qu'il avait supplanté. Jusqu'en 1.0.0, le curseur et
  le drapeau étaient rendus à leur valeur d'avant ; l'arbitrage du 16/10/2026 a retiré cette
  restauration.
- Sans carte cliquable, le mode est inerte (`active: false`), et la fenêtre le dit plutôt que de
  se croire en pointage. Sur un adaptateur sans les deux membres, le pointage marche, sans croix ni
  garde, et rien n'est écrit à leur place.

### Les lignes

`src/ui/layer-list.ts` : une ligne par zone, haut de la pile d'abord — poignée, couleur, libellé
« durée · mode », visibilité, ▲, ▼, supprimer, et la transparence sous le libellé. Chaque
contrôle porte un nom qui inclut le libellé de sa ligne.

- **Les boutons d'abord, le glisser en confort.** ▲ ▼ servent le clavier, le doigt et le lecteur
  d'écran ; aux extrémités ils sont **désactivés**, pas masqués. Le glisser — HTML5, par la
  poignée — appelle le même déplacement.
- **Le focus suit la ligne déplacée** — sur le même bouton, sur l'autre quand la ligne atteint une
  extrémité —, et sa nouvelle place est annoncée. Après une suppression, il va à la ligne qui a
  pris la place ; sans ligne restante, à « Placer le point ».
- 🛑 **La liste est mise à jour, jamais reconstruite** : les lignes sont gardées par zone et
  déplacées en place ; un contrôle qui a le focus n'est pas réécrit, et les réglages de couleur et
  de transparence partent **une fois par image**.

### Libellés

Six dictionnaires plats sous `src/lang/`, mêmes clés. Toute clé est écrite en **littéral** à
l'appel : `src/__tests__/lang-catalogue.test.ts` trouve les clés en lisant les sources, et exige
de chaque langue chaque clé lue, aucune clé morte, aucun libellé vide, et les mêmes paramètres
`{nom}` que le français.

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
| `maxLayers`   | nombre            | `8`                                                                                        | Plafond de zones affichées. Entier, de 1 à 99                                                                      |
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

`mode`, `modes` et `durations` règlent ce que la fenêtre propose — le mode coché, les modes
offerts, les durées, toutes cochées à l'ouverture ; les autres clés règlent les zones que
`compute()` dessine.

🛑 **Un profil est un fichier servi à tout visiteur.** Aucune clé de moteur ne s'y écrit, dans
aucune clé de ce bloc.

---

## Limites de la v1

| Limite                                                                    | Ce qu'elle coûte                                                                                                              | Pourquoi elle reste                                                                                   |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Les zones ne survivent pas à un rechargement                              | Un rechargement repart d'une carte nue                                                                                        | La règle de péremption n'est pas décidée                                                              |
| Au-delà de trois zones, la couleur seule n'identifie plus                 | Le libellé de la ligne fait foi                                                                                               | Une propriété des fonds translucides emboîtés ; le contour, opaque, et la pastille portent la couleur |
| Une clé refusée peut se lire comme une panne réseau                       | Le message `network` couvre les deux                                                                                          | Hors de portée du navigateur quand le refus ne porte pas d'en-tête CORS                               |
| Un premier clic hors ligne n'ouvre rien                                   | Le bundle n'est pas dans le pré-cache du service worker, que la seule clôture de démarrage alimente : il ne se télécharge pas | Le plugin n'a pas d'usage sans réseau                                                                 |
| Un point hors réseau rend une zone minuscule, sans message                | Rien ne dit que le point est loin de toute voie                                                                               | Aucun refus de ce genre n'a été capturé, et le plugin ne juge pas une géométrie                       |
| Le rang affiché par le gestionnaire de couches n'est pas celui d'une zone | Sans objet aujourd'hui : les zones n'y figurent pas                                                                           | La primitive ne réécrit pas le rang déclaré — voir la fiche du noyau                                  |

La palette par défaut a été contrôlée le 10/10/2026, en écart de couleur OKLab et sous daltonisme
simulé : ses trois premières couleurs se distinguent deux à deux, pas au-delà, et l'ocre passe sous
le contraste attendu d'un élément graphique sur un fond clair. C'est ce que la deuxième limite écrit.

---

## Sécurité et données

- **Ce qui part chez le moteur** : le point d'origine, le mode et les durées. Un point posé sur la
  carte est un choix de l'utilisateur ; **« Ma position » envoie sa position GPS** — c'est le geste
  qu'il fait. Le choix du moteur relève de l'intégrateur, la responsabilité de ce traitement aussi.
  Rien n'est stocké, aucun historique n'est constitué, aucune télémétrie.
- **HTTPS seul** : une adresse hors `https://` est refusée, jamais corrigée (voir « L'adresse qui
  s'applique »).
- **CORS est à la charge du moteur.** La requête est simple, sans pré-vol ; la politique de sécurité
  de l'application livrée autorise déjà toute connexion en HTTPS.
- **La réponse du moteur est une entrée externe.** Le normaliseur n'en garde que des nombres et des
  coordonnées ; d'un refus, deux nombres. Aucun texte du moteur n'est affiché, aucun HTML n'est
  écrit : le crédit passe par `textContent`, et l'icône du bouton est une chaîne du paquet, assainie
  par le cœur.
- **La clé** : voir « Les réglages d'exécution ».

---

## Ce que le cœur porte pour lui

Deux lignes, et le cœur ne lit ni l'une ni l'autre : la déclaration de `Isochrone` dans
`GeoLeafGlobal` (`packages/core/src/global.d.ts`), que le plugin type lui-même par
`GeoLeafPluginApis`, et le bloc nommé du schéma de profil. Le cœur ne référence jamais le paquet.
