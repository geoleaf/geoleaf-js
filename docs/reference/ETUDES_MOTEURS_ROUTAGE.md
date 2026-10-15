# GeoLeaf-Js — Ce qui a été examiné et écarté pour le routage, le guidage et les isochrones

> **Version :** 1.1.0 | **Dernière mise à jour :** 15 octobre 2026

**Des arbitrages, avec leur mesure et leur condition de réouverture.** Ce document existe pour une
raison précise : un silence n'est pas un arbitrage. Sans trace écrite, la recherche se refait — et
elle se refait mal, parce que le second passage ne dispose plus des mesures du premier.

Ces études ont décidé de ce que `@geoleaf-plugins/routing` et `@geoleaf-plugins/navigation` sont, et
surtout de ce qu'ils ne sont pas. Elles vivaient jusqu'ici dans deux documents de cadrage internes,
et n'avaient aucun autre domicile. Celles de `@geoleaf-plugins/isochrone` (§7), venues de son cahier
des charges, les ont rejointes le 15 octobre 2026.

> ⚠️ **Chaque chiffre porte sa date et sa commande.** Ils ont été mesurés entre le 7 et le 20 août
> 2026, et les 10 et 11 octobre pour le §7 ; ils **se relancent, ils ne se croient pas**. Un verdict dont on ne peut plus retrouver la
> mesure ne se périme pas — il se fossilise.

---

## 1. La source de données d'un moteur auto-hébergé — Overture Maps écarté

**Décision : alimenter le moteur — Valhalla — en données OpenStreetMap directement.**

Passer par Overture Maps impose d'écrire une conversion vers le format d'ingestion natif du moteur
retenu, avec perte à chaque traduction. Deux difficultés dures y sont concentrées :

- les **propriétés qui ne valent que sur une fraction de tronçon**, qu'il faut redécouper ;
- les **interdictions de tourne**, qu'il faut traduire en relations.

Ce sont précisément les deux choses qui font la qualité d'un itinéraire urbain.

⚠️ **L'avantage de topologie d'Overture n'existe pas face à OpenStreetMap**, dont le modèle référence
déjà des nœuds partagés — il n'existe que face à une couche cartographique brute. Et le thème
transport d'Overture **dérive lui-même** d'OpenStreetMap : la conversion revient au point de départ.

**Condition de réouverture** : s'il fallait fusionner un réseau privé non cartographié avec la base
mondiale sous un schéma unique. Ce cas est absent du périmètre.

---

## 2. Écrire le moteur de guidage, ou adopter Ferrostar

**Décision : écrire le moteur, et rendre le modèle `RouteResult` IDENTIQUE au modèle `Route` de
Ferrostar.** L'identité ne coûte rien à la conception et garde la substitution ouverte.

[Ferrostar](https://github.com/stadiamaps/ferrostar) est le bon candidat : SDK BSD-3-Clause, cœur
Rust compilé en WebAssembly, conçu pour MapLibre GL JS, publié sur npm. Il couvre réellement la
projection, l'hystérésis de sortie et l'avancement d'étape.

**Il est décliné sur un seul motif — le poids — et le rapport honnête n'est pas celui qu'on croit :**

| Terme                                                         |       Mesure |
| ------------------------------------------------------------- | -----------: |
| Cœur Ferrostar tout compris (`.wasm` + colle), gzippé         | **302,3 Ko** |
| Cible du plugin `navigation` qu'il remplacerait               |        45 Ko |
| Défaut silencieux d'un plugin — dénominateur le plus généreux |        60 Ko |

**Soit 6,7 pour 1 contre la cible.** ⚠️ Une rédaction antérieure annonçait **109 pour 1** : un
chiffre juste qui opposait un SDK complet à trois primitives géométriques, lesquelles ne font pas le
même travail. Le motif tient largement, mais il tient à 6,7.

⚠️ **Et la substitution serait partielle** : Ferrostar couvre la machine à états, la projection, la
sortie et la progression — l'interface, la voix, la caméra et le maintien de l'écran resteraient à
écrire de toute façon.

**Trois frictions de build, re-mesurées, dont deux ont faibli** :

1. Le CSP de l'application **bloque WebAssembly** — vu bloquer, dans les deux sens. Le lever coûte
   `'wasm-unsafe-eval'`, une directive **ciblée** et non un affaiblissement global. ⚠️ Ce n'est donc
   plus un motif de premier rang, seulement un coût — et il ferait désormais rougir la gate qui
   compare la politique de sécurité à une politique attendue.
2. Le `.wasm` **échapperait à la gate de budget**, qui ne pèse que les `.js`. Le plus gros artefact
   du dépôt partirait sans qu'aucune gate ne le voie.
3. La chaîne Rollup **ne sait pas le charger**, et le plugin standard n'y suffit pas : la cible
   publiée expose des exports nommés que ce plugin ne rend pas.

**Condition de réouverture** : une cible web sans WebAssembly, ou un poids gzippé sous ~100 Ko. On
en est à plus du triple. ⚠️ **Deux motifs ayant faibli, la réouverture devra se juger sur le POIDS
SEUL** — ne pas rejouer le CSP ni la seconde copie du moteur de rendu, qui ne portent plus la
décision.

---

## 3. Organic Maps — non transposable, et l'obstacle n'est pas l'effort

| Ce qu'est Organic Maps                   | Ce qu'est GeoLeaf                  |
| ---------------------------------------- | ---------------------------------- |
| Application native C++, Apache-2.0       | Bibliothèque TypeScript / ESM, MIT |
| Moteur de rendu propriétaire (OpenGL ES) | MapLibre GL JS                     |
| Format de carte binaire propriétaire     | GeoJSON, tuiles vectorielles       |
| Android, iOS, desktop                    | Navigateur                         |

Les deux piles de rendu sont **mutuellement exclusives**, et il n'existe aucun build web.

Un actif y était tentant : ses chaînes de guidage vocal localisées en 52 langues. **Écartées, et pas
pour la licence** — le fichier français réel est du texte pré-composé, truffé de valeurs nulles sur
toutes les variantes comportant un nom de voie. Et sur le chemin retenu, **aucun fichier de chaînes
n'est nécessaire** : le fournisseur rend le narratif déjà rédigé.

**Ce qu'il en reste n'est pas du code** : la doctrine hors-ligne-d'abord comme invariant produit. Le
réseau est l'exception, pas le cas de base.

---

## 4. Les plateformes SIG complètes — un motif de rejet à retenir pour la suite

Deux projets examinés le 7 août 2026, et **le motif qui les écarte n'est ni le poids ni le rendu** :

- [**geolens**](https://github.com/geolens-io/geolens) est Apache-2.0 — et non MIT comme annoncé —
  et c'est un **backend** : API serveur, base de données spatiale, service de tuiles. Il ne
  rencontre une bibliothèque de navigateur à aucun endroit ;
- [**GeoLibre**](https://github.com/opengeos/GeoLibre) est bien MIT et bien vivant — **et ne publie
  aucun composant**. Six de ses sept paquets sont privés ; le seul publié sur npm est un client
  typé pour l'embarquer dans une iframe. Deux de ses paquets déclarent par ailleurs un
  `peerDependency` sur un framework, quand GeoLeaf est agnostique.

> 🛑 **Un dépôt peut être MIT, actif, excellent — et n'exposer aucune surface consommable.** La
> licence autorise la copie ; l'architecture, elle, ne livre rien.

C'est vérifiable en deux commandes — lister les paquets d'un dépôt, puis lire le champ `private` de
chacun — et **ça tranche avant toute discussion technique**.

> **Mise à jour du 28/09/2026 — le constat de paquets ci-dessus date du 7 août 2026 ; il est
> périmé.** Depuis la 2.7.0 (24/08/2026), `@geolibre/core` et `@geolibre/map` sont publiés sur
> npm, sous MIT. Mais `core` dépend de Zustand, `map` de React 19, de Cesium et de mapbox-gl
> (licence propriétaire), et le paquet qui porte la topologie, `@geolibre/processing`, reste
> privé. **La conclusion tient : aucune surface consommable pour GeoLeaf.** La vérification
> demande désormais une troisième commande, qui lit ce que tire ce qui est publié :
> `npm view @geolibre/map dependencies`.

⚠️ **Ce qu'il en reste vaut d'être lu comme art antérieur** : GeoLibre corrobore de façon
indépendante le choix du moteur de premier rang, avec le même point d'entrée par défaut et le même
motif écrit — un moteur n'ayant pas d'isochrones, celles-ci exigent l'autre, qui sert aussi la
matrice origine-destination. C'est exactement l'appel dont une optimisation de tournée aurait besoin.
**Une convergence n'est pas une preuve** : deux projets peuvent se tromper de la même manière. Elle
vaut comme second avis.

---

## 5. La bibliothèque de tracé d'itinéraire — écartée sur ce qu'elle POSSÈDE

[**`@maplibre/maplibre-gl-directions`**](https://github.com/maplibre/maplibre-gl-directions), MIT et
issue de l'organisation MapLibre elle-même, gère des étapes sur une carte et interroge un
fournisseur compatible. **Deux objections d'origine sont tombées à la mesure** : son poids est de
15,3 Ko gz — au milieu de la distribution des plugins déjà livrés — et le fournisseur de premier rang
parle nativement son dialecte.

**Ce qui l'écarte est structurel** : elle crée et alimente **sa propre source** de données, sans
possibilité de configuration. Elle ne peut donc pas publier par la couture de données du cœur, ce qui
contredit frontalement l'invariant « le tracé n'est pas rendu par les plugins ».

Et l'échappatoire n'en est pas une : la priver de ses couches supprime le rendu **et** l'interaction,
son glisser-déposer testant le pointeur sur ses propres couches. Ce qui resterait — un tableau
d'étapes et un appel réseau — ne justifie aucune dépendance.

⚠️ **Objection neuve et bloquante en l'état** : elle déclare un `peerDependency` sur la version
majeure **précédente** du moteur de rendu, que ce dépôt a quittée. C'est une propriété du manifeste,
pas un comportement observé — et c'est précisément pour ça qu'il faudrait mesurer avant de conclure,
dans un sens comme dans l'autre.

**Ce que cet examen a rapporté, indépendamment de la décision** : la mesure qu'un même format de
réponse peut être demandé aux deux fournisseurs de la phase 1. Le normalisateur cesse d'être deux
adaptateurs divergents.

**Condition de réouverture** : si la manipulation d'étapes **sur la carte** devient un besoin
exprimé. C'est la seule chose qu'elle apporte et que la conception ne prévoit pas.

---

## 6. Les quatre candidats qui n'étaient nommés nulle part

Un balayage de l'offre libre, motivé par un constat : le catalogue de référence ne pouvait pas
répondre. Sa catégorie routage ne contient que des **moteurs serveur**, et sa veille cartographique
n'a aucune occurrence de routage, d'itinéraire ni de guidage.

| Candidat                       | Licence    | Verdict                                | Motif                                                                                                                      |
| ------------------------------ | ---------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Client de routage unifié       | MIT        | 🛑 Décliné                             | **Archivé**, deux ans sans commit. Et il ne rend **aucune manœuvre** — il couvre l'appel réseau, pas la normalisation      |
| Générateur d'instructions OSRM | BSD-2      | 🟡 Réservé à l'adaptateur secondaire   | Actif, français confirmé. Mais **CommonJS**, contre la règle « plugins ESM pur », et redondant avec le premier rang        |
| Outil de guidage navigateur    | —          | 🛑 Décliné                             | Inactif depuis ~2014. Nommé pour une raison unique : **c'est le seul autre qui ait existé**, et l'écrire clôt la recherche |
| Pile auto-hébergeable complète | Apache-2.0 | 📖 Reclassé — référence de déploiement | Ce n'est pas une bibliothèque à consommer, c'est le **patron** du lot d'auto-hébergement, éprouvé à l'échelle planétaire   |

> 🛑 **Le quota du fournisseur public n'est pas une option de production**, et cela déplace un lot du
> confort vers la condition. Sa politique publiée est d'une requête par utilisateur et par seconde,
> avec la mention explicite qu'elle n'est pas utilisable pour un service tiers en production.
> **L'auto-hébergement n'est donc pas un agrément : c'est la condition de mise en service.**

---

## 7. Le plugin isochrone — six arbitrages, et deux réponses du serveur public

`@geoleaf-plugins/isochrone` demande à un moteur les zones atteignables en un temps donné depuis un
point, et les affiche en couches empilables. Ses arbitrages ont été tranchés le 4 octobre 2026, et
les deux qui portent sur le serveur public le 11, après mesure. Ce que le plugin fait se lit dans sa
fiche, [`docs/specs/plugins/CDC_isochrone.md`](../specs/plugins/CDC_isochrone.md) ; ici, ce qui a été écarté, et pourquoi.

### 7.1 Un plugin dédié, et non une extension de `routing`

**Décision : un paquet à lui, chargé au premier clic sur son bouton.**

`routing` est chargé au démarrage de chaque page, parce qu'il possède un point d'entrée dans les
fiches d'objet : y loger la fenêtre des zones ferait payer son poids à toutes les pages. Son contrat
de fournisseur est celui dont dépend `navigation` — l'élargir pour un besoin que tous les moteurs ne
servent pas l'affaiblirait. Et `routing` ne dessine pas, quand un outil d'isochrones possède une
pile de couches. Une capacité du cœur n'était pas une option non plus : elle consommerait le réseau,
pèserait sur le budget de démarrage et lierait le cœur à un backend.

**Ce que le choix coûte** : le moteur se déclare deux fois au profil, une par plugin.

**Condition de réouverture** : si la déclaration unique du moteur devenait une exigence
d'intégrateur.

### 7.2 Le rang d'une couche — une primitive du cœur

**Décision : `IMapAdapter.setLayerZIndex`, membre optionnel qui rend un booléen.**

| Critère                           | Primitive du cœur     | Retirer et reposer         | Couches natives du plugin |
| --------------------------------- | --------------------- | -------------------------- | ------------------------- |
| Changement du cœur                | Un membre public      | Aucun                      | Aucun                     |
| Coût d'un déplacement             | Aucune reconstruction | La source est reconstruite | Aucune reconstruction     |
| Place parmi les couches du profil | Par `zIndex`          | Par `zIndex`               | Décidée par le plugin     |
| Accès natif à la carte            | Aucun                 | Aucun                      | Permanent                 |

Rien dans le dépôt ne changeait le rang d'une couche déjà posée : le manque était celui du cœur.
**Retirer et reposer** reste le repli du plugin quand la primitive refuse, ou qu'un cœur plus ancien
ne l'a pas. ⚠️ Une fois publiée, la primitive ne se retire plus sans version majeure : elle est donc
**étroite par construction** — elle garde son refus des tuiles vectorielles, dont le motif
technique est tombé le 10 octobre 2026, parce qu'un refus se lève dans une mineure sans casser un
appelant, et ne se rétablit pas sans version majeure.
Son contrat se lit dans [`docs/specs/CDC_kernel.md`](../specs/CDC_kernel.md).

### 7.3 La clé d'un moteur — donnée à l'exécution

**Décision : `configure({ endpoint, query })`, jamais le profil.**

Un profil est un fichier servi à tout visiteur. Le relais sur la même origine reste la forme la plus
sûre — la clé ne quitte pas le serveur —, et il ne demande rien au plugin : `endpoint` désigne alors
le relais. Les deux chemins coexistent. Une « porte sans clé » sur le frontal du moteur est écartée :
elle ne sert pas un hôte en production.

### 7.4 La surface — une fenêtre flottante, ni volet ni modale

Régler la transparence d'une zone sans la voir est un réglage à l'aveugle, et le pointage demande une
carte dégagée. Le volet hébergé, sous 1440 px, s'ouvre dans une feuille dont le voile couvre la
carte ; la modale pose ce voile à toute largeur.

**Condition de réouverture** : si la feuille mobile du volet cessait de voiler la carte.

### 7.5 La requête — GET, et non POST

La question tient en une centaine de caractères. En GET, elle est une **requête simple** au sens de
CORS : un aller-retour au lieu de deux, et aucune dépendance au traitement du pré-vol par un frontal
qu'on ne maîtrise pas. POST est la forme de `routing`.

**Condition de réouverture** : si la question grossissait — plusieurs origines, des options de coût
détaillées.

### 7.6 Le crédit de la donnée — affiché par le plugin

L'option `attribution` d'une couche est déclarée au contrat de l'adaptateur et **lue par personne**.
La brancher aurait ouvert, dans le cœur, une chaîne venue d'un profil rendue comme du HTML. Le
plugin écrit donc son crédit lui-même, par `textContent`, tant qu'une zone existe : la donnée routée
l'exige, il ne peut pas dépendre d'un chemin qui n'existe pas.

**Condition de réouverture** : si l'option de l'adaptateur était un jour lue avec un rendu sûr.

### 7.7 Le serveur public — deux réponses mesurées, deux décisions

Mesuré le 10 octobre 2026 sur l'adresse par défaut du fournisseur livré, rejoué le 11.
`scripts/capture-isochrone-fixtures.cjs`, lancé à la main, rejoue les trois questions et versionne
les réponses dans le paquet — dont le point en mer et la durée refusée.

**① Un point loin de toute voie n'est pas refusé.** Deux points en mer reçoivent un **200**, avec un
polygone par durée : une maille de moins de 200 m, centrée sur le point. **Décision : aucun motif
« aucune voie à proximité ».** Rien ne s'écrit contre un refus jamais capturé, et reconnaître la
réponse dégénérée serait juger une géométrie côté client, sur un seuil qu'aucune documentation du
moteur ne donne. Le refus réel d'une autre instance se lit comme tout refus : son statut et le code
du moteur. **Condition de réouverture** : le jour où un tel refus est capturé — re-capturer le point
en mer est le geste qui le montrerait.

**② Le serveur plafonne la durée à 60 minutes**, quand le fournisseur livré en déclare 120 — la
valeur lue dans la configuration d'une instance auto-hébergée. Au-delà, un 400 de code 151 ; un
cinquième contour, un 400 de code 152. **Décision : le fournisseur garde 120.** Il sert aussi toute
instance qu'un intégrateur désigne par `endpoint`, et lui imposer le plafond du serveur de
démonstration obligerait à enregistrer un fournisseur pour la seule raison de dépasser une heure.
Conséquence assumée : sur l'adresse par défaut, une durée de 61 à 120 minutes part et revient
refusée — tard, mais nommée.

---

## Deux acquis réutilisables, indépendants de toutes ces décisions

**La directive WebAssembly ciblée existe et son coût est connu.** Si un besoin apparaît ailleurs —
décodage de tuiles, calcul géométrique lourd — la porte n'est pas fermée.

**Le patron d'une sonde de politique de sécurité, avec son piège.** Une première tentative de mesure
passait par l'évaluation directe dans la page et rendait « tout passe » sur une page qui interdit
pourtant l'évaluation dynamique — un faux négatif complet, le protocole de débogage n'étant pas
soumis à la politique de la page. **Le geste correct** : servir, sur l'origine réelle et par
interception, un document portant la politique à éprouver et un script de **même origine**. Et la
sonde a été **vue mordre dans les deux sens** avant d'être crue.

---

## Fournisseurs écartés d'office — une contrainte d'architecture, pas une préférence

**Mapbox, Google et HERE** sont exclus parce que leurs **conditions d'utilisation imposent
d'afficher les résultats sur leur propre fond de carte**. C'est incompatible avec une bibliothèque bâtie sur un
moteur de rendu ouvert, dont l'intégrateur choisit les fonds.

⚠️ **Cette exclusion ne se lève pas sans réexamen des conditions concernées.** Elle est écrite ici
parce qu'un contributeur qui ajouterait un adaptateur vers l'un d'eux ne trouverait, sinon, rien pour
l'arrêter.
