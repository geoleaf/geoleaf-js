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

| Event name                   | Dispatched when                   | Key payload fields                                                                            |
| ---------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `geoleaf:app:ready`          | App fully initialised             | `version`, `timestamp`                                                                        |
| `geoleaf:map:ready`          | MapLibre map created              | —                                                                                             |
| `geoleaf:profile:loaded`     | JSON profile fully loaded         | `profileId`, `data`                                                                           |
| `geoleaf:basemap:change`     | Basemap changed                   | `key`, `previousKey`                                                                          |
| `geoleaf:theme:applied`      | Theme applied (layers loaded)     | `themeName`, `layerCount`                                                                     |
| `geoleaf:poi:click`          | POI marker clicked                | `poiId`, `layerId`, `source`                                                                  |
| `geoleaf:poi:panel:open`     | Side panel opened on a POI        | `poiId`, `poiName`                                                                            |
| `geoleaf:poi:panel:close`    | Side panel closed                 | `poiId`                                                                                       |
| `geoleaf:panel:opened`       | Desktop tab panel opened a tab    | `tabId`                                                                                       |
| `geoleaf:panel:closed`       | Desktop tab panel closed a tab    | `tabId`                                                                                       |
| `geoleaf:layer:toggle`       | Layer shown or hidden             | `layerId`, `visible`, `source`                                                                |
| `geoleaf:filter:apply`       | Filter applied to features        | `layerIds`, `geometryType?`, `activeCount`                                                    |
| `geoleaf:filter:reset`       | Filter reset (everything visible) | `layerIds`                                                                                    |
| `geoleaf:map:move`           | Map panned (MapLibre `moveend`)   | `center.lat`, `center.lng`, `zoom`                                                            |
| `geoleaf:map:zoom`           | Zoom changed (MapLibre `zoomend`) | `zoom`, `oldZoom`, `center`                                                                   |
| `geoleaf:plugin:loaded`      | Plugin registered synchronously   | `name`, `version`                                                                             |
| `geoleaf:plugin:lazy-loaded` | Lazy plugin loaded asynchronously | `name`                                                                                        |
| `geoleaf:plugin:failed`      | Lazy plugin failed to load        | `name`, `error`                                                                               |
| `geoleaf:popup:action`       | Popup action button clicked       | `actionId`, `layerId`, `featureId`, `properties`, `lngLat?`, `button`, `setBusy()`, `close()` |

> ⚠️ **Two `panel` families, and they are not the same panel.** `geoleaf:poi:panel:*` is the
> **feature information** drawer, opened by clicking a POI and identified by `poiId`.
> `geoleaf:panel:*` is the **desktop tab panel** (layers / filters / legend), identified by
> `tabId`. Switching tab emits `closed` then `opened`, in that order; opening from a closed
> panel emits `opened` alone.
>
> ⚠️ `geoleaf:poi:panel:*` fires only for a feature carrying a **stable id**: `poiId` is typed
> `string`, and a layer whose source has no id emits nothing rather than a forged identifier.
>
> ⚠️ `geoleaf:geojson:visibility-changed` is typed too, but it is the **historical** form of
> `geoleaf:layer:toggle` and carries the same payload. New integrations take `layer:toggle`:
> it fires for every source, where `visibility-changed` is not re-dispatched on `document`
> when the change comes from a zoom recalculation.

---

## `geoleaf:popup:action`

Dispatched on `document` on every click of an action button (renderer `type: "action"` in `popup.fields[]`), on the **popup and the side panel alike** — both surfaces share one render table. This is the only channel for reacting to such an action — loosely coupled listeners (analytics, host integration, backend).

**Payload (`e.detail`):**

| Field        | Type        | Description                                                                                               |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------------- |
| `actionId`   | string      | Opaque action identifier (token `^[A-Za-z0-9:_-]{1,64}$`), as defined in the configuration.               |
| `layerId`    | string      | Identifier of the layer/source of the clicked feature.                                                    |
| `featureId`  | string      | Identifier of the feature (GeoJSON feature or POI), or `null` when the source has none.                   |
| `properties` | object      | Subset of the feature properties, bounded by `payloadFields`. **Empty by default — see below.**           |
| `lngLat`     | object?     | `{ lat, lng }` of the popup anchor point (optional).                                                      |
| `button`     | HTMLElement | The button that was clicked — a live node, for host-owned visual state.                                   |
| `setBusy`    | function    | `setBusy(busy: boolean)` — toggles `disabled`, `aria-busy` and the `gl-poi-popup__action--busy` modifier. |
| `close`      | function    | Closes the surface the button was rendered in — the popup **or** the side panel, never both. Idempotent.  |

> ⚠️ **`properties` is `{}` unless the button declares `payloadFields`.** The default goes to
> confidentiality, not convenience: this is a `document` event that any script on the page can
> hear, and a "send everything" default would leak the full property bag. There is no mode that
> sends the un-whitelisted bag, and its absence is not a configuration gap.
>
> _This table announced a default of `id`, `name`, `title`, `label` until 14/08/2026. That was
> never what the code did — `render/widget-dispatch.ts` has read `payloadFields ?? []` since
> 29/07/2026. Correcting it is the point: a downstream integrator had written its own handler
> contract around "the full properties", on the strength of this line._

> ⚠️ **The payload is NOT JSON-serialisable**, since 14/08/2026: `button` is a DOM node and two
> fields are functions. `JSON.stringify(e.detail)` **throws** (circular reference), and passing
> the detail to `postMessage` or a `Worker` throws `DataCloneError`. Copy the fields you need
> instead. The channel is dispatched as a raw `CustomEvent` for exactly this reason — routing it
> through the sanitising bus would have delivered `button` as `{}` and the two functions as
> `undefined`, without any error.

```ts
GeoLeaf.Events.on("geoleaf:popup:action", (e) => {
    const { actionId, layerId, featureId } = e.detail;
    if (actionId === "host:open-form") {
        _paq.push(["trackEvent", "Popup", "Action", actionId]);
    }
});
```

Showing progress and closing on success — what `GeoLeaf.Popup.registerActionHandler` used to
offer before ADR-07 removed it:

```ts
GeoLeaf.Events.on("geoleaf:popup:action", (e) => {
    const d = e.detail;
    if (d.actionId !== "tickets:create-request") return;
    d.setBusy(true);
    void createRequest(d.featureId)
        .then(() => d.close())
        .finally(() => d.setBusy(false));
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

- Payloads contain primitives only (`string`, `number`, `boolean`) — **with three named
  exceptions**, which carry live DOM nodes and are dispatched as raw `CustomEvent`s rather than
  through the sanitising bus: `geoleaf:popup:action`, `geoleaf:toolbar:action` and
  `geoleaf:layer-manager:panel`. A DOM reference in a `document` event widens what any script on
  the page can reach; for `geoleaf:popup:action` that trade is stated in its section above.
- The error carried by `plugin:failed` is truncated to 200 characters to avoid leaking stack traces.
- SSR-safe: calls are silent when `document` is undefined.
