# @geoleaf-plugins/offline-ui — Examples

**Package:** `@geoleaf-plugins/offline-ui`  
**Version:** 2.0.0

---

## Table of contents

- [Initialisation](#initialisation)
- [Check storage availability](#check-storage-availability)
- [Cache a profile for offline use](#cache-a-profile-for-offline-use)
- [Monitor download progress](#monitor-download-progress)
- [Check cache status](#check-cache-status)
- [Clear a cached profile](#clear-a-cached-profile)
- [Read storage statistics](#read-storage-statistics)
- [Edits made offline](#edits-made-offline)
- [Store an image locally (offline)](#store-an-image-locally-offline)
- [Export the edits still owed to the server](#export-the-edits-still-owed-to-the-server)

---

## Initialisation

```javascript
import "@geoleaf-plugins/offline-ui";

// Initialise after GeoLeaf Core
await GeoLeaf.init({
    map: { target: "map" },
    data: { activeProfile: "my-app", profilesBasePath: "./profiles/" },
});
GeoLeaf.boot();

const ok = await GeoLeaf.Storage.init({
    indexedDB: { name: "my-app-db", version: 1 },
    enableOfflineDetector: true,
});

if (!ok) {
    console.error("Storage plugin failed to initialise");
}
```

---

## Check storage availability

```javascript
if (!GeoLeaf.Storage.isAvailable()) {
    console.warn("Storage not available — IndexedDB or Cache API may be blocked");
    // Show a user-friendly message
}
```

---

## Cache a profile for offline use

Download all resources (tiles, GeoJSON, images) for a GeoLeaf profile:

```javascript
const cm = GeoLeaf.Storage.CacheManager;

// Check estimate before downloading
const estimate = await cm.estimateProfileSize("tourism-profile");
console.log(`Estimated size: ${estimate.totalSizeFormatted}`);

// Check quota
const quota = await cm.getStorageQuota();
console.log(`Available storage: ${quota.available} bytes`);

// Download
await cm.cacheProfile("tourism-profile");
console.log("Profile cached successfully");
```

---

## Monitor download progress

Listen for progress events during profile caching:

```javascript
// The CacheButton UI control shows progress automatically.
// For custom progress tracking, listen to the window event:
window.addEventListener("geoleaf:cache:progress", (event) => {
    const { profileId, downloaded, total, percentage } = event.detail;
    document.getElementById("progress-bar").style.width = `${percentage}%`;
    document.getElementById("progress-text").textContent =
        `${downloaded} / ${total} resources (${percentage}%)`;
});

await GeoLeaf.Storage.CacheManager.cacheProfile("tourism-profile");
```

---

## Check cache status

```javascript
const cm = GeoLeaf.Storage.CacheManager;

const isCached = await cm.isProfileCached("tourism-profile");
if (isCached) {
    console.log("Profile is available offline");
} else {
    console.log("Profile not cached — download required for offline use");
}

// List all cached profiles
const cached = await cm.listCachedProfiles();
console.log("Cached profiles:", cached);
```

---

## Clear a cached profile

```javascript
const removedCount = await GeoLeaf.Storage.CacheManager.clearProfile("tourism-profile");
console.log(`Removed ${removedCount} cached resources`);
```

---

## Read storage statistics

```javascript
const stats = await GeoLeaf.Storage.getStats();

console.log(`Storage used: ${stats.storage.percentage.toFixed(1)}%`);
console.log(`Layers cached: ${stats.layers.count}`);
console.log(`Entities cached locally: ${stats.features.count}`);
console.log(`Edits still owed to the server: ${stats.outbox.count}`);
console.log(`Currently online: ${stats.online}`);
```

---

## Edits made offline

Recording an edit, draining the queue and releasing the entries set aside are the core's, with
its own examples: see the [offline write cycle](../../../core/docs/OFFLINE_WRITE_CYCLE.md). The core already drains the queue when
the network comes back.

---

## Store an image locally (offline)

```javascript
const db = GeoLeaf.Storage.DB;

// Store image when offline
const localId = await db.Images.storeImage({
    id: crypto.randomUUID(),
    poiId: "poi-456",
    layerId: "biodiversity-layer",
    fileName: "photo.jpg",
    mimeType: "image/jpeg",
    size: file.size,
    base64Data: await fileToBase64(file),
    timestamp: Date.now(),
    status: "pending",
});

// Retrieve when online for upload
const images = await db.Images.getImagesByPoi("poi-456");
for (const img of images) {
    if (img.status === "pending") {
        // Upload img.base64Data to server
        await db.Images.updateImageStatus(img.id, { status: "synced" });
    }
}

function fileToBase64(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });
}
```

---

## Export the edits still owed to the server

The backup chain (`db.Backups`) was **removed in 4.11**: it had no producer left, and it lived
in the very database an origin purge destroys — so it never protected against the case it was
written for. What does survive a purge is a file written out of the browser.

```javascript
const pending = await GeoLeaf.Storage.DB.listPendingEdits();

const blob = new Blob([JSON.stringify(pending, null, 2)], { type: "application/json" });
const url = URL.createObjectURL(blob);
console.log(`${pending.length} edit(s) exported to ${url}`);
```

---

## See also

- [OVERVIEW.md](OVERVIEW.md) — Plugin architecture and key concepts
- [INSTALLATION.md](INSTALLATION.md) — Authentication and npm setup
- [API_REFERENCE.md](API_REFERENCE.md) — Full public API
