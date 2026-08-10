---
title: "GeoLeaf Events API"
---

# GeoLeaf Events API

**Module :** `@geoleaf/core` — `GeoLeaf.Events`
**Version :** 3.0.0
**Dernière mise à jour :** Mars 2026

GeoLeaf émet des événements DOM natifs (`CustomEvent`) sur `document`. Ils sont typés via `GeoLeafEventMap`.

> **Casse — `GeoLeaf.Events` et `GeoLeaf.events`.** Les deux sont montés et équivalents
> (`GeoLeaf.Events === GeoLeaf.events`). `Events` est la forme canonique : c'est celle
> qu'emploie cette page et que porte la façade exportée. `events` est un alias historique, conservé
> durablement et **non déprécié** — même contrat que `Baselayers` / `BaseLayers`.
>
> ⚠️ Avant la v3.0.0 (S13.7), seul `events` existait au runtime alors que les types et cette
> documentation prescrivaient `Events` : `GeoLeaf.Events.on(...)` compilait puis levait un
> `TypeError`. Si vous aviez contourné le problème en écrivant `events`, votre code continue
> de fonctionner à l'identique.

> Les intégrateurs **s'abonnent uniquement** — le dispatch est interne à GeoLeaf.

---

## API publique

### `GeoLeaf.Events.on(event, handler)`

```ts
GeoLeaf.Events.on("geoleaf:poi:click", (e) => {
    console.log("POI cliqué :", e.detail.poiId);
});
```

Enregistre un listener pour l'événement `event`. Appelé à chaque déclenchement jusqu'à `off()`.

### `GeoLeaf.Events.off(event, handler)`

```ts
GeoLeaf.Events.off("geoleaf:poi:click", myHandler);
```

Supprime un listener précédemment enregistré. La **même référence** de fonction doit être passée.

### `GeoLeaf.Events.once(event, handler)`

```ts
GeoLeaf.Events.once("geoleaf:app:ready", () => {
    console.log("App prête !");
});
```

Listener déclenché **une seule fois** puis automatiquement supprimé.

---

## Référence complète des événements

| Nom de l'événement           | Déclenchement                          | Champs clés du payload                                      |
| ---------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| `geoleaf:app:ready`          | App entièrement initialisée            | `version`, `timestamp`                                      |
| `geoleaf:map:ready`          | Carte MapLibre créée                   | —                                                           |
| `geoleaf:profile:loaded`     | Profil JSON complètement chargé        | `profileId`, `data`                                         |
| `geoleaf:basemap:change`     | Changement de fond de carte            | `key`, `previousKey`                                        |
| `geoleaf:theme:applied`      | Thème appliqué (couches chargées)      | `themeName`, `layerCount`                                   |
| `geoleaf:poi:click`          | Marker POI cliqué                      | `poiId`, `layerId`, `source`                                |
| `geoleaf:poi:panel:open`     | Panneau latéral ouvert sur un POI      | `poiId`, `poiName`                                          |
| `geoleaf:poi:panel:close`    | Panneau latéral fermé                  | `poiId`                                                     |
| `geoleaf:layer:toggle`       | Couche affichée ou masquée             | `layerId`, `visible`, `source`                              |
| `geoleaf:filter:apply`       | Filtre appliqué sur des entités        | `layerIds`, `geometryType?`, `activeCount`                  |
| `geoleaf:filter:reset`       | Filtre réinitialisé (tout visible)     | `layerIds`                                                  |
| `geoleaf:map:move`           | Carte déplacée (`moveend` MapLibre)    | `center.lat`, `center.lng`, `zoom`                          |
| `geoleaf:map:zoom`           | Zoom changé (`zoomend` MapLibre)       | `zoom`, `oldZoom`, `center`                                 |
| `geoleaf:plugin:loaded`      | Plugin enregistré de façon synchrone   | `name`, `version`                                           |
| `geoleaf:plugin:lazy-loaded` | Plugin lazy chargé de façon asynchrone | `name`                                                      |
| `geoleaf:plugin:failed`      | Échec du chargement d'un plugin lazy   | `name`, `error`                                             |
| `geoleaf:popup:action`       | Bouton d'action de popup cliqué        | `actionId`, `layerId`, `featureId`, `properties`, `lngLat?` |

---

## `geoleaf:popup:action`

Émis sur `document` à chaque clic sur un bouton d'action de popup (renderer `type: "action"` dans `popup.fields[]`, rendu par `@geoleaf-plugins/feature-info`). C'est le seul canal de réaction à une action popup — écouteurs faiblement couplés (analytics, intégration hôte, backend).

**Payload (`e.detail`) :**

| Champ        | Type    | Description                                                                                                    |
| ------------ | ------- | -------------------------------------------------------------------------------------------------------------- |
| `actionId`   | string  | Identifiant opaque de l'action (token `^[A-Za-z0-9:_-]{1,64}$`), tel que défini dans la config.                |
| `layerId`    | string  | Identifiant de la couche/source de l'entité cliquée.                                                           |
| `featureId`  | string  | Identifiant de l'entité (feature GeoJSON ou POI).                                                              |
| `properties` | object  | Sous-ensemble des propriétés de l'entité, borné par `payloadFields` (défaut : `id`, `name`, `title`, `label`). |
| `lngLat`     | object? | Coordonnées `[lng, lat]` du point d'ancrage du popup (optionnel).                                              |

> Le payload est sérialisable (JSON-only) : pas de référence DOM ni de fonction.

```ts
GeoLeaf.Events.on("geoleaf:popup:action", (e) => {
    const { actionId, layerId, featureId } = e.detail;
    if (actionId === "odoo:open-form") {
        _paq.push(["trackEvent", "Popup", "Action", actionId]);
    }
});
```

---

## Exemples d'intégration

### Analytics — Matomo

```ts
GeoLeaf.Events.on("geoleaf:poi:click", (e) => {
    _paq.push(["trackEvent", "Map", "POI Click", e.detail.poiId]);
});
GeoLeaf.Events.on("geoleaf:filter:apply", (e) => {
    _paq.push(["trackEvent", "Map", "Filter Apply", e.detail.activeCount.toString()]);
});
```

### Analytics — Google Analytics 4

```ts
GeoLeaf.Events.on("geoleaf:map:move", (e) => {
    gtag("event", "map_pan", { lat: e.detail.center.lat, lng: e.detail.center.lng });
});
GeoLeaf.Events.on("geoleaf:layer:toggle", (e) => {
    gtag("event", "layer_toggle", { layer_id: e.detail.layerId, visible: e.detail.visible });
});
```

### Nettoyage des listeners

```ts
const handlePoiClick = (e) => {
    /* ... */
};
GeoLeaf.Events.on("geoleaf:poi:click", handlePoiClick);

// Plus tard :
GeoLeaf.Events.off("geoleaf:poi:click", handlePoiClick);
```

---

## Notes de sécurité

- Les payloads contiennent uniquement des primitives (`string`, `number`, `boolean`). Aucune référence DOM.
- L'erreur de `plugin:failed` est tronquée à 200 caractères pour éviter les fuites de stack trace.
- Compatible SSR : les appels sont silencieux si `document` n'est pas défini.
