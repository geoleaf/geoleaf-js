---
type: spec-lib
title: host-runtime — l'accès typé au namespace, et les seams que les plugins partagent
lib_id: host-runtime
package: "@geoleaf/host-runtime"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: fab770b1
date: 1er septembre 2026
---

# host-runtime — l'accès typé au namespace, et les seams que les plugins partagent

**Type :** bibliothèque partagée **interne** · **Paquet :** `@geoleaf/host-runtime` ·
**Code :** `packages/libs/host-runtime/` · **Vérifié contre :** `fab770b1` (01/09/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **Cette fiche n'a PAS de CDC source.** C'est la seule fiche du §2.4 écrite **entièrement depuis
> le code**, parce que ce paquet est né d'une consolidation et non d'une spécification. (Le corpus se
> dénombre à la commande — `ls docs/specs/plugins/` et ses voisins —, jamais en prose : le nombre qui
> était écrit ici avait déjà divergé.)
>
> 🛑 **« Aucune gate documentaire ne la lit » est FAUX depuis le 11/08/2026.** Les deux gardes de
> CONTENU du §2.4 visent bien les seules capacités et les plugins, mais **deux gates de FORME lisent
> cette fiche** : `SPECS-PATHS` (`npm run check:specs-paths`, moteur
> `scripts/audit-report-freshness.cjs`) juge que chaque chemin qu'elle cite résout, et `SPECS-FRESH`
> (`scripts/check-specs-verified-against.cjs`) juge son `verifie_contre` — cette fiche y est
> d'ailleurs **gelée**, dans `scripts/.baselines/specs-verified-against.json`, c'est-à-dire connue en
> retard sur son sujet. ⚠️ Aucune des deux ne juge la VÉRACITÉ d'une phrase, et `SPECS-PATHS` ne voit
> même pas un nom de fichier cité **sans `/`** : la véracité repose donc toujours sur la relecture.

> ⚠️ **`private: true` — ce paquet n'est JAMAIS publié sur npm.** Il n'a pas de `publishConfig`. Il
> est **regroupé à la construction** dans chacun des paquets qui l'utilisent, et se déclare donc en
> dépendance de **développement**, jamais d'exécution.

---

## Périmètre

### Ce que la bibliothèque fait

Elle donne aux plugins **un** accesseur typé vers le namespace global que le core assemble au
démarrage, **une** forme partagée de ce namespace, et les utilitaires qu'ils avaient tous
réimplémentés chacun de son côté : journalisation, notifications, libellés, accès à la carte native,
fabrication d'éléments, **la plomberie d'interface partagée** (adoption de feuille, glissement
souris et tactile, infobulles, ancrage de sous-menu flottant, coquille de modale, boîte de
confirmation, piège de focus) et des primitives HTTP.

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

| Famille                   | Exports                                                                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accès à l'hôte**        | `getGeoLeaf()` · `ensureGeoLeaf()` · `coreConfigGet(...)` · types `GeoLeafHost`, `PluginRegisterOptions`                                                                                                                                                                          |
| **Seam notifications**    | `getUINotifications()` · type `UINotificationsSeam`                                                                                                                                                                                                                               |
| **Seam journalisation**   | `Log`                                                                                                                                                                                                                                                                             |
| **Seam i18n**             | `tLabel(...)` · `getActiveLang()`                                                                                                                                                                                                                                                 |
| **Seam utilitaires core** | `getNestedValue(...)` · `createSVGIcon(...)` · `clearElementFast(...)` · type `IconOptions`                                                                                                                                                                                       |
| **Seam carte**            | `getNativeMap()` · `warnNoCore(...)`                                                                                                                                                                                                                                              |
| **Seam DOM**              | `createEl(...)` · `applyStyleText(...)`                                                                                                                                                                                                                                           |
| **Téléchargement**        | `downloadBlob(...)`                                                                                                                                                                                                                                                               |
| **Interface partagée**    | `adoptStylesheet(...)` · `wireDrag(...)` · `wireTouchDrag(...)` · `wireTooltips(...)` · `showTooltip(...)` · `hideTooltip(...)` · `positionMenuNear(...)` + type `MenuPositionOptions`                                                                                            |
| **Surfaces modales**      | `createModalShell(...)` · `confirmDialog(...)` · `createFocusTrap(...)` + types `ModalShell`, `ModalShellOptions`, `ConfirmDialogOptions`, `FocusTrap` — arrivées de `field-renderer` le 06/08/2026 (`src/ui/modal-shell.ts`, `src/ui/confirm-dialog.ts`, `src/ui/focus-trap.ts`) |
| **HTTP**                  | `jsonHeaders(...)` · `bearer(...)` · `fetchWithTimeout(...)` · `parseJsonBody(...)` · `isSameOrigin(...)` · `HttpFetchError` + deux types                                                                                                                                         |

⚠️ **Deux fonctions de glissement ne sont PAS ré-exportées** par l'entrée, bien qu'exportées par leur
module : la lecture et l'application du décalage. ⚠️ **Elles ne sont PAS « atteignables par
sous-chemin »**, ce que cette ligne a affirmé : la carte `exports` du `package.json` ne déclare que
`.` et `./package.json`, la résolution `Bundler` de `packages/build-config/tsconfig.base.json`
l'honore, et `rollup.config.mjs` n'émet qu'un seul fichier de sortie. Ce ne sont donc pas des exports
en demi-état mais des helpers **internes au paquet** — leur seul consommateur est `src/ui/touch-drag.ts`,
qui partage la géométrie avec le chemin souris pour qu'ils ne divergent pas.

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
`Measure`, `Print`, `Editor`, … — y vivent, et sont resserrées **localement** par leurs
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

## 🛑 Les feuilles de style `.lazy.css` — et pourquoi la forme de l'import ne suffit pas

Trois seams de ce paquet apportent leur propre feuille : `tooltip`, `modal-shell`,
`confirm-dialog`. Elles sont nommées **`*.lazy.css`** et adoptées **au moment de l'appel**, par
`adoptStylesheet(css, key)`. Ce n'est pas un raffinement : c'est un correctif.

**Le défaut, mesuré le 27/08/2026.** Elles portaient un import d'effet de bord en tête de
module. Le build en fait une adoption **inconditionnelle** dans `document.adoptedStyleSheets` —
un effet de bord que rollup ne peut pas supprimer. Or ce paquet est **inliné dans chaque
plugin** : le JS des trois seams était bien élagué des bundles qui ne les appellent pas, la CSS
non. Résultat : **9 bundles de plugin portaient 5,05 Ko gz de feuilles pour des composants qui
n'y étaient pas**, adoptées à chaque chargement de page. `position-share` en payait 12 % de son
poids.

⚠️ **Changer la forme de l'import ne corrige RIEN**, et c'est le piège à connaître avant d'y
toucher : `rollup-plugin-postcss` émet `export default <css>` pour tout module CSS de toute
façon, et appose l'injecteur pareillement. Seul le suffixe agit — `packages/build-config/csp-style-inject.mjs` teste
l'identité du module et n'émet aucune injection pour `*.lazy.css`.

### Ce qui garde la propriété, et ce qui ne peut pas la garder

| Instrument                                                 | Ce qu'il voit                                                                                                                                                                                      |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkOrphanStylesheets` (`scripts/check-bundle-size.cjs`) | **La moitié qui compte.** Une classe marqueur présente **exactement une fois** dans un bundle bâti = la feuille est là, son JS non. Vu rouge sur mutation : 8 plugins, exit 1                      |
| `src/__tests__/lazy-stylesheets.test.ts`                   | **L'autre moitié seulement** : que chaque seam adopte à l'appel, une seule fois                                                                                                                    |
| Tout le reste                                              | **Rien.** Le budget de bundle mesure ce qu'un bundle CONTIENT, pas ce qu'il devrait ; `verify-purgecss` compare des sources et ces feuilles y sont vivantes — juste pas chez ceux qui les payaient |

🛑 **Et la suite unitaire ne peut PAS garder la première moitié**, ce qui vaut d'être écrit
plutôt que supposé : sous vitest l'injecteur du build n'est jamais exécuté, donc remettre
l'import de portée module laisse la suite **verte**. Éprouvé par mutation, dans les deux sens.

⚠️ Le commentaire de `tooltip.ts` disait « les cinq plugins qui n'appellent jamais `wireTooltips`
sont inchangés octet pour octet, donc l'effet de bord ne fuit pas par le baril ». C'était **vrai
et plus étroit que ça n'en avait l'air** : il avait mesuré cinq paquets propres, jamais demandé
ce qu'il advenait d'un paquet qui tire ce module pour une AUTRE raison. Un effet de bord qui ne
fuit pas chez ceux qu'on a regardés n'est pas un effet de bord qui ne fuit pas.

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

| Garde                                   | Ce qu'elle tient                                                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/verify-seam-drift.cjs`         | Le couple `getGeoLeaf` core ↔ bibliothèque, sous le seam **`host-global`**                                                                                                        |
| `scripts/verify-plugin-shared-fork.cjs` | Qu'un plugin ne **recopie** pas ce que ce paquet fournit — **en exemptant les deux côtés du couple ci-dessus**                                                                    |
| `scripts/check-shipped-specifiers.cjs`  | SHIP-SPEC-02 — qu'aucun fichier atteignable ne **nomme** ce workspace `private` ; il est scanné bien qu'il n'ait pas de tarball, parce qu'il part inliné dans les bundles publiés |
| `scripts/verify-host-contract-sync.cjs` | HOST-01/02/03 — `GeoLeafHost` ⊆ `GeoLeafGlobal`, et aucun des deux ne nomme un membre que le boot ne monte pas                                                                    |

⚠️ **L'exemption de la deuxième est ce qui rend la première indispensable.** Sans la gate de dérive,
le couple `getGeoLeaf` serait la seule copie du dépôt que **rien** ne surveille — exemptée d'un côté,
invisible de l'autre.

### Les consommateurs

Tous les plugins qui parlent au namespace, en dépendance de **développement** — et **`@geoleaf/field-renderer`
aussi**, qui n'est pas un plugin. Depuis le 06/08/2026 la plomberie d'interface a migré de lui vers
ce paquet, et `packages/libs/field-renderer/src/ui/responsive-modal.ts` importe désormais
`createFocusTrap` et `confirmDialog` d'ici : la dépendance va donc `field-renderer` → `host-runtime`,
jamais l'inverse. La liste ne se recopie pas, elle se dérive — `npm run versions:check`, ou un grep
de `"@geoleaf/host-runtime"` dans les `package.json` des workspaces.
`addpoi` faisait exception (fusionné dans [`editor`](../plugins/CDC_editor.md)) : il le **déclarait** et son `entry.ts` **ne s'en
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
