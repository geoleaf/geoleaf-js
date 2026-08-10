---
title: "GeoLeaf-JS — Core Extension Guide"
---

# GeoLeaf-JS — Core Extension Guide

**Package:** `@geoleaf/core`
**Version:** 3.0.0
**License:** MIT

> Ce guide s'adresse aux développeurs qui **forkent le core MIT** et souhaitent y ajouter un nouveau module interne (nouvelle couche métier, nouvelle façade publique, nouveau lazy chunk). Pour créer un **plugin externe** sans modifier le core, consultez [PLUGIN_DEVELOPMENT_GUIDE.md](PLUGIN_DEVELOPMENT_GUIDE.md).

---

## Table of contents

1. [Prérequis et lecture obligatoire](#prérequis-et-lecture-obligatoire)
2. [Anatomie d'un module core](#anatomie-dun-module-core)
3. [Étape 1 — Créer le module métier](#étape-1--créer-le-module-métier)
4. [Étape 2 — Enregistrer dans la séquence boot](#étape-2--enregistrer-dans-la-séquence-boot)
5. [Étape 3 — Exposer une façade publique](#étape-3--exposer-une-façade-publique)
6. [Étape 4 — Exporter depuis bundle-esm-entry.ts](#étape-4--exporter-depuis-bundle-esm-entryts)
7. [Règles à respecter impérativement](#règles-à-respecter-impérativement)
8. [Checklist avant merge](#checklist-avant-merge)

---

## Prérequis et lecture obligatoire

Avant de toucher au code, lire dans l'ordre :

1. [ARCHITECTURE_GUIDE.md](ARCHITECTURE_GUIDE.md) — séquence boot B1→B11, chunks lazy, bundles
2. [CONTRIBUTING.md](CONTRIBUTING.md) — conventions, TSDoc, ESLint

> **Règle critique :** Ne jamais modifier l'ordre des imports dans `globals.*.ts` sans avoir tracé toutes les dépendances aval. L'ordre B1→B11 est non-négociable.

---

## Anatomie d'un module core

Un module core GeoLeaf est composé de 3 à 5 fichiers selon sa complexité :

```
src/modules/{nom}/
├── {nom}.module.ts          ← Implémentation — logique métier pure
├── {nom}.types.ts           ← Types et interfaces (optionnel)
├── {nom}-state.ts           ← État partagé si nécessaire (dans shared/)
└── geoleaf.{nom}.ts         ← Façade publique (dans src/modules/)
```

Et 2 points d'entrée globaux :

```
src/modules/globals.{group}.ts   ← Import du module dans la séquence boot
src/bundle-esm-entry.ts          ← Export nommé ESM de la façade
```

---

## Étape 1 — Créer le module métier

### 1a. Structure minimale

Créez `src/modules/{nom}/{nom}.module.ts` :

```typescript
// src/modules/analytics/analytics.module.ts

import { Log } from "../core/log/log.module";
import { EventBus } from "../core/utils/event-bus";

/**
 * @internal
 * Analytics module — internal implementation.
 * Public API is exposed via GeoLeaf.Analytics facade (geoleaf.analytics.ts).
 */
export class AnalyticsModule {
    private static _initialized = false;

    static init(): void {
        if (this._initialized) return;
        this._initialized = true;
        Log.info("AnalyticsModule", "initialized");
    }

    static track(event: string, data?: Record<string, unknown>): void {
        EventBus.emit("analytics:track", { event, data });
    }
}
```

> **Règles de nommage :**
>
> - Classe : `PascalCase` + suffixe `Module`
> - Fichier : `kebab-case.module.ts`
> - Namespace de logs : identique au nom de classe

### 1b. Implémentation de ICoreModule (si ModuleRegistry)

Si votre module doit s'intégrer au `ModuleRegistry` (recommandé pour les modules conditionnels) :

```typescript
import type {
    ICoreModule,
    IMapAdapter,
    IGeoLeafConfig,
} from "../../contracts/core-module.contract";

export class AnalyticsModule implements ICoreModule {
    readonly id = "analytics";
    readonly dependencies = ["core", "config"] as const; // Must be loaded after these

    async init(_adapter: IMapAdapter, _config: IGeoLeafConfig): Promise<void> {
        // Initialization logic
    }

    destroy(): void {
        // Cleanup
    }
}
```

---

## Étape 2 — Enregistrer dans la séquence boot

### 2a. Choisir le fichier globals approprié

| Fichier globals      | Groupes                       | Quand l'utiliser                       |
| -------------------- | ----------------------------- | -------------------------------------- |
| `globals.core.ts`    | B1, B2                        | Utilitaires bas niveau, log, sécurité  |
| `globals.config.ts`  | B3, B4                        | Helpers, validators, config, renderers |
| `globals.geojson.ts` | B5                            | GeoJSON, couches vectorielles, route   |
| `globals.ui.ts`      | B6, B7, B9                    | Labels, UI, contrôles, filtres         |
| `globals.poi.ts`     | B10                           | POI, formulaires, renderers POI        |
| `globals.api.ts`     | B11 — **toujours en dernier** | Façades publiques uniquement           |

> `globals.storage.ts` (B8) est réservé au plugin Storage — ne pas ajouter de code core ici.

### 2b. Ajouter l'import dans le bon fichier

Par exemple, pour un module utilitaire post-config :

```typescript
// src/modules/globals.config.ts  (extrait)
// ...existing imports...
import { AnalyticsModule } from "./analytics/analytics.module";

// Init dans la séquence
AnalyticsModule.init();
```

> **Important :** Vérifiez que toutes les dépendances de votre module sont dans des groupes **antérieurs** (B numéro plus petit). Si votre module dépend de `Config`, il doit être en B4 ou après.

---

## Étape 3 — Exposer une façade publique

Créez `src/modules/geoleaf.analytics.ts` :

````typescript
// src/modules/geoleaf.analytics.ts

/**
 * @description GeoLeaf Analytics namespace — event tracking facade.
 *
 * @example
 * ```ts
 * import { Analytics } from "@geoleaf/core";
 * Analytics.track("map:zoom", { level: 12 });
 * ```
 *
 * @see AnalyticsModule
 */

import { AnalyticsModule } from "./analytics/analytics.module";

export const Analytics = {
    /**
     * Track a named event with optional metadata.
     * @param event - Event name (e.g. "map:zoom", "poi:click")
     * @param data - Optional payload
     */
    track: (event: string, data?: Record<string, unknown>): void =>
        AnalyticsModule.track(event, data),
} as const;
````

> **Règles façades (`geoleaf.*.ts`) :**
>
> - Aucune logique métier — délégation pure vers le module
> - TSDoc obligatoire : `@description`, `@example`, `@see`
> - ⚠️ **Jamais `@module`** — le tag est interdit depuis STRUCT S5 et la gate
>   `check-module-headers` (MH-03) refuse le commit. Rien ne le lisait, et 204 des
>   478 tags du dépôt désignaient un chemin inexistant : le chemin du fichier dit
>   déjà où il est
> - `as const` sur l'objet exporté
> - Nommage : `Analytics`, `POI`, `UI`… (PascalCase, sans suffixe)

---

## Étape 4 — Exporter depuis bundle-esm-entry.ts

Ajoutez votre façade aux exports nommés ESM :

```typescript
// src/bundle-esm-entry.ts  (extrait)
// ...existing exports...
export { Analytics } from "./modules/geoleaf.analytics";
```

Et si vous voulez l'assigner également au namespace global (`window.GeoLeaf.Analytics`), ajoutez dans `globals.api.ts` (B11) :

```typescript
// src/modules/globals.api.ts  (extrait)
import { Analytics } from "./geoleaf.analytics";
// ...
(globalThis as any).GeoLeaf.Analytics = Analytics;
```

---

## Règles à respecter impérativement

| Règle                                                                 | Raison                                                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Ne jamais importer depuis `@geoleaf-plugins/*`                        | Règle no-plugin-in-core — frontière d'architecture, vérifiée en CI et en pre-commit |
| Ne jamais utiliser `innerHTML` sans `DOMSecurity`                     | Surface XSS critique                                                                |
| Passer par `IMapAdapter` pour toute interaction map                   | Abstraction moteur cartographique                                                   |
| Déclarer les dépendances inter-modules via `ICoreModule.dependencies` | Ordre topologique garanti                                                           |
| TSDoc sur toutes les méthodes publiques de la façade                  | Prérequis TypeDoc                                                                   |
| Fichiers source ≤ 700 lignes (soft limit 500)                         | Maintenabilité                                                                      |
| Commenter le code en anglais                                          | Convention projet                                                                   |

---

## Checklist avant merge

```
[ ] Module implémente ICoreModule si conditionnel (ModuleRegistry)
[ ] Import ajouté dans le bon globals.*.ts (B1→B10, jamais B11)
[ ] Façade geoleaf.{nom}.ts créée avec TSDoc complet
[ ] Export ajouté dans bundle-esm-entry.ts
[ ] Export global ajouté dans globals.api.ts si nécessaire
[ ] Aucun import @geoleaf-plugins/* dans le code
[ ] Aucun innerHTML sans DOMSecurity
[ ] Tests unitaires créés dans packages/core/__tests__/
[ ] README de module créé dans packages/core/docs/{nom}/
[ ] INDEX_CORE.md mis à jour avec le nouveau module
[ ] npm run build passe
[ ] npm run test:jest passe
[ ] npm run lint passe
```

---

## Voir aussi

- [ARCHITECTURE_GUIDE.md](ARCHITECTURE_GUIDE.md) — Architecture complète et séquence boot
- [PLUGIN_DEVELOPMENT_GUIDE.md](PLUGIN_DEVELOPMENT_GUIDE.md) — Créer un plugin **externe** (sans modifier le core)
- [CONTRIBUTING.md](CONTRIBUTING.md) — Conventions et workflow de contribution
