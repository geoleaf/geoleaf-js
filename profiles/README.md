# Profils GeoLeaf — contrat intégrateur

> Version : 1.0.0 · Mise à jour : 2026-06-11
> Un profil = un métier ou un client, avec ses données. Référence complète : `docs/reference/GEOLEAF-JS_GUIDE_CONFIGURATIONS_COMPLET.md`.

## Arborescence d'un profil (layout v2)

```
profiles/
├── geoleaf.config.json               ← config racine : profil actif, debug, branding, PWA
├── schemas/                          ← schémas JSON (validation : npm run validate:profiles)
└── {profile-id}/
    ├── profile.json                  ← identité (id, label, description, version) + map + manifeste Files
    ├── LICENSE-DATA.md               ← licences des données embarquées
    ├── config/
    │   ├── core/                     ← configuration du cœur
    │   │   ├── taxonomy.json         ← catégories, sous-catégories, icônes POI
    │   │   ├── themes.json           ← presets de visibilité des couches
    │   │   ├── layers.json           ← registre des couches
    │   │   ├── basemaps.json         ← fonds de carte
    │   │   ├── ui.json               ← UI + searchConfig + layerManagerConfig + scaleConfig
    │   │   └── features.json         ← mapOptions (clustering → modules.cluster)
    │   └── plugins/                  ← un fichier par plugin configuré
    │       ├── storage.json          ← = bloc modules.storage (contenu défini par le plugin)
    │       ├── editor.json           ← = bloc modules.editor
    │       └── geocoding.json        ← = bloc modules.geocoding (@geoleaf-plugins/geocoding)
    ├── layers/{layer-id}/            ← par couche : {id}_config.json + styles/ + data/
    ├── icons/                        ← sprites SVG du profil
    └── data/                         ← données partagées (snapshots, FlatGeobuf…)
```

Le fichier `profile.json` est le **seul nom imposé**. Tous les autres chemins sont déclarés
dans son manifeste `Files` (`themesFile`, `layersFile`, `basemapsFile`,
`uiFile`, `featuresFile`, `modules.{moduleId}`), relatifs au dossier du profil.

Le nom d'un fichier plugin est l'**id de module** du Plugin Contract v1 (`storage`,
`geocoding`, `editor`, `print`, `measure`, `cog`…), pas le nom du package npm. Le core ne
valide pas le contenu de ces fichiers : chaque bloc appartient au plugin (INV-CONFIG).

## Chargement au runtime

1. `geoleaf.config.json` → `data.activeProfile` désigne le profil à charger.
2. `profile.json` est chargé.
3. **Déploiement** : si `profile.json` déclare `bundleFile`, le runtime charge
   `profile-bundle.json` en un seul fetch (sections core + features + modules + configs
   couches, fusionnées au build par `scripts/lib/bundle-profiles.cjs`).
4. **Sinon (cascade)** : les fichiers du manifeste `Files` sont chargés en parallèle,
   puis les configs de couches.

## ⚠️ Éditer un profil déployé (`deploy/`)

Dans `deploy/`, chaque profil contient un `profile-bundle.json` pré-généré **qui prime
sur les fichiers de section** : modifier `config/core/ui.json` à la main n'aura aucun
effet tant que le bundle est présent. Deux échappatoires :

- **supprimer `profile-bundle.json`** (et l'entrée `bundleFile` de `profile.json`) — le
  runtime bascule automatiquement sur la cascade de fichiers ; ou
- **activer `debug: true`** dans `geoleaf.config.json` — le bundle est ignoré et la
  cascade est chargée (édition à chaud sans rebuild).

Un profil créé à la main en multi-fichiers (sans bundle) fonctionne nativement — aucun
script de build n'est nécessaire côté intégrateur.

## Validation

- **Au boot** : contrôle structurel léger embarqué (`id`, types critiques) — voir
  `docs/reference/GUIDE_VALIDATION_PROFILS.md`.
- **En dev / CI** : `npm run validate:profiles` (AJV, `schemas/profile.schema.json`).

## Règles

- `profiles/` est la **source unique** des profils — `deploy/` est généré, ne jamais
  l'éditer pour un changement durable.
- Les données volumineuses (GeoJSON, FlatGeobuf) restent dans `layers/{id}/data/` ou
  `data/` : elles sont chargées à la demande et ne doivent **jamais** entrer dans un
  fichier de configuration ni dans le bundle.
- `mapping.json` n'existe plus dans le contrat modulaire (chemin legacy uniquement).
