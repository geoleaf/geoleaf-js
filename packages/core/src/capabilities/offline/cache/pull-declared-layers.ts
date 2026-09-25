/*!
 * GeoLeaf Core (offline capability) — Feature pull inside the deliberate download
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The half of the download button that fetched nothing.
 *
 * 🛑 **WHY THIS FILE EXISTS (R9, tâche 2.3).** The download button filled the `layers`
 * store — configuration files, icons, static GeoJSON blobs, tiles — and never touched
 * `features`, the store the loader reads when a layer declares `offline.enabled`. The
 * only writer of that store, `pull/layer-pull.ts`, had **no production caller at all**:
 * the facade relayed it, the E2E suite called it, and nothing in the application did.
 * A profile could therefore declare `offline.source`, a user could press Télécharger and
 * watch a progress bar to 100 %, and leave with the layer's entities never fetched —
 * then read a stale static blob in the field.
 *
 * 🛑 **AND THE INTERFACE COULD ALREADY DESTROY WHAT IT COULD NOT REBUILD.**
 * `offline-ui`'s "clear the local cache" purges `features`, justified in its own comment
 * by "every `synced` entity re-pulls via `pullLayer()`". That premise was false while no
 * UI path called it. This file is what makes it true.
 *
 * ## Why in the core and not in `offline-ui`
 *
 * The plugin is gated and **absent from `deploy-core`**, the variant that ships to a
 * client. The repository has already paid for that shape once: the only listener of the
 * eviction alert lived in this same plugin, so on `deploy-core` the alert went into the
 * void from the start (`kernel/storage/eviction-notice.ts` carries the account). The
 * plugin's own CDC says it plainly: it downloads nothing itself, it calls the core's cache
 * manager. So the download gains its missing half here, where every variant gets it, and
 * the plugin keeps giving surfaces.
 *
 * @version 1.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { profileLayers } from "../../../kernel/shared/index.js";
import { coreConfigGet } from "../config-seam.js";
import { pullLayer } from "../pull/layer-pull.js";

/** The two members of the saved download selection the pull reads. */
interface SelectionLike {
    /** Layers the user kept in the download selection; absent means "all of them". */
    layers?: unknown;
    /** The download zone drawn in the download window — `{ bounds: {north, south, east, west} }`. */
    vectorZone?: unknown;
}

/**
 * The download zone's extent as `[west, south, east, north]`, or `undefined`.
 *
 * 🛑 **THE ZONE WAS HALF-READ.** It is drawn in the download window, persisted in the saved
 * selection, and reaches `cacheProfile` whole — where it bounded the vector tiles and nothing
 * else: every layer's entities still left as the whole collection, capped only by
 * `offline.maxFeatures`. The zone the user declared is the extent the pull is sent with.
 *
 * ⚠️ Nothing is guessed. No zone, or one whose four bounds are not finite numbers, yields no
 * `bbox` — the pull then covers the whole collection, as it always did without a zone.
 *
 * @param selection - The saved selection, as the download handed it over.
 * @returns The extent in the order `pullLayer` and OGC API Features read it, or `undefined`.
 */
function zoneBbox(
    selection: SelectionLike | null | undefined
): [number, number, number, number] | undefined {
    const zone = selection?.vectorZone as { bounds?: Record<string, unknown> } | undefined;
    const b = zone?.bounds;
    if (!b || typeof b !== "object") return undefined;
    const bbox = [b.west, b.south, b.east, b.north];
    if (!bbox.every((v) => typeof v === "number" && Number.isFinite(v))) return undefined;
    return bbox as [number, number, number, number];
}

/** One layer's outcome, as the caller reports it alongside the resource tally. */
export interface DeclaredPullReport {
    readonly layerId: string;
    readonly written: number;
    readonly capped: boolean;
    readonly aborted: boolean;
    readonly refused: string | null;
}

/**
 * True when the layer declares a pull source — the only declaration that means
 * "there are entities to fetch". Exported for the sync report, which judges "declared
 * offline" by the SAME predicate since 25/09/2026 (it read `offline.enabled`, and reported
 * layers with nothing to pull as never pulled, forever).
 *
 * ⚠️ **`offline.enabled` is NOT the predicate**, and using it would pull layers that
 * declare no source: `enabled` says the loader reads the local store, `source` says
 * where the store is filled from. A layer with the first and not the second is served
 * by another path, and `pullLayer` would answer `refused: "noSource"` for it — a refusal
 * reported once per download, for a profile that is not misconfigured.
 */
export function declaresPullSource(layer: Record<string, unknown>): boolean {
    const offline = layer.offline as { source?: { url?: unknown } } | undefined;
    return typeof offline?.source?.url === "string" && offline.source.url.length > 0;
}

/**
 * Pulls the entities of every selected layer that declares a source.
 *
 * Never throws and never fails the download: `pullLayer` returns a report rather than
 * raising, and a layer whose source is down must not undo the megabytes of tiles that
 * were just cached. What it does instead is **say so**, one line per layer.
 *
 * ⚠️ **Sequential, deliberately.** Each pull writes one IndexedDB transaction per source
 * page; running several layers at once would interleave those transactions on the same
 * store for no wall-clock gain worth the contention, and would make the progress signal
 * — which names one layer at a time — unreadable.
 *
 * Each pull is bounded by the download zone when one was drawn — see `zoneBbox` above.
 *
 * @param profileId - Profile being downloaded.
 * @param selection - The saved selection: its layer whitelist (absent means every layer) and
 *   its download zone (absent means no extent). `null` when nothing was saved.
 * @param signal - Cooperative abort, forwarded to each pull.
 * @returns One report per layer attempted; `[]` when the profile declares no source.
 * @example
 * const pulled = await pullDeclaredLayers("tourism", selection);
 * console.info(`${pulled.filter((p) => !p.refused).length} couche(s) rapatriée(s)`);
 */
export async function pullDeclaredLayers(
    profileId: string,
    selection: SelectionLike | null | undefined,
    signal?: AbortSignal
): Promise<DeclaredPullReport[]> {
    // 🛑 THE PULL READS THE **ACTIVE** PROFILE, and this guard is what keeps that true.
    // `pullLayer` resolves its layer through `GeoLeaf.Config.getActiveProfile()`, while
    // `cacheProfile` takes a profile id as an argument. Today the only caller passes the
    // active one — but a download of some OTHER profile would otherwise pull layers of
    // the active profile under that profile's name, writing the wrong entities under the
    // right-looking marker. Refusing is the readable half of the two.
    const active = coreConfigGet("data.activeProfile", "") as string;
    if (profileId !== active) {
        Log.info(
            `[Offline.Pull] Profil "${profileId}" ≠ profil actif "${active}" — ` +
                `rapatriement des entités non tenté : le pull résout ses couches sur le profil actif.`
        );
        return [];
    }

    const selected = Array.isArray(selection?.layers) ? (selection.layers as unknown[]) : null;
    const bbox = zoneBbox(selection);
    const targets = profileLayers().filter((layer) => {
        if (!declaresPullSource(layer)) return false;
        // Same predicate as `ResourceEnumerator._addLayerResources`: an absent selection
        // means everything, a present one is a whitelist.
        return selected === null || selected.includes(layer.id);
    });

    if (targets.length === 0) return [];

    const reports: DeclaredPullReport[] = [];
    for (const layer of targets) {
        const layerId = String(layer.id);
        if (signal?.aborted) {
            Log.info(`[Offline.Pull] Abandon demandé — "${layerId}" non tenté.`);
            break;
        }
        const report = await pullLayer(layerId, {
            ...(signal ? { signal } : {}),
            ...(bbox ? { bbox } : {}),
        });
        reports.push({
            layerId,
            written: report.written,
            capped: report.capped,
            aborted: report.aborted,
            refused: report.refused,
        });
        if (report.refused) {
            Log.warn(`[Offline.Pull] "${layerId}" — refusé : ${report.refused}`);
        } else {
            Log.info(
                `[Offline.Pull] "${layerId}" — ${report.written} entité(s) écrite(s)` +
                    `${report.capped ? ", lot TRONQUÉ par le plafond" : ""}` +
                    `${report.aborted ? ", lot PARTIEL (abandon)" : ""}`
            );
        }
    }
    return reports;
}
