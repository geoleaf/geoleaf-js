# @geoleaf-plugins/offline-ui — Overview

**Package:** `@geoleaf-plugins/offline-ui`  
**Version:** the one `npm view @geoleaf-plugins/offline-ui version` prints  
**License:** MIT  
**Registry:** `registry.npmjs.org` (public)

---

## Purpose

This plugin is the **interface** of GeoLeaf's offline capability. It draws a window, opened from
the map's toolbar, in which a user prepares a device before leaving the network and reads what
has not yet reached the server.

The capability itself — the browser database, the cache, the download of a profile, the pull of a
layer's entities, the write queue and its replay, the connectivity detection — lives in
`@geoleaf/core`, behind the `GeoLeaf.Storage` facade. This plugin calls that facade and stores
nothing of its own.

What the window holds:

- **The layer picker** — which layers and basemaps of the profile to take offline, with the size
  each is estimated to weigh, and the zone to download for vector basemaps (current view, the
  profile's declared extent, or the corridor of a saved route). A basemap whose origin is not
  declared for offline preparation is greyed, and says why.
- **The download** — start, follow, stop; then a notice that names what was left out, if anything.
- **The state of the write queue** — network, captures owed, captures set aside, last accepted
  synchronisation, and a button to send now.
- **The captures set aside** — one row per motive, with a retry where the core says a retry can
  work, and a confirmed discard.
- **"Can I leave?"** — the core's pre-departure check: storage persistence, each layer's offline
  state, what the preparation left out, the write session, and the verdict.
- **An Export tab** — the captures still held on the device, as a JSON file or to the clipboard.
- **« Export the log »** — the application's recent journal, as a JSON file.

And, outside the window:

- **« A new version is ready »** — a banner at the top of the page when an update of the
  application has been installed and waits (core ≥ 3.15.0). The core no longer replaces the
  running version under its user; the banner is where the user is asked. **Reload** applies the
  update and reloads the page; **Later** removes the banner and leaves the update waiting — it
  is offered again at the next visit, or by the next update.

It is designed for field work, mobile applications, and any place where connectivity comes and
goes.

---

## Architecture

```
src/
├── entry.ts       ← Entry point — registers the UI, the i18n and the toolbar
├── cache/         ← The window's body: layer picker, download, and the status blocks
├── sync/          ← The Export tab's synchronisation section
├── ui/            ← Cache button, mounted into a core toolbar slot, and the modal
├── core/          ← Seams to the core offline engine (availability, signals)
├── shared/        ← Plugin-side view of the `GeoLeaf.Storage` facade
├── lang/          ← i18n dictionaries, 6 locales
└── css/           ← Stylesheets of the modal and of each block
```

### Plugin registration

The plugin registers itself with `@geoleaf/core` when it is loaded:

```javascript
GeoLeaf.plugins.register("offline-ui", {
    version: "__GEOLEAF_VERSION__", // replaced with the package version at build
    optional: ["editor"],
    label: "Offline UI (cache button, layer selector, sync panel)",
    healthCheck: () => typeof GeoLeaf.Storage === "object",
});
```

It mounts **no namespace**: `GeoLeaf.Storage` exists without this plugin, and belongs to the core.

### Health check

The plugin is healthy as soon as the core's `GeoLeaf.Storage` facade is there. The offline engine
is deliberately **not** probed: it is opt-in, loaded on demand, and a profile that does not enable
it must not make this plugin read as broken.

---

## Prerequisites

- `@geoleaf/core` v3, declared as a **peer dependency** — install it yourself
- A profile that enables the capability: `modules.offline.enabled` **and** `modules.pwa.enabled`
  (see [CONFIGURATION.md](CONFIGURATION.md))
- A browser with IndexedDB and the Cache API

---

## Integration with @geoleaf/core

| What the plugin uses             | For                                                           |
| -------------------------------- | ------------------------------------------------------------- |
| `GeoLeaf.Storage`                | Everything the window reads and every gesture it makes        |
| `GeoLeaf.plugins`                | Registration                                                  |
| `GeoLeaf.I18n`                   | Its dictionaries, registered under the `offline-ui` namespace |
| The core's toolbar slots         | The button that opens the window                              |
| `GeoLeaf.Log.exportDiagnostic()` | « Export the log »                                            |
| `GeoLeaf.PWA` (core ≥ 3.15.0)    | « A new version is ready »: the state, and the reload         |
| The core's notifications         | Every notice the window raises                                |

The plugin does **not** modify core modules, and deep-imports none of them: a deep import of the
core would be bundled as a copy, whose state nothing initialises.

---

## Key concepts

### Profile-based caching

Resources are organised by _profile_ (a GeoLeaf configuration profile). Each profile can be
cached, cleared, or checked on its own.

### Write queue (`outbox`)

The queue of edits made offline belongs to the core's offline engine, not to this plugin: what a
layer declares for it, how `GeoLeaf.Storage.applyEdit()` records an edit and the queue drains, and
what becomes of the entries set aside are the core's
[offline write cycle](../../../core/docs/OFFLINE_WRITE_CYCLE.md). This plugin shows the queue's
state in its window, and offers the two exits the core publishes for an entry set aside.

### Image lifecycle

The photos of a form belong to the editor plugin (`@geoleaf-plugins/editor`) and to the form
library it embeds; this plugin shows nothing of them. What becomes of one, in the core's store:

1. The form validates the file (type, size) and compresses it when it is over the field's limit.
2. A photo that cannot be uploaded at once is kept in the browser database, flagged _not
   uploaded_ (`GeoLeaf.Storage.DB.storeImageLocally`) — as a **Blob**, or as its bytes where the
   browser refuses to store one and the caller asked for them (`acceptBytes`, core ≥ 3.15.0;
   the editor does). The feature's attribute holds an opaque token,
   not the bytes: a photo never travels inside the feature's own write.
3. The editor retries what is pending (`getPendingImages`), uploads it to the endpoint the field
   declares, and flags it uploaded with the URL the server gave it
   (`updateImageUploadStatus(id, { uploaded: true, url })`).
4. Uploaded copies are then purged (`cleanUploadedImages`).

---

## See also

- [INSTALLATION.md](INSTALLATION.md) — Prerequisites and setup
- [CONFIGURATION.md](CONFIGURATION.md) — Profile keys
- [API_REFERENCE.md](API_REFERENCE.md) — What the window calls, and the events it follows
- [EXAMPLES.md](EXAMPLES.md) — Practical recipes
