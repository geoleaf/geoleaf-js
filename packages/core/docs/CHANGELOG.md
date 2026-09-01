---
title: "Changelog"
description: "Version history for @geoleaf/core"
---

# Changelog

All notable changes to `@geoleaf/core` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) — [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed — a mixed-geometry layer no longer paints its features in EVERY sub-layer

One declared GeoJSON layer becomes several MapLibre layers — `fill`, `casing`, `line`, `circle`,
`symbol` — over a **single** source. Each of them now carries a `geometry-type` filter, so a
sub-layer only paints the geometry it was built for.

**Why it changed.** MapLibre performs **no geometry-type check** when it fills a bucket: `FillBucket`
triangulates the rings it is handed — a `LineString` included, which it **closes** into a filled
polygon — and `CircleBucket` walks every point of every ring, so one line contributes **one circle
per vertex**. A layer carrying more than one geometry kind therefore rendered each of its features
in all of its sub-layers. Seen on a computed itinerary: the line drawn correctly, an opaque black
polygon closing it, and a hundred dots where there were three stops. It also made the fill layer
intercept clicks over the whole enclosed area.

**Who is affected.** Any layer whose source carries several geometry kinds, and any layer whose data
ships empty and is written at runtime through `GeoLeaf.Layers.setData()` — such a layer cannot be
scanned at creation, so all three sub-layer families are built for it. Homogeneous layers are
unaffected: the filter matches everything they hold.

⚠️ `setLayerFilter()` **composes** with the guard instead of replacing it, and clearing a filter
(`setLayerFilter(id, null)`) restores the guard rather than removing every filter. A caller reading
back `map.getFilter()` on a GeoLeaf sub-layer will see the composition, not the expression it
passed. Vector-tile layers are untouched — a source-layer is homogeneous by construction.

### Changed — a colour a style does not declare falls back to `#cccccc`, no longer to MapLibre's black

`fill-color`, `line-color` and `circle-color` were simply **not emitted** when the style declared no
`fillColor` / `color`, which left MapLibre's own default in place: an opaque `#000000`. A layer with
an incomplete style therefore rendered as solid black, which reads as data rather than as an
omission. The `styleRules` path never had that hole — it already fell back to the same
`#cccccc` — so the two paths now agree.

⚠️ **Size defaults are deliberately left alone.** `circle-radius`, `line-width` and
`circle-stroke-width` still fall back to MapLibre's values: most styles in the wild omit `radius`,
and moving that default would resize nearly every point layer for a defect that is not this one.

### Changed — a layer's declared `geometryType` is finally read, and it ADDS rather than restricts

The adapter's fast path only ever accepted GeoJSON names (`"Polygon"`), while the profile schema
allows nothing but the lowercase vocabulary (`"polygon"`, `"polyline"`, `"point"`) — so no profile
ever reached it. Both vocabularies are now understood.

🛑 A declared kind **adds** sub-layers, it never removes any: only the data may say "unknown". A
layer's declared kind is its _semantic_ kind — the legend and the layer manager read the same field
— and it can be narrower than its content (a computed itinerary is a `polyline` that also carries
its stops). Declaring a kind now guarantees a sub-layer exists for what the boot data cannot show;
it never narrows a layer down to that kind alone.

### Added — `boot({ config })` and `boot({ configUrl })`: the configuration is now INJECTED, not deduced

`GeoLeaf.boot()` accepts two new options. `config` hands the configuration over **in memory**: the
boot applies it directly and issues **no request** for it. `configUrl` names an explicit URL to
fetch it from. `config` wins over `configUrl`; without either, the path is still **derived from the
host page, unchanged** — no existing integration moves.

**Why it changed.** The configuration path was an _implied location_, and an embedding application
cannot always make the page imply it. Measured against a host router that answers unknown paths
with its own HTML document in HTTP 200: the derived path returned HTML where JSON was expected, and
the failure surfaced five errors away from its cause. `config` removes the request; `configUrl`
removes the deduction. Both make the location a **value the caller states**, which is the only form
an embedding host can control.

```js
// The configuration is already in memory — no request is issued for it.
GeoLeaf.boot({ config: { map: { center: [4.85, 45.75], zoom: 12 } } });

// Served from somewhere the page cannot imply.
GeoLeaf.boot({ configUrl: "/assets/geoleaf/config.json" });
```

**Migration — possible, not required.** `_app.getProfilesBasePath` **stays in place, stays called,
and returns the same string**. What changes is its _status_, not its behaviour: it is no longer the
only way to say where the configuration lives. An override installed solely to point the
configuration elsewhere **may** be replaced by `boot({ configUrl })`, or dropped entirely if the
configuration is held in memory. Doing nothing is a valid choice.

⚠️ **This entry is late, and the lateness left a visible trace.** The entry below on the rejecting
configuration load referred to `GeoLeaf.boot({ config })` as "new in this same release" while no
entry described it — a dangling reference in a published changelog, pointing at something a reader
could not find. Nothing in `ci:local` compares a cross-reference to the entry it names.

### Removed — BREAKING: `GeoLeaf.Sync.getHandlers()` (pre-adoption window)

The plural accessor is gone from the `Sync` façade and from the internal registry seam.
`registerHandler(id, handler)` and `getHandler(id)` are the whole contract — they are what the
offline replay path actually uses, one id at a time.

**Why it could go in a minor.** This lands under the pre-adoption window of
`VERSIONING_POLICY.md`: no consumer follows a semver range today, and the one measured
consumer manifest never names the member. The accessor was introspection-only — every one of
its ten call sites lived under `__tests__/` with the member as its own oracle — and keeping it
pinned a registration-order promise nothing needed.

**If you did adopt it**, enumerate your own registrations instead: you know the ids you
registered; resolve them with `getHandler(id)`.

### Fixed — the proximity radius slider dropped fractional values

A profile is free to declare fractional radius bounds on its `kind: "proximity"` filter field —
`radiusStep: 0.1` for 100 m granularity, `radiusDefault: 0.5` for a 500 m starting radius. Those
bounds reached the `<input type="range">` intact, then two `parseInt` reads truncated them.

**What you saw.** Every radius below 1 km collapsed to **zero**: the circle vanished and the
filter kept nothing. Above it, values were rounded down — 1.4 km became 1.0 km. With
`radiusStep: 0.1` over a 0.1–10 km range, the slider offered 99 notches and produced 11 distinct
radii, the first 9 of them dead. The first click on the map was worst: the toolbar button read
the slider's default the same way, so proximity armed at a radius of 0 before the slider had been
touched at all.

**And the label disagreed with the map.** It was written from three different sources — the
configured number when the bar was built, the truncated integer while dragging, the raw
`defaultValue` string on reopen. So the pill could read "0.5 km" next to a circle of radius zero,
then flip to "0 km" on the first movement. The displayed radius and the applied radius are now
read from one number.

**Also fixed.** `GeoLeaf.Filter.proximity.toggle(map, 0)` used to pass the zero straight through
to the circle — the `?? 10` default only caught `null` and `undefined`. Any non-finite or
non-positive radius now falls back to 10 km.

The geometry was never at fault: the drawn polygon and the filter predicate already stood on the
same `EARTH_RADIUS_M`, and still do.

**No action needed.** Integer bounds behave exactly as before, and the in-core defaults
(`min: 1, max: 50, step: 1, default: 10`) are unchanged.

### Changed — the proximity radius label goes through the dictionary

The pill's radius label was built from an inline `` `${…} km` `` template in three places, while
`format.proximity.radius` sat declared in all six language files with no consumer. It is wired
now, so the unit is overridable like every other label.

### BREAKING — a failed configuration load now REJECTS instead of degrading

`GeoLeaf.Config.loadUrl()` used to swallow its failure: an unreachable URL, invalid JSON, or a
content type refused by `strictContentType` were logged, and the configuration already in place
was returned. The promise resolved. It rejects now, and the boot stops.

**Why it changed.** Because the resolution made the failure _unattributable_. Measured in a real
browser against a host router answering its own HTML document in HTTP 200 on the configuration
path: the console carried two precise errors — then, because the promise had resolved, the
initialisation manager announced **"Configuration loaded successfully"**, and five consequence
errors followed. None of them named the cause. An integrator read a success, then five map
failures, and went hunting the map. Logging the cause made the failure legible; only rejecting
makes the contradiction impossible.

**Who this breaks.** Any caller that relied — knowingly or not — on the boot continuing after a
failed configuration load. There is no silent path any more: the failure surfaces where it
happens.

**What to do.** If the configuration is already held in memory, `GeoLeaf.boot({ config })` (new
in this same release) removes the request entirely and the question does not arise. Otherwise,
handle the rejection where you call `loadUrl`.

⚠️ **This entry is late, and that is worth recording.** The change landed on 20/08/2026; this
entry was written after a review found that the published `.d.ts` still promised the opposite
behaviour ("Failure is contained, not thrown"). The deprecation policy added below exists
because three removals had already shipped under that same silence — this is the first case that
tested it, and it failed the test until the review caught it. Nothing in `ci:local` can see a
sentence that stopped being true.

### Added — a deprecation policy, and the gate that makes it verifiable

`VERSIONING_POLICY.md` gains a **Deprecation** section. Until now the file said a breaking
change lands in a MAJOR without saying how one gets there — so nothing described what an
announcement is, how long it must stand, or what counts as one. Three removals had already
happened under that silence, each leaving a trace in a different form, none of them machine
readable, and two of them broke an external consumer without warning.

The policy names three artifacts, all required: the `@deprecated` TSDoc tag on the symbol,
an entry here, and an entry in `docs/reference/consumers/DEPRECATIONS.json`. Only the first
travels inside the npm tarball — it rides in the emitted `.d.ts` — which is why it is
required rather than recommended.

The rule on timing: **the announcement must survive at least one published `minor`, and
`removeIn` is the next MAJOR.** A release that both announces and removes announces nothing.

This is enforced rather than declared. `CC-10` of `scripts/verify-consumer-contract.cjs`
refuses a path that leaves the consumed public surface without a register entry and a real
tag on its symbol.

### Changed — three `maxRetries` aliases are no longer tagged `@deprecated`

`CacheManagerConfig.maxRetries`, `RetryConfig.maxRetries` and `RetryOptions.maxRetries` are
**kept aliases**, not deprecations: they are normalised into `maxAttempts` on read, and
nothing schedules their removal. They carried a `@deprecated` tag, which struck the key
through in editors and promised a removal that was never planned.

The 3.0.0 entry below describes `maxRetries` as "a deprecated, normalised alias". The
normalisation is unchanged and no configuration behaves differently; what changes is that
the tag no longer claims a removal. Under the new policy, `@deprecated` marks a symbol that
is going away — a kept alias is a different statement, and conflating the two makes the tag
lie to autocompletion.

### Added — `Core.isAttached()` and `Core.reattach()`

`GeoLeaf.Core` gains two members for hosts that move a map around their layout instead of
destroying and rebuilding it — a full-screen toggle, a tab switch, a panel that re-mounts.

```ts
const Core = GeoLeaf?.Core;
if (Core && !Core.isAttached("main")) {
    Core.reattach("main", document.getElementById("fullscreen-slot")!);
}
```

- **`isAttached(mapId): boolean`** — the map is registered **and** its container is still in the
  document. Deliberately distinct from `hasMap()`, which only answers the first half: a host that
  removes the map's subtree without calling `destroy()` leaves a registered map that renders
  nowhere, and `hasMap()` still says `true`. Returns `false` after `destroy()`, never throws.
- **`reattach(mapId, parent): boolean`** — moves the live map into another parent. The **whole
  container** is re-parented; its children are not moved individually. That is imposed by the
  engine: MapLibre memorises the element it was constructed with, so moving the children leaves
  `map.getContainer()` pointing at the old node and every subsequent measurement wrong.

⚠️ **The panels do not follow the map.** `#gl-right-panel` and its siblings live in the shell,
not inside the map container, so they stay where they are. Rebuilding them at the new location is
the host's call, through three already-public exports:
`GeoLeaf.UI.destroyDesktopPanel()` → `initDesktopPanel()` → `activateDesktopPanel()`. Making them
follow would tie this API to the shell's DOM — the coupling it exists to remove.

The map adapter contract gains an optional **`resize?(): void`**, which `reattach()` calls after
the move so the WebGL drawing buffer picks up the new container size. Optional, like
`getNativeMap?()`, so test doubles stay conformant. Custom adapters that do not implement it are
accepted; their canvas will keep its pre-move dimensions.

### Changed — `GeoLeaf.getMap()` and `GeoLeaf.getAllMaps()` return the live map

The top-level shortcuts read the same registry as `GeoLeaf.Core`. **They previously returned
`null` and `[]` for every live map**, whatever the application did: they read a mirror registry
that only `GeoLeaf.createMap()` ever filled, and the boot path does not go through it. The mirror
is gone.

```ts
GeoLeaf?.getMap?.("main") === GeoLeaf?.Core?.getMap("main"); // true — was null === adapter
GeoLeaf?.getAllMaps?.().length === GeoLeaf?.Core?.listMaps().length; // true — was 0
```

**Integrator impact.** This is a widening: code that received `null` now receives an adapter.
A fallback written against the old behaviour — `GeoLeaf.getMap(id) ?? somethingElse` — stops
taking its second branch. Nothing that worked before stops working.

`APIFactoryManager.removeMapInstance()` changes with it: it used to drop the mirror entry and
leave the real map running, and now destroys the map, as its name always claimed.

### Changed — `geoleaf:popup:action` carries `button`, `setBusy()` and `close()`, and is no longer JSON

The detail of `geoleaf:popup:action` gains the three members that
`GeoLeaf.Popup.registerActionHandler` provided before ADR-07 removed it: **`button`** (the clicked
node), **`setBusy(busy)`** (toggles `disabled`, `aria-busy` and `gl-poi-popup__action--busy`) and
**`close()`** (closes the surface the button was rendered in — the popup **or** the side panel,
never both). A host action can finally show a pending state, close on success, and report a
failure in place.

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

**Integrator impact — the payload is no longer serialisable.** `JSON.stringify(e.detail)` now
**throws** (circular DOM reference), and passing the detail to `postMessage` or a `Worker` throws
`DataCloneError`. If you log, forward or persist the detail, copy the fields you need first:
`const { actionId, layerId, featureId, properties } = e.detail;`. **Subscribing is unaffected** —
`GeoLeaf.Events.on/off/once` accepts this key exactly as before, with the same type inference.

The event is dispatched as a raw `CustomEvent` and its key moved to `GeoLeafRawEventMap`, joining
`geoleaf:toolbar:action` and `geoleaf:layer-manager:panel`. Routing it through the sanitising bus
would have delivered `button` as `{}` and the two functions as `undefined` **without any error** —
which is why the map is split rather than the payload.

⚠️ **Two corrections to previously published documentation, both of which were wrong before this
release:**

- `EVENTS_API.md` announced that `properties` defaults to `id`, `name`, `title`, `label`. It never
  did: **without `payloadFields`, `properties` is `{}`**, and has been since the feature shipped
  on 2026-07-29. The default goes to confidentiality — this is a `document` event any script on
  the page can hear. If you relied on the documented default, declare `payloadFields` explicitly.
- Action buttons were attributed to a plugin named `@geoleaf-plugins/feature-info`. **No such
  package exists**; `feature-info` is a capability built into `@geoleaf/core`.

**Fixed at the same time:** an action button clicked in the **side panel** emitted `featureId:
null` and no `lngLat`, because that surface passed only `layerId` to the render context. Both
surfaces now pass the full context. The popup was unaffected.

⚠️ **Widened attack surface, stated rather than implied.** The detail now carries a function that
closes the popup, on a `document` event. Any script on the page can call it — as it could already
call `document.querySelector(".gl-poi-popup__action").click()`. The confidentiality rule on
`properties` is what guards this channel, and it is unchanged.

### Changed — the six `@geoleaf-plugins/connector` events are now prefixed `geoleaf:connector:`

`connector:authenticated`, `connector:token-refreshed`, `connector:auth-error`,
`connector:credential-button-clicked`, `connector:signup-requested` and
`connector:forgot-password-requested` become `geoleaf:connector:…`. They were the only public
events in the product outside the `geoleaf:` naming domain.

This was not cosmetic. The repository's event coverage gate is anchored on `^geoleaf:`, so all
six were **structurally invisible** to it — never typed, never listed, never counted. Prefixing
them made the gate demand all six in the same run, and they are now typed in `GeoLeafEventMap`
alongside every other public event.

**Integrator impact — this breaks listeners.** Any `document.addEventListener("connector:…")`
must be renamed; the old names are no longer emitted. The payloads are unchanged, and the two
cancelable events (`signup-requested`, `forgot-password-requested`) keep their contract:
`preventDefault()` still blocks the link navigation.

⚠️ If you also run the downstream connector plugin, note that `geoleaf:connector:*` is now
a shared namespace. The six names above do not collide with the six it emits (`ready`,
`bbox-loading`, `bbox-loaded`, `data-version-changed`, `error`, `auth-required`), but nothing
prevents a future clash — check both lists before adding a name.

### Added — `geoleaf:panel:opened` / `geoleaf:panel:closed`, and two POI panel events that finally fire

The desktop tab panel (layers / filters / legend) now reports both directions, with `{ tabId }`.
Switching tab emits `closed` then `opened`, in that order; opening from a closed panel emits
`opened` alone, and closing an already-closed panel emits nothing. Both the pointer path and
`GeoLeaf.UI.openPanel()` are covered — an event describing only the programmatic path would be
half a contract.

`geoleaf:poi:panel:open` and `geoleaf:poi:panel:close` were **declared in the published types
since v1 and never emitted**: a listener compiled and never ran. They are now emitted by the
feature-information side panel. `poiName` resolves through the same path as the displayed title,
so the event carries what the user reads.

⚠️ A feature without a stable id emits nothing rather than a forged `poiId` — two anonymous
features would otherwise be indistinguishable to a listener.

⚠️ **Two `panel` families, and they are different panels**: `geoleaf:poi:panel:*` is the feature
drawer, keyed by `poiId`; `geoleaf:panel:*` is the desktop tab strip, keyed by `tabId`.

### Added — nine `geoleaf:table:*` events and `geoleaf:geojson:visibility-changed` are typed

The table plugin's nine events (`opened`, `closed`, `layerChanged`, `sortChanged`,
`selectionChanged`, `zoomToSelection`, `exportSelection`, `exportLayer`, `highlightSelection`)
now appear in `GeoLeafEventMap` with their payloads. They were emitted all along, but their
names were assembled at runtime, so no tooling could see them.

**No behaviour changed and no name changed** — only the declarations. Each of the nine is
emitted on both `document` and the MapLibre bus: subscribe to one, never both.

`geoleaf:geojson:visibility-changed` is typed too. Prefer `geoleaf:layer:toggle` for new work:
it carries the same payload and fires for every source, whereas `visibility-changed` is not
re-dispatched on `document` when the change comes from a zoom recalculation.

### Fixed — a click on a feature now emits **one** `geoleaf:feature:click`, whatever its geometry

The kernel bound the click handler to **every** sub-layer of a layer, while it bound hover to a
single one. Sub-layers are stacked per geometry and cumulatively, so a single click emitted **2**
events on an icon point, **2** on a cased line, **3** on a cased polygon and **4** on a vector
tile. Downstream, `feature-info` closes and reopens its popup on each event, so the popup
flickered and the second render replaced the first for the same feature.

Click and hover now share one selection (`fill` → `circle` → `line` → all), so a gesture cannot
be reported twice. **Integrator impact**: a listener on `geoleaf:feature:click` that de-duplicated
events itself can drop that workaround; one that counted events will now count fewer.

⚠️ On an icon point the clickable area becomes the circle rather than the icon's collision box.
Nothing becomes unreachable — every point renders a `-circle` sub-layer unconditionally — and
nothing is lost on the axes; only the diagonal ring of the icon's padding is.

### Fixed — pre-cached assets are served offline again (PWA second load)

The service worker wrote its pre-cache into one bucket and looked for it in another: `install`
derived its scope from the injected asset list, while `fetch` decided from a **file-extension
list** that does not accept `json`. Two pre-cached entries — `manifest.json` and the root profile
config — were therefore stored and never found, and the application could not boot offline on a
second load for want of its configuration.

The router now resolves membership against the pre-cache itself, so what `install` writes is
what `fetch` reads. **No configuration change is required.**

### Changed — an HTTP `501` from the editor backend is no longer treated as a network failure

`@geoleaf-plugins/editor` classified every non-4xx response as `"network"`, which
`auto-adapter` treats as retryable — so a `501` (the server does not implement the verb) was
**queued for retry** and the user was told to try again. It never would have succeeded.

A `501` now raises `PersistenceError` with the new kind **`"capability"`**, is never queued, and
surfaces a dedicated message (`editor.error.operationNotSupported`, added in all six locales).
This aligns the editor with the decision the core already applies to its own offline queue.
**Integrator impact**: code branching on `err.kind === "network"` to detect a `501` must branch on
`"capability"` instead.

---

## [3.0.0] - 2026-08-12

> **Major release v3.0.0.** It consolidates the whole v3 effort: dissolution of the POI subsystem into generic point layers, taxonomy v3 (the point symbol), extraction of the optional modules into in-core capabilities and MIT plugins, multi-instance rework, security hardening (strict `style-src` CSP) and **hard removal of all legacy** (deprecated API aliases, re-export shims, format fallbacks, legacy configuration keys).
>
> The jump from the last version published on npm (**2.1.8**, 2026-05-13) is a large one. Breaking changes are numerous; where a migration path exists it is written next to the entry that needs it.

::: warning

`taxonomy` and `feature-info` are capabilities built into `@geoleaf/core`, **not** separate npm packages. Entries below that mention `@geoleaf-plugins/feature-info` and `@geoleaf-plugins/taxonomy` as external plugins to install or load through a `<script>` tag are obsolete: both capabilities ship **inside the core bundle** (`geoleaf.esm.js` + `dist/geoleaf-main.min.css`) and are enabled by configuration — no extra install, no extra `<script>` tag. **Migration**: remove the `<script src="dist/geoleaf-taxonomy.plugin.js">` and `<script src="dist/geoleaf-feature-info.plugin.js">` tags.

:::

### Changed — **BEHAVIOURAL BREAKING CHANGE**: `analyzeMemoryLeaks()` no longer returns `normal` on a browser that measures nothing

`GeoLeaf.Utils.PerformanceProfiler.analyzeMemoryLeaks()` returned a verdict that was a
**constant**. It computes `growthRate` from samples of `getMemoryUsage()`, which reads
`performance.memory.usedJSHeapSize` — a value Chrome quantises **and freezes for the lifetime of
the page** unless `--enable-precise-memory-info` is set. The samples were therefore strictly equal,
`growthRate` was exactly `0`, and `warning` / `critical` were **unreachable**.

The deciding fact is a measurement: on a page deliberately retaining 9.0 to 15.1 MB (confirmed
outside the page, through CDP `Runtime.getHeapUsage` after a forced GC), the API returned
`{"status":"normal","growthRate":0,"recommendation":"No action needed"}` — **six times out of six**.

**What changes**

- `status` can now be **`"unavailable"`**, together with a `reason`:
  `"heap-readings-constant"` (every sample in the window equal to the byte) or
  `"heap-api-unavailable"` (the window opens on a null reading). Two **arithmetic** tests,
  with no threshold to tune.
- `"heap-api-unavailable"` closes a second blind spot: outside Chromium, `performance.memory` does
  not exist, every sample is `0`, and the former computation did `(0 − 0) / 0 = NaN`. Since `NaN`
  is greater than no threshold, the verdict fell back to `normal` — with a `growthRate: NaN`
  published as is.
- `generateReport()` carries the unavailability in its recommendations: that is the path an
  integrator actually reads, and it kept reading "all is well".

**What does not change, deliberately**

`status` remains typed `string` — it is **not** narrowed to a union, which would break an existing
consumer's `switch`. The only type addition is `reason?: string`, **optional**. No signature is
modified: the break is one of **behaviour**, not of compilation.

::: info

A window that moves and returns to its starting point is still `normal`, with `growthRate: 0`.
Same figure as the frozen case, opposite verdict — because the input did vary.

:::

::: warning

`unavailable` must **not** be read as "no leak". It says the browser gave nothing to judge. A
caller that treated `"normal"` as a green light must now handle `"unavailable"` separately: on a
standard Chrome, **this API will never return `normal` again**. It has stopped lying, it has not
learnt to see — and it loses the right to confirm good health. For a real figure, measure **outside
the page** (DevTools, or CDP `Runtime.getHeapUsage` after `HeapProfiler.collectGarbage`).

:::

### Added — `modules.offline.cache.maxTileCacheEntries`, and `geoleaf:cache:evicted` typed in the contract

The Service Worker tile cache was bounded by **nothing**. It lives in the Cache API, on the same
origin as IndexedDB — and browsers evict **per origin, not per store**. An unbounded tile cache
could therefore take `sync_queue` down with it under disk pressure, that is, field entries that are
not yet synchronised and have **no other copy**.

```json
{ "modules": { "offline": { "cache": { "maxTileCacheEntries": 2000 } } } }
```

A **declarable** ceiling, default **2,000**, `0` disables eviction. Above the ceiling the oldest
entries go first; under origin quota pressure the trim becomes markedly more aggressive.

::: warning

Counted in **ENTRIES, not bytes** — the Cache API exposes the size of no entry, and
`storage.estimate()` measures the whole origin rather than a single store. Not to be confused with
`maxCacheBytes`, which bounds IndexedDB in bytes (default 250 MB): these are **two distinct budgets
against the same origin quota**.

:::

`geoleaf:cache:evicted` now carries a typed detail, `GeoLeafCacheEvictedDetail`
(`contracts/event-bus.contract.ts`): `{ evicted, freedBytes?, totalBefore?, totalAfter? }`.

::: warning

The event has **two producers, deliberately**: `cache-manager.ts` for IndexedDB, `sw-core.js` →
`sw-register.ts` for the Cache API. The two stores evict from contexts that can share no code — a
Service Worker has no `document` and can import neither the contract nor the bus. **`freedBytes` is
absent on the Cache API side**, for that reason: a consumer must handle its absence rather than
assume a `0`.

:::

#### Browser measurements

Taken on both deployed variants, Service Workers blocked, first load:

| Measurement                                          | `deploy-core` | `deploy-full` |
| ---------------------------------------------------- | ------------- | ------------- |
| Third-party origins at boot (unpkg, Google Fonts)    | **0**         | **0**         |
| CSP violations                                       | **0**         | **0**         |
| Eager chunks started **after** the entry is received | **0 / 3**     | **0 / 3**     |
| `DOMContentLoaded`                                   | ~75 ms        | ~120 ms       |
| Connections opened in addition to the navigation     | **0** (h2)    | **0** (h2)    |

::: warning

This is not a paired before/after. The "before" artefact (third-party origins, MapLibre 5) no
longer exists on disk, and rebuilding it would mix four separate efforts into a single delta. The
values above are the **measured state**, not an attributed gain. The millisecond figures vary from
one run to the next and carry no threshold.

:::

### Added — `GeoLeaf.Introspection.getCapabilityStatus()`

One question, one answer: **what is switched on, and why**. Returns, for each declared capability,
`{ id, embarked, enabled, gate, hasModule }`.

To be distinguished from its two neighbours, which answer something else:

- `getAllCapabilities()` returns what is **declared** (the schema);
- `getActiveModules()` returns what **runs** (the initialised modules);
- `getCapabilityStatus()` returns the **configuration verdict**.

`enabled` is **re-read on every call** against `GeoLeaf.Config`, therefore against the merged
configuration as soon as the profile is loaded. Before `boot()`, no configuration exists and each
gate answers its `enableWhenAbsent` — the exact answer to "with what is configured right now", not
a fallback value.

::: warning

`embarked` says **where the declaration comes from**, not whether the capability appears in the
full manifest: `true` when it comes from a preset installer (the build), `false` through the
runtime channel (`GeoLeaf.plugins.registerCapability`). Comparing against the full manifest would
require importing it, which would cancel the tree-shaking that a purpose-built entry buys.

:::

::: warning

`hasModule` is a **structural** fact — the capability contributes an `ICoreModule` — never a
runtime fact, and the id of that module is not necessarily the id of the capability (`permalink`
contributes `share`). For "is it running", the answer is `getActiveModules()`.

:::

### Changed — **BREAKING**: `registerPresetDeclarations()` requires a `noteInstaller`

Its second parameter must now carry `noteInstaller(id, facts)` in addition to `register(decl)`.
This only affects code that composes its own preset by calling `presets/apply-preset.js` directly;
the contract is hardened rather than made optional so that an omission is a compilation error and
not a silent `embarked: false`.

### Removed — **BREAKING**: `@geoleaf-plugins/addpoi` merged into `@geoleaf-plugins/editor`

There is now only **one** editing plugin. **`GeoLeaf.AddPOI` disappears WITH NO ALIAS** — a
deliberate decision: the application has no deployed users, and an adoption path would be code to
write, test and then delete, for zero beneficiaries.

::: warning

There is **nothing to deprecate: `@geoleaf-plugins/addpoi` was never published.** The npm registry
returns `E404` for it. No version was ever installable, so **nobody can have written
`GeoLeaf.AddPOI`** against a published package. The migration table below describes an internal
switch, not an upgrade path for an integrator.

:::

::: danger

The real breaking change for an integrator is elsewhere, and it is `ui.showAddPoi` — that key
existed in the schema of `@geoleaf/core` **2.1.8**, the published version, and disappears in 3.0.0.
It is the only item in this section that a real consumer may have in their profile.

:::

**Migration note:**

| Before                                    | After                                     |
| ----------------------------------------- | ----------------------------------------- |
| `GeoLeaf.AddPOI.AddForm.openAddForm(ll)`  | `GeoLeaf.Editor.AddForm.openAddForm(ll)`  |
| `GeoLeaf.AddPOI.PlacementMode.activate()` | `GeoLeaf.Editor.PlacementMode.activate()` |
| `ui.showAddPoi`                           | `modules.editor.showAddPoi`               |
| `modules.addpoi.defaultPosition`          | `modules.editor.poiAddDefaultPosition`    |
| `ui.showPoiExport` · `ui.showPoiSubmit`   | `modules.editor.showExport` — see below   |
| `<script src="geoleaf-addpoi.plugin.js">` | nothing: `editor` loads **lazily**        |

::: warning

`ui.showAddPoi`, `ui.showPoiExport` and `ui.showPoiSubmit` are **removed from the `UIConfig` type
and from the schema**. The last two were declared in **no** schema at all while `ui.schema.json` is
`additionalProperties: false`: writing them made profile validation fail. One button was therefore
visible without being hideable, the other hidden without being showable. Their replacements live
under `modules.editor.*` and are **declared**.

:::

::: warning

Default change: `ui.showAddPoi` was `false` (opt-in); `modules.editor.showAddPoi` is `true`
(opt-out), like the plugin's other lazy slots. A profile that did not set the key and did not load
`addpoi` had no button; if it loads `editor`, it will have one.

:::

**What the merge changes in the core:**

- The `kernel/ui/poi-addform-seam.ts` seam and its `contracts/poi-addform.contract.ts` contract are
  **removed** (180 lines). The core no longer resolves a plugin namespace in order to draw a
  button: the button is a **lazy toolbar slot**, declared by the host application.
- `GeoLeaf.Utils.poiToFeature` **stays** — it is a public core API, independent of the plugin.
- Deployment variants go from **3 to 2**: `deploy-addpoi` disappears, `deploy-full` carries both
  editing **and** offline support.

---

### Changed — **BREAKING**: `enableEdition` / `enableEditionFull` become an `edition` block

The two editability flags of a layer are replaced by a **per-operation** block.
`enableEditionFull` **did not mean "full editing"**: it was usefully read only once, as
`canDelete()` — it was **the right to delete**. Nobody guesses that from the name.

**Failure mode:** `layer-config.schema.json` is `additionalProperties: false`, so a profile still
carrying the old keys **fails validation**, with the key named. A clean stop, not a silent
degradation.

| Before                       | After                                           |
| ---------------------------- | ----------------------------------------------- |
| `"enableEdition": true`      | `"edition": { "create": true, "update": true }` |
| `"enableEditionFull": true`  | add `"delete": true` to the same block          |
| `"enableEditionFull": false` | omit `delete` (or write it `false`)             |

::: warning

The majority case is the most surprising one, and that is intended: a profile that only had
`enableEdition: true` breaks **too**. It must write `create` and `update` separately, and **decide**
about deletion. That is precisely what the former pair could not express.

:::

**Semantics — absent means REFUSED, and no key implies another:**

```
edition absent          → create=false, update=false, delete=false
edition: {}             → same — declaring the block grants NOTHING
edition: {create:true}  → create only; update and delete stay false
```

::: warning

No layer changes state through omission: a layer that declared nothing was not editable before
either. The restrictive default therefore takes editing away from nobody — a permissive default
would have granted it, silently, to the 42 layers out of 48 that declare nothing.

:::

::: warning

The gate becomes per-operation where `enableEdition` governed _everything_. This is not
iso-behavioural for `create` and `update`: they can now be refused independently.

:::

::: danger

What this block does NOT do, to be read before relying on it. `edition.delete` is applied on the
**offline write path only**. Online, the editing plugin's REST adapter issues an unconditional
`DELETE`, and its toolbar gates the delete tool on its own configuration, never on the layer.
**A layer declaring `delete: false` therefore remains deletable by a signed-in user.** This is not
an end-to-end authorisation model.

:::

- **Rule A14 is re-anchored**: an `attributes.fields[].edit` field now requires
  `edition.update: true` (no longer `enableEdition: true`), still accompanied by a `write` block.
  `update` and not `create`, because `edit` describes modifying an **existing** value.

### Changed — **BREAKING** for layer configuration

- **Attribute rendering is declared in an `attributes` block at the ROOT of the layer.** The
  `capabilities["feature-info"]` block and its three parallel lists (`tooltip` / `popup` /
  `sidepanel`) are **removed from the schema**: a layer that still carries them no longer validates.

    ```json
    {
        "attributes": {
            "titleField": "properties.nom",
            "fields": [
                {
                    "field": "properties.nom",
                    "label": "Nom",
                    "primitive": "string",
                    "widget": "text",
                    "display": {
                        "surfaces": ["tooltip", "popup", "sidepanel"],
                        "presentation": { "emphasis": "title" }
                    }
                }
            ]
        }
    }
    ```

    **A single list**, where each field names the surfaces it appears on, instead of three lists of
    different shapes that had to be kept parallel by hand. The block is **strict**: it used to live
    under `capabilities`, which was `additionalProperties: true`, so a typo passed silently.

    The type is declared in **two columns** — `primitive` says what the value IS in the GeoJSON,
    `widget` says how it is shown. That pairing is what lets `validate:profiles` refuse, at build
    time, a number asked to be displayed as a date; a single "representation" column would have
    nothing to check against.

- **The `"all"` mode is removed, and it triggered on SILENCE.** `"all"`, a missing surface and a
  `null` surface all went through the same branch: a layer that simply **omitted** a surface exposed
  **all** the properties of its features there — technical identifiers and working columns included.
  A layer that declares nothing now paints nothing.

    If you relied on that behaviour, declare the wanted fields explicitly. The flat list of what a
    profile declares is generated by `npm run gen:attributes-report`.

### Fixed

- **The same data was displayed differently depending on the surface.** A `price` field rendered a
  formatted amount in the side panel and `[object Object]` in the popup; `badge` and `link` had the
  same defect in the tooltip. The three surfaces now share **one single** value projection.

- **An `action` field declared on the side panel was neither rendered nor reported.** The cause was
  not a missing branch but a **payload**: the panel received only the layer id, while
  `geoleaf:popup:action` promises `featureId` and `lngLat`. Both interactive surfaces now render the
  button, with its complete payload.

- **`coordinates` and `hours` disappeared from the popup**, rendered by the panel alone.

- **`date`, `url` and `email` were declared and rendered nowhere** — a field carrying one of them
  disappeared without warning. They now render: `date` through `Intl`, honouring a per-field locale,
  `url` and `email` as links. A `mailto:` address that the URL validator refuses **degrades to
  readable text** rather than being dropped — sanitisation is never bypassed.

- **An unknown `widget` is no longer silent**: it is not rendered, it is **logged**, and it is never
  fatal — an incorrect profile must not empty the map.

### Added

- **`@geoleaf/core` now publishes its ambient namespace.** `dist/types/global.d.ts` is emitted at build time and referenced by the entry point (`/// <reference path="./global.d.ts" />`), so `GeoLeaf.*` **resolves for the integrator** without a manual declaration — in TypeScript as well as in editor auto-completion.

    ```ts
    // No more `declare const GeoLeaf: any;` in your project.
    GeoLeaf.Layers.getFeatures("my-points"); // typed
    ```

- **Public facades carry their documentation in the shipped types.** The five offline IndexedDB sub-modules (`LayersDBInstance`, `SyncDBInstance`, `ImagesDBInstance`, `BackupsDBInstance`, `PreferencesAPI`), the legend types, `ProgressData`, `ResolverZone`, `ConfigFacade` and the `Utils` export now document **what they do and why** — visible directly in the editor.

    `Utils` carries a clarification that was missing: the ESM export and the `GeoLeaf.Utils` global have **the same shape but are two distinct objects**. Mutating one does not affect the other.

### Fixed

- **The package's npm shop window (`README.md`) taught a dissolved API and a subpath that does not resolve.** It carried a copy-pasteable `GeoLeaf.POI.add({…})` — `GeoLeaf.POI` has been removed since 3.0.0 — an `import { Core, POI, Filters }` of which two members no longer exist, and two `import "@geoleaf/core/dist/…"` that throw `ERR_PACKAGE_PATH_NOT_EXPORTED`: the `exports` map does not open `dist/`.

    ```js
    // The CSS is imported through the declared subpath:
    import "@geoleaf/core/style.css";
    ```

    It also announced "Platform V2 / 2.0.0" on a package at 3.0.0, `node ≥18` for an engine that requires 22.13, a CDN pin at `@2.0.0`, and a dead link to `docs/poi/`. **Rewritten as a shop window plus pointers** — duplication with `docs/` was the mechanical cause of the drift.

- **`repository` and `bugs` in the manifest pointed at a frozen mirror repository.** They targeted `GeoLeaf-Core`, whose automatic synchronisation is gone; they now point at the real repository. The "Repository" and "Issues" links on the npm page therefore lead to a living repository.

- **Two public declarations of `CacheMetrics` depended on a compiler flag or on a non-exported type.** No internal consumer exercised either one, so the repository's sixteen `tsc -p` passes came out green while an integrator no longer compiled.
    - `getStorageQuota()` — the properties synthesised by a multi-branch ternary went from `?: undefined` to `?: never` depending on whether `exactOptionalPropertyTypes` was set. The return type is now **explicitly annotated**: the published declaration no longer depends on a compilation setting.
    - `estimateProfileSize()` — its inferred return referenced a **non-exported** `interface`, therefore one without an implicit index signature. `const r: Record<string, number> = estimate.byType` **stopped compiling**, and the type still shipped in `dist/types/` under a name nobody could write. The type is now exported.

- **The getting-started tutorial did not work if followed to the letter.** `QUICKSTART_TUTORIAL.md` asked for `layers.json`, `ui.json` and `basemaps.json` to be created **at the profile root**, while the `profile.json` on the same page declared them under `config/core/`. Structure, `Files` key and step titles are now aligned.

- **Two dead profile keys were taught as living ones** — `clusteringConfig` and `poiConfig`. Neither exists in the schema, neither is read by the code. Clustering is configured through the capability: one default in the profile (`Files.modules.cluster` → `config/plugins/cluster.json`), one per-layer override.

    ```jsonc
    // config/plugins/cluster.json
    { "clustering": true, "clusterStrategy": "unified", "clusterRadius": 80 }
    ```

    Corrected in `QUICKSTART_TUTORIAL`, `PLUGIN_CONFIGURATION_GUIDE` and `GEOJSON_LAYERS_GUIDE`, where four passages still presented them as the current mechanism.

- **Examples in the published documentation called `GeoLeaf.POI.*`**, removed from the core in 3.0.0. Migrated to `GeoLeaf.Layers.*` in `USER_GUIDE`, `helpers/` and `security/`.

- **The `configSchema` descriptions returned by `GeoLeaf.Introspection.getCapabilitySchema()` quoted source line numbers.** A `file:line` citation goes stale at the first insertion upstream, and these shipped in the published package. Removed.

### Removed

- **BREAKING — the `@geoleaf/core/presets/preset.contract.js` subpath is removed.** It becomes **`@geoleaf/core/contracts/preset.contract.js`**; the module, its types and its content are unchanged, only the address moves.

    ```ts
    // before
    import type { PresetManifest } from "@geoleaf/core/presets/preset.contract.js";
    // after
    import type { PresetManifest } from "@geoleaf/core/contracts/preset.contract.js";
    ```

    **Why.** This file is 100% type-only and it was the **only** one of the repository's 15 `.contract.ts` files to live outside `contracts/`. The check that verifies this family remains a pure type surface reads `contracts/` without recursion, so the file escaped it entirely, and nothing would have flagged it acquiring executable value — which 21 capability installers would then have pulled into the bundle. Moving it puts it under guard.

    The subpath was **not** kept as an alias: `./presets/*` would have kept announcing a directory the file has left, which is exactly the defect being corrected.

### Added

- **Three interface selectors, as gated capabilities** — `GeoLeaf.ProfileSwitcher`, `GeoLeaf.LanguageSwitcher` and `GeoLeaf.ThemePalette`. Each is switched on by `modules.<id>.enabled` and is **opt-in**: absent from your configuration, it adds neither interface nor weight (the code AND its CSS are tree-shaken).

    ```ts
    GeoLeaf.ProfileSwitcher.list(); // available profiles (collected at deploy time)
    GeoLeaf.ProfileSwitcher.switchTo("france-rail"); // persists + reloads

    GeoLeaf.LanguageSwitcher.list(); // available languages
    GeoLeaf.LanguageSwitcher.switchTo("en"); // persists + reloads with ?lang=

    GeoLeaf.ThemePalette.list(); // available palettes
    GeoLeaf.ThemePalette.set("green"); // applies LIVE, without a reload
    ```

    - `profile-switcher` — dataset selector at the top of the layer manager. The list comes from `data.availableProfiles`, **generated at deploy time** from the `profile.json` files (a browser cannot enumerate a server directory). Shown only from 2 profiles upwards.
    - `language-switcher` — language button in the tab strip. No translation added: the 6 dictionaries are already in the core. `display: "code"` replaces flags with `FR`/`EN` on platforms that do not draw them.
    - `theme-palette` — accent colour (orange / green / blue), carried by `data-gl-palette` on `<html>`. Orthogonal to light/dark mode and to map themes. The configured `default` applies even when the selector stays hidden.

- **`profile.json` accepts `displayLabel` and `icon`** (both optional) — short label and icon of the profile selector. The existing `label` is unchanged.

- **Extension contracts are now public.** Six `types`-only subpaths expose the interfaces a plugin must implement, and the same symbols are re-exported from the main entry point:

    ```ts
    import type { ICoreModule, IMapAdapter, GeoLeafEventMap } from "@geoleaf/core";
    // or, in long form:
    import type { ICoreModule } from "@geoleaf/core/contracts/core-module.contract.js";
    ```

    Published subpaths: `core-module.contract.js` (`ICoreModule`, `ILifecycleModule`, `IUISlotModule`, `IModuleRegistry`, `IModuleUISlot`), `capability.contract.js` (`ICapabilityDeclaration`, `ICapabilityRegistry`, `ICapabilitySchema`, …), `config.contract.js` (`IGeoLeafConfig`), `map-adapter.contract.js` (`IMapAdapter` plus the geometry types), `layer-data.contract.js` (`LayerDataApi`, `LayerFeatureState`), `event-bus.contract.js` (`GeoLeafEventMap`, `GeoLeafRawEventMap`, `IEventBus`). These modules are **type-only**: they declare only a `types` condition and emit no JavaScript — `import type` works, a value import is refused outright. `PluginMetadata` (the metadata of `GeoLeaf.plugins.register`) is also re-exported from the entry point.

    Until now these types were reachable through **no channel at all**: a plugin implementing `ICoreModule` had to redeclare it.

- **`CapabilityRegistry`** — exported from `@geoleaf/core` and `@geoleaf/core/kernel`. The capability registry (`register`, `isEnabled`, `isLoaded`, `ensureLoaded`, `getSchema`, `getAllSchemas`) was complete but reachable from no ESM entry point: declaring a capability was only possible through `GeoLeaf.plugins.registerCapability(decl)`, untyped, since `ICapabilityDeclaration` was not exposed either.

- **`geoleaf:toolbar:action` is typed** — `GeoLeaf.Events.on("geoleaf:toolbar:action", …)` now gives `detail: { action: string; element: HTMLElement }`. This is the extension point through which a plugin reacts to a click on its toolbar button; until now it required a raw `document.addEventListener` with a hand-written cast.

    The event lives in a **second map**, `GeoLeafRawEventMap`, not in `GeoLeafEventMap`. The distinction is functional: the internal bus clones its payloads through JSON, which would destroy the `element` reference. `Events.on` / `off` / `once` accept keys from both maps; emission remains reserved for serialisable events.

- **`GeoLeafHost` (`@geoleaf/host-runtime`) describes six more members** — `GeoJSON`, `Utils`, `Log`, `Sync`, `Notifications`, `Layers`. Until now they fell into the `[key: string]: unknown` tail, so `GeoLeaf.GeoJSON.getLayerById(id)` returned `unknown`. An **additive** change, no break.

- **`GeoLeaf.Print.registerSlot(slot)`** (`@geoleaf-plugins/print`) — extension point for adding content to the composed canvas (cartouche, extra fields) at one of the `title` / `legend` / `footer` / `overlay-tl|tr|bl|br` placements. Re-registering the same `id` replaces the previous slot. The function and its `ComposeSlot` type already existed and the specification documented them as callable that way, but they were **not mounted on the facade**: `GeoLeaf.Print.registerSlot` was `undefined` at runtime, so no custom slot could be drawn. An **additive** change, no break.
- **`GeoLeaf.Permalink.stopSync()`** — new public method that stops the URL synchronisation started by `startSync()` and detaches every listener it had attached (map `moveend` plus three `document` listeners). Useful for SPA hosts that recreate the map. `startSync()` has also become **idempotent**: a second call tears down the previous session instead of stacking listeners.
- **`GeoLeaf.Notifications.show(message, typeOrOptions?, duration?)`** — the method was missing from the facade while the rendering engine, the historical `GeoLeaf.UI.showNotification` surface and the plugin documentation all named it. Calling it reached `undefined` and **failed silently** (the `?.show?.()` guard swallowed the error, no toast appeared). It is an alias of `notify()`.

### Removed

- **BREAKING — the `GeoLeaf.Filters` (plural) namespace is removed, on both channels.** The named export `import { Filters } from "@geoleaf/core"` and the `GeoLeaf.Filters` global disappear together, along with their single method `filterRouteList(baseRoutes, filterState)`.

    **Why.** Its size did not condemn it, its **name** did: one letter separated it from `GeoLeaf.Filter` (singular), a **different** 8-member object that drives the filter panel and carries the permalink serialisation contract. The asymmetry made the trap all the surer — the typed one (`Filter`) was **not** on the root ESM entry, the untyped one (`Filters`) was. And `filterRouteList` had **no caller**: not in the core, not in the 13 plugins, not in the application, not in the profiles, not in the examples — nowhere outside its own definition.

    **Migration.** There is no direct replacement, and none is needed:
    - to filter the map, use the **`GeoLeaf.Filter`** capability (singular) — `getActiveFilter()`, `applyFilter(state)`, `reset()` — **unchanged**;
    - to filter an array in your own code, use `Array.prototype.filter`. That is all `filterRouteList` did.

    Gone with it, for lack of a reachable reader: the `route-filter` engine (~320 lines) and the contribution seam through which the `route` capability injected it. The `route` capability itself — decorating route start and end points, driven by `modules.route.*` — is **unchanged**.

- **The catch-all `@geoleaf/core/dist/*` subpath is removed.** It made any file under `dist/` importable — internal chunks and implementation declarations included — which bypassed the whole set of subpaths defined next to it. **If you were loading the stylesheet through `@geoleaf/core/dist/geoleaf-main.min.css`, use `@geoleaf/core/style.css`**: that subpath already exists, designates exactly the same file, and is the one the documentation now uses. No other path under `dist/` was documented.

### Changed

- **BREAKING — two `@geoleaf/core/capabilities/*` subpaths change name.** They remain published, under a name that describes what they do:

    | Before                                                      | After                                                    |
    | ----------------------------------------------------------- | -------------------------------------------------------- |
    | `@geoleaf/core/capabilities/permalink/permalink-manager.js` | `@geoleaf/core/capabilities/permalink/permalink-sync.js` |
    | `@geoleaf/core/capabilities/offline/core-config.js`         | `@geoleaf/core/capabilities/offline/config-seam.js`      |

    **Why.** `permalink-manager` exported no `PermalinkManager` object — only four free functions for capturing and synchronising the URL; `permalink-sync` names them. `core-config` was one of **three** files with that name exporting three different functions, to the point that its own header had to warn "Not to be confused with `capabilities/feature-info/utils/core-config.ts`" — a note that patches an ambiguous name is the symptom of the defect, not its cure. `config-seam` joins the `*-seam.ts` family of guarded runtime accessors.

    **Who is affected.** Nobody, except a deep import that names these two paths explicitly. They appear in no README or example, and are re-exported by no main entry point. No other rename in this batch touches the published surface: the six `<cap>-types.js` files renamed to `types.js` are **type-only** modules whose `.js` was never emitted (their types remain resolvable under the new name).

- **BREAKING — the `@geoleaf-plugins/storage` plugin becomes `@geoleaf-plugins/offline-ui`.** The npm package, the bundle (`geoleaf-storage.plugin.js` → `geoleaf-offline-ui.plugin.js`) and the runtime plugin id (`"storage"` → `"offline-ui"`) change together.

    **Why.** The package no longer contained any storage. The offline engine — IndexedDB, cache, download, synchronisation — has been moved into the core (`capabilities/offline`) and the plugin only ships the interface: cache button, layer selector, synchronisation panel. Its own header already said so ("Entry point (offline UI) […] the offline engine is in-core"), and "storage" designated **three** things at once in the codebase: this plugin, the `GeoLeaf.Storage` facade and the engine. `offline-ui` pairs with `capabilities/offline` and makes the name true.

    **Migration.**
    - `npm install @geoleaf-plugins/offline-ui` (and uninstall the old one); `import "@geoleaf-plugins/offline-ui"`;
    - `<script>` tag: `dist/geoleaf-offline-ui.plugin.js`;
    - `GeoLeaf.plugins.isLoaded("storage")` → `isLoaded("offline-ui")`, and likewise for the value returned by `getLoadedPlugins()`;
    - if you target the button in the DOM or in tests: the attribute goes from `data-gl-toolbar-action="storage"` to `data-gl-toolbar-action="offline-ui"`.

    **What does NOT change** — deliberately:
    - the **`GeoLeaf.Storage` facade is unchanged**: it belongs to the core, not to the plugin, and remains the entry point for offline support;
    - the **i18n keys keep their `storage.*` prefix**. That is a namespace distinct from the package identity, and above all a **profile override** surface: renaming it would break custom translations without clarifying anything;
    - the profile configuration is unchanged — it already goes through `modules.offline.*` and `config/plugins/offline.json`.

- **The interface language is remembered.** Resolution order: `?lang=` → `localStorage['gl-lang']` → `ui.language` → `fr`. The URL parameter stays **first**, so that a shared link shows the same language to its recipient as to its author.
- **The active profile is remembered** (`localStorage['gl-profile']`). `sessionStorage['gl-selected-profile']` keeps its priority and its one-shot behaviour: the existing contract is not broken.

- **`ICoreModule` becomes a union** — `ILifecycleModule | IUISlotModule`. The type declared `dependencies`, `init` and `destroy` as mandatory, whereas `GeoLeaf.registry.register()` has always accepted **two** shapes: a full lifecycle module, **or** a plain `{ id, ui }` interface slot (what every plugin does when it adds a toolbar button without shipping start-up code). The contract described the first and rejected the second — published as such, it would have refused the eight real registration points in this repository.

    If you wrote `class MyModule implements ICoreModule`, write `implements ILifecycleModule`: TypeScript does not accept an `implements` clause on a union type. The name `ICoreModule` remains the one used by the `register()` parameter and has not changed role. **No runtime behaviour change** — it is the type joining the runtime, not the other way round.

- **`exports` now enumerates the `./facades/*` and `./presets/*` subpaths instead of announcing them through a glob.** A glob promised everything `dist/types/` contained, including modules that were never emitted (see _Fixed_). The field now lists the **15 facades actually shipped** — `branding`, `cluster`, `coordinates`, `featureinfo`, `filter`, `geolocation`, `labels`, `layers`, `legend`, `permalink`, `scale`, `share`, `sync`, `taxonomy`, `theme-toggle` — and the 2 executable presets. `@geoleaf/core/presets/preset.contract.js` now declares only a `types` condition: it is a type-only module, `import type` works, a value import is now refused outright instead of resolving into the void.
- **The PWA install banners (Android and iOS) now display the configured application name** — `modules.pwa.short_name`, otherwise `modules.pwa.name` (falling back to "GeoLeaf") — instead of a hard-coded "GeoLeaf", and **all their labels are translated** (fr/en/es/pt/it/de) through the core i18n dictionary. A profile that defines neither `short_name` nor `name` sees unchanged text.
- **`Notifications.notify()` / `show()` / `success()` / `error()` / `warning()` / `info()` now return the toast element** (`HTMLElement | null | undefined`) instead of `void`. That is what `Notifications.dismiss(toast)` has always expected: without a return value there was no way to obtain the reference, and the documented example was inapplicable. A type widening — **no existing call is broken**.

### Fixed

- **BREAKING — `GeoLeaf.BaseLayers` was `undefined` in production.** The backwards-compatible alias of `GeoLeaf.Baselayers` was correctly mounted, then **overwritten with `undefined`** a few statements later. `GeoLeaf.BaseLayers === GeoLeaf.Baselayers` now returns `true`.

    **Why it happened.** The alias was written `get BaseLayers() { return this.Baselayers; }` **inside the literal of an `Object.assign`**. `Object.assign` reads the own properties of the source, so it **invokes** the getter — with `this` bound to the literal, which does not declare `Baselayers`. It wrote `undefined`, over the correct value set just before by the other half of the namespace assembly.

    **Why nobody had seen it.** The module carrying that getter was believed to be **eliminated by tree-shaking** — a comment had claimed so for several versions. It is not: it is present in the shipped bundle, and it runs **last**. And no internal check could detect it: they compare member **names**, and the `BaseLayers` key did exist — with `undefined` as its value.

    This fix is marked _breaking_ out of caution: if your code tests `GeoLeaf.BaseLayers` to decide on a fallback to `GeoLeaf.Baselayers`, that fallback will no longer trigger. This is the behaviour expected all along; the value was the wrong part.

- **`GeoLeaf.getMetrics()` threw as soon as it was detached from the namespace.** `const { getMetrics } = GeoLeaf; getMetrics();` produced `TypeError: Cannot read properties of undefined (reading 'getHealth')`, because the shipped method was written `this.getHealth()`. It no longer depends on `this`: destructuring, passing it as a callback and `map(GeoLeaf.getMetrics)` all work. `GeoLeaf.getHealth()` was and remains correct.

- **The `GeoLeaf` namespace is typed at 81% instead of 31%.** Forty-four public keys fell into the `[key: string]: unknown` tail of the ambient declaration: in TypeScript, `GeoLeaf.init({...})` returned `unknown` and was not checked. The eleven capability facades (`Branding`, `Cluster`, `Coordinates`, `FeatureInfo`, `Labels`, `NotificationSystem`, `PWA`, `Permalink`, `Scale`, `Share`, `ThemeToggle`), the twelve kernel facades (`API`, `BaseLayers`/`Baselayers`, `CONSTANTS`, `Errors`, `Events`/`events`, `Helpers`, `LayerManager`, `ThemeCache`, `Validators`, `version`) and the twenty-one top-level methods (`init`, `boot`, `setTheme`, `loadConfig`, `createMap`, `getMap`, `getAllMaps`, `getModule`, `hasModule`, `getNamespace`, `getHealth`, `getMetrics`, `fetch`, `get`, `post`, `bootInfo`, `mark`, `measure`, `getPerformanceReport`, `establishBaseline`, `notify`) are now declared.

    The `[key: string]: unknown` tail stays in place: no existing access stops compiling. What changes is that accesses to the keys above are now **checked** — a call whose arguments were wrong and passed silently may now be reported by your compiler. That is the intended effect.

    Two clarifications about shapes the documentation presented differently:
    - **`GeoLeaf.init(options)` requires `map.target`** (or its `target` / `mapId` shorthand) and throws without it. The expected shape is `{ map: { target }, data: { activeProfile, profilesBasePath } }`.
    - **`GeoLeaf.init()` and `GeoLeaf.boot()` are not interchangeable**: `boot()` starts the profile-driven application, `init()` is the manual wrapper around `GeoLeaf.Core.init()`. The start-up path never calls `GeoLeaf.init()`.

- **`registry.getModuleSchema()` and `getActiveModules()` returned `dependencies: undefined`** for every interface slot registered after start-up — that is, for every plugin loaded on demand. Their own return type (`IModuleInfo.dependencies`) nevertheless announces a non-optional array. Both now read `dependencies ?? []`, as the registry's topological sort already does.
- **Thirteen `@geoleaf/core/facades/*` subpaths compiled and then failed at import.** The `exports` field announced `./facades/*` through a glob whose `types` branch resolved **28** files and whose `import` branch resolved only **15**: Rollup does not emit a module for a facade that is nothing but a re-export shell, and rightly so — it has no code. As a result, `import { Core } from "@geoleaf/core/facades/core.js"` **passed type-checking** then threw `ERR_MODULE_NOT_FOUND` at runtime. The affected ones were `api`, `baselayers`, `constants`, `core`, `events`, `filters`, `helpers`, `introspection`, `layer-manager`, `pwa`, `storage`, `ui`, `validators`. The corresponding symbols remained — and remain — reachable from the main entry point: `import { Core, UI, Events } from "@geoleaf/core"`. `./facades/legend.js`, the only subpath the documentation cited, was never affected.
- **`@geoleaf-plugins/table` appeared in no start-up report.** The name `"table"` was still listed among the internal core modules excluded from `reportPlugins()`, a leftover from the time when Table was bundled. The plugin registered normally but stayed invisible in the boot console.
- **The plugins' TypeScript declarations were published but unreachable.** Eleven packages (`@geoleaf-plugins/cog`, `editor`, `file-import`, `flatgeobuf`, `geocoding`, `measure`, `print`, `realtime-layer`, `table`, `websocket` and `@geoleaf/connector`) did ship their `.d.ts` files in the npm tarball but declared **no `types` condition** in their `exports`: an `import "@geoleaf-plugins/table"` from a TypeScript project failed with **TS7016** ("Could not find a declaration file"), while the types were right there, next to it. The condition is now declared by all eleven. No API has changed — what changes is that your editor sees them.
- **`@geoleaf-plugins/addpoi` and `@geoleaf-plugins/storage` no longer ship the core's internal declarations.** These two packages compile core sources, which made their declarations come out at a wrong root: the `addpoi` tarball contained **514 `.d.ts` files (2.6 MB), 483 of which belonged to `@geoleaf/core`**, and its own entry point sat at a path no configuration could designate. These two packages now **expose no types at all** — they are consumed as side-effect bundles (`import "@geoleaf-plugins/storage"` mounts `GeoLeaf.Storage`), which is unchanged. Typing will return once their coupling to the core is untangled.
- **`@geoleaf-plugins/print` — the printed scale is at last the one that was locked.** The map re-rendered off-screen covers the whole usable page; it was **stretched** into the map area, which any band (title, legend, footer) shrinks. As soon as a title was entered — the nominal case — the map was squashed vertically: 1:25,000 printed as **1:26,331** with a title, as **1:30,240** with title, legend and description, while the scale bar kept announcing the requested denominator. The capture is now **cropped to the centre, pixel for pixel**; `computeBbox()` accounts for the bands, so annotations carried over from `@geoleaf-plugins/measure` and the payload of the server fallback are placed correctly. This fixes the preview modal as well as `exportImage()` / `exportPDF()`.
- **`Permalink.startSync()` no longer leaks listeners** on re-initialisation (map recreation / SPA): the session is idempotent and its listeners are released by `stopSync()` / the internal reset.
- **The Android and iOS install banners no longer leak** global listeners or pending timers between two initialisations.
- **A burst of error toasts no longer exceeds the `maxVisible` limit.** When several notifications were queued and processed in one go, each error "freed" a slot by targeting a toast **already being removed** — an operation with no effect, but counted as a success. Toasts stacked beyond the configured limit (observed: 4 displayed for `maxVisible: 2`). Eviction now targets only a toast that can really be removed.
- **The coloured edge of toasts is at last displayed.** The four types (`success`, `error`, `warning`, `info`) are meant to be distinguished by a coloured bar on the left: the base rule referenced a **non-existent** theme variable (`--gl-accent` instead of `--gl-color-accent`), which invalidated the declaration and cancelled the border style — the modifiers setting only a _colour_, no edge was rendered at all. **The toast focus ring** (`:focus-within`) was missing for the same reason, which also made it an accessibility defect.
- **In dark theme, the toast background follows the theme variables again.** A second rule, of identical specificity and declared later in the stylesheet, imposed a fixed grey and defeated the computed background and dark shadow that the file nevertheless defines explicitly.
- **The form image viewer (`@geoleaf/field-renderer`, AddPOI plugin) no longer disappears after 150 ms.** The core published a `.gl-lightbox { opacity: 0 }` rule inherited from an older viewer it no longer uses (its own is `.gl-poi-lightbox-*`), on a class that actually belongs to `field-renderer`. Since its opening animation has no `animation-fill-mode`, opacity fell back to that rule at the end of the animation: the image appeared, then faded out. The rule is removed.
- **When the filter panel opens, the bottom-left block (branding, scale) and the coordinate display shift again.** Both offset rules were overridden by a margin reset applied with `!important` on the shared container.
- **The `modules.permalink.fields` allow-list is at last honoured by compact URLs.** The permalink encodes state in base64 (`#gl=…`) when `mode: "compact"` is requested **or**, automatically, as soon as the verbose URL exceeds 200 characters — and that path ignored `fields` in both directions: when reading, a forged compact URL drove **every** facet (filter, theme, categories, tags, rating, layers), including those a profile had excluded; when writing, `buildUrl()` published the **whole** state although the verbose path had just filtered it. Both encodings now apply the same allow-list. No injection risk was involved (the values feed lookups over known lists), but `fields` did not keep its promise.
- **A view parameter that is present but empty no longer silently recentres the map on 0,0.** `#gl_lat=&gl_lng=2.35&gl_zoom=12` passed the presence check (the value is `""`, not absent), then `Number("")` was `0`: the map opened off the Gulf of Guinea instead of ignoring an invalid permalink. An empty or blank value is now treated as absent — the URL is rejected and the profile view applies. An explicit `gl_lat=0` obviously remains valid.
- **`gl_rating` is validated like the other numeric fields.** It was the only one not going through the shared validator: `#gl_rating=Infinity` (or a `1e400` slipped into a compact payload, which `JSON.parse` turns into `Infinity`) was accepted as the minimum rating. Non-finite and negative values are now rejected.
- **A permalink containing non-Latin text no longer breaks the URL.** The compact format (`#gl=…`) encoded to base64 through a routine that **fails on any character beyond Latin-1**: a filter in Japanese or Russian — or plain typographic ellipses — made the encoding fail. The failure was **silent**: URL synchronisation swallows the error, so the address simply stopped following the map, with no message. That path is moreover taken **automatically** as soon as the classic URL exceeds 200 characters, so without the profile requesting compact mode. Encoding now goes through UTF-8; **compact links already shared remain readable**, the old format being recognised and accepted on read.
- **A vector tile layer with a casing no longer leaves a residue on each rebuild.** On a basemap or theme change, the casing sub-layer was not removed — the clean-up list targeted an id the builder does not produce. Each rebuild therefore left the previous one behind, and the source was released while a layer still referenced it.
- **Offline download progress no longer exceeds 100%.** The emitted percentage was not clamped: a resource counted twice — a retry recorded both as a success and as a failure, an enumeration producing a duplicate — pushed the display beyond 100 (observed: 150% and 200%). The value is now clamped to `[0, 100]`.
- **The offline synchronisation queue empties again.** `GeoLeaf.Storage.DB` exposed neither `updateSyncQueueStatus()` nor `removeSyncQueueEntry()`, although the field collection plugins (AddPOI, Storage, Editor) call them to mark and then remove each replayed operation. Depending on the call site, the attempt threw a `TypeError` or did nothing at all — either way the queue was never purged, and already-synchronised operations stayed in it indefinitely. Both methods are now delegated to the synchronisation engine, like the four other queue operations that already were.
- **`maxRetries: 0` no longer fails a download without attempting it.** The obvious spelling of "do not retry" made the attempt loop **unreachable**: the operation was never called and the offline cache reported a failure with no cause. The field is renamed **`maxAttempts`** — it has always counted the **total** number of attempts, not the number of retries. `maxRetries` is still accepted as a deprecated, normalised alias, so no existing profile silently falls back to the default value.
- **The offline cache no longer grows indefinitely because of themes.** Entries cached without a profile — which is the case for every theme — were stored outside the eviction index: they were **neither counted in the budget nor ever deleted**. A cache made only of themes declared itself empty and evicted nothing, whatever the configured quota.

- **Offline download no longer reports dangerous-scheme URLs, it skips them.** Two fetch points (style resolution, extent computation) followed URLs coming from a remote style or TileJSON without any check; an entry using `javascript:`, `data:`, `file:` or `blob:` was reachable there. They are now refused before any network call, and enumeration continues with the following entries instead of stopping.
- **Finishing an offline download no longer fails in a DOM-less context** (service worker, server rendering): emitting the progress event threw **after** every resource had been fetched, turning a successful operation into a failure.
- **Notifications no longer go mute after a map reset.** When the notification capability was destroyed and then recreated (SPA host, profile reload), the engine came back disabled: `notify()` and its variants threw nothing, displayed nothing, and **did not fall back to the console either** — the kernel still believed it had a renderer, so messages were **lost** rather than degraded. A reset now brings back an active engine, and messages emitted in the meantime are queued and then delivered.
- **Layer labels react to zoom again after a basemap or theme change.** When the map adapter was replaced **without** being destroyed first, the zoom subscription stayed attached to the old map: labels silently stopped recomputing until the page was reloaded.
- **Label buttons and the share button no longer survive the destruction of their capability.** They stayed in the DOM after a `destroy()`; clicking a label button still called the destroyed module.
- **Permalink id lists are capped in length, not only in count.** `gl_layers` / `gl_shown` / `gl_cats` / `gl_tags` already limited the number of items to 100, but a single item could weigh megabytes; each item is now truncated to 200 characters, like text fields.

- **The filter panel announced a label to screen readers that differed from the visible one.** When a profile does not define `modules.filter.title`, the region announced "Filter" while its visible title showed "Filtrer" — an accessible name that does not match the visible label (WCAG 2.5.3). Both now come from a single source.
- **The filter panel is at last translated.** Its title, its Apply/Reset buttons, its close button and its "no category" message were hard-coded French strings — while the corresponding translations already existed, complete, in the six dictionaries. An English- or German-speaking user saw French. Profile-defined labels still take precedence.
- **The details side panel and the layer manager speak the chosen language.** Two side panel translation keys were missing from the six dictionaries, and three layer manager keys were missing in Spanish, Portuguese, Italian and German: those elements fell back to French whatever the configured language.
- **Four shipped profiles at last display the search label their author wrote.** `france-risques-inondation`, `france-urbanisme-btp`, `guyane-biodiversite` and `tourism` set a specific prompt ("Rechercher une station…", "Rechercher un bâtiment, chantier…", "Rechercher un nom, une parcelle…", "Rechercher un POI…") in `modules.filter.searchPlaceholder` — the key nobody read — while leaving the generic "Rechercher..." in the one actually rendered. Those labels have been moved onto the search field concerned, where they also feed its accessible name.
- **The legend panel title is translated.** Its default was the **English** string "Legend", served as such to all six languages inside an otherwise French interface. It now comes from the dictionary and follows `ui.language`. A profile that sets `modules.legend.title` still takes precedence.
- **`GeoLeaf.Storage`: a sanitiser that does not sanitise can no longer write.** When a validator rejected a value and a `sanitize` function was supplied, the sanitised result was stored **without being revalidated** — so the validator became advisory as soon as a sanitiser existed. The result is now revalidated once, and refused if it is still invalid.
- **The `min`/`max` bounds of a validation schema are enforced.** They were ignored, without a message, if the field did not also declare `type: "number"`: a schema written `{ min: 5 }` checked nothing at all.
- **JSON serialisation no longer returns `undefined` where it promises a string.** For a value JSON cannot represent (`undefined`, a function, a symbol), `JSON.stringify` _returns_ `undefined` instead of throwing — so the fallback was never taken, and the caller received `undefined` from a function declared to return a string.
- **The legend's default values are at last announced by introspection.** `modules.legend` applied three defaults (`title`, `position`, `collapsedByDefault`) that its schema did not declare: a configuration tool could not display them. The default for `title` is the **English** string "Legend" while the rest of the interface is in French — the schema now states this explicitly instead of leaving it to be discovered in use.
- **Taxonomy configuration is at last visible to introspection.** `modules.taxonomy` declared **1 key out of the ~19 it consumes**: a configuration tool querying the schema saw neither the icons, nor the per-surface rendering options, nor the taxonomies themselves. The four sub-trees (`icons`, `render`, `taxonomies`, `layers`) are now declared with their real default values.
- **The runtime/build split of `modules.pwa` is documented in the schema.** `description`, `theme_color` and `background_color` are read only when generating `manifest.json` — never at runtime — whereas `name` and `short_name` are read on both sides. Nothing said so: each key now carries the corresponding note.

### Changed — BREAKING

- **`modules.filter.searchPlaceholder` is removed.** The key was declared, typed and written by profiles, but **no code ever read it**: the filter panel has no global search field, only a text-kind `fields[]` descriptor carries a placeholder (`fields[].placeholder`), which is indeed rendered. No visible change: a map already showed the per-field placeholder.

    **What this means for you**: nothing at runtime — a JSON profile that keeps the key sees it ignored, exactly as before. In TypeScript, a configuration typed `FilterConfig` that mentions it no longer compiles; the replacement is `fields[].placeholder` on the search field concerned.

- **`modules.permalink.fields` no longer accepts `"lat"`, `"lng"` or `"zoom"`.** These three values were **inert**: the view state is written unconditionally and required when parsing (a permalink without a view restores nothing), so removing them from the list changed nothing. Rather than let the type promise a granularity the runtime does not honour, the view is declared mandatory and taken out of the enumeration — `fields` now contains only what it actually governs: `layers`, `shownLayers`, `filter`, `categories`, `tags`, `rating`, `theme`.

    **What this means for you**: nothing at runtime — a JSON profile still listing `"lat"`/`"lng"`/`"zoom"` keeps working identically, those entries are simply ignored. In TypeScript, a configuration typed `PermalinkConfig` that mentions them no longer compiles: remove them. The view is always serialised, including with `"fields": []`.

### Removed

- **`GeoLeaf.UI.PanelBuilder` documentation removed.** That page described an API absent from the code: none of the documented functions (`createPlainSection`, `renderText`, `renderTable`…) exists any more, and the `.gl-poi-panel__*` CSS classes it presented were produced by nothing. The corresponding stylesheet is deleted along with it. Integrators composing their own detail panels should use `GeoLeaf.FeatureInfo`.

### Internal

- **Stylesheets trimmed by ~24%** (`geoleaf-main.min.css`: 127 → 97 kB). Three stylesheets of the `feature-info` capability were loaded twice — one being the exact concatenation of the other two — and roughly 850 lines of rules matched no element produced by the code. No appearance change expected; the documented public classes are unchanged.
- **`maxPersistent` is at last applied.** The field was accepted and documented (`@default 2`) but `init()` never read it: the constructor value applied whatever happened, and configuring it changed nothing on screen.

### Removed — BREAKING

- **The two plugin report methods are replaced by `GeoLeaf.plugins.reportPlugins()`.** They partitioned the registry into two categories. There is only one now: every plugin is MIT and published on npmjs.

    The split was moreover wrong. Each report relied on a hard-coded list of names that **overrode** the `type` field declared by the plugin, and the two lists contradicted it in opposite directions: `storage` and `editor` each appeared in the list opposite to the one they declared. As a result, those two plugins were shown by **both** reports, and every start-up counted them twice.

    **What this means for you**: replace both calls with `GeoLeaf.plugins.reportPlugins()`. There is now a single report, without duplicates. A plugin whose `healthCheck()` fails is flagged on its line but no longer triggers a `console.warn` — one of the two old reports did, the other did not, and the second behaviour is the one kept: `connector` is legitimately not connected at boot, and warning on every page load would be a false alarm.

- **The `type` field of the `plugins.register()` manifest is removed.** It served only the two reports above, and after their merge nothing read it any more. The Plugin Contract v1 (rule PC-03) no longer requires it.

    **What this means for you**: remove `type` from your `plugins.register()` call. Leaving it has no effect — unknown fields are ignored — but it will no longer be validated or read.

### Changed

- The start-up message now simply lists the loaded plugins (`<plugins>`, or `open source` if none). The old format split them into two groups based on a hard-coded prefix list (`storage`, `addpoi`) which **omitted `cog`** and ignored the `type` field: it mislabelled the plugins it knew and missed the one it did not.

- **The legend resolves the icon of a taxonomy category through the `svgId` field alone.** It aligns with the rest of the taxonomy capability (map icons, badge pills) and with the shared resolver, which have never read anything but `svgId`. The inherited `icon` / `iconId` fields of a category entry are no longer read **by the legend** (they still were, as a fallback). No shipped profile was affected — all 9 declare `svgId`. **What this means for you**: if a custom profile set `icon` or `iconId` in its `taxonomy.json` categories for the legend, rename them to `svgId` (already the documented form).

- **`modules.cluster.clusterRadius` and `modules.cluster.disableClusteringAtZoom` at last drive clustering of GeoJSON point layers.** These two keys were exposed by the introspection schema but **never applied**: the real radius of a GeoJSON layer stayed fixed at 80 px (max-zoom 14) whatever the value configured at profile level, the key being used internally only for a strategy comparison. Precedence is now **per-layer override → `modules.cluster.*` → default**. The schema is corrected accordingly: `clusterRadius` announces its real default `80` (introspection reported `50`, which matched nothing applied) and `disableClusteringAtZoom` declares its default `14`. **What this means for you**: if you were setting `modules.cluster.clusterRadius` / `disableClusteringAtZoom` expecting them to act, they now act — check the value you want. A profile that did not define them keeps exactly the current rendering (80 / 14). The shared POI cluster radius (50 px) is unchanged and stays independent of this key.

### Added

- **`GeoLeaf.Events` at last exists at runtime.** `index.d.ts` declared `GeoLeaf.Events` and the `EVENTS_API.md` page used it in 18 examples, but **nothing mounted that casing**: only `GeoLeaf.events` (lower-case) was set on the global. As a result, `GeoLeaf.Events.on(...)` **compiled** — the typings said so — then threw a `TypeError` at runtime.

    Both forms are now mounted and strictly equivalent (`GeoLeaf.Events === GeoLeaf.events`). `Events` is the canonical casing; **`events` remains a permanent alias and is not deprecated**, exactly like `Baselayers` / `BaseLayers`.

    **What this means for you**: nothing to do. If you followed the documentation, your code now works as written; if you worked around the problem by writing `events`, it keeps working identically.

- **`GeoLeaf.Utils.wktToGeoJSON()` at last exists.** It had been announced in the changelog since v2 and documented as a member of the namespace, but **was never set at runtime**: it lived only on an object assembled by a module that became unreachable when the UMD builds were dropped (v2.0.0). Calling it threw a `TypeError`. It is now really mounted.

- **`import { Utils }` and `window.GeoLeaf.Utils` at last expose the same thing.** The ESM export carried only 12 members where the global carried 27: the same name designated two objects of different shapes depending on how it was reached, and nothing stopped them drifting further. Both surfaces are now composed in the same place and locked by a test.

    They are still **two distinct objects** — the global must stay modifiable and re-applicable by the module lifecycle — but their members are identical.

    **What this means for you**: `import { Utils }` gives access to 16 members it did not carry (`DOMSecurity`, `FetchHelper`, `ObjectUtils`, `ScaleUtils`, `TimerManager`, `createElement`…). Nothing is removed.

- **`GeoLeaf.Utils` is at last typed.** Its public interface was declared `{ [key: string]: unknown }`: no completion, every member typed `unknown` (so `Utils.debounce(fn)` required a cast), and above all **no gap between documentation and runtime was detectable at compile time**. All 28 members are now declared.

- **`IMapAdapter` exposes `getMarkerHandle(id)`.** A new **optional** method of the adapter contract: it returns a typed handle (`GeoLeafMarkerHandle` — `getLngLat()` + `on(event, cb)`) on a marker created through `createMarker()`, or `null`. It exists for the two interactions that id-based management does not cover — reading a marker's position **after the user has dragged it**, and subscribing to its own events.

    **What this means for you**: nothing to do. The method is optional, so a custom adapter that does not implement it stays compliant. If you write an adapter for an engine with a per-marker event model, you can now expose it cleanly instead of forcing the caller around the contract.

### Fixed

- **A proximity filter without a radius no longer empties the list.** A proximity search enabled with a centre but **without a radius** rejected every route (the comparison used an `undefined` radius), instead of behaving like an absent criterion. A missing radius is now treated the way a missing centre already is: the criterion does not apply, and nothing is wrongly filtered out.

- **An empty tag selection no longer filters everything out.** On route lists, enabling the tag filter **without ticking any tag** emptied the result, whereas the general filtering engine treats an empty selection as "no constraint" and lets everything through. Both paths now answer identically — an empty selection excludes nothing.

- **A title written `variant: "title"` is at last honoured in the side panel.** A detail field declares itself a title in two ways, `variant: "title"` or `style: "title"`, and the schema accepts both everywhere. The popup treated them equally; the side panel recognised only `style`. A field authored with `variant` therefore lost its required-field status there — it **disappeared** when its value was empty — as well as its category icon, while the same field displayed correctly in the popup. Both spellings are now equivalent on both surfaces. No rendering changes for existing profiles: the current authoring convention did not hit the defect.

- **Focus no longer escapes the image viewer with the keyboard.** The lightbox focus trap recognised only buttons: a viewer containing a link (photo credit, source link) let `Tab` leave the dialogue. Links, input fields, drop-down lists and text areas are now taken into account. Same correction on the share modal, which conversely included disabled elements — `Tab` could get focus stuck there on an element unable to receive it.

- **Labels no longer disappear for good after a basemap change.** When the map style is reloaded (basemap or theme change), removing a label layer can fail. On the zoom-triggered path, that error was not caught: it interrupted processing, and the layer was still considered "labels shown" — so it never rebuilt them again for the rest of the session.

- **The theme you choose at last survives a reload.** Boot re-applied the profile theme by writing it into `localStorage`, overwriting the preference it had just read from it: no chosen theme held. Precedence is now explicit — **stored user choice → profile `ui.theme` → `prefers-color-scheme`** — and boot never writes any more. Only an explicit action (the theme button, or `GeoLeaf.setTheme()`) persists.

- **The button of a layer hidden by zoom at last switches it off.** `toggleLayer()` decided from _physical_ visibility, which zoom can force to "invisible", whereas the button reflects the _logical_ state. On a layer you had enabled but which the current zoom hid, the click re-enabled it instead of switching it off.

- **Rapid basemap switching: no more stale result.** Switching from a WMTS basemap to a raster one while the WMTS request was still in flight let the stale result apply over the new basemap. The request is now cancelled and its result discarded.

- **Contrast of the basemap buttons on hover.** In light theme, the label dropped to a ratio of 1.10:1 on hover — that is, unreadable (WCAG AA requires 4.5:1). Corrected to 15.48:1. The dark theme was not affected.

- **The CSRF token degrades instead of crashing.** Its automatic refresh was unguarded: if the cryptographic source disappeared after start-up, the timer threw an error every ~55 minutes, in a queue where nothing could catch it.

### Changed

- **`style.shape` is restricted to `"circle"`.** The schema declared it as free text and the documentation announced `"square"` and `"triangle"` — **neither has ever been rendered**. Points are drawn by a MapLibre `circle` layer, which draws only circles. The key is moreover inert (no code reads it) and stays reserved. To differentiate categories, use `styleRules` or the taxonomy.

    **What this means for you**: a profile declaring `"shape": "square"` is now rejected by validation, instead of being accepted and then silently ignored.

- **Layer manager labels are translatable.** "Gestionnaire de layers" (Franglais) becomes "Gestionnaire de couches" and goes, like "Fond de carte" and "Couches GeoJSON", through overridable i18n keys.

### Removed

- **`GeoLeaf.ensureMap()`, `GeoLeaf.requireMap()`, `GeoLeaf.hasMap()` and `GeoLeaf.Utils.MapHelpers` are removed.** They were declared in no typings, documented nowhere, and had **no caller** in the whole monorepo (plugins, demos, e2e, profiles).

    They were above all **wrong**: their duck-typing required `setView`, a **Leaflet** method that does not exist in the MapLibre API. `GeoLeaf.ensureMap(myMapLibreMap)` therefore returned `null`. They did not validate "is this a map?" but "is this the GeoLeaf adapter?", without saying so.

    **The resolver to use is `GeoLeaf.Utils.ensureMap()`** — the documented one, exported in ESM and actually called. It has taken over the validation this pair carried, **minus the Leaflet requirement**.

- **Three documentation pages described APIs that did not exist.** They are corrected or removed. None was callable: copy-pasting their examples threw a `TypeError`.
    - `GeoLeaf.Helpers.createElement()` — **removed in v3** (no caller, and its options shape silently diverged from the canonical factory: it read `styles` where the other reads `style`, and made `innerHTML` win over `textContent`). The documentation still presented it. **Migration: `GeoLeaf.Utils.createElement(tag, props, ...children)`**, renaming `styles` → `style`.
    - `GeoLeaf.Utils.escapeHtml()` — **was never mounted at runtime** (same cause as `wktToGeoJSON` above). **Use `GeoLeaf.Security.escapeHtml()`**, which is mounted, tested and documented.
    - The `AbstractRenderer` page described a class **and a source file** deleted during the purge of Leaflet-era code. Page removed.

### Changed

- **`GeoLeaf.Utils.ensureMap()` now validates its argument.** It previously returned **as-is** any non-empty argument: `ensureMap("foo")` was `"foo"`, although its documentation promises "the MapLibre GL map instance" and the example goes on with `map.fitBounds(...)`. The failure therefore only appeared at the first method call, far from the cause.

    An argument that is not a map now gives `null`, like an absent map. The duck-typing covers `getCenter` / `getBounds` / `on` / `off` — present both on a GeoLeaf adapter and on a raw `maplibregl.Map`.

    **What this means for you**: nothing if you already tested the return value (`if (map) …`, the documented form). If you were routing something other than a map through this function, pass it directly.

- **Prototype pollution protection — single source.** The `__proto__` / `constructor` / `prototype` guards were copied into **four modules**, in four diverging forms, three of them silent. They are now all backed by a single canonical blocklist. Three writes reachable from the `modules` block of a profile (`mergeModulesBag`, `mergeModuleBags`, the `Files.modules` loader) were **not** guarded and now are; a module id equal to `__proto__` in a profile can no longer reparent the configuration bag. **No API change** — legitimate identifiers are unaffected.

### Fixed

- **`GeoLeaf.Filters.filterRouteList()` — the proximity radius was sometimes kilometres, sometimes metres.** The function resolved its distance through `GeoLeaf.Utils.getDistance ?? haversine`. Both satisfy the **same signature** `(lat1, lng1, lat2, lng2) => number`, but the first returns **kilometres** and the second **metres**: the radius was therefore interpreted with a factor of 1000 **depending on whether `GeoLeaf.Utils` had been loaded**. In a full bundle the kilometre branch won; the test suite, however, never set `GeoLeaf.Utils`, so it had always validated the metre branch — hence a defect that stayed invisible.

    **`proximity.radius` is now in metres, unconditionally**, consistent with the filter engine predicate and with the `radiusKm * 1000` conversion already done by the panel and the permalink serialiser. The unit is now **documented** in the typings (`FilterStateInput.proximity`), which it was nowhere.

    **What this means for you**: if you called `filterRouteList()` with an active proximity and compensated for the kilometre behaviour, divide your radius by 1000. The category, sub-category, tag, rating and search filters are unchanged, and the built-in panel's proximity filtering was not affected (it already went through the engine, correct all along).

- **Public typings — `GeoLeaf.Errors` described signatures that were not those of the code.** Six discrepancies, all corrected in `index.d.ts` without touching the runtime:
    - `createError()` was declared `(message, code?, context?)` whereas its **first argument is the error class**: `createError(Errors.ValidationError, "message")`. TypeScript code written from the typings passed a message where the runtime expects a constructor.
    - `safeErrorHandler()` was declared `(error, handler)` — the runtime expects **`(handler, error)`**.
    - `GeoLeafError.timestamp` was typed `number`; it is an **ISO-8601 string**.
    - The constructor was declared `(message, code?, context?)`; it is `(message, context?)` — a three-argument call compiled and filed the code into the context.
    - `code` was declared required although the base class never assigns it.
    - `normalizeError()` omitted its second parameter `defaultMessage`.

- **Public typings — `GeoLeaf.Helpers` declared four methods that do not exist.** `debounce`, `throttle`, `fetchWithTimeout` and `batchDomOperations` appeared in `HelpersAPI` but have **never** been present on the runtime object: calling them compiled and then threw `TypeError`. Same defect as `_UIComponents.clearElement()` / `createEmptyMessage()`, fixed in v3.0.0. Declarations removed.

    **Migration**: `debounce` and `throttle` do exist — on **`GeoLeaf.Utils`**, not on `Helpers`. `fetchWithTimeout` has no equivalent: use `Helpers.createAbortController(timeout)` with `fetch`. Nor does `batchDomOperations`: `Helpers.createFragment()` covers the case.

    Conversely, six **genuinely real** methods were missing from the typings and are now declared: `applyCssText`, `lazyLoadImage`, `lazyExecute`, `addEventListener`, `addEventListeners`, `delegateEvent`. No runtime change: `GeoLeaf.Helpers` exposes the same 23 members as before.

- **`GeoLeaf.Core.setTheme()` / `getTheme()` were out of sync with the theme engine.** Both methods kept their **own internal state**, never updated by the canonical engine (`GeoLeaf.UI`) — the one driven by the theme button, by `GeoLeaf.setTheme()` and by the boot sequence. Observable consequences:
    - `Core.getTheme()` returned `"light"` on a dark-themed page **from the very first frame**, and stayed wrong after any change made outside `Core.setTheme()`.
    - `Core.setTheme()` wrote only the `document.body` class: no `localStorage` persistence, no class on the `#geoleaf-map` container (wrong theme in full screen), no `aria-pressed` update on the theme button (**an accessibility defect**), no `geoleaf:ui-theme-changed` emission.

    Both methods now **delegate to the canonical engine** when `GeoLeaf.UI` is present, and fall back to the `body` class otherwise. `GeoLeaf.Core.setTheme()`, `GeoLeaf.setTheme()` and `GeoLeaf.UI.applyTheme()` are therefore **really interchangeable** — which the documentation already claimed without it being true.

    **No signature or surface change.** The only behaviour modified is the one that was wrong: `getTheme()` now returns the theme actually applied. The warning message for an invalid value becomes `[GeoLeaf.Core] setTheme() ignored an invalid theme: {value}`.

    The chosen theme still does not survive a reload, for a distinct and pre-existing reason: the boot sequence re-applies the initialisation theme, overwriting the stored value. `setTheme()` now does write `localStorage`, but boot comes after it. This point is tracked separately and is not changed by this version.

- **`GeoLeaf.Storage.OfflineDetector` — three defects.** (1) The abort timer of the connectivity ping was cancelled only on the nominal path: each failed ping left a 5 s timer alive, accumulating for as long as the network stayed down. (2) The initial state was read from `navigator.onLine` **at module import**, which threw in any environment without `navigator` (SSR, Node test without jsdom); the read now happens in `init()`, under a guard. (3) `init()` is now **idempotent**: a second call tears down the previous one instead of stacking a second set of `window` listeners.

### Removed

- **BREAKING — `GeoLeaf.Bus` and `GeoLeaf.Utils.createEventBus()` removed.** An in-memory pub/sub, mounted at boot and **never read**: no read in the library, the profiles, the integration tests or the plugins, and it was declared neither in `index.d.ts` nor in the ambient typings. It moreover shared the file name of the **real** core event bus, which produced two mistaken diagnoses in review.

    **Migration.** The real event system is unchanged and remains the only supported route: `GeoLeaf.Events.on(name, handler)` / `.off()` / `.once()` for listening (26 events documented in `EVENTS_API.md`). If you needed a generic application bus, the browser's `EventTarget` covers the case in three lines — this module added nothing beyond it.

- **BREAKING — `GeoLeaf.DOMSecurity.createElement()` removed.** Despite its namespace, this function sanitised nothing: it did not call `setSafeHTML`, did not handle `innerHTML`, and wrote unknown attributes through `element[key] = value` **without any guard**. Its name promised a protection it did not provide — all the more serious a trap since the plugin contract explicitly directs authors to `GeoLeaf.DOMSecurity.*` for sensitive DOM operations. It had no caller.

    **Migration.** Use `GeoLeaf.Utils.createElement(tag, props, ...children)`: it guards property writes and routes `innerHTML` through `DOMSecurity.setSafeHTML()`. The rest of `GeoLeaf.DOMSecurity` (`setSafeHTML`, `setTextContent`, `clearElement`, `clearElementFast`, `createSVGIcon`, `getIcon`, `SVG_ICONS`) is **unchanged** and remains the recommended route.

- **BREAKING — `GeoLeaf.Helpers.createElement()` removed.** No caller, and its options shape silently diverged from the canonical factory: it read `styles` where the other reads `style`, and made `innerHTML` win over `textContent` (the reverse precedence). Since both interfaces carried an index signature, no type check would have flagged a substitution.

    **Migration.** `GeoLeaf.Utils.createElement()` — take care to rename `styles` to `style` if you passed a style object. The rest of `GeoLeaf.Helpers` is unchanged.

### Security

- **Hardening — `data:` URLs are now validated against the same allow-list everywhere.** `GeoLeaf.Validators.validateUrl()` tested the `image/` **prefix**, accepting any sub-type (`data:image/bmp`, `data:image/x-anything-at-all`), where `GeoLeaf.Security.validateUrl()` applied an **exact** allow-list of six types (`png`, `jpeg`, `jpg`, `gif`, `svg+xml`, `webp`). The same URL therefore received opposite verdicts depending on the entry point. Both functions now share the allow-list **and** the same MIME type parser.

    **Observable effect.** `GeoLeaf.Validators.validateUrl("data:image/bmp;base64,…")` now returns `{ valid: false }` instead of `{ valid: true }`. The six allowed types are unchanged. Signatures, return shapes and error messages do not change.

    Fixed along the way: MIME type extraction returned `image/png;base64` instead of `image/png` (invisible against a prefix test, blocking against an exact allow-list).

### Fixed

- **`GeoLeaf.Validators.validateUrl()` returned an invented domain for relative URLs.** The function resolved against a hard-coded base (`http://dummy.com`), so `validateUrl("/api/data.json")` returned `{ valid: true, url: "http://dummy.com/api/data.json" }`. It now resolves against the current origin, like `GeoLeaf.Security.validateUrl()`.

- **Public typings — the `ValidatorsAPI` interface was unusable.** `index.d.ts` declared **all eight** methods (`validateUrl`, `validateCoordinates`, `validateEmail`, `validatePhone`, `validateZoom`, `validateRequiredFields`, `validateGeoJSON`, `validateColor`) with a `void` return type, while all of them return a `{ valid, error }` object. Any TypeScript code writing `if (GeoLeaf.Validators.validateUrl(u).valid)` failed to compile. The declared signatures now match the implementations, options included (`ValidatorOptions`, `ValidateUrlOptions`, `ValidateZoomOptions`, `ValidationOutcome` are exported).

- **BREAKING — `GeoLeaf._UIDomUtils` removed from the namespace.** This internal module (`_` prefix) exposed only two members, both **with no caller** in the library, the profiles or the integration tests — but both **documented with examples** in `GeoLeaf_UI_Components_README.md`, published on npm. It is that page, not the code, that made it a contract: the removal is therefore treated as a _breaking change_, just as `attachAccordionBehavior()` was in its time.

    **Migration.**
    - `GeoLeaf._UIDomUtils.resolveField(obj, path)` was only an **alias** of the canonical internal helper; it never had a public equivalent. An integrator using it to read a nested property can replace it with a dependency-free line:
      `const at = (o, p) => p.split(".").reduce((v, k) => (v == null ? undefined : v[k]), o);`
    - `GeoLeaf._UIDomUtils.getActiveProfileConfig()` already delegated to `GeoLeaf.Config.getActiveProfile()` — **call that one directly**, it is public and unchanged.

    `GeoLeaf.UI._getActiveProfileConfig()`, the legacy facade wrapping the second, is removed in the same move (same absence of caller, same migration path).

- **Documentation corrected — `GeoLeaf._UIComponents.clearElement()` and `createEmptyMessage()` never existed.** Both were described with a copy-pasteable example in `GeoLeaf_UI_Components_README.md` while neither is implemented: calling them threw a `TypeError`. Sections removed. (`GeoLeaf.Utils.DOMSecurity.clearElement()` does exist and is quite real — but that is another namespace.)

- **BREAKING — `GeoLeaf.LayerManager`: removal of `updateSections()`, `addSection()`, `toggleCollapse()` and `isCollapsed()`.** These four methods were documented but **absent from the typings** (`index.d.ts` never declared anything but `init()` and `refresh()`), and none had a caller — not in the library, not in the integration tests, not in the profiles. `toggleCollapse()` was moreover **broken after a `Core.destroy()`**: it dereferenced `_container`, reset to `null` on teardown.

    **Migration.** Collapsing the panel is still driven by its header button (no action required). Sections are declared in the JSON profile (`layerManagerConfig.sections`) — that is the nominal path, and it was already the only one used. Adding a section dynamically has no programmatic replacement: if you had a real use for it, open an issue and the method will be reintroduced **with typings and end-to-end coverage**.

    `GeoLeaf.LayerManager.init()` and `refresh()` are unchanged.

- **`GeoLeaf._LayerManagerShared` removed from the namespace.** An internal key (`_` prefix, outside the documented public API) exposing a state object **with no reader**: the layer manager's real state lives in the module itself. Its `reset()` therefore cleaned nothing, and the panel survived a `destroy → recreate` cycle. Fixed: teardown now acts on the real state.

### Fixed

- **The layer manager no longer survives a `Core.destroy()` → `Core.init()` cycle.** The map, the control and the accumulated sections persisted from one instance to the next, and a pending deferred refresh could fire on a detached DOM.

### Security

- **Feature URL validation now applies a protocol allow-list.** The `link`, `photo` and `url` properties of a GeoJSON feature were checked by a plain `new URL()` in a `try/catch` — and `new URL("javascript:alert(1)")` **succeeds**. As a result, a value using `javascript:`, `vbscript:`, `data:text/html` or `file://` was considered valid and **raised no warning**. It was the library's only URL check without an allow-list; it now delegates to the canonical security validator (`http:`, `https:`, `data:` images).

    **Exact scope**: this is a **validation warning**, not an injection flaw. Those values did not reach the DOM through this path — rendering (`renderLink` / `renderImage`) already validated the URL **at the sink** and displayed nothing for a disallowed protocol. The defect is that feature validation **kept quiet** about a malicious profile instead of reporting it.

    **What this means for you**: new console warnings if your data contains these protocols. Relative paths (`/img/a.png`, `./a.png`, `../a.png`), protocol-relative URLs (`//host/a.png`), `data:` images and contact schemes (`mailto:`, `tel:`) are still accepted identically. Three cases now warn where they passed before: `ftp://`, `blob:` and `data:image/*` outside the MIME allow-list. All stay at `warning` severity — **no feature is invalidated**, nothing renders differently.

- **Prototype pollution hardening of the configuration write path.** `Config.Storage.setValueByPath()` now refuses any path segment named `__proto__`, `constructor` or `prototype` — **including the last segment** (a single-segment path bypassed the guard). The same check is applied to `GeoLeaf.Utils.setNestedValue()`, which had none. The other config writers (`set`, `merge`, `deepMerge`) were already protected.

    **Concrete impact**: a profile `mapping.json` whose `mapping` key targeted a prototype could graft an **inherited** property onto every normalised POI, which then propagated to feature properties, popups and table columns. **Global pollution of `Object.prototype` was not reachable** — the scope was limited to the POI objects being built. No shipped profile was affected.

    **Not breaking** for legitimate configurations: only paths targeting a prototype are refused, and the write becomes a no-op with a warning. If you used `GeoLeaf.Utils.setNestedValue()` with such paths, the call no longer modifies the object.

    Security documentation (`docs/SECURITY.md`, `docs/security/SECURITY_CONTRACT.md`) rewritten and checked against the code: it attributed several vectors to a non-existent function.

### Fixed

- **Two French `aria-label` values contained leftover Franglais** ("Afficher / hide la layer" and "Afficher/hide les étiquettes"). Corrected to idiomatic French ("Afficher / masquer la couche" and "Afficher/masquer les étiquettes"). Only the default French dictionary was affected — the five other locales were already correct, and both the i18n keys (`aria.layer.toggle`, `aria.labels.toggle`) and the `getLabel()` API are unchanged.

### Fixed

- **The AddPOI form showed NO category or sub-category field — on every profile.** The plugin looked for the taxonomy in a `taxonomy` key at the root of the active profile, which the profile loader has never produced: the read therefore always returned "nothing", the form builder concluded "this profile has no taxonomy" and added neither the category list nor the sub-category one. Silently: no error, no warning. The taxonomy is bound **to the layer** (`modules.taxonomy.layers.<id>.use`): the form now resolves it from the layer on which the POI is created or edited, and reloads it when you change layer in the selector.
- **A profile's icon sprite was NEVER cached for offline use — on every profile.** The resource enumerator looked for `spriteUrl` at the root of the profile, where it lived **before** the taxonomy v3 rework; since then it is declared in the capability's configuration file (`config/plugins/taxonomy.json`). The config file was downloaded — but not the SVG it points to, so icons were missing once offline. Resolution now goes through the `Files` manifest, as it does for layers, and the URL is requested **exactly** as the engine requests it online (a rewritten URL would have been stored under a key that is never looked up). A disabled `taxonomy` capability still downloads nothing.
- **A style without an `id` made its layer fail to load — the layer never appeared.** The schema stopped requiring `id` (the file name serves instead, the case for roughly 20% of style files), but the runtime validator still required it: the style was rejected, the loader threw, and the layer was never created. No message pointed at the real cause. **15 styles across 3 demonstration profiles** were in that state. The validator is aligned with the schema, and the loader now derives the `id` from the file name — the derivation the schema documented without anyone implementing it. An explicitly declared `id` still wins, and its format is still validated.
- **A `map.center` written `[lng, lat]` passed without a word.** `center` is `[lat, lng]`, like `bounds`. Three profiles had it inverted (`[-53, 4]` placed French Guiana in the Southern Ocean), with no visible effect as long as they also declared `bounds` — which the loader prefers. Corrected, and the profile loader now warns when a centre falls **outside its own bounds but falls inside once swapped**, or when its latitude leaves `[-90; 90]`. A simple range check was not enough: `-53` is a perfectly valid latitude.
- **A layer declaring a zoom threshold in `zoomConfig.minZoom`/`maxZoom` was invisible at ALL zoom levels.** The field was called `minZoom`/`maxZoom` but the engine read its content as a **scale denominator** (the `X` in `1:X`): a `minZoom: 6` was therefore understood as "scale 1:6", that is a zoom of about 27 — out of reach (MapLibre caps at 24). The layer never appeared; ticked manually in the layer manager, it appeared but then respected no threshold at all. **18 layers across 3 demonstration profiles** were affected. The field is renamed **`scaleConfig.minScale`/`maxScale`**, whose name states the unit, and the validator now rejects any value `<= 24` as well as the old `zoomConfig` block (see Breaking Changes below). _A profile whose thresholds were already denominators was not affected and keeps its values as they are._
- **`import { Config } from "@geoleaf/core"` shipped a `Config` WITHOUT `.get()`, `.set()`, `.getAll()`, `.loadUrl()` or `.getSection()`.** The `dist/esm/` build — the artefact `exports["."]` resolves, therefore **what every bundler consumer (Vite, webpack, Rollup) receives** — pruned the three modules that put these methods on the `Config` singleton. **The CDN bundle (`dist/geoleaf.esm.js`, `<script type="module">`, unpkg/jsdelivr) was never affected**: if you use it, there is nothing to do. If you import `@geoleaf/core` from a bundler, **update**: this is a fix, not an API change.
- **`package.json#sideEffects` protected nothing.** All its entries targeted `src/**/*.ts` — a directory `files` does not publish. For your bundler, **the whole package was declared side-effect free**, which allowed it to drop the modules that populate `window.GeoLeaf.*`. Rewritten against the published paths, and now **derived from the code** and checked at every build.

### Added

- **`GeoLeaf.Taxonomy.getLayerCategories(layerId): Record<string, TaxonomyCategory>`** — the categories bound to **one layer**, resolving `modules.taxonomy.layers.<id>.use` for you. Returns `{}` if the layer has no binding, if the binding names an unknown taxonomy, or if the capability is disabled (`enabled: false`).
    - Prefer it to `getCategories(ref)` **as soon as you start from a layer**: `getCategories` expects the **name** of a taxonomy, which only the `layers` table knows. Reading it yourself amounts to reimplementing binding resolution — which cost the AddPOI form its category lists, empty on every profile without a single message (fixed in this version, see _Fixed_).

- **`GeoLeaf.PWA.isInstallable(): boolean`** — to display **your own** install button instead of the built-in banner. It follows the same routing as the banner: on **iOS Safari**, `true` if the app runs on iOS without already being installed (iOS never emits `beforeinstallprompt`, it is the only available signal); on **Android/Chrome/Edge**, `true` once the browser has offered a deferred install prompt.
    - On Android, the answer means **"a prompt is available"**, not "this browser could install the app": the deferred prompt is only captured if `installPrompt.enabled` is `true`. Banner disabled ⇒ `false` even on an installable Chrome. iOS is not concerned.
    - _Note: the internal specification announced this method (as well as `prompt()`, `dismiss()` and `getInstallState()`) since v2.1.0, while none was exposed. Only `isInstallable()` had an implementation; it is now wired, the other three never existed and are removed from the internal documentation._

- **Stable `exports` subpaths**, to compose your own entry point and ship only what you list:

    | subpath                                      | contents                                                                 |
    | -------------------------------------------- | ------------------------------------------------------------------------ |
    | `@geoleaf/core/kernel`                       | the kernel facades (`Core`, `Config`, `UI`, `LayerManager`, `Events`, …) |
    | `@geoleaf/core/globals`                      | side effect: populates `window.GeoLeaf.*` **and** pulls the kernel sheet |
    | `@geoleaf/core/helpers`                      | side effect: wires `GeoLeaf._app`                                        |
    | `@geoleaf/core/boot`                         | `installBoot(manifest)`                                                  |
    | `@geoleaf/core/capabilities/<id>/install.js` | the installer of one capability (`LEGEND_INSTALLER`, …)                  |
    | `@geoleaf/core/facades/<name>.js`            | `Legend`, `Permalink`, `Share`                                           |
    | `@geoleaf/core/presets/manifest.full.js`     | the manifest of the 18 shipped capabilities                              |

    All typed. See **COOKBOOK.md, Recipe 8**.

- **The CSS follows the code.** Each capability imports its stylesheet from its `install.ts`: the CSS is a node of the module graph and **tree-shakes with the capability**. An entry point without `filter` ships neither its JS nor the CSS of its proximity bar (measured: **−19% CSS** on the 9-capability example).
- **Explicit cascade — `@layer gl.reset, gl.tokens, gl.kernel, gl.capabilities, gl.overrides`.** The order no longer depends on how your bundler concatenates. **`gl.overrides` is reserved for you**: a rule you place there wins without `!important` and without a specificity war.

### Changed

- **`GeoLeaf.registry.getAll()` and introspection list 6 kernel modules instead of 8** — `security` and `api` no longer appear. **Nothing is removed from the public API**: `GeoLeaf.Security`, `GeoLeaf.CSRFToken`, `GeoLeaf.DOMSecurity`, `GeoLeaf.API.*` and the other facades are unchanged, and are even available **earlier** (see below). Those two entries were only lifecycle wrappers around subsystems that have neither a map nor a configuration to wait for: their `init()`/`destroy()` were empty. You are only affected if you **enumerate** the registry's modules (diagnostics, tooling) — not if you call their facades.
- **The kernel facades are set at bundle import time, before `GeoLeaf.boot()`.** The surface available from import goes from 64 to 88 keys: `GeoLeaf.GeoJSON`, `GeoLeaf.ThemeCache`, the `_LayerManager*` / `_UI*` / `_Theme*` helpers, `_OfflineDetector`, `_StyleUtils`… **No key has disappeared.** Concretely, a plugin or script loaded before `boot()` can again call `GeoLeaf.I18n.registerDict()`, `GeoLeaf.notify()` or `GeoLeaf.Utils.*` at its own top level without the call being silently lost. This restores a behaviour that an internal rework (v2.x) had removed without documenting it — and whose loss was **mute**: the plugin still mounted, only its labels disappeared.
- **Switching raster basemap no longer recreates the source when only the tiles change.** The old switch destroyed the source and the layer to rebuild them identically; it now mutates the URLs in place (`setTiles`), which avoids flickering. The previous behaviour is still used as soon as anything else changes (tile size, attribution, zoom bounds): those properties are frozen at source creation and a mutation would silently lose them.
- **The coordinate display is written at most once per frame.** The cursor emits far more events than the screen displays frames: intermediate writes were invisible by construction. The displayed position remains the last known one — the reading does not freeze on a stale position.

### Added

- **A warning when a layer displays many points without clustering** (beyond 1000). A heavy profile degraded the browser without the slightest signal. The message names the layer, its number of points and the option to enable. It is **a warning only**: rendering is not modified, clustering is not forced — the decision is yours.

### Changed

- **A layer's scale window is now carried by the engine, and it is the law.** `scaleConfig.minScale`/`maxScale` are converted into MapLibre `minzoom`/`maxzoom` and set on every sub-layer: the layer appears and disappears **during** the zoom, instead of waiting for the end of the gesture. Two visible consequences:
    - **Ticking a layer outside its scale range no longer displays it.** Previously, a click in the layer manager overrode the threshold and the layer stayed visible at every zoom. That workaround is what hid the `zoomConfig` bug fixed above for three months. The behaviour is now that of a GIS: a layer has a range, and the range wins.
    - **Clustered** layers at last respect their range: cluster bubbles were the only sub-layers not receiving the bounds, and kept displaying outside the window.
    - Since the conversion depends on latitude (the same 1:X does not fall at the same zoom in French Guiana and in Norway), the bounds are recomputed when the map moves far enough in latitude. Zooming triggers no recomputation.

- **BREAKING — the "compose your own entry point" recipe has changed paths.** The ones the COOKBOOK displayed (`@geoleaf/core/src/…`) **never worked**: `src/` is not published. Use the subpaths in the table above.
- **BREAKING — `GeoLeaf._loadModule()` and `GeoLeaf._loadAllSecondaryModules()` are REMOVED, and nothing replaces them.** The whole lazy-loading machinery disappears (`src/lazy/`, the dispatcher, `_app._ensureModule`). **Migration: delete the call.** What these functions went to fetch is already in the bundle by the time your script runs — they answered a **build** question at runtime.
- **`@geoleaf/core/style.css` (→ `dist/geoleaf-main.min.css`): path, name and content unchanged.** The file is now produced by Rollup instead of `postcss-cli`, but it still contains the kernel **and** the 18 capabilities. **Nothing to change if you load it through `<link>`.**
    - **They no longer kept their promise anyway.** Every in-core capability anchors itself through its `install.ts` since v3: its code is in the eager closure. The chunks still served were therefore **re-export shells over code already present** — Rollup emitted them **empty** (`Generated empty chunks`), and the browser downloaded them all the same on every page load. Boot made an asynchronous round trip for nothing.
    - **The module name table in `COOKBOOK.md` was already wrong 7 times out of 9** (`poi`, `poiCore`, `poiExtras`, `legend`, `labels`, `themes`, `search` no longer existed): a call with any of those names already fell into a `console.warn("Unknown module")`.
    - **If what you wanted was a SMALLER bundle** (rather than a deferred one), that is now a build choice, and it is supported: compose your own entry point from the capability installers you need — the rest is **tree-shaken**, not deferred: **absent**. Full, tested recipe: `examples/minimal/entry.ts` (9 capabilities out of 18, **−15%** boot payload, measured at every build). See `COOKBOOK.md` — _Recipe 8: Shipping less than the whole library_.
    - A configuration flag (`modules.<id>.enabled`) **disables** a capability; it cannot remove its code from the file the browser has downloaded. Only the build choice can.
- **BREAKING — `taxonomy` v3: the capability now owns the POINT SYMBOL, and nothing else.** It owns the **icon**, its **colour**, the **badge disc** (fill / border) and the **colour of the category / sub-category pill badges** on the feature-info surfaces. The **geometry colour** (polygon fill, polyline stroke, **and business colour of points**) as well as the **point size** go back to each layer's `styleRules`.
    - **What disappears from the configuration**: `categories.<val>.colorFill`, `.colorStroke`, `.color`, `.colorRoute`. These keys were documented as driving `fill-color` / `line-color` per category — **they painted nothing**: the module that read them was never registered (its gate read a profile key loaded _after_ the gate was evaluated). **Migration**: express geometry colour in the layer's `styleRules` (`when.field` accepts any attribute, including `properties.categoryId`).
    - **`modules.taxonomy.enabled` becomes OPT-OUT** (default `true`) **and really gates everything**: `false` switches off map icons, the badge disc, the pills, legend icons and per-category filter options. Until now the key was opt-in **and disabled nothing** — setting it to `false` had no observable effect. A profile relying on that non-effect must now remove the key.
    - **Composition rule**: taxonomy **replaces the default value** of the point paint; the layer's `styleRules` keep priority. Cascade: `styleRules > sub-category > category > layer default`.
- **BREAKING — removal of `GeoLeaf.Helpers.StyleResolver`, `GeoLeaf.Helpers.getColorsFromLayerStyle()` and `GeoLeaf.Helpers.resolvePoiColors()`.** These three helpers resolved a POI colour from a layer's `styleRules`, but **hard-coded** the column names `properties.categoryId` / `properties.subCategoryId` and had **no caller** in the core. `styleRules` resolution is handled by the adapter's style converter, which accepts any field. No replacement API — these functions had no documented use.
- **BREAKING — removal of `GeoLeaf.UI.hasActiveFilters()`, `GeoLeaf.UI.getActiveFilters()` and `GeoLeaf.UI.resetAllFilters()`.** These three methods **already answered nothing useful**: they read an internal state (`_UIFilterStateManager`) whose only writer was conditioned on a profile key, `filters` at the root, that **no profile has ever declared** — not even the reference profile. In practice `hasActiveFilters()` therefore always returned `false`, `getActiveFilters()` always `[]`, and `resetAllFilters()` reset nothing. It is the last remnant of the pre-capability filter UI.
    - **Migration**: use the `filter` capability, which reads the real panel — `GeoLeaf.Filter.hasActiveFilters()`, `GeoLeaf.Filter.getActiveFilter()`, `GeoLeaf.Filter.reset()`. If your code called the `GeoLeaf.UI.*` versions, it already received a constant answer: the replacement fixes a behaviour, it does not reproduce it.
    - The corresponding configuration schema (`profile.filters`) no longer exists either: filters are declared under `modules.filter` (a profile's `config/plugins/filter.json` file).

### Added

- **Point symbol — `iconColor` + `marker`** _(non-breaking, opt-in)_: a category (or sub-category) now accepts **`iconColor`** (glyph tint; absent ⇒ white, the historical rendering) and **`marker`** — either `{ fill, stroke, strokeWidth }` for a disc under the icon, or `false` for a **bare icon** (no fill, no border). Absent ⇒ taxonomy overrides nothing and the layer style keeps control. **No radius**: point size belongs to the layer (the same category serves layers with different radii). Tinted icons are rasterised and registered as distinct MapLibre images — a profile that declares no colour keeps **byte-identical** symbol identifiers.
- **`modules.taxonomy.render.<surface>.colorBadges`** _(non-breaking, opt-in, default `false`)_: colours the category / sub-category pill badges of the surface (`popup` / `tooltip` / `sidepanel`) with the colours of the category `marker` — the pill and the symbol on the map read as one and the same object. New facade method **`GeoLeaf.Taxonomy.resolveBadgeStyle(layerId, feature, surface, field)`** (taxonomy decides, feature-info places the DOM).
- **`modules.taxonomy.icons.iconSize`** _(non-breaking, default `0.5`)_: MapLibre `icon-size` of the symbol sub-layer. The default is exactly the value hard-coded until now.
- **`GeoLeaf.Taxonomy.getIconVariants()` and `.resolveMarkerPaint(layerId, paint)`** _(non-breaking)_: consumed by the MapLibre adapter to register tinted icons and to compose the disc paint, respectively.

### Fixed

- **The pill badges were unreadable.** An unscoped CSS rule in the side panel stylesheet overrode the popup one and imposed near-white text **with no background at all**, on both surfaces. The coloured variants existed in the stylesheet but were **never emitted**, and their two colour sets were **swapped**. Pills now have a background, a verified contrast, and the `gl-poi-badge--category` / `--subcategory` classes.
- **The offline synchronisation badge disappeared when the theme changed.** The restyling path rebuilt the point paint without reapplying the synchronisation decoration. It is now reapplied, as it is at layer creation.
- **Sprite icons defined by alias (`<use href="#…">`)**: they showed in popups but stayed **invisible on the map** (the rasteriser did not follow the reference). The alias is now resolved.

- **`GeoLeaf.Taxonomy.getIcons()` + `modules.taxonomy.icons.showOnMap` key** _(non-breaking)_: the `GeoLeaf.Taxonomy` facade now exposes `getIcons()` (returns the `modules.taxonomy.icons` block — `spriteUrl` / `symbolPrefix` / `defaultIcon` / `showOnMap` — or `null`), the **single source** of the icon configuration read by the POI sprite injector and the legend (in-core successor of the former `GeoLeaf.Config.getIconsConfig()`, removed — see §Removed). New optional key **`modules.taxonomy.icons.showOnMap`** (boolean, default "on" when absent): the gate for displaying category icons in the legend (parity with the former legacy gate).
- **Category icon next to the title in popups / tooltips / side panels — `modules.taxonomy.render`** _(non-breaking, opt-in)_: new configuration block `modules.taxonomy.render.{popup,tooltip,sidepanel}.{showIconCategory,showIconSubcategory}` (6 boolean flags, defaults `false`) displaying the **POI icon next to the title** of the info surfaces (behaviour restored after the POI dissolution), symmetrically with `showIconsOnMap` (icons on the map). The icon appears when the taxonomy is enabled, the layer is bound (`modules.taxonomy.layers.<id>.use`), a flag of the surface is `true`, and an icon resolves — priority **sub-category → category → default icon**. New facade methods **`GeoLeaf.Taxonomy.resolveTitleIcon(layerId, feature, surface)`** and **`GeoLeaf.Taxonomy.ensureSprite()`** (the `taxonomy` capability resolves, the `feature-info` capability injects the sprite's `<use>` glyph, CSP-safe). Behaviour is **byte-identical** as long as no profile enables a flag.

- **Clustering — in-core capability `GeoLeaf.Cluster` + `modules.cluster`** _(internal reclassification, additive facade)_: point clustering (POI + GeoJSON point layers, native MapLibre `cluster:true`) is now a **declared built-in capability** (`cluster`), introspectable through `GeoLeaf.Introspection.getCapabilitySchema("cluster")`, active by default (**opt-out** through `modules.cluster.enabled: false`). New read-only facade **`GeoLeaf.Cluster`** (`isEnabled()`, `getConfig()`). Clustering is native end to end (no external `supercluster` dependency); rendering and behaviour are **unchanged**.

- **Geometry interaction events** _(non-breaking)_: two new DOM events **`geoleaf:feature:click`** and **`geoleaf:feature:hover`** (`{ layerId, featureId, properties, lngLat, point, zIndex }`) emitted by interactive GeoJSON and vector-tile layers on click or hover. These events replace the internal popup/tooltip binders and let an external capability (for example `@geoleaf-plugins/feature-info`) react to geometry interactions without coupling to the core. POI behaviour (cursor, popup, side panel) is **unchanged**; POI keeps emitting `geoleaf:poi:click` on its own channel.

- **Per-layer styling plumbing (for external capabilities)** _(non-breaking)_: new DOM event **`geoleaf:layer:added`** (`{ layerId, sourceId, geometryTypes }`), emitted once per layer as soon as its MapLibre sub-layers are created (GeoJSON layers **and** POI cluster groups). The MapLibre layer registry now exposes the **real geometry type** of a layer: `geometryTypes` field plus a `getGeometryTypes(layerId)` accessor — distinct from the sub-layers created (a polygon also creates a `line` sub-layer for its outline). These additions let an external capability apply per-layer styling without polling. First consumer: the MIT plugin **`@geoleaf-plugins/taxonomy`** — **geometry-agnostic** per-category styling (POI icon, polygon fill, polyline stroke) driven by a declarative `value → style` mapping (named reusable taxonomies, explicit `categoryField`). The core POI/GeoJSON rendering engine is **unchanged** (the legacy POI taxonomy stays in place; its migration is planned with the POI dissolution).

- **i18n seam `GeoLeaf.I18n.t(key, fallback?)`** _(non-breaking)_: the `GeoLeaf.I18n` namespace now exposes `t(key, fallback?)` in addition to `registerDict` / `getLabel`. It resolves `key` through the registered dictionaries (core + plugins) and falls back to `fallback` (or the key) when unresolved. This seam — promised by the field-renderer contract but never mounted — lets capabilities (feature-info) and plugins translate their labels (aria-labels…); output is **byte-identical** to the fallback when no dictionary provides the key.

- **Generic attribute filter — in-core capability `GeoLeaf.Filter` + `modules.filter`** _(rework)_: the filter panel becomes a generic **built-in capability**, **geometry-agnostic** (point/line/polygon) and multi-source, driven by a declarative field descriptor (`modules.filter.fields[]`, 6 kinds: `taxonomy` / `tag` / `range` / `text` / `boolean` / `proximity`), with **opt-in per-layer scope** (`layers`: absent ⟹ all layers, present ⟹ only those). New read-only facade **`GeoLeaf.Filter`** (`isEnabled()`, `getConfig()`), introspectable through `GeoLeaf.Introspection.getCapabilitySchema("filter")`, active by default (**opt-out** through `modules.filter.enabled: false`). The predicate is **hybrid**: native MapLibre `setFilter` (GPU, no re-tiling) for `taxonomy` / `boolean` / `range`, JS fallback for `tag` / `text` / `proximity` (list, substring, haversine distance). `taxonomy` and `tag` share a single engine (membership of a set of values on a field).

- **Toast renderer — in-core capability `toast-renderer` + `modules.toast-renderer`** _(internal reclassification, additive)_: the **DOM rendering of notifications** ("toasts") becomes a **built-in capability** (`capabilities/toast-renderer/`), active by default (**opt-out** through `modules.toast-renderer.enabled: false`). The **`notify()` primitive stays in the kernel** (`GeoLeaf.notify(message, level)` — a stable anchor mounted at boot, buffer plus `console.*` fallback); the capability is its pluggable renderer (through `registerRenderer()`) and re-mounts the rich surfaces (`GeoLeaf.UI.Notifications`, `_UINotifications`, ESM export `{ Notifications }`) — **public API and behaviour unchanged** by default. Without the capability (opt-out disabled), `GeoLeaf.notify()` **degrades cleanly** to `console.*`. Fix: the "default style not found" warning of a GeoJSON layer, silent until now (its internal reader `GeoLeaf.Notifications` was never mounted), is now emitted through the primitive.

### Changed

- **Offline — engine moved in-core (`modules.offline`, dynamic `import()`)** _(breaking — profiles + distribution)_: the offline engine (IndexedDB + cache + download + sync, ~9,000 lines) moves from `@geoleaf-plugins/storage` to **`@geoleaf/core` (`capabilities/offline/`)**, loaded through a **dynamic `import()`** (outside the boot budget — `bootGz` unchanged) on the **opt-in gate `modules.offline.enabled`** (which depends on `modules.pwa.enabled`). The configuration moves from **`modules.storage.*` → `modules.offline.*`** (`{ enabled, cache: { enableProfileCache, enableTileCache } }`). The residual plugin `@geoleaf-plugins/storage` is reduced to the **offline selection UI** (published on **npmjs, `access: public`**); it drives the core engine through the `StorageContract` seam (new **`whenReady(): Promise<void>`** — the UI defers its actions while the engine is not initialised, and indefinitely if `modules.offline` is disabled). The public **`GeoLeaf.Storage` facade is unchanged** (`init` / `isOffline` / `getStats` / `downloadProfileForOffline` / …). **Migration**: rename `config/plugins/storage.json` → `offline.json`, `Files.modules.storage` → `Files.modules.offline`, `modules.storage.cache.*` → `modules.offline.cache.*`. With `modules.offline.enabled` absent or `false` → **no engine chunk downloaded**.

- **Permalink — activation and configuration moved from `ui.permalink` to `modules.permalink`** _(breaking — profiles)_: state ↔ URL synchronisation (deep linking) becomes a **built-in capability** (`permalink`, **opt-out** — active unless `modules.permalink.enabled: false`), introspectable through `GeoLeaf.Introspection.getCapabilitySchema("permalink")`. The `ui.permalink` block (`config/core/ui.json`) moves to **`modules.permalink`** (`{ enabled, mode }`), on the `modules.share` / `modules.legend` model. The `GeoLeaf.Permalink` facade is **unchanged** (extended with `isEnabled` / `getConfig`). **Behaviour change**: opt-in → **opt-out** (permalink active by default; previously only `ui.permalink.enabled: true` enabled it). Internally, restoring the filter state now goes through the public `GeoLeaf.Filter` contract (no more DOM scraping or injection of fake hidden fields). The taxonomy is serialised into **a single flat `gl_cats` parameter** (the legacy `gl_subs` is removed — aligned with the generic filter model where categories and sub-categories form a single set of values). **Migration**: replace `"ui": { "permalink": { … } }` with `"modules": { "permalink": { … } }` (or omit it — opt-out).
- **`GeoLeaf.Filter` — new serialisation surface** _(non-breaking, additive)_: the facade exposes `getActiveFilter()` (serialisable active filter state), `applyFilter(state)` (restoration without DOM), `reset()`, `applyNow()`, `hasActiveFilters()` and `proximity.{setRadius,toggle}` — a contract consumed by the `permalink` capability and available for no-code use.
- **Share button — enabled through `modules.permalink.share.enabled`** _(breaking — profiles)_: the "Share this view" button (link modal + QR code) becomes a **sub-feature of the permalink capability** (share only makes sense with permalink, which encodes the shared URL). **Opt-out** gate `modules.permalink.share.enabled` (active unless `false`), introspectable through `GeoLeaf.Introspection.getCapabilitySchema("permalink")` (sub-key `share`). The former `ui.showShareButton` flag (`config/core/ui.json`) is removed. The `GeoLeaf.Share` facade (`openShareDialog` / `closeShareDialog` / `getShareUrl` / `isOpen` / `isEnabled` / `getConfig`), the `geoleaf:toolbar:action` event, the lazy QR code (`qrcode-generator`) and the rendering are **unchanged**. **Migration**: replace `"ui": { "showShareButton": false }` with `"modules": { "permalink": { "share": { "enabled": false } } }` (omitting it leaves the button active — opt-out). Internally, the code lives under `capabilities/permalink/share/`.
- **Taxonomy — unification: the core readers (legend, filter, POI icons) switched to the `GeoLeaf.Taxonomy` capability; legacy taxonomy removed** _(breaking — profiles + internal API)_: the legend, the `taxonomy` filter and POI icon injection now read their categories through the in-core capability **`GeoLeaf.Taxonomy`** (`modules.taxonomy` block), and no longer through the core's old "flat" taxonomy (`config/core/taxonomy.json` read via `GeoLeaf.Config.getCategories()`). **Activation by binding**: a POI layer receives its icons/categories only if it is declared in `modules.taxonomy.layers` (`{ "<layerId>": { "use": "poi-cat" } }`); a `taxonomy` filter must carry `taxonomyRef` (e.g. `"poi-cat"`). **Removed** (internal `_`/non-contractual API): `GeoLeaf.Config.getCategories()` / `getCategory()` / `getSubcategory()` / `loadTaxonomy()`, `GeoLeaf._ConfigTaxonomy`, and the `ConfigInitOptions.{mappingUrl, mappingHeaders, mappingStrictContentType}` options. **Unchanged**: the public `GeoLeaf.Taxonomy` facade, taxonomy resolution for modular profiles. _(Update: `GeoLeaf.Config.getIconsConfig()` and the `config/core/taxonomy.json` file are now removed as well — see §Removed "Legacy taxonomy".)_ **Migration**: populate `modules.taxonomy.taxonomies` (see `config/plugins/taxonomy.json`), bind POI layers through `modules.taxonomy.layers`, add `taxonomyRef` to `taxonomy` filters; replace any `GeoLeaf.Config.getCategories()` call with `GeoLeaf.Taxonomy.getCategories("poi-cat")`. Rendering is **byte-identical** (the model reuses the tree, labels and icons of the old one). Note: `modules.taxonomy.icons.defaultIcon` is NOT applied to POI icon injection (parity with the old engine, which injected no default icon). **Associated rendering fix**: the icons of POI layers loaded through a **data theme** change (without a basemap change) are now correctly registered in the MapLibre rendering engine when the layer is added — previously the sprite was only (re)registered on a basemap change, so a POI layer appearing through a theme could display without its icons.
- **Legend — activation and configuration moved from `ui.showLegend` + `legendConfig` to `modules.legend`** _(breaking — profiles)_: the map legend becomes a **built-in capability** (`legend`), gated through `CapabilityRegistry` (**opt-out**: active unless `modules.legend.enabled: false`), introspectable through `GeoLeaf.Introspection.getCapabilitySchema("legend")`. The `ui.showLegend` flag and the `legendConfig` block (`config/core/ui.json`) move to the dedicated **`modules.legend`** block (`config/plugins/legend.json` file: `{ enabled, title, position, collapsedByDefault }`), on the `modules.table` / `modules.theme-selector` model. **Behaviour change**: `title` / `position` / `collapsedByDefault`, previously **ignored** (overwritten by internal defaults), are now **effectively applied** to the control — a profile carrying the old `legendConfig` will see its legend rendered with its configured title, position and collapsed state (previously frozen at "Legend", bottom-left, expanded). New DOM event **`geoleaf:legend:ready`** (`{ position, layerCount }`) emitted once at the first mount of the control. The `GeoLeaf.Legend` facade is **unchanged**. **Migration**: create `config/plugins/legend.json` (carry over the `legendConfig` keys plus `enabled: true`), declare `"legend": "config/plugins/legend.json"` in `profile.json` → `Files.modules`, remove `ui.showLegend` and `legendConfig` from `ui.json`.
- **Theme selector — activation moved from `ui.showThemeSelector` to `modules.theme-selector.enabled`** _(breaking — profiles)_: the flag controlling the theme selection bar leaves `config/core/ui.json` (`ui.showThemeSelector`) for the dedicated **`modules.theme-selector`** block (`config/plugins/theme-selector.json` file, `{ "enabled": true }`), on the same model as `modules.table` / `modules.filter`. The selector becomes a **declared built-in capability** (`theme-selector`), gated through `CapabilityRegistry` (**opt-out**: active unless `modules.theme-selector.enabled: false`), introspectable through `GeoLeaf.Introspection.getCapabilitySchema("theme-selector")`. **Migration**: create `config/plugins/theme-selector.json` with `{ "enabled": true }`, declare `"theme-selector": "config/plugins/theme-selector.json"` in `profile.json` → `Files.modules`, remove `ui.showThemeSelector` from `ui.json`. The `GeoLeaf.ThemeSelector` facade, the events, the `gl_theme` permalink field and the rendering are **unchanged**. Internally, **layer loading is now decoupled from the theme system** (through the registry: `GeoJSONModule` loads the data, `ThemeEngineModule` applies the default theme) — data displays even without a declared theme or with the selector disabled; output is **byte-identical** when themes exist.
- **Clustering configuration moved from `poiConfig` to `modules.cluster`** _(breaking — profiles)_: the **global** clustering keys leave `poiConfig` for the dedicated **`modules.cluster`** block (`config/plugins/cluster.json` file) — `poiConfig.clustering` → `modules.cluster.clustering`, `poiConfig.clusterStrategy` → `…clusterStrategy`, `poiConfig.clusterRadius` → `…clusterRadius`, `poiConfig.disableClusteringAtZoom` → `…disableClusteringAtZoom`, `poiConfig.clusterStrategies` → `…clusterStrategies`. The **per-layer overrides** (`layers[].clustering.{enabled,maxClusterRadius,disableClusteringAtZoom}`) are **unchanged**. The features key **`clusteringConfig` (never read at runtime) is removed** (schema + profiles). **Migration**: move any `poiConfig.cluster*` block to `config/plugins/cluster.json`, declare `"cluster": "config/plugins/cluster.json"` in `profile.json` → `Files.modules`, remove `clusteringConfig`. Values are carried over identically (rendering unchanged); clustering is active by default without configuration. **Removed along the way** (internal `_`-prefixed, non-contractual): `GeoLeaf._GeoJSONClustering`, `GeoLeaf.GeoJSON._getClusteringStrategy`, `GeoLeaf.GeoJSON._getPoiConfig`.
- **`@geoleaf-plugins/feature-info` — public API `GeoLeaf.FeatureInfo` completed to 5 methods** _(breaking, plugin only — `@geoleaf/core` unaffected)_: `openSidePanel(detail, layout?)` and `getConfig(layerId)` added (`isEnabled`/`close`/`openPopup` already present). `close()` now closes the popup **and** the side panel. `openPopup(detail)` now requires `detail.geometry` (previously forced to `null` internally) — a scripted caller must supply that field (`null` accepted). The side panel is rewritten as standalone DOM (appended to `document.body`), without any dependency on `GeoLeaf.POI`. Action buttons (`type: "action"`) dispatch `geoleaf:popup:action` (an already documented event) with `properties` limited to the fields configured for the surface — never the raw set of feature properties.
- **`GeoLeaf.FeatureInfo.openPopup` now accepts a second `layout?: SidePanelLayout` parameter** _(non-breaking — optional parameter added)_, mirroring `openSidePanel`. It lets a caller without a `layers.<id>.capabilities.feature-info` configuration (for instance POI injection) supply an explicit layout rather than falling back on generic auto-resolution (all properties as plain text).
- **POI — popup and side panel fully delegated to `@geoleaf-plugins/feature-info`** _(breaking)_: POI attribute rendering (popup on marker click, "See more" side panel) **now requires the `@geoleaf-plugins/feature-info` plugin to be loaded and enabled** (`modules.feature-info.enabled: true`). There is no internal core fallback rendering any more — without the plugin, clicking a POI marker produces neither popup nor panel (the same convention as any absent optional plugin). **Migration**: make sure `@geoleaf-plugins/feature-info` is loaded (already required for GeoJSON/VT attribute rendering) and that `modules.feature-info.enabled` is `true` in the active profile.

- **Routes — reworked into the in-core capability `modules.route` (endpoint decorator); the `GeoLeaf.Route` facade and the `routes[]` model removed** _(breaking — profiles + API)_: the legacy Route module (imperative `GeoLeaf.Route` facade, top-level `routes[]` array) is **dissolved** into an **in-core capability** (`route`, gate `modules.route`, **opt-in**), introspectable through `GeoLeaf.Introspection.getCapabilitySchema("route")`. New model: the capability **decorates** an existing polyline layer with **start / end markers** derived automatically from each feature's geometry — the **track stays a generic GeoJSON `line` layer** (rendered by the engine). **Per-layer binding** `modules.route.layers.<id>.{start,end,showStart,showEnd}` (the `modules.taxonomy.layers` model). Event-driven (`geoleaf:layer:added` / `geoleaf:map:ready`). **Removed**: the `GeoLeaf.Route` facade (`init` / `loadFromConfig` / `loadGPX` / `loadGeoJSON` / `show` / `hide` / `filterVisibility`), the `routes[]` array, the `_RouteLayerManager` / `_RouteLoaders` / `_RouteStyleResolver` globals, the `RouteContract` contract, the `geoleaf:route:loaded` event, the lazy `route` chunk. **Reading GPX / KML / KMZ**: out of scope — use `@geoleaf-plugins/file-import`. **Migration**: (1) declare `"route": "config/plugins/route.json"` in `profile.json` → `Files.modules` plus `{ "enabled": true, "layers": { "<layerId>": { … } } }`; (2) a dynamic route goes through `GeoLeaf.Layers.setData(layerId, featureCollection)` (the capability re-derives the markers) instead of `GeoLeaf.Route.loadFromConfig`. Track interactivity (click / hover) is still provided by the generic `geoleaf:feature:click` / `hover` seam of GeoJSON layers (unchanged).
- **GeoJSON filtering applied on the GPU** _(non-breaking, performance improvement)_: `GeoLeaf.GeoJSON.filterFeatures(predicate)` keeps its signature (the predicate remains a JS function — substring search, distance, nested fields all stay supported), but now applies the visible set through `map.setFilter` on the features' `id` (a `match` expression, **without re-tiling** the source) for **non-clustered** layers whose features all carry a **unique** `properties.id`. Clustered layers, or layers whose features have no id, fall back to re-sending the data (the original behaviour, cluster counters preserved). Filtering by category or search in the panel is smoother on large datasets; **no API or filtering-result change**.
- **Basemap change: native layer preservation (`transformStyle`)** _(non-breaking in observable behaviour)_: switching a vector basemap now uses `map.setStyle(next, { diff: true, transformStyle })` (MapLibre v5) to **natively preserve** the GeoLeaf sources and layers (GeoJSON, POI clusters, sentinel) instead of destroying everything and re-injecting it in JS. The reset-and-full-rebuild dance is over: a gain in **correctness / leak avoidance** (less churn, less transient layer loss) when switching. POI sprite icons (cleared by `setStyle`) are re-registered after the swap. Rendering and switching behaviour are **unchanged**.
- **POI — hover / selection halo** _(new UX, non-breaking)_: hovering a (non-clustered) POI marker draws a **highlight border**; clicking a marker **selects** it (persistent halo until another marker is clicked). Driven by `setFeatureState` (reactive GPU paint), with no extra data and no configuration. The resting rendering (colours, status badge) is **unchanged**.
- **POI — synchronisation badge without source rebuild** _(non-breaking, performance improvement)_: the "pending" badge (`GeoLeaf.POI.updatePoiSyncStatus`, used by `@geoleaf-plugins/addpoi` and `@geoleaf-plugins/storage`) is now applied through `setFeatureState` (an O(1) mutation) instead of rebuilding the whole POI `FeatureCollection` on every status change. The POI source declares `promoteId: "id"` (a stable feature id). No API change and no visible rendering change. Per-POI style resolution no longer forces a style recomputation (`getComputedStyle`) per marker on mass display.

- **Legend — "attribute → category" mapping driven by configuration** _(non-breaking for the core; potentially breaking for a profile relying on the former built-in tourism mapping)_: legend icon resolution for a `when.field` rule on a raw attribute (for example OpenStreetMap `fclass`) now reads a declarative **`taxonomy.fieldMappings`** mapping (`{ <field>: { <value>: { categoryId, subCategoryId } } }`) instead of a tourism table hard-coded in the core. The MIT core no longer carries any business data. **Migration**: a profile whose legend depended on the built-in `fclass` mapping (archaeological / museum / camp_site / hotel) must now declare it under `taxonomy.fieldMappings` (the `tourism` demonstration profile includes it).
- **Labels (`GeoLeaf.Labels`) — in-core capability + `modules.labels` gate** _(breaking — configuration)_: layer labels (text, rendered as a native MapLibre `symbol` layer) are now a **declared built-in capability** (`labels`), introspectable through `GeoLeaf.Introspection.getCapabilitySchema("labels")`, active by default (**opt-out** through `modules.labels.enabled: false`). The global gate leaves the root key **`labels.enabled`** for **`modules.labels.enabled`** (the root `labels` key is now reserved for the i18n override dictionary). Per-layer label styling (font, colour, halo, scale) stays **unchanged** in the style files (`label.*` key). **Migration**: a profile setting `labels.enabled: false` at the root must move it to `modules.labels.enabled: false`. The `GeoLeaf.Labels` API, the rendering and the display button are **unchanged**.
- **Filter configuration migrated from `searchConfig` / `ui.showFilterPanel` to `modules.filter`** _(breaking — profiles)_: the filter/search panel leaves `ui.json > searchConfig` (plus the `ui.showFilterPanel` flag) for the dedicated **`modules.filter`** block (`config/plugins/filter.json` file, declared in `profile.json` → `Files.modules.filter`). Correspondences: `ui.showFilterPanel` → `modules.filter.enabled` (opt-out); `searchConfig.title` / `searchPlaceholder` / `actions` → `modules.filter.*`; `searchConfig.radius{Min,Max,Step,Default}` → a `kind:"proximity"` field; `filters[] type:"search"|"proximity"|"tree"|"multiselect-tags"` → `fields[] kind:"text"|"proximity"|"taxonomy"|"tag"`. The "categories" filter becomes **explicit** (`field` / `taxonomyRef` / `layers`) and is only migrated if the features carry the category identifiers. The internal **`GeoLeaf.FilterPanel` facade is removed** (replaced by `GeoLeaf.Filter`); the internal `_UIFilterPanel*` globals go from an **eager** mount to **lazy shims** mounted on `geoleaf:app:ready` (permalink / mobile / ui-api consumers unchanged). **Migration**: move the `searchConfig` block to `config/plugins/filter.json` in the `fields[]` model, declare `"filter": "config/plugins/filter.json"` in `Files.modules`, remove `searchConfig` and `ui.showFilterPanel`.
- **Filter — text search insensitive to accents and word order** _(non-breaking, improvement)_: the text field of the Filter panel (in-core `filter` capability, `kind:"text"`) now normalises accents and case (NFD plus diacritic removal) and splits the query into words — a field matches if **all** the terms appear in it, in any order. `recif` finds "Récif", `gilles récif` finds "Le Récif — Saint-Gilles". A **strict superset** of the previous behaviour (every existing match stays valid), with no dependency and no new parameter. It covers common search needs without an external full-text engine (see §Removed — `GeoLeaf.Search`).

### Fixed

- **OGC API Features refresh (`autoRefresh`)**: a layer configured with `autoRefresh` now updates when the map moves (`moveend`). The source update call targeted a non-existent adapter method (a silent no-op) and the fetch result was discarded; new features are now applied.
- **POI clickable after a server id is assigned**: after `GeoLeaf.POI.updatePoiId(oldId, newId)` (the `@geoleaf-plugins/addpoi` flow — temporary id → permanent id), clicking the marker finds the POI again. The click resolution index (invalidated on list length alone) is now invalidated on rename.
- **Legend — fallback colour aligned with the map**: a style rule without an explicit colour now shows the same grey (`#cccccc`) in the legend **and** on the map (previously Leaflet blue `#3388ff` in the legend, grey on the map).
- **Legend (LayerManager) — robust layer registration**: registering a layer in the LayerManager no longer depends on a geometry type detection inherited from Leaflet (the source of a latent crash); the type is derived from the cached `geometryType`.
- **Timer leaks**: the periodic polling of the mobile toolbar (a 2 s `setInterval`) is now cleaned up by the lifecycle (no more leak on recreation); the offline detector no longer starts a polling timer when no `pingUrl` is configured (the browser's `online`/`offline` events are enough).
- **Basemap change: no more double firing of interaction events**: after a basemap change (`map.setStyle`), re-injected layers no longer duplicate their delegated listeners. A click or hover on a feature (POI, GeoJSON, cluster, track) no longer emits `geoleaf:feature:click` / `geoleaf:feature:hover` / `geoleaf:poi:click` **twice** — the delegated listeners are now detached before the style is rebuilt (and when the map is destroyed). No API impact.
- **`GeoLeaf.Notifications.*` now mounted on the global**: the full notification namespace (`GeoLeaf.Notifications.{notify,success,error,warning,info,dismiss,clearAll,getStatus}`) — **documented** (`NOTIFICATIONS_API.md`) and **typed** (`index.d.ts` → `GeoLeafAPIRoot.Notifications: NotificationsAPI`, non-optional) — was in fact **never assigned** on `globalThis.GeoLeaf` (only `GeoLeaf.UI.Notifications` was). A `GeoLeaf.Notifications.success(...)` over CDN, as documented, crashed (`Cannot read properties of undefined`). The facade is now mounted at boot, aligning runtime, documentation and types. `GeoLeaf.notify()` (the shorthand) and the ESM export `import { Notifications }` are unchanged. This also fixes a `show({message,type})` example (wrong signature) in the `@geoleaf-plugins/websocket` README → `show(message, type)`.

### Removed

- **`GeoLeaf._UIDomUtils.attachAccordionBehavior()` and `GeoLeaf.UI._attachAccordionBehavior()` removed** _(breaking, internal `_` API with no consumer)_: both attached accordion behaviour (toggling `gl-is-open` on a click on a `.gl-accordion__header`) to a container. Neither had **any caller** in the product since the removal of the filter panel builder `ui/filter-panel/**`, their only client. Only the first was documented, with an example, in `GeoLeaf_UI_Components_README.md` — that section is gone. Despite its name, **`GeoLeaf.UI._attachAccordionBehavior()` was not an alias of the first**: it delegated to `_UIEventDelegation.attachAccordionEvents()`, which **stays in place**. **Migration**: none for the product's accordions — the legend builds its own (`GeoLeaf.Legend`) and the side panel uses a native `<details>`, without JavaScript. An integrator who called `GeoLeaf._UIDomUtils.attachAccordionBehavior(container)` on their own markup now attaches the listener themselves: `container.addEventListener("click", (e) => e.target.closest(".gl-accordion__header")?.closest(".gl-accordion")?.classList.toggle("gl-is-open"))`.
- **`_UIFilterPanel*` globals removed (`_UIFilterPanelApplier` / `_UIFilterPanelStateReader` / `_UIFilterPanelAccordion` / `_UIFilterPanelProximity`)** _(breaking, transitional internal `_` API)_: these runtime shims (installed by `capabilities/filter/compat.ts`) exposed the filter panel to permalink, to the mobile toolbar and to the desktop control builder. All their consumers are now wired to the public **`GeoLeaf.Filter`** contract; `compat.ts` and the four `_UIFilterPanel*` globals are **deleted**. **Migration**: `GeoLeaf._UIFilterPanelProximity.*` → `GeoLeaf.Filter.proximity.*`; `_UIFilterPanelApplier.applyFiltersNow(...)` → `GeoLeaf.Filter.applyNow()` / `.reset()`. _(The singular legacy global `_UIFilterPanel` — the older panel — is not concerned.)_
- **`GeoLeaf.Taxonomy.resolveLabel()` / `resolveLayerLabel()` removed** _(breaking, internal API with no consumer)_: these two taxonomy facade methods (readable label of a category value / of a layer badge field) had **no consumer** — they were intended for a `feature-info` badge rendering that was never wired. Removed from `GeoLeaf.Taxonomy` (they were needlessly shipped in the bundle). **Migration**: read the category directly through `GeoLeaf.Taxonomy.getCategories(ref)[value]?.label`.
- **`GeoLeaf.Helpers.resolvePoiColors()` — the `colorRoute` field removed from the `PoiColors` return** _(minor breaking, dead field)_: the function returned `{ colorFill, colorStroke, colorRoute }` where `colorRoute` was computed **identically to `colorStroke`** and **never read** (a leftover of the dissolved `route` module). The return is now `{ colorFill, colorStroke }`. **Migration**: use `colorStroke` (a strictly identical value).
- **Legacy taxonomy removed — `GeoLeaf.Config.getIconsConfig()` plus the `config/core/taxonomy.json` file** _(breaking — profiles + internal API)_: the core's old "flat" taxonomy is **entirely deleted**; the **`modules.taxonomy`** capability (`config/plugins/taxonomy.json` file) is now the **single source** of icons and categories. Removed: **`GeoLeaf.Config.getIconsConfig()`** (plus `ProfileManager.getIconsConfig`), the **`config/core/taxonomy.json`** file and its **`Files.taxonomyFile`** manifest entry (loaded at boot through `profile-loader`), the internal **`GeoLeafConfig.categories`** field (plus its `_validateCategoriesSection` validation and the `CategoryItem` interface), and the dead internal API **`GeoLeaf.UI._populateSelectOptionsFromTaxonomy`** (0 callers). The POI icon sprite and the legend's `showOnMap` gate now read **`modules.taxonomy.icons`** through `GeoLeaf.Taxonomy.getIcons()`. **Migration**: delete the `config/core/taxonomy.json` file and the `Files.taxonomyFile` key from `profile.json` — icons and categories already live in `config/plugins/taxonomy.json` (`modules.taxonomy.icons` + `modules.taxonomy.taxonomies`); replace any `GeoLeaf.Config.getIconsConfig()` call with `GeoLeaf.Taxonomy.getIcons()`. Rendering is **byte-identical** (same data, same sprite URL).
- **The `geoleaf:style:rebuild` DOM event removed** _(breaking)_: this event, emitted after a `map.setStyle()` so that modules could re-inject their layers, no longer has a purpose — the basemap switch now natively preserves GeoLeaf layers through `transformStyle` (see §Changed). The event is removed from the contract (`GeoLeafEventMap`) and its 3 internal listeners (GeoJSON, POI, taxonomy) are deleted, along with the associated rebuild functions (`_rebuildGeoJSONLayers`, `_rebuildPoiClusterSource`, the taxonomy sweep on rebuild). No distributed plugin listened to it. **Migration**: an integrator who listened to `geoleaf:style:rebuild` in order to restyle after a basemap change no longer needs it (layers and their paint survive); to react to a layer being added, use `geoleaf:layer:added`. The optional adapter method `resetForStyleChange()` is replaced by `buildStyleChangeTransform()` + `reregisterStyleImages()`.
- **`GeoLeaf._loadModule("poiRenderers")` / `"poiRenderers"` removed from `LazyModuleName`** _(breaking, lightly documented internal API)_: the lazy `poi-renderers` chunk (legacy POI attribute rendering — field/media/component renderers, section orchestrator, lightbox, UI behaviours) is deleted, not moved — that capability is now entirely provided by `@geoleaf-plugins/feature-info`. `GeoLeaf._loadModule("poi")` keeps working (it loads `poiCore` + `poiExtras`, without `poiRenderers`). A direct call to `GeoLeaf._loadModule("poiRenderers")` now fails silently (the `default` branch of the switch, `console.warn`).
- **GeoJSON popup/tooltip binders removed from the core** _(breaking)_: `bindMapLibrePopup`, `bindMapLibreTooltip`, `_GeoJSONPopupTooltip`, `setupPopupTooltipDeps` and the 4 source files (`popup-tooltip.ts`, `popup-tooltip-core.ts`, `popup-tooltip-layer.ts`, `popup-tooltip-maplibre.ts`) are no longer part of `@geoleaf/core`. Tooltip/popup/side-panel rendering on GeoJSON and vector-tile layers is now provided by the MIT plugin **`@geoleaf-plugins/feature-info`**. **Migration**: install `@geoleaf-plugins/feature-info` and load its script after `geoleaf.esm.js`. GeoJSON layers now emit `geoleaf:feature:click` / `geoleaf:feature:hover` instead. **POI impact**: POI popup behaviour is **unchanged** (a separate `geoleaf:poi:click` channel).

- **`GeoLeaf.Geocoding` removed from the core** _(breaking)_: address search (geocoding — Addok/BAN, Nominatim, Photon providers, custom HTTPS endpoint) is no longer built into `@geoleaf/core`. It is now provided by the **MIT plugin `@geoleaf-plugins/geocoding`** (public on npmjs.org). Removed from the core bundle: the named ESM export `Geocoding`, the `GeoLeaf.Geocoding` facade (`isEnabled` / `search` / `selectResult` / `open` / `destroy`), the `geoleaf:geocoding:result` event and the `.gl-geocoding-ctrl` search control. **Migration**: `npm install @geoleaf-plugins/geocoding`, then load its script **after** `geoleaf.esm.js` (and before `GeoLeaf.boot()`).
- **`GeoLeaf.Table` removed from the core** _(breaking)_: the data table (tabular panel — layer selector, sorting, selection ↔ map highlight, zoom, GeoJSON/CSV/KML/GPX/Excel export) is no longer built into `@geoleaf/core`. It is now provided by the **MIT plugin `@geoleaf-plugins/table`** (public on npmjs.org). Removed from the core bundle: the named ESM export `Table`, the `GeoLeaf.Table` facade (`show`/`hide`/`toggle`/`setLayer`/`sortByField`/`setSelection`/`zoomToSelection`/`exportSelection`/`exportLayer`…), the `geoleaf:table:*` events, the "Table" tab of the desktop panel and the OOXML writer for Excel export. **Migration**: `npm install @geoleaf-plugins/table`, then load its script **after** `geoleaf.esm.js` (and before `GeoLeaf.boot()`).
- **`GeoLeaf.Popup` removed from the core** _(breaking)_: the `GeoLeaf.Popup.registerActionHandler()` / `unregisterActionHandler()` facade (a registry of rich-context handlers for popup action buttons) is deleted, along with the `modules/built-in/popup/action-registry.ts` module and its `modules/built-in/popup/popup-actions.ts` listener. This registry had not been invoked since popup rendering moved to `@geoleaf-plugins/feature-info`, which only dispatches the `geoleaf:popup:action` event — it had become a silent no-op. **Migration**: replace any call to `GeoLeaf.Popup.registerActionHandler(actionId, handler)` with `GeoLeaf.events.on("geoleaf:popup:action", (e) => { if (e.detail.actionId === actionId) handler(e.detail); })`. The rich context (button DOM reference, `setBusy()`, `close()`) is no longer available — only the JSON payload (`actionId`, `layerId`, `featureId`, `properties`, `lngLat?`) is.
- **`GeoLeaf.GeoJSON.updateLayerZIndex()` removed** _(breaking, lightly documented internal API)_: this method had no caller in the product and failed systematically on MapLibre (a historical Leaflet implementation — `state.map.getPane()` does not exist on the MapLibre adapter). Layer display order is handled natively by the adapter registry.
- **POI rendering routed through the generic seam + `GeoLeaf.POI.openSidePanelWithLayout()` removed** _(breaking)_: clicking a POI marker now emits **`geoleaf:feature:click`** (the same seam as GeoJSON/VT layers) instead of a POI-specific rendering path; `@geoleaf-plugins/feature-info` auto-resolves the layout from `layers.<id>.capabilities.feature-info`. The internal translation bridge (`poi/feature-info-bridge.ts`) and the POI popup delegate (`poi/popup.ts`) are deleted. The `GeoLeaf.POI.openSidePanelWithLayout(poi, customLayout)` API and the `customLayout` parameter of `GeoLeaf.POI.showPoiDetails()` are removed (no callers — the layout now comes from the `capabilities.feature-info` configuration). **Migration**: configure POI rendering under `layers.<id>.capabilities.feature-info`, like GeoJSON layers.
- **`GeoLeaf.POI` removed from the core — dissolution of the POI subsystem** _(breaking)_: the public **`GeoLeaf.POI`** namespace and the named ESM export **`POI`** are **deleted**. A POI is now a **generic GeoJSON point layer** (`GeoLeaf.Layers`), styled by `taxonomy`, clustered by `cluster`, rendered on click by `feature-info` — all in-core capabilities. Removed from the bundle: the monolithic POI rendering pipeline (`built-in/poi/**`, the `poi-source` aggregate), the `resolveCategoryDisplay` icon resolution (replaced by `GeoLeaf.Taxonomy.resolvePoiIcon` wired onto the generic point icon resolver), and every data method (`getAllPois` / `getPoiById` / `getDisplayedPoisCount` / `displayPois` / `reload` / `addPoi` / `add` / `setFilteredDisplay` / `updatePoiSyncStatus` / `updatePoiId` / `getLayer` / `loadAndMergeStoredPois`…). The **filter** and the **search** now read the single `GeoLeaf.Layers` source (search rebuilds its index on demand from the layers — POIs created at runtime become searchable again). **Migration**: read and mutate point data through `GeoLeaf.Layers.getFeatures(layerId)` / `addFeature` / `mergeFeatures` / `setData`; styling and click rendering are configured per layer (`layers.<id>.capabilities.{taxonomy,cluster,feature-info}`). For **interactive creation** of POIs (the addpoi plugin), see the `GeoLeaf.POI.*` → `GeoLeaf.AddPOI.*` migration below.

- **`GeoLeaf.Themes` removed from the core (dead per-layer theme facade)** _(breaking)_: the `GeoLeaf.Themes` facade (`applyTheme` / `loadTheme` / `toggleTheme` / `getAvailableThemes` / `initializeLayerTheme` / `getCurrentTheme` / `clearRememberedThemes` / `invalidateCache` / `init`) and the named ESM export `Themes` are deleted. A relic of the Leaflet era: a "per-layer theme" system loaded from `data/profiles/<layer>/themes/index.json` that produced **no effect on the MapLibre map** (the manager stored the theme id in an internal `Map`, without calling the adapter or the style). **No replacement** — the real theme engine (composition/application, `geoleaf:theme:applied` event) stays **internal and unchanged** (`ThemeApplierCore`), driven by the profile configuration and the UI theme selector (`GeoLeaf.UI`, light/dark). **Migration**: remove any `GeoLeaf.Themes.*` call — the visual theme is driven by the profile configuration plus the UI selector.
- **`GeoLeaf.Search` removed from the core — the full-text search engine (`flexsearch`) purged** _(breaking, dormant engine)_: the `GeoLeaf.Search` facade (`isReady` / `query` / `build` / `getEngine` / `clear`), the named ESM export `Search`, the `SearchRegistry` (the `flexsearch` index engine) and the lazy `search` chunk are **deleted**, along with the **`flexsearch` npm dependency** (removed from `@geoleaf/core`). That engine was **dormant**: no core code and no profile enabled it (`profile.search.engine === "flexsearch"` was never set, `loadModule("search")` was never called, the index was never built). The interface's actual text search (the "Rechercher un POI…" field of the Filter panel) is provided by the in-core **`filter`** capability (substring search), **unchanged** and now **insensitive to accents and word order** (see §Changed). Configuration removed along the way: the layer `search` block (`{ enabled, indexingFields }`), the `ui.showSearch` flag, the root `searchConfig.engine` key. The removal takes `flexsearch` out of the boot **eager closure** (the named export anchored it there, contrary to the "lazy" belief): **boot −8 KB gz**. **Migration**: no action for the UI (the filter covers search); an integrator calling `GeoLeaf.Search.query()` from a script must implement their own search (or index server-side) — the core no longer exposes a full-text engine.
- **`GeoLeaf.GeoJSON.addData` / `.loadUrl` / `.clear` / `.getLayer` removed** _(breaking, dead methods)_: these 4 methods inherited from Leaflet were **inert in MapLibre mode** — the `geoJsonLayer` / `layerGroup` state they manipulated is never assigned (always `null`): `addData` logged an error then drew nothing, `loadUrl` performed a network `fetch` then **discarded the result**, `clear` / `getLayer` were no-ops. The GeoJSON module remains **fully functional**: profile-driven loading (`GeoLeaf.GeoJSON.loadFromActiveProfile()` plus the `layers` configuration), live updates through `updateLayerData(layerId, data)`, reads through `getLayerById` / `getLayerData` / `getLayerConfig` / `getAllLayers`, filtering through `filterFeatures` / `clearFeatureFilter`. **Migration**: replace ad hoc `addData` / `loadUrl` with the profile's layer configuration or `updateLayerData()`; `getLayer()` → `getLayerById(id)`.
- **`GeoLeaf.Route.loadGPX` / `.loadGeoJSON` removed** _(breaking, dead methods)_: these two ad hoc route loading methods were **broken in MapLibre mode** — they took an internal path (`_applyRoute` → `RouteLayerManager.applyRoute({ layerGroup })`) whose `layerGroup` is never assigned; `loadGPX` performed a `fetch` plus `DOMParser` parsing then drew **nothing**. Route loading is still provided by the living configuration path `GeoLeaf.Route.loadFromConfig(routes)` (through `adapter.addGeoJSONLayer`), **distinct** from these methods. **Migration**: declare routes in the profile configuration (loaded by `loadFromConfig`) rather than calling `loadGPX` / `loadGeoJSON`.
- **`GeoLeaf.Utils` — dead quartet removed (`AnimationHelper`, `EventHelpers`, `FileValidator`, `LazyLoader`) plus top-level shortcuts** _(breaking, public surface without a reader)_: `GeoLeaf.Utils.AnimationHelper` / `.EventHelpers` / `.FileValidator` / `.LazyLoader`, the top-level `GeoLeaf.FileValidator`, and the `GeoLeaf.animate` / `.fadeIn` / `.fadeOut` / `.loadModule` / `.enableLazyImages` / `.dispatchEvent` / `.dispatchMapEvent` shortcuts are deleted (0 readers outside tests). **Not to be confused**: the secondary module loader **`GeoLeaf._loadModule(name)`** (with an underscore) is **unchanged and alive**. The rest of `GeoLeaf.Utils` (`FetchHelper`, `MapHelpers`, `DOMSecurity`, `PerformanceProfiler`, `TimerManager`, `debounce`, `throttle`, `getDistance`, `ObjectUtils`, `ScaleUtils`, …) is **unchanged**. Client-side file validation remains available in the plugins that use it (`@geoleaf-plugins/addpoi` and `@geoleaf/field-renderer` ship their own validator). **Migration**: replace `GeoLeaf.animate` / `fadeIn` / `fadeOut` with CSS transitions; `GeoLeaf.dispatchEvent` with `GeoLeaf.events` or `document.dispatchEvent`; there is no core replacement for `GeoLeaf.Utils.FileValidator`.
- **`GeoLeaf.Filters.filterPoiList` and the 6 statistical functions removed (`getUniqueCategories`, `getUniqueSubCategories`, `getUniqueTags`, `countByCategory`, `countBySubCategory`, `getRatingStats`)** _(breaking)_: 0 internal consumers. `GeoLeaf.Filters.filterRouteList` is **unchanged**. **Migration**: for POI filtering, use the **`GeoLeaf.Filter`** capability (singular) — `getActiveFilter()` / `applyFilter(state)` / `hasActiveFilters()` — which drives the active in-core filter panel.
- **`GeoLeaf.Config.getActiveProfilePoi()` removed** _(breaking, dead method)_: it always returned `[]` (POIs having been dissolved out of the profile). `ProfileManager._activeProfileData.{poi,routes}` removed internally (the `ProfileDataPayload` type that still types `profiles[]` is kept).
- **The permalink `poi` parameter removed (`gl_poi` in verbose mode)** _(minor breaking)_: this field made a URL→state→URL round trip without ever influencing application behaviour (a relic of the dissolved POI era). The other fields (`lat`/`lng`/`zoom`/`layers`/`filter`/`categories`/`tags`/`rating`/`theme`) are unchanged.

### Breaking Changes (layer scale thresholds: `zoomConfig` → `scaleConfig`)

- **The `zoomConfig` block of `layers/{layer}/styles/{style}.json` is removed, replaced by `scaleConfig`**: `zoomConfig.minZoom`/`maxZoom` become **`scaleConfig.minScale`/`maxScale`**. **This is not just a rename: it is the correction of a trap.** The old name announced MapLibre zoom levels (0-24) while the engine has always read **scale denominators** (the `X` in `1:X`) — writing `minZoom: 6` therefore hid the layer at every zoom, silently. The new name states the unit that has always been the engine's.
    - **No shim**: the `zoomConfig` block is **rejected at validation** (`additionalProperties: false` schema plus runtime validator), with a message naming the replacement. A profile that has not migrated fails loudly instead of silently losing its constraint. The `minZoom`/`maxZoom` alias **inside** `scaleConfig` is rejected too — that alias is what let a zoom level through.
    - **New guard**: any bound in `(0; 24]` is refused — such a denominator is unreachable at any zoom, so it is always a zoom level entered by mistake. `0` and `null` remain valid ("constraint disabled").
    - **Migration** — your values were already denominators (the normal case): rename the keys, values unchanged. `{ "zoomConfig": { "minZoom": 500000, "maxZoom": 10000 } }` → `{ "scaleConfig": { "minScale": 500000, "maxScale": 10000 } }`.
    - **Migration** — your values were zoom levels (so your layers were invisible): convert with `1:X = 591,658,734 × cos(latitude) / 2^zoom`, at the latitude of your area. For example at ~4°N: zoom 6 → `9222148`, zoom 18 → `2252`. Reference points: zoom 5 ≈ 1:18,444,296 · zoom 10 ≈ 1:576,384 · zoom 13 ≈ 1:72,048 · zoom 20 ≈ 1:563.
    - **Reminder about meaning** (counter-intuitive): `minScale` is the **larger** of the two numbers — it bounds the _widest_ view, and a denominator grows as you zoom out. `{ "minScale": 9222148, "maxScale": 2252 }` = "visible from 1:9,222,148 to 1:2,252".
    - `labelScale.minScale`/`maxScale` (label scale) is **unchanged**: same unit, same guard, but it targets labels and not the layer.

### Breaking Changes (geocoding → plugin)

- **The `geocodingConfig` configuration key (profile root) is removed**: geocoding configuration moves to the **`modules.geocoding`** block, declared in `config/plugins/geocoding.json` and referenced by `Files.modules.geocoding`. `GeoLeaf.Config.get("geocodingConfig")` now returns `undefined`. **No compatibility shim** — a profile keeping `geocodingConfig` at the root no longer loads the geocoding configuration. **Migration**: move the `geocodingConfig` block to `config/plugins/geocoding.json` (keys unchanged: `enabled`, `provider`, `debounceMs`, `minChars`, `resultLimit`, `position`, `placeholder`, `flyToZoom`, `bbox`, `countrycodes`) and declare it in `Files.modules.geocoding`. Details and examples: README of [`@geoleaf-plugins/geocoding`](https://www.npmjs.com/package/@geoleaf-plugins/geocoding).

### Breaking Changes (table → plugin)

- **The `tableConfig` (profile root) and `ui.showTable` configuration keys are removed**: the **global** table configuration moves to the **`modules.table`** block, declared in `config/plugins/table.json` and referenced by `Files.modules.table`. `GeoLeaf.Config.get("tableConfig")` now returns `undefined`; `ui.showTable` is replaced by `modules.table.showButton`. **No compatibility shim** — a profile keeping `tableConfig`/`ui.showTable` at the root no longer loads the table configuration. **Migration**: move the block to `config/plugins/table.json` (keys: `enabled`, `showButton`, `defaultVisible`, `pageSize`, `maxRowsPerLayer`, `enableExportButton`, `virtualScrolling`, `defaultHeight`, `minHeight`, `maxHeight`, `resizable`) and declare it in `Files.modules.table`. **The per-layer binding `layer.config.table.*`** (columns, sorting, title) **stays unchanged on the layer** (`layer-config.schema.json` untouched). Details and examples: README of [`@geoleaf-plugins/table`](https://www.npmjs.com/package/@geoleaf-plugins/table).

### Breaking Changes (POI dissolution → generic layers)

- **The `poiConfig` configuration key (features.json) is removed**: the POI subsystem having been dissolved, the global `poiConfig` block (`{ enabled }`) no longer has an object — it is removed from the 9 profiles, from the `features.schema.json` schema and from the profile schema. `GeoLeaf.Config` no longer reads `poiConfig` nor the `poi[]` array (inline POIs). **No shim** — since `features.schema.json` is `additionalProperties:false`, a profile keeping `poiConfig` **fails validation**. **Migration**: remove the `poiConfig` block from `features.json`. Point layers are declared in `layers[]` like any GeoJSON layer; clustering is already under `modules.cluster`.
- **`@geoleaf-plugins/addpoi` plugin API: `GeoLeaf.POI.*` → `GeoLeaf.AddPOI.*`** _(breaking, plugin)_: `GeoLeaf.POI` having been removed from the core, the addpoi plugin's public POI creation namespace moves to **`GeoLeaf.AddPOI`**. `GeoLeaf.POI.AddForm.*` → `GeoLeaf.AddPOI.AddForm.*`; `GeoLeaf.POI.PlacementMode.*` → `GeoLeaf.AddPOI.PlacementMode.*` (likewise for `ImageUpload`). **Migration**: replace the `GeoLeaf.POI.` prefix with `GeoLeaf.AddPOI.` in your integration code. Created POIs are now written to the editable **host layer** (`gl-src-<layerId>`) through `GeoLeaf.Layers`, alongside static features (fixing the split-brain).

### Breaking Changes (per-layer attribute rendering → `capabilities.feature-info`)

- **The `popup`, `tooltip`, `sidepanelConfig` (blocks) and `tooltipMode` (root alias) keys of `{id}_config.json` are removed**: the tooltip/popup/side-panel rendering configuration of a layer moves to the **`capabilities.feature-info`** block (an opaque property of the `@geoleaf-plugins/feature-info` plugin; keys `titleField`, `tooltip`, `popup`, `sidepanel`). The layer schema (`additionalProperties: false` at the root) now **rejects** those keys. **No shim** — a profile keeping `popup`/`tooltip`/`sidepanelConfig`/`tooltipMode` at the root of `{id}_config.json` fails AJV validation. **Migration**: move the fields under `capabilities.feature-info` — `tooltip.fields` → `capabilities.feature-info.tooltip`, `popup.fields` → `.popup`, `sidepanelConfig.detailLayout` → `.sidepanel`, plus a `titleField` (the dotted path of the title). Details and examples: README of [`@geoleaf-plugins/feature-info`](https://www.npmjs.com/package/@geoleaf-plugins/feature-info).
- **POI taxonomy badges** _(temporary regression)_: without the removed translation bridge, a `badge` field bound to the taxonomy (`categoryId`/`subCategoryId`) displays the raw identifier instead of the label. Label/icon/sprite resolution by the taxonomy will be handled by a dedicated taxonomy rendering configuration (upcoming) — outside the `capabilities.feature-info` block.

### Security

- **Strict `style-src` CSP — `'unsafe-inline'` removed**: every inline style in the rendering (popup badges and tables, POI markers, legend, the `style` attribute of the SVG sprite, demo controls) is now applied through the **CSSOM** (`element.style.setProperty`) or through **CSS classes**, never through an inline `style` attribute or `<style>` element. The `style-src` directive of the deployment template no longer contains `'unsafe-inline'`. A guard end-to-end test checks for **0 `style-src` violations** at boot and when rendering a hostile POI. See the security integration guide for the recommended CSP.
- **XSS hardening in POI rendering**: the `href`/`src` sinks of the `link`/`image` POI sections now validate the URL through `GeoLeaf.Security.validateUrl()` — a URL with a disallowed protocol (`javascript:`, `vbscript:`, `data:text/html`…) **is no longer rendered** (the element is omitted). No change for legitimate `http(s)`/`data:image` URLs (the attribute is normalised to an absolute URL).
- **`GeoLeaf.Security.sanitizeSvgContent()`**: now strips **SMIL** animation elements (`<animate>`, `<set>`, `<animateTransform>`, `<animateMotion>`, `<animateColor>`, `<mpath>`) from untrusted SVG — they can mutate attributes at runtime (e.g. `<set attributeName="href" to="javascript:…">`).
- **Anti prototype pollution**: `Config.merge()`/`set()` filter out the `__proto__`/`constructor`/`prototype` keys.
- **Profile sprite**: the `taxonomy.icons.spriteUrl` URL is validated (`validateUrl`) before the `fetch`.
- **CDN integrity (demo)**: MapLibre GL JS is loaded from unpkg with an `integrity` attribute (SRI sha384) in the deployment template.
- **Anti-clickjacking**: a recommendation for server headers (`X-Frame-Options: DENY` + `frame-ancestors 'self'`) has been added. See the new **integrator security guide**. _(The `style-src` of the reference CSP no longer requires `'unsafe-inline'` — see the "Strict `style-src` CSP" entry above.)_
- **Removal of the `xlsx` (SheetJS) dependency**: Excel export now uses a minimal internal OOXML writer (write-only, no third-party dependency), eliminating 2 CVEs (prototype pollution CVE-2023-30533 plus a ReDoS) that were bundled in the export chunk. No API change (`Excel` remains a table export format).
- **Dependencies**: patched versions pinned (`dompurify`, `markdown-it`, `protocol-buffers-schema`); the remaining vulnerabilities concern development tooling only (not shipped at runtime).

### Removed

- **`GeoLeaf.Security.sanitizePoiProperties()` deleted** _(breaking)_: this helper was wired on no production path — POI text is escaped **at the rendering sinks** (popup `setSafeHTML`, side panel `normalizePoi`) and URLs are validated through `validateUrl()`. It maintained a false coverage signal (tested but never called). To sanitise external data before rendering it **outside** GeoLeaf, use `escapeHtml()` (text) plus `validateUrl()` (URLs), or `sanitizeHTML(el, html)` to inject HTML.
- **Legacy format fallbacks deleted** _(breaking — v3.0.0 clean slate)_: the runtime now accepts only the canonical form of the following keys:
    - **`sizePx` (point size) → use `radius`**: the alias is no longer normalised to `radius` in flat styles. _(Unrelated: `label.buffer.sizePx` — the thickness of a label halo — stays valid and unchanged.)_
    - **`vectorTiles.url` → use `vectorTiles.tilesUrl`**: `tilesUrl` is the canonical key (already required by the profile schema); the input alias `url` is no longer recognised.
    - **`layerScale` (scale visibility) → use `scaleConfig`**: the legacy alias and its deprecation warning are removed. The canonical form is **`scaleConfig.minScale`/`maxScale`** — see the "Breaking Changes (layer scale thresholds)" section above, which gives the unit and the conversion. _(`labelScale` remains supported — not affected.)_
    - **`pointStyle` (marker style override, layer level) deleted**: a legacy block with no MapLibre rendering, unused by the profiles; use the flat `style` format (`radius`, `fillColor`…).
    - **`data.useLegacyProfileData` deleted**: legacy "flat" profile loading (separate `poi.json`/`routes.json`/`mapping.json`) no longer exists; only the modular profile format (`config/core/*` + `Files`) is loaded.
    - **AddPOI plugin**: deriving geometry from the legacy `latlng: [lat, lng]` field is removed — POIs must carry a GeoJSON `geometry`.
- **`GeoLeaf.Utils.EventHelpers.debounce` / `.throttle` deleted** _(minor breaking — v3.0.0 clean slate)_: these two methods were never-called duplicates in the `EventHelpers` namespace (dedicated to dispatching and listening to DOM events). Use the canonical functions **`GeoLeaf.Utils.debounce`** / **`GeoLeaf.Utils.throttle`** (unchanged). Note the slightly different defaults: `debounce` 250 ms (instead of 300), `throttle` 100 ms (instead of 300) — specify the delay at the call site if needed.

### Breaking Changes (profile layout v2)

- **New profile tree**: the section files now live in `config/core/` (`taxonomy.json`, `themes.json`, `layers.json`, `basemaps.json`, `ui.json` plus a new `features.json`) and each plugin's configuration in `config/plugins/<moduleId>.json`. `profile.json` now contains only the identity (`id`, `label`, `description`, `version`), the `map` section and the `Files` manifest. Since paths are declared in `Files`, an existing profile stays readable **if it updates its manifest**; the top-level `taxonomyFile`/`themesFile` fallbacks (outside `Files`), however, are **deleted**. **Migration**: move the 5 section files to `config/core/`, extract `clusteringConfig`/`geocodingConfig`/`performance`/`poiConfig` from `profile.json` into `config/core/features.json` (referenced by `Files.featuresFile`), extract the plugin blocks (`storage`, `poiAddConfig`, `editorConfig`…) into `config/plugins/<moduleId>.json` (referenced by `Files.modules`).

### Added

- **`GeoLeaf.Helpers.applyCssText(el, css)`** (plus the named ESM export `applyCssText`): applies a CSS declaration to an element **property by property through the CSSOM** (`style.setProperty`), in a **CSP-safe** way (not subject to `style-src`, unlike `el.style.cssText = …`). A helper meant for code-owned dynamic styles. Also `applyDeferredStyles(root)` (applies the `data-gl-style` attributes of a subtree after insertion). Used by the core and the plugins to work under a strict `style-src` CSP (without `'unsafe-inline'`).
- **`Files.featuresFile`**: a new section file for cross-cutting core features (`clusteringConfig`, `geocodingConfig`, `performance`, `poiConfig`, `mapOptions`), merged at the root of the consolidated profile like `uiFile`/`basemapsFile`.
- **`Files.modules`**: a `{ moduleId: filePath }` dictionary — one configuration file per plugin, merged into `modules.<id>` (Plugin Contract v1, opaque content for the core). An inline `modules.<id>` block in `profile.json` takes precedence over the file (deepMerge; arrays are replaced, not merged).
- **`profile-bundle.json` extended**: the bundle generated at build time now embeds the `features` and `modules` sections; booting a deployment still takes 3 requests (root config + profile.json + bundle).
- **Debug mode = cascade**: when `debug: true` is active in `geoleaf.config.json`, the loader ignores `bundleFile` and loads the file cascade — this allows editing a deployed profile live without regenerating the bundle.

### Fixed

- **`Core.destroy(mapId)` — real lifecycle teardown**: when the **last** map is closed, the shared business state (POI, GeoJSON, LayerManager, active profile) is now cleaned up through an internal lifecycle seam. A later `Core.init()` (React remount, SPA navigation, profile change) starts from a clean state — **no more duplicated markers or layers, phantom profile or adapter leak**. The public signature is unchanged. Validated in the browser.
- **Legend**: the taxonomy is read from the already-loaded active profile instead of being re-downloaded through a hard-coded path (`profiles/{id}/taxonomy.json`) — this removes a redundant fetch and a latent 404 with layout v2 (the fetch fallback is kept for legacy profiles).
- **Theme selector**: the same fix — themes are read from the active profile instead of a re-fetch of the hard-coded path `profiles/{id}/themes.json`.

- **Popup action buttons**: a new renderer type `type: "action"` in `popup.fields[]` (GeoJSON layers) and `popup.detailPopup[]` (POI markers). A configurable button in the popup can trigger any host-side action — open a back-office record, call an API, emit an event — **without coupling the core to a backend**. Fields: `actionId` (required, opaque), `labelKey`/`label`, `variant` (`primary`/`secondary`/`danger`), `order`, `href` (opened by the core through `validateUrl` if no handler is registered), `confirm`/`confirmKey`, `requiresPlugin` (button disabled if the plugin is absent), `payloadFields` (allow-list of payload properties). Scope for v1: popup only.
- **`GeoLeaf.Popup`**: a new public facade exposing `registerActionHandler(actionId | "*", fn)` and `unregisterActionHandler(actionId)`. The `fn(ctx)` handler receives a rich context (`{ actionId, feature?, poi?, layerId, featureId, properties, lngLat?, buttonEl, popup, setBusy, close }`) and may return a `Promise` — the button then goes into a "busy" state until it resolves. Click precedence: exact handler → wildcard handler `"*"` → opening the built-in `href`. CSRF protection is the handler's responsibility (`GeoLeaf.Security.CSRFToken.addTokenToHeaders()`).
- **`geoleaf:popup:action`**: a new event emitted on `document` at every click on a popup action button (emitted in all cases, whether or not a handler is registered). Payload: `{ actionId, layerId, featureId, properties, lngLat? }` — `properties` bounded by `payloadFields` (default: `id`/`name`/`title`/`label`), functions and DOM references removed.
- **Per-module configuration — `modules.<id>`**: plugin configuration is declared in a `modules.<id>` block of the profile (e.g. `modules.storage`, `modules.print`). The content of each block belongs to the plugin — the core treats it as opaque. **This is now the only supported form** (the fallback to legacy root keys has been removed, see Removed).
- **`GeoLeaf.Config.getModuleConfig(moduleId, key?, defaultValue?)`**: an accessor reading `modules.<moduleId>.<key>`. Dot-notation equivalent: `GeoLeaf.Config.get("modules.<id>.<key>")`.
- **`style.paint` (layer styles) is now merged**: a `style.paint` block (native MapLibre properties — `fill-color`, `circle-radius`, `line-dasharray`…) declared in a style file is now **merged into the layer paint**, like `expressionPaint` (which still applies last). Previously `style.paint` was silently ignored (only `expressionPaint` was applied) — profiles that declared it now see their rendering applied.
- **`mapping.json` contract — single multi-source form**: `mapping.json` (normalising raw data from an external source into the POI format) is now **always** an object of blocks named by source `{ "<sourceId>": { mapping, … } }` (a single source means a single block; the top-level `{ mapping }` form is gone). Each `mapping` is **flat** (`{ normalisedField: "sourceField" }`, dotted paths allowed: `location.lat`, `attributes.kind`). Schema: `mapping.schema.json`.
- **External source normalisation when loading a layer**: declare `Files.mappingFile` in the profile manifest, then point a **GeoJSON layer** at a source block through `data.mapping: "<sourceId>"` (plus the optional `data.itemsPath`, e.g. `"results"`, to extract the array from a nested response such as the GBIF API). At load time the raw data is normalised (mapping.json → POI format) then rendered as GeoJSON **Point** features. Numeric `id` values (e.g. the GBIF `key`) are coerced to strings. The `guyane-biodiversite` demo profile illustrates the case with the `observations_gbif` layer (GBIF API).
- **New contractualised UI parameters**: `ui.showSearch`, `ui.showShareButton` (default `true`) and `ui.interactiveShapes` (default `false`) are now declared in the `ui` schema — previously read by the code but not configurable.
- **`data.vectorTiles.scheme`** (`"xyz"` | `"tms"`): the vector tile grid scheme is now configurable (e.g. `"tms"` for the IGN Géoplateforme).
- **`data.ogcApi` source**: an OGC API Features configuration block, now formally declared (`url` required, plus `collectionId`/`bbox`/`maxFeatures`/`limit`/`autoRefresh`/`autoRefreshDebounce`/`headers`).

### Removed

- **Breaking — root-level plugin configuration keys removed**: `storage`, `poiAddConfig`, `printConfig`, `measureConfig` and `editorConfig` at the profile root **are no longer recognised**. The bidirectional mirror and the deprecation fallback have been deleted: `modules.storage`, `modules.addpoi`, `modules.print`, `modules.measure`, `modules.editor` are **the only valid form** (Plugin Contract v1, INV-CONFIG, now frozen). The corresponding interfaces have been removed from the `GeoLeafConfig` type API. **Migration**: declare each plugin configuration under `modules.<id>` (already the case for every shipped profile since layout v2) and read it through `GeoLeaf.Config.getModuleConfig(id, key, default)` or `Config.get("modules.<id>.<key>")`.
- **Breaking — the `lineColor`/`lineOpacity`/`lineWidth` style aliases removed**: these legacy keys had **no effect** (the converter reads only `color`/`opacity`/`weight`). They are removed from `style.schema.json` (and are now **rejected** at profile validation). **Migration**: `lineColor`→`color`, `lineOpacity`→`opacity`, `lineWidth`→`weight`.
- **Breaking — the top-level form of `mapping.json` removed**: a `mapping.json` carrying `mapping` at the root is no longer valid; wrap it in a named source block (see "`mapping.json` contract" and "External source normalisation" in Added).
- **Breaking — `GeoLeaf.UI.ScaleControl` removed**: this scale control was a **duplicate** (driven by `ui.scaleType`, not auto-initialised) of the active scale bar. Use the standard control, driven by **`scaleConfig`** (`scaleGraphic`/`scaleNumeric`/…) and initialised automatically at boot. The `ui.scaleType` parameter is deleted (replaced by `scaleConfig`).

### Breaking Changes (multi-instance)

- **`Core` is no longer a singleton**: `Core.init({ mapId })` creates one instance per `mapId` instead of recycling a single one. `init()` now requires `options.mapId` (returns `null` plus an error log otherwise). `Core.getMap(mapId?)` accepts an optional `mapId` — **without an argument it returns the first active instance** (backwards compatible). The legend and the theme stay **global** and apply to the **first** instance (a deliberate scope). `GeoLeaf.removeMap(id)` is **deprecated** and aliased to `Core.destroy(id)` (with a warning). **Migration**: **single-map** apps → no change; **multi-map** apps → `const a = GeoLeaf.Core.init({ mapId: 'unique-id', center, zoom }); /* when the component unmounts */ GeoLeaf.Core.destroy('unique-id');`.

### Added (multi-instance)

- **`Core.destroy(mapId)`**: cleanly destroys a keyed instance — calls `MaplibreAdapter.destroy()` (`map.remove()`, purge of markers/controls/registry) then frees the registry slot. Returns `true` if an instance existed, `false` otherwise. To be called on teardown by the consumer (e.g. React unmount).
- **`Core.hasMap(mapId)` / `Core.listMaps()`**: introspection of the instance registry (debugging, devtools, tests).
- **Multi-instance support**: N MapLibre maps coexisting on the same page, each with an independent lifecycle (mount/unmount).

### Changed

- **Geocoding UI**: the default `geocodingConfig.position` is now `"top-left"` (previously `"top-right"`). The geocoding pill adopts the visual style of the shared POI search bar (`.gl-pill-search`) with an SVG magnifier icon on the submit button. Explicit `position` values in profiles are still honoured unchanged. **Integrator migration**: no action required; to keep the former behaviour, declare `geocodingConfig.position: "top-right"` in the JSON profile.
- **POI search**: the `searchConfig.filters[].type: "search"` filter is now rendered in a dedicated section at the top of the filter panel (it was previously hidden). The input is placed in `[data-gl-filter-id="searchText"]` — an unchanged selector for `state-reader`. Live filtering triggers on every keystroke.
- **Mobile (≤ 768 px)**: the "search" button of the pill toolbar now opens the floating geocoding pill (address search) instead of the former POI bar. POI search on mobile is reachable through the FILTER tab/sheet, which holds the `searchText` pill in its header.

### Removed

- **`.gl-search-bar*` (CSS)** plus the `mobile-toolbar-searchbar.ts` module (the POI floating search bar) and the CSS variables `--gl-search-bar-height` / `--gl-search-bar-gap`: replaced by the `.gl-pill-search` component shared between the geocoding pill and the POI search pill in the filter panel. Integrators who overrode these classes must move to `.gl-pill-search`, `.gl-pill-search__input`, `.gl-pill-search__submit`, `.gl-pill-search__clear`.

### Added

- **`@geoleaf-plugins/measure` v1.0.0**: an MIT map measurement plugin (distance, area, circle, georeferenced DOM tooltip annotations, GPS track) — published on npmjs.org. Public facade: `GeoLeaf.Measure.activate()`, `deactivate()`, `clearAll()`, `exportGeoJSON()`, `importGeoJSON()`, `getPrintableAnnotations()`, `setMenuPosition()`, `getMenuHeight()`. Configurable through `measureConfig` in the GeoLeaf profile.
- **`@geoleaf-plugins/print` v1.1.0**: a conditional "Annotations" checkbox in the print modal — visible only if `@geoleaf-plugins/measure` is loaded; tooltip annotations are composed into the canvas export at their geographic coordinates through `GeoLeaf.Measure.getPrintableAnnotations()`. New field `printConfig.includeAnnotations` (boolean, default `true`). i18n in 6 languages.
- **CSS variables `--gl-color-tooltip-bg` / `--gl-color-tooltip-text`** in `geoleaf-theme.css` (`:root`, `.gl-theme-light`, `.gl-theme-dark`) — the tooltips of the pill bar and of the plugin-measure sub-menu buttons now follow the current theme instead of hard-coded colours.
- **`GeoLeaf.Share`** (view sharing): a new public facade exposing `openShareDialog()`, `closeShareDialog()`, `isOpen()` and `getShareUrl()`. It shows an accessible modal with the current permalink (`window.location.href`), a "Copy" button (`navigator.clipboard.writeText` plus an `execCommand` fallback) and a "Show QR code" button that **lazy-loads** the `qrcode-generator` library on the first click only (a separate chunk, ~12 KB gzip, no impact on the initial bundle).
- **`ui.showShareButton`** (boolean, default `true`) in `IUIConfig`: controls the display of the "Share" buttons (mobile pill bar + desktop tab strip).
- **Mobile "Share" button** injected into the pill bar through the registry (`mobileIcon`) — behaviour consistent with the print button.
- **Desktop "Share" button** inserted in the tab strip between the separator and the theme toggle.
- **`@geoleaf-plugins/print` v1.0.0**: an MIT map printing plugin (PDF/JPG export, A4/A3 at 300 DPI, interactive scale × paper format flow, off-screen re-render, 2D canvas composition, inline legend, optional server fallback) — published on npmjs.org.
- **`GeoLeaf.I18n.registerDict(namespace, dictsByLang)`**: a core API letting plugins register their own i18n dictionaries.
- **`preserveDrawingBuffer` auto-detected** in `maplibre-adapter.ts` when the print plugin registers — no manual configuration required.
- **`ui.showPrint`** in `UIConfig` plus **`printConfig`** in `GeoLeafConfig`: integration of the print plugin's configuration into the GeoLeaf profile.

### Fixed

- **`gl_shown` permalink**: opening a shared link containing `gl_shown=<layerId>` for a layer outside the active theme now displays that layer correctly. Restoration was previously a silent no-op because `VisibilityManager.setVisibility()` ignored layers absent from `GeoJSONShared.state.layers`. A new `restoreShownLayer` helper (`modules/built-in/permalink/permalink-layers.ts`) lazy-loads the layer through `ThemeApplierCore._loadLayerFromProfile()` before applying the user override.

### Breaking Changes (public type rename)

- **`LeafletLayerLike` → `LayerLike`**: the public type `LeafletLayerLike` has been renamed to `LayerLike` in `@geoleaf/core`. This rename is a hard breaking change with no deprecation alias. **Migration**: replace every `import { LeafletLayerLike } from '@geoleaf/core'` with `import { LayerLike } from '@geoleaf/core'`.

### Changed

- **Internal — cache UI moved out of the core**: the `CacheSection` module (dead code, never rendered in production) and the associated CSS assets (`geoleaf-cache.css`, `cache-modal.css`) have been removed from `@geoleaf/core`. The `ui.cache.*` / `toast.cache.*` / `aria.cache.*` / `format.cache.*` i18n keys have been removed from the core as well. These elements now live exclusively in `@geoleaf-plugins/storage` (CSS bundled inline through `rollup-plugin-postcss`, auto-injected when the plugin loads). **No user-facing impact**: the `ui.showCacheButton` flag still works (the plugin reads it directly from `cfg.ui`) and the cache button still appears when `@geoleaf-plugins/storage` is loaded. Typing: the `showCacheButton` field no longer appears explicitly in `UIConfig` — it is still accepted through the `[key: string]: unknown` passthrough.
- **Internal export `GeoLeaf._LayerManagerCacheSection`**: removed (a private `_`-prefixed reference, never publicly documented).

### Added

- **Multi-format table export (CSV, KML, GPX, Excel)**: the GeoLeaf table now supports 5 export formats — GeoJSON (existing), CSV, KML, GPX and Excel (.xlsx through SheetJS, lazy-loaded). The interface goes from a single "Export" button to two **split-button dropdowns**: "Export selection" (active only when there is a selection) and "Export layer" (always active when a layer is loaded). Each dropdown lists the configured formats.

- **`Table.exportSelection(format?, options?)`**: an existing method, extended. It now accepts an `ExportFormat` (`'geojson' | 'csv' | 'kml' | 'gpx' | 'excel'`) and an optional `ExportOptions` object. Default: `'geojson'` (backwards compatible).

- **`Table.exportLayer(format?, options?)`**: a new public method. It exports **all** the features of the active layer (without the `maxRowsPerLayer` limit) in the requested format. Emits `table:exportLayer` with `{ layerId, format, count }`.

- **`TableConfig`** in `geoleaf.config.json` or `profile.json`: a formalised TypeScript interface with the new keys `exportFormats`, `csvSeparator`, `csvIncludeGeometry`. See the dedicated section in `PLUGIN_CONFIGURATION_GUIDE.md`.

- **`table:exportLayer`**: a new event emitted on `document` after a whole-layer export. Payload: `{ layerId: string, format: ExportFormat, count: number }`.

- **`UIConfig.showCredentialButton`**: a new optional `boolean` field in `UIConfig` (typing only). It lets the `@geoleaf/connector` plugin ≥ 1.1.0 read whether the credential button is enabled from the `ui.json` profile. No core code consumes this field (`no-plugin-in-core` compliance). From `@geoleaf/connector` 1.2.1 onwards, this flag alone is enough to mount the button without a prior `GeoLeaf.Connector.configure()` call (UI-only auto-bootstrap on the plugin side, triggered by `geoleaf:profile:loaded` / `geoleaf:map:ready`; read through `GeoLeaf.Config.getActiveProfile()`).

- **`@geoleaf-plugins/realtime-layer` — `data.realtime.fallbackUrl`**: a new optional field of the `data.realtime` schema. A local CDN snapshot served automatically by `PollingSource` when the primary URL returns a non-2xx HTTP status or fails (network error). The snapshot is emitted once per outage; the source keeps polling the primary and returns to it on its first success. Polling only.
- **`@geoleaf-plugins/cog`**: a new Cloud Optimized GeoTIFF (COG) rendering plugin. Native reading through `geotiff@^3.0.5` with automatic overview selection based on the viewport, multi-band rendering (1/3/4 channels, transparent nodata, colorMap LUT), injection as a MapLibre GL JS `image` source. API: `GeoLeaf.COG.addLayer(url, map, opts?)`, `GeoLeaf.COG.removeLayer(map, id)`, `GeoLeaf.COG.getInfo(url, opts?)`. A separate bundle from the core, published on npmjs.
- **`@geoleaf-plugins/flatgeobuf`**: a new MIT FlatGeobuf loading plugin. Streaming through an async iterator (`flatgeobuf` v4.4.0), spatial bbox filtering through an R-tree index plus HTTP Range requests, debounced auto-refresh on the viewport. API: `GeoLeaf.FlatGeobuf.load(url)`, `loadBbox(url, bbox)`, `loadAsLayer(url, options?)`, `loadBboxAsLayer(url, bbox, options?)`, `loadLayerFromConfig(config)` (declarative JSON configuration). A separate bundle from the core (~91 KB raw / 20 KB gzip). First examples in profiles: `france-rail/zones_desserte` (bbox + auto-refresh), `tourism/eco_regions_fgb` (local file; size gain −51% versus the source GeoJSON).
- **`@geoleaf-plugins/file-import`**: a new MIT geospatial file import plugin. Supported formats: GPX, KML, KMZ, CSV (lat/lng or WKT), TopoJSON. API: `GeoLeaf.FileImport.convert(file)`, `importAsLayer(file, options?)`, `getSupportedFormats()`, `registerConverter(ext, converter)`. A separate bundle from the core (~276 KB raw).
- **`Geocoding`**: the 31st named ESM export. A lazy-loaded address search module (`_loadModule("geocoding")`), API `GeoLeaf.Geocoding`. Four built-in providers: `addok`, `nominatim`, `photon`, custom URL.
- **`geoleaf:geocoding:result`**: a new event emitted when a geocoding result is selected — payload `{ label, lat, lng, bounds? }`.
- **`GeocodingConfig`** in `ui.json` or `geoleaf.config.json`: parameters `enabled`, `provider`, `position`, `placeholder`, `minChars`, `resultLimit`, `debounceMs`, `flyToZoom`.
- **3D terrain**: relief support on raster (`type: "tile"`) and vector basemaps (`type: "maplibre"`). Configuration through `basemaps.{id}.terrain` (`enabled`, `demUrl`, `demEncoding`, `demMaxZoom`, `exaggeration`, `default3D`, `pitch`, `bearing`). Automatic activation without a UI toggle — `default3D: true` enables terrain when switching to the basemap, `false` disables it. DEM source validated in production: AWS Terrarium (~30 m).
- **`map.maxPitch`** in `profile.json`: a configurable camera pitch ceiling. GeoLeaf raises the MapLibre GL JS default limit (60°) to **80°**. Default value: `80`. Configurable through `profile.json > map.maxPitch`.
- **Fill-extrusion**: support for 3D polygons through the MapLibre GL JS `fill-extrusion` layer type. Set `geometry: "fill-extrusion"` in the layer config file, then define `fillExtrusionColor`, `fillExtrusionOpacity`, `fillExtrusionHeight` and `fillExtrusionBase` in the style file. `fillExtrusionHeight` accepts a fixed value (metres) or a feature field name (e.g. `"hauteur"`). Validation is handled by `style-validator-extrusion.ts`: an error if `fillExtrusionHeight` is missing, a warning if the field is not found in the properties of the first feature.
- **`GeoLeaf.Utils.wktToGeoJSON(wkt)`**: converts a WKT string into a GeoJSON geometry object. Supports the 7 standard types (`Point`, `LineString`, `Polygon`, `MultiPoint`, `MultiLineString`, `MultiPolygon`, `GeometryCollection`) in 2D and 3D/Z. Supports the SRID prefix (`SRID=4326;…`) and the `Z`/`M`/`ZM` qualifiers. Returns `null` without throwing if the input is invalid.
- **OGC API Features**: native support for loading GeoJSON layers from an OGC API Features endpoint. Configure `data.ogcApi` in the layer definition: `url`, `collectionId`, `bbox`, `maxFeatures`, `limit`, `autoRefresh`, `autoRefreshDebounce`, `headers`. Automatic pagination through `next` links, a `maxFeatures` guard, cancellation through `AbortController`, automatic conversion of WKT geometries. With `autoRefresh: true`: re-fetch on `moveend` with the current viewport bbox.
- **`.topojson` and `.fgb`** added to `FileValidator` validation.
- **Basemap `type: "image"`**: a new basemap type for static georeferenced images (the native MapLibre `image` format). Configuration through `basemaps.{id}.imageSource` (`url`, `coordinates`, `opacity`). The image is positioned by its 4 corners `[lng, lat]`; without `coordinates`, world bounds are used by default.
- **Basemap `type: "hillshade"`**: relief shading through a MapLibre `hillshade` layer. Configuration through `basemaps.{id}.hillshade` (`demUrl`, `demEncoding`, `demMaxZoom`, `shadowColor`, `highlightColor`, `accentColor`, `exaggeration`, `illuminationDirection`, `illuminationAnchor`). It automatically reuses the `terrain-dem` DEM source if it is already present with the same URL (compatible with `type: "tile"` 3D terrain).
- **Basemap `type: "wmts"`**: support for OGC WMTS servers through dynamic `GetCapabilities` resolution. Configuration through `basemaps.{id}.wmts` (`getCapabilitiesUrl`, `layer`, `tileMatrixSet`, `format`). Namespace-safe XML parsing, in-memory cache of resolved URLs, cancellation through `AbortController`.
- **Basemap `type: "wms"`**: support for OGC WMS servers (raster streams). Configuration through `basemaps.{id}.wms` (`url`, `layers`, `version`, `crs`, `format`, `tileSize`, `transparent`, `styles`). It builds the URL template with the `{bbox-epsg-3857}` placeholder, compatible with MapLibre GL JS.

### Changed

- **GPX extraction out of the core**: the GPX→GeoJSON conversion (the `DataConverter.convertGpxToGeoJSON()` method plus its private helpers) has been removed from `@geoleaf/core` and migrated to `@geoleaf-plugins/file-import`. The route pipeline (`route-utils.ts::parseGPX()`) and normalisation (`normalizer.ts::normalizeFromGPX()`) are not affected. The `DataConverterLike` interface is updated (`convertGpxToGeoJSON()` removed). The `single-layer.ts` loader no longer has an `isGpx` branch — a simpler loading flow.

### Docs

- **Complete geocoding guide**: `CONFIGURATION_GUIDE.md §12` extended with a provider selection guide (Addok = French local authorities, Nominatim = general worldwide use), a comparison table (coverage, quota, latency, attribution), the Nominatim usage policy (1 req/s, automatic User-Agent, automatic Accept-Language), the custom provider schema (fields read by the internal parser), the programmatic API (`GeoLeaf.Geocoding.search/selectResult/destroy`) and a security note. A new recipe in `COOKBOOK §11` (4 variants: minimal Addok, worldwide Nominatim, custom event, search without UI), a new `USER_GUIDE §7.6` section (keyboard navigation, `flyTo` versus `fitBounds`), and 6 `FAQ` entries (API key, provider choice, Nominatim 429, area filtering, result event, custom provider). Additional note in `API_REFERENCE`: silent fallback to Addok when not on HTTPS, `destroy()` behaviour.

### Fixed

- **`@geoleaf-plugins/realtime-layer` — reading `data.realtime`**: `RealtimeManager.bootFromProfile()` and `start()` did not find the realtime configuration when it was nested inside the `data` block of the layer JSON (the canonical profile schema). The plugin only read `config.realtime` at the root. The lookup now checks `config.data.realtime` first, then falls back to `config.realtime`.
- **Flat fill-extrusions on load**: `fill-extrusion` layers displayed flat (height 0) on initial load and after a style change. Cause: the complete style object `{ id, label, style: {…} }` was passed straight to the rendering functions instead of the flat paint — `toFillExtrusionPaint()` did not find the `fillExtrusionHeight` and similar keys at the root. Fixed in `theme-applier/visibility.ts` and `vector-tiles.ts`.
- **Active style lost after a basemap change**: GeoJSON layers (including fill-extrusion ones) systematically reverted to the default style after every basemap switch. Cause: `_rebuildGeoJSONLayers()` read `.defaultStyle` on a flat paint, always `undefined`. Fixed by reading `currentStyle.style ?? currentStyle`.
- **Spurious `line` sub-layer on fill-extrusion layers**: a `line` sub-layer was generated on top of the 3D volumes, producing a spurious rendering. Fixed by a `geometry !== "fill-extrusion"` guard in `maplibre-helpers.ts`.
- **Vector tile layers invisible after a basemap switch**: VT layers were not reloaded after a basemap change (they were skipped in `_rebuildGeoJSONLayers` because `features: []`). Fixed by a dedicated `isVectorTile === true` branch triggering `loadVectorTileLayer()`.

---

## Earlier versions

The changelog for versions before 3.0.0 is not carried over here. The release notes for 2.0.0 —
the first npm publication, which carried the move from Leaflet to MapLibre GL JS — remain
available: [Patchnote V2.0.0](releases/PATCHNOTE_V2.0.0).

Every breaking change carries its own **"Migration"** note in the section of the version
concerned above.
