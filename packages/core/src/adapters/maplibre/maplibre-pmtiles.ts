/*!
 * GeoLeaf Core – MapLibre adapter / PMTiles protocol bridge
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Registers the `pmtiles://` protocol on MapLibre — so the URLs this repository already
 * recognises stop being doors onto a missing corridor.
 *
 * ## The defect this closes
 *
 * Three in-core sites recognised `pmtiles://` (the basemap type resolver, the tile-list
 * provider) and the connector recognised the `.pmtiles` extension — while NOTHING ever called
 * `maplibregl.addProtocol`. A valid profile, code that recognises it, and no map: MapLibre
 * received a scheme it had no handler for and the layer silently stayed empty. The npm
 * manifest even advertises the keyword, so the promise was public while the corridor was not.
 *
 * ## Why the library loads LAZILY behind an EAGER registration
 *
 * `addProtocol` itself is a two-line synchronous call — registering at adapter init costs
 * nothing measurable. The pmtiles library is another matter: bundling it eagerly would tax
 * the boot closure of every profile, including the overwhelming majority that never reference
 * a PMTiles archive. So the handler registered here defers the `import("pmtiles")` to the
 * FIRST `pmtiles://` tile request: profiles without PMTiles pay zero bytes, profiles with it
 * pay once, at the moment the data is actually asked for.
 *
 * The `Protocol` instance is created once and shared — it caches one `PMTiles` reader per
 * archive URL, and re-instantiating it per tile would re-fetch each archive's header on every
 * request, which is the whole cost the format exists to avoid.
 *
 * ## What this deliberately does NOT do
 *
 * No URL rewriting, no validation of the archive, no fetch interception: the connector's
 * format detector already delegates `pmtiles`/`mvt` to the MapLibre bridge
 * (`fetch-interceptor.ts`), and that delegation is exactly what this registration completes.
 */

/** Module guard — MapLibre keeps the last handler registered for a scheme; one is enough. */
let _registered = false;

/** The handler shape MapLibre expects — derived from `addProtocol` itself, never re-declared. */
type ProtocolHandler = Parameters<typeof maplibregl.addProtocol>[1];

/** Memoised delegate: the pmtiles module is imported once, on the first tile request. */
let _delegate: Promise<ProtocolHandler> | null = null;

/**
 * Registers the `pmtiles://` protocol handler on the MapLibre global. Idempotent.
 *
 * Called at adapter init, BEFORE the map is created: MapLibre resolves protocols at source
 * load, and a source declared in the initial style would race a later registration.
 *
 * Degrades to a no-op when the MapLibre global is absent (unit tests, SSR probes) — the
 * protocol is meaningless without the engine, and throwing here would make every test that
 * touches the adapter carry a MapLibre stub for a feature it does not exercise.
 */
export function registerPmtilesProtocol(): void {
    if (_registered) return;
    if (typeof maplibregl === "undefined" || typeof maplibregl.addProtocol !== "function") return;
    _registered = true;

    maplibregl.addProtocol("pmtiles", (params, controller) => {
        _delegate ??= import("pmtiles").then((m) => {
            const protocol = new m.Protocol();
            return protocol.tile.bind(protocol);
        });
        return _delegate.then((tile) => tile(params, controller));
    });
}

/** Test seam — resets the module guards so a suite can observe a fresh registration. */
export function _resetPmtilesProtocolForTests(): void {
    _registered = false;
    _delegate = null;
}
