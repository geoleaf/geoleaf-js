---
title: "GeoLeaf.Log — Documentation du module Logging"
---

# GeoLeaf.Log — Documentation du module Logging

**Product Version** : GeoLeaf Platform V3

**Version** : 3.0.0

**Fichier** : `src/modules/utils/log/` (logger.ts, log-config.ts, index.ts)

**Dernière mise à jour** : Mars 2026

---

Le module **GeoLeaf.Log** fournit le système de journalisation centralisé utilisé par tous les modules GeoLeaf.
Il assure une gestion cohérente, filtrée et configurable des messages de log.

Il permet également de contrôler la verbosité via la configuration JSON externe (`logging.level`).

---

## 1. Rôle fonctionnel de GeoLeaf.Log

1. Centraliser tous les logs de la bibliothèque GeoLeaf.
2. Normaliser l'affichage des messages avec un préfixe de type : `[GeoLeaf.DEBUG]`, `[GeoLeaf.INFO]`, etc.
3. Permettre le filtrage des logs selon un **niveau de verbosité** : `"debug"`, `"info"`, `"warn"`, `"error"`.
4. Offrir un point d'entrée unique pour tracer le fonctionnement interne de :
    - Core
    - Baselayers
    - UI
    - POI
    - GeoJSON
    - Route
    - Config
    - API
    - Legend
5. S'intégrer avec la configuration JSON externe pour activer/désactiver automatiquement les niveaux de logs.
6. Réduire le bruit en mode silencieux (`quietMode`) : groupement et filtrage des messages répétitifs.

---

## 2. API publique du module Logging

Le module expose quatre niveaux de log, des méthodes de contrôle et un mode silencieux :

- `GeoLeaf.Log.debug(...args)`
- `GeoLeaf.Log.info(...args)`
- `GeoLeaf.Log.warn(...args)`
- `GeoLeaf.Log.error(...args)`
- `GeoLeaf.Log.setLevel(level)`
- `GeoLeaf.Log.getLevel()`
- `GeoLeaf.Log.getLevelName()`
- `GeoLeaf.Log.setQuietMode(enabled)`
- `GeoLeaf.Log.showSummary()`

---

## 3. `GeoLeaf.Log.debug(...args)`

Affiche un message détaillé pour le développement.

```js
GeoLeaf.Log.debug("[GeoLeaf.POI] Chargement des POIs…");
```

### Usage

- Suivi des valeurs intermédiaires
- Contrôle des flux internes
- Debug poussé

### Filtrage

Affiché uniquement si `logging.level = "debug"`.

---

## 4. `GeoLeaf.Log.info(...args)`

Message d'information standard.

```js
GeoLeaf.Log.info("[GeoLeaf.Core] Carte initialisée.");
```

### Usage

- Initialisation réussie
- Chargement d'une configuration
- Changements non critiques

### Filtrage

Affiché si :

- `"debug"`
- `"info"`

---

## 5. `GeoLeaf.Log.warn(...args)`

Message d'avertissement non bloquant.

```js
GeoLeaf.Log.warn("[GeoLeaf.Config] Clé 'basemap.id' manquante, fallback sur 'street'.");
```

### Usage

- Configuration partielle
- Données manquantes mais non critiques
- Fallback automatique

### Filtrage

Affiché si :

- `"debug"`
- `"info"`
- `"warn"`

---

## 6. `GeoLeaf.Log.error(...args)`

Message d'erreur critique.

```js
GeoLeaf.Log.error("[GeoLeaf.Config] Échec du chargement de la configuration.");
```

### Usage

- Erreurs bloquantes
- Modules non initialisés
- Problèmes graves

### Filtrage

Toujours affiché, même si `logging.level = "error"`.

---

## 7. `GeoLeaf.Log.setLevel(level)`

Modifie dynamiquement le niveau global de logs.

```js
GeoLeaf.Log.setLevel("debug");
```

### Valeurs possibles

| Valeur         | Comportement                                         |
| -------------- | ---------------------------------------------------- |
| `"debug"`      | Tous les messages affichés                           |
| `"info"`       | info, warn, error                                    |
| `"warn"`       | warn, error uniquement                               |
| `"error"`      | error uniquement                                     |
| `"production"` | warn + error + activation automatique du `quietMode` |

Cette fonction est appelée automatiquement par `GeoLeaf.Config` si le fichier JSON contient :

```json
{
    "logging": { "level": "debug" }
}
```

---

## 8. `GeoLeaf.Log.getLevel()`

Retourne le niveau numériques actuellement actif.

```js
const level = GeoLeaf.Log.getLevel();
// Returns: 0 (DEBUG) | 1 (INFO) | 2 (WARN) | 3 (ERROR)
```

---

## 9. `GeoLeaf.Log.getLevelName()`

Retourne le nom du niveau actif.

```js
const name = GeoLeaf.Log.getLevelName();
// Returns: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
```

---

## 10. `GeoLeaf.Log.setQuietMode(enabled)`

Active ou désactive le mode silencieux. En mode silencieux :

- Les messages répétitifs sont groupés (affichés seulement 2 fois, puis masqués)
- Un message de summary est affiché pour indiquer que des messages ont été filtrés
- Les messages critiques (contenant `Error`, `Failed`, `WARN`, etc.) sont toujours affichés

```js
GeoLeaf.Log.setQuietMode(true);
// [GeoLeaf.INFO] Silent mode activated - repetitive logs reduced
```

> Le mode `"production"` active automatiquement `quietMode`.

---

## 11. `GeoLeaf.Log.showSummary()`

Affiche un récapitulatif des messages groupés (utile en fin de session de debug).

```js
GeoLeaf.Log.showSummary();
// [GeoLeaf.INFO] Grouped log summary
// • 12x: Module loaded...
// • 8x: Profile loaded...
```

---

## 12. Constantes exposées

### `LEVELS`

Niveaux numériques disponibles :

```js
import { LEVELS } from "@geoleaf/core";
// { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }
```

---

## 13. Intégration avec la configuration JSON

### Exemple :

```json
{
    "map": {
        "target": "geoleaf-map",
        "center": [-32.95, -60.65],
        "zoom": 12
    },
    "logging": {
        "level": "warn"
    }
}
```

### Fonctionnement

1. `GeoLeaf.Config.load()` charge le JSON.
2. Le module détecte la clé `logging.level`.
3. `GeoLeaf.Log.setLevel("warn")` est appelé automatiquement.
4. Tous les logs en dessous du niveau sont filtrés.

---

## 14. Séquence typique d'utilisation

### A. Directement depuis le code

```js
GeoLeaf.Log.setLevel("debug");

GeoLeaf.Log.debug("Détails internes…");
GeoLeaf.Log.info("Initialisation OK.");
GeoLeaf.Log.warn("Donnée manquante, fallback.");
GeoLeaf.Log.error("Erreur critique.");
```

### B. Via configuration JSON

```js
GeoLeaf.loadConfig("./data/config.json", {
    autoInit: true,
});
```

Dans ce cas, aucun `GeoLeaf.Log.setLevel()` n'a besoin d'être écrit dans le code extérieur.

### C. Mode production

```js
GeoLeaf.Log.setLevel("production");
// Équivalent à : setLevel('warn') + setQuietMode(true)
```

---

## 15. Résumé rapide de l'API Logging

| Méthode              | Rôle                                          |
| -------------------- | --------------------------------------------- |
| `debug()`            | Messages détaillés (dev uniquement)           |
| `info()`             | Messages standards                            |
| `warn()`             | Avertissements                                |
| `error()`            | Erreurs critiques                             |
| `setLevel(level)`    | Change le niveau actif                        |
| `getLevel()`         | Retourne le niveau actif (numérique)          |
| `getLevelName()`     | Retourne le niveau actif (string)             |
| `setQuietMode(bool)` | Active le mode silencieux (filtre répétitifs) |
| `showSummary()`      | Affiche le récapitulatif des messages groupés |

---

## 16. Bonnes pratiques

### En développement

- Toujours utiliser `"debug"` pour tout voir.
- Ajouter des logs détaillés dans les zones en cours de débogage.

### En staging

- Passer à `"info"` ou `"warn"`.

### En production

- Utiliser `"warn"`, `"error"` ou `"production"` uniquement.
- Le niveau `"production"` active `quietMode` et réduit le bruit automatiquement.

### Style de logs recommandé

Toujours préfixer les logs avec le module appelant :

```
[GeoLeaf.Core]
[GeoLeaf.Config]
[GeoLeaf.POI]
[GeoLeaf.GeoJSON]
…
```

Cela rend le debug immédiat et structuré dans la console du navigateur.

---

## 17. Architecture interne

```
utils/log/
├── index.ts      ← Barrel export : Log, LEVELS, configureLogging
├── logger.ts     ← Implémentation : Log (Proxy), _LogImpl, LEVELS, quietMode, grouping
└── log-config.ts ← configureLogging() (intégration avec JSON config)
```

Le `Log` exporté est un **Proxy** vers `_LogImpl`. Ce mécanisme permet aux tests Jest d'overrider `global.GeoLeaf.Log` avec un mock sans modifier les imports des modules sources.

---

## 18. Tests

```bash
npm test -- log

# Fichiers de tests
# packages/core/__tests__/log/
```

---

## Voir aussi

- `GeoLeaf.Errors` — erreurs typées loguées via `GeoLeaf.Log.error()`
- `GeoLeaf.Config` — appelle `GeoLeaf.Log.setLevel()` lors du chargement du profil
