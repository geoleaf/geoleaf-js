---
type: spec-plugin
title: routing — le calcul d'itinéraire, utilisable sans le guidage
plugin_id: routing
package: "@geoleaf-plugins/routing"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: ad74ec1f8
date: 27 août 2026
---

# routing — le calcul d'itinéraire, utilisable sans le guidage

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/routing` ·
**Code :** `packages/plugins/routing/` · **Vérifié contre :** voir `verifie_contre` en tête — ⚠️ cette ligne portait un second empreinte, `66a48f8b0`, qui a divergé de trois commits du frontmatter sans que rien ne le voie : `SPECS-FRESH` ne lit que l'en-tête. Deux surfaces pour un seul fait, dont une non gatée, se contredisent toujours dans le sens où c'est la non gatée qui ment.

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**.

> ⚠️ **Cette fiche décrit un paquet qui vient de naître.** Son squelette existe, il passe le
> contrat de plugin et il monte son namespace ; **le calcul d'itinéraire, lui, n'est pas écrit.**
> Ce qui suit est donc en partie une spécification et non un compte rendu — les sections qui
> décrivent du code non encore livré le disent à leur place, plutôt que de laisser le lecteur le
> déduire.

---

## Périmètre

### Ce que le plugin fait

- Il **calcule** un itinéraire entre deux points ou plus, par un fournisseur externe interchangeable.
- Il **normalise** la réponse du fournisseur vers un modèle unique, `RouteResult`, dont la forme est
  celle du modèle OSRM.
- Il **publie** la géométrie obtenue par la couture prévue à cet effet ; il ne dessine pas lui-même.

### Ce qu'il ne fait pas

- **Aucun guidage.** Pas de recalcul sur écart, pas d'énoncé de manœuvre, pas de suivi de position.
  C'est `@geoleaf-plugins/navigation`, un paquet distinct.
- **Aucun rendu propre.** Il ne crée ni source ni couche MapLibre : un pipeline de rendu parallèle
  est précisément la dette que la capacité `route` du cœur a dissoute.
- **Aucun fournisseur embarqué.** Il n'héberge pas de moteur de routage ; il en appelle un.
- **Aucun secret.** Les instances visées sont publiques ; un endpoint qui ne commence pas par
  `https://` est refusé, comme le fait déjà `geocoding`.

🛑 **Pourquoi DEUX paquets et non un seul.** Le calcul a de la valeur seul — un opérateur qui veut
« l'itinéraire jusqu'à ce point » n'a pas besoin d'être guidé. Le guidage, lui, n'a aucune valeur
sans le calcul. **La dépendance est asymétrique, donc la frontière est là.** Un paquet unique
ferait payer le runtime de guidage à tous ceux qui ne veulent que la distance.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`.

| Champ        | Valeur                                       |
| ------------ | -------------------------------------------- |
| `name`       | `routing`                                    |
| `label`      | `Routing (calcul d'itinéraire multi-étapes)` |
| `requires`   | `[]`                                         |
| `optional`   | `[]`                                         |
| `namespace`  | `GeoLeaf.Routing`                            |
| `paquet npm` | `@geoleaf-plugins/routing`                   |

⚠️ **`requires` est vide, et c'est un choix.** Le plugin appelle un fournisseur HTTP et publie sa
géométrie par la couture du cœur : il ne dépend d'aucun autre plugin. La relation qui existe va
dans l'autre sens — c'est `navigation` qui déclare `requires: ["routing"]`.

---

## Chargement — eager, et ce n'est pas un détail de performance

🛑 **`routing` se charge AVANT `GeoLeaf.boot()`, jamais paresseusement**, et la raison ne se devine
pas.

Le bouton « Itinéraire » se déclare dans le profil par un widget `action` de `feature-info`, dont
la visibilité est gardée par `requiresPlugin`. Or ce garde-là — celui du widget, à la différence de
celui des créneaux de barre d'outils — s'évalue sur `GeoLeaf.plugins.isLoaded()` **seul**. Un plugin
enregistré en `registerLazy` n'entre au registre qu'**après** son chargement.

**Conséquence** : un `routing` paresseux masquerait son propre point d'entrée, et rien ne
déclencherait jamais le chargement qui l'afficherait. Le bouton n'apparaîtrait pas, sans qu'aucune
erreur ne soit émise.

⚠️ **Ne pas « corriger » le garde pour rendre `routing` paresseux.** L'asymétrie entre les deux
gardes est consignée et assumée : la modifier changerait la sémantique de `requiresPlugin` pour
**tout profil existant**. `routing` est par ailleurs la moitié légère des deux paquets.

---

## API publique — `GeoLeaf.Routing`

| Membre                                                               | Signature                              | État         |
| -------------------------------------------------------------------- | -------------------------------------- | ------------ |
| `getConfig()`                                                        | `(): PluginConfig`                     | ✅ livré     |
| `registerProvider(id, factory)`                                      | `(string, RouteProviderFactory): void` | ✅ livré     |
| `listProviders()`                                                    | `(): string[]`                         | ✅ livré     |
| `getProvider()`                                                      | `(): ProviderIdentity \| null`         | ✅ livré     |
| `addWaypoint` / `removeWaypoint` / `moveWaypoint` / `clearWaypoints` | composition                            | ✅ livré     |
| `isRoutable(waypoints)` · `maxWaypoints()`                           | `(): boolean` · `(): number`           | ✅ livré     |
| `legSummaries(route)`                                                | `(): LegSummary[]`                     | ✅ livré     |
| `routeFeatures(route)`                                               | `(): Feature[]`                        | ✅ livré     |
| `publishRoute(route)` · `clearRoute()`                               | `(): PublishOutcome`                   | ✅ livré     |
| `route()`                                                            | à figer avec l'adaptateur              | ⏳ non livré |

✅ **`listProviders()` rend `["valhalla", "osrm"]` depuis le 21/08/2026.** Les deux moteurs se
déclarent eux-mêmes, par un import à effet de bord de l'entrée — **jamais par un appel que l'hôte
devrait se rappeler de faire**. Un plugin dont les moteurs intégrés n'existent qu'une fois le
README lu a une configuration qui ne fait silencieusement rien.

⚠️ Le registre reste une **porte** : un intégrateur y branche un moteur que ce paquet ne connaît
pas. S'il enregistre sous un id déjà pris, il remplace — c'est la raison d'être de la porte.

⚠️ **La surface est délibérément étroite.** Une méthode annoncée avant d'être résolue est pire
qu'une méthode absente : un intégrateur qui lit `GeoLeaf.Routing.route` trouve une fonction qui ne
répond rien, et le découvre à l'exécution. La façade `src/public-api.ts` ne porte aucune logique —
elle délègue, et `check-facade-purity` le vérifie.

---

## Le contrat de fournisseur

Deux fournisseurs sont visés, et l'ordre entre eux est arbitré :

| Fournisseur  | Rang    | Motif                                                                        |
| ------------ | ------- | ---------------------------------------------------------------------------- |
| **Valhalla** | premier | seul MIT de la liste retenue, seul dont le narratif localisé français existe |
| **OSRM**     | second  | standard de fait, et cible de normalisation (`format: "osrm"`)               |

⚠️ **Le narratif de manœuvre se demande AU SERVEUR dans la langue de l'interface**, plutôt que
d'être traduit côté client : c'est gratuit, déjà rédigé, et cela évite d'embarquer un corpus de
chaînes qu'il faudrait maintenir.

🛑 **La forme de `RouteResult` est celle du modèle OSRM, et l'identité est le point.** Elle n'est
pas « inspirée de » : elle garde ouverte, **à coût nul**, la substitution ultérieure du moteur de
guidage. Un objet de cette forme traverse la frontière d'un moteur tiers et y rend une projection
correcte — c'est mesuré, pas supposé.

⚠️ **Le modèle se fige APRÈS le corpus de fixtures, jamais avant.** L'ordre inverse conduit à
écrire les fixtures pour qu'elles entrent dans le modèle, au lieu de laisser le réel corriger le
modèle — et l'identité avec OSRM cesse alors d'être vérifiée pour devenir supposée.

### Ce que le corpus a effectivement corrigé — trois écarts qu'aucune relecture n'aurait rendus

Le corpus (`fixtures/`, capturé par `scripts/capture-route-fixtures.cjs`, **lancé à la main**) est
le MÊME trajet à trois étapes chez les deux moteurs. Le lire avant d'écrire le modèle a rendu trois
différences :

| #   | L'écart                                                 | Ce qu'un modèle figé d'abord aurait livré                                                               |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ①   | Valhalla répond en **kilomètres**, OSRM en mètres       | un trajet de 80 km rapporté comme 80 mètres, et tout seuil de guidage privé de sens                     |
| ②   | Valhalla encode sa polyline en **1e6**, OSRM en **1e5** | décodé au mauvais facteur, l'itinéraire lit **latitude −208** — pas un mauvais lieu, un lieu impossible |
| ③   | L'instance publique d'OSRM n'émet **aucun narratif**    | un runtime de guidage **muet** sur un des deux moteurs, découvert dans un navigateur                    |

### Ce qu'un fournisseur répond quand il ne répond pas — cinq raisons, jamais une

`IRouteProvider.route()` rend un **`RouteOutcome`**, pas un `RouteResult | null`.

⚠️ **C'est un changement de contrat assumé, daté du 21/08/2026.** Le sprint qui l'a écrit n'avait
pas encore rencontré l'exigence qu'un échec soit _actionnable_ ; `null` rendait indiscernables cinq
causes qui appellent cinq phrases différentes :

| Raison      | Ce que c'est                                    | Ce que l'utilisateur peut faire                |
| ----------- | ----------------------------------------------- | ---------------------------------------------- |
| `timeout`   | le moteur a eu son temps et n'a pas répondu     | réessayer tel quel peut marcher                |
| `network`   | la requête n'a pas atteint le moteur            | vérifier la connexion                          |
| `http`      | le moteur a répondu et refusé (429 quota, 400…) | rien — mais le message ne doit pas le suggérer |
| `malformed` | réponse illisible par l'adaptateur              | rien — c'est un défaut d'un des deux côtés     |
| `no-route`  | **réponse ordinaire** : il n'y a pas de route   | changer de points                              |

🛑 **`no-route` est le cas qui rend le regroupement inacceptable.** Deux points sur des îles
différentes n'ont pas d'itinéraire, et le rendre par « une erreur est survenue » est un mensonge
sur la carte : cela dit à l'utilisateur de réessayer quelque chose qui ne marchera jamais.

⚠️ **Aucun échec ne porte de route, pas même vide.** Un `RouteResult` vide serait indiscernable
d'un itinéraire de longueur nulle, et un consommateur lisant `res.route.distance` sur un échec
afficherait « 0 m » comme une réponse.

**Les conversions vivent toutes dans l'adaptateur** (`src/normalize-valhalla.ts`), jamais dans le
modèle ni chez un consommateur. Le modèle porte des **mètres**, des **secondes**, des coordonnées
`[longitude, latitude]` et une polyline en **précision 5** — une seule voie de décodage pour tous
les moteurs.

⚠️ **`RouteStep.instruction` est donc OPTIONNEL**, et un consommateur qui écrit `step.instruction!`
est correct contre un fournisseur et blanc contre l'autre.

---

## Configuration

Le plugin lit **`modules.routing`**, et cette branche est la seule (INV-CONFIG).

| Clé            | Type                 | Défaut            | Rôle                                                                                                                        |
| -------------- | -------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `enabled`      | `boolean`            | `true`            | active le plugin                                                                                                            |
| `showButton`   | `boolean`            | `false`           | affiche le point d'entrée dans la barre                                                                                     |
| `provider`     | `string`             | `"valhalla"`      | moteur à interroger, résolu dans le registre                                                                                |
| `endpoint`     | `string`             | `""`              | base URL du moteur ; vide = défaut du fournisseur                                                                           |
| `timeoutMs`    | `number`             | `10000`           | délai accordé au moteur avant **abandon** de la requête                                                                     |
| `maxWaypoints` | `number`             | `10`              | plafond d'étapes ; au-delà, l'ajout est **refusé avec la limite nommée**                                                    |
| `profile`      | `string`             | `"car"`           | mode de déplacement — `car`, `foot` ou `bike`. Un jeton inconnu **retombe** sur `car`, il n'est jamais transmis au moteur   |
| `layerId`      | `string`             | `"routing-route"` | couche du profil où la géométrie est publiée                                                                                |
| `labelField`   | `string \| string[]` | `"name"`          | propriété(s) du POI portant son libellé — **aussi nommée(s) dans `payloadFields`** ; la première présente et non vide gagne |

⚠️ **Le délai est tenu par un `AbortController`, pas par une promesse en course.** Une course
laisse la requête vivre : un moteur lent garde une connexion et une place de quota pour une
réponse que personne ne lira. L'abandon est ce qui fait qu'un délai dépassé ne coûte rien au
moteur.

⚠️ **Une valeur nulle ou négative n'est PAS honorée**, elle retombe sur le défaut : `0` abandonnerait
chaque requête avant qu'elle parte, ce qui est indiscernable d'un moteur qui ne répond jamais.

🛑 **Un `endpoint` qui ne commence pas par `https://` est REFUSÉ, jamais rétrogradé, et jamais
remplacé en silence par le défaut du fournisseur.** Le repli est la partie dangereuse, pas
l'acceptation : il rendrait un itinéraire qui marche, donc personne ne découvrirait que l'endpoint
configuré a été ignoré. Une requête de routage porte où quelqu'un se trouve et où il va.

⚠️ **Et c'est là que le décalque sur `geocoding` s'arrête délibérément.** Ce plugin-là retombe sur
son fournisseur par défaut quand la valeur est inutilisable — ce qui est juste pour une barre de
recherche : un mauvais résultat se voit, et l'utilisateur retape. C'est faux ici. Router quelqu'un
par un moteur qu'il n'a pas choisi, parce que celui qu'il a choisi était mal configuré, est une
substitution silencieuse sur une décision qui lui appartient.

⚠️ **`showButton` reste à `false` PAR DÉFAUT, mais son motif d'origine est périmé.** Il disait
« le panneau n'existe pas encore » ; le panneau existe depuis le S2 du chantier des exigences
manquantes, et le profil `tourism` met la clé à `true` depuis le 23/08/2026. Ce qui reste vrai
est le défaut prudent pour un intégrateur : le plugin n'a de sens qu'avec un moteur configuré.

🛑 **`labelField` accepte une LISTE depuis le 26/08/2026, et ce n'est pas une commodité.** Le
bouton se déclare **par couche** dans le profil, alors que ce réglage est **global au plugin** —
et les couches ne s'accordent pas sur le nom de leur libellé. Mesuré sur `tourism` : `Name`
(aires protégées), `NAME` (sites WDPA), `species` (GBIF), `place` (épicentres). Une valeur unique
ne pouvait donc en nommer qu'une seule, les trois autres arrivant **sans nom**, avec des
coordonnées à la place. La liste est ordonnée, la première propriété présente et non vide gagne,
et la forme chaîne reste acceptée — elle vaut une liste d'un.

⚠️ **On ne devine toujours pas.** Prendre « la première propriété de type chaîne » nommerait une
destination d'après un code de statut ou un identifiant, sans que l'utilisateur puisse savoir
pourquoi. Les candidats sont nommés par l'intégrateur, ici comme avant.

⚠️ **`profileKey` doit rester sous `modules.<id>.*`** — la même branche que `config.ts` lit. Écrire
`ui.showRouting` produit un plugin qui lit sa configuration à un endroit et obéit à un autre : le
bouton reste invisible, et rien dans la sortie ne dit pourquoi.

---

## 🛑 Le panneau est un PANE du cœur, plus une modale — 26/08/2026

Le panneau ne s'affiche **pas** de lui-même. Il se déclare auprès du registre de panes du cœur,
et c'est l'hôte vivant qui l'adopte : le **panneau latéral droit** au-dessus de 1440 px, le
**sheet mobile** en dessous. Même geste que la légende et le gestionnaire de couches, et pour la
même raison : un itinéraire se compose **à côté** de la carte, puisqu'on regarde le tracé pendant
qu'on modifie les étapes.

| Pièce                     | Où                                                                 |
| ------------------------- | ------------------------------------------------------------------ |
| Déclaration               | `src/entry.ts` → `registerPane` (`src/ui-seam.ts`)                 |
| Identifiant               | `routing` — aussi `gl-rp-tab-routing` / `gl-rp-pane-routing`       |
| Élément adopté            | `.gl-routing-panel`, monté sur `document.body`, masqué par son CSS |
| Construction à la demande | `onOpen` du pane → `ensurePanel()`                                 |
| Ouverture                 | `GeoLeaf.UI.openPane("routing")`, jamais `openPanel`               |

🛑 **Il était bâti sur `createModalShell`, et il était INVISIBLE.** Ce helper écrit
`.gl-form-modal-overlay` / `.gl-form-modal-panel`, dont les règles ne vivent que dans
`field-renderer` — un paquet que ce bundle n'embarque pas. L'overlay sortait donc en
`position: static` à la fin du `<body>`, sous un `.gl-page` haut de `100vh` : **hors écran, sans
la moindre erreur**. `editor` échappait au même appel uniquement parce qu'il embarque
`field-renderer`. Le bouton du POI paraissait mort ; il fonctionnait depuis le début.

⚠️ **`openPane` et jamais `openPanel`.** `GeoLeaf.UI.openPanel` pilote le panneau **desktop** et
répond `false` sous 1440 px, là où le même contenu revient au sheet. Un plugin qui réagit au clic
sur un POI n'a pas à savoir quelle surface la largeur courante implique.

⚠️ **Aucun `desktopTabButton`.** L'enregistrement du pane fournit déjà l'onglet ; en déclarer un
en plus produisait **deux contrôles côte à côte pour un seul panneau**. Le `mobileIcon` demeure,
et le cœur lui pose `data-gl-desktop-slot` pour le masquer là où l'onglet le remplace.

🛑 **Fermer n'est pas détruire.** `close()` demande à l'hôte de masquer ; l'itinéraire saisi
survit. `destroy()` détache. Perdre son point de départ en repliant un onglet serait la même faute
que le bouton du POI qui l'écrasait — prise par l'autre bout.

---

## 🛑 Un pane HÉRITE de son hôte — et ce qu'il n'hérite pas, il doit le poser — 27/08/2026

Le panneau est lisible. Il ne l'était pas, et les trois causes sont indépendantes : elles se sont
cumulées sans qu'aucune ne soit une faute d'écriture. Mesuré dans un vrai Chromium, sur le pane
desktop à sa largeur réelle de **320 px**, avant/après :

| Mesure                               | Avant     | Après        |
| ------------------------------------ | --------- | ------------ |
| `font-size` calculé du corps du pane | **16 px** | **12,48 px** |
| Éléments débordant ou tronqués       | **15**    | **0**        |

### ① Le pane n'avait pas d'échelle typographique

`.gl-routing-panel` ne déclarait aucun `font-size`, donc chaque ligne héritait des 16 px du
document — pendant que le gestionnaire de couches et la légende, **ses deux voisins dans la même
colonne**, tournent à 0,8 rem. ⚠️ Rien ne paraissait cassé isolément : c'est **à côté d'eux** que
c'était gros, et c'est exactement le défaut qu'une feuille de plugin ne peut pas voir depuis
l'intérieur de son paquet. Le pane lit désormais `--gl-font-size-sm`, le jeton que les contrôles
de formulaire partagés utilisent déjà.

### ② Les boutons de ligne ÉCRIVAIENT leur nom accessible

`moveButton` / `removeButton` posaient la même chaîne dans `aria-label` **et** dans `textContent`.
Chaque ligne d'étape imprimait donc « Monter cette étape », « Descendre cette étape », « Retirer
cette étape » — trois phrases, dans une colonne de 320 px —, et le nom de l'étape était chassé hors
champ. 🛑 **Ce sont deux métiers, pas un** : `aria-label` EST le nom accessible et prime sur le
contenu, donc le lecteur d'écran entend toujours la phrase entière ; ce qui change est ce qui est
**dessiné**, désormais `↑`, `↓`, `×`. Même arbitrage que le `×` de l'en-tête, qui le faisait déjà
deux fichiers plus loin.

### ③ Cinq couleurs lisaient un jeton GELÉ

⚠️ **Lire un jeton ne suffit pas — il faut qu'il BOUGE.** `--gl-color-text` et `--gl-color-border`
ressemblent aux bons et n'en sont pas : `geoleaf-theme.css` les déclare sur `:root` comme
`var(--gl-color-text-main)` / `var(--gl-color-border-soft)`, or **une propriété personnalisée
contenant un `var()` est substituée là où elle est DÉCLARÉE**. Chacune se calcule donc une fois,
contre les défauts de `:root`, et les blocs par thème qui redéfinissent `-main` et `-soft` sur
`body` ne l'atteignent jamais. Relevé sous `.gl-theme-dark` : `--gl-color-text-main` vaut
`#e5e7eb` quand `--gl-color-text` vaut `#0f172a`. Le champ, les quatre boutons secondaires et les
lignes de résultat sortaient donc **quasi noirs sur un panneau quasi noir**, dans tous les thèmes
sombres. Ils lisent maintenant les jetons par thème.

✅ **RÉPARÉ À LA SOURCE le 27/08/2026 — et le gisement était DEUX FOIS celui annoncé ici.** Ce
paragraphe a dit « 13 autres sites » pendant quelques heures : c'était un sous-comptage sur deux
axes à la fois. Il ne regardait que les **deux** alias rencontrés par ce panneau alors que
`geoleaf-theme.css` en déclarait **six** de la même forme, et son motif exigeait une virgule de
repli, ce qui écartait les usages sans valeur de secours. Mesure complète : **28 sites sur 7
feuilles**, et le pire n'était pas une couleur de texte — `--gl-color-surface-elevated` peignait le
fond de `.gl-accordion` en `#f9fafb` sur une page sombre.

Les six alias sont désormais **repris à l'identique dans `.gl-theme-light` et `.gl-theme-dark`**,
comme le trio `--gl-accordion-*` l'était déjà — c'est ce trio, non gelé au milieu des six qui
l'étaient, qui a servi de témoin. Les 5 sites de ce paquet lisent les jetons par thème et n'ont pas
été rebasculés sur les alias : `--gl-color-text-main` est le jeton de la maison (127 sites), et
`--gl-color-border-strong` a été retenu **délibérément** pour que la bordure du champ reste visible.

⚠️ Le décompte se re-mesure, il ne se recopie pas — **et le motif se quote**, faute de quoi le shell
développe `*.css` avant `grep` et la commande sort un avertissement en ne scannant pas ce qu'elle
annonce. La classe ENTIÈRE se dénombre ainsi, alias compris :

```bash
grep -rhoE 'var\(--(gl-color-text|gl-color-text-secondary|gl-color-border|gl-color-border-subtle|gl-panel-border|gl-color-surface-elevated)[,)]' --include='*.css' packages/*/src packages/*/*/src apps | wc -l
```

### Ce que la liste d'étapes dessine maintenant

Une grille de trois lignes de texte — rôle, nom, tronçon — et un amas de contrôles qui les
enjambe. ⚠️ **Les lignes sont déclarées EXPLICITEMENT** : `grid-row: 1 / -1` ne compte que les
lignes de la grille **explicite**, donc avec des rangées auto-placées `-1` retomberait sur la
ligne 1 et l'amas se collerait à la première ligne seule — c'est-à-dire la mise en page qu'on
répare.

⚠️ **Et le numéro d'étape est dessiné par un COMPTEUR, pas par le marqueur du `<ol>`.** `display:
grid` sur un `<li>` — `display: flex` avant lui — **remplace** `display: list-item`, donc la boîte
de marqueur cesse d'être générée : la numérotation était perdue depuis que la ligne est un
conteneur flex, sans que personne y ait touché. La liste reste un `<ol>` parce que c'est ce qu'un
lecteur d'écran compte ; le numéro visible vient d'un `counter()`. Sans lui, toute étape
intermédiaire lit « Étape » et rien ne distingue deux d'entre elles.

📌 **Ne pas confondre avec la numérotation de `labels-seam.ts`** (§ La numérotation des étapes) :
celle-là étiquette le tracé **sur la carte** via la capacité `labels` du cœur. Deux numéros, deux
surfaces, aucun code commun.

---

## 🛑 Le chemin de saisie — le modèle savait composer N étapes et rien ne l'alimentait

Jusqu'au 23/08/2026, `addWaypoint`, `removeWaypoint`, `moveWaypoint`, `roleAt` et `maxWaypoints`
étaient livrés, exposés sur l'API publique et testés — et **rien dans le dépôt ne les appelait avec
un point neuf**. Le panneau portait cinq contrôles et pas un champ. Les deux seuls points qui
pouvaient entrer étaient la destination qu'un POI ouvrait et l'origine que la géolocalisation
remplissait : **deux points, sur un plugin dont la prémisse est un trajet à étapes.**

Les opérations de liste étaient les puits. Il manquait les sources.

| Source                          | Fichier                    | Ce qu'elle résout                                             |
| ------------------------------- | -------------------------- | ------------------------------------------------------------- |
| Saisie au clavier               | `src/ui/waypoint-input.ts` | coordonnées, ou adresse quand `geocoding` est là              |
| Lecture d'une paire tapée       | `src/parse-point.ts`       | l'ordre `lat, lon`, et les formes ambiguës refusées           |
| Clic sur la carte               | `src/pick-on-map.ts`       | un mode dont ce qui compte est la SORTIE                      |
| Recherche d'adresse optionnelle | `src/geocode-seam.ts`      | lue sur le namespace à l'appel, jamais déclarée en dépendance |

### 🛑 `latitude, longitude` — le seul endroit du dépôt où l'ordre s'inverse

Ce dépôt porte `[longitude, latitude]` partout, et c'est juste : c'est l'ordre GeoJSON, et
l'inverser à une frontière est la façon dont des coordonnées finissent dans le golfe de Guinée.
**Le champ tapé est le seul bord où l'autre ordre est correct.** Tout outil grand public imprime
`lat, lon`, et la liste d'étapes de ce paquet **réaffiche cet ordre** pour une étape sans nom : un
champ qui n'accepterait pas ce que la liste vient de montrer échoue sur la chose la plus évidente
que quiconque essaie. La conversion se fait là, une fois, au bord.

### Pourquoi les coordonnées passent AVANT la recherche d'adresse

La recherche coûte un aller-retour réseau et une unité de quota ; lire une paire ne coûte rien. Et
une chaîne qui se lit comme une paire n'est jamais une adresse. ⚠️ Une paire **hors limites** ne
part pas non plus à la recherche : `200, 500` est une faute de frappe, et la chercher rendrait un
lieu plausible et faux — le pire des trois résultats.

### Ce que le mode « clic sur la carte » garantit, et ce n'est pas l'entrée

Quatre sorties : un second appui, la touche Échap, la fermeture du panneau, et le clic abouti
lui-même. **Un gestionnaire qui survit à son mode transforme chaque clic ultérieur en étape que
personne n'a demandée**, et l'utilisateur n'a aucune idée de ce qu'il a fait pour la mériter.

⚠️ Le curseur est **restauré à ce qu'il était** et non vidé : une autre couche peut le posséder, et
le vider annulerait son signal sans arrêter son mode. Et la durée de vie du mode appartient au
**contrôleur**, pas au panneau — lui seul peut le terminer après que le panneau a disparu.

### Pourquoi `geocoding` n'est pas une dépendance

Le CDC appelle cette intégration **optionnelle**, et la seule façon dont « optionnelle » veut dire
quelque chose est qu'elle ne soit pas déclarée. La déclarer mettrait un paquet de recherche
d'adresse devant tout intégrateur qui ne colle que des coordonnées, et ferait échouer un profil qui
ne l'a pas au lieu de le dégrader.

⚠️ `geocodingAvailable()` est une question **séparée** de `searchAddress()`. « Il n'y a pas de
recherche ici » et « la recherche n'a rien trouvé » appellent des phrases opposées, et les
confondre dirait à quelqu'un sans le plugin que son adresse n'existe pas.

## L'auto-hébergement d'une instance — spécifié, jamais exécuté

> 📌 **Versé ici le 26/08/2026, à l'archivage de la roadmap qui le portait.** Le geste n'a jamais
> été fait, faute d'instance ; sa recette et surtout **son critère de réussite** vivaient dans un
> document sorti du dépôt. Ce paragraphe n'affirme rien sur le code : il conserve un critère.

Basculer d'un fournisseur public vers une instance auto-hébergée doit être une **décision de
configuration**, jamais une réécriture. Le critère qui le prouve est exigeant, et c'est tout son
intérêt :

> **Les fixtures du contrat de fournisseur passent contre l'endpoint local, INCHANGÉES.**

⚠️ **Modifier une fixture pour faire passer la bascule invaliderait la démonstration** — c'est
précisément ce que le critère interdit. Une fixture qu'on adapte prouve que le fournisseur a une
forme particulière ; une fixture qu'on ne touche pas prouve que le contrat tient.

🛑 **Ce qui manque n'est pas du code, c'est une machine.** Aucune session ne fournit une instance
de routage, et c'est la raison — nommée — pour laquelle ce point est resté ouvert quand tout le
reste du chantier a été rendu.

## Deux extensions écartées, et leur motif

- **Optimiser l'ordre des étapes.** Peu coûteux : la matrice origine-destination nécessaire est
  servie par la même API que le calcul. Écarté parce que **sans valeur tant que les tournées
  n'existent pas** — optimiser l'ordre de deux étapes saisies à la main n'apporte rien.
- **Ajouter une étape depuis un POI, par-dessus un itinéraire en cours.** ⚠️ À ne pas confondre
  avec l'ouverture d'un POI **en destination**, qui est livrée : l'insertion dans un trajet déjà
  calculé est un autre geste, avec sa propre question d'interface (où s'insère l'étape ?).

📌 **Le chemin de saisie déclaratif est VIVANT, et un grep naïf le manque.**
`profiles/tourism/layers/aires_protegees_nationales_sib/aires_protegees_nationales_sib_config.json`
déclare `"widget": "action"` avec `"actionId": "routing.destination"` (mesuré le 26/08/2026).
⚠️ La recherche qui aurait dû le trouver cherchait `"type": "action"` : la clé du schéma est
**`widget`**. Un inventaire de ce chemin qui grepperait `type` conclurait qu'il n'est pas utilisé.

## Composition — le numéro et le rôle sont DÉRIVÉS, jamais stockés

L'exigence dit qu'une suppression « renumérote les suivants », et un réordonnancement aussi. Cette
formulation appelle un champ `order` sur chaque étape, tenu à jour avec le tableau — **et c'est
exactement la forme où renuméroter devient quelque chose qu'on peut oublier**. Un chemin de code
met à jour le tableau sans toucher au champ, et la liste affiche « 1, 2, 2, 4 » sans que rien ne
l'explique.

Ici le numéro EST la position (`index + 1`), et le rôle aussi (`roleAt`). **Renuméroter n'est donc
pas une opération**, ce qui est la seule façon d'être sûr que ça ne se fasse jamais mal. Un test
l'épingle : après un déplacement, la destination est toujours la dernière.

⚠️ **Chaque opération refuse avec une RAISON**, jamais avec un booléen. Un ajout au-delà du
plafond, un déplacement vers nulle part, une suppression d'un index absent — chacun a un message
juste, et `false` les regrouperait en « ça n'a pas marché ». Le refus de plafond porte **la limite**,
sans quoi le message ne peut pas dire combien.

⚠️ **Un déplacement qui n'aboutit nulle part est REFUSÉ** (`no-op`) et non répondu par une liste
inchangée : un appelant qui redessine sur `ok` repeindrait à chaque glisser terminé sur place.

---

## Publication — le plugin ne DESSINE pas

🛑 Il pousse des features par la couture du cœur et s'arrête là. Aucune source MapLibre créée,
aucune couche ajoutée, aucun style touché. **Un second pipeline de rendu à côté de celui du cœur
est très exactement la dette que la capacité `route` a dissoute**, et la refaire pousser dans un
plugin la remettrait là où elle est plus difficile à voir.

**Une seule couche, les rôles sur les features** — `route`, `origin`, `via` (portant son index),
`destination`. Une sous-couche par rôle doublerait les sources MapLibre par itinéraire, ce qui est
l'état d'avant.

⚠️ **Et il REFUSE d'écrire dans une couche que le profil ne déclare pas.** `setData` sur un id
inconnu n'est pas une erreur que le magasin rapporte : il n'a simplement nulle part où mettre les
features. L'intégrateur verrait alors un plugin qui calcule un itinéraire, ne dit rien et ne dessine
rien — sans moyen de savoir laquelle des trois étapes a échoué. `hasLayer` est ce qui fait que la
réponse le dit.

---

## Ce que le bout-en-bout a établi, et qu'aucune autre gate ne pouvait

La garde du point d'entrée est prouvée **dans les deux sens**
(`e2e/35-routing-entry-point.spec.js`) : plugin chargé ⇒ le bouton est rendu sur la popup et le
panneau ; **bundle abandonné ⇒ aucun bouton nulle part**, avec un témoin explicite qui atteste que
la manipulation a bien eu lieu.

🛑 **Le second sens est le seul qui prouve quelque chose.** Un bouton rendu inconditionnellement
passerait le premier. Et le retrait se fait en abandonnant la **requête du bundle**, jamais en
désactivant le module : `requiresPlugin` s'évalue sur `isLoaded()`, donc un profil à
`enabled: false` laisserait le bouton rendu et le test mesurerait autre chose.

⚠️ **Trois défauts que seul ce test rendait**, tous de la même famille — une déclaration correcte
d'un côté, jamais atteinte depuis l'autre, et rien ne rougit :

| Le défaut                                                                  | Ce qui le rendait invisible                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `labelField` du plugin ≠ `payloadFields` du profil (`name` contre `Name`)  | Aucun schéma n'exprime la règle ; la destination perd son nom |
| Widget déclaré sur une couche que le profil n'enregistre pas               | Déclaration valide, gatée verte, popup jamais ouverte         |
| `profiles/tourism/config/plugins/routing.json` absent du `Files` du profil | Fichier sur le disque, valide, jamais lu                      |

⚠️ La troisième ligne nomme le fichier **depuis la racine du dépôt**, alors que la carte `Files`
d'un profil le déclare relativement à ce profil — donc sans son préfixe. Les deux désignent le même
fichier. C'est la forme absolue qui est écrite ici, pour deux raisons : cette fiche part dans le
dépôt public, où une forme relative à un profil ne s'ouvre pas ; et la gate SPECS-PATHS résout tout
jeton de chemin, si bien que **récrire la forme relative dans cette note la ferait rougir** — y
compris entre backticks, qui ne protègent de rien. Le défaut est déjà arrivé, deux fois.

---

## `NavProgress.rerouteFailure` — le motif que le guidage rapporte

Ajouté le 22/08/2026 (tâche 5.6 du sprint navigation). Le champ est **optionnel** et porte l'une
des six causes de `RouteFailure`.

⚠️ Il vit ici, dans le modèle de ce paquet, pour la même raison que `NavProgress` lui-même :
`navigation` dépend de `routing` et jamais l'inverse, donc un type que les deux côtés nomment doit
vivre du côté qui ne dépend pas de l'autre. Le partager dans l'autre sens ferait du paquet léger un
prérequis du lourd.

🛑 **Il est produit par `navigation`, jamais par ce paquet.** Aucun fournisseur ne le remplit : il
rapporte ce qu'une tentative de recalcul a répondu, et cette tentative appartient au guidage.

---

## Le passage au guidage

Ajouté le 21/08/2026 (tâche 4.15 du sprint navigation). Le panneau porte un bouton
« Démarrer le guidage » qui charge `@geoleaf-plugins/navigation` puis lui remet l'itinéraire.

🛑 **Le bouton n'existe que si le guidage est joignable, et le garde est l'ABSENCE du handler** :
le contrôleur ne fournit `onStartGuidance` que lorsque le plugin est là, et le panneau ne crée alors
rien du tout. Un bouton désactivé dirait « ça existe, mais pas pour vous », ce qui est faux pour un
intégrateur qui ne l'a pas installé.

⚠️ **La disponibilité se teste par `isLazyAvailable`, JAMAIS par `isLoaded`.** `navigation` est
paresseux : il n'entre au registre qu'après son chargement, et le seul geste qui le chargerait est
ce bouton. C'est le piège que **D2** décrit pour ce paquet-ci, rencontré depuis l'autre côté.

⚠️ **Aucune valeur n'est importée de `navigation`** — le chargement passe par
`GeoLeaf.plugins.load()` et l'appel par `GeoLeaf.Navigation`, c'est-à-dire par le namespace, à
l'exécution. La dépendance npm reste dans l'autre sens, et elle reste en `import type` seul.

🛑 **Un panneau NEUF ne garde aucun itinéraire d'une session précédente.** `lastRoute` est remis à
`null` à l'ouverture : le laisser survivre ferait démarrer le guidage sur un tracé que l'utilisateur
ne voit plus — le panneau neuf n'affiche aucune figure, et le bouton serait parti sur l'ancien
calcul. **Un guidage qui suit une ligne qu'on n'a pas sous les yeux a l'air de marcher**, ce qui est
le pire des deux mondes.

---

⚠️ **Le README du paquet est la surface la plus LUE, et aucune gate ne la compare à la
configuration réelle.** Il part dans le tarball npm, il est immuable une fois publié, et
`check-config-coverage` ne le regarde pas — elle compare le schéma, l'inventaire et le code, trois
surfaces internes. Mesuré le 22/08/2026 : il documentait **2 clés sur 8**. La table y est
désormais complète ; c'est une relecture qui l'a corrigée, pas un instrument, et rien n'empêche la
divergence de revenir.

---

## 🛑 Attribution — une obligation de licence, pas un élément d'interface

Les deux moteurs livrés calculent sur **OpenStreetMap**. Son ODbL autorise l'usage commercial et
n'impose rien à repartager pour un itinéraire tracé sur une carte, mais elle impose **l'attribution
partout où l'œuvre dérivée est montrée**. Une carte qui affiche un itinéraire calculé sans créditer
la donnée n'est pas une carte à laquelle il manque un agrément : elle est hors conformité.

⚠️ **Et celui qui l'est, c'est l'INTÉGRATEUR** — c'est lui qui publie la carte. C'est le motif de
tout ce qui suit : une étape de conformité qu'un intégrateur doit penser à faire est une étape que
certains ne feront pas, sans le savoir.

| Pièce                         | Ce qu'elle garantit                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `IRouteProvider.attribution`  | **requis** — un moteur déclare le crédit que sa donnée exige                            |
| `createProvider()`            | **REFUSE** un fournisseur dont la mention est absente ou vide, en le nommant au journal |
| `RouteResult.attribution`     | le crédit voyage avec la DONNÉE, pas avec la configuration                              |
| `publishRoute` / `clearRoute` | le crédit monte avec la géométrie et descend avec elle                                  |
| `getProvider()`               | rend l'identifiant **et** la mention du fournisseur configuré                           |

### Pourquoi le crédit est porté par le RÉSULTAT et non lu dans la configuration

Un itinéraire calculé par un moteur peut rester tracé après qu'on a repointé le profil vers un
autre. Lire le fournisseur actif créditerait alors une source qui n'a pas produit ce que
l'utilisateur regarde. **Le crédit appartient à la donnée, donc il voyage avec elle.**

### Pourquoi refuser plutôt que substituer un crédit par défaut

Inventer « © OpenStreetMap contributors » pour un moteur inconnu serait **pire** que le silence :
ce serait attribuer des données à une source qui ne les a peut-être pas produites — une affirmation
fausse au lieu d'une manquante. Un moteur qui ne doit réellement aucun crédit le dit par une chaîne
explicite, ce qui est une décision prise plutôt qu'un champ oublié.

### Pourquoi l'attribution est liée au TRACÉ et non au panneau

Le panneau se ferme ; le tracé reste. Créditer depuis le panneau mettrait la mention à l'écran
pendant qu'on regarde les contrôles, et l'enlèverait pendant qu'on regarde ce qui doit être crédité.
**ODbL n'a pas de période de grâce pour « le panneau était fermé ».**

### Pourquoi le plugin dessine la sienne plutôt que d'utiliser le contrôle de la carte

Le contrôle d'attribution du moteur de rendu affiche ce que ses **sources** déclarent, et la couture
par laquelle ce plugin publie — `GeoLeaf.Layers.setData` — porte des entités, pas des métadonnées de
source. Passer outre pour atteindre la carte native ferait du plugin le second écrivain de ses
sources, ce que `publish.ts` existe précisément pour éviter.

⚠️ **Une garde de SOURCE couvre l'adaptateur qui n'existe pas encore.** Les deux actuels sont
éprouvés par des tests de comportement ; le troisième, ajouté dans six mois, ne le serait pas — et
ne rougirait nulle part avant d'être livré sans crédit. Un test lit le répertoire `providers/` et
exige de chaque fichier une `attribution` non vide, avec son assertion anti-gate-vide.

## La numérotation des étapes — une couture du cœur, et AUCUN changement du cœur

`src/labels-seam.ts`, appelé par `publishRoute` après `setData` et par `clearRoute` après le retrait
de l'attribution.

Les entités d'étape publiées portent `properties.step` (`1`, `2`, `3`…). La capacité `labels` du
cœur les rend, à qui le lui demande :

```ts
GeoLeaf?.Labels?.enableLabels(layerId, { enabled: true, labelId: "step" }, true);
```

⚠️ **Les deux `?.` ne sont pas de la prudence d'écriture, et c'est la gate qui l'a rappelé.** Cet
exemple était d'abord écrit sans eux ; `typecheck-docs-examples` a rendu deux `TS18048` — _`GeoLeaf`
is possibly `undefined`_, _`GeoLeaf.Labels` is possibly `undefined`_. Un exemple **plus confiant que
le code qu'il décrit** est copiable-collable, et il casse chez le premier intégrateur dont le profil
désactive la capacité. C'est la valeur exacte d'une gate qui compile la documentation : elle a
attrapé une affirmation que la relecture avait laissée passer, dans le paragraphe même qui explique
pourquoi la capacité est optionnelle.

🛑 **Cette section atteste une prémisse INFIRMÉE, et le motif vaut au-delà d'elle.** La tâche a été
bloquée trois jours sur un arbitrage — élargir le contrat de l'adaptateur de carte, ou ouvrir une
couture publique sur `labels` —, au motif que la capacité « n'exporte rien de son moteur de rendu ».
**Mesuré, elle l'exportait déjà** : `enableLabels` vient de `LabelsApi`, avec lequel
`LabelsPublicApi` est composé ; le rendu fait `["get", labelConfig.labelId]`, donc la propriété
voyage dans le config que l'appelant passe ; et `_hasConfigLabel` n'exige que deux clés, tout le
reste étant complété par un défaut.

⚠️ **Ce qui a fait croire à un mur : avoir lu `public-api.ts` SEUL**, qui n'ajoute qu'`isEnabled` et
`getConfig`. La surface réelle vivait dans le type avec lequel il est composé, un fichier plus loin.
L'énoncé était **littéralement vrai et globalement faux** — la forme qui résiste le mieux à la
relecture, puisque re-vérifier la phrase la confirme. **Une API se mesure en l'appelant ou en lisant
le type qu'elle publie, jamais le seul fichier qui la monte.**

### Pourquoi c'est une couture et non une dépendance

Même raison que le géocodage : `labels` est une capacité qu'un profil peut désactiver, donc elle est
lue sur `globalThis.GeoLeaf` **à l'appel**, jamais importée. Sans elle le tracé s'affiche — les
étapes ne portent simplement pas de numéro, ce que ce paquet faisait jusqu'ici.

### Ce qui casserait sans que rien ne rougisse

La propriété est une **moitié de paire** : `labels-seam.ts` la nomme en constante, `publish.ts`
écrit `step: i + 1`. Deux littéraux dans deux fichiers qui doivent s'accorder, et un renommage
cesserait d'étiqueter **en silence** — d'où un test qui lit la propriété que `routeFeatures` écrit
plutôt que de la répéter. De même, retirer la clé `enabled` fait refuser `_hasConfigLabel` : rien ne
s'affiche, **sans erreur**, ce qui est le pire des deux échecs. Vu rouge sur les deux mutations.

## Le cadrage après calcul — la carte bouge SEULEMENT si le tracé n'est pas déjà là

`src/fit-route.ts`, appelé par `show()` après une publication **réussie**.

🛑 **Il n'y a pas de clé de configuration, et c'est le résultat d'un arbitrage** (tâche 3.3), pas un
oubli. Trois autres règles étaient sur la table :

| Règle                       | Ce qu'elle coûte                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Inconditionnel              | déplace la carte de quelqu'un qui venait de zoomer sur un carrefour — au moment où il agit dessus               |
| Une clé `fitOnCompute`      | pose une préférence sur cinq surfaces gatées là où la géométrie répond ; chaque intégrateur doit alors trancher |
| Au premier calcul seulement | ne surprend jamais, n'aide jamais : une étape ajoutée hors champ reste invisible                                |

**Lire la géométrie répond sans demander à personne** : si le tracé est déjà à l'écran, bouger est
du bruit ; s'il n'y est pas, ne pas bouger laisse une carte vide. Il n'y a pas de préférence, il y a
un fait.

⚠️ **Aucune marge de confort dans le test d'inclusion.** Un tracé qui touche le bord de la vue EST à
l'écran, et inventer une marge rendrait la règle imprévisible depuis ce qu'on voit.

⚠️ **La boîte est construite sur les POINTS, pas sur la ligne décodée.** Un fournisseur accroche les
étapes au réseau, donc un point peut se trouver à quelques mètres de la ligne qu'il a produite :
cadrer sur la seule ligne laisse parfois un marqueur juste hors champ — la première chose qu'on
cherche.

⚠️ **Ce qui n'est PAS traité, nommé plutôt que faux en silence** : un itinéraire franchissant
l'antiméridien. Sa boîte englobante dégénère en une boîte planétaire et le cadrage dézoomerait sur
le monde. Le traiter demande de découper la géométrie — un vrai travail, sans consommateur ici, les
itinéraires de ce dépôt étant régionaux.

## Le quota — ce qui part vraiment sur le réseau

🛑 **La ligne de backlog qui a motivé ce lot disait faux, et le compteur l'a démenti.** Elle
annonçait qu'« une composition modifiée trois fois de suite émet trois calculs complets ». Mesuré :
elle en émet **zéro**. `compute()` n'est atteint que depuis le bouton ; modifier la liste efface le
tracé et s'arrête là.

Ce qui dépense réellement du quota, sur la même mesure :

- **appuyer plusieurs fois** sur « calculer » — ce que les gens font après un échec, après une
  réponse lente, ou simplement deux fois. **Rien ne l'empêchait** : le bouton n'était désarmé que
  sur une liste non routable ;
- **recalculer après un aller-retour** — ajouter une étape, la retirer, réappuyer.

| Pièce                     | Ce qu'elle couvre                                                 |
| ------------------------- | ----------------------------------------------------------------- |
| Garde de ré-entrance      | les appuis qui arrivent pendant qu'une réponse se fait attendre   |
| `route-cache.ts`          | la demande identique, quel que soit le temps écoulé               |
| `__tests__/quota.test.ts` | **le compteur** — sans lui, les deux au-dessus sont invérifiables |

⚠️ **Un drapeau et non un anti-rebond temporisé.** Une temporisation RETARDERAIT un appui explicite,
qui est le geste qu'un utilisateur est en droit de voir répondre tout de suite. La garde ne refuse
que ce qui arrive pendant que la première réponse se fabrique — et elle est relâchée dans un
`finally`, parce qu'une garde coincée transforme une panne passagère en panneau définitivement
inutilisable.

### Ce que la clé de cache porte, et pourquoi chaque terme y est

**Le mode et la langue.** Le narratif vient du moteur, dans la langue qu'on lui a demandée : une clé
sans la langue servirait à un conducteur français les instructions anglaises calculées une minute
plus tôt — le même tracé, la mauvaise voix, et rien à l'écran pour l'expliquer.

**L'ordre des étapes.** L'inverser est un autre trajet, et un fournisseur y répond autrement.

**Les coordonnées ARRONDIES au mètre.** Une étape choisie sur la carte porte toute la précision d'un
flottant : re-choisir le « même » endroit donnerait une clé différente et le cache serait décoratif.

⚠️ **Un échec n'est jamais mis en cache** — le mettre rendrait une panne réseau permanente pour le
reste de la session, avec un « réessayer » qui ne quitte jamais la page.

⚠️ **Il n'y a pas d'expiration**, et c'est juste **pour les moteurs livrés**, qui calculent en flux
libre. Un moteur sensible au trafic rendrait ce cache **faux** et non simplement périmé : c'est le
paragraphe à rouvrir le jour où l'on en ajoute un.

## Frontières

- **Vers le cœur** : par `globalThis.GeoLeaf.*` uniquement. Les types des contrats sont importés en
  `import type` ; aucune implémentation du cœur ne l'est (INV-NS).
- **Vers `navigation`** : aucune. La flèche va dans l'autre sens, et elle ne porte que des types.
- **Vers le rendu** : le plugin publie sa géométrie par la couture du cœur. Il ne crée pas de
  source MapLibre, il ne dessine pas.
- **Vers un backend d'hôte** : hors périmètre. Le contrat de fournisseur peut l'accueillir plus
  tard ; un adaptateur adossé au connecteur de l'application hôte se nommerait par sa **fonction**.
