/**
 * Centralized MapLibre GL JS mock for GeoLeaf-JS tests.
 *
 * Single source of truth for all `maplibregl.*` mocks.
 * Covers the full surface used by MaplibreAdapter (652 lines),
 * maplibre-poi-builders (332 lines), maplibre-primitives (165 lines),
 * and all MapLibre-dependent test files.
 *
 * ── Structure ────────────────────────────────────────────────────────
 * Mirrors `leaflet.js` mock: factory pattern with exported helpers.
 * Uses `vi.fn()` throughout (shimmed to `jest.fn()` in setup.js).
 * ─────────────────────────────────────────────────────────────────────
 *
 * ## 🛑 WHAT THIS MOCK CANNOT GUARD — read before relying on it
 *
 * This file describes the API's shape as GeoLeaf calls it, NOT the engine.
 * It thus stays GREEN on any change of MapLibre behaviour, semantics or
 * distribution format — and three of the boot net's four tiers go through
 * it (`bundle-boot-contract`, `api-controller-getter`, `boot-golden-master`).
 *
 * Measured at the MapLibre 6 migration (08/08/2026): the unit suite stayed
 * entirely green while the distribution went ESM-only, the `maplibregl`
 * global ceased to exist and the service worker's pre-cache lost three
 * modules out of four. None of these defects is describable here, and
 * wanting to "make the mock more faithful" would not do it: a richer mock
 * is still a mock.
 *
 * The only tier that sees the real engine is
 * `scripts/probe-boot-contract.mjs` (it says so itself at the top), along
 * with the E2E suite. **Never conclude that a version bump passes on the
 * sole faith of `npm test`.**
 */

/* eslint-disable max-lines-per-function, max-lines */

// ── Factory: mock map instance ──────────────────────────────────────────────

function createMockMap() {
    const _eventHandlers = {};
    const _sources = {};
    const _layers = {};
    const _controls = [];
    const _images = {};
    /** The map's one and only canvas — see `getCanvas` below for why it must be stable. */
    const _canvas = { style: { cursor: "" } };

    const map = {
        // View / Navigation
        jumpTo: vi.fn().mockReturnThis(),
        easeTo: vi.fn().mockReturnThis(),
        flyTo: vi.fn().mockReturnThis(),
        fitBounds: vi.fn().mockReturnThis(),
        getCenter: vi.fn(() => ({ lat: 45, lng: -73 })),
        getZoom: vi.fn(() => 12),
        getBounds: vi.fn(() => createMockLngLatBounds()),
        resize: vi.fn().mockReturnThis(),
        setStyle: vi.fn().mockReturnThis(),

        // Sources
        addSource: vi.fn((id, config) => {
            _sources[id] = {
                id,
                ...config,
                setData: vi.fn(),
                getClusterExpansionZoom: vi.fn().mockResolvedValue(15),
            };
        }),
        removeSource: vi.fn((id) => {
            delete _sources[id];
        }),
        getSource: vi.fn((id) => _sources[id] || null),

        // Layers
        addLayer: vi.fn((layerDef, beforeId) => {
            _layers[layerDef.id] = layerDef;
        }),
        removeLayer: vi.fn((id) => {
            delete _layers[id];
        }),
        getLayer: vi.fn((id) => _layers[id] || null),
        setFilter: vi.fn(),
        setLayoutProperty: vi.fn(),
        setPaintProperty: vi.fn(),
        moveLayer: vi.fn(),

        // Events
        on: vi.fn((event, layerOrHandler, handler) => {
            // Support both map.on(event, handler) and map.on(event, layer, handler)
            const key = handler ? `${event}:${layerOrHandler}` : event;
            const fn = handler || layerOrHandler;
            if (!_eventHandlers[key]) _eventHandlers[key] = [];
            _eventHandlers[key].push(fn);
            return map;
        }),
        off: vi.fn((event, layerOrHandler, handler) => {
            const key = handler ? `${event}:${layerOrHandler}` : event;
            const fn = handler || layerOrHandler;
            if (_eventHandlers[key]) {
                _eventHandlers[key] = _eventHandlers[key].filter((h) => h !== fn);
            }
            return map;
        }),
        once: vi.fn((event, handler) => {
            const onceHandler = (...args) => {
                handler(...args);
                map.off(event, onceHandler);
            };
            map.on(event, onceHandler);
            return map;
        }),
        fire: vi.fn((event, data) => {
            const handlers = _eventHandlers[event];
            if (handlers) {
                for (const h of handlers) h(data || {});
            }
            return map;
        }),

        // Controls
        addControl: vi.fn((control, position) => {
            _controls.push({ control, position });
            if (typeof control.onAdd === "function") {
                control.onAdd(map);
            }
            return map;
        }),
        removeControl: vi.fn((control) => {
            const idx = _controls.findIndex((c) => c.control === control);
            if (idx >= 0) _controls.splice(idx, 1);
            if (typeof control.onRemove === "function") {
                control.onRemove(map);
            }
            return map;
        }),

        // Projection
        project: vi.fn((lngLat) => ({ x: 100, y: 200 })),
        unproject: vi.fn((point) => ({ lat: 45, lng: -73 })),

        // Container
        getContainer: vi.fn(() => document.createElement("div")),
        // ⚠️ STABLE, like the real one. This used to build a fresh object on every call, which
        // made the whole "someone overwrote the cursor" class of defects structurally
        // invisible: each reader saw its own pristine object, so no test could ever observe a
        // clobber. `getCanvas()` returns the same canvas for a map's whole lifetime.
        getCanvas: vi.fn(() => _canvas),

        // Images (sprite icons)
        addImage: vi.fn((name, image) => {
            _images[name] = image;
        }),
        removeImage: vi.fn((name) => {
            delete _images[name];
        }),
        hasImage: vi.fn((name) => name in _images),
        // Public enumeration API. The adapter used to read the engine-private
        // `map.style._images`; it now goes through this, so the mock must carry it.
        listImages: vi.fn(() => Object.keys(_images)),

        // Lifecycle
        remove: vi.fn(),
        loaded: vi.fn(() => true),
        isStyleLoaded: vi.fn(() => true),

        // ── Test helpers (not part of MapLibre API) ──────────────────────
        __eventHandlers: _eventHandlers,
        __sources: _sources,
        __layers: _layers,
        __controls: _controls,
        __images: _images,
    };

    return map;
}

// ── Factory: mock Marker ────────────────────────────────────────────────────

function createMockMarker() {
    let _lngLat = { lng: -73, lat: 45 };
    let _popup = null;
    const _element = document.createElement("div");

    const marker = {
        setLngLat: vi.fn((ll) => {
            _lngLat = ll;
            return marker;
        }),
        getLngLat: vi.fn(() => _lngLat),
        addTo: vi.fn().mockReturnThis(),
        remove: vi.fn().mockReturnThis(),
        getElement: vi.fn(() => _element),
        setPopup: vi.fn((p) => {
            _popup = p;
            return marker;
        }),
        getPopup: vi.fn(() => _popup),
        setDraggable: vi.fn().mockReturnThis(),
        isDraggable: vi.fn(() => false),
        on: vi.fn().mockReturnThis(),
        off: vi.fn().mockReturnThis(),
    };

    return marker;
}

// ── Factory: mock Popup ─────────────────────────────────────────────────────

function createMockPopup() {
    let _html = "";
    let _lngLat = { lng: -73, lat: 45 };
    let _open = false;
    const _element = document.createElement("div");
    const _eventHandlers = {};

    const popup = {
        setHTML: vi.fn((html) => {
            _html = html;
            return popup;
        }),
        setDOMContent: vi.fn((el) => {
            return popup;
        }),
        setLngLat: vi.fn((ll) => {
            _lngLat = ll;
            return popup;
        }),
        getLngLat: vi.fn(() => _lngLat),
        addTo: vi.fn((map) => {
            _open = true;
            return popup;
        }),
        remove: vi.fn(() => {
            _open = false;
            // Trigger 'close' event handlers
            if (_eventHandlers["close"]) {
                for (const h of _eventHandlers["close"]) h();
            }
            return popup;
        }),
        on: vi.fn((event, handler) => {
            if (!_eventHandlers[event]) _eventHandlers[event] = [];
            _eventHandlers[event].push(handler);
            return popup;
        }),
        once: vi.fn((event, handler) => {
            if (!_eventHandlers[event]) _eventHandlers[event] = [];
            _eventHandlers[event].push(handler);
            return popup;
        }),
        off: vi.fn((event, handler) => {
            if (_eventHandlers[event]) {
                _eventHandlers[event] = _eventHandlers[event].filter((h) => h !== handler);
            }
            return popup;
        }),
        isOpen: vi.fn(() => _open),
        getElement: vi.fn(() => _element),

        // ── Test helpers ──
        __eventHandlers: _eventHandlers,
    };

    return popup;
}

// ── Factory: mock LngLatBounds ──────────────────────────────────────────────

function createMockLngLatBounds(sw, ne) {
    const _sw = sw || { lng: -74, lat: 44 };
    const _ne = ne || { lng: -72, lat: 46 };

    return {
        getSouthWest: vi.fn(() => _sw),
        getNorthEast: vi.fn(() => _ne),
        getCenter: vi.fn(() => ({
            lng: (_sw.lng + _ne.lng) / 2,
            lat: (_sw.lat + _ne.lat) / 2,
        })),
        extend: vi.fn().mockReturnThis(),
        contains: vi.fn(() => true),
        toArray: vi.fn(() => [
            [_sw.lng, _sw.lat],
            [_ne.lng, _ne.lat],
        ]),
    };
}

// ── The maplibregl namespace ────────────────────────────────────────────────

const maplibregl = {
    // Core constructors
    Map: vi.fn(createMockMap),

    Marker: vi.fn((opts) => {
        const marker = createMockMarker();
        if (opts?.element) {
            marker.getElement = vi.fn(() => opts.element);
        }
        return marker;
    }),

    Popup: vi.fn(createMockPopup),

    // Navigation controls
    NavigationControl: vi.fn(() => ({
        onAdd: vi.fn(() => document.createElement("div")),
        onRemove: vi.fn(),
    })),

    ScaleControl: vi.fn(() => ({
        onAdd: vi.fn(() => document.createElement("div")),
        onRemove: vi.fn(),
    })),

    AttributionControl: vi.fn(() => ({
        onAdd: vi.fn(() => document.createElement("div")),
        onRemove: vi.fn(),
    })),

    FullscreenControl: vi.fn(() => ({
        onAdd: vi.fn(() => document.createElement("div")),
        onRemove: vi.fn(),
    })),

    GeolocateControl: vi.fn(() => ({
        onAdd: vi.fn(() => document.createElement("div")),
        onRemove: vi.fn(),
        trigger: vi.fn(),
    })),

    // Geometry utilities
    LngLat: vi.fn((lng, lat) => ({ lng, lat })),

    LngLatBounds: vi.fn((sw, ne) => createMockLngLatBounds(sw, ne)),

    // Expose factories for tests that need fresh instances
    __createMockMap: createMockMap,
    __createMockMarker: createMockMarker,
    __createMockPopup: createMockPopup,
    __createMockLngLatBounds: createMockLngLatBounds,
};

module.exports = maplibregl;
