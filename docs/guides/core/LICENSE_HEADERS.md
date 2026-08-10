# License Headers in GeoLeaf

Product Version: GeoLeaf Platform V3

This guide explains how license headers are used in GeoLeaf and how to add them to new files.

Core sources are under `packages/core/src/` (**TypeScript**). Paths below are relative to the repository root. ⚠️ _Ce guide disait « under `src/` (JavaScript) » jusqu'au 27/07/2026._

---

## Standard MIT License Header

Every TypeScript source under a package's `src/` carries this block, first thing in the file:

```javascript
/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
```

### Format Rules

1. **Placement**: Header must be the **first thing** in the file, before all other code and comments
2. **Format**: `/*!`, **never** `/**`. Ce n'est pas du JSDoc et ce n'est pas un choix de style :
   `/*!` est le marqueur _legal comment_ (esbuild, terser), et `lib/source-inventory.cjs`
   strippe ce bloc AVANT de chercher l'en-tête de module — un `/**` ferait passer des centaines
   de fichiers de « non documenté » à « documenté » et déclencherait MH-02 sur autant d'entrées
   de baseline
3. **No variations**: la ligne d'auteur, la mention MIT et l'URL sont fixées — c'est LIC-01 qui
   les exige, LIC-02 qui refuse toute attribution concurrente
4. **One per file**: un seul bloc, en tête
5. **Version**: dans les **bundles seulement** (`output.banner`), jamais dans les sources —
   `__GEOLEAF_VERSION__` n'y est pas substitué et un numéro figé serait faux au premier
   `npm version`

⚠️ **Le titre (première ligne) n'est PAS imposé.** Il porte souvent une information utile
(`GeoLeaf Core — Language: French (fr)`) et la gate la laisse vivre. Ce qu'elle refuse, c'est
qu'un fichier s'annonce sous le nom d'un **autre** paquet du dépôt — mesuré le 10/08/2026 :
4 fichiers le faisaient, dont deux d'`offline-ui` qui se disaient « GeoLeaf Core ».

---

## Implementation Guide

### Step 1: Verify File Type

- ✅ Le corpus est celui de `lib/source-inventory.cjs:collect()` : les `.ts` sous le `src/` de
  chaque package du registre. **Les sources de ce dépôt sont en TypeScript** — ⚠️ cette ligne
  disait « all `.js` files in `src/` » jusqu'au 10/08/2026, ce qui ne désignait presque rien.
- ❌ Hors corpus, par construction : `.d.ts`, `__tests__/`, `__mocks__/`, `test-utils/`,
  `dist/`, et les `.css` — poser un `/*!` sur une feuille de style ferait décrire chacune par
  son copyright dans `ARBORESCENCE_QUALIFIEE.md` (`leadingComment()` matche `/*!` sans le
  stripper), et `docs:tree:check` rougirait.
- 🖐 Deux exceptions à la main, parce qu'elles ne passent pas par le générateur :
  `packages/core/src/kernel/storage/sw-core.js` (source `.js` recopiée telle quelle en
  `dist/sw-core.js`) et les gabarits de `packages/_plugin-template/`, hors registre.

### Step 2: Insert at Top of File

**Before:**

```javascript
/**
 * Module description...
 */
const myVar = 1;
```

**After:**

```javascript
/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Module description...
 */
const myVar = 1;
```

---

## Where the headers go — les quatre racines réelles

> ⚠️ **Réécrit le 27/07/2026.** Cette section classait les fichiers en 4 catégories de
> priorité, sur une liste de **~28 chemins `src/modules/*`** (`src/modules/poi/`,
> `src/modules/filters/`, `src/modules/table/`, `src/modules/helpers/`…). **La racine
> `src/modules/` n'existe plus** : elle a été éclatée en quatre au R.9, et plusieurs des
> sous-systèmes cités ont été dissous (`poi`) ou sont devenus des capacités ou des plugins.
> La priorisation reposait donc entièrement sur une arborescence disparue — et elle n'a plus
> d'objet de toute façon : la couverture des en-têtes est **gatée**, pas priorisée à la main.

**La règle qui remplace les quatre catégories :** tout fichier source du dépôt porte un bandeau
de licence, et c'est `scripts/check-license-headers.cjs` qui l'exige (LIC-01/02/03), **sans
aucune baseline** — la règle tient à zéro, parce que le geste qui la satisfait est mécanique.

```bash
npm run check:license-headers          # la gate
npm run check:license-headers:write    # pose ou complète les bandeaux manquants
```

🛑 **Ne pas confondre avec `check:module-headers`.** Ce guide renvoyait vers elle jusqu'au
10/08/2026, et **ce n'est pas la gate des en-têtes de licence** : MH-01/02/03 gardent l'en-tête
de MODULE — le bloc `/**` de prose qui décrit ce que fait le fichier —, sur une baseline qui ne
peut que rétrécir. Les deux lisent le même corpus (`lib/source-inventory.cjs`) et gardent deux
objets différents ; c'est d'ailleurs pourquoi le bandeau doit être `/*!` et jamais `/**`.

Les quatre racines de `packages/core/src/` — leur contenu se lit, il ne se recopie pas :

| Racine          | Rôle                                                                  |
| --------------- | --------------------------------------------------------------------- |
| `kernel/`       | les 13 sous-systèmes toujours dans le graphe                          |
| `capabilities/` | une capacité in-core par répertoire, auto-contenue                    |
| `api/`          | les façades `geoleaf.*.ts` — elles exposent, elles n'implémentent pas |
| `app/`          | boot, registre de modules, modules noyau                              |

Plus `adapters/`, `contracts/`, `globals/`, `lang/`, `presets/`, `utils/` et `css/`.
L'inventaire à jour est **généré** : `docs/reference/ARBORESCENCE_QUALIFIEE.md`.

---

## New packages

Every GeoLeaf package is MIT — et c'est LIC-05 qui le tient désormais, `license` valant
exactement `"MIT"` sur les paquets **de ce dépôt**. ⚠️ La règle ne dit rien de leurs
dépendances : `maplibre-gl` est BSD-3-Clause, ce n'est pas une violation.

Le titre se **dérive de `pkg.name`** — le générateur l'écrit tel quel :

```javascript
/*!
 * @geoleaf-plugins/<nom>
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
```

⚠️ **Ce guide prescrivait `GeoLeaf [PackageName]` jusqu'au 10/08/2026, et la moitié du dépôt
le contredisait** : trois familles de nommage coexistent, et 7 paquets sur 15 écrivent
`@geoleaf-plugins/<nom>` ou `@geoleaf/<nom>`. Une convention qu'on ne peut ni dériver ni
mesurer se contredit toute seule ; `pkg.name` tranche, et la gate n'exige que l'appartenance,
pas la forme.

`packages/_plugin-template/` porte ce bandeau — scaffolder depuis lui plutôt que d'en écrire un
à la main (`node scripts/create-plugin.cjs`). ⚠️ **Le scaffold est HORS des globs `workspaces`**
(`!packages/_*`), donc aucune gate ne le voit : c'est le générateur qu'il faut éprouver, en
créant un plugin et en regardant LIC-01 passer sur lui.

---

## Contributing

Pour tout fichier neuf, dans n'importe quel package :

1. ✅ Ne pas l'écrire à la main — `npm run check:license-headers:write` le pose, avec le titre
   dérivé de `pkg.name`. Le geste est idempotent : un second passage ne touche rien.
2. ✅ Le bandeau reste en tête, avant tout le reste, y compris avant le bloc `/**` de module.
3. ✅ Ne jamais modifier ni retirer un bandeau existant — et surtout ne pas normaliser un titre
   descriptif, il porte une information que le générateur ne sait pas reconstruire.
4. ✅ Un bundle neuf reçoit sa notice en passant `pkg` à `pluginStack()` — sans quoi LIC-04
   rougit sur le `.js` expédié.

---

## Verification

La seule vérification qui compte est la gate ; ces commandes ne la remplacent pas :

```bash
npm run check:license-headers          # LIC-01/02/03/04/05
npm run check:license-headers:write    # et le geste qui les satisfait
```

⚠️ **La recette qui vivait ici était `find src -name "*.js" | …`, et elle rendait vide en
sortant 0** : `src/` n'existe pas à la racine du dépôt (les sources sont sous
`packages/*/src/`) et elles sont en `.ts`. Un vérificateur qui ne trouve rien et sort 0 est
exactement ce que ce dépôt appelle un vert qui ne mesure rien — d'où le plancher LIC-03, qui
refuse de conclure sur un corpus effondré.

---

## Questions?

See [NOTICE.md](../../../packages/core/docs/NOTICE.md) for more information about licensing, or [CONTRIBUTING.md](../../../CONTRIBUTING.md) for contribution guidelines.
