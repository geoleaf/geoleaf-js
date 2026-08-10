/**
 * Mock IndexedDB for plugin-storage tests (Sprint 4)
 * In-memory store for getPreference/setPreference, metadata (manifest), init, cacheLayer, clearProfile
 */
const store = new Map();
const metadataStore = new Map();

function makeRequest(callback) {
    const req = {};
    setTimeout(() => {
        try {
            callback(req);
            if (req.onsuccess) req.onsuccess();
        } catch (e) {
            req.error = e;
            if (req.onerror) req.onerror();
        }
    }, 0);
    return req;
}

const IndexedDB = {
    _db: {
        transaction(storeNames, mode) {
            const readOnly = mode === "readonly";
            return {
                objectStore(name) {
                    if (name === "metadata") {
                        return {
                            put(item) {
                                return makeRequest(() => {
                                    metadataStore.set(item.key, {
                                        key: item.key,
                                        value: item.value,
                                        timestamp: item.timestamp,
                                    });
                                });
                            },
                            get(key) {
                                return makeRequest((req) => {
                                    req.result = metadataStore.get(key) || null;
                                });
                            },
                            delete(key) {
                                return makeRequest(() => {
                                    metadataStore.delete(key);
                                });
                            },
                            getAllKeys() {
                                return makeRequest((req) => {
                                    req.result = Array.from(metadataStore.keys());
                                });
                            },
                        };
                    }
                    return {};
                },
            };
        },
    },

    async init() {
        return Promise.resolve(this._db);
    },

    async getPreference(key, defaultValue = null) {
        return store.has(key) ? store.get(key) : defaultValue;
    },

    async setPreference(key, value) {
        store.set(key, value);
    },

    async cacheLayer(id, data, profileId, metadata = {}) {
        return Promise.resolve();
    },

    async clearProfile(profileId) {
        const prefix = `cache_layer_selection_${profileId}`;
        let deleted = 0;
        for (const k of store.keys()) {
            if (k.startsWith(prefix) || k === profileId) {
                store.delete(k);
                deleted++;
            }
        }
        const manifestKey = `cache_manifest_${profileId}`;
        if (metadataStore.has(manifestKey)) {
            metadataStore.delete(manifestKey);
            deleted++;
        }
        return deleted;
    },

    async getLayer() {
        return null;
    },

    async removeLayer() {
        return Promise.resolve();
    },
};

function clearMockStore() {
    store.clear();
    metadataStore.clear();
}

export { IndexedDB, clearMockStore };
