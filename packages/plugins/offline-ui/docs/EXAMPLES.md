# @geoleaf-plugins/offline-ui — Examples

**Package:** `@geoleaf-plugins/offline-ui`

Every recipe below calls **`GeoLeaf.Storage`**, which is the core's facade: this plugin is the
window that draws it, and has no API of its own (see [API_REFERENCE.md](API_REFERENCE.md)). They
are what the window does, written out — for an integrator who wants the same thing elsewhere in
the page.

The facade's members are optional in the types, because it is inert until the offline engine has
loaded: the recipes read them with `?.`.

---

## Table of contents

- [Load the plugin](#load-the-plugin)
- [Wait for the offline engine](#wait-for-the-offline-engine)
- [Download a profile for offline use](#download-a-profile-for-offline-use)
- [Follow a download](#follow-a-download)
- [Check what is cached](#check-what-is-cached)
- [Delete a profile's cache](#delete-a-profiles-cache)
- [Read the storage tallies](#read-the-storage-tallies)
- [Read the state of the write queue](#read-the-state-of-the-write-queue)
- [Act on the captures set aside](#act-on-the-captures-set-aside)
- [Ask whether a basemap can be prepared](#ask-whether-a-basemap-can-be-prepared)
- [Export the edits still owed to the server](#export-the-edits-still-owed-to-the-server)
- [Export the application's log](#export-the-applications-log)

---

## Load the plugin

```javascript
import "@geoleaf/core";
import "@geoleaf-plugins/offline-ui";

// Nothing to initialise: the core loads and starts the offline engine itself, when the
// profile enables it (modules.offline.enabled and modules.pwa.enabled).
GeoLeaf.boot({
    config: { data: { activeProfile: "my-app", profilesBasePath: "./profiles/" } },
});
```

---

## Wait for the offline engine

```javascript
if (GeoLeaf.Storage?.isAvailable?.()) {
    console.log("Offline engine ready");
} else {
    // ⚠️ Never resolves on a profile that does not enable the capability.
    await GeoLeaf.Storage?.whenReady?.();
}
```

---

## Download a profile for offline use

```javascript
const cache = GeoLeaf.Storage?.CacheManager;

// What it would weigh, and what the browser grants
const estimate = await cache?.estimateProfileSize("tourism");
const quota = await cache?.getStorageQuota();
console.log(`About ${estimate?.totalSizeFormatted}, ${quota?.usage} of ${quota?.quota} bytes used`);

const result = await cache?.cacheProfile("tourism");
console.log("Downloaded:", result);
```

`cacheProfile` has two phases: the profile's resources — configuration, icons, static GeoJSON,
tiles — then the **entities** of every selected layer that declares an `offline.source`.

---

## Follow a download

The events are dispatched on `document`:

```javascript
document.addEventListener("geoleaf:cache:progress", (event) => {
    const { current, total, percentage } = event.detail;
    console.log(`${current} / ${total} resources (${percentage} %)`);
});

document.addEventListener("geoleaf:offline:pull-progress", (event) => {
    const { layerId, current, total, totalIsKnown } = event.detail;
    // `total` is a running count, not a whole, when the source did not say how many there are.
    console.log(layerId, current, totalIsKnown ? `of ${total}` : "so far");
});

document.addEventListener("geoleaf:cache:completed", (event) => {
    console.log("Download finished for", event.detail.profileId);
});
```

To stop one: `GeoLeaf.Storage?.CacheManager?.cancelDownload()`. The window then reads
`geoleaf:cache:cancelled`.

---

## Check what is cached

```javascript
const cache = GeoLeaf.Storage?.CacheManager;

if (await cache?.isProfileCached("tourism")) {
    console.log("Profile is available offline");
}

console.log("Cached profiles:", await cache?.listCachedProfiles());
```

---

## Delete a profile's cache

```javascript
const removed = await GeoLeaf.Storage?.CacheManager?.clearProfile("tourism");
console.log(`Removed ${removed} cached resources`);
```

It removes what can be downloaded again. It does not touch the write queue: captures still owed
to the server stay.

---

## Read the storage tallies

```javascript
const stats = await GeoLeaf.Storage?.getStats?.();

console.log(`Storage used: ${stats?.storage.percentage.toFixed(1)} %`);
console.log(`Layers cached: ${stats?.layers.count}`);
console.log(`Entities held locally: ${stats?.features.count}`);
console.log(`Writes still owed to the server: ${stats?.outbox.count}`);
console.log(`Currently online: ${stats?.online}`);
```

---

## Read the state of the write queue

The four facts the window shows at its top, in one read:

```javascript
const status = await GeoLeaf.Storage?.getSyncStatus?.();
if (status) {
    const { online, owed, quarantined, lastSyncAt } = status;
    console.log({ online, owed, quarantined, lastSyncAt });
}
```

`owed` and `quarantined` are disjoint: a capture set aside is blocked, not owed. Recording an
edit and draining the queue are the core's, with their own examples — see the
[offline write cycle](../../../core/docs/OFFLINE_WRITE_CYCLE.md). The core already drains the queue
when the network comes back.

---

## Act on the captures set aside

What the window's rows do — list by motive, retry where a retry can work, discard on
confirmation:

```javascript
const storage = GeoLeaf.Storage;
const listed = (await storage?.DB?.listPendingEdits?.()) ?? [];
const aside = listed.filter((entry) => entry.state === "quarantined");

// Which motives a retry can lift is the core's answer, not a list to copy here.
const liftable = storage?.requeueableReasons?.() ?? [];

for (const motive of new Set(aside.map((entry) => entry.quarantine))) {
    if (motive && liftable.includes(motive)) {
        const out = await storage?.requeueAll?.(motive);
        console.log(motive, "→ requeued:", out?.requeued, "left aside:", out?.skipped);
    }
}

// A discard destroys work: confirm it first. It takes the `localId` AS LISTED.
const refused = aside.find((entry) => entry.quarantine === "rejectedByServer");
if (refused && window.confirm("This capture will never be sent. Discard it?")) {
    await storage?.discardQuarantined?.(refused.entryId, refused.localId);
}
```

---

## Ask whether a basemap can be prepared

The offline preparation downloads ahead of use only from an origin declared for it
(`modules.offline.dataOrigins`). The window greys the row of a basemap that will be refused;
this is the question it asks (core ≥ 3.15.0):

```javascript
const verdict = GeoLeaf.Storage?.prefetchVerdict?.("https://{s}.tiles.example.com/{z}/{x}/{y}.png");
if (verdict && !verdict.allowed) {
    console.warn(`Not prepared: ${verdict.origin} (${verdict.reason})`);
}
```

---

## Export the edits still owed to the server

What survives an origin purge is a file written out of the browser:

```javascript
const pending = (await GeoLeaf.Storage?.DB?.listPendingEdits?.()) ?? [];

const blob = new Blob([JSON.stringify(pending, null, 2)], { type: "application/json" });
const url = URL.createObjectURL(blob);
console.log(`${pending.length} edit(s) exported to ${url}`);
```

---

## Export the application's log

What the window's last button downloads — the core's bounded, redacted journal, as JSON:

```javascript
const report = GeoLeaf.Log.exportDiagnostic();
const url = URL.createObjectURL(new Blob([report], { type: "application/json" }));
console.log("Log ready at", url);
```

---

## See also

- [OVERVIEW.md](OVERVIEW.md) — What the plugin is, and is not
- [INSTALLATION.md](INSTALLATION.md) — Prerequisites and setup
- [API_REFERENCE.md](API_REFERENCE.md) — What the window calls, and the events it follows
