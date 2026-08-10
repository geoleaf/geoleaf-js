---
type: spec-lib
title: host-runtime — l'accès typé au namespace, et les seams que les plugins partagent
lib_id: host-runtime
package: "@geoleaf/host-runtime"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 21630103
date: 28 juillet 2026
---

# host-runtime — l'accès typé au namespace, et les seams que les plugins partagent

**Type :** bibliothèque partagée **interne** · **Paquet :** `@geoleaf/host-runtime` ·
**Code :** `packages/libs/host-runtime/` · **Vérifié contre :** `21630103` (28/07/2026)

> **Deux règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.

> ⚠️ **Cette fiche n'a PAS de CDC source.** C'est la seule des 37 du §2.4 écrite **entièrement depuis
> le code**, parce que ce paquet est né d'une consolidation et non d'une spécification. Et **aucune
> gate documentaire ne la lit** : les deux gardes du §2.4 visent les capacités et les plugins. Sa
> véracité repose entièrement sur sa relecture — règle ⛔ de `CLAUDE.md`, sans filet mécanique.

> ⚠️ **`private: true` — ce paquet n'est JAMAIS publié sur npm.** Il n'a pas de `publishConfig`. Il
> est **regroupé à la construction** dans chacun des paquets qui l'utilisent, et se déclare donc en
> dépendance de **développement**, jamais d'exécution.

---

## Périmètre

### Ce que la bibliothèque fait

Elle donne aux plugins **un** accesseur typé vers le namespace global que le core assemble au
démarrage, **une** forme partagée de ce namespace, et les utilitaires qu'ils avaient tous
réimplémentés chacun de son côté : journalisation, notifications, libellés, accès à la carte native,
fabrication d'éléments, et des primitives HTTP.

### Ce qu'elle ne fait pas

- **Elle n'importe RIEN de `@geoleaf/core` — pas même un type.** C'est un **contrat de paquet**,
  écrit comme tel dans son en-tête, et il est porteur : importer le core y tirerait le core entier —
  effets de bord de démarrage compris, non élaguables — dans **chaque** paquet de plugin.
- **Elle ne remplace pas le namespace.** Elle le **lit**. Si le core n'est pas là, l'accesseur rend
  `undefined` plutôt que d'échouer.
- **Elle n'est pas un plugin** : ni `entry.ts`, ni enregistrement, ni montage.
- **Elle ne prétend pas typer le namespace complètement.** La forme est **délibérément permissive**.

---

## Surface publique

Exportée par `src/index.ts`. Trois familles, plus les primitives HTTP.

| Famille                   | Exports                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accès à l'hôte**        | `getGeoLeaf()` · `ensureGeoLeaf()` · `coreConfigGet(...)` · types `GeoLeafHost`, `PluginRegisterOptions`                                                  |
| **Seam notifications**    | `getUINotifications()` · type `UINotificationsSeam`                                                                                                       |
| **Seam journalisation**   | `Log`                                                                                                                                                     |
| **Seam i18n**             | `tLabel(...)` · `getActiveLang()`                                                                                                                         |
| **Seam utilitaires core** | `getNestedValue(...)` · `createSVGIcon(...)` · `clearElementFast(...)` · type `IconOptions`                                                               |
| **Seam carte**            | `getNativeMap()` · `warnNoCore(...)`                                                                                                                      |
| **Seam DOM**              | `createEl(...)` · `applyStyleText(...)`                                                                                                                   |
| **Téléchargement**        | `downloadBlob(...)`                                                                                                                                       |
| **Interface partagée**    | `adoptStylesheet(...)` · `wireDrag(...)` · `wireTouchDrag(...)` · `wireTooltips(...)` · `showTooltip(...)` · `hideTooltip(...)` · `positionMenuNear(...)` |
| **HTTP**                  | `jsonHeaders(...)` · `bearer(...)` · `fetchWithTimeout(...)` · `parseJsonBody(...)` · `HttpFetchError` + deux types                                       |

⚠️ **Deux fonctions de glissement ne sont PAS ré-exportées** par l'entrée, bien qu'exportées par leur
module : la lecture et l'application du décalage. Elles sont donc atteignables par sous-chemin et
absentes de la surface annoncée — un demi-état qu'il vaut mieux connaître avant de s'y fier.

---

## Les trois raisons d'être — chacune est une consolidation

L'en-tête du paquet annonce **« deux parties »** et en liste **trois**. Petite scorie interne, mais
elle masque le fait le plus utile : les trois blocs ne viennent pas du même sprint ni du même
problème.

### 1. Un seul accesseur, une seule forme

Avant, **chaque** plugin écrivait sa propre conversion de `globalThis` — réintroduisant le type
permissif que le dépôt bannit — et redéclarait sa vue partielle du namespace. **Ces vues avaient
divergé** : les sept interfaces privées d'options d'enregistrement en sont l'exemple mesuré — deux
omettaient `requires`, deux omettaient la vérification de chargement, et cinq portaient encore un
champ que le contrat avait abandonné.

⚠️ **La forme reste volontairement permissive**, avec une queue ouverte. Les façades des plugins —
`Measure`, `Print`, `Editor`, `AddPOI` — y vivent, et sont resserrées **localement** par leurs
consommateurs. La précision progresse sprint par sprint, en miroir de la déclaration du core.

⚠️ **`getGeoLeaf` a un JUMEAU dans le core**, et le couple est **épinglé** par
`scripts/verify-seam-drift.cjs` sous le nom de seam `host-global`. C'est une copie **délibérée**,
inévitable puisque ce paquet ne peut rien importer du core — et elle est donc surveillée plutôt que
tolérée. La gate de fork d'utilitaires exempte les deux côtés **précisément parce que** l'autre les
tient.

### 2. Les seams que treize plugins réimplémentaient

Journalisation, notifications, libellés, carte native, fabrication d'éléments, valeur imbriquée,
icône SVG, vidage rapide. Chacun existait en autant d'exemplaires que de plugins.

### 3. Les primitives HTTP, absorbées d'un paquet dissous

En-têtes JSON, jeton porteur, requête à délai, lecture de corps, et un type d'erreur. Elles venaient
d'un paquet distinct, replié ici : deux consommateurs ne justifiaient pas un paquet.

---

## Onboarding — trois étapes, et la troisième casse la CONSTRUCTION

C'est le point le plus coûteux du paquet, et son en-tête l'écrit : la troisième étape est facile à
oublier, et **elle ne casse pas le typage — elle casse la construction**.

| Étape | Où                  | Quoi                                                                                                                     |
| ----- | ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1     | `package.json`      | Une entrée en **`devDependencies`** — jamais en dépendance d'exécution                                                   |
| 2     | `tsconfig.json`     | Un `paths` vers les types construits de la bibliothèque                                                                  |
| 3     | `rollup.config.mjs` | **Neutraliser les `paths`** côté TypeScript, pour que le regroupement résolve le module construit par la résolution Node |

⚠️ **Sans la troisième, le typage passe et la construction échoue.** C'est exactement le genre
d'écart que la vérification et l'assemblage ne voient pas au même moment.

---

## Décisions de conception

| Décision                                                    | Pourquoi                                                                                                                                                                                                                                             | Alternative écartée                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **N'importer RIEN du core, pas même un type**               | Un import de type se supprime à la compilation… mais rien ne garantit qu'il le reste au premier refactor. Interdire la **catégorie** est plus sûr qu'interdire les valeurs — et le coût d'une erreur est le core entier dans chaque paquet de plugin | Importer les types seuls            |
| **Redéclarer la forme du namespace plutôt que la partager** | C'est le corollaire du précédent : la copie est le **prix** du contrat de paquet. Elle est donc **épinglée** par une gate de dérive, pas laissée à la vigilance                                                                                      | Un paquet de types commun           |
| **Une forme permissive, resserrée par sprint**              | Un typage strict d'emblée aurait forcé à décrire un namespace qui s'assemble progressivement et varie selon le paquet. La queue ouverte laisse la précision croître sans bloquer                                                                     | Un typage strict immédiat           |
| **`private: true`, jamais publié**                          | C'est une consolidation **interne**. Le publier créerait une surface publique à maintenir pour un objet dont la forme suit celle du core                                                                                                             | Le publier comme `field-renderer`   |
| **Dépendance de DÉVELOPPEMENT, regroupée**                  | Une dépendance d'exécution obligerait l'intégrateur à l'installer, et ferait coexister plusieurs versions. Regroupée, chaque paquet embarque la sienne                                                                                               | Une dépendance d'exécution          |
| **`getGeoLeaf()` rend `undefined` plutôt que de jeter**     | Un plugin peut être évalué avant le core, ou sans lui. Rendre `undefined` laisse l'appelant dégrader ; jeter tuerait le chargement                                                                                                                   | Jeter quand le namespace est absent |
| **Les primitives HTTP repliées ici**                        | Deux consommateurs ne justifiaient pas un paquet séparé — et le paquet séparé, lui, devait être versionné et publié                                                                                                                                  | Garder un paquet dédié              |

---

## Dépendances et frontières

**Aucune dépendance de production. Aucune dépendance pair. Aucun import de `@geoleaf/core`.**

### Trois gardes surveillent ce paquet, et il faut savoir laquelle fait quoi

| Garde                           | Ce qu'elle tient                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `verify-seam-drift.cjs`         | Le couple `getGeoLeaf` core ↔ bibliothèque, sous le seam **`host-global`**                                    |
| `verify-plugin-shared-fork.cjs` | Qu'un plugin ne **recopie** pas ce que ce paquet fournit — **en exemptant les deux côtés du couple ci-dessus** |
| `verify-host-contract-sync.cjs` | La synchronisation des contrats du namespace                                                                   |

⚠️ **L'exemption de la deuxième est ce qui rend la première indispensable.** Sans la gate de dérive,
le couple `getGeoLeaf` serait la seule copie du dépôt que **rien** ne surveille — exemptée d'un côté,
invisible de l'autre.

### Les consommateurs

Tous les plugins qui parlent au namespace, en dépendance de **développement**.
`addpoi` faisait exception (fusionné dans [`editor`](../plugins/CDC_editor.md) au Sprint 5) : il le **déclarait** et son `entry.ts` **ne s'en
sert pas**, préférant une conversion de `globalThis` faite à la main — c'est-à-dire exactement la
forme que ce paquet existe pour supprimer, et le dernier site à ne pas l'avoir adoptée.

---

## Ce qu'il n'y a pas à comparer

**Aucun CDC source n'existe pour ce paquet** — il n'y a donc pas de §Écarts. Il n'est pas né d'une
spécification mais de trois consolidations successives, et sa documentation d'origine est **l'en-tête
de son propre `index.ts`, qui est riche et à jour**. Cette fiche en est la mise au propre, augmentée
de ce que seule la mesure donne : les trois gardes qui le surveillent et la façon dont elles se
complètent, et le fait qu'un consommateur le déclare sans l'utiliser.

⚠️ **Une scorie relevée au passage** : l'en-tête annonce « deux parties » et en liste **trois**. Sans
conséquence, mais c'est le genre de compte qui dérive — et ce paquet est précisément celui qui n'a
pas de gate pour le rattraper.
