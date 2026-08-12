---
title: "GeoLeaf Events API"
---

# GeoLeaf Events API

**Module:** `@geoleaf/core` — `GeoLeaf.Events`

GeoLeaf dispatches native DOM events (`CustomEvent`) on `document`. They are typed through `GeoLeafEventMap`.

::: info

**Casing — `GeoLeaf.Events` and `GeoLeaf.events`.** Both are mounted and equivalent
(`GeoLeaf.Events === GeoLeaf.events`). `Events` is the canonical form: it is the one used
throughout this reference and the one carried by the exported facade. `events` is a historical
alias, kept for the long term and **not deprecated** — same contract as `Baselayers` /
`BaseLayers`.

:::

::: warning

Before v3.0.0, only `events` existed at runtime while the type definitions declared `Events`:
`GeoLeaf.Events.on(...)` compiled and then threw a `TypeError`. Code that worked around this by
writing `events` keeps working unchanged.

:::

> Integrators **subscribe only** — dispatching is internal to GeoLeaf.

---

## Public API

### `GeoLeaf.Events.on(event, handler)`

```ts
GeoLeaf.Events.on("geoleaf:poi:click", (e) => {
    console.log("POI clicked:", e.detail.poiId);
});
```

Registers a listener for `event`. Called on every dispatch until `off()`.

### `GeoLeaf.Events.off(event, handler)`

```ts
GeoLeaf.Events.off("geoleaf:poi:click", myHandler);
```

Removes a previously registered listener. The **same function reference** must be passed.

### `GeoLeaf.Events.once(event, handler)`

```ts
GeoLeaf.Events.once("geoleaf:app:ready", () => {
    console.log("App ready");
});
```

Listener fired **once**, then removed automatically.

---

## Full event reference

| Event name                   | Dispatched when                   | Key payload fields                                          |
| ---------------------------- | --------------------------------- | ----------------------------------------------------------- |
| `geoleaf:app:ready`          | App fully initialised             | `version`, `timestamp`                                      |
| `geoleaf:map:ready`          | MapLibre map created              | —                                                           |
| `geoleaf:profile:loaded`     | JSON profile fully loaded         | `profileId`, `data`                                         |
| `geoleaf:basemap:change`     | Basemap changed                   | `key`, `previousKey`                                        |
| `geoleaf:theme:applied`      | Theme applied (layers loaded)     | `themeName`, `layerCount`                                   |
| `geoleaf:poi:click`          | POI marker clicked                | `poiId`, `layerId`, `source`                                |
| `geoleaf:poi:panel:open`     | Side panel opened on a POI        | `poiId`, `poiName`                                          |
| `geoleaf:poi:panel:close`    | Side panel closed                 | `poiId`                                                     |
| `geoleaf:layer:toggle`       | Layer shown or hidden             | `layerId`, `visible`, `source`                              |
| `geoleaf:filter:apply`       | Filter applied to features        | `layerIds`, `geometryType?`, `activeCount`                  |
| `geoleaf:filter:reset`       | Filter reset (everything visible) | `layerIds`                                                  |
| `geoleaf:map:move`           | Map panned (MapLibre `moveend`)   | `center.lat`, `center.lng`, `zoom`                          |
| `geoleaf:map:zoom`           | Zoom changed (MapLibre `zoomend`) | `zoom`, `oldZoom`, `center`                                 |
| `geoleaf:plugin:loaded`      | Plugin registered synchronously   | `name`, `version`                                           |
| `geoleaf:plugin:lazy-loaded` | Lazy plugin loaded asynchronously | `name`                                                      |
| `geoleaf:plugin:failed`      | Lazy plugin failed to load        | `name`, `error`                                             |
| `geoleaf:popup:action`       | Popup action button clicked       | `actionId`, `layerId`, `featureId`, `properties`, `lngLat?` |

---

## `geoleaf:popup:action`

Dispatched on `document` on every click of a popup action button (renderer `type: "action"` in `popup.fields[]`, rendered by `@geoleaf-plugins/feature-info`). This is the only channel for reacting to a popup action — loosely coupled listeners (analytics, host integration, backend).

**Payload (`e.detail`):**

| Field        | Type    | Description                                                                                             |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------- |
| `actionId`   | string  | Opaque action identifier (token `^[A-Za-z0-9:_-]{1,64}$`), as defined in the configuration.             |
| `layerId`    | string  | Identifier of the layer/source of the clicked feature.                                                  |
| `featureId`  | string  | Identifier of the feature (GeoJSON feature or POI).                                                     |
| `properties` | object  | Subset of the feature properties, bounded by `payloadFields` (default: `id`, `name`, `title`, `label`). |
| `lngLat`     | object? | `[lng, lat]` coordinates of the popup anchor point (optional).                                          |

> The payload is serialisable (JSON only): no DOM reference and no function.

```ts
GeoLeaf.Events.on("geoleaf:popup:action", (e) => {
    const { actionId, layerId, featureId } = e.detail;
    if (actionId === "odoo:open-form") {
        _paq.push(["trackEvent", "Popup", "Action", actionId]);
    }
});
```

---

## Integration examples

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

### Removing listeners

```ts
const handlePoiClick = (e) => {
    /* ... */
};
GeoLeaf.Events.on("geoleaf:poi:click", handlePoiClick);

// Later:
GeoLeaf.Events.off("geoleaf:poi:click", handlePoiClick);
```

---

## Security notes

- Payloads contain primitives only (`string`, `number`, `boolean`). No DOM references.
- The error carried by `plugin:failed` is truncated to 200 characters to avoid leaking stack traces.
- SSR-safe: calls are silent when `document` is undefined.
