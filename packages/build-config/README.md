# @geoleaf/build-config

> Configuration de build partagée du monorepo. Package **privé**, jamais publié sur npm.

Créé au sprint **ARCHI S9** pour rendre la configuration de build déclarative et, surtout, **insensible à la profondeur d'arborescence** — condition posée par le sprint S10, qui a déplacé les paquets sous `packages/plugins/` et `packages/libs/`.

Le compte ne se recopie pas — il se dérive (annoncé « 16 » ici jusqu'au 31/07/2026, mesuré **15**) :

```bash
node -e "const r=require('./scripts/lib/packages.cjs'); console.log(r.all().filter(p=>/^packages\/(plugins|libs)\//.test(p.dir)).length)"
```

## Ce qu'il porte

| Fichier                | Rôle                                | Sprint |
| ---------------------- | ----------------------------------- | ------ |
| `tsconfig.base.json`   | Les 15 `compilerOptions` communs    | S9.1   |
| `rollup.mjs`           | Fabrique de configuration rollup    | S9.2   |
| `csp-style-inject.mjs` | Injecteur CSS compatible CSP        | S9.2   |
| `vitest/*.mjs`         | Base vitest + plugins de résolution | S9.3   |

## Comment on le consomme

Toujours **par specifier npm**, jamais par chemin relatif :

```jsonc
// packages/<un-package>/tsconfig.json
{ "extends": "@geoleaf/build-config/tsconfig.base.json" }
```

```js
// packages/<un-package>/rollup.config.mjs
import { pluginConfig } from "@geoleaf/build-config/rollup.mjs";
```

C'est tout l'intérêt : npm résout par **nom**, donc déplacer le package consommateur ne casse rien. Un `../../` aurait dû être réécrit 17 fois au S10.

## Deux règles non négociables

### 1. Ici, tout est `.mjs` — jamais `.ts`

**C'est un choix de robustesse, pas une contrainte technique.** L'affirmation initiale — « Vite externalise tout specifier nu, donc un `.ts` ici lèverait `ERR_UNKNOWN_FILE_EXTENSION` » — a été **testée et démentie** : un module `.ts` de ce package, importé par specifier npm depuis un `vitest.config.ts`, se charge sans problème, y compris avec `NODE_OPTIONS` explicitement vidé. Vitest transpile le graphe de sa configuration avec son propre chargeur esbuild.

La règle est conservée pour des raisons qui ne dépendent pas de ce comportement :

- `ensure-tsx-node-options.mjs` a pour unique fonction d'installer le chargeur qui serait nécessaire pour le lire. Dépendre d'un transpileur pour charger ce qui installe le transpileur est une circularité qu'on refuse par principe, même là où ça marche aujourd'hui.
- Le comportement de chargement de config de Vitest est un détail d'implémentation, pas un contrat — il a **déjà changé entre v3 et v4**, et c'est précisément ce changement qui a rendu `ensure-tsx-node-options` nécessaire.
- Un `.mjs` se charge aussi depuis un contexte non-Vite : un script node nu, un gate, sans aucune chaîne d'outils.

Le typage se fait donc en **JSDoc**. Effet de bord favorable : aucun build à ordonner dans Turborepo pour ce package.

Si la règle devient coûteuse un jour, elle se rediscute comme une décision — pas comme un interdit hérité.

### 2. `${configDir}` est obligatoire sur tout chemin du `tsconfig.base.json`

TypeScript résout les chemins relatifs contre le fichier **où ils sont écrits**. Sans `${configDir}`, **tout paquet dont le `tsconfig.json` étend cette base** — 16 sur les 18 du registre, mesuré le 31/07/2026 — émettrait dans `packages/build-config/dist`. Mesuré :

```
sans ${configDir} → outDir=../dist   rootDir=../src    ❌
avec ${configDir} → outDir=./dist    rootDir=./src     ✅
```

Le piège n'est pas propre à ce package : un `tsconfig.base.json` posé à la racine du dépôt le déclencherait identiquement.

## Pourquoi il n'a pas de champ `exports`

Un `exports` est **exhaustif** : tout ce qui n'y figure pas devient irrésolvable. Il faudrait donc y déclarer explicitement le `.json`, sous peine que `extends: "@geoleaf/build-config/tsconfig.base.json"` cesse de résoudre. Sans `exports`, n'importe quel fichier du package est atteignable par son chemin — ce qui est exactement le comportement voulu pour un package de configuration privé.

Il n'a pas non plus de `files[]` : rien n'est publié, et le gate `check-package-files.cjs` ignore les packages qui n'en déclarent pas.
