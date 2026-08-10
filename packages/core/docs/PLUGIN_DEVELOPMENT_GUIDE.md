---
title: "GeoLeaf — Guide de développement de plugin"
---

# GeoLeaf — Guide de développement de plugin

**Package :** `@geoleaf/core`
**Version :** 3.0.0
**Dernière mise à jour :** mars 2026

---

## Vue d'ensemble

Un plugin GeoLeaf est un package npm ESM qui :

1. S'importe **après** le core GeoLeaf
2. Étend le namespace `GeoLeaf.*` via le bridge `globalThis`
3. S'enregistre dans `GeoLeaf.plugins` via `GeoLeaf.plugins.register()`

Le système est simple, sans classe de base ni framework — un fichier d'entrée suffit.

**Référence :** les trois plugins existants (`@geoleaf-plugins/connector`, `@geoleaf-plugins/editor`, `@geoleaf-plugins/offline-ui`) suivent tous le même pattern.

---

## Prérequis

- Node.js ≥ 18
- `@geoleaf/core` en `peerDependencies`
- ESM pur obligatoire : `"type": "module"` dans `package.json`
- Aucun `require()`, aucun `module.exports`

---

## Structure minimale

```
my-plugin/
├── package.json
├── rollup.config.js        ← build ESM
└── src/
    └── entry.ts            ← point d'entrée unique
```

### package.json

```json
{
    "name": "@my-scope/my-plugin",
    "version": "1.0.0",
    "type": "module",
    "main": "./dist/my-plugin.js",
    "module": "./dist/my-plugin.js",
    "exports": {
        ".": "./dist/my-plugin.js"
    },
    "peerDependencies": {
        "@geoleaf/core": "^2.0.0"
    },
    "devDependencies": {
        "@geoleaf/core": "^2.0.0",
        "rollup": "^4.0.0",
        "typescript": "^5.0.0"
    }
}
```

### rollup.config.js

```js
import { defineConfig } from "rollup";
import typescript from "@rollup/plugin-typescript";

export default defineConfig({
    input: "src/entry.ts",
    output: {
        file: "dist/my-plugin.js",
        format: "esm",
    },
    plugins: [typescript()],
    external: ["@geoleaf/core"],
});
```

---

## Pattern d'entrée

Le fichier `src/entry.ts` suit un pattern en 3 étapes.

### Étape 1 — Imports internes

```typescript
// Importez vos modules internes (ils s'exécutent à l'import)
import "./my-feature.js";
import { MyService } from "./my-service.js";
```

### Étape 2 — Bridge vers le namespace GeoLeaf

```typescript
// Accéder au namespace global GeoLeaf (sans importer le core — évite les dépendances circulaires)
const _g = globalThis as {
    GeoLeaf?: {
        _version?: string;
        plugins?: {
            register(
                name: string,
                opts: {
                    version?: string;
                    requires?: string[];
                    optional?: string[];
                    label?: string;
                    healthCheck?: () => boolean;
                }
            ): void;
        };
        // Déclarez ici ce que vous allez ajouter
        MyPlugin?: { myMethod(): void };
    };
};

// Ajouter votre API sur GeoLeaf.*
if (_g.GeoLeaf) {
    _g.GeoLeaf.MyPlugin = {
        myMethod: MyService.myMethod.bind(MyService),
    };
}
```

### Étape 3 — Enregistrement dans PluginRegistry

```typescript
if (_g.GeoLeaf?.plugins?.register) {
    _g.GeoLeaf.plugins.register("my-plugin", {
        version: _g.GeoLeaf._version, // version du core (pour compatibilité)
        requires: [], // plugins requis (ex. ["storage"])
        optional: [], // plugins optionnels
        label: "My Plugin (description)",
        healthCheck: () => !!_g.GeoLeaf?.MyPlugin?.myMethod,
    });
}
```

---

## Exemple complet : plugin "Hello World"

```typescript
// src/entry.ts

interface GeoLeafGlobal {
    _version?: string;
    plugins?: {
        register(
            name: string,
            opts: {
                version?: string;
                requires?: string[];
                optional?: string[];
                label?: string;
                healthCheck?: () => boolean;
            }
        ): void;
    };
    Hello?: {
        greet(name: string): string;
        version: string;
    };
}

const _g = globalThis as { GeoLeaf?: GeoLeafGlobal };

// --- Implémentation ---
const HelloService = {
    greet(name: string): string {
        return `Hello, ${name}! From GeoLeaf Hello plugin.`;
    },
    version: "1.0.0",
};

// --- Bridge ---
if (_g.GeoLeaf) {
    _g.GeoLeaf.Hello = HelloService;
}

// --- Enregistrement ---
if (_g.GeoLeaf?.plugins?.register) {
    const coreVersion = _g.GeoLeaf._version;
    _g.GeoLeaf.plugins.register("hello", {
        // `version` est optionnel des deux côtés : sous `exactOptionalPropertyTypes`, une
        // clé ABSENTE et une clé présente valant `undefined` ne sont plus interchangeables.
        // On insère conditionnellement plutôt que de propager l'`undefined`.
        ...(coreVersion !== undefined && { version: coreVersion }),
        label: "Hello Plugin (exemple)",
        healthCheck: () => typeof _g.GeoLeaf?.Hello?.greet === "function",
    });
}
```

**Utilisation côté app :**

```js
import "@geoleaf/core";
import "@my-scope/hello-plugin";

// Vérifier le chargement
GeoLeaf.plugins.isLoaded("hello"); // → true

// Utiliser l'API
GeoLeaf.Hello.greet("World"); // → "Hello, World! From GeoLeaf Hello plugin."
```

---

## Ordre de chargement

Le plugin **doit être importé après** le core GeoLeaf :

```js
// ✅ Ordre correct
import GeoLeaf from "@geoleaf/core";
import "@my-scope/my-plugin"; // GeoLeaf.* existe déjà

// ❌ Ordre incorrect — GeoLeaf.plugins n'existe pas encore
import "@my-scope/my-plugin";
import GeoLeaf from "@geoleaf/core";
```

En CDN (ESM) :

```html
<script type="module" src="geoleaf.esm.js"></script>
<script type="module" src="my-plugin.js"></script>
```

---

## API PluginRegistry

Accessible via `GeoLeaf.plugins` (export nommé du core) :

| Méthode                 | Description                                            | Retourne         |
| ----------------------- | ------------------------------------------------------ | ---------------- |
| `register(name, opts)`  | Enregistre un plugin comme chargé                      | `void`           |
| `isLoaded(name)`        | Le plugin est-il chargé ?                              | `boolean`        |
| `canActivate(name)`     | Toutes les dépendances `requires` sont chargées ?      | `boolean`        |
| `getLoadedPlugins()`    | Liste des noms chargés                                 | `string[]`       |
| `getAvailableModules()` | Liste de tous les modules (chargés + lazy disponibles) | `string[]`       |
| `getInfo(name)`         | Métadonnées d'un plugin                                | `object \| null` |
| `load(name)`            | Charge un module lazy par son nom                      | `Promise<void>`  |
| `reportPlugins()`       | Affiche en console les plugins chargés                 | `void`           |

```js
// Exemple
GeoLeaf.plugins.getLoadedPlugins();
// → ["core", "poi", "connector", "hello"]

GeoLeaf.plugins.getInfo("hello");
// → { name: "hello", version: "3.0.0", loaded: true, label: "Hello Plugin", healthCheck: fn }
```

---

## Événements DOM

Le système émet des événements sur `document` :

| Événement                    | Déclenché quand                                |
| ---------------------------- | ---------------------------------------------- |
| `geoleaf:plugin:loaded`      | Plugin enregistré via `plugins.register()`     |
| `geoleaf:plugin:lazy-loaded` | Module lazy chargé via `PluginRegistry.load()` |
| `geoleaf:plugin:failed`      | Échec du chargement lazy                       |

```js
document.addEventListener("geoleaf:plugin:loaded", (e) => {
    console.log("Plugin chargé :", e.detail.name, e.detail.version);
});
```

---

## Ce qu'un plugin peut importer depuis `@geoleaf/core`

Les exports nommés publics sont disponibles pour les plugins :

```typescript
import {
    PluginRegistry,
    APIController,
    Log,
    Errors,
    CONSTANTS,
    Core,
    // ... voir API_REFERENCE.md pour la liste complète
} from "@geoleaf/core";
```

> **Règle :** importer uniquement les exports listés dans [API_REFERENCE.md](API_REFERENCE.md). Ne pas importer depuis les sous-chemins internes (`@geoleaf/core/src/modules/...`).

---

## Règles de namespace

- **Préfixer votre namespace** pour éviter les collisions : `GeoLeaf.MyOrg_MyPlugin` ou `GeoLeaf.MyPlugin`
- **Ne pas écraser** les namespaces existants : `GeoLeaf.POI`, `GeoLeaf.Core`, `GeoLeaf.UI`, etc.
- **Le healthCheck doit rester léger** : il est appelé au boot pour le rapport de démarrage

---

## Plugins avec dépendances

Si votre plugin requiert un autre plugin :

```typescript
_g.GeoLeaf.plugins.register("my-plugin", {
    requires: ["storage"], // sera vérifié par canActivate()
    optional: ["addpoi"], // documenté mais non bloquant
    healthCheck: () => GeoLeaf.plugins.isLoaded("storage") && !!_g.GeoLeaf?.MyPlugin,
});
```

Vérifier avant d'utiliser une dépendance optionnelle :

```typescript
if (GeoLeaf.plugins.isLoaded("storage")) {
    // Utiliser l'API Storage
}
```

---

## Règles à respecter

| Règle                                               | Raison                                   |
| --------------------------------------------------- | ---------------------------------------- |
| ESM pur — aucun `require()`                         | GeoLeaf est ESM-only depuis v2.0.0       |
| Ne pas importer `@geoleaf-plugins/*` depuis le core | Règle `no-plugin-in-core`                |
| Pas d'accès aux internals `src/modules/`            | Seule l'API publique est stable          |
| healthCheck léger et sans side effects              | Appelé au boot de façon synchrone        |
| Déclarer `@geoleaf/core` en `peerDependencies`      | Évite d'embarquer deux instances du core |

---

## Voir aussi

- PLUGIN_REGISTRY_BOOT.md — architecture interne du registre
- [API_REFERENCE.md](API_REFERENCE.md) — liste complète des exports nommés publics
- [ARCHITECTURE_GUIDE.md](ARCHITECTURE_GUIDE.md) — séquence de boot et modules lazy
- `packages/plugins/connector/src/entry.ts` — implémentation de référence la plus simple
