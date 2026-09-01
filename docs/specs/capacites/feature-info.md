---
type: spec-capacite
title: feature-info — le rendu attributaire, et ses trois surfaces
capability_id: feature-info
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 2fcbba8a
date: 1er septembre 2026
---

# feature-info — le rendu attributaire, et ses trois surfaces

**Type :** capacité in-core · **Code :** `packages/core/src/capabilities/feature-info/` ·
**Vérifié contre :** `2fcbba8a` (01/09/2026) — ⚠️ cette ligne portait `6238592c` (02/08/2026)
alors que le frontmatter était passé à `817af7a0` : la re-vérification avait mis à jour l'en-tête
YAML seul. Un lecteur y lisait la fiche pour **plus périmée qu'elle n'est**.

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **Son CDC source s'appelle `CDC_plugin-feature-info.md`, et ce nom est trompeur.**
> `feature-info` **est une capacité in-core** depuis sa reclassification : le paquet
> `@geoleaf-plugins/feature-info` est supprimé, il n'y a ni `entry.ts`, ni manifeste, ni
> `package.json`. La fiche vit donc ici et non dans `specs/plugins/`.

---

## Périmètre

### Ce que la capacité fait

Elle est la **source unique** du rendu de données attributaires. Elle écoute deux signaux du kernel —
survol et clic sur une entité — et peint les propriétés de cette entité sur **trois surfaces** :
une infobulle qui suit le curseur, une bulle ancrée à la coordonnée, et un panneau latéral. Ce qui
s'affiche est déclaré **par couche**, sans code.

### Ce qu'elle ne fait pas

- **Elle ne détecte pas les entités.** Le kernel émet les deux signaux ; la capacité s'y abonne. Elle
  n'installe aucun écouteur sur la carte.
- **Elle émet TROIS signaux, et cette ligne n'en annonçait qu'un.** `geoleaf:popup:action` au clic
  d'un bouton d'action déclaré, plus `geoleaf:poi:panel:open` et `geoleaf:poi:panel:close` depuis le
  13/08/2026 — la paire du panneau latéral était **typée sans émetteur** depuis l'origine, et c'est
  l'émetteur qui a été branché, pas la clé qui a été retirée. Détail et canaux : §Événements.
- **Elle ne dépend pas de `@geoleaf/field-renderer`.** Le moteur de rendu a été réécrit autonome ;
  la lib n'est plus une dépendance du core.
- **Elle n'importe pas MapLibre.** La bulle est une `maplibregl.Popup` atteinte **par le global
  runtime**, jamais par un import statique.

---

## Fonctionnalités

| ID    | Fonctionnalité                                       | Entrée                                   | Sortie observable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Code                                                    |
| ----- | ---------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| FE-01 | Abonnement aux deux signaux du kernel                | `geoleaf:feature:click` · `:hover`       | Écouteurs **persistants** (pas `{ once }`), attachés à `init()` et détachés au démontage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `lifecycle.ts`                                          |
| FE-02 | Gate tardif **par événement**                        | Chaque clic, chaque survol               | La configuration est relue **à chaque événement** ; éteindre la capacité en cours de session prend effet au geste suivant                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `lifecycle.ts` → `onFeatureClick` / `onFeatureHover`    |
| FE-03 | Charge utile validée avant tout rendu                | Événement forgé ou incomplet             | Sans `layerId` de type chaîne, l'événement est ignoré — avant toute lecture de configuration de couche                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `lifecycle.ts`                                          |
| FE-04 | Résolution de la déclaration **par couche**          | `layerId`                                | Lecture du bloc racine `attributes` par le seam runtime du kernel. ⚠️ Les **quatre** raisons de ne rien peindre sont distinctes et NOMMÉES — seam absent, couche inconnue, aucune déclaration, surface éteinte —, là où c'était **un seul `null` muet** jusqu'au 02/08. 🛑 Mais **aucune n'est journalisée** : le type `BindingAbsence` les rend distinguables et `convert.test.js` les asserte une par une, tandis que les trois surfaces se contentent de ne rien peindre. Le TSDoc de `convert.ts` dit « so the runtime log CAN say which one happened » — la possibilité, pas le geste | `layer-config-seam.ts`, `convert.ts`                    |
| FE-05 | Normalisation du modèle d'entité                     | Sac de propriétés MapLibre               | Un modèle `{ properties, attributes }` construit que le sac arrive **plat**, **niché**, ou avec les attributs en **chaîne JSON**                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `resolve.ts`                                            |
| FE-06 | Chemins pointés résolus, avec repli plat             | `properties.Name`, `attributes.photo`    | La déclaration écrite avant l'extraction rend à l'identique quelle que soit la forme d'arrivée du sac                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `resolve.ts` → `resolvePath`                            |
| FE-07 | Infobulle en mode **sûr**                            | Survol, phase de déplacement             | Aucun `<a>`, aucun `<button>`, aucune galerie interactive. Les types interactifs sont **dégradés en texte**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `surfaces/tooltip.ts`, `render/popup-content.ts`        |
| FE-08 | Une seule infobulle, celle du dessus                 | Couches superposées                      | La couche au plus haut rang l'emporte ; les autres ne peignent pas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `surfaces/tooltip.ts`                                   |
| FE-09 | Bulle ancrée à la **coordonnée**                     | Clic                                     | Elle suit la carte au déplacement et au zoom, et se retourne pour rester visible — parce que c'est une bulle **native**, pas un `div` positionné                                                                                                                                                                                                                                                                                                                                                                                                                                           | `surfaces/popup.ts`                                     |
| FE-10 | Panneau latéral autonome                             | « Voir plus », ou appel direct           | Un tiroir ajouté au corps du document, sans aucune dépendance de namespace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `surfaces/sidepanel.ts`                                 |
| FE-11 | Piège de focus dans le panneau                       | Tabulation                               | Le focus reste dans le tiroir tant qu'il est ouvert                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `surfaces/sidepanel.ts`, `utils/controls/focus-trap.ts` |
| FE-12 | Fermeture au clavier et au clic extérieur            | Échappement, clic hors panneau           | Les deux écouteurs sont posés à l'ouverture et **retirés** à la fermeture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `surfaces/sidepanel.ts`                                 |
| FE-13 | **Une** liste de champs, chacun nommant ses surfaces | `attributes.fields[].display.surfaces`   | Un champ apparaît sur une surface **si et seulement si** il la déclare. ⚠️ **Il n'y a plus ni mode `"all"` ni repli implicite** : une couche qui ne déclare rien ne peint rien. Les trois surfaces portaient chacune leur PROPRE repli, tous différents — voir §Ce qui a été retiré                                                                                                                                                                                                                                                                                                        | `attributes-binding.ts`, `convert.ts`                   |
| FE-14 | **Tous** les widgets déclarés sont rendus            | `attributes.fields[].widget`             | ✅ **Aucun muet.** Le contrat en déclare 24, le moteur en rend 24, et une **gate de parité** confronte les trois déclarations — contrat TS, schéma JSON, table de rendu. `date`, `url` et `email` ROUTENT (Q4) ; `action` rend sur les **deux** surfaces interactives                                                                                                                                                                                                                                                                                                                      | `render/widget-dispatch.ts` → `WIDGET_RENDERERS`        |
| FE-15 | Variantes héritées normalisées                       | `variant: hero \| title \| multiline`    | Traduites en couple type/style par le moteur, pour que les déclarations d'avant l'extraction rendent à l'identique                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `render/fields.ts`                                      |
| FE-16 | Image d'en-tête hors du corps                        | `display.presentation.hero`              | Le corps courant est vidé et refermé avant d'insérer l'image — sinon elle serait imbriquée dans le flux des champs                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `render/popup-content.ts`                               |
| FE-17 | Badges regroupés                                     | Plusieurs `type: "badge"`                | Rassemblés dans un conteneur unique plutôt qu'égrenés                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `render/popup-content.ts`                               |
| FE-18 | Glyphe de catégorie **avant le titre**               | Options de rendu de `taxonomy`           | Le glyphe est injecté avant le titre des trois surfaces, **opt-in**, par seam runtime. Sans les options, rien ne change                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `render/dom.ts` → `resolveTitleIcon`                    |
| FE-19 | Visionneuse d'images, annoncée comme **modale**      | `type: "gallery"`                        | Ouverture au clic, sur la surface panneau. Depuis le 17/08/2026 elle porte `role="dialog"`, `aria-modal="true"` et un `aria-label` localisé (`aria.lightbox.title`, déjà présent dans les six dictionnaires), et elle **rend le focus** au déclencheur à la fermeture. ⚠️ Elle se COMPORTAIT en modale — piège de focus, fermeture à l'échappement — sans jamais l'annoncer, et la restitution du focus s'annulait elle-même : le déclencheur était mémorisé PUIS `close()` l'effaçait, à la ligne suivante. Gardé par `__tests__/capabilities/feature-info/lightbox-a11y.guard.test.ts`   | `render/lightbox.ts`                                    |
| FE-20 | Sections repliables du panneau                       | `presentation.accordion` / `defaultOpen` | Un `<details>` par champ marqué, ouvert ou non selon la déclaration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `render/sidepanel-content.ts`                           |
| FE-21 | Ouvrir le panneau ferme la bulle                     | « Voir plus »                            | Les deux ne coexistent pas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `surfaces/popup.ts`                                     |
| FE-22 | Démontage des **trois** surfaces                     | `FeatureInfoModule.destroy()`            | Écouteurs détachés, puis infobulle, bulle et panneau détruits — les trois, pas seulement celui qui est ouvert                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `lifecycle.ts` → `_reset`                               |

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/feature-info/`, plus un
test-garde de structure sous `__tests__/guards/`.

⚠️ **Il n'y a PAS de `feature-info-capability.test.js`**, contrairement à [`legend`](legend.md) et
[`filter`](filter.md) qui en ont un. La déclaration et son `configSchema` ne sont donc assertés que
par les gardes transverses — dont celui de cette fiche.

---

## Configuration

Bloc `modules.feature-info` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre | Type      | Défaut | Où c'est lu                                                                                                           |
| --------- | --------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| `enabled` | `boolean` | `true` | `config.ts` → `getFeatureInfoConfig()`, relu **à chaque événement** par `lifecycle.ts` et par l'API publique. Opt-out |

**C'est le seul paramètre de niveau capacité, et c'est délibéré** : tout le reste est déclaré **par
couche**, pas globalement.

### La vraie surface de configuration est ailleurs — et elle est par couche

Le bloc racine **`attributes`** de la config de couche, lu par le seam
`GeoLeaf.GeoJSON.getLayerConfig(id)`. Types : `packages/core/src/contracts/attributes.contract.ts`.

⚠️ **Cette table n'est PAS gatée** par le garde de cette fiche : il ne lit que le `configSchema` de
la capacité, qui ne porte qu'`enabled`. L'en-tête dit `Sous-clé` et non `Paramètre` pour cette raison
exacte — c'est ce mot qui décide quelle table est lue. La couverture de ces clés relève du schéma de
couche et de `scripts/check-config-coverage.cjs`, pas d'ici.

| Sous-clé     | Type                    | Rôle                                                           |
| ------------ | ----------------------- | -------------------------------------------------------------- |
| `titleField` | `string`                | Chemin du champ dont la valeur titre la bulle et le panneau    |
| `fields`     | tableau de descripteurs | La liste **unique** — chaque champ nomme lui-même ses surfaces |

Un descripteur porte `field`, `label`, le couple `primitive` + `widget`, un bloc `options` propre au
widget, et **deux** blocs : `display` (lecture) et `edit` (saisie). `display` porte `surfaces`,
`mode` et `presentation`.

⚠️ **Un troisième bloc `uses` a existé du 02/08 au 06/08/2026, puis a été RETIRÉ** — il liait le
champ aux cinq sous-systèmes secondaires (tableau, recherche, filtre, permalien, étiquette). Motif
du retrait : il **ajoutait** une 4ᵉ liste de noms de champs sans en remplacer aucune, et deux de
ses cinq cibles ne nomment aucun champ de couche. Décision **A3‴** de
la feuille de route de collecte hors ligne (interne).

⚠️ **La liste plate de tous les champs déclarés est un rapport GÉNÉRÉ** —
[`MODELE_ATTRIBUTAIRE.md`](../../reference/MODELE_ATTRIBUTAIRE.md), gaté par `ci:local`. Elle ne se
recopie pas ici : une vue dérivée ne peut pas diverger, une copie si.

#### ✅ Le bloc legacy est SUPPRIMÉ — bascule du 02/08/2026

`capabilities.feature-info` n'existe plus : ni dans les 48 configs, ni dans le schéma de couche, ni
dans le code hors du chemin de compatibilité que `getConfig` expose encore. **18 couches, 86 champs**
migrés en une bascule sèche (Q8) — les 124 descripteurs d'origine dédupliqués par chemin, puisqu'un
même champ déclaré sur trois surfaces était trois entrées et n'en est plus qu'une.

| Bloc legacy                                                | Successeur                                             |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| `capabilities.feature-info.titleField`                     | `attributes.titleField` — et il est **enfin LU**       |
| `.tooltip` / `.popup` / `.sidepanel`                       | un seul `attributes.fields[]`, avec `display.surfaces` |
| descripteur `type`                                         | le **couple** `primitive` + `widget`, en liste blanche |
| descripteur `style` / `variant` / `accordion`              | `display.presentation`                                 |
| descripteur `format` / `listStyle` / `iconId` / `linkText` | rien — **aucun n'était lu**, tous supprimés            |

**Trois différences de fond**, pas de forme :

1. **Le bloc legacy n'était validé par rien** — il vivait sous `capabilities`, qui était
   `additionalProperties: true`. Une faute de frappe y passait en silence. `attributes` est strict.
2. **Une surface se déclare champ par champ**, au lieu de trois listes de formes différentes qu'il
   fallait tenir parallèles à la main.
3. **Le mode `"all"` a disparu** — voir ci-dessous.

#### ✅ Le mode `"all"` est RETIRÉ, et il en cachait TROIS autres

⚠️ **Ce n'était pas un mode parmi d'autres : c'était un contournement complet du contrat.** La
résolution traitait `"all"`, `undefined` **et** `null` par la même branche — donc une couche qui
**omettait** une surface exposait tout son GeoJSON, identifiants techniques et colonnes de travail
compris, sans que personne l'ait demandé. Un mode nommé qui se déclenche par le silence.

🛑 **Et les trois surfaces portaient chacune leur PROPRE repli, hors de cette branche et différent
des deux autres** : la bulle listait toutes les propriétés, l'infobulle prenait la **première clé**,
le panneau listait tout puis **écartait tout** plus bas — un champ sans widget était sauté avant le
dispatch. C'est pourquoi le seul profil du dépôt qui écrivait `"all"` explicitement, sur le panneau,
rendait **un corps vide**. Quatre implémentations d'une même idée, dont aucune ne s'accordait.

**Coût de migration MESURÉ avant de décider** :

| Situation                                             | Couches                                      | Traitement à la bascule                                                |
| ----------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| `"all"` écrit explicitement                           | **1** surface (`reference-points.sidepanel`) | déclarée en clair — et c'est une **correction** : elle ne rendait rien |
| Bloc présent, une surface **omise** (repli implicite) | **9** couches, **14** surfaces               | héritent de la surface déclarée la plus riche                          |
| **Aucun** bloc                                        | **30**                                       | **aucun** — elles n'entrent jamais dans le chemin de rendu             |

⚠️ **C'étaient donc 9 couches et 14 surfaces, pas 30.** Le chiffre a divisé le coût par trois, et
c'est lui qui a rendu la bascule sèche tenable en un commit.

### Le gate est opt-out, et il s'applique à trois endroits

| Étage                      | Ce qu'il commande                  | Quand il s'évalue                       |
| -------------------------- | ---------------------------------- | --------------------------------------- |
| Gate de la capacité        | L'enregistrement du module         | Au démarrage, avant la fusion du profil |
| **Gate par événement**     | Le rendu d'un clic / d'un survol   | **À chaque geste utilisateur**          |
| **Gate de l'API publique** | `openPopup()` et `openSidePanel()` | À chaque appel programmatique           |

⚠️ **Le second étage est une singularité du dépôt.** Ailleurs le gate tardif s'évalue **une fois**,
au montage. Ici il s'évalue à chaque événement, ce qui rend la capacité extinguible **à chaud**.
`close()`, en revanche, n'est **pas** gaté — fermer ce qui est ouvert reste possible quel que soit
l'état de la clé, et c'est le bon choix.

---

## Contrat exposé

### API publique — `GeoLeaf.FeatureInfo`

Construite par `public-api.ts` → `buildPublicApi()`, montée par `install.ts`, et **instanciée à
l'import** par la façade ESM.

| Membre                           | Rend / fait                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isEnabled()`                    | Le gate                                                                                                                                                                                                                                                                                                                                                                                            |
| `close()`                        | Ferme la bulle **et** le panneau. **Non gaté**                                                                                                                                                                                                                                                                                                                                                     |
| `openPopup(detail, layout?)`     | Ouvre la bulle pour une entité. Gaté                                                                                                                                                                                                                                                                                                                                                               |
| `openSidePanel(detail, layout?)` | Ouvre le panneau. Gaté                                                                                                                                                                                                                                                                                                                                                                             |
| `getConfig(layerId)`             | La déclaration **héritée** `capabilities.feature-info` de la couche, ou `null`. **Non gaté** — c'est une lecture. ⚠️ Elle ne lit **PAS** le bloc racine `attributes`, qui est la forme canonique : sur une couche migrée elle rend `null`, et plus aucune configuration de couche livrée ne porte le bloc hérité — `grep -rl '"capabilities"' $(find profiles -name '*_config.json')` ne rend rien |

⚠️ **Le nom de fichier de la façade est `packages/core/src/api/geoleaf.featureinfo.ts`, sans tiret**, alors que
l'identifiant de la capacité est `feature-info`. C'est la seule façade du dépôt dont le nom ne se
dérive pas de son identifiant ; le savoir évite de la chercher là où elle n'est pas.

### Événements

| Signal                  | Sens       | Rôle                                                                                         |
| ----------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `geoleaf:feature:click` | **écouté** | Ouvre la bulle. Écouteur **persistant**. ⚠️ **Un geste = un événement** — voir sous la table |
| `geoleaf:feature:hover` | **écouté** | Ouvre ou déplace l'infobulle. Écouteur **persistant**                                        |

**Trois signaux émis**, et ils ne partent pas par le même canal :

| Signal                    | Émis par                                                  | Canal                                                         |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| `geoleaf:popup:action`    | `render/widget-dispatch.ts`, au clic d'un bouton d'action | `CustomEvent` **brut** — la clé vit dans `GeoLeafRawEventMap` |
| `geoleaf:poi:panel:open`  | `surfaces/sidepanel.ts` → `openSidePanel()`               | `dispatchGeoLeafEvent`, bus assaini                           |
| `geoleaf:poi:panel:close` | `surfaces/sidepanel.ts` → `closeSidePanel()`              | `dispatchGeoLeafEvent`, bus assaini                           |

⚠️ **La paire du panneau était TYPÉE SANS ÉMETTEUR depuis l'origine** : un intégrateur qui s'y
abonnait écrivait du code qui compile et ne part jamais. L'arbitrage a été de **brancher l'émetteur**
plutôt que de retirer la clé — retirer une interface publiée est une rupture majeure, tandis que
brancher n'ajoute que de la surface. `poiName` se résout par le MÊME chemin que le titre affiché, donc
le nom porté par l'événement est par construction celui que l'utilisateur lit.

🛑 **Deux silences sont délibérés, et ils s'expliquent l'un l'autre.** ① Rien n'est émis quand
`featureId` est absent : `poiId` est déclaré `string` dans une interface publiée, et forger un
identifiant rendrait deux entités sans identifiant indiscernables chez l'abonné. ② `destroySidePanel()`
n'émet **pas** de fermeture : c'est un démontage, pas une fermeture, et il se produit pendant que les
abonnés sont eux-mêmes détachés — l'état `_openPoiId` est néanmoins remis à zéro, faute de quoi la
prochaine paire ouverture/fermeture nommerait une entité périmée.

### ✅ Un geste = UN événement — garanti par le kernel depuis le 13/08/2026

Le kernel garantit désormais qu'**un clic sur une entité émet exactement un
`geoleaf:feature:click`**, quelle que soit la géométrie et quel que soit le nombre de
sous-couches qui la rendent. Cette capacité peut donc traiter chaque événement comme un geste.

⚠️ **Ce n'était pas vrai avant, et c'est cette capacité qui en portait le symptôme.** Le kernel
liait le clic à **toutes** les sous-couches d'une couche, là où il ne liait le survol qu'à une
seule. Comme les sous-couches s'empilent par géométrie et cumulativement, un seul clic émettait
**2** événements sur un point à icône, **2** sur une ligne à casing, **3** sur un polygone à
casing et **4** sur une tuile vectorielle. `surfaces/popup.ts` ferme puis rouvre la bulle à
chaque événement : l'utilisateur la voyait **clignoter**, et le second rendu écrasait le premier
pour la même entité.

⚠️ **Ce que la garantie coûte, et qu'il faut connaître avant de s'en étonner** : le clic et le
survol partagent maintenant la même précédence (`fill` → `circle` → `line` → toutes), donc la
sous-couche `-symbol` d'un point à icône n'est plus liée. **Aucune entité ne devient
inatteignable** — tout point porte inconditionnellement sa sous-couche `-circle` —, et rien
n'est perdu sur les axes. Seul l'anneau diagonal de la boîte de collision de l'icône sort de la
zone cliquable, dont l'essentiel est le `icon-padding` transparent.

### ✅ `geoleaf:popup:action` — promis longtemps, émis depuis le 29/07/2026

Le signal est **typé** au contrat et enseigné à trois endroits publiés. Il n'était **jamais émis** :
la boucle de rendu **écartait** les champs `action`, avec le commentaire « les champs d'action sont
abandonnés ». Un intégrateur qui en déclarait un n'obtenait ni bouton, ni événement, ni
avertissement — soldé.

⚠️ **Ce n'est pas le rendu qui bloquait, c'était la charge utile.** Le contrat promet `featureId` et
`lngLat` ; le contexte de rendu ne portait que `layerId`. Les deux valeurs existaient pourtant dans
le détail du clic — il ne manquait que le fil. C'est ce qui explique un abandon qu'aucune décision
n'a jamais actée.

🛑 **Et le fil n'a été tiré que sur UNE des deux surfaces, ce qui ne s'est vu que le 14/08/2026.**
`surfaces/popup.ts` passait les trois champs ; `surfaces/sidepanel.ts` s'en tenait au `layerId`.
Le widget `action` vivant dans la table de dispatch **partagée**, il rend sur les deux : une action
cliquée dans le panneau a donc émis `featureId: null` et aucun `lngLat` pendant seize jours, sous
un paragraphe qui déclarait le point réglé. **Une réparation asymétrique se lit comme une
réparation** — et aucune gate ne distingue les deux, l'invariant « les deux surfaces reçoivent le
même contexte » n'ayant jamais été posé. Comblé depuis.

#### Le detail depuis le 14/08/2026 — il n'est plus sérialisable

Trois membres s'ajoutent aux cinq champs de données : **`button`** (le nœud cliqué),
**`setBusy(busy)`** (pose `disabled`, `aria-busy` et `gl-poi-popup__action--busy`) et
**`close()`** (ferme la surface du bouton, **jamais les deux**). Ce sont les trois que
`Popup.registerActionHandler` offrait avant qu'**ADR-07** ne le retire.

Conséquences, dans l'ordre où elles mordent :

- la clé vit dans **`GeoLeafRawEventMap`** et s'émet en `CustomEvent` nu — par le bus assaini,
  `button` arriverait en `{}` et les deux fonctions en `undefined`, **sans erreur** ;
- `JSON.stringify(e.detail)` **jette** désormais (référence circulaire), et `postMessage` rend un
  `DataCloneError`. C'est la seule rupture observable, et elle est au CHANGELOG en `Changed` ;
- **les abonnés typés ne bougent pas** : `Events.on/off/once` accepte les clés des deux cartes ;
- `close()` arrive par **injection** (`RenderContext.onClose`), jamais par import : le graphe est
  `surfaces/* → popup-content → widget-dispatch`, et c'est aussi la seule façon de fermer la
  **bonne** surface. `FeatureInfo.close()` ne pouvait pas servir — il ferme les deux et émet un
  `geoleaf:poi:panel:close` que personne n'a effectué ;
- **élargissement de surface d'attaque, assumé** : n'importe quel script de la page peut désormais
  appeler `close()` ou `setBusy()`. Acceptable — il peut déjà faire
  `document.querySelector(".gl-poi-popup__action").click()` — mais **dit**.

Deux demandes du CDC amont §4.1 sont **refusées** : `waitUntil` (il n'y a rien à prolonger —
`setBusy` + `close` couvrent le besoin, et la sémantique dépendrait de MapLibre, le popup se
fermant aussi sur clic carte et sur `Escape`) et `lngLat` en tuple `[number, number]` (le detail
porte `{lat, lng}`, comme `geoleaf:feature:click` — changer la forme sous la même clé serait une
rupture silencieuse).

| Champ de configuration   | Effet                                                             |
| ------------------------ | ----------------------------------------------------------------- |
| `actionId`               | Identifiant **opaque au core**, émis tel quel                     |
| `label`                  | Texte du bouton                                                   |
| `requiresPlugin`         | Le bouton **n'est pas rendu** si le plugin nommé n'est pas chargé |
| `confirm` / `confirmKey` | Confirmation avant émission                                       |
| `payloadFields`          | **Liste blanche** des propriétés jointes                          |

⚠️ **Sans `payloadFields`, AUCUNE propriété n'est jointe.** Le défaut va vers la confidentialité,
pas vers la commodité : le contrat qualifie cette liste de « perf + privacy », et un défaut « tout
envoyer » ferait fuiter le sac de propriétés complet dans un événement de document que **n'importe
quel script de la page** peut écouter.

### Stockage écrit

Aucun. Les trois surfaces sont éphémères et ne survivent pas au rechargement.

---

## Décisions de conception

| Décision                                                | Pourquoi                                                                                                                                                                                     | Alternative écartée                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Reclassée capacité in-core, depuis un plugin publié** | Le rendu attributaire est quasi universel : le rendre optionnel obligeait chaque profil à embarquer un paquet. Le lien devient typé, et le gate remplace la présence du paquet               | Rester `@geoleaf-plugins/feature-info`     |
| **Source unique et exclusive du rendu attributaire**    | Le rendu vivait en double — au core pour les POI, au plugin pour le reste. La duplication a été supprimée du core, pas dépréciée : deux moteurs auraient divergé au premier correctif        | Garder un moteur de repli au core          |
| **Moteur de rendu autonome**                            | Il dépendait de `@geoleaf/field-renderer`. L'absorber a permis de retirer cette dépendance du core — et le rendu reste piloté par les variables de thème                                     | Consommer la lib                           |
| **Le clic POI passe par le seam GÉNÉRIQUE**             | Un marqueur POI est une entité GeoJSON comme une autre. Un routage POI-spécifique aurait maintenu la distinction que la dissolution supprimait                                               | Un chemin POI dédié                        |
| **Bulle native ancrée à la coordonnée**                 | Un `div` positionné en pixels doit être repositionné à chaque déplacement et ne sait pas se retourner en bord de carte. La bulle native fait les deux                                        | Un conteneur positionné, comme l'infobulle |
| **Infobulle positionnée en pixels, elle**               | Elle **suit le curseur** : la coordonnée géographique n'est pas ce qu'on veut ancrer                                                                                                         | Une seconde bulle native                   |
| **MapLibre atteint par le global, jamais importé**      | La capacité reste dans le core, qui ne dépend pas du moteur ; l'import statique aurait créé l'arête que l'architecture interdit                                                              | `import maplibregl from …`                 |
| **Mode sûr sur l'infobulle**                            | Une infobulle disparaît au `mouseleave` : un lien ou un bouton n'y sont pas cliquables. Les rendre serait promettre une interaction impossible — ils sont **dégradés en texte**              | Rendre les types interactifs partout       |
| **Le gate est relu à CHAQUE événement**                 | Les surfaces sont créées à la demande, pas montées une fois. Relire est aussi coûteux qu'un accès de configuration, et rend la capacité extinguible à chaud                                  | Un gate évalué au montage                  |
| **`close()` n'est pas gaté**                            | Fermer une surface ouverte doit rester possible même si la clé vient de passer à `false` — sinon on laisse un panneau orphelin qu'aucune API ne referme                                      | Gater les cinq membres                     |
| **Le modèle d'entité est normalisé avant résolution**   | Le sac de propriétés arrive **plat**, **niché**, ou avec les attributs sérialisés en JSON par la frontière de l'ouvrier web. Normaliser en amont a évité trois branches dans chaque renderer | Traiter les formes au site de lecture      |
| **Le glyphe de catégorie est OPT-IN**                   | Les options de rendu de la taxonomie valent `false` par défaut : sans elles, le rendu est inchangé. Un défaut actif aurait modifié tous les profils livrés                                   | Un affichage par défaut                    |
| **Le dictionnaire i18n propre a été retiré**            | Il n'était pas lu. ⚠️ **Le motif écrit dans le code est aujourd'hui périmé** — voir §Écarts                                                                                                  | Le garder inerte                           |
| **Pas de `loader`**                                     | Le rendu attributaire est quasi universel ; un chargement paresseux se déclencherait au premier clic, donc trop tard pour être invisible                                                     | Un `import()` paresseux                    |

---

## Dépendances et frontières

### Le module

`FeatureInfoModule` déclare `id = "feature-info"`, `dependencies = ["geojson"]`, et **aucun créneau
d'interface** — la capacité n'a pas de bouton : elle réagit aux gestes sur la carte.

⚠️ **La question de rang des dépendances ne se pose PAS ici** : la
dépendance est **authentique**. Le module `geojson` est l'**émetteur** des deux signaux auxquels la
capacité s'abonne ; ce n'est pas une astuce d'ordonnancement, c'est la relation réelle.

Sa position dans `presets/manifest.full.ts` la place dans le même lot que `taxonomy` et `cluster`,
et le manifeste écrit que ce lot reproduit l'ordre de démarrage historique.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                               | Statut vis-à-vis de R.8                                                                                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kernel/config/config-primitives.js` | **Exception** nommée par la règle                                                                                                                                                                                 |
| `kernel/events/index.js`             | **Baril** — la route que la règle ouvre elle-même (`*/index.js`). `surfaces/sidepanel.ts` y prend `dispatchGeoLeafEvent` pour les deux signaux du panneau, sans jamais descendre sur `kernel/events/event-bus.js` |
| `utils/controls/focus-trap.js`       | Utilitaire partagé — hors `kernel/`, donc hors du périmètre                                                                                                                                                       |

**La configuration de couche ne passe PAS par un import.** Elle passe par
`layer-config-seam.ts`, qui lit `GeoLeaf.GeoJSON.getLayerConfig(id)` sur le namespace, avec un motif
écrit sur place : rester sur le seam runtime plutôt que d'importer le cœur GeoJSON préserve le
comportement d'avant la reclassification.

⚠️ Ce seam se distingue explicitement de son homonyme de la capacité `offline` — les deux sont des
lecteurs de configuration par seam, et le fichier de `feature-info` le note pour qu'on ne les
confonde pas.

### Frontière avec `taxonomy`

**La plus lâche des trois lectrices de taxonomie.** Aucun import — pas même de type : le module de
rendu déclare **localement** l'interface du seam qu'il attend, et lit `GeoLeaf.Taxonomy` sur le
global. C'est ce qui garde `render/` autonome.

⚠️ **Les trois capacités qui lisent la taxonomie le font de trois façons différentes** :
[`legend`](legend.md) code la référence en dur, [`filter`](filter.md) la rend configurable par champ,
et celle-ci canardise le seam. Le fait n'est consigné nulle part ailleurs.

### Frontière côté CSS

`install.ts` importe **cinq** feuilles. ⚠️ Celle de la galerie porte un motif inscrit dans
l'installeur : elle **était** livrée en double sous deux autres noms, dont le contenu était une
concaténation byte-identique de la sienne — chaque règle partait deux fois dans la feuille minifiée.
**Ni le détecteur de duplication** (il ne lit que le TypeScript et le JavaScript) **ni l'élagueur CSS**
(les deux copies étaient référencées) ne pouvaient le voir.

---

## Le partage lecture / saisie — décision A4″

**Le core possède la LECTURE, `field-renderer` possède la SAISIE.** Ce n'est pas une cible : c'est
le fonctionnement réel, ratifié le 01/08/2026.

| Rôle                                    | Propriétaire            | Mesure                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lecture — infobulle, bulle, panneau     | **core `feature-info`** | ses fichiers de rendu portent « zero dependency on … the field-renderer package » — la phrase se compte à la commande, jamais ici : `grep -rl "field-renderer package" packages/core/src/capabilities/feature-info/render/`. ⚠️ Cette cellule disait « ses **quatre** fichiers de rendu » : `render/` en compte sept, et trois portent la phrase |
| Saisie — modale d'édition               | **`field-renderer`**    | son seul point d'entrée n'appelle que `formRender`                                                                                                                                                                                                                                                                                               |
| Plomberie UI — dialogue, piège de focus | **`host-runtime`**      | à arbitrer (le paquet est privé) — tâche 2.2b                                                                                                                                                                                                                                                                                                    |

⚠️ **La capacité ne consomme PAS `field-renderer`, et ne doit pas commencer.** Router la lecture vers
cette bibliothèque ferait payer au core le poids d'un paquet entier pour la moitié qu'il sait déjà
faire. ⚠️ **Cette phrase chiffrait ce poids à « 30 Ko gz » et l'expliquait par un contrat de composant
« bi-mode » : les deux sont périmés, et le second l'était déjà à la re-vérification.** Le contrat n'a
plus qu'un mode — `sidepanelRender` en a été **retiré**, `formRender` reste seul obligatoire —, et le
poids se mesure : `gzip -c packages/libs/field-renderer/dist/geoleaf-field-renderer.js | wc -c` (après
build du paquet). Un chiffre recopié dans une fiche qui interdit d'en recopier un se périme comme les
autres. Une version antérieure de la décision voulait précisément
cela ; la mesure l'a renversée.

🛑 **Conséquence mesurée : les 23 rendus de lecture de `field-renderer` sont DÉJÀ morts.** Aucun
appelant de production dans le dépôt — contre 2 pour le rendu de saisie. La décision ne crée donc pas
du code mort, **elle ratifie ce qui l'est**.

---

## Ce qui divergeait, et qui ne diverge plus

Cette section décrivait cinq vocabulaires de types parallèles, trois disparitions silencieuses et
six clés déclarées-jamais-lues. **Soldés le 02/08/2026.** Elle garde ce qu'ils
étaient, parce que c'est la seule façon de reconnaître la classe si elle revient.

### Les vocabulaires de types : de CINQ à DEUX

| Source                            | Avant  | Après                                            |
| --------------------------------- | ------ | ------------------------------------------------ |
| Union `FieldType` déclarée        | **17** | **supprimée** — le descripteur pointe le contrat |
| Table de dispatch de la **bulle** | **17** | **supprimée**                                    |
| Table de dispatch du **panneau**  | **19** | **supprimée**                                    |
| Fragment de schéma orphelin       | **15** | **supprimé** — aucun `$ref` ne le visait         |
| Catalogue de saisie               | **23** | conservé, et **confronté** au contrat            |

Il reste le **contrat** (24 widgets) et la **table unique du moteur**. Une gate de parité les
confronte, plus le schéma JSON — trois déclarations, une seule vérité, et une garde vue rougir sur
quatre mutations distinctes.

⚠️ **La divergence allait dans les DEUX sens, et c'est ce qui la rendait difficile à voir** : quatre
types déclarés que rien ne rendait — `date`, `url`, `email` et `hero` —, et huit rendus que rien ne
déclarait, ceux-là **bien utilisés par les profils**. Les quatre premiers étaient un piège
**latent** : aucun profil ne les employait, donc rien ne rougissait. `hero` était un cas à part — le
code le traitait comme la **variante** d'une image, donc aucune branche ne testait `type === "hero"`
et le membre de l'union ne servait à rien. Il est désormais `display.presentation.hero`.

### Les trois disparitions silencieuses : fermées

🛑 **Trou fonctionnel ④ — fermé.** Un champ `action` déclaré sur le panneau latéral n'était **ni
rendu, ni signalé** : la branche n'existait que dans la bulle. ⚠️ **Et sa cause n'était pas la
branche manquante** — c'était la **charge utile** : `openSidePanel` ne passait que le `layerId`,
alors que le contrat de `geoleaf:popup:action` promet `featureId` et `lngLat`. Une branche ajoutée
sans le fil aurait produit un bouton qui émet un événement incomplet.

Symétriquement, `coordinates` et `hours` — les deux entrées qui faisaient l'écart 17 / 19 — étaient
rendus par le **panneau seul** et disparaissaient de la bulle. Les trois sont sur les deux surfaces.

🛑 **Trou fonctionnel ② — fermé.** Un `price` rendait un montant formaté au panneau et
`[object Object]` dans la bulle, parce que les deux surfaces avaient **deux corps différents derrière
la même clé**. Une projection texte unique les sert désormais toutes les trois — y compris
l'infobulle, qui stringifiait tout et portait donc le même défaut sur plus de widgets.

⚠️ **Un type inconnu n'est plus muet** : il n'est pas rendu, il est **journalisé**, et il n'est
jamais fatal (Q9). Les deux moteurs échouaient auparavant en sens opposé — l'affichage faisait
disparaître le champ, la saisie le dégradait en champ texte.

### Les clés déclarées et jamais lues : toutes retirées

| Clé          | Écrite par                             | Lue par | Devenue                                         |
| ------------ | -------------------------------------- | ------- | ----------------------------------------------- |
| `titleField` | **les 18 couches** qui portent le bloc | **0**   | `attributes.titleField`, et il est **enfin lu** |
| `format`     | —                                      | **0**   | rien                                            |
| `listStyle`  | 6 champs                               | **0**   | rien — le code lisait `variant`                 |
| `iconId`     | 5 champs                               | **0**   | rien — l'icône vient du seam taxonomy           |
| `linkText`   | —                                      | **0**   | rien — le code lisait `label`                   |
| `FieldStyle` | 29 valeurs                             | **3**   | `presentation.emphasis`, à **3** valeurs        |

⚠️ **Il n'y avait pas non plus de repli CSS** : 2 modifieurs sur toute la feuille, tous deux de
badge. Les 26 autres valeurs de `FieldStyle` ne produisaient **rien**, ni branche ni classe — c'est
la mesure qui a décidé lesquelles trois survivaient.

⚠️ `titleField` était le cas le plus net : **18 couches sur 18 l'écrivaient**, et il était déclaré
**trois fois** dans les types du core. Le correctif solde la triplication **et** fait lire la clé —
déplacer une clé morte sans lui donner un lecteur n'aurait rien réglé.

---

## Écarts au CDC source

Le CDC `CDC_plugin-feature-info.md` (v2.2.0, 03/07/2026) a été **consommé** en écrivant cette fiche,
puis **supprimé** du dossier de tri — ligne au §Journal des décisions de
la refonte documentaire V3.

| Énoncé du CDC                                                                 | Ce que dit le code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Titre et corps — « Plugin `@geoleaf-plugins/feature-info` »                   | **Capacité in-core.** Le CDC le dit lui-même dans son bandeau de tête, et garde le titre. C'est cette contradiction qui a failli ranger la fiche dans `specs/plugins/`                                                                                                                                                                                                                                                                                                                                                                                                     |
| §3.3 — « Action buttons → dispatch `geoleaf:popup:action` »                   | ✅ **SOLDÉ le 29/07/2026** — le bouton est produit et le signal émis par `renderActionButton()`, dans `render/widget-dispatch.ts`. ⚠️ Cette ligne disait encore « écartés, zéro émission » le 02/08 : **elle contredisait le §Contrat exposé du même fichier**, qui annonce l'émission depuis juillet. Corrigée. ⚠️ Elle a ensuite renvoyé à `render/popup-content.ts:283` jusqu'au 11/08 — **mauvais fichier ET ligne hors bornes**, ce fichier n'en ayant que 197 : le rendu des widgets en avait été extrait. Ancrée sur la fonction, elle ne se périme plus en silence |
| §4.1 — « tableau complet des **14** types »                                   | ✅ **SOLDÉ le 02/08/2026** — le contrat en déclare **24** et le moteur en rend 24, confrontés par une gate de parité. ⚠️ Cette ligne a porté **trois** comptes faux avant d'être résolue : « 16 rendent, `action` écarté » (périmé depuis le bouton d'action), « 14 rendent » (oubliait `hero`), puis « 13 rendent / 4 muets ». Un compteur qu'aucune machine ne confronte se trompe à chaque relecture — c'est l'argument même de la gate                                                                                                                                 |
| §1.1bis — CSS « via `@import` dans `packages/core/src/css/geoleaf-main.css` » | Les cinq feuilles sont importées **par l'installeur**, ce qui les rend élaguables avec la capacité                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| §1.3 — `public-api.ts` « 5 méthodes »                                         | ✅ **Vérifié exact** — `isEnabled`, `close`, `openPopup`, `openSidePanel`, `getConfig`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| §2 — le seam kernel et ses deux charges utiles                                | ✅ **Vérifié exact**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| §3.4 — panneau latéral **autonome**, aucune dépendance à `GeoLeaf.POI`        | ✅ **Vérifié exact**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| §1.1bis — glyphe de catégorie avant le titre, opt-in, par seam runtime        | ✅ **Vérifié exact**, sur les trois surfaces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| §1.1bis — migration cassante des clés héritées de couche                      | ⚠️ **Périmé, et à l'envers.** Le CDC décrivait la migration VERS `capabilities.feature-info` ; c'est ce bloc-là qui est aujourd'hui l'HÉRITÉ. La forme canonique est le bloc **racine** `attributes` (§Configuration), et plus aucune configuration de couche livrée ne porte `capabilities` — `grep -rl '"capabilities"' $(find profiles -name '*_config.json')` ne rend rien. `convert.ts` garde une lecture de repli sur le bloc hérité, et `getConfig` est le seul membre public qui l'expose encore                                                                   |

⚠️ **Et un en-tête du code est périmé, pas le CDC.** `module.ts` explique que le dictionnaire i18n de
l'ancien plugin a été retiré parce que « le seam de lecture `GeoLeaf.I18n.t` n'a jamais été monté
(`packages/core/src/globals/globals.core.ts` n'expose que `{ registerDict, getLabel }`) ». **La parenthèse est au présent et
elle est fausse** : `packages/core/src/globals/globals.core.ts` monte aujourd'hui quatre membres, `t` compris. Mesuré aussi :
les deux clés que le panneau latéral demande **existent dans les six dictionnaires** du core, donc
les libellés **sont** localisés — le repli en dur n'est plus le chemin nominal. Le comportement est
bon, c'est l'explication qui a vieilli.

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le motif de la reclassification, le
détail de ce qui a été **supprimé du core** en absorbant le rendu — dont plusieurs répertoires de
rendu POI découverts morts en tirant le fil —, la raison du passage au seam générique pour le clic
POI, et les alternatives écartées de la table §Décisions.
