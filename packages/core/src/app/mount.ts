/*!
 * GeoLeaf Core – App / Mount
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * `GeoLeaf.mount()` — an application a host mounts, unmounts and mounts again.
 *
 * ## Why this exists
 *
 * `GeoLeaf.boot()` starts the application once per page: a second call is refused, and nothing
 * tears the application down. `Core.destroy()` removes the MAP, and only the map — the modules,
 * their listeners and the state they hold stay, and `Core.init()` then gives a bare map, without a
 * control, a panel or a profile layer. A host that mounts and unmounts views (a single-page
 * application, a component framework) had no way to give the application back.
 *
 * ## What a mount is
 *
 * Still ONE application per page (`packages/core/docs/DIRECTION.md`, Known limits). `mount()`
 * returns a handle AT ONCE — so a host can subscribe before the first boot event, and unmount
 * while the application is still starting — and boots in the background. A later `mount()`
 * wins: it unmounts the application alive before it, mounted by `mount()` or by `boot()`, and
 * the previous handle goes inert.
 *
 * ## The order of the teardown — one for every case
 *
 * 1. end the boot, if it is still running: `ready` rejects (`"unmounted"`), then
 *    `geoleaf:boot:aborted` (`reason: "unmounted"`), and the veil is hidden;
 * 2. wait for the boot to stop at its next checkpoint (`BootRun`, `app-types.ts`) — the
 *    registry refuses to be destroyed while its `init()` loop runs;
 * 3. `ModuleRegistry.destroy()`, WHILE THE MAP IS STILL ALIVE: the capabilities take their
 *    controls off it — a teardown run on a destroyed map throws before it resets its own state,
 *    and that capability then never mounts again;
 * 4. `Core.destroy(mapId)`: the map, then the lifecycle seam (panels, toolbar, GeoJSON, profile);
 * 5. what the boot owns: `_appStarted`, the callbacks, the failure state, the configuration;
 * 6. the handle's subscriptions.
 *
 * `Core.destroy()` alone does not change: it is not an unmount. The registry stays out of it on
 * purpose — a map recreated by `Core.init()` would lose the controls only the boot mounts.
 *
 * ## Serialised
 *
 * Every step runs on one promise chain, in call order: React's StrictMode mounts, unmounts and
 * mounts again in the same tick, and a view swap mounts the new view before the old one
 * unmounts. The boot itself does not hold the chain: a later step starts by ending it.
 */

import type { AppNamespace, BootOptions, BootRun } from "./app-types.js";
import type { ModuleRegistry } from "./module-registry.js";
import type { MountTarget } from "./boot-modules/core-map-lifecycle.js";
import type { IMapAdapter } from "../contracts/map-adapter.contract.js";
import type { GeoLeafEventMap } from "../contracts/event-bus.contract.js";
import type { GeoLeafEventHandler, GeoLeafListenableEventMap } from "../kernel/events/facade.js";
import { Core } from "../kernel/map/facade.js";
import { runLifecycleTeardowns } from "../kernel/shared/lifecycle.js";
import { resetConfigStore } from "../kernel/config/geoleaf-config/config-core.js";
import { abortBoot, resetBootFailure } from "./boot-failure.js";
import { hideBootVeil } from "./init-reveal.js";
import { GeoLeafError } from "../utils/errors/errors.js";
import { Log } from "../utils/log/index.js";

type BootFailedDetail = GeoLeafEventMap["geoleaf:boot:failed"];

/** The map id a container element without an id is registered under. */
const DEFAULT_MAP_ID = "geoleaf-map";

/**
 * Why `ready` rejected: `"unmounted"` — the application was unmounted, or taken over by a later
 * `mount()`, before it was ready; `"aborted"` — the `beforeBoot` hook refused the boot, or the
 * map was destroyed while it started; otherwise the `reason` of the `geoleaf:boot:failed` that
 * ended the boot (never `"timeout"`, which is provisional).
 */
export type MountFailureReason =
    "unmounted" | "aborted" | Exclude<BootFailedDetail["reason"], "timeout">;

/**
 * The error `ready` rejects with. `name` is always `"GeoLeafMountError"` — test it rather than
 * the class, which is not exported from the package entry.
 */
export class GeoLeafMountError extends GeoLeafError {
    /** Set explicitly: the base class reads `constructor.name`, which a minifier renames. */
    override name = "GeoLeafMountError";

    /** Why the boot did not reach `geoleaf:app:ready` — see {@link MountFailureReason}. */
    readonly reason: MountFailureReason;

    /** The boot step that failed, for a `geoleaf:boot:failed`; `null` otherwise. */
    readonly phase: BootFailedDetail["phase"] | null;

    /**
     * @param reason - Why the boot did not complete.
     * @param message - An English message, for logs and support.
     * @param phase - The step that failed, when a `geoleaf:boot:failed` said.
     * @param cause - What the `beforeBoot` hook threw, for an abort it caused.
     */
    constructor(
        reason: MountFailureReason,
        message: string,
        phase: BootFailedDetail["phase"] | null = null,
        cause?: unknown
    ) {
        super(message, { reason, phase });
        this.reason = reason;
        this.phase = phase;
        if (cause !== undefined) this.cause = cause;
    }
}

/**
 * The handle `GeoLeaf.mount()` returns — the application it mounted, and the one way to take it
 * down again.
 */
export interface GeoLeafMount {
    /**
     * Settles once the boot has: resolves on `geoleaf:app:ready`; rejects with a
     * {@link GeoLeafMountError} when the boot fails (`geoleaf:boot:failed`, a provisional timeout
     * excepted), is aborted, or when the application is unmounted before it was ready. A boot
     * held on the attention screen (« Continue ») stays pending until the user continues.
     *
     * A rejection nobody awaits is not reported as unhandled.
     */
    readonly ready: Promise<void>;

    /**
     * Unmounts the application: ends its boot if it is still running, tears its modules down
     * while the map is still alive, destroys the map and the panels, and forgets the state the
     * boot owned — the next `mount()` or `boot()` starts the whole application again.
     *
     * Idempotent. Does nothing more on a handle a later `mount()` has already taken over.
     *
     * @returns Resolves once the application is torn down. A `beforeBoot` hook still pending
     *   holds it: the boot stops at its next step, and the hook is the host's.
     */
    unmount(): Promise<void>;

    /**
     * Subscribes to a GeoLeaf event — the page's bus, the same events and types as
     * `GeoLeaf.Events.on()`. Whatever is subscribed here is removed when the application is
     * unmounted.
     *
     * A subscription made before the boot starts is attached when it does: it hears every event
     * of THIS application, and nothing of the one it replaces.
     *
     * @param event - A `geoleaf:*` event name.
     * @param handler - Receives the `CustomEvent`, its `detail` typed by the event name.
     * @returns Removes this subscription — and only it, even when the same function was also
     *   subscribed through `GeoLeaf.Events.on()`.
     */
    on<K extends keyof GeoLeafListenableEventMap>(
        event: K,
        handler: GeoLeafEventHandler<K>
    ): () => void;

    /**
     * The map of this application — its engine-agnostic adapter —, or `null` before the map is
     * built and once the application is unmounted.
     *
     * @returns The adapter, or `null`.
     */
    getMap(): IMapAdapter | null;
}

/** What {@link createMountController} needs from the bundle's boot installation. */
export interface MountContext {
    /** The `GeoLeaf` namespace. */
    GeoLeaf: GeoLeafGlobal;
    /** The `GeoLeaf._app` namespace: `startApp`, `_appStarted`, the cross-module state. */
    app: AppNamespace;
    /** The bundle's module registry. */
    registry: ModuleRegistry;
    /** Handles a boot that threw outside every step's own handling. */
    onBootError: (error: unknown) => void;
}

/** The application lifecycle of one bundle: the `mount()` behind `GeoLeaf.mount`, and `boot()`. */
export interface MountController {
    /** `GeoLeaf.mount(target, options)` — see {@link GeoLeafMount}. */
    mount(target: HTMLElement | string, options?: BootOptions): GeoLeafMount;
    /**
     * Starts the application for `GeoLeaf.boot()`, without a handle. Waits for a teardown in
     * progress; an application already mounted is left alone, and the boot refuses the call as it
     * always has.
     */
    boot(options?: BootOptions): void;
}

/** One subscription made through a handle. */
interface Subscription {
    readonly event: string;
    readonly listener: EventListener;
    attached: boolean;
}

/** One application, from the call that asked for it to its teardown. */
interface Session {
    readonly options: BootOptions | undefined;
    /** The container `mount()` named; `null` for `boot()`, whose target is the profile's. */
    readonly target: MountTarget | null;
    readonly run: BootRun;
    readonly subscriptions: Set<Subscription>;
    readonly readyListeners: Array<() => void>;
    ready: { resolve: () => void; reject: (error: GeoLeafMountError) => void } | null;
    cancelled: boolean;
    started: boolean;
    /** Started, and not yet ready, failed or aborted. */
    booting: boolean;
    torn: boolean;
    boot: Promise<void> | null;
    unmounting: Promise<void> | null;
}

/** Resolves `mount()`'s first argument into what the boot reads. */
function _resolveTarget(target: unknown): MountTarget {
    if (typeof target === "string" && target.length > 0) return { mapId: target, element: null };
    if (typeof HTMLElement !== "undefined" && target instanceof HTMLElement) {
        return { mapId: target.id || DEFAULT_MAP_ID, element: target };
    }
    throw new GeoLeafError(
        "GeoLeaf.mount(el, options): `el` must be the map container — an element, or its id."
    );
}

/** Resolves once the document is parsed — the application shell may be declared after the call. */
function _domReady(): Promise<void> {
    if (typeof document === "undefined" || document.readyState !== "loading") {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    });
}

/** The id `map` is registered under in `GeoLeaf.Core`, or `null` when it is not. */
function _mapIdOf(map: unknown): string | null {
    if (!map) return null;
    return Core.listMaps().find((id) => Core.getMap(id) === map) ?? null;
}

function _newSession(options: BootOptions | undefined, target: MountTarget | null): Session {
    const session: Session = {
        options,
        target,
        run: { isCancelled: () => session.cancelled },
        subscriptions: new Set(),
        readyListeners: [],
        ready: null,
        cancelled: false,
        started: false,
        booting: false,
        torn: false,
        boot: null,
        unmounting: null,
    };
    return session;
}

/** Settles `ready` once: `null` resolves it, an error rejects it. */
function _settle(session: Session, error: GeoLeafMountError | null): void {
    const ready = session.ready;
    if (!ready) return;
    session.ready = null;
    if (error) ready.reject(error);
    else ready.resolve();
}

function _attach(subscription: Subscription): void {
    if (subscription.attached || typeof document === "undefined") return;
    document.addEventListener(subscription.event, subscription.listener);
    subscription.attached = true;
}

function _detach(subscription: Subscription): void {
    if (!subscription.attached || typeof document === "undefined") return;
    document.removeEventListener(subscription.event, subscription.listener);
    subscription.attached = false;
}

/** Settles `ready` from the boot's own signals — from the moment this boot starts. */
function _listenReady(session: Session): void {
    if (typeof document === "undefined") return;
    const onReady = (): void => {
        session.booting = false;
        _settle(session, null);
    };
    const onFailed = (event: Event): void => {
        const detail = (event as CustomEvent<BootFailedDetail | undefined>).detail;
        if (!detail || detail.provisional || detail.reason === "timeout") return;
        session.booting = false;
        const message = `The boot failed (${detail.reason}): ${detail.message}`;
        _settle(session, new GeoLeafMountError(detail.reason, message, detail.phase));
    };
    const onAborted = (event: Event): void => {
        const reason = (event as CustomEvent<{ reason?: unknown } | undefined>).detail?.reason;
        session.booting = false;
        _settle(session, new GeoLeafMountError("aborted", "The boot was aborted.", null, reason));
    };
    document.addEventListener("geoleaf:app:ready", onReady);
    document.addEventListener("geoleaf:boot:failed", onFailed);
    document.addEventListener("geoleaf:boot:aborted", onAborted);
    session.readyListeners.push(
        () => document.removeEventListener("geoleaf:app:ready", onReady),
        () => document.removeEventListener("geoleaf:boot:failed", onFailed),
        () => document.removeEventListener("geoleaf:boot:aborted", onAborted)
    );
}

/**
 * Ends `session` at once, whatever its state — the synchronous half of an unmount. Its `ready`
 * rejects (`"unmounted"`), and a boot still running is aborted and signalled.
 */
function _cancel(session: Session): void {
    if (session.cancelled) return;
    session.cancelled = true;
    _settle(
        session,
        new GeoLeafMountError("unmounted", "The application was unmounted before it was ready.")
    );
    if (!session.booting) return;
    session.booting = false;
    abortBoot();
    document.dispatchEvent(
        new CustomEvent("geoleaf:boot:aborted", {
            detail: { reason: "unmounted" },
            bubbles: false,
            cancelable: false,
        })
    );
    hideBootVeil();
}

/** Removes every subscription the handle made, and the listeners that settled `ready`. */
function _dropHandle(session: Session): void {
    for (const subscription of session.subscriptions) _detach(subscription);
    session.subscriptions.clear();
    for (const off of session.readyListeners.splice(0)) off();
}

/** Subscribes through a handle — see {@link GeoLeafMount.on}. */
function _subscribe(session: Session, event: string, handler: (event: never) => void): () => void {
    if (session.cancelled) {
        Log.warn(`[GeoLeaf.mount] on("${event}") on an unmounted application — ignored.`);
        return () => {};
    }
    // A closure of its own: removing it never removes what the host subscribed elsewhere with
    // the same function.
    const subscription: Subscription = {
        event,
        listener: (e: Event) => handler(e as never),
        attached: false,
    };
    session.subscriptions.add(subscription);
    if (session.started) _attach(subscription);
    return () => {
        _detach(subscription);
        session.subscriptions.delete(subscription);
    };
}

/** The application lifecycle of one bundle — the state behind {@link MountController}. */
class MountLifecycle implements MountController {
    private readonly _ctx: MountContext;
    private _chain: Promise<void> = Promise.resolve();
    private _pending = 0;
    /** The application started last and not torn down yet. */
    private _live: Session | null = null;
    /** The session `mount()` created last — a later one cancels it before it even starts. */
    private _latest: Session | null = null;

    constructor(ctx: MountContext) {
        this._ctx = ctx;
    }

    mount(target: HTMLElement | string, options?: BootOptions): GeoLeafMount {
        const session = _newSession(options, _resolveTarget(target));
        const ready = new Promise<void>((resolve, reject) => {
            session.ready = { resolve, reject };
        });
        // Marked handled: a rejection nobody awaits must not reach the page as unhandled.
        ready.catch(() => undefined);

        // A later mount wins: the application alive, and a mount still waiting its turn, end
        // now — their `ready` rejects, and a boot still running is aborted.
        if (this._latest) _cancel(this._latest);
        if (this._live) _cancel(this._live);
        this._latest = session;

        void this._enqueue(async () => {
            const { app } = this._ctx;
            if (this._live) await this._teardown(this._live);
            else if (app._appStarted) await this._teardown(this._adoptUnknown());
            if (session.cancelled) return;
            await _domReady();
            if (session.cancelled) return;
            this._applyCallbacks(options);
            this._start(session);
        });
        return this._handleOf(session, ready);
    }

    boot(options?: BootOptions): void {
        const startBoot = (): void => {
            const { app, onBootError } = this._ctx;
            if (app._appStarted) {
                // An application is mounted: the boot refuses the call, and says so — as it
                // always has.
                app.startApp(options).then(undefined, onBootError);
                return;
            }
            this._start(_newSession(options, null));
        };
        if (this._pending > 0) void this._enqueue(startBoot);
        else startBoot();
    }

    private _enqueue(step: () => Promise<void> | void): Promise<void> {
        this._pending++;
        const next = this._chain
            .then(step)
            .catch((error: unknown) => {
                Log.error("[GeoLeaf.mount] lifecycle step failed:", error);
            })
            .finally(() => {
                this._pending--;
            });
        this._chain = next;
        return next;
    }

    /** What `GeoLeaf.boot()` does with the two callbacks before starting — the same for a mount. */
    private _applyCallbacks(options: BootOptions | undefined): void {
        const gl = this._ctx.GeoLeaf as Record<string, unknown>;
        if (options?.beforeBoot) gl["_beforeBootCallback"] = options.beforeBoot;
        else delete gl["_beforeBootCallback"];
        if (options?.onPerformanceMetrics) gl["_perfCallback"] = options.onPerformanceMetrics;
        else delete gl["_perfCallback"];
    }

    /** Starts `session`'s boot. It runs in the background; the chain does not wait for it. */
    private _start(session: Session): void {
        const { app, onBootError } = this._ctx;
        this._live = session;
        session.started = true;
        session.booting = true;
        for (const subscription of session.subscriptions) _attach(subscription);
        _listenReady(session);
        app._mountTarget = session.target;
        let booting: Promise<void>;
        try {
            booting = app.startApp(session.options, session.run);
        } catch (error) {
            booting = Promise.reject(error);
        }
        session.boot = booting.then(undefined, (error: unknown) => {
            if (!session.cancelled) onBootError(error);
        });
    }

    /** The asynchronous half of an unmount, on the chain: steps 2 to 6 of the header. */
    private async _teardown(session: Session): Promise<void> {
        _cancel(session);
        if (session.torn) return;
        session.torn = true;
        if (!session.started) {
            _dropHandle(session);
            return;
        }
        // The boot stops at its next checkpoint: the registry is no longer looping after this.
        await session.boot;
        // Read BEFORE the registry teardown, which clears it (`CoreMapLifecycle._reset`).
        const mapId = _mapIdOf(this._ctx.app._currentMap);
        this._ctx.registry.destroy();
        // The map was destroyed by the host already, or never built: the seam still runs.
        if (mapId === null || !Core.destroy(mapId)) runLifecycleTeardowns();
        this._resetBootState();
        _dropHandle(session);
        if (this._live === session) this._live = null;
    }

    /** Forgets what the boot owned: the next boot starts from what a fresh page gives it. */
    private _resetBootState(): void {
        const { app } = this._ctx;
        app._appStarted = false;
        app._mountTarget = null;
        app._eventsMark = null;
        const gl = this._ctx.GeoLeaf as Record<string, unknown>;
        delete gl["_beforeBootCallback"];
        delete gl["_perfCallback"];
        resetBootFailure();
        resetConfigStore();
    }

    /**
     * An application started without going through this controller — a direct `_app.startApp()`
     * call. Torn down the same way, as far as can be known of it.
     */
    private _adoptUnknown(): Session {
        const session = _newSession(undefined, null);
        session.started = true;
        session.boot = Promise.resolve();
        return session;
    }

    private _handleOf(session: Session, ready: Promise<void>): GeoLeafMount {
        return {
            ready,
            unmount: (): Promise<void> => {
                if (session.unmounting) return session.unmounting;
                _cancel(session);
                session.unmounting = this._enqueue(() => this._teardown(session));
                return session.unmounting;
            },
            on: (event, handler) => _subscribe(session, event as string, handler as never),
            getMap: (): IMapAdapter | null => {
                // Inert from the moment it is unmounted — or taken over — not from the end of
                // the teardown: its map is going away.
                if (!session.started || session.cancelled || this._live !== session) return null;
                const map = this._ctx.app._currentMap as IMapAdapter | null | undefined;
                return map && _mapIdOf(map) !== null ? map : null;
            },
        };
    }
}

/**
 * Creates the application lifecycle of one bundle — called once, by `installBoot()`.
 *
 * @param ctx - The namespace, the `_app` namespace, the registry and the boot error handler.
 * @returns The controller behind `GeoLeaf.mount()` and `GeoLeaf.boot()`.
 */
export function createMountController(ctx: MountContext): MountController {
    return new MountLifecycle(ctx);
}
