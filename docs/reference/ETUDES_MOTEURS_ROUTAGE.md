# GeoLeaf-Js — Ce qui a été examiné et écarté pour le routage et le guidage

> **Version :** 1.0.0 | **Dernière mise à jour :** 24 août 2026

**Six arbitrages, avec leur mesure et leur condition de réouverture.** Ce document existe pour une
raison précise : un silence n'est pas un arbitrage. Sans trace écrite, la recherche se refait — et
elle se refait mal, parce que le second passage ne dispose plus des mesures du premier.

Ces études ont décidé de ce que `@geoleaf-plugins/routing` et `@geoleaf-plugins/navigation` sont, et
surtout de ce qu'ils ne sont pas. Elles vivaient jusqu'ici dans deux documents de cadrage internes,
et n'avaient aucun autre domicile.

> ⚠️ **Chaque chiffre porte sa date et sa commande.** Ils ont été mesurés entre le 7 et le 20 août
> 2026 ; ils **se relancent, ils ne se croient pas**. Un verdict dont on ne peut plus retrouver la
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
