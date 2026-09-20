---
title: "Server contract — what GeoLeaf requires from a data server"
---

# Server contract — what GeoLeaf requires from a data server

**Applies to:** `@geoleaf/core` v3.x · `@geoleaf-plugins/connector`

::: info
**This page is for whoever runs the server.** It says what GeoLeaf sends and how it reads each
answer, for the three exchanges it has with a data server: **pulling** a layer for offline use,
**writing** the edits made offline, and **renewing** a session. It names no product: any server
that honours these rules works, and each section says how a server that does not will fail.
How to configure the client side is in the
[configuration guide](https://github.com/geoleaf/geoleaf-js/blob/main/docs/reference/GEOLEAF-JS_GUIDE_CONFIGURATIONS_COMPLET.md)
and the
[connector guide](https://github.com/geoleaf/geoleaf-js/blob/main/packages/plugins/connector/docs/CONNECTOR_GUIDE.md);
the contract of the offline capability itself is its
[specification](https://github.com/geoleaf/geoleaf-js/blob/main/docs/specs/capacites/offline.md).
:::

---

## 1. Pull — reading a layer for offline use

A layer declaring `offline.source` is pulled into the device's local store: by the download window
of `@geoleaf-plugins/offline-ui`, or by `GeoLeaf.Storage.pullLayer(layerId, { bbox })`.

### 1.1 The imposed base — OGC API Features, Part 1

| What             | GeoLeaf sends or reads                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request          | `GET {url}/collections/{collectionId}/items?f=json&limit=1000` — `collectionId` defaults to the layer id; a `url` already ending in `/items` is used as it is                                         |
| Extent           | `bbox=west,south,east,north` (WGS 84) when the pull has one: the zone chosen in the download window, or the caller's `bbox`. The server returns the features whose geometry intersects it             |
| Answer           | a GeoJSON `FeatureCollection` — `type: "FeatureCollection"` and a `features` array; anything else fails the pull                                                                                      |
| Pagination       | the `links` entry with `rel: "next"`, an absolute `http(s)` URL, followed until it is absent. It must carry the query of the first request (`bbox`, `datetime`, `limit`): GeoLeaf does not rebuild it |
| Total            | `numberMatched`, when served — for the progress bar and the "N out of M" notice; never required                                                                                                       |
| Identity         | `id` on the feature, or `properties.id`. A feature with neither is not stored, and is counted in the report's `skipped`                                                                               |
| Client identity  | `properties.local_id`, when the server stores the one GeoLeaf sent with a write (§2). It lets a later pull find the record it already holds instead of creating a second one                          |
| Freshness marker | the property named by `offline.source.versionProperty` (default `updated_at`), kept per entity. It is what the write filter compares (§2.1) and what a second pull reads (§1.2)                       |
| Geometry         | GeoJSON; a WKT string is converted                                                                                                                                                                    |

GeoLeaf stops at `offline.maxFeatures` entities. The answer is then a subset, and the pull says so
(`capped: true`; a complete pull also shows a notice naming the layer) — and removes nothing
(§1.2).

A pull that is interrupted does not resume from a cursor: the next one starts again from the first
page. An offset-based `next` link does not survive rows inserted between two runs, and writing by
identity is what makes starting again cheap.

### 1.2 What a complete pull does

A pull is **complete** when it was neither cut by `maxFeatures`, nor aborted, nor failed. Every pull,
complete or not, **rewrites only what changed**: an entity served under the freshness marker the
device already holds is left as it is (`unchanged`). An entity served without its marker is always
rewritten — nothing says it did not change.

A complete pull then **removes from the device** the synchronised entities it did not return
(`removed`). Its answer is the whole of what the source holds for the layer and the extent, so an
entity it did not name was deleted on the server — or moved out of the extent. With a `bbox`, the
last complete pull therefore defines the layer's content on the device: pulling another zone
replaces the previous one.

Two things are never removed: an entity carrying an edit not yet sent — the write queue meets the
deletion and sets the edit aside, see §2.4 — and a record without a server identity.

**What the server must guarantee for this to hold:** every modification of an entity, geometry
included, advances its freshness marker. A change that does not is not seen by the next pull.

### 1.3 Declared freshness and deletions — the delta

A layer whose server can serve **what changed since an instant, deletions included**, declares it:

```json
{
    "offline": {
        "enabled": true,
        "maxFeatures": 5000,
        "source": {
            "url": "https://example.tld/ogc",
            "versionProperty": "updated_at",
            "delta": { "freshness": "datetime", "deletedProperty": "deleted_at" }
        }
    }
}
```

Both keys are required together: a freshness filter alone never sees a deletion.

The first pull of such a layer is complete (§1.2). It records a **mark**: the greatest freshness
marker it was served, kept exactly as the server wrote it. The following pulls, for the same source
and the same extent, only send:

```
GET {url}/collections/{collectionId}/items?f=json&limit=1000&bbox=…&datetime=<mark>/..
```

— the `datetime` parameter of OGC API Features Part 1, as an interval open at its end and closed at
its start. A served entity whose `deletedProperty` is set (anything but absent, `null` or `false`)
is a **tombstone**: GeoLeaf never stores it, and removes its copy from the device — unless that
copy carries an edit not yet sent (§2.4). A delta removes nothing else: what it did not return
simply did not change.

**What the server must guarantee:**

1. **`datetime` filters on the freshness marker.** OGC API Features lets the server choose which
   temporal property `datetime` applies to: for this collection, it must be `versionProperty`.
2. **The marker is an RFC 3339 instant**, advanced by every modification — geometry included — and
   by every deletion: a tombstone carries the instant of the deletion.
3. **A row never becomes visible with a marker lower than one already served.** A server that
   stamps a row when its statement starts and commits it later can serve a newer row first: the
   mark then passes the older one, and that change is missed until the next complete pull.
4. **Tombstones are kept at least as long as a device may go without pulling.** A deletion whose
   tombstone was purged before a device pulled again is never learned by that device, until its
   next complete pull.

Two limits follow from the protocol, not from a server: an entity **moved out of the extent** is
not in a delta's answer — the `bbox` filters its new geometry — and stays on the device at its old
position until the next complete pull; and a delta that brings more changes than `maxFeatures` is a
cut one.

The mark is dropped, and the next pull is **complete** again, when:

- the device's local cache is purged;
- the zone or the source changes (`url`, `collectionId`, `versionProperty`, `bbox`);
- a delta is cut by `maxFeatures`;
- a served marker is not a readable instant.

::: warning
**No server of the GeoLeaf repository speaks the delta yet.** The mechanism is proven against a
source with state — in the unit suite and on the shipped bundle — and never against a real server.
:::

### 1.4 How a pull is authenticated

The pull uses the page's `fetch`. Behind `@geoleaf-plugins/connector`, a request whose URL lies under
the connector's `baseUrl` carries `Authorization: Bearer <token>` (§3); any other request carries
nothing. GeoLeaf sets no timeout on a pull page; a caller of `pullLayer` can stop it with an
`AbortSignal`.

---

## 2. Write — the offline queue

Every edit is written to the device first, then queued; the queue is sent when the network allows,
one entry at a time, in capture order. A layer's target is its `write` block:
`{ "enabled": true, "endpoint": "…", "dialect": "collection", "geometryProperty": "geom", "properties": [ … ] }`.

The `collection` dialect is the only one the queue sends. `rest` is spoken by the editor plugin's
online adapter only; a queued edit on a layer declaring it is set aside as `dialectNotSupported`.

### 2.1 Requests

| Operation | Request                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| create    | `POST {endpoint}`                                                            |
| update    | `PATCH {endpoint}?id=eq.<serverId>&<versionProperty>=eq.<marker>`            |
| delete    | `DELETE {endpoint}?id=eq.<serverId>&<versionProperty>=eq.<marker>` — no body |

- The marker filter is added when the edit carries the marker it was based on; values are
  URL-encoded (the `+` of a timezone offset included). An update or a delete of an entity that has
  no server identity yet sends nothing.
- Headers: `Content-Type: application/json` and `Prefer: return=representation`. GeoLeaf adds no
  authentication header of its own: behind the connector, `Authorization` is added to the requests
  under its `baseUrl`.
- Body of a create or an update — a flat object: the properties listed in `write.properties` (every
  property when the list is absent), the GeoJSON geometry object under `geometryProperty`, and
  `local_id`, the client identity.
- Each request is abandoned after 15 seconds.

### 2.2 How each answer is read

| Answer                                                   | Reading                                                                                                                                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2xx with the row — `[row]` or `row`                      | success. `row.id` becomes the server identity, and `row[<versionProperty>]` the new marker                                                                                                               |
| 2xx with `[]`, filtered update or delete                 | **conflict**: the row changed since the capture. GeoLeaf reads it (`GET {endpoint}?id=eq.<serverId>`), keeps that version locally, and sends the write again without the marker filter — the device wins |
| 2xx with `[]`, unfiltered update                         | the row no longer exists: set aside as `deletedOnServer`                                                                                                                                                 |
| 2xx with `[]`, unfiltered delete                         | success — the row is already gone                                                                                                                                                                        |
| 2xx without a readable array — `204`, an empty body      | success — but the entity's stored marker is cleared, so its next edit goes out unfiltered, and a create answered so gets no server identity                                                              |
| 409 on a create                                          | "already have it": GeoLeaf reads `GET {endpoint}?local_id=eq.<localId>&select=id`. A row: success, identity recorded. `[]`: refused (`rejectedByServer`). Unreadable: retried                            |
| 409 on an update or a delete                             | success                                                                                                                                                                                                  |
| 404 on an update or a delete                             | set aside as `deletedOnServer`                                                                                                                                                                           |
| 401                                                      | set aside as `authRequired`, and the queue stops until the session comes back (§3)                                                                                                                       |
| 501                                                      | set aside as `notImplementedByServer`                                                                                                                                                                    |
| 408, 429, 500, 502, 503, 504, a network error, a timeout | retried — three attempts, 30 s apart and then ×4, capped at 8 minutes, before being set aside                                                                                                            |
| 403, and any other 4xx                                   | set aside as `rejectedByServer`                                                                                                                                                                          |

An edit set aside is kept, never dropped: the device shows it, and an operator re-queues it — for
a motive whose cause can be lifted — or discards it after seeing it.

### 2.3 What the server must guarantee

- **`local_id` is unique.** A create replayed after a lost answer must get a `409`, not a second row.
- **`Prefer: return=representation` is honoured**, the row carrying `id` and the marker. A create
  answered without its row leaves the entity without a server identity: its later edits cannot be
  sent. An update answered without it leaves no marker, and the next edit goes out unfiltered.
- **A filtered update or delete that matches nothing answers 2xx with `[]`** — not `412`, not `404`.
  A `404` sets the edit aside as deleted, and a `409` on an update counts as a success.
- **The marker round-trips exactly**: the value served is the value compared by `eq.`; the server
  must not normalise it between the two.
- **The primary key is `id`, and `endpoint` carries no query string** — GeoLeaf appends its own.

### 2.4 An edit on an entity deleted on the server

The pull does not decide for a pending edit (§1.2). The queue meets the deletion — a `404`, or `[]`
to the unfiltered resend — and sets the edit aside as `deletedOnServer`: it is not replayed, since
replaying would recreate what the server deleted, and it stays visible until an operator discards it.

### 2.5 Photos

A photo field declaring `uploadEndpoint` sends the file on its own:

- `POST {uploadEndpoint}`, a multipart body with one part named `file`;
- the answer is a 2xx JSON object whose `url` — or `path` — is the address the file landed at;
- the budget is 30 seconds plus one second per 32 kB of file.

A photo taken off-network waits on the device and is sent before the queue is drained; its URL is
then written onto its entity as an edit. A failed upload keeps the file and tries again.

---

## 3. Session — authentication and renewal

Authentication is `@geoleaf-plugins/connector`'s: it adds `Authorization: Bearer <token>` to the
requests under its `baseUrl` — the page's `fetch`, and the requests MapLibre makes (tiles, glyphs,
sprites). It has two modes, and exactly one is configured.

### 3.1 `getToken` — the host provides the token

The page owns the session and hands the token over at each request. The server needs only to accept
`Authorization: Bearer <token>` and to answer `401` to a token it refuses. On a `401`, the connector
asks `getToken` once more and replays the request once; a `null` then emits
`geoleaf:connector:auth-error`.

### 3.2 `auth.endpoint` — a login route on the server

**Sign-in**, from the connector's login window:

```
POST {auth.endpoint}
Content-Type: application/json

{ "login": "…", "password": "…" }
```

A 2xx JSON answer carrying `token` and `expiresIn` — the lifetime **in seconds**, a number — signs
in. The token is opaque to GeoLeaf: it is never decoded. `401`, `404`, a `5xx`, any other non-2xx,
an unreadable body or a missing field each fail the sign-in with their own message.

**Renewal**, derived from the same endpoint — `/refresh` is appended to it as it is written, so
`…/auth/login` becomes `…/auth/login/refresh`:

```
POST {auth.endpoint}/refresh
Content-Type: application/json
Authorization: Bearer <current token>
```

No body. The token presented may already have expired: the server decides. The renewal is read as
one of three verdicts, and only a refusal ends a session:

| Verdict       | When                                                                                                                   | Effect                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `renewed`     | a 2xx whose JSON carries a non-empty `token` and a finite `expiresIn` greater than 0                                   | the new token is stored and used                                 |
| `unavailable` | no network; the 15-second budget spent, body included; a body cut in transit; `408`, `429`, `500`, `502`, `503`, `504` | the session is kept, and the renewal is tried again later        |
| `refused`     | any other non-2xx — `401`, `403`, `404`, `501`… — or a 2xx whose body cannot renew                                     | the session is erased, `geoleaf:connector:auth-error` is emitted |

There is no timer. When a request needs the token, the connector renews first if less than 30
seconds are left, and in the background if less than 5 minutes are. A `401` on a data request
triggers one renewal — shared with any already in flight — and one replay.

**A server without `/refresh`** answers it `404`: a refusal. Its sessions end 30 seconds before
`expiresIn` — the token is erased and `geoleaf:connector:auth-error` emitted, and with `auth.ui` the
login window opens again.

**Signing out** is local: the connector erases the token and emits `geoleaf:connector:signed-out`.
It calls no route, so a token that must stop working before its expiry has to be revoked by the
server itself.

The security posture of this exchange — HTTPS, where the token is kept, the three traps of common
identity providers — is in §7 of the [security guide](./SECURITY.md).

---

## 4. Transport

- **HTTPS.** The connector refuses a `baseUrl` that is not `https:`, except on `localhost` and
  `127.0.0.1`. The endpoints themselves are not checked, and must be served over HTTPS in
  production.
- **CORS.** A server on another origin than the application must allow it, and — for the writes
  and the authenticated requests — the `Authorization`, `Content-Type` and `Prefer` headers and the
  `PATCH` and `DELETE` methods, in its answer to the browser's preflight.
