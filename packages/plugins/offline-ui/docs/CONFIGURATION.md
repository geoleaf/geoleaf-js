# Configuration hors-ligne — `modules.offline` et `modules.pwa`

> **Plugin :** `@geoleaf-plugins/offline-ui` (licence MIT) — l'**interface** de la préparation hors-ligne.
> Le moteur (IndexedDB, cache, téléchargement, synchronisation) est **dans le core**, opt-in.
> Référence complète des paramètres :
> [GEOLEAF-JS_GUIDE_CONFIGURATIONS_COMPLET.md §19](../../../../docs/reference/GEOLEAF-JS_GUIDE_CONFIGURATIONS_COMPLET.md).
> Voir aussi : [OVERVIEW.md](OVERVIEW.md) · [API_REFERENCE.md](API_REFERENCE.md) · [INSTALLATION.md](INSTALLATION.md)

---

## Les clés `storage.*` n'existent plus

Le bloc `storage` de `profile.json` a été remplacé. Le schéma du profil le **refuse** désormais
(`additionalProperties: false` à la racine) :

| Ancienne clé                       | Clé actuelle                               | Fichier                       |
| ---------------------------------- | ------------------------------------------ | ----------------------------- |
| `storage.enableOfflineDetector`    | `modules.pwa.offlineDetector.enabled`      | `geoleaf.config.json`         |
| `storage.enableServiceWorker`      | `modules.pwa.enabled`                      | `geoleaf.config.json`         |
| `storage.cache.enableProfileCache` | `modules.offline.cache.enableProfileCache` | `config/plugins/offline.json` |
| `storage.cache.enableTileCache`    | `modules.offline.cache.enableTileCache`    | `config/plugins/offline.json` |

`config/plugins/offline.json` est référencé par `Files.modules.offline` dans `profile.json` ; son
contenu devient `modules.offline`. Le moteur ne se charge qu'avec `modules.offline.enabled: true` **et**
`modules.pwa.enabled: true`.

---

## Exemple de configuration minimale

`config/plugins/offline.json` :

```json
{
    "enabled": true,
    "cache": {
        "enableProfileCache": true,
        "enableTileCache": false
    }
}
```

---

## Fonds de carte hors-ligne : seules les origines déclarées se préparent

`enableTileCache: true` rend téléchargeables les fonds `offline: true`. Une tuile qui ne vient pas de
l'origine de l'application n'est pourtant rapatriée **que si son origine est déclarée**
`cacheable: true` **et** `prefetch: true` dans `modules.offline.dataOrigins` :

```json
{
    "enabled": true,
    "cache": { "enableTileCache": true },
    "dataOrigins": [
        {
            "origin": "https://tiles.example.com",
            "roles": ["tiles"],
            "cacheable": true,
            "prefetch": true
        }
    ]
}
```

⚠️ **Télécharger à l'avance n'est pas consulter.** Plusieurs fournisseurs gratuits l'interdisent —
OpenStreetMap : « Offline use is not permitted on tile.openstreetmap.org ». Ne déclarez `prefetch`
que pour une origine que vous exploitez, ou dont les conditions l'autorisent.

**Un fond refusé le dit avant le téléchargement** (1.6.4, avec un core ≥ 3.15.0). Dans la fenêtre, la
ligne d'un fond dont l'origine n'est pas déclarée préparable est grisée, sa case décochée et inerte,
et son infobulle nomme l'origine et le motif — non déclarée, déclarée sans préparation, ou adresse
illisible. Il n'est donc pas compté dans l'estimation de taille. Et si un téléchargement laisse tout
de même une origine de côté — un fond vectoriel dont le STYLE est admis et dont les tuiles ne le sont
pas —, la notification de fin le dit et nomme l'origine, au lieu d'annoncer un succès.
⚠️ Sur un core antérieur, le sélecteur ne connaît pas la règle : le fond est proposé, puis sauté.

---

## Voir aussi

- [offline-detector.md](offline-detector.md) — API et événements du détecteur de connectivité
- [API_REFERENCE.md](API_REFERENCE.md) — référence complète `GeoLeaf.Storage`
- [EXAMPLES.md](EXAMPLES.md) — exemples d'intégration
