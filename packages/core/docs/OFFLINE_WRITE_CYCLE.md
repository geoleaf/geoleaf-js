---
title: "Offline write cycle — the application's side"
---

# Offline write cycle — the application's side

**Applies to:** `@geoleaf/core` v3.x · `@geoleaf-plugins/editor` · `@geoleaf-plugins/connector`

::: info
**This page is for whoever builds the application.** An edit is written to the device first,
queued, and sent to the server when the network allows — whether the network was there at capture
time or not. This page says what a layer declares for that, what the queue does with each edit,
and what the application can watch and act on. What the server receives and must answer is the
[server contract](SERVER_CONTRACT.md); why the cycle exists is the second axis of the
[direction](DIRECTION.md).
:::

---

## What must be on

- **The offline engine.** The write queue belongs to it: it is in `@geoleaf/core`, off by default,
  and loaded only when both `modules.pwa.enabled` (root configuration) and
  `modules.offline.enabled` (the profile's `config/plugins/offline.json`) are `true`. Without it,
  `GeoLeaf.Storage` is mounted but holds no queue: `canQueueWrites()` answers `false`, and
  `applyEdit()` waits three seconds for the engine, then refuses with `engineUnavailable`.
- **A capture tool.** `@geoleaf-plugins/editor` draws and edits geometries and their attribute
  form, and routes each save to the queue. An application can also write through
  `GeoLeaf.Storage.applyEdit()` itself.
- **For a server that authenticates**, `@geoleaf-plugins/connector` — see
  [Authentication](#authentication).

## Declaring a writable layer

Everything is declared per layer, in its `<id>_config.json`. The block below is a complete layer
file, valid against the layer schema the package ships
(`@geoleaf/core/schemas/layer-config.schema.json`). The display keys — `data`, `styles` and the
rest — are left out; every key is listed in the
[profile schema reference](https://github.com/geoleaf/geoleaf-js/blob/main/docs/reference/PROFILE_SCHEMA_REFERENCE.md).

<!-- geoleaf:docs:schema layer-config -->

```json
{
    "id": "field_points",
    "label": "Field points",
    "geometryType": "point",
    "edition": { "create": true, "update": true, "delete": false },
    "editableGeometryTypes": ["Point"],
    "offline": {
        "enabled": true,
        "maxFeatures": 5000,
        "source": {
            "url": "https://data.example.com/ogc",
            "versionProperty": "updated_at"
        }
    },
    "write": {
        "enabled": true,
        "endpoint": "https://data.example.com/api/field_points",
        "dialect": "collection",
        "geometryProperty": "geom",
        "properties": ["name", "status", "note"]
    },
    "attributes": {
        "titleField": "properties.name",
        "fields": [
            {
                "field": "properties.name",
                "label": "Name",
                "primitive": "string",
                "widget": "text",
                "display": { "surfaces": ["tooltip", "popup"] },
                "edit": { "required": true }
            },
            {
                "field": "properties.status",
                "label": "Status",
                "primitive": "string",
                "widget": "dropdown",
                "options": {
                    "options": [
                        { "value": "open", "label": "Open" },
                        { "value": "closed", "label": "Closed" }
                    ]
                },
                "display": { "surfaces": ["popup"] },
                "edit": {}
            },
            {
                "field": "properties.note",
                "label": "Note",
                "primitive": "string",
                "widget": "longtext",
                "edit": {}
            }
        ]
    }
}
```

### `edition` — what the layer permits

| Key                          | Meaning                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`, `update`, `delete` | Each grants one operation. **Absent means refused**, and so does an empty `edition`. No key implies another: `update` does not grant `delete`                                   |
| `accuracyField`              | The property that receives the GPS accuracy, in metres, of a position taken from the device — never of a point placed by tapping the map. It must also be in `write.properties` |

The permission holds on every write, queued or not. `GeoLeaf.Storage.mayEdit(layerId, kind)`
answers it synchronously from the active profile — `false` for a layer it does not know — and
`applyEdit()` refuses on its own account (`layerNotEditable`, `deleteNotPermitted`). Pulling a
layer onto the device never makes it writable.

`editableGeometryTypes` lists the geometries the editor offers to draw on the layer, in GeoJSON
casing: `Point`, `LineString`, `Polygon`. A lowercase value matches nothing.

### `offline` — reading the layer from the device

| Key                      | Meaning                                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                | The layer is read from the device's store instead of the network. An empty store falls back to the network, so it is safe to declare before the first pull                                                                              |
| `maxFeatures`            | **Required** once `enabled` is `true`: the most entities a pull brings down. A pull that reaches it stops and says so. Without the key the loader's own cap of 10,000 would apply, and a larger layer would be cut short without a word |
| `source`                 | Where the layer is **pulled** from: an OGC API Features `url`, and a `collectionId` — the layer id by default. It is the pull source, not the display source: `data` still says how the layer is shown until its first pull             |
| `source.versionProperty` | The property holding each entity's freshness marker, `updated_at` by default. An update or a delete sends the marker back as a filter when the device holds one — how a [conflict](#conflicts) is detected                              |
| `source.delta`           | The server serves changes and deletions, so a pull after a complete one asks only for what changed — §1.3 of the [server contract](SERVER_CONTRACT.md)                                                                                  |
| `maxAgeMs`               | After this age, `getSyncReport()` reports a layer declaring a `source` as stale. No default                                                                                                                                             |

### `write` — where the edits go

| Key                | Meaning                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`          | `false` gives the layer no write target. Its captures are still held on the device, and set aside as `layerNoLongerWritable` when the queue reaches them                       |
| `endpoint`         | **Required** once `enabled` is `true`: the URL the queue writes to, without a query string — the requests are §2.1 of the [server contract](SERVER_CONTRACT.md)                |
| `dialect`          | `collection`, the default, is the only dialect the queue sends. A layer declaring `rest` has its queued edits set aside as `dialectNotSupported`                               |
| `geometryProperty` | The key the geometry is sent under — `geom` by default                                                                                                                         |
| `properties`       | The properties sent, as a whitelist: a property not listed is never sent. **Absent, every property of the entity is sent**                                                     |
| `auth`             | `none`: the endpoint takes no credential, and the connector attaches none. `bearer`: it requires a session, and a capture waits for one. See [Authentication](#authentication) |

### Editable fields — `attributes.fields[].edit`

A field carrying `edit` is offered in the capture form; `display` is its reading projection, and a
field carries either or both. `edit.required` makes the value mandatory. `edit.widget` and
`edit.options` replace the field's own pair for capture only — a value shown as a badge can be
chosen from a dropdown.

**The schema ties the three blocks together.** As soon as one field carries `edit`, the layer must
declare `edition` with `update: true` **and** a `write` block — `update` rather than `create`,
because `edit` describes changing a value that exists. A layer file breaking the rule fails
[validation against the shipped schema](schema/README.md).

Neither the schema nor the library checks that `write.properties` names the editable fields: keep
the two lists in step, or a value captured on the device never reaches the server.

## What a capture does

`GeoLeaf.Storage.applyEdit({ layerId, kind, localId?, feature?, baseVersion? })` is what the editor
calls on save:

1. **The device first.** The edit is written to the local store. A create gets a client identity,
   its `localId`, which reaches the server as `local_id`; it must carry a geometry. An update may
   bring part of the entity only — what it does not bring is kept.
2. **Then the queue** — or what is already owed for that entity absorbs it:

    | Already owed | New edit | Result                                        |
    | ------------ | -------- | --------------------------------------------- |
    | a create     | update   | still one create, sent with the latest state  |
    | an update    | update   | still one update                              |
    | a create     | delete   | both vanish — the server never saw the entity |
    | an update    | delete   | one delete                                    |

    An entry on its way to the server, or set aside, never absorbs a new edit.

3. **`geoleaf:offline:outbox-queued`** is dispatched on `document`.

It never throws. A refusal comes back in `refused`: `layerUnknown`, `layerNotEditable`,
`deleteNotPermitted`, `malformedEdit`, `geometryRequired` or `engineUnavailable`.

```ts
const storage = GeoLeaf?.Storage;
if (storage?.mayEdit?.("field_points", "create")) {
    const report = await storage.applyEdit?.({
        layerId: "field_points",
        kind: "create",
        feature: {
            type: "Feature",
            geometry: { type: "Point", coordinates: [2.35, 48.85] },
            properties: { name: "North gate", status: "open" },
        },
    });
    if (report?.refused) console.warn("not recorded:", report.refused);
}
```

With `@geoleaf-plugins/editor`, a save goes to the queue whenever
`GeoLeaf.Storage.canQueueWrites(layerId)` is true — its default `persistence.mode`. The mode
`"online"` declares a deployment without a local store: saves then go straight to the server
through the editor's own online path, and never enter the queue — see the
[editor's README](https://github.com/geoleaf/geoleaf-js/blob/main/packages/plugins/editor/README.md).

## When the queue drains

The queue is sent from the page — never from the service worker — one entry at a time, in capture
order. A pass starts on:

| Trigger                                                                                             | Condition                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| the engine becoming ready                                                                           | none — it sends what an earlier session left                  |
| the browser's `online` event                                                                        | none                                                          |
| the tab becoming visible                                                                            | online, 5 s at least since the last pass, and an entry is due |
| a periodic tick, every `modules.offline.drain.pollIntervalMs` — 60,000 by default, `0` turns it off | the tab is visible, online, and an entry is due               |
| a save through the editor                                                                           | none                                                          |
| `GeoLeaf.Storage.pushOutbox()`                                                                      | none — it runs a pass at once, or joins the one in progress   |

A capture written through `applyEdit()` directly asks for no pass: the next trigger sends it, or a
call to `pushOutbox()`.

An entry is attempted **four times in all**. After a failure it waits — 30 seconds after the
first, 2 minutes after the second, 8 minutes after the third — and a pass walks past an entry whose
wait is not over. The fourth failure sets it aside: a server away for about ten minutes does not
set the queue aside. Some answers set an entry aside at once: how each answer is read is §2.2 of
the [server contract](SERVER_CONTRACT.md).

**A 401 stops the queue.** The entry is set aside as `authRequired`, the pass ends there —
everything behind it would meet the same dead session — and every trigger above but the first
and `pushOutbox()` pauses, until a pass ends without a 401 or the page is loaded again.
The sync bar's **Sync now** button, and the send button of the offline window, are not paused:
a person pressing them is saying the session is back. ⚠️ If it is not, that pass stops at its
first 401 too, and sets one more entry aside. How the queue starts again is under
[Authentication](#authentication).

## Entries set aside

An entry the queue cannot send as it is gets **set aside** — kept, counted, never dropped — with
one motive:

| Motive                   | Cause                                                                                                                       | Way out                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `retryBudgetExhausted`   | four failures: a network error, a timeout, or a server unavailable (408, 429, 500, 502–504)                                 | requeue                                 |
| `rejectedByServer`       | four refusals — a 403 or another 4xx — or a create answered 409, or acknowledged with `[]`, whose row the server then lacks | discard                                 |
| `authRequired`           | a 401                                                                                                                       | requeue, once the session is back       |
| `deletedOnServer`        | the entity no longer exists on the server                                                                                   | discard                                 |
| `notImplementedByServer` | the server answered 501                                                                                                     | requeue, once the server implements it  |
| `layerNoLongerWritable`  | the layer has no `write` target, or it is disabled                                                                          | requeue, once `write.enabled` is `true` |
| `dialectNotSupported`    | the layer declares `write.dialect: "rest"`                                                                                  | requeue, once it declares `collection`  |

- `GeoLeaf.Storage.requeueableReasons()` returns the motives a requeue can lift.
  `requeueQuarantined(entryId)` puts one entry back in the queue, `requeueAll(motive?)` every
  requeueable one. For `layerNoLongerWritable` and `dialectNotSupported` they first check that the
  cause is gone: `requeueQuarantined()` refuses with `causeStillPresent`, `requeueAll()` counts
  what it leaves in `skipped`. **A requeue asks for a pass**: the entries it brought back are sent
  without waiting for another trigger, a dead session included — requeueing `authRequired` is
  saying the session is back.
- `discardQuarantined(entryId, localId)` destroys one entry. The second argument is the entry's own
  `localId`, a value the caller only knows by having listed the entry: nothing is discarded unseen.
  The entity's local copy then goes back to the server's truth — removed if the server never had
  it, otherwise replaced at the next pull.
- `GeoLeaf.Storage.DB.listPendingEdits()` lists every entry still owed or set aside, oldest first,
  with its `state` — `"quarantined"` for these, which also carry `quarantine`, the motive, and
  `quarantineStatus`, the HTTP status of the refusal when a server answer caused it.
  `getSyncStatus().quarantined` counts them.

```ts
const storage = GeoLeaf?.Storage;
const listed = (await storage?.DB?.listPendingEdits?.()) ?? [];
for (const entry of listed.filter((e) => e.state === "quarantined")) {
    // Shown to the operator first — the localId is the proof it was seen.
    await storage?.discardQuarantined?.(entry.entryId, entry.localId);
}
```

## Conflicts

An update or a delete carries the marker of the version it was made on, when the device holds
one (`offline.source.versionProperty`). When the server's row changed since, the write matches
nothing: the queue reads the row, keeps it, and sends the write again without the marker — **the
last write wins**, and it is the device's. The pass counts it in `conflicts`,
`geoleaf:offline:write-conflict` carries the row that was overwritten, and
`GeoLeaf.Storage.listConflicts(layerId?)` keeps it — one record per entity, the newer replacing
the older — until `clearConflicts(layerId?)`. A row that could not be read is overwritten all the
same, and the record's `readOutcome` says so. No other policy exists today.

## Pulling never erases a capture

`GeoLeaf.Storage.pullLayer(layerId, { bbox })` — or the download window of
`@geoleaf-plugins/offline-ui` — brings a layer declaring `offline.source` onto the device. It never
overwrites or removes an entity holding an edit the server has not accepted, set-aside edits
included, and it never makes a layer writable. What a pull asks of the server is §1 of the
[server contract](SERVER_CONTRACT.md).

A layer that is on the map when its pull ends is given what the device now holds — an entity
the server deleted leaves the map, an edited one is redrawn — without a reload, and
`geoleaf:layer:updated` announces it (since 3.15.0; a reload was needed before). The layer must
declare `offline.enabled`: one that is drawn from the network is not touched by a pull.

## Watching the queue

### The sync bar

The core mounts it at the top of the application when the engine is on —
`modules.offline.banner.enabled`, `true` by default; `false` mounts nothing and leaves the queue
unchanged. It shows the network state, how many edits are owed (`3 pending`, `Everything sent`),
how many are set aside (`2 blocked`), when the server last accepted an edit, a **Sync now** button
— offered when something is owed and the network is up — and a close button. It hides itself when
nothing is owed, nothing is set aside and the network is up; closed, it comes back if the
situation gets worse.

### The pending mark on the map

An entity holding an edit the server has not accepted is drawn with an orange stroke: around a
point, along a line, around a polygon. It is set as the edit is queued — when the entity reaches
its layer — and removed when the server accepts it; it survives a reload and a pull. Since
3.15.0: before, the mark appeared only after a reload, and only on points.

It is the `_syncStatus: "pending"` property of the layer's copy of the entity
(`GeoLeaf.Layers.getFeatures(layerId)`), never written to the server. An application drawing
its own mark can read it; it should not set it — the write cycle owns it.

### Reading the state

| Member                            | Returns                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GeoLeaf.Storage.getSyncStatus()` | `{ online, owed, quarantined, lastSyncAt }` — `owed` counts the entries waiting, failed or on their way; `lastSyncAt` is the last time the server accepted one, or `null`                                                |
| `GeoLeaf.Storage.getSyncReport()` | one report per layer declaring a pull source                                                                                                                                                                             |
| `GeoLeaf.Storage.preflight()`     | "can I leave?" in one read — storage persistence and quota, the per-layer report, the queue, the last preparation and the write session — with a `verdict`: `ready`, `degraded` or `notReady`. `null` without the engine |

The write session is whatever `GeoLeaf.Sync.registerSessionReader(reader)` reports. The connector
registers a reader in `auth.endpoint` mode; a host that holds its own token can register its own.

### Events

Dispatched on `document`, and typed in `GeoLeafEventMap`:

| Event                               | When                                                                  | Payload                                                                                |
| ----------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `geoleaf:offline:outbox-queued`     | an edit entered the queue, was absorbed by an entry, or cancelled one | `layerId`, `localId`, `kind`, `queued`, `annulled`                                     |
| `geoleaf:offline:outbox-drained`    | a pass ended — every pass, the empty one included                     | `attempted`, `pushed`, `failed`, `deferred`, `conflicts`, `haltedBy`, `heldForSession` |
| `geoleaf:offline:quarantine-exited` | entries set aside left — requeued, or discarded on confirmation       | `exit`, `entries` (`layerId`, `localId` of each)                                       |
| `geoleaf:offline:write-conflict`    | a conflict was settled — once per conflict                            | the fields of a `listConflicts()` record                                               |
| `geoleaf:offline:pull-progress`     | one page of a pull landed                                             | `layerId`, `current`, `total`, `totalIsKnown`, `percentage`                            |

`outbox-drained` carries the numbers of the pass, not what is left: read `getSyncStatus()` for
that. Nothing is dispatched when an entry is set aside — the pass that set it aside says so in its
own `outbox-drained`. `quarantine-exited` is dispatched once per gesture, never for one that moved
nothing: a refusal, or a `requeueAll()` with nothing to bring back.

```ts
GeoLeaf?.Events?.on("geoleaf:offline:outbox-drained", (event) => {
    if (event.detail.haltedBy === "authRequired") {
        console.warn("The session is over: sign in again to send the queue.");
    } else if (event.detail.heldForSession > 0) {
        console.warn("A layer requires a session and none is open: its captures wait.");
    }
});
```

## Authentication

GeoLeaf adds no credentials of its own. With `@geoleaf-plugins/connector`, the queue's requests
carry `Authorization: Bearer <token>` when they go under the connector's `baseUrl` — same origin,
same path prefix: `write.endpoint` must sit under it. The connector has two modes, whose server
side is §3 of the [server contract](SERVER_CONTRACT.md) and whose setup is the
[connector guide](https://github.com/geoleaf/geoleaf-js/blob/main/packages/plugins/connector/docs/CONNECTOR_GUIDE.md):

- **`auth.endpoint`** — the connector signs in and renews the token itself. When the operator
  signs in again, or a token is renewed, it puts the entries set aside as `authRequired` back in
  the queue and runs a pass.
- **`getToken`** — the host provides the token, and the connector cannot see the session come
  back. Once the host holds a valid token again, it restarts the queue itself:

```ts
const storage = GeoLeaf?.Storage;
await storage?.requeueAll?.("authRequired");
```

The requeue asks for the pass itself; before 3.15.0 a `pushOutbox()` had to follow it.

### What a layer says of its own writes — `write.auth`

Absent, nothing changes: the request goes out, with the connector's token when it falls under
its `baseUrl`. Two values say more, since 3.15.0:

- **`"none"`** — the endpoint takes no credential. Every request of the write carries the
  declaration, and the connector attaches no token to it, even under its `baseUrl`. Use it for
  a public collection served by the same API as the authenticated ones: without it, the
  session's token was sent to an endpoint that never asked for it.
- **`"bearer"`** — the endpoint requires a session. While nobody is signed in, the capture is
  not sent without a token: it stays in the queue, untouched, and the pass counts it in
  `heldForSession` and goes on with the rest of the queue — a capture of a `"none"` layer
  behind it leaves. The automatic triggers keep running — a held capture costs no request —
  so it leaves on its own once the session is back. Meanwhile the sync strip
  says so: next to the count of writes owed, it reads "sign-in required" for as long as the
  last pass held one. It offers no sign-in of its own — that belongs to whoever holds the
  session. "No session" is what
  the session reader says (`GeoLeaf.Sync.registerSessionReader`): the connector registers one
  in `auth.endpoint` mode; in `getToken` mode the host registers its own, and without a reader
  the capture leaves as it always did.

A held capture is not an `authRequired` halt: the first says nothing was sent and the pass went
on, the second that a server answered 401, the capture was set aside and the pass stopped.
