# Configuration Storage / Offline — `profile.json`

> **Plugin requis :** `@geoleaf-plugins/offline-ui` (licence MIT)
> Voir aussi : [OVERVIEW.md](OVERVIEW.md) · [API_REFERENCE.md](API_REFERENCE.md) · [INSTALLATION.md](INSTALLATION.md)

---

## Paramètres `profile.json > storage`

| #   | Paramètre                          | Type    | Description              | Description longue                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------- | ------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 248 | `storage.enableOfflineDetector`    | boolean | Détection online/offline | Active la détection automatique de l'état de connexion réseau. Quand activé, GeoLeaf affiche un badge visuel quand l'utilisateur perd la connexion et adapte son comportement (utilise les données en cache au lieu de tenter des téléchargements réseau qui échoueraient). Des événements sont émis à chaque changement d'état pour que l'application puisse réagir.                          |
| 249 | `storage.enableServiceWorker`      | boolean | Service Worker           | Active le Service Worker qui intercepte les requêtes réseau pour servir les ressources depuis le cache quand elles sont disponibles. Le SW utilise 4 stratégies de cache (cache-first, network-first, stale-while-revalidate, cache-only) selon le type de ressource. Indispensable pour un vrai mode offline où l'application fonctionne sans aucune connexion. Requiert HTTPS en production. |
| 250 | `storage.cache.enableProfileCache` | boolean | Cache du profil          | Active la sauvegarde complète du profil (fichiers JSON de configuration, taxonomie, thèmes, couches) dans IndexedDB. Au prochain chargement, si les fichiers sont en cache et que l'utilisateur est offline, GeoLeaf utilise les données cachées au lieu de les télécharger. Réduit aussi le temps de chargement en mode online (cache-first).                                                 |
| 251 | `storage.cache.enableTileCache`    | boolean | Cache des tuiles         | Active la mise en cache des tuiles de fond de carte (basemap) dans IndexedDB. L'utilisateur peut télécharger à l'avance les tuiles d'une zone géographique définie dans `offlineBounds` pour consulter la carte sans réseau. Le volume de données dépend de la zone et des niveaux de zoom cachés.                                                                                             |

---

## Exemple de configuration minimale

```json
{
    "storage": {
        "enableOfflineDetector": true,
        "enableServiceWorker": true,
        "cache": {
            "enableProfileCache": true,
            "enableTileCache": false
        }
    }
}
```

---

## Voir aussi

- [offline-detector.md](offline-detector.md) — API et événements du détecteur de connectivité
- [API_REFERENCE.md](API_REFERENCE.md) — référence complète `GeoLeaf.Storage`
- [EXAMPLES.md](EXAMPLES.md) — exemples d'intégration
